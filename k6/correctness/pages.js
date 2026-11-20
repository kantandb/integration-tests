import http from "k6/http";
import { check, fail } from "k6";
import { Counter } from "k6/metrics";
import { query } from "../query.js";

const base = __ENV.BASE_URL;
const json = { "Content-Type": "application/json" };
const completed = new Counter("pages_completed");

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: { checks: ["rate==1"], http_req_failed: ["rate==0"], pages_completed: ["count==1"] },
};

export function setup() {
    if (!base) fail("BASE_URL is required");
    const database = `pages-${Date.now()}`;
    for (const name of [database, `${database}-other`]) {
        const response = http.post(`${base}/db`, JSON.stringify({ name,
            indices: [{ name: "score", path: "/score" }, { name: "name", path: "/name" }] }),
        { headers: json, tags: { operation: "page_seed" } });
        if (response.status !== 201) fail("database creation failed");
    }
    const docs = Array.from({ length: 103 }, (_, seed) => ({
        score: Math.floor((102 - seed) / 3), seed, name: ["Anne", "Bob", "Alice", "Zoe"][seed % 4],
    }));
    const response = http.post(`${base}/db/${database}`, docs.map((doc) => JSON.stringify(doc)).join("\n"),
        { headers: { "Content-Type": "application/x-ndjson" }, tags: { operation: "page_seed" } });
    if (response.status !== 200) fail("document seed failed");
    return { database };
}

