import http from "k6/http";
import { check, fail } from "k6";
import { Counter } from "k6/metrics";

const baseUrl = __ENV.BASE_URL;
const duration = __ENV.BENCHMARK_DURATION || "2m";
const seedDocs = Number(__ENV.BENCHMARK_SEED_DOCS || 10000);
const pageSize = Number(__ENV.BENCHMARK_PAGE_SIZE || 100);
const payloadBytes = Number(__ENV.BENCHMARK_PAYLOAD_BYTES || 1024);
const readRate = Number(__ENV.BENCHMARK_READ_RATE || 100);
const listRate = Number(__ENV.BENCHMARK_LIST_RATE || 5);
const rangeRate = Number(__ENV.BENCHMARK_RANGE_RATE || 5);
const queryIndexRate = Number(__ENV.BENCHMARK_QUERY_INDEX_RATE || 5);
const queryScanRate = Number(__ENV.BENCHMARK_QUERY_SCAN_RATE || 2);
const updateRate = Number(__ENV.BENCHMARK_UPDATE_RATE || 20);
const createRate = Number(__ENV.BENCHMARK_CREATE_RATE || 10);
const categoryCount = 100;
const idPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const etagPattern = /^"[0-9a-f]{32}"$/;

const counts = [seedDocs, pageSize, payloadBytes];
const rates = [
    readRate,
    listRate,
    rangeRate,
    queryIndexRate,
    queryScanRate,
    updateRate,
    createRate,
];
if (counts.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error("benchmark counts must be positive integers");
}
if (rates.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error("benchmark rates must be positive integers");
}
if (pageSize > 1000 || pageSize >= seedDocs) {
    throw new Error("page size must be at most 1000 and less than seed docs");
}

const writes = new Counter("writes");
const conflicts = new Counter("write_conflicts");
const creates = new Counter("documents_created");

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 204 }, 412));

export const options = {
    setupTimeout: __ENV.BENCHMARK_SETUP_TIMEOUT || "10m",
    summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max", "count"],
    scenarios: {
        read: scenario("readDoc", readRate, "read"),
        list: scenario("listDocs", listRate, "read"),
        range: scenario("rangeDocs", rangeRate, "read"),
        queryIndex: scenario("queryIndex", queryIndexRate, "read"),
        queryScan: scenario("queryScan", queryScanRate, "read"),
        update: scenario("updateDoc", updateRate, "write"),
        create: scenario("createDoc", createRate, "write"),
    },
    thresholds: {
        checks: ["rate>0.99"],
        http_req_failed: ["rate<0.01"],
        dropped_iterations: ["count==0"],
        "http_req_duration{operation:point_read}": ["p(95)<1000"],
        "http_req_duration{operation:primary_scan}": ["p(95)<1000"],
        "http_req_duration{operation:range_query}": ["p(95)<1000"],
        "http_req_duration{operation:index_query}": ["p(95)<1000"],
        "http_req_duration{operation:scan_query}": ["p(95)<1500"],
        "http_req_duration{operation:update_read}": ["p(95)<1000"],
        "http_req_duration{operation:indexed_update}": ["p(95)<1500"],
        "http_req_duration{operation:indexed_create}": ["p(95)<1500"],
        "http_req_duration{operation:seed_create}": ["p(95)<1500"],
        "http_req_duration{operation:database_delete}": ["p(95)<10000"],
        writes: ["count>0"],
        documents_created: ["count>0"],
    },
};

const jsonHeaders = { "Content-Type": "application/json" };

function scenario(exec, rate, workload) {
    return {
        executor: "constant-arrival-rate",
        exec,
        rate,
        timeUnit: "1s",
        duration,
        preAllocatedVUs: Math.max(2, rate),
        maxVUs: Math.max(4, rate * 2),
        gracefulStop: "10s",
        tags: { workload },
    };
}

function pick(values) {
    return values[Math.floor(Math.random() * values.length)];
}

// Produce deterministic data that storage compression cannot collapse trivially.
function payload(seed) {
    let value = (seed + 1) >>> 0;
    let result = "";

    while (result.length < payloadBytes) {
        value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
        result += value.toString(16).padStart(8, "0");
    }

    return result.slice(0, payloadBytes);
}

