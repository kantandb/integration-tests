import http from "k6/http";
import { check, fail } from "k6";
import { Counter } from "k6/metrics";

const baseUrl = __ENV.BASE_URL;
const vus = Number(__ENV.RANGE_VUS || 4);
const iterations = Number(__ENV.RANGE_ITERATIONS || 4);
const seedDocs = Number(__ENV.RANGE_SEED_DOCS || 100);
const pageSize = Number(__ENV.RANGE_PAGE_SIZE || 10);
const operators = ["lt", "le", "gt", "ge"];

for (const [name, value] of Object.entries({ vus, iterations, seedDocs, pageSize })) {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`RANGE_${name.toUpperCase()} must be a positive integer`);
    }
}
if (seedDocs > 1000 || pageSize > 1000) {
    throw new Error("range seed documents and page size must be at most 1000");
}

const completed = Object.fromEntries(
    operators.map((operator) => [operator, new Counter(`range_${operator}`)]),
);

export const options = {
    scenarios: {
        range: {
            executor: "per-vu-iterations",
            vus,
            iterations,
            maxDuration: __ENV.RANGE_MAX_DURATION || "30s",
        },
    },
    thresholds: {
        checks: ["rate==1"],
        http_req_failed: ["rate==0"],
        "http_req_duration{operation:range_query}": ["p(95)<500"],
        range_lt: ["count>0"],
        range_le: ["count>0"],
        range_gt: ["count>0"],
        range_ge: ["count>0"],
    },
};

const jsonHeaders = { "Content-Type": "application/json" };

export function setup() {
    if (!baseUrl) {
        fail("BASE_URL is required");
    }

    const database = `range-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    const createDatabase = http.post(
        `${baseUrl}/`,
        JSON.stringify({
            name: database,
            indexes: [{ name: "score", path: "/score" }],
        }),
        { headers: jsonHeaders, tags: { operation: "database_seed" } },
    );

    if (!check(createDatabase, { "range database created": (r) => r.status === 201 })) {
        fail(`database creation failed: ${createDatabase.status} ${createDatabase.body}`);
    }

    const entries = [];
    for (let index = 0; index < seedDocs; index += 1) {
        // Reverse values relative to creation order and duplicate each value.
        const score = Math.floor((seedDocs - index - 1) / 2) + 1;
        const response = http.post(
            `${baseUrl}/${database}/`,
            JSON.stringify({ score, seed: index }),
            { headers: jsonHeaders, tags: { operation: "document_seed" } },
        );
        const id = response.status === 201 ? response.json("id") : "";

        if (response.status !== 201 || typeof id !== "string") {
            fail(`document seed failed: ${response.status} ${response.body}`);
        }

        entries.push({ id, score });
    }

    entries.sort((left, right) => left.score - right.score || compare(left.id, right.id));

    return { database, entries, maxScore: entries[entries.length - 1].score };
}

export default function ({ database, entries, maxScore }) {
    const operator = operators[(__VU + __ITER - 1) % operators.length];
    const boundary = 1 + ((__VU + __ITER) % maxScore);
    const expected = entries.filter((entry) => matches(entry.score, operator, boundary));
    const actual = [];
    let cursor = "";
    let pages = 0;

    do {
        const query = `index=score&op=${operator}&value=${boundary}&limit=${pageSize}`;
        const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const response = http.get(`${baseUrl}/${database}?${query}${cursorQuery}`, {
            tags: { operation: "range_query", operator },
        });
        const documents = response.status === 200 ? response.json("documents") : null;
        const nextCursor = response.status === 200 ? response.json("cursor") : null;

        if (!check(response, {
            "range page returned": (r) => r.status === 200,
            "range page has documents": () => Array.isArray(documents),
            "range page has cursor": () => typeof nextCursor === "string",
        })) {
            return;
        }

        actual.push(...documents);
        cursor = nextCursor;
        pages += 1;
    } while (cursor && pages <= Math.ceil(expected.length / pageSize));

    check(actual, {
        "range query terminates": () => cursor === "",
        "range query returns every ordered ID": () => same(actual, expected.map((entry) => entry.id)),
    });
    completed[operator].add(1);
}

export function teardown({ database }) {
    const response = http.del(`${baseUrl}/${database}`, null, {
        tags: { operation: "database_delete" },
    });

    check(response, { "range database deleted": (r) => r.status === 204 });
}

function compare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

function matches(score, operator, boundary) {
    return {
        lt: score < boundary,
        le: score <= boundary,
        gt: score > boundary,
        ge: score >= boundary,
    }[operator];
}

function same(actual, expected) {
    return actual.length === expected.length &&
        actual.every((value, index) => value === expected[index]);
}
