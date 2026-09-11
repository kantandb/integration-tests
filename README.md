# KantanDB integration testing

Run the Hurl suite:

```sh
mise run hurl
```

The suite covers health, errors, indexed CRUD, pagination, and conditional
writes.

## Performance tests

Each task starts its own server with temporary storage.

```sh
mise run k6-load      # CRUD load
mise run k6-etag      # concurrent conditional writes
mise run k6-benchmark # storage benchmark
mise run k6-range     # secondary index range queries
mise run k6           # all tests
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

The range test seeds indexed values in reverse creation order, including ties.
It verifies `lt`, `le`, `gt`, and `ge` pagination in indexed-value and document-ID
order. Configure it with `RANGE_VUS`, `RANGE_ITERATIONS`, `RANGE_SEED_DOCS`,
`RANGE_PAGE_SIZE`, and `RANGE_MAX_DURATION`.

The benchmark seeds 10,000 indexed 1 KiB documents, then runs point reads,
primary scans, range queries, indexed updates, and indexed creates for two
minutes. It reports average, median, p90, p95, p99, maximum, and request count
for each operation. Configure it with:

```sh
BENCHMARK_DURATION=5m BENCHMARK_SEED_DOCS=50000 \
BENCHMARK_PAYLOAD_BYTES=4096 BENCHMARK_READ_RATE=200 \
BENCHMARK_LIST_RATE=10 BENCHMARK_RANGE_RATE=10 \
BENCHMARK_UPDATE_RATE=40 BENCHMARK_CREATE_RATE=20 \
mise run k6-benchmark
```

`BENCHMARK_PAGE_SIZE` sets scan page size. `BENCHMARK_SETUP_TIMEOUT` allows
longer seed runs. Set `K6_SUMMARY_EXPORT=summary.json` for machine-readable
results. Keep all settings fixed when comparing revisions and run each revision
several times.
