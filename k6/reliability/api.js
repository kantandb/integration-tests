import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Counter } from "k6/metrics";

const base = __ENV.BASE_URL;
const phase = __ENV.TEST_PHASE;
const restart = `restart-${__ENV.TEST_RUN}`;
const json = { "Content-Type": "application/json" };
const ndjson = { "Content-Type": "application/x-ndjson" };
const plain = { "Content-Type": "text/plain" };
const completed = new Counter("reliability_completed");
const phases = ["limits", "batch", "timeout", "bulk", "query", "seed", "resumed", "updated"];

if (!base || !__ENV.TEST_RUN || !phases.includes(phase)) {
    throw new Error("Run through mise run reliability");
}

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: {
        checks: ["rate==1"],
        http_req_failed: ["rate==0"],
        reliability_completed: ["count==1"],
    },
};

export default async function () {
    if (["seed", "resumed", "updated"].includes(phase)) {
        restartState();
    } else {
        const path = `/db/reliability-${__ENV.TEST_RUN}-${phase}`;
        send("POST", "/db", { name: path.slice(4), indices: [{ name: "score", path: "/score" }] }, json, 201);
        try {
            if (phase === "limits") limits(path);
            if (phase === "batch" || phase === "timeout") rejectedImport(path);
            if (phase === "bulk") await bulk(path);
            if (phase === "query") await queries(path);
        } finally {
            send("DELETE", path, null, {}, 204);
        }
    }
    completed.add(1);
}

function limits(path) {
    // Small server limits exercise exact boundaries without large fixtures.
    const exact = JSON.stringify({ value: "x".repeat(256 - '{"value":""}'.length) });
    send("POST", path, exact, json, 201);
    const created = send("POST", path, exact, json, 201);
    const doc = `${path}/${created.json("id")}`;
    send("POST", path, exact + " ", json, 413, "content_too_large");
    send("PUT", doc, exact + " ", json, 413, "content_too_large");
    send("PATCH", doc, { extra: "x" }, { "Content-Type": "application/merge-patch+json" }, 413, "content_too_large");
    const read = send("GET", doc);
    check(read, { "oversized writes preserve body and ETag": (r) =>
        r.headers.Etag === created.headers.Etag && r.json("value") === JSON.parse(exact).value });
    send("POST", path, '{}\r\n{"value":1}', ndjson);
    send("POST", path, "{}\n".repeat(3), ndjson);
    const line = JSON.stringify({ value: "x".repeat(255 - '{"value":""}'.length) }) + "\n";
    send("POST", path, line.repeat(2), ndjson);
    const before = count(path);
    for (const [body, status, code, lineNumber] of [
        ["{}\n".repeat(4), 413, "content_too_large", 4],
        [line.repeat(2) + "{}\n", 413, "content_too_large", null],
        ["{}\n\n", 400, "invalid_document", 2],
        ["{}\n[]", 400, "invalid_document", 2],
    ]) {
        const result = send("POST", path, body, ndjson, status, code);
        check(result, { "failed batch reports its line and commits nothing": (r) =>
            r.json("success") === false && (!lineNumber || r.json("error.line") === lineNumber) && count(path) === before });
    }
}

function rejectedImport(path) {
    send("POST", path, { score: 1 }, json, 201);
    send("POST", path, '{"score":99}\n', ndjson,
        phase === "batch" ? 413 : 503, phase === "batch" ? "content_too_large" : "bulk_timeout");
    check(null, { "rejected import preserves nonempty database": () => count(path) === 1 &&
        send("QUERY", path, "select(.score == 99)", plain).json().length === 0 });
}

async function bulk(path) {
    // Real simultaneous imports exercise the single-slot limit.
    const body = (JSON.stringify({ score: 99, value: "x".repeat(16384) }) + "\n").repeat(1000);
    const responses = await Promise.all(Array.from({ length: 4 }, () =>
        http.asyncRequest("POST", `${base}${path}`, body, {
            headers: ndjson, responseCallback: http.expectedStatuses(200, 429), tags: { operation: "bulk_overlap" },
        })));
    const accepted = responses.filter((r) => r.status === 200).length;
    check(responses, {
        "bulk imports overlap": (rows) => accepted > 0 && rows.some((r) => r.status === 429),
        "bulk limit uses public error": (rows) => rows.every((r) => r.status === 200
            ? r.json("success") === true : r.status === 429 && r.json("error.code") === "bulk_limit"),
        "only accepted batches commit": () => count(path) === accepted * 1000,
    });

    const before = count(path);
    const canceled = http.post(`${base}${path}`, body, {
        headers: ndjson, timeout: "1ms", responseCallback: null, tags: { operation: "bulk_cancel" },
    });
    check(canceled, { "bulk request reaches client deadline": (r) => r.status === 0 && r.error_code === 1050 });

    // A small import must succeed after cancellation releases the slot.
    let recovered = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        const response = send("POST", path, "{}", ndjson, [200, 429]);
        if (response.status === 200) {
            recovered = true;
            break;
        }
        check(response, { "busy slot reports bulk_limit": (r) => r.json("error.code") === "bulk_limit" });
        sleep(0.02);
    }
    check(null, { "canceled import rolls back and releases capacity": () => recovered && count(path) === before + 1 });
}

