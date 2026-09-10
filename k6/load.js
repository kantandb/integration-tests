import http from "k6/http";
import { check, fail, sleep } from "k6";

const baseUrl = __ENV.BASE_URL;
const idPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const etagPattern = /^"[0-9a-f]{32}"$/;

export const options = {
    scenarios: {
        load: {
            executor: "constant-vus",
            vus: Number(__ENV.LOAD_VUS || 5),
            duration: __ENV.LOAD_DURATION || "15s",
            gracefulStop: "5s",
        },
    },
    thresholds: {
        checks: ["rate>0.99"],
        http_req_failed: ["rate<0.01"],
        http_req_duration: ["p(95)<500"],
    },
};

const jsonHeaders = { "Content-Type": "application/json" };

export function setup() {
    if (!baseUrl) {
        fail("BASE_URL is required");
    }

    const database = `load-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    const response = http.post(
        `${baseUrl}/`,
        JSON.stringify({ name: database }),
        { headers: jsonHeaders, tags: { name: "database_create" } },
    );

    if (!check(response, { "database created": (r) => r.status === 201 })) {
        fail(`database creation failed: ${response.status} ${response.body}`);
    }

    return { database };
}

export default function ({ database }) {
    const document = { owner: __VU, iteration: __ITER, active: true };
    const create = http.post(
        `${baseUrl}/${database}/`,
        JSON.stringify(document),
        { headers: jsonHeaders, tags: { name: "document_create" } },
    );
    const id = create.status === 201 ? create.json("id") : "";
    const createdEtag = create.headers.Etag;

    const created = check(create, {
        "document created": (r) => r.status === 201,
        "create returned an ID": () => idPattern.test(id),
        "create returned an ETag": () => etagPattern.test(createdEtag),
        "create returned Location": (r) =>
            r.headers.Location === `/${database}/${id}`,
    });
    if (!created) {
        return;
    }

    const read = http.get(`${baseUrl}/${database}/${id}`, {
        tags: { name: "document_read" },
    });
    check(read, {
        "document read": (r) => r.status === 200,
        "read returned created ETag": (r) => r.headers.Etag === createdEtag,
        "read returned document": (r) =>
            r.json("owner") === __VU && r.json("iteration") === __ITER,
    });

    const replacement = { owner: __VU, iteration: __ITER, active: false };
    const update = http.put(
        `${baseUrl}/${database}/${id}`,
        JSON.stringify(replacement),
        {
            headers: { ...jsonHeaders, "If-Match": createdEtag },
            tags: { name: "document_update" },
        },
    );
    const updatedEtag = update.headers.Etag;

    const updated = check(update, {
        "document updated": (r) => r.status === 200,
        "update changed ETag": () =>
            etagPattern.test(updatedEtag) && updatedEtag !== createdEtag,
        "update returned replacement": (r) => r.json("active") === false,
    });
    if (!updated) {
        return;
    }

    const list = http.get(`${baseUrl}/${database}?limit=1000`, {
        tags: { name: "document_list" },
    });
    check(list, {
        "documents listed": (r) => r.status === 200,
        "list contains document": (r) => r.json("documents").includes(id),
        "list returned cursor": (r) => typeof r.json("cursor") === "string",
    });

    const remove = http.del(`${baseUrl}/${database}/${id}`, null, {
        headers: { "If-Match": updatedEtag },
        tags: { name: "document_delete" },
    });
    check(remove, {
        "document deleted": (r) => r.status === 204,
        "delete returned empty body": (r) => !r.body,
    });

    sleep(0.1);
}

export function teardown({ database }) {
    const response = http.del(`${baseUrl}/${database}`, null, {
        tags: { name: "database_delete" },
    });

    check(response, { "database deleted": (r) => r.status === 204 });
}
