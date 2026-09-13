# CRUD versus bulk creation

## Summary

Bulk import was much faster than creating indexed documents one at a time. The bulk run imported 1,000 documents in 288 ms on average, or about 3,467 documents per second for one request stream. Indexed CRUD creates averaged 8.54 ms each, which works out to about 117 documents per second for a serial stream.

On that basis, bulk import was about 30 times faster per worker. The four-worker bulk run sustained 12,367 imported documents per second.

This is a directional comparison, not a controlled head-to-head benchmark. The results came from different test scripts. The CRUD run mixed creates with reads, updates, scans, and range queries, while the bulk run only exercised transfer cycles. The summary files also do not record the environment variables used for each run.

## Workloads

| Setting                        | CRUD (`after.json`) | Bulk (`bulk.json`) |
| ------------------------------ | ------------------: | -----------------: |
| Maximum VUs                    |                 280 |                  4 |
| Indexed creates measured       |               6,001 |        400 batches |
| Documents per request          |                   1 |              1,000 |
| Imported documents             |                 N/A |            400,000 |
| Request payload per bulk batch |                 N/A |           3.94 MiB |
| Failed checks                  |                   0 |                  0 |
| Failed HTTP requests           |                   0 |                  0 |

The CRUD test scheduled indexed creates at about 10 requests per second as part of a mixed workload. That rate was configured by the test and should not be read as the CRUD endpoint's maximum throughput.

## Creation latency and throughput

| Statistic                   | Indexed CRUD create |       Bulk import |
| --------------------------- | ------------------: | ----------------: |
| Documents per request       |                   1 |             1,000 |
| Average request latency     |             8.54 ms |         288.46 ms |
| Median request latency      |             8.91 ms |         293.49 ms |
| p95 request latency         |            10.72 ms |         322.89 ms |
| p99 request latency         |            12.67 ms |         377.17 ms |
| Estimated serial throughput |     117 documents/s | 3,467 documents/s |

A bulk request takes much longer than one CRUD request, but it creates 1,000 documents before returning. Dividing the batch size by average latency gives about 3,467 documents per second for bulk import. Dividing one document by the CRUD average gives about 117 documents per second. The resulting ratio is 29.6 to 1.

The CRUD benchmark's seed phase was faster than its indexed-create workload, averaging 5.01 ms per document. That is about 200 documents per second for a serial stream. Bulk was still roughly 17 times faster by this estimate.

The bulk result is consistent with its storage path. One import encrypts and indexes every document, then commits the full set in one synced Pebble batch. CRUD creation performs the commit work for each document separately.

## Aggregate bulk result

The four-worker bulk run completed 400 imports and exports in about 32 seconds. It moved 1.54 GiB in each direction and sustained:

- 12,367 imported documents per second
- 48.8 MiB/s aggregate import traffic
- 13.97 MiB/s average import throughput per request
- 615.53 MiB/s average export throughput per request

Export was much faster than import because import generates IDs and revisions, encrypts documents, rebuilds index entries, and commits them durably. Export reads and streams an existing snapshot.

## API tradeoffs

Bulk import is the better interface for loading or migrating many documents when generated IDs are acceptable. It also gives all-or-nothing behavior: one invalid document rejects the entire batch.

CRUD creation is a better fit when the caller needs each generated ID and ETag immediately, wants independent success or failure for each document, or receives writes one at a time.

Bulk import has limits that CRUD clients do not encounter as one batch: 1,000 documents, 64 MiB, and 30 seconds by default. It also defaults to one concurrent bulk request. Those settings are configurable.

## Assessment

The measured result supports using bulk import for mass creation. Its estimated per-worker document rate was about 30 times the indexed CRUD-create rate, with no correctness or HTTP failures.

A precise ratio needs a dedicated benchmark that sends identical documents to both interfaces on the same build, storage device, and concurrency level. The current numbers are strong enough to choose bulk for large loads, but not to treat 29.6 times as a universal speedup.
