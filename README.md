# KantanDB integration testing

Run the Hurl suite:

```sh
mise run hurl
```

The suite covers health, errors, CRUD, database list pagination, conditional
writes, and jq queries. It also checks stream completion through the
`Query-Status` HTTP trailer, a field that arrives after the response body.

## k6 tests

Each task starts its own server with temporary storage.

```sh
mise run k6-load      # CRUD load
mise run k6-etag      # concurrent conditional writes
mise run k6-range     # jq range filters
mise run k6-query     # concurrent jq queries and writes
mise run k6-bulk      # bulk transfer correctness
mise run k6-benchmark # storage benchmark
mise run k6-bulk-benchmark # bulk transfer benchmark
mise run k6           # all correctness tests
```

The load test uses 5 VUs for 15 seconds by default. Set `LOAD_VUS` and
`LOAD_DURATION` to change them:

```sh
LOAD_VUS=20 LOAD_DURATION=30s mise run k6-load
```

It fails if checks fall to 99% or less, HTTP errors reach 1%, or p95 request
latency reaches 500 ms.

The ETag test uses 10 VUs by default. Set `ETAG_VUS` or
`ETAG_MAX_DURATION` to change its limits:

```sh
ETAG_VUS=20 ETAG_MAX_DURATION=15s mise run k6-etag
```

Exactly one conditional write must succeed. Every other write must return
`412 precondition_failed`.

The range test seeds scores in reverse creation order, including ties.
It tests jq range filters and checks results in document ID order. Configure it
with `RANGE_VUS`, `RANGE_ITERATIONS`, `RANGE_SEED_DOCS`, and `RANGE_MAX_DURATION`.

The QUERY test runs numeric and nested jq filters while other clients write to
the same database. It tests all five comparisons in JSON and NDJSON, which
stores one JSON value per line. Configure it with `QUERY_VUS`, `QUERY_ITERATIONS`,
`QUERY_SEED_DOCS`, and `QUERY_MAX_DURATION`.

The bulk correctness test checks that an NDJSON export and import preserves
values and counts. It also checks that a rejected batch adds no documents.
Configure it with `BULK_DOCS`, `BULK_PAYLOAD_BYTES`, `BULK_ITERATIONS`, and
`BULK_MAX_DURATION`.

The benchmark starts with 10,000 indexed 1 KiB documents. It runs point reads,
jq queries, indexed updates, and indexed creates for two minutes. The jq
queries return full documents, filter ranges, select fields, or filter nested
values. Configure the benchmark with:

```sh
BENCHMARK_DURATION=5m BENCHMARK_SEED_DOCS=50000 \
BENCHMARK_PAYLOAD_BYTES=4096 BENCHMARK_READ_RATE=200 \
BENCHMARK_LIST_RATE=10 BENCHMARK_RANGE_RATE=10 \
BENCHMARK_PROJECTION_RATE=10 BENCHMARK_QUERY_SCAN_RATE=5 \
BENCHMARK_UPDATE_RATE=40 BENCHMARK_CREATE_RATE=20 \
mise run k6-benchmark
```

`BENCHMARK_RESULT_LIMIT` caps the number of values each query returns.
`BENCHMARK_SETUP_TIMEOUT` allows longer seed runs.

For older server revisions, k6 counts `429 query_busy` responses separately
and retries them for up to five seconds. Hurl checks stream trailers
because k6 does not expose them.

The bulk benchmark measures import and export latency and MiB/s using fresh
indexed databases. Configure it with `BULK_BENCHMARK_VUS`,
`BULK_BENCHMARK_ITERATIONS`, `BULK_BENCHMARK_DOCS`,
`BULK_BENCHMARK_PAYLOAD_BYTES`, and `BULK_BENCHMARK_MAX_DURATION`. Match server
concurrency when using multiple VUs:

```sh
KANTAN_K6_BULK_CONCURRENCY=4 BULK_BENCHMARK_VUS=4 \
mise run k6-bulk-benchmark
```

Set `K6_SUMMARY_EXPORT=summary.json` for machine-readable results. Keep all
settings fixed when comparing revisions and run each revision several times.