export default function ({ database }) {
    // Concatenated pages must match a complete query on unchanged data.
    for (const program of [".", ".score", "[.name, .score]", "{name: .name}",
        "select(.score >= 30) | .seed", "select(.seed == 102)", "select(.score < 0)"]) {
        const full = run(database, program);
        const expected = JSON.parse(full.body);
        check(full, { "unpaginated query has no cursor": (r) => !r.headers.Cursor });
        for (const limit of [2, 7, 1000]) {
            let cursor;
            const actual = [];
            for (let page = 0; page < 104; page += 1) {
                const response = run(database, program, { Limit: String(limit), ...(cursor ? { Cursor: cursor } : {}) });
                if (response.status !== 200) break;
                const rows = JSON.parse(response.body);
                cursor = response.headers.Cursor;
                check(response, { "page respects limit and lookahead": () => rows.length <= limit &&
                    (!cursor || rows.length === limit) });
                actual.push(...rows);
                if (!cursor) break;
            }
            check(actual, { "pages preserve every ordered wrapper": () => !cursor &&
                JSON.stringify(actual) === JSON.stringify(expected) });
        }
    }
    // Check planner predicates against independently generated fixture values.
    const fixtures = Array.from({ length: 103 }, (_, seed) => ({
        seed, score: Math.floor((102 - seed) / 3), name: ["Anne", "Bob", "Alice", "Zoe"][seed % 4],
    }));
    for (const [program, matches] of [
        ["select(.score >= 2 and .score <= 4)", (doc) => doc.score >= 2 && doc.score <= 4],
        ["select(.score <= 3 or .score == 3)", (doc) => doc.score <= 3],
        ["select(.score | IN(1, 3))", (doc) => doc.score === 1 || doc.score === 3],
        ['select(.name | startswith("A"))', (doc) => doc.name.startsWith("A")],
        ['select(.name | endswith("e"))', (doc) => doc.name.endsWith("e")],
        ['select(.name | contains("li"))', (doc) => doc.name.includes("li")],
        ['select(.name | test("^A.*e$"))', (doc) => /^A.*e$/.test(doc.name)],
        ["(select(.score >= 2 and .score <= 4))", (doc) => doc.score >= 2 && doc.score <= 4],
    ]) {
        const rows = JSON.parse(run(database, program).body);
        const actual = rows.map((row) => row.doc.seed).sort((a, b) => a - b);
        const expected = fixtures.filter(matches).map((doc) => doc.seed);
        check(rows, { "planner returns exactly the matching set without duplicates": () =>
            JSON.stringify(actual) === JSON.stringify(expected) && new Set(rows.map((row) => row.id)).size === rows.length });
    }
    const full = JSON.parse(run(database, "select(.score >= 0)").body);
    check(full, { "index orders ties by ID": (rows) => rows.length === 103 && rows.every((row, i) =>
        i === 0 || rows[i - 1].doc.score < row.doc.score ||
        (rows[i - 1].doc.score === row.doc.score && rows[i - 1].id < row.id)) });

    const first = run(database, ".", { Limit: "1" });
    const cursor = first.headers.Cursor;
    const next = run(database, ".", { Cursor: cursor });
    check(next, { "cursor-only query defaults to 100": (r) => r.json().length === 100 && !!r.headers.Cursor });
    const last = run(database, ".", { Limit: "3", Cursor: next.headers.Cursor });
    check(last, { "changed limit returns final two rows": (r) => r.json().length === 2 && !r.headers.Cursor });

    for (const [target, program, token] of [
        [database, ". ", cursor], [`${database}-other`, ".", cursor], [database, ".", `${cursor}x`],
    ]) run(target, program, { Cursor: token }, "invalid_cursor");
    for (const program of ["inputs", ".score, .name", ".name[]", "def f: .; f",
        "select(.score == 1 or .score == 2)", "select(.score | IN(1, 2))"]) {
        run(database, program, { Limit: "1" }, "query_not_pageable");
    }

    // Seeking past deleted keys works for primary and secondary scans.
    for (const program of [".", "select(.score >= 0)"]) {
        const before = JSON.parse(run(database, program).body);
        const page = run(database, program, { Limit: "1" });
        const id = page.json()[0].id;
        const removed = http.del(`${base}/db/${database}/${id}`, null, { tags: { operation: "page_delete" } });
        check(removed, { "cursor document deleted": (r) => r.status === 204 });
        const resumed = run(database, program, { Cursor: page.headers.Cursor, Limit: "1000" });
        check(resumed, { "deleted cursor resumes strictly after key": (r) =>
            JSON.stringify(JSON.parse(r.body)) === JSON.stringify(before.slice(1)) && !r.headers.Cursor });
    }
    // Database lists default to 100 and resume past a deleted name.
    const names = Array.from({ length: 101 }, (_, i) => `${database}-list-${String(i).padStart(3, "0")}`);
    try {
        for (const name of names) {
            const response = http.post(`${base}/db`, JSON.stringify({ name }),
                { headers: json, tags: { operation: "database_page_seed" } });
            if (!check(response, { "list fixture created": (r) => r.status === 201 })) fail("list seed failed");
        }
        const listed = http.get(`${base}/db`, { tags: { operation: "database_page" } });
        const all = http.get(`${base}/db`, { headers: { Limit: "1000" }, tags: { operation: "database_page" } });
        const expected = all.json("databases");
        check(listed, { "database default limit is 100": (r) => r.status === 200 &&
            r.json("databases").length === 100 && r.headers.Cursor === expected[99] });
        check(all, { "large database page returns complete sorted list": (r) => r.status === 200 &&
            expected.length === 103 && !r.headers.Cursor &&
            expected.every((name, i) => i === 0 || expected[i - 1] < name) });
        const removed = http.del(`${base}/db/${listed.headers.Cursor}`, null,
            { tags: { operation: "database_page_delete" } });
        check(removed, { "database cursor deleted": (r) => r.status === 204 });
        const resumed = http.get(`${base}/db`, {
            headers: { Cursor: listed.headers.Cursor }, tags: { operation: "database_page" },
        });
        check(resumed, { "database cursor seeks past deleted name": (r) => r.status === 200 &&
            JSON.stringify(r.json("databases")) === JSON.stringify(expected.slice(100)) && !r.headers.Cursor });
        names.splice(names.indexOf(listed.headers.Cursor), 1);
    } finally {
        for (const name of names) {
            const response = http.del(`${base}/db/${name}`, null, { tags: { operation: "database_page_cleanup" } });
            check(response, { "list fixture deleted": (r) => r.status === 204 });
        }
    }

    const removed = http.del(`${base}/db/${database}`, null, { tags: { operation: "page_recreate" } });
    check(removed, { "cursor database deleted": (r) => r.status === 204 });
    const created = http.post(`${base}/db`, JSON.stringify({ name: database }),
        { headers: json, tags: { operation: "page_recreate" } });
    check(created, { "cursor database recreated": (r) => r.status === 201 });
    run(database, ".", { Cursor: cursor }, "invalid_cursor");
    completed.add(1);
}

function run(database, program, headers = {}, code) {
    const response = code
        ? http.request("QUERY", `${base}/db/${database}`, program, {
            headers: { "Content-Type": "text/plain", ...headers },
            responseCallback: http.expectedStatuses(400), tags: { operation: "page_rejection" },
        })
        : query(base, database, program, { operation: "page_query" }, "application/json", headers);
    check(response, { [code || "page query succeeded"]: (r) => code
        ? r.status === 400 && r.json("error.code") === code && !r.headers.Cursor : r.status === 200 });
    return response;
}

export function teardown({ database }) {
    for (const name of [database, `${database}-other`]) {
        const response = http.del(`${base}/db/${name}`, null, { tags: { operation: "page_cleanup" } });
        check(response, { "page database deleted": (r) => r.status === 204 });
    }
}
