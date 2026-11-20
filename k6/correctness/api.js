import http from "k6/http";
import { check, fail } from "k6";
import { Counter } from "k6/metrics";

const base = __ENV.BASE_URL;
const json = { "Content-Type": "application/json" };
const merge = { "Content-Type": "application/merge-patch+json" };
const patch = { "Content-Type": "application/json-patch+json" };

const completed = new Counter("api_completed");

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: { checks: ["rate==1"], http_req_failed: ["rate==0"], api_completed: ["count==1"] },
};

export function setup() {
    if (!base) fail("BASE_URL is required");
    const database = `api-${Date.now()}`;
    send("POST", "/db", { name: database, indices: [{ name: "score", path: "/score" }] }, json, 201);
    send("POST", "/db", { name: `${database}-other` }, json, 201);
    const other = create(`/db/${database}-other`, { score: 3 });
    return { database, other };
}

export default function ({ database, other }) {
    const path = `/db/${database}`;

    // Validate database definitions without leaving partial databases behind.
    send("POST", "/db", { name: database }, json, 409, "database_exists");
    for (const name of ["", "Bad", "a".repeat(64)]) {
        send("POST", "/db", { name }, json, 400, "invalid_name");
    }
    const boundary = database.padEnd(63, "x");
    send("POST", "/db", { name: boundary, indices: Array.from({ length: 16 },
        (_, i) => ({ name: `i${i}`, path: `/v${i}` })) }, json, 201);
    send("DELETE", `/db/${boundary}`, null, {}, 204);
    const invalid = `${database}-invalid`;
    for (const fields of [
        { extra: true }, { indices: {} },
        { indices: [{ name: "Bad", path: "/score" }] },
        { indices: [{ name: "score", path: "score" }] },
        { indices: [{ name: "score", path: "/bad~2" }] },
        { indices: [{ name: "score", path: "/score", extra: true }] },
        { indices: [{ name: "same", path: "/a" }, { name: "same", path: "/b" }] },
        { indices: Array.from({ length: 17 }, (_, i) => ({ name: `i${i}`, path: `/v${i}` })) },
    ]) {
        send("POST", "/db", { name: invalid, ...fields }, json, 400, "invalid_request");
        send("GET", `/db/${invalid}`, null, {}, 404, "database_not_found");
    }
    for (const body of ['{"name":', '[]', `{"name":"${invalid}"}{}`]) {
        send("POST", "/db", body, json, 400, "invalid_request");
    }

    // Every mutation rejects bad conditions without changing records or indexes.
    for (const [method, headers, body] of [
        ["PUT", json, { score: 2 }],
        ["PATCH", merge, { score: 2 }],
        ["PATCH", patch, [{ op: "replace", path: "/score", value: 2 }]],
        ["DELETE", {}, null],
    ]) {
        const created = create(path, { score: 1 });
        const docPath = `${path}/${created.id}`;
        const updated = send("PUT", docPath, { score: 3 }, json);
        const rev = updated.headers.Etag;
        for (const condition of ["bad", `W/${rev}`, `${rev}, ${rev}`]) {
            send(method, docPath, body, { ...headers, "If-Match": condition }, 400, "invalid_if_match");
            unchanged(path, created.id, rev, 3);
        }
        send(method, docPath, body, { ...headers, "If-Match": created.rev }, 412, "precondition_failed");
        unchanged(path, created.id, rev, 3);
        send("DELETE", docPath, null, { "If-Match": rev }, 204);

        for (const condition of [null, "*", "current"]) {
            const doc = create(path, { score: 1 });
            const match = condition === "current" ? doc.rev : condition;
            const result = send(method, `${path}/${doc.id}`, body,
                match === null ? headers : { ...headers, "If-Match": match }, method === "DELETE" ? 204 : 200);
            if (method === "DELETE") {
                send("GET", `${path}/${doc.id}`, null, {}, 404, "document_not_found");
            } else {
                check(result, { "successful mutation changes revision": (r) => r.headers.Etag !== doc.rev });
                unchanged(path, doc.id, result.headers.Etag, 2);
                send("DELETE", `${path}/${doc.id}`, null, {}, 204);
            }
            send(method, `${path}/${doc.id}`, body, { ...headers, "If-Match": "*" }, 404, "document_not_found");
        }
    }

    // Rejected documents and patches preserve the previous body and revision.
    const doc = create(path, { score: 3, nested: { a: 1 }, remove: true });
    const docPath = `${path}/${doc.id}`;
    for (const body of ["[]", "null", "42", '{"score":', "{}{}"] ) {
        send("POST", path, body, json, 400, "invalid_document");
        send("PUT", docPath, body, json, 400, "invalid_document");
        unchanged(path, doc.id, doc.rev, 3);
    }
    for (const method of ["POST", "PUT", "PATCH"]) {
        send(method, method === "POST" ? path : docPath, "{}",
            { "Content-Type": "text/plain" }, 415, "unsupported_media_type");
    }
    for (const [headers, body] of [
        [merge, "null"], [merge, '{"score":'],
        [patch, [{ op: "replace", path: "/score", value: 9 }, { op: "remove", path: "/missing" }]],
        [patch, [{ op: "test", path: "/score", value: 9 }]],
        [patch, [{ op: "replace", path: "", value: [] }]],
    ]) {
        send("PATCH", docPath, body, headers, 400, "invalid_patch");
        unchanged(path, doc.id, doc.rev, 3);
        const read = send("GET", docPath);
        check(read, { "failed patch preserves other fields": (r) => r.json("nested.a") === 1 && r.json("remove") === true });
    }
    const large = { score: "x".repeat(4096) };
    send("POST", path, large, json, 400, "invalid_document");
    send("PUT", docPath, large, json, 400, "invalid_document");
    send("PATCH", docPath, large, merge, 400, "invalid_patch");
    unchanged(path, doc.id, doc.rev, 3);

    const merged = send("PATCH", docPath, { nested: { b: 2 }, remove: null }, merge);
    check(merged, { "merge patch removes and merges": (r) => r.json("nested.a") === 1 &&
        r.json("nested.b") === 2 && !("remove" in r.json()) });
    const patched = send("PATCH", docPath, [
        { op: "test", path: "/score", value: 3 },
        { op: "copy", from: "/nested/a", path: "/copied" },
        { op: "move", from: "/nested/b", path: "/moved" },
        { op: "remove", path: "/nested/a" },
        { op: "add", path: "/items", value: [1, 2] },
        { op: "replace", path: "/score", value: 4 },
    ], { ...patch, "If-Match": merged.headers.Etag });
    check(patched, { "JSON patch applies all operations": (r) => r.json("copied") === 1 &&
        r.json("moved") === 2 && Object.keys(r.json("nested")).length === 0 && r.json("items.1") === 2 });
    unchanged(path, doc.id, patched.headers.Etag, 4);
    indexRows(path, 3, []);
    send("DELETE", docPath, null, {}, 204);
    indexRows(path, 4, []);
    const info = send("GET", path);
    check(info, { "mutations preserve exact document count": (r) => r.json("doc_count") === 0 });

    // Type changes must add an index entry even when the previous value was not indexed.
    for (const body of [{}, { score: null }, { score: [] }, { score: {} }, { score: false }, { score: "text" }]) {
        const typed = create(path, body);
        const result = send("PUT", `${path}/${typed.id}`, { score: 3 }, json);
        unchanged(path, typed.id, result.headers.Etag, 3);
        for (const literal of ["false", '"text"']) {
            const old = send("QUERY", path, `select(.score == ${literal})`, { "Content-Type": "text/plain" });
            check(old, { "type change removes previous scalar entry": (r) => r.json().length === 0 });
        }
        send("DELETE", `${path}/${typed.id}`, null, {}, 204);
    }

    // Same-name recreation must not inherit documents or old index definitions.
    send("DELETE", path, null, {}, 204);
    send("DELETE", path, null, {}, 404, "database_not_found");
    send("POST", "/db", { name: database }, json, 201);
    const recreated = send("GET", path);
    check(recreated, { "recreation starts empty": (r) => r.json("doc_count") === 0 && r.json("indices").length === 0 });
    unchanged(`/db/${database}-other`, other.id, other.rev, 3);
    completed.add(1);
}

