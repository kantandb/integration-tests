import http from "k6/http";
import { check, fail } from "k6";
import { Counter } from "k6/metrics";
import exec from "k6/execution";
import { ndjson, parseNDJSON, query } from "../query.js";

const baseUrl = __ENV.BASE_URL;
const vus = Number(__ENV.QUERY_VUS || 5);
const iterations = Number(__ENV.QUERY_ITERATIONS || 5);
const seedDocs = Number(__ENV.QUERY_SEED_DOCS || 100);
const comparisons = { eq: "==", lt: "<", le: "<=", gt: ">", ge: ">=" };
const operators = Object.keys(comparisons);

for (const [name, value] of Object.entries({ vus, iterations, seedDocs })) {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`QUERY_${name.toUpperCase()} must be a positive integer`);
    }
}
if (seedDocs > 1000) {
    throw new Error("QUERY_SEED_DOCS must be at most 1000");
}
if (vus * iterations < operators.length) {
    throw new Error("QUERY_VUS * QUERY_ITERATIONS must cover every operator");
}

const completed = Object.fromEntries(
    ["numeric", "nested"].flatMap((plan) =>
        operators.map((operator) => [
            `${plan}_${operator}`,
            new Counter(`query_${plan}_${operator}`),
        ]),
    ),
);

export const options = {
    scenarios: {
        numeric: queryScenario("queryNumeric"),
        nested: queryScenario("queryNested"),
        writes: queryScenario("mixedWrites"),
    },
    thresholds: {
        checks: ["rate==1"],
        http_req_failed: ["rate==0"],
        "http_req_duration{operation:numeric_query,status:200}": ["p(95)<500"],
        "http_req_duration{operation:nested_query,status:200}": ["p(95)<500"],
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
        `${baseUrl}/db`,
        JSON.stringify({
            name: database,
            indices: [{ name: "score", path: "/score" }],
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
            `${baseUrl}/db/${database}`,
            JSON.stringify(document),
            { headers: jsonHeaders, tags: { operation: "document_seed" } },
        );
        const id = response.status === 201 ? response.json("id") : "";

        if (response.status !== 201 || typeof id !== "string") {
            fail(`document seed failed: ${response.status} ${response.body}`);
        }

        entries.push({ id, rev: response.headers.Etag, score, prices, seed: index });
    }

    return {
        database,
        entries,
        maxScore: Math.max(...entries.map((entry) => entry.score)),
    };
}

export function queryNumeric({ database, entries, maxScore }) {
    const { operator, boundary } = queryCase(maxScore);
    const expected = entries.filter((entry) => matches(entry.score, operator, boundary));
    const program = `select(.score | numbers | . ${comparisons[operator]} ${boundary}) | .seed`;
    const response = query(baseUrl, database, program, { operation: "numeric_query", operator });

    checkResult(response, response.status === 200 ? response.json() : null, expected, "numeric", operator);
}

export function queryNested({ database, entries, maxScore }) {
    const { operator, boundary } = queryCase(maxScore);
    const expected = entries.filter((entry) =>
        entry.prices?.some((price) =>
            typeof price === "number" && matches(price, operator, boundary),
        ),
    );
    const program = `select(any(.products[]?.price | numbers; . ${comparisons[operator]} ${boundary})) | .seed`;
    const response = query(baseUrl, database, program, { operation: "nested_query", operator }, ndjson);

    check(response, {
        "nested QUERY uses NDJSON": (r) => r.headers["Content-Type"] === ndjson,
    });
    checkResult(response, parseNDJSON(response), expected, "nested", operator);
}

// Exercise index maintenance while queries read the same database.
export function mixedWrites({ database }) {
    const create = http.post(
        `${baseUrl}/db/${database}`,
        JSON.stringify({ score: "transient", owner: __VU, revision: 0 }),
        { headers: jsonHeaders, tags: { operation: "mixed_create" } },
    );
    const id = create.status === 201 ? create.json("id") : "";
    const createdEtag = create.headers.Etag;

    if (!check(create, { "mixed document created": (r) => r.status === 201 })) {
        return;
    }

    const replace = http.put(
        `${baseUrl}/db/${database}/${id}`,
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
        `${baseUrl}/db/${database}/${id}`,
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

    const remove = http.del(`${baseUrl}/db/${database}/${id}`, null, {
        headers: { "If-Match": patchedEtag },
        tags: { operation: "mixed_delete" },
    });
    check(remove, { "mixed document deleted": (r) => r.status === 204 });
}

function checkResult(response, actual, expected, kind, operator) {
    const ordered = expected.sort((left, right) => compare(left.id, right.id));
    const seeds = ordered.map((entry) => entry.seed);

    if (check(response, {
        [`${kind} QUERY succeeded`]: (r) => r.status === 200,
        [`${kind} QUERY returned ordered results`]: () => Array.isArray(actual) && same(actual.map((row) => row.doc), seeds) &&
            actual.every((row, index) => row.id === ordered[index].id && row.rev === ordered[index].rev),
    })) {
        completed[`${kind}_${operator}`].add(1);
    }
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
    const response = http.del(`${baseUrl}/db/${database}`, null, {
        tags: { operation: "database_delete" },
    });

    check(response, { "query database deleted": (r) => r.status === 204 });
}
