import http from "k6/http";
import { sleep } from "k6";
import { Counter } from "k6/metrics";

const busy = new Counter("query_busy");

// k6 does not expose HTTP trailers. Hurl checks Query-Status.
export function query(baseUrl, database, program, tags, accept = "application/json") {
    const params = {
        headers: { "Content-Type": "text/plain", Accept: accept },
        responseCallback: http.expectedStatuses(200, 429),
        tags,
    };
    const deadline = Date.now() + 5000;

    while (true) {
        // The server runs only one query at a time.
        const response = http.request("QUERY", `${baseUrl}/db/${database}`, program, params);
        if (response.status !== 429 || response.json("error.code") !== "query_busy") {
            return response;
        }

        busy.add(1);
        if (Date.now() >= deadline) {
            return response;
        }

        sleep(0.01 + Math.random() * 0.02);
    }
}

export const ndjson = "application/x-ndjson";

export function parseNDJSON(response) {
    if (response.status !== 200 || !response.body) {
        return [];
    }

    return response.body.trimEnd().split("\n").map((line) => JSON.parse(line));
}
