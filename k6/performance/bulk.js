import http from "k6/http";
import { check, fail } from "k6";
import { Counter, Trend } from "k6/metrics";
import { ndjson, parseNDJSON, query } from "../query.js";

const baseUrl = __ENV.BASE_URL;
const vus = Number(__ENV.BULK_BENCHMARK_VUS || 1);
const iterations = Number(__ENV.BULK_BENCHMARK_ITERATIONS || 10);
const documents = Number(__ENV.BULK_BENCHMARK_DOCS || 1000);
const payloadBytes = Number(__ENV.BULK_BENCHMARK_PAYLOAD_BYTES || 1024);

for (const [name, value] of Object.entries({ vus, iterations, documents, payloadBytes })) {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`bulk benchmark ${name} must be a positive integer`);
    }
}
if (documents > 1000) {
    throw new Error("BULK_BENCHMARK_DOCS must be at most 1000");
}

const body = makeBody();
const bodyBytes = body.length;
if (bodyBytes > 64 * 1024 * 1024) {
    throw new Error("bulk benchmark body must be at most 64 MiB");
}

const importedBytes = new Counter("bulk_imported_bytes");
const exportedBytes = new Counter("bulk_exported_bytes");
const importedDocs = new Counter("bulk_imported_documents");
const exportedDocs = new Counter("bulk_exported_documents");
const importRate = new Trend("bulk_import_mib_per_second");
const exportRate = new Trend("bulk_export_mib_per_second");

export const options = {
    setupTimeout: __ENV.BULK_BENCHMARK_SETUP_TIMEOUT || "1m",
    teardownTimeout: "1m",
    summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max", "count"],
    scenarios: {
        bulk: {
            executor: "shared-iterations",
            vus,
            iterations,
            maxDuration: __ENV.BULK_BENCHMARK_MAX_DURATION || "5m",
        },
    },
    thresholds: {
        checks: ["rate==1"],
        http_req_failed: ["rate==0"],
        "http_req_duration{operation:bulk_import}": ["p(95)<10000"],
        "http_req_duration{operation:bulk_export,status:200}": ["p(95)<5000"],
        bulk_imported_documents: ["count>0"],
        bulk_exported_documents: ["count>0"],
    },
};

const jsonHeaders = { "Content-Type": "application/json" };
const bulkHeaders = { "Content-Type": "application/x-ndjson" };

export function setup() {
    if (!baseUrl) {
        fail("BASE_URL is required");
    }
}

export default function () {
    const database = `bulk-bench-${Date.now()}-${__VU}-${__ITER}`;
    const created = http.post(
        `${baseUrl}/db`,
        JSON.stringify({
            name: database,
            indices: [{ name: "category", path: "/category" }],
        }),
        {
            headers: jsonHeaders,
            tags: { operation: "database_create" },
        },
    );
    if (!check(created, { "benchmark database created": (r) => r.status === 201 })) {
        fail(`database creation failed: ${created.status} ${created.body}`);
    }

    const imported = http.post(`${baseUrl}/db/${database}`, body, {
        headers: bulkHeaders,
        tags: { name: "bulk_import", operation: "bulk_import" },
    });
    if (check(imported, {
        "bulk batch imported": (r) => r.status === 200,
        "bulk import succeeded": (r) => r.json("success") === true,
    })) {
        importedBytes.add(bodyBytes);
        importedDocs.add(documents);
        importRate.add(mibPerSecond(bodyBytes, imported.timings.duration));
    }

    const exported = query(baseUrl, database, ".", {
        name: "bulk_export", operation: "bulk_export",
    }, ndjson);
    const exportBytes = exported.status === 200 ? exported.body.length : 0;
    const rows = parseNDJSON(exported);
    const exportDocs = rows.length;
    const valueBytes = rows.reduce((sum, row) => sum + JSON.stringify(row.doc).length + 1, 0);
    if (check(exported, {
        "bulk batch exported": (r) => r.status === 200,
        "bulk export uses NDJSON": (r) => r.headers["Content-Type"] === ndjson,
        "bulk export byte count includes metadata": () => exportBytes > bodyBytes,
        "bulk export value byte count matches": () => valueBytes === bodyBytes,
        "bulk export document count matches": () => exportDocs === documents,
    })) {
        exportedBytes.add(exportBytes);
        exportedDocs.add(exportDocs);
        exportRate.add(mibPerSecond(exportBytes, exported.timings.duration));
    }

    const removed = http.del(`${baseUrl}/db/${database}`, null, {
        tags: { operation: "database_delete" },
    });
    check(removed, { "benchmark database deleted": (r) => r.status === 204 });
}

function makeBody() {
    const lines = [];
    for (let index = 0; index < documents; index += 1) {
        lines.push(JSON.stringify({
            category: index % 100,
            payload: payload(index),
            seed: index,
        }));
    }

    return lines.join("\n") + "\n";
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

function mibPerSecond(bytes, milliseconds) {
    if (milliseconds <= 0) {
        return 0;
    }

    return bytes / (1024 * 1024) / (milliseconds / 1000);
}
