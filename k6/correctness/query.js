import http from "k6/http";
import { check, fail } from "k6";
import { Counter } from "k6/metrics";
import exec from "k6/execution";

const baseUrl = __ENV.BASE_URL;
const vus = Number(__ENV.QUERY_VUS || 5);
const iterations = Number(__ENV.QUERY_ITERATIONS || 5);
const seedDocs = Number(__ENV.QUERY_SEED_DOCS || 100);
const pageSize = Number(__ENV.QUERY_PAGE_SIZE || 10);
const operators = ["eq", "lt", "le", "gt", "ge"];

for (const [name, value] of Object.entries({ vus, iterations, seedDocs, pageSize })) {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`QUERY_${name.toUpperCase()} must be a positive integer`);
    }
}
if (seedDocs > 1000 || pageSize > 1000) {
    throw new Error("query seed documents and page size must be at most 1000");
}
if (vus * iterations < operators.length) {
    throw new Error("QUERY_VUS * QUERY_ITERATIONS must cover every operator");
}

const completed = Object.fromEntries(
    ["index", "scan"].flatMap((plan) =>
        operators.map((operator) => [
            `${plan}_${operator}`,
            new Counter(`query_${plan}_${operator}`),
        ]),
    ),
);

export const options = {
    scenarios: {
        index: queryScenario("queryIndex"),
        scan: queryScenario("queryScan"),
        writes: queryScenario("mixedWrites"),
    },
    thresholds: {
        checks: ["rate==1"],
        http_req_failed: ["rate==0"],
        "http_req_duration{operation:index_query}": ["p(95)<500"],
        "http_req_duration{operation:scan_query}": ["p(95)<500"],
        ...Object.fromEntries(
            Object.keys(completed).map((name) => [`query_${name}`, ["count>0"]]),
        ),
    },
};

const jsonHeaders = { "Content-Type": "application/json" };

function queryScenario(exec) {
    return {
        executor: "per-vu-iterations",
        exec,
        vus,
        iterations,
        maxDuration: __ENV.QUERY_MAX_DURATION || "30s",
    };
}

