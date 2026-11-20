import http from "k6/http";

// k6 does not expose HTTP trailers. Hurl checks stream completion.
export function query(baseUrl, database, program, tags, accept = "application/json", headers = {}) {
    return http.request("QUERY", `${baseUrl}/db/${database}`, program, {
        headers: { "Content-Type": "text/plain", Accept: accept, ...headers },
        responseCallback: http.expectedStatuses(200),
        tags,
    });
}

export const ndjson = "application/x-ndjson";

export function parseNDJSON(response) {
    if (response.status !== 200 || !response.body) {
        return [];
    }

    return response.body.trimEnd().split("\n").map((line) => JSON.parse(line));
}
