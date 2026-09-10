import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";

const baseUrl = __ENV.BASE_URL;
const duration = __ENV.WORKLOAD_DURATION || "30s";
const seedDocs = Number(__ENV.WORKLOAD_SEED_DOCS || 100);
const hotDocs = Number(__ENV.WORKLOAD_HOT_DOCS || 5);
const readRate = Number(__ENV.WORKLOAD_READ_RATE || 12);
const browseRate = Number(__ENV.WORKLOAD_BROWSE_RATE || 2);
const writeRate = Number(__ENV.WORKLOAD_WRITE_RATE || 3);
const createRate = Number(__ENV.WORKLOAD_CREATE_RATE || 1);
const idPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const etagPattern = /^"[0-9a-f]{32}"$/;

const values = [seedDocs, hotDocs, readRate, browseRate, writeRate, createRate];
if (values.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error("workload counts and rates must be positive integers");
}
if (seedDocs > 1000 || hotDocs > seedDocs) {
    throw new Error("seed docs must be at most 1000 and include all hot docs");
}

const writes = new Counter("writes");
const conflicts = new Counter("write_conflicts");
const creates = new Counter("documents_created");

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 204 }, 412));

export const options = {
    scenarios: {
        read: scenario("readDoc", readRate, 12, "read"),
        browse: scenario("browseDocs", browseRate, 4, "read"),
        write: scenario("editDoc", writeRate, 8, "write"),
        create: scenario("createDoc", createRate, 4, "write"),
    },
    thresholds: {
        checks: ["rate>0.99"],
        http_req_failed: ["rate<0.01"],
        dropped_iterations: ["count==0"],
        "http_req_duration{workload:read}": ["p(95)<500"],
        "http_req_duration{workload:write}": ["p(95)<750"],
        writes: ["count>0"],
        documents_created: ["count>0"],
    },
};

const jsonHeaders = { "Content-Type": "application/json" };

function scenario(exec, rate, maxVUs, workload) {
    return {
        executor: "constant-arrival-rate",
        exec,
        rate,
        timeUnit: "1s",
        duration,
        preAllocatedVUs: Math.min(rate + 1, maxVUs),
        maxVUs,
        gracefulStop: "5s",
        tags: { workload },
    };
}

function pick(values) {
    return values[Math.floor(Math.random() * values.length)];
}

export function setup() {
    if (!baseUrl) {
        fail("BASE_URL is required");
    }

    const database = `workload-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    const createDatabase = http.post(
        `${baseUrl}/`,
        JSON.stringify({ name: database }),
        { headers: jsonHeaders, tags: { operation: "database_seed" } },
    );

    if (!check(createDatabase, { "database seeded": (r) => r.status === 201 })) {
        fail(`database creation failed: ${createDatabase.status} ${createDatabase.body}`);
    }

    const ids = [];
    for (let index = 0; index < seedDocs; index += 1) {
        const response = http.post(
            `${baseUrl}/${database}/`,
            JSON.stringify({
                title: `Document ${index}`,
                category: index % 10,
                revision: 0,
                seeded: true,
            }),
            { headers: jsonHeaders, tags: { operation: "document_seed" } },
        );
        const id = response.status === 201 ? response.json("id") : "";

        if (response.status !== 201 || !idPattern.test(id)) {
            fail(`document seed failed: ${response.status} ${response.body}`);
        }

        ids.push(id);
    }

    return { database, ids, hotIds: ids.slice(0, hotDocs) };
}

export function readDoc({ database, ids }) {
    const id = pick(ids);
    const response = http.get(`${baseUrl}/${database}/${id}`, {
        tags: { operation: "document_read" },
    });

    check(response, {
        "document read": (r) => r.status === 200,
        "read returned ETag": (r) => etagPattern.test(r.headers.Etag),
        "read returned object": (r) => r.json("title") !== undefined,
    });
}

export function browseDocs({ database }) {
    const list = http.get(`${baseUrl}/${database}?limit=50`, {
        tags: { operation: "document_list" },
    });
    const ids = list.status === 200 ? list.json("documents") : [];

    if (!check(list, {
        "documents browsed": (r) => r.status === 200,
        "browse returned IDs": () => Array.isArray(ids) && ids.length > 0,
    })) {
        return;
    }

    const response = http.get(`${baseUrl}/${database}/${pick(ids)}`, {
        tags: { operation: "browse_read" },
    });
    check(response, { "browsed document read": (r) => r.status === 200 });
}

export function editDoc({ database, hotIds }) {
    const id = pick(hotIds);
    const read = http.get(`${baseUrl}/${database}/${id}`, {
        tags: { operation: "edit_read" },
    });
    const etag = read.headers.Etag;

    if (!check(read, {
        "editable document read": (r) => r.status === 200,
        "edit read returned ETag": () => etagPattern.test(etag),
    })) {
        return;
    }

    // Let concurrent editors race on the same revision.
    sleep(0.05 + Math.random() * 0.1);

    const response = http.patch(
        `${baseUrl}/${database}/${id}`,
        JSON.stringify({ revision: Date.now(), editor: __VU }),
        {
            headers: {
                "Content-Type": "application/merge-patch+json",
                "If-Match": etag,
            },
            tags: { operation: "document_edit" },
        },
    );

    check(response, {
        "edit accepted or conflicted": (r) => r.status === 200 || r.status === 412,
    });

    if (response.status === 200) {
        writes.add(1);
        check(response, {
            "edit changed ETag": (r) =>
                etagPattern.test(r.headers.Etag) && r.headers.Etag !== etag,
            "edit stored editor": (r) => r.json("editor") === __VU,
        });
    } else if (response.status === 412) {
        conflicts.add(1);
        check(response, {
            "conflict returned code": (r) =>
                r.json("error.code") === "precondition_failed",
        });
    }
}

export function createDoc({ database }) {
    const document = {
        title: `Created by ${__VU}`,
        created: Date.now(),
        iteration: __ITER,
    };
    const response = http.post(
        `${baseUrl}/${database}/`,
        JSON.stringify(document),
        { headers: jsonHeaders, tags: { operation: "document_create" } },
    );
    const id = response.status === 201 ? response.json("id") : "";

    if (!check(response, {
        "document created": (r) => r.status === 201,
        "create returned ID": () => idPattern.test(id),
        "create returned ETag": (r) => etagPattern.test(r.headers.Etag),
    })) {
        return;
    }

    creates.add(1);

    const read = http.get(`${baseUrl}/${database}/${id}`, {
        tags: { operation: "created_document_read" },
    });
    check(read, {
        "created document visible": (r) => r.status === 200,
        "created document matches": (r) => r.json("created") === document.created,
    });
}

export function teardown({ database }) {
    const response = http.del(`${baseUrl}/${database}`, null, {
        tags: { operation: "database_delete" },
    });

    check(response, { "database deleted": (r) => r.status === 204 });
}
