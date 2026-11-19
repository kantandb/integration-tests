# jq API benchmark comparison

This report compares pre-jq `d985455` with `95a1967`. The latest revision runs jq in the server process. Mixed iteration p95 improved, and the matched nested filter met its target rate.

## Method

Both revisions ran on the same Apple M2 Pro with macOS 15.7.9, Go 1.26.11, and k6 2.2.0. Each suite ran three times per revision with fresh storage. This comparison reuses the saved pre-jq results. Machine load can vary between sessions.

- Matched queries: Both APIs returned the same 100 document bodies as JSON. Filters selected 100 of 10,000 documents. Listing returned all 100 documents in a separate database. The pre-jq response also included IDs and revisions. Each case scheduled five queries per second for 15 seconds with one client.
- Bulk: One client imported and exported ten batches of 1,000 documents per run. Each revision transferred 10,637,900 bytes in each direction per run.
- Native mixed: Each suite seeded 10,000 documents with 1 KiB payloads and scheduled 147 operations per second for two minutes. Queries targeted at most 100 results. The pre-jq API returned pages with cursors. The latest API streamed results.

Each table reports the median of three run medians or p95 values for completed requests. The p95 is the latency at or below which 95% of samples fall. Parentheses show the lowest and highest of the three run p95 values.

## Matched queries and bulk transfers

| Operation | Pre-jq median (ms) | Latest median (ms) | Pre-jq p95 (range), ms | Latest p95 (range), ms |
|---|---:|---:|---:|---:|
| List all 100 documents | 6.48 | 2.23 | 8.83 (3.87–9.15) | 4.33 (3.88–5.10) |
| Indexed equality filter | 6.86 | 7.59 | 8.62 (3.79–8.63) | 10.81 (2.85–11.39) |
| Nested equality filter | 172.98 | 74.41 | 178.87 (174.99–200.58) | 76.81 (73.21–78.75) |
| Bulk import | 35.21 | 29.13 | 46.54 (46.00–46.88) | 41.44 (39.54–43.74) |
| Bulk export | 3.08 | 3.08 | 14.66 (13.32–16.70) | 10.38 (9.36–12.12) |

Matched listing and nested equality p95 fell 51% and 57%, respectively. Indexed equality p95 rose 25%, but the run ranges overlap. The latest server uses the index, then decodes each match and applies the jq filter. The benchmark does not isolate that cost.

Median export throughput was unchanged at about 329 MiB/s, while export p95 fell 29%. Median import throughput rose 21%, from 28.81 to 34.83 MiB/s.

## Native mixed workload

| Operation | Pre-jq median (ms) | Latest median (ms) | Pre-jq p95 (range), ms | Latest p95 (range), ms |
|---|---:|---:|---:|---:|
| Point read | 0.38 | 0.42 | 1.09 (0.83–1.15) | 1.35 (0.73–1.49) |
| Indexed update | 6.38 | 6.27 | 9.91 (9.83–10.10) | 10.52 (10.36–10.55) |
| Indexed create | 5.43 | 5.38 | 8.10 (8.05–8.31) | 10.13 (9.49–10.24) |
| List | 9.71 | 6.31 | 14.11 (14.08–14.17) | 14.17 (13.61–14.48) |
| Range filter | 10.36 | 10.86 | 14.40 (14.35–14.44) | 19.15 (18.73–19.69) |
| Nested filter | 15.98 | 9.27 | 48.60 (36.82–52.94) | 24.95 (21.97–25.88) |
| All client iterations | 0.94 | 0.96 | 13.94 (10.72–13.94) | 12.02 (10.36–13.51) |

Both revisions completed about 147 iterations per second without drops in the mixed workload. Client iteration p95 fell 14%, while range filter p95 rose 33%. The pre-jq range walks one index in value order. The jq range returns document-ID order and can probe documents before merging several index iterators. The benchmark does not measure the cost of each step. Native queries differ across APIs. The pre-jq indexed-path query has no equivalent in the latest projection scenario.

All nine latest runs passed without dropped iterations, failed response checks, or unexpected HTTP statuses. One pre-jq matched run dropped 13 nested query iterations and failed its drop threshold. The table includes that run's completed requests.

[Per-run measurements](jq-api-comparison/latency-throughput.csv), [run counts](jq-api-comparison/runs.csv), and [matched query script](jq-api-comparison/matched.js). For this comparison, use the CSV rows labeled `old` and `95a1967`.
