# jq API benchmark comparison

This report compares pre-jq `d985455` with upstream main `2a4de54`.
Matched listing, indexed equality, and nested equality p95 fell 79%, 61%, and 58%, respectively.
Mixed iteration p95 fell 35%. No measured operation clearly worsened.

## Method

Both revisions ran on the same Apple M2 Pro with macOS 15.7.9, Go 1.26.11, and k6 2.2.0.
Each suite ran three times per revision with fresh storage.
This comparison reuses the saved pre-jq results. Machine load can vary between sessions.

- Matched queries: Both APIs returned the same 100 document bodies as JSON. Filters selected 100 of 10,000 documents. Listing returned all 100 documents in a separate database. The pre-jq response also included IDs and revisions. Each case scheduled five queries per second for 15 seconds with one client.
- Bulk: One client imported and exported ten batches of 1,000 documents per run. Each revision transferred 10,637,900 bytes in each direction per run.
- Native mixed: Each suite seeded 10,000 documents with 1 KiB payloads and scheduled 147 operations per second for two minutes. Queries targeted at most 100 results. The pre-jq API returned pages with cursors. The jq API streamed results.

Each latency cell shows median / p95 in milliseconds, each aggregated as the median of three run values.
The p95 is the latency at or below which 95% of samples fall.
Current p95 ranges show the lowest and highest run values.

## Matched queries and bulk transfers

| Operation | Pre-jq `d985455` | Current `2a4de54` | Current p95 range |
|---|---:|---:|---:|
| List all 100 documents | 6.48 / 8.83 | 1.09 / 1.83 | 1.59–1.93 |
| Indexed equality filter | 6.86 / 8.62 | 2.27 / 3.33 | 2.70–4.77 |
| Nested equality filter | 172.98 / 178.87 | 68.42 / 75.11 | 74.12–76.10 |
| Bulk import | 35.21 / 46.54 | 30.75 / 43.03 | 42.88–43.33 |
| Bulk export | 3.08 / 14.66 | 3.04 / 9.51 | 6.96–10.96 |

The current server returns stored JSON for bare indexed equality without running jq.
The benchmark does not isolate the cost of individual implementation changes.
Pre-jq indexed equality p95 ranged from 3.79 to 8.63 ms, which overlaps the current range.
Bulk import and export p95 fell 8% and 35%, respectively.

| Median throughput | Pre-jq `d985455` | Current `2a4de54` |
|---|---:|---:|
| Import, MiB/s | 28.81 | 33.00 |
| Export, MiB/s | 329.20 | 335.13 |

Median import throughput rose 15%.
Typical export performance stayed close to baseline: median latency was about 3 ms, and throughput rose only 2%.

## Native mixed workload

| Operation | Pre-jq `d985455` | Current `2a4de54` | Current p95 range |
|---|---:|---:|---:|
| Point read | 0.38 / 1.09 | 0.23 / 0.33 | 0.32–1.04 |
| Indexed update | 6.38 / 9.91 | 6.29 / 9.44 | 9.34–10.79 |
| Indexed create | 5.43 / 8.10 | 4.53 / 7.10 | 5.85–9.26 |
| List | 9.71 / 14.11 | 4.89 / 9.93 | 9.89–15.62 |
| Range filter | 10.36 / 14.40 | 6.33 / 10.82 | 10.79–18.12 |
| Projection | Not equivalent | 2.83 / 9.62 | 9.43–14.96 |
| Nested filter | 15.98 / 48.60 | 7.67 / 19.11 | 17.77–28.31 |
| All client iterations | 0.94 / 13.94 | 0.33 / 9.02 | 8.99–11.60 |

Both revisions completed about 147 iterations per second without drops in the mixed workload.
Iteration p95 fell 35%, range filter p95 fell 25%, and nested filter p95 fell 61%.
Indexed updates stayed close to baseline, with p95 down only 5%.
Several operation ranges overlap pre-jq results, so small differences do not establish a repeatable improvement.

Pre-jq indexed range queries used indexed-value order, then document-ID order for equal values.
Current indexed queries also read in index order. Document-ID ordering is not a difference between these range benchmarks.
Native queries still differ across APIs, so this comparison measures each revision's native behavior rather than identical results.
The matched equality cases require the same complete set of 100 documents.
The pre-jq indexed-path query has no equivalent in the projection scenario.

## Validation

All nine current runs passed without dropped iterations, failed response checks, unexpected HTTP statuses, query-busy responses, or write conflicts.
Each mixed run completed 17,645–17,647 iterations, 2,401 indexed updates, and 1,201 indexed creates.
One pre-jq matched run dropped 13 nested query iterations and failed its drop threshold.
The tables include that run's completed requests.

`mise run check` passed: Hurl formatting and all 79 requests across five integration files.
