import http from "k6/http";
import { check, fail } from "k6";
import { Counter } from "k6/metrics";
import { ndjson, parseNDJSON, query } from "../query.js";

const baseUrl = __ENV.BASE_URL;
const documents = Number(__ENV.BULK_DOCS || 100);
const payloadBytes = Number(__ENV.BULK_PAYLOAD_BYTES || 256);
const iterations = Number(__ENV.BULK_ITERATIONS || 4);
for (const [name, value] of Object.entries({ documents, payloadBytes, iterations })) {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`BULK_${name.toUpperCase()} must be a positive integer`);
    }
}
if (documents > 1000) {
    throw new Error("BULK_DOCS must be at most 1000");
}

const imports = new Counter("bulk_imports");
const exports = new Counter("bulk_exports");

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 204 }, 400));

export const options = {
    scenarios: {
        bulk: {
            executor: "shared-iterations",
            vus: 1,
            iterations,
            maxDuration: __ENV.BULK_MAX_DURATION || "2m",
        },
    },
    thresholds: {
        checks: ["rate==1"],
        http_req_failed: ["rate==0"],
        "http_req_duration{operation:bulk_import}": ["p(95)<5000"],
        "http_req_duration{operation:bulk_export,status:200}": ["p(95)<5000"],
        bulk_imports: ["count>0"],
        bulk_exports: ["count>0"],
    },
};

const jsonHeaders = { "Content-Type": "application/json" };
const bulkHeaders = { "Content-Type": "application/x-ndjson" };

export function setup() {
    if (!baseUrl) {
        fail("BASE_URL is required");
    }

    const source = `bulk-source-${Date.now()}`;
    createDatabase(source, true);

    const body = makeBody();
    const imported = http.post(`${baseUrl}/db/${source}`, body, {
        headers: bulkHeaders,
        tags: { operation: "bulk_seed" },
    });

    if (!check(imported, {
        "source imported": (r) => r.status === 200,
        "source import succeeded": (r) => r.json("success") === true,
    })) {
        fail(`source import failed: ${imported.status} ${imported.body}`);
    }

    checkCount(source, documents);

    return { source };
}

export default function ({ source }) {
    const suffix = `${Date.now()}-${__VU}-${__ITER}`;
    const target = `bulk-target-${suffix}`;
    const invalid = `bulk-invalid-${suffix}`;
    createDatabase(target, true);
    createDatabase(invalid, false);

    const exported = exportDocs(source, "bulk_export");
    const sourceDocs = parseNDJSON(exported);

    if (check(exported, {
        "source exported": (r) => r.status === 200,
        "export is NDJSON": (r) => header(r, "Content-Type") === "application/x-ndjson",
        "export disables caching": (r) => header(r, "Cache-Control") === "no-store",
        "export contains every document": () => sourceDocs.length === documents,
        "export preserves values": () => sameDocs(sourceDocs, expectedDocs()),
    })) {
        exports.add(1);
    }

    const imported = http.post(`${baseUrl}/db/${target}`, exported.body, {
        headers: bulkHeaders,
        tags: { operation: "bulk_import" },
    });

    if (check(imported, {
        "target imported": (r) => r.status === 200,
        "target import succeeded": (r) => r.json("success") === true,
        "target import error is empty": (r) => Object.keys(r.json("error")).length === 0,
    })) {
        imports.add(1);
    }

    checkCount(target, documents);

    const reexported = exportDocs(target, "bulk_reexport");
    check(reexported, {
        "target re-exported": (r) => r.status === 200,
        "round trip preserves values": (r) =>
            r.status === 200 && sameDocs(parseNDJSON(r), sourceDocs),
    });

    const rejected = http.post(`${baseUrl}/db/${invalid}`, "{}\n[]\n", {
        headers: bulkHeaders,
        tags: { operation: "bulk_invalid" },
    });
    check(rejected, {
        "invalid import rejected": (r) => r.status === 400,
        "invalid import reports line": (r) => {
            const error = r.json("error");
            return error.code === "invalid_document" && error.line === 2;
        },
        "invalid import reports failure": (r) => r.json("success") === false,
    });
    checkCount(invalid, 0);

    deleteDatabase(target);
    deleteDatabase(invalid);
}

export function teardown({ source }) {
    deleteDatabase(source);
}

function createDatabase(name, indexed) {
    const request = { name };
    if (indexed) {
        request.indices = [{ name: "group", path: "/group" }];
    }

    const response = http.post(`${baseUrl}/db`, JSON.stringify(request), {
        headers: jsonHeaders,
        tags: { operation: "database_create" },
    });
    if (response.status !== 201) {
        fail(`database creation failed: ${response.status} ${response.body}`);
    }
}

function deleteDatabase(name) {
    const response = http.del(`${baseUrl}/db/${name}`, null, {
        tags: { operation: "database_delete" },
    });

    check(response, { "bulk database deleted": (r) => r.status === 204 });
}

function exportDocs(database, operation) {
    return query(baseUrl, database, ".", { operation }, ndjson);
}

function checkCount(database, count) {
    const response = http.get(`${baseUrl}/db/${database}`, {
        tags: { operation: "database_info" },
    });

    check(response, {
        "database info returned": (r) => r.status === 200,
        "database count matches": (r) => r.status === 200 && r.json("doc_count") === count,
    });
}

function makeBody() {
    return expectedDocs().map((document) => JSON.stringify(document)).join("\n") + "\n";
}

function expectedDocs() {
    return Array.from({ length: documents }, (_, index) => ({
        group: index % 4,
        payload: payload(index),
        seed: index,
    }));
}

function payload(seed) {
    const token = seed.toString(16).padStart(8, "0");

    return token.repeat(Math.ceil(payloadBytes / token.length)).slice(0, payloadBytes);
}

function sameDocs(actual, expected) {
    const normalize = (values) => values
        .map((value) => JSON.stringify(value))
        .sort();
    const left = normalize(actual);
    const right = normalize(expected);

    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function header(response, name) {
    return response.headers[name] || response.headers[name.toLowerCase()] || "";
}