function create(path, body) {
    const response = send("POST", path, body, json, 201);
    if (response.status !== 201) fail("document creation failed");
    return { id: response.json("id"), rev: response.headers.Etag };
}

function unchanged(path, id, rev, score) {
    const read = send("GET", `${path}/${id}`);
    check(read, { "body and revision match committed state": (r) => r.json("score") === score && r.headers.Etag === rev });
    indexRows(path, score, [id], rev);
}

function indexRows(path, score, ids, rev) {
    const result = send("QUERY", path, `select(.score == ${score})`, { "Content-Type": "text/plain" });
    check(result, { "index matches committed state": (r) => r.json().length === ids.length &&
        r.json().every((row, i) => row.id === ids[i] && row.rev === rev && row.doc.score === score) });
}

function send(method, path, body = null, headers = {}, status = 200, code) {
    const response = http.request(method, `${base}${path}`,
        body === null || typeof body === "string" ? body : JSON.stringify(body), {
            headers, responseCallback: http.expectedStatuses(status), tags: { operation: "api_contract" },
        });
    check(response, {
        [`${method} returns ${status}${code ? ` ${code}` : ""}`]: (r) => r.status === status &&
            (!code || r.json("error.code") === code),
    });
    return response;
}

export function teardown({ database }) {
    send("DELETE", `/db/${database}`, null, {}, 204);
    send("DELETE", `/db/${database}-other`, null, {}, 204);
}
