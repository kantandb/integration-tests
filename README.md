# KantanDB integration testing

Make sure kantan prototype dir is level up, i.e. repo at `../prototype`.
Thn run the end-to-end tests:

```sh
mise run e2e
[e2e] $ ./e2e/run.sh
Success e2e/health.hurl (1 request(s) in 109 ms)
--------------------------------------------------------------------------------
Executed files:    1
Executed requests: 1 (9.0/s)
Succeeded files:   1 (100.0%)
Failed files:      0 (0.0%)
Duration:          111 ms (0h:0m:0s:111ms)

Success e2e/errors.hurl (7 request(s) in 2 ms)
Success e2e/health.hurl (1 request(s) in 0 ms)
Success e2e/lifecycle.hurl (14 request(s) in 32 ms)
--------------------------------------------------------------------------------
Executed files:    3
Executed requests: 22 (611.1/s)
Succeeded files:   3 (100.0%)
Failed files:      0 (0.0%)
Duration:          36 ms (0h:0m:0s:36ms)
```

## Performance tests

Each task starts its own server with temporary storage.

```sh
mise run k6-load     # CRUD load
mise run k6-etag     # concurrent conditional writes
mise run k6-workload # mixed concurrent workload
mise run k6          # all tests
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

The workload test models concurrent reads, browsing, edits to shared hot
records, and document creation. It seeds 100 records, then runs a 30-second
read-heavy workload at 18 sessions per second. Configure it with:

```sh
WORKLOAD_DURATION=1m WORKLOAD_READ_RATE=24 \
WORKLOAD_BROWSE_RATE=4 WORKLOAD_WRITE_RATE=6 \
WORKLOAD_CREATE_RATE=2 mise run k6-workload
```

`WORKLOAD_SEED_DOCS` and `WORKLOAD_HOT_DOCS` control the initial collection and
write contention. The test requires no dropped iterations, over 99% successful
checks, under 1% unexpected HTTP failures, and p95 latency below 500 ms for
reads and 750 ms for writes.