async function queries(path) {
    send("POST", path, {}, json, 201);
    send("QUERY", path, "." + " ".repeat(65535), plain);
    send("QUERY", path, "." + " ".repeat(65536), plain, 413, "content_too_large");
    send("QUERY", path, '"x" * 8388608', plain, 503, "query_limit");
    const streamed = send("QUERY", path, '"x" * 8388608', { ...plain, Accept: "application/x-ndjson" });
    check(streamed, { "NDJSON exceeds JSON output limit": (r) => JSON.parse(r.body).doc.length === 8388608 });
    send("QUERY", path, "def loop: loop; loop", plain, 503, "query_timeout");

    // The bounded query must finish before the long stream's client deadline.
    const slow = http.asyncRequest("QUERY", `${base}${path}`, "1, (def loop: loop; loop)", {
        headers: { ...plain, Accept: "application/x-ndjson" }, timeout: "2s",
        responseCallback: null, tags: { operation: "query_cancel" },
    });
    sleep(0.05);
    const fast = http.asyncRequest("QUERY", `${base}${path}`, "2", {
        headers: plain, responseCallback: http.expectedStatuses(200), tags: { operation: "query_overlap" },
    });
    const first = await Promise.race([slow, fast]);
    const [canceled, response] = await Promise.all([slow, fast]);
    check(response, { "queries run concurrently": (r) => first === r && r.status === 200 && r.json()[0].doc === 2 });
    check(canceled, { "stream is canceled by client deadline": (r) => r.error_code === 1050 });
    const recovered = send("QUERY", path, ".", plain);
    check(recovered, { "query service recovers after cancellation": (r) => r.json().length === 1 &&
        Object.keys(r.json()[0].doc).length === 0 });
}

function restartState() {
    const path = `/db/${restart}`;
    const proof = `${path}-proof`;
    if (phase === "seed") {
        send("POST", "/db", { name: restart, indices: [{ name: "score", path: "/score" }] }, json, 201);
        send("POST", "/db", { name: `${restart}-proof` }, json, 201);
        const first = send("POST", path, { score: 7 }, json, 201);
        const second = send("POST", path, { score: 8 }, json, 201);
        const page = send("QUERY", path, ".", { ...plain, Limit: "1" });
        check(page, { "restart fixture has a cursor": (r) => !!r.headers.Cursor });
        send("POST", proof, { first: first.json("id"), rev: first.headers.Etag,
            second: second.json("id"), cursor: page.headers.Cursor }, json, 201);
        return;
    }

    // Keep the accepted revisions and cursor in API storage between k6 runs.
    const receipt = send("QUERY", proof, ".", plain).json()[0];
    const saved = receipt.doc;
    if (phase === "resumed") {
        const read = send("GET", `${path}/${saved.first}`);
        check(read, { "restart preserves body and ETag": (r) => r.json("score") === 7 && r.headers.Etag === saved.rev });
        const page = send("QUERY", path, ".", { ...plain, Cursor: saved.cursor });
        check(page, { "cursor resumes after restart": (r) => r.json().length === 1 && r.json()[0].id === saved.second && !r.headers.Cursor });
        const indexed = send("QUERY", path, "select(.score == 7)", plain);
        check(indexed, { "restart preserves index": (r) => r.json().length === 1 && r.json()[0].id === saved.first });
        const changed = send("PATCH", `${path}/${saved.first}`, { score: 9 }, {
            "Content-Type": "application/merge-patch+json", "If-Match": saved.rev,
        });
        send("DELETE", `${path}/${saved.second}`, null, {}, 204);
        send("PUT", `${proof}/${receipt.id}`, { ...saved, rev: changed.headers.Etag }, json);
        return;
    }

    check(null, { "deletion survives restart": () => count(path) === 1 });
    send("GET", `${path}/${saved.second}`, null, {}, 404, "document_not_found");
    const old = send("QUERY", path, "select(.score == 7)", plain);
    const updated = send("QUERY", path, "select(.score == 9)", plain);
    check(updated, { "updated index and revision survive restart": (r) => old.json().length === 0 &&
        r.json().length === 1 && r.json()[0].id === saved.first && r.json()[0].rev === saved.rev });
    send("DELETE", path, null, {}, 204);
    send("DELETE", proof, null, {}, 204);
}

function count(path) {
    return send("GET", path).json("doc_count");
}

function send(method, path, body = null, headers = {}, status = 200, code) {
    const statuses = Array.isArray(status) ? status : [status];
    const response = http.request(method, `${base}${path}`,
        body === null || typeof body === "string" ? body : JSON.stringify(body), {
            headers, responseCallback: http.expectedStatuses(...statuses), tags: { operation: `reliability_${phase}` },
        });
    if (!check(response, { [`${method} ${code || statuses.join("/")}`]: (r) =>
        statuses.includes(r.status) && (!code || r.json("error.code") === code) })) {
        fail(`${method} ${path}: ${response.status} ${response.body}`);
    }
    return response;
}