export function setup() {
    if (!baseUrl) {
        fail("BASE_URL is required");
    }

    const database = `benchmark-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    const createDatabase = http.post(
        `${baseUrl}/`,
        JSON.stringify({
            name: database,
            indexes: [{ name: "category", path: "/category" }],
        }),
        { headers: jsonHeaders, tags: { name: "database_seed" } },
    );

    if (!check(createDatabase, { "database created": (r) => r.status === 201 })) {
        fail(`database creation failed: ${createDatabase.status} ${createDatabase.body}`);
    }

    // Sample IDs across the keyspace without copying the full set into every VU.
    const ids = [];
    const cursors = [];
    const sampleEvery = Math.ceil(seedDocs / 1000);
    for (let index = 0; index < seedDocs; index += 1) {
        const response = http.post(
            `${baseUrl}/${database}/`,
            JSON.stringify({
                category: index % categoryCount,
                products: [{ price: index % categoryCount }],
                revision: 0,
                payload: payload(index),
            }),
            {
                headers: jsonHeaders,
                tags: { name: "document_seed", operation: "seed_create" },
            },
        );
        const id = response.status === 201 ? response.json("id") : "";

        if (response.status !== 201 || !idPattern.test(id)) {
            fail(`document seed failed: ${response.status} ${response.body}`);
        }

        if (index % sampleEvery === 0) {
            ids.push(id);

            if (index < seedDocs - pageSize) {
                cursors.push(id);
            }
        }
    }

    return { database, ids, cursors };
}

export function readDoc({ database, ids }) {
    const response = http.get(`${baseUrl}/${database}/${pick(ids)}`, {
        tags: { name: "document_read", operation: "point_read" },
    });

    check(response, {
        "document read": (r) => r.status === 200,
        "read returned ETag": (r) => etagPattern.test(r.headers.Etag),
        "read returned payload": (r) => r.json("payload").length === payloadBytes,
    });
}

export function listDocs({ database, cursors }) {
    // Start throughout the keyspace instead of repeatedly reading its hot prefix.
    const cursor = encodeURIComponent(pick(cursors));
    const response = http.get(
        `${baseUrl}/${database}?limit=${pageSize}&cursor=${cursor}`,
        { tags: { name: "document_list", operation: "primary_scan" } },
    );

    check(response, {
        "documents listed": (r) => r.status === 200,
        "list returned a full page": (r) => r.json("documents").length === pageSize,
        "list returned cursor": (r) => typeof r.json("cursor") === "string",
    });
}

export function rangeDocs({ database }) {
    const boundary = Math.floor(Math.random() * categoryCount);
    const response = http.get(
        `${baseUrl}/${database}?index=category&op=ge&value=${boundary}&limit=${pageSize}`,
        { tags: { name: "category_range", operation: "range_query" } },
    );

    check(response, {
        "range queried": (r) => r.status === 200,
        "range returned documents": (r) => r.json("documents").length > 0,
        "range returned cursor": (r) => typeof r.json("cursor") === "string",
    });
}

export function queryIndex({ database }) {
    const boundary = Math.floor(Math.random() * categoryCount);
    const response = pathQuery(
        database,
        { path: "$.category", op: "ge", value: boundary, limit: pageSize },
        "category_path_query",
        "index_query",
    );

    checkQuery(response, "indexed QUERY");
}

export function queryScan({ database }) {
    const boundary = Math.floor(Math.random() * categoryCount);
    const response = pathQuery(
        database,
        {
            path: "$.products[*].price",
            op: "ge",
            value: boundary,
            limit: pageSize,
        },
        "product_path_query",
        "scan_query",
    );

    checkQuery(response, "scan QUERY");
}

function pathQuery(database, query, name, operation) {
    return http.request("QUERY", `${baseUrl}/${database}`, JSON.stringify(query), {
        headers: jsonHeaders,
        tags: { name, operation },
    });
}

function checkQuery(response, name) {
    check(response, {
        [`${name} returned`]: (r) => r.status === 200,
        [`${name} returned documents`]: (r) => r.json("documents").length > 0,
        [`${name} returned cursor`]: (r) => typeof r.json("cursor") === "string",
    });
}

export function updateDoc({ database, ids }) {
    const id = pick(ids);
    const read = http.get(`${baseUrl}/${database}/${id}`, {
        tags: { name: "update_read", operation: "update_read" },
    });
    const etag = read.headers.Etag;

    if (!check(read, {
        "editable document read": (r) => r.status === 200,
        "update read returned ETag": () => etagPattern.test(etag),
    })) {
        return;
    }

    const category = Math.floor(Math.random() * categoryCount);
    const response = http.patch(
        `${baseUrl}/${database}/${id}`,
        JSON.stringify({ category, revision: Date.now() }),
        {
            headers: {
                "Content-Type": "application/merge-patch+json",
                "If-Match": etag,
            },
            tags: { name: "document_update", operation: "indexed_update" },
        },
    );

    check(response, {
        "update accepted or conflicted": (r) => r.status === 200 || r.status === 412,
    });

    if (response.status === 200) {
        writes.add(1);
        check(response, {
            "update changed ETag": (r) =>
                etagPattern.test(r.headers.Etag) && r.headers.Etag !== etag,
            "update stored category": (r) => r.json("category") === category,
        });
    } else if (response.status === 412) {
        conflicts.add(1);
    }
}

export function createDoc({ database }) {
    const seed = Date.now() + __VU + __ITER;
    const document = {
        category: seed % categoryCount,
        revision: 0,
        payload: payload(seed),
    };
    const response = http.post(
        `${baseUrl}/${database}/`,
        JSON.stringify(document),
        {
            headers: jsonHeaders,
            tags: { name: "document_create", operation: "indexed_create" },
        },
    );
    const id = response.status === 201 ? response.json("id") : "";

    if (check(response, {
        "document created": (r) => r.status === 201,
        "create returned ID": () => idPattern.test(id),
        "create returned ETag": (r) => etagPattern.test(r.headers.Etag),
    })) {
        creates.add(1);
    }
}

export function teardown({ database }) {
    const response = http.del(`${baseUrl}/${database}`, null, {
        tags: { name: "database_delete", operation: "database_delete" },
    });

    check(response, { "database deleted": (r) => r.status === 204 });
}
