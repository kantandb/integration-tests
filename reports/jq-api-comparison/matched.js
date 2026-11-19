import http from 'k6/http';
import { check, fail } from 'k6';
import exec from 'k6/execution';

const base = __ENV.BASE_URL;
const old = __ENV.KANTAN_BENCH_SIDE === 'old';
const rate = 5;
const duration = '15s';
const operation = ['list', 'indexed_eq', 'nested_eq'];
const headers = { 'Content-Type': 'application/json' };

export const options = {
    setupTimeout: '3m',
    summaryTrendStats: ['med', 'p(95)', 'count'],
    scenarios: Object.fromEntries(operation.map((name, i) => [name, {
        executor: 'constant-arrival-rate',
        rate,
        timeUnit: '1s',
        duration,
        startTime: `${i * 17}s`,
        preAllocatedVUs: 1,
        maxVUs: 1,
        gracefulStop: '1s',
    }])),
    thresholds: {
        checks: ['rate==1'],
        dropped_iterations: ['count==0'],
        http_req_failed: ['rate==0'],
        ...Object.fromEntries(operation.map((name) => [
            `http_req_duration{operation:${name}}`, ['p(95)<1000'],
        ])),
    },
};

function doc(seed) {
    const group = seed % 100;
    const payload = Array.from({ length: 128 }, (_, i) =>
        (Math.imul(seed + i * 17 + 1, 0x9e3779b1) >>> 0).toString(16).padStart(8, '0'),
    ).join('');
    return { category: group, payload, products: [{ price: group }], seed };
}

function seed(name, size) {
    const created = http.post(`${base}/db`, JSON.stringify({
        name, indices: [{ name: 'category', path: '/category' }],
    }), { headers });
    if (created.status !== 201) fail(`create ${name}: ${created.status} ${created.body}`);

    for (let start = 0; start < size; start += 1000) {
        const docs = Array.from({ length: Math.min(size - start, 1000) }, (_, i) =>
            JSON.stringify(doc(start + i)),
        ).join('\n') + '\n';
        const r = http.post(`${base}/${old ? 'bulk' : 'db'}/${name}`, docs, {
            headers: { 'Content-Type': 'application/x-ndjson' },
        });
        if (r.status !== 200 || r.json('success') !== true) fail(`seed ${name}: ${r.status} ${r.body}`);
    }
}

export function setup() {
    seed('matched-list', 100);
    seed('matched-filter', 10000);
}

export default function () {
    const name = exec.scenario.name;
    const listing = name === 'list';
    const group = exec.scenario.iterationInTest % 100;
    const database = listing ? 'matched-list' : 'matched-filter';
    let body, type;
    if (old) {
        const q = listing ? {} : name === 'indexed_eq'
            ? { index: 'category', op: 'eq', value: group }
            : { path: '$.products[*].price', op: 'eq', value: group };
        body = JSON.stringify({ ...q, limit: 1000 });
        type = 'application/json';
    } else {
        body = listing ? '.' : name === 'indexed_eq'
            ? `select(.category == ${group})`
            : `select(any(.products[]?.price; . == ${group}))`;
        type = 'text/plain';
    }
    const r = http.request('QUERY', `${base}/db/${database}`, body, {
        headers: { 'Content-Type': type, Accept: 'application/json' },
        tags: { operation: name },
    });
    const result = r.status === 200 ? r.json() : null;
    const values = old ? result?.documents?.map((entry) => entry.doc) : result;
    const expected = new Set(Array.from({ length: 100 }, (_, i) => listing ? i : group + i * 100));
    check(r, {
        [`${name} returns all 100 documents`]: () => r.status === 200 &&
            Array.isArray(values) && values.length === 100 && (!old || result.cursor === ''),
        [`${name} returns the same values`]: () => Array.isArray(values) && values.every((value) => {
            if (!expected.delete(value.seed)) return false;
            const want = doc(value.seed);
            return value.category === want.category && value.payload === want.payload &&
                value.products.length === 1 && value.products[0].price === want.products[0].price;
        }) && expected.size === 0,
    });
}

export function teardown() {
    for (const database of ['matched-list', 'matched-filter']) {
        check(http.del(`${base}/db/${database}`), { 'database deleted': (r) => r.status === 204 });
    }
}
