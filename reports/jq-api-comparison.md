# jq API benchmark comparison

Server `d985455` (tests `3215057`) versus server `360aade` (tests `f3392c3`).

The new API ran the matched nested filter faster. It ran the formerly indexed filter much slower and reduced bulk export throughput. Indexed writes and bulk imports changed little.

## Method

Both versions ran on the same Apple M2 Pro with macOS 15.7.9, Go 1.26.11, and k6 2.2.0. Each suite ran three times per version, in old/new, new/old, then old/new order. The suites ran one at a time, each with fresh storage.

- Native mixed: 10,000 seed documents with 1 KiB payloads, two minutes at 147 scheduled operations per second. Query requests targeted at most 100 results. The old API returned envelopes and cursors. The new API streamed jq output and retried `429 query_busy`.
- Bulk: ten 1,000-document batches per run, one client. Both versions imported and exported 10,637,900 bytes per run.
- Matched queries: JSON responses with the same 100 document bodies. Filters selected 100 of 10,000 documents. Listing returned an entire 100-document database. Each case ran alone at five queries per second for 15 seconds with one client. The old response still included IDs and revisions. The new response did not.

The tables show the median of the three run medians or p95 values. The p95 is the latency at or below which 95% of samples fall. Parentheses show the lowest and highest p95 across the three runs.

## Matched queries and bulk transfers

| Operation | Old median | New median | Old p95 (range) | New p95 (range) |
|---|---:|---:|---:|---:|
| List all 100 documents | 6.48 ms | 4.90 ms | 8.83 (3.87–9.15) ms | 6.57 (2.75–7.29) ms |
| Equality filter, formerly indexed | 6.86 ms | 110.05 ms | 8.62 (3.79–8.63) ms | 114.68 (110.63–114.81) ms |
| Nested equality filter | 172.98 ms | 125.56 ms | 178.87 (174.99–200.58) ms | 127.95 (126.40–129.25) ms |
| Bulk import | 35.21 ms | 33.34 ms | 46.54 (46.00–46.88) ms | 45.73 (44.31–46.62) ms |
| Bulk export | 3.08 ms | 17.70 ms | 14.66 (13.32–16.70) ms | 23.09 (22.75–23.26) ms |

The formerly indexed filter took 16× as long at the median. jq scans the documents instead of using the index. The nested filter, which already required a scan, improved 28% at p95. Listing improved 26% at p95, but the run ranges overlap.

Median bulk export throughput fell 83%, from 329.20 to 57.34 MiB/s. The new code flushes each output line. The benchmark did not isolate the cost of flushing from the cost of jq processing. Bulk import throughput was close, at 28.81 versus 30.43 MiB/s.

## Native mixed workload

| Operation | Old median (ms) | New median (ms) | Old p95 (range), ms | New p95 (range), ms |
|---|---:|---:|---:|---:|
| Point read | 0.38 | 0.31 | 1.09 (0.83–1.15) | 0.90 (0.25–0.95) |
| Indexed update | 6.38 | 6.22 | 9.91 (9.83–10.10) | 10.11 (9.96–10.12) |
| Indexed create | 5.43 | 5.19 | 8.10 (8.05–8.31) | 7.33 (7.17–8.18) |
| List | 9.71 | 4.06 | 14.11 (14.08–14.17) | 8.88 (6.60–9.75) |
| Range filter | 10.36 | 6.92 | 14.40 (14.35–14.44) | 31.43 (26.20–34.36) |
| Nested filter | 15.98 | 7.64 | 48.60 (36.82–52.94) | 24.57 (20.53–30.54) |
| All client iterations | 0.94 | 0.67 | 13.94 (10.72–13.94) | 26.95 (24.01–28.34) |

The listing and nested query requests were faster, but they perform different work across APIs. The old indexed-path query and new projection are not comparable. They appear separately in the data. Indexed writes changed little, and point reads improved at the median and p95, with overlapping run ranges.

Both versions completed about 147 iterations per second without drops in the mixed workload. The new runs retried 1,709 to 1,893 `query_busy` responses each. The new query request rows show successful attempts only. Client iteration latency includes retry delays and rose 93% at p95.

No run recorded a failed HTTP request under its k6 expected-status rules, and all response checks passed. One old matched run dropped 13 of roughly 75 nested queries when its single client fell behind. It failed the drop threshold. The table includes the requests it completed. No other run dropped iterations.

[Per-run measurements](jq-api-comparison/latency-throughput.csv), [run counts](jq-api-comparison/runs.csv), and [matched query workload](jq-api-comparison/matched.js).
