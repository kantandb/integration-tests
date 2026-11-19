# jq API benchmark comparison

This report compares pre-jq server `d985455` with `8fd6d2f`. Bulk export throughput returned to pre-jq levels. Matched queries and the mixed workload finished faster at p95.

## Method

Both revisions ran on the same Apple M2 Pro with macOS 15.7.9, Go 1.26.11, and k6 2.2.0. Each suite ran three times per revision with fresh storage. The latest run reused the saved pre-jq results. Machine load can vary between sessions.

- Matched queries: Both APIs returned the same 100 document bodies as JSON. Filters selected 100 of 10,000 documents. Listing returned all 100 documents in a separate database. The pre-jq response also included IDs and revisions. Each case ran alone at five queries per second for 15 seconds with one client.
- Bulk: One client imported and exported ten batches of 1,000 documents per run. Each revision transferred 10,637,900 bytes in each direction per run.
- Native mixed: Each suite seeded 10,000 documents with 1 KiB payloads and scheduled 147 operations per second for two minutes. Queries targeted at most 100 results. The pre-jq API returned pages with cursors. The latest API streamed results.

Each table reports the median of three run medians or p95 values. The p95 is the latency at or below which 95% of samples fall. Parentheses show the lowest and highest of the three run p95 values.

## Matched queries and bulk transfers

| Operation | Pre-jq median (ms) | Latest median (ms) | Pre-jq p95 (range), ms | Latest p95 (range), ms |
|---|---:|---:|---:|---:|
| List all 100 documents | 6.48 | 1.05 | 8.83 (3.87–9.15) | 1.58 (1.24–2.27) |
| Indexed equality filter | 6.86 | 2.93 | 8.62 (3.79–8.63) | 3.33 (3.33–13.53) |
| Nested equality filter | 172.98 | 71.06 | 178.87 (174.99–200.58) | 75.33 (73.94–78.98) |
| Bulk import | 35.21 | 30.43 | 46.54 (46.00–46.88) | 41.78 (41.47–41.82) |
| Bulk export | 3.08 | 3.10 | 14.66 (13.32–16.70) | 8.51 (7.31–11.81) |

Matched listing and nested equality p95 fell 82% and 58%, respectively. Indexed equality p95 fell 61% overall, but one latest run was slower than all pre-jq runs.

Median bulk export throughput was nearly unchanged at 329.20 versus 327.85 MiB/s. Export p95 fell 42%. Median import throughput rose 16%, from 28.81 to 33.34 MiB/s.

## Native mixed workload

| Operation | Pre-jq median (ms) | Latest median (ms) | Pre-jq p95 (range), ms | Latest p95 (range), ms |
|---|---:|---:|---:|---:|
| Point read | 0.38 | 0.22 | 1.09 (0.83–1.15) | 0.64 (0.29–1.00) |
| Indexed update | 6.38 | 5.76 | 9.91 (9.83–10.10) | 9.78 (9.23–10.11) |
| Indexed create | 5.43 | 4.54 | 8.10 (8.05–8.31) | 8.00 (5.81–9.84) |
| List | 9.71 | 5.09 | 14.11 (14.08–14.17) | 10.45 (8.76–13.02) |
| Range filter | 10.36 | 10.32 | 14.40 (14.35–14.44) | 17.36 (13.31–23.70) |
| Nested filter | 15.98 | 6.55 | 48.60 (36.82–52.94) | 18.89 (16.56–24.15) |
| All client iterations | 0.94 | 0.38 | 13.94 (10.72–13.94) | 10.01 (9.30–10.86) |

Both versions completed about 147 iterations per second. Client iteration p95 fell 28%. Indexed write p95 changed little. Range filter p95 rose 21%, but the run ranges overlap. The native queries do not perform identical work across APIs. They differ in response format, and the pre-jq indexed-path query has no match in the latest projection scenario.

All response checks passed, and neither version returned unexpected HTTP statuses. The latest revision completed all nine runs without drops. One pre-jq matched run dropped 13 nested query iterations and failed its drop threshold. The table includes that run's completed requests.

[Per-run measurements](jq-api-comparison/latency-throughput.csv), [run counts](jq-api-comparison/runs.csv), and [matched query script](jq-api-comparison/matched.js). For this comparison, use the CSV rows labeled `old` and `8fd6d2f`.
