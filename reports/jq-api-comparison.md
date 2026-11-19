# jq API benchmark comparison

This report compares four revisions: `d985455` (pre-jq), `360aade` (first jq revision), `9a22cf9` (buffered NDJSON and faster decoding), and `65c5f71` (indexed jq). The pre-jq runs used tests from `3215057`. All jq revisions used the benchmark scripts from `f3392c3` and the same matched query script.

## Method

All revisions ran on the same Apple M2 Pro with macOS 15.7.9, Go 1.26.11, and k6 2.2.0. The original comparison alternated the first two revisions. Each follow-up ran only the latest revision and reused the previous results. Each suite ran three times per revision, one at a time, with fresh storage. Changes across sessions can include machine load.

- Native mixed: 10,000 seed documents with 1 KiB payloads, two minutes at 147 scheduled operations per second. Query requests targeted at most 100 results. The old API returned envelopes and cursors. The new API streamed jq output and retried `429 query_busy`.
- Bulk: ten 1,000-document batches per run, one client. All revisions imported and exported 10,637,900 bytes per run.
- Matched queries: JSON responses with the same 100 document bodies. Filters selected 100 of 10,000 documents. Listing returned an entire 100-document database. Each case ran alone at five queries per second for 15 seconds with one client. The old response still included IDs and revisions. The new response did not.

The tables show the median of the three run medians or p95 values. The p95 is the latency at or below which 95% of samples fall. Parentheses show the lowest and highest p95 across the three runs.

## Follow-up: secondary indexes for jq

`65c5f71` reduced p95 for the matched equality filter by 94%, from 57.68 to 3.20 ms. The query now uses the `/category` index. It beat the pre-jq p95 of 8.62 ms overall, but one of the three runs was slower than that baseline.

| Operation | `9a22cf9` median / p95 | `65c5f71` median / p95 |
|---|---:|---:|
| Indexed equality filter | 55.64 / 57.68 ms | 2.83 / 3.20 ms |
| Matched nested equality filter | 72.63 / 75.39 ms | 72.32 / 75.14 ms |
| Matched list | 1.69 / 2.07 ms | 1.58 / 2.02 ms |
| Bulk export | 8.16 / 14.30 ms | 8.09 / 12.33 ms |
| Bulk import | 30.61 / 43.33 ms | 30.83 / 43.47 ms |
| Mixed range request | 2.13 / 14.11 ms | 3.10 / 16.26 ms |
| Mixed client iteration | 0.30 / 21.23 ms | 0.38 / 21.81 ms |

Indexed equality p95 ranged from 3.06 to 12.84 ms across the new runs, versus 53.93 to 67.66 ms on `9a22cf9`. Listing, nested equality, and bulk throughput changed little. Median export throughput was 130.14 MiB/s, still 60% below the pre-jq baseline.

Mixed throughput held at about 147 iterations per second. Median `query_busy` retries rose from 1,492 to 1,548, within the previous run range. The mixed range query uses `inputs` and still scans documents. Its p95 rose 15%, with overlapping run ranges. All nine runs passed without unexpected HTTP statuses, failed response checks, or dropped iterations.

## Follow-up: buffered NDJSON and faster JSON decoding

`9a22cf9` more than doubled bulk export throughput and nearly halved latency for the formerly indexed filter compared with `360aade`. Both still trail the pre-jq baseline. The matched nested filter ran faster than both baselines.

Each latency cell shows the median and p95 in milliseconds. The CSV records individual runs and sample counts.

| Operation | `d985455` median / p95 | `360aade` median / p95 | `9a22cf9` median / p95 | p95 change vs. `360aade` |
|---|---:|---:|---:|---:|
| Matched list | 6.48 / 8.83 | 4.90 / 6.57 | 1.69 / 2.07 | −68% |
| Formerly indexed equality filter | 6.86 / 8.62 | 110.05 / 114.68 | 55.64 / 57.68 | −50% |
| Matched nested equality filter | 172.98 / 178.87 | 125.56 / 127.95 | 72.63 / 75.39 | −41% |
| Bulk export | 3.08 / 14.66 | 17.70 / 23.09 | 8.16 / 14.30 | −38% |
| Bulk import | 35.21 / 46.54 | 33.34 / 45.73 | 30.61 / 43.33 | −5% |
| Mixed range request | 10.36 / 14.40 | 6.92 / 31.43 | 2.13 / 14.11 | −55% |
| Mixed client iteration | 0.94 / 13.94 | 0.67 / 26.95 | 0.30 / 21.23 | −21% |

Median export throughput rose from 57.34 to 129.31 MiB/s (+125%). It remained 61% below the pre-jq value of 329.20 MiB/s. Import throughput rose from 30.43 to 33.15 MiB/s (+9%). The benchmark measures both upstream changes together. It does not separate the effects of buffering and decoding.

The mixed workload still completed about 147 iterations per second. The median number of `query_busy` retries fell from 1,818 to 1,492 (−18%). Indexed writes changed little. Point reads looked faster, but their run ranges overlap. All nine follow-up runs passed without failed response checks, unexpected HTTP statuses, or dropped iterations.

## Original comparison: matched queries and bulk transfers

| Operation | Old median | New median | Old p95 (range) | New p95 (range) |
|---|---:|---:|---:|---:|
| List all 100 documents | 6.48 ms | 4.90 ms | 8.83 (3.87–9.15) ms | 6.57 (2.75–7.29) ms |
| Equality filter, formerly indexed | 6.86 ms | 110.05 ms | 8.62 (3.79–8.63) ms | 114.68 (110.63–114.81) ms |
| Nested equality filter | 172.98 ms | 125.56 ms | 178.87 (174.99–200.58) ms | 127.95 (126.40–129.25) ms |
| Bulk import | 35.21 ms | 33.34 ms | 46.54 (46.00–46.88) ms | 45.73 (44.31–46.62) ms |
| Bulk export | 3.08 ms | 17.70 ms | 14.66 (13.32–16.70) ms | 23.09 (22.75–23.26) ms |

The formerly indexed filter took 16× as long at the median. jq scans the documents instead of using the index. The nested filter, which already required a scan, improved 28% at p95. Listing improved 26% at p95, but the run ranges overlap.

Median bulk export throughput fell 83%, from 329.20 to 57.34 MiB/s. The first jq revision flushed each output line. The benchmark did not isolate the cost of flushing from the cost of jq processing. Bulk import throughput was close, at 28.81 versus 30.43 MiB/s.

## Original comparison: native mixed workload

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

[Per-run measurements](jq-api-comparison/latency-throughput.csv), [run counts](jq-api-comparison/runs.csv), and [matched query workload](jq-api-comparison/matched.js). The CSV labels `old`, `new`, and `current` refer to `d985455`, `360aade`, and `9a22cf9`, respectively. The latest rows use `65c5f71`.