export function setup() {
    if (!baseUrl) {
        fail("BASE_URL is required");
    }

    const database = `query-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    const createDatabase = http.post(
        `${baseUrl}/`,
        JSON.stringify({
            name: database,
            indexes: [{ name: "score", path: "/score" }],
        }),
        { headers: jsonHeaders, tags: { operation: "database_seed" } },
    );

    if (!check(createDatabase, { "query database created": (r) => r.status === 201 })) {
        fail(`database creation failed: ${createDatabase.status} ${createDatabase.body}`);
    }

    const entries = [];
    for (let index = 0; index < seedDocs; index += 1) {
        const score = Math.floor((seedDocs - index - 1) / 2) + 1;
        const prices = pricesFor(index, score);
        const document = { score, seed: index };

        if (prices !== null) {
            document.products = prices.map((price) => ({ price }));
        }

        const response = http.post(
            `${baseUrl}/${database}/`,
            JSON.stringify(document),
            { headers: jsonHeaders, tags: { operation: "document_seed" } },
        );
        const id = response.status === 201 ? response.json("id") : "";

        if (response.status !== 201 || typeof id !== "string") {
            fail(`document seed failed: ${response.status} ${response.body}`);
        }

        entries.push({ id, score, prices });
    }

    return {
        database,
        entries,
        maxScore: Math.max(...entries.map((entry) => entry.score)),
    };
}

export function queryIndex({ database, entries, maxScore }) {
    const { operator, boundary } = queryCase(maxScore);
    const expected = entries
        .filter((entry) => matches(entry.score, operator, boundary))
        .sort((left, right) => left.score - right.score || compare(left.id, right.id))
        .map((entry) => entry.id);
    const actual = queryAll(database, "$.score", operator, boundary, "index_query");

    check(actual, {
        "indexed QUERY returns every ordered ID": (ids) => same(ids, expected),
    });
    completed[`index_${operator}`].add(1);
}

export function queryScan({ database, entries, maxScore }) {
    const { operator, boundary } = queryCase(maxScore);
    const expected = entries
        .filter((entry) =>
            entry.prices?.some((price) =>
                typeof price === "number" && matches(price, operator, boundary),
            ),
        )
        .sort((left, right) => compare(left.id, right.id))
        .map((entry) => entry.id);
    const actual = queryAll(
        database,
        "$.products[*].price",
        operator,
        boundary,
        "scan_query",
    );

    check(actual, {
        "scan QUERY returns every ordered ID": (ids) => same(ids, expected),
    });
    completed[`scan_${operator}`].add(1);
}

// Exercise index maintenance while queries read the same database.
export function mixedWrites({ database }) {
    const create = http.post(
        `${baseUrl}/${database}/`,
        JSON.stringify({ score: "transient", owner: __VU, revision: 0 }),
        { headers: jsonHeaders, tags: { operation: "mixed_create" } },
    );
    const id = create.status === 201 ? create.json("id") : "";
    const createdEtag = create.headers.Etag;

    if (!check(create, { "mixed document created": (r) => r.status === 201 })) {
        return;
    }

    const replace = http.put(
        `${baseUrl}/${database}/${id}`,
        JSON.stringify({ score: "updated", owner: __VU, revision: 1 }),
        {
            headers: { ...jsonHeaders, "If-Match": createdEtag },
            tags: { operation: "mixed_replace" },
        },
    );
    const replacedEtag = replace.headers.Etag;

    if (!check(replace, { "mixed document replaced": (r) => r.status === 200 })) {
        return;
    }

    const patch = http.patch(
        `${baseUrl}/${database}/${id}`,
        JSON.stringify({ revision: 2 }),
        {
            headers: {
                "Content-Type": "application/merge-patch+json",
                "If-Match": replacedEtag,
            },
            tags: { operation: "mixed_patch" },
        },
    );
    const patchedEtag = patch.headers.Etag;

    if (!check(patch, {
        "mixed document patched": (r) =>
            r.status === 200 && r.json("revision") === 2,
    })) {
        return;
    }

    const remove = http.del(`${baseUrl}/${database}/${id}`, null, {
        headers: { "If-Match": patchedEtag },
        tags: { operation: "mixed_delete" },
    });
    check(remove, { "mixed document deleted": (r) => r.status === 204 });
}

function queryAll(database, path, operator, value, operation) {
    const documents = [];
    let cursor = "";
    let pages = 0;

    do {
        const body = { path, op: operator, value, limit: pageSize };

        if (cursor) {
            body.cursor = cursor;
        }

        const response = http.request(
            "QUERY",
            `${baseUrl}/${database}`,
            JSON.stringify(body),
            { headers: jsonHeaders, tags: { operation, operator } },
        );
        const ids = response.status === 200 ? response.json("documents") : null;
        const next = response.status === 200 ? response.json("cursor") : null;

        if (!check(response, {
            "QUERY page returned": (r) => r.status === 200,
            "QUERY page has documents": () => Array.isArray(ids),
            "QUERY page has cursor": () => typeof next === "string",
        })) {
            return documents;
        }

        documents.push(...ids);
        cursor = next;
        pages += 1;
    } while (cursor && pages <= seedDocs + 1);

    check(cursor, { "QUERY pagination terminates": (value) => value === "" });

    return documents;
}

function queryCase(maxScore) {
    const iteration = exec.scenario.iterationInTest;

    return {
        operator: operators[iteration % operators.length],
        boundary: 1 + ((iteration * 7) % maxScore),
    };
}

function pricesFor(index, score) {
    if (index % 10 === 0) {
        return null;
    }
    if (index % 10 === 1) {
        return [{ amount: score }];
    }

    return [score, score + 1];
}

function compare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

function matches(actual, operator, expected) {
    return {
        eq: actual === expected,
        lt: actual < expected,
        le: actual <= expected,
        gt: actual > expected,
        ge: actual >= expected,
    }[operator];
}

function same(actual, expected) {
    return actual.length === expected.length &&
        actual.every((value, index) => value === expected[index]);
}

export function teardown({ database }) {
    const response = http.del(`${baseUrl}/${database}`, null, {
        tags: { operation: "database_delete" },
    });

    check(response, { "query database deleted": (r) => r.status === 204 });
}
