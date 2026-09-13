import http from "k6/http";
import { check, fail } from "k6";
import { Counter } from "k6/metrics";

const baseUrl = __ENV.BASE_URL;
const vus = Number(__ENV.ETAG_VUS || 10);
const etagPattern = /^"[0-9a-f]{32}"$/;

if (!Number.isInteger(vus) || vus < 2) {
    throw new Error("ETAG_VUS must be an integer greater than one");
}

const successfulWrites = new Counter("successful_writes");
const staleWrites = new Counter("stale_writes");

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 204 }, 412));

export const options = {
    scenarios: {
        etag: {
            executor: "per-vu-iterations",
            vus,
            iterations: 1,
            maxDuration: __ENV.ETAG_MAX_DURATION || "10s",
        },
    },
    thresholds: {
        checks: ["rate==1"],
        http_req_failed: ["rate==0"],
        successful_writes: ["count==1"],
        stale_writes: [`count==${vus - 1}`],
    },
};

const jsonHeaders = { "Content-Type": "application/json" };

export function setup() {
    if (!baseUrl) {
        fail("BASE_URL is required");
    }

    const database = `etag-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    const createDatabase = http.post(
        `${baseUrl}/db`,
        JSON.stringify({ name: database }),
        { headers: jsonHeaders, tags: { name: "database_create" } },
    );

    if (
        !check(createDatabase, { "database created": (r) => r.status === 201 })
    ) {
        fail(
            `database creation failed: ${createDatabase.status} ${createDatabase.body}`,
        );
    }

    const createDocument = http.post(
        `${baseUrl}/db/${database}`,
        JSON.stringify({ winner: null }),
        { headers: jsonHeaders, tags: { name: "document_create" } },
    );
    const id = createDocument.status === 201 ? createDocument.json("id") : "";
    const etag = createDocument.headers.Etag;

    if (
        !check(createDocument, {
            "document created": (r) => r.status === 201,
            "create returned an ETag": () => etagPattern.test(etag),
        })
    ) {
        fail(
            `document creation failed: ${createDocument.status} ${createDocument.body}`,
        );
    }

    return { database, id, etag };
}

export default function ({ database, id, etag }) {
    const response = http.put(
        `${baseUrl}/db/${database}/${id}`,
        JSON.stringify({ winner: __VU }),
        {
            headers: { ...jsonHeaders, "If-Match": etag },
            tags: { name: "competing_update" },
        },
    );

    check(response, {
        "write accepted or rejected as stale": (r) =>
            r.status === 200 || r.status === 412,
    });

    if (response.status === 200) {
        successfulWrites.add(1);
        check(response, {
            "winner stored its value": (r) => r.json("winner") === __VU,
            "winner changed ETag": (r) =>
                etagPattern.test(r.headers.Etag) && r.headers.Etag !== etag,
        });

        return;
    }

    if (response.status === 412) {
        staleWrites.add(1);
        check(response, {
            "stale write returned error code": (r) =>
                r.json("error.code") === "precondition_failed",
            "stale write returned error message": (r) =>
                r.json("error.message") === "If-Match precondition failed",
        });
    }
}

export function teardown({ database, id, etag }) {
    const read = http.get(`${baseUrl}/db/${database}/${id}`, {
        tags: { name: "document_read" },
    });
    const finalEtag = read.headers.Etag;

    check(read, {
        "winning document read": (r) => r.status === 200,
        "winner is a competing VU": (r) => {
            const winner = r.json("winner");

            return Number.isInteger(winner) && winner >= 1 && winner <= vus;
        },
        "final ETag changed": () =>
            etagPattern.test(finalEtag) && finalEtag !== etag,
    });

    const removeDocument = http.del(`${baseUrl}/db/${database}/${id}`, null, {
        headers: { "If-Match": etagPattern.test(finalEtag) ? finalEtag : "*" },
        tags: { name: "document_delete" },
    });
    check(removeDocument, { "document deleted": (r) => r.status === 204 });

    const removeDatabase = http.del(`${baseUrl}/db/${database}`, null, {
        tags: { name: "database_delete" },
    });
    check(removeDatabase, { "database deleted": (r) => r.status === 204 });
}
