# Encryption benchmark comparison

This report compares equivalent benchmark runs before and after encryption was introduced.

## Summary

Both runs completed the same workload:

- 50,000 seed creates
- 84,005 workload operations
- 146,008 HTTP requests
- 276,019 checks
- 12,001 successful indexed updates
- 6,001 indexed creates

Neither run had failed requests, failed checks, dropped iterations, or update conflicts. The after run therefore preserved the workload's reliability and completion rate.

Latency changed in different directions. Point reads and reads before updates became slower, while primary scans and range queries improved. Write latency was close overall, though indexed updates became slightly slower. The worst isolated delays were much smaller in the after run.

## Operation latency

All times are milliseconds. Negative changes are faster.

| Operation          | Before median | After median | Change | Before p95 | After p95 | Change |
| ------------------ | ------------: | -----------: | -----: | ---------: | --------: | -----: |
| Point read         |          0.41 |         0.58 | +44.0% |       1.04 |      1.36 | +30.8% |
| Read before update |          0.54 |         0.74 | +37.9% |       1.97 |      2.61 | +32.1% |
| Primary scan       |          2.85 |         2.69 |  -5.8% |       6.80 |      5.32 | -21.8% |
| Seed create        |          5.08 |         5.02 |  -1.2% |       6.78 |      6.01 | -11.5% |
| Indexed update     |          5.61 |         5.96 |  +6.2% |       9.32 |     10.04 |  +7.7% |
| Range query        |          6.02 |         5.99 |  -0.6% |      11.11 |      8.98 | -19.1% |
| Indexed create     |          8.63 |         8.91 |  +3.3% |      10.58 |     10.72 |  +1.3% |
| Database deletion  |          4.66 |         4.67 |  +0.2% |       4.66 |      4.67 |  +0.2% |

The largest regressions were on reads. Point-read p95 rose from 1.04 to 1.36 ms, while update-read p95 rose from 1.97 to 2.61 ms. Those are increases of about 31% and 32%, but the absolute changes were 0.32 and 0.63 ms.

Primary scans improved across the distribution. Their average fell by 7.4%, p95 by 21.8%, and p99 by 27.4%. Range-query median was nearly unchanged, but its p95 fell by 19.1% and p99 by 20.8%. This indicates a narrower latency distribution rather than a large change to typical range-query time.

Seed creates also improved. Average latency fell from 5.26 to 5.01 ms, p95 from 6.78 to 6.01 ms, and p99 from 11.50 to 9.50 ms.

Indexed updates moved in the other direction at the center of the distribution. Their median rose by 6.2%, average by 7.8%, and p95 by 7.7%. The p99 was effectively unchanged at about 11.6 ms. Indexed creates were mostly flat: median and p95 rose slightly, while average and p99 fell slightly.

## Overall latency

| Statistic | Before | After | Change |
| --------- | -----: | ----: | -----: |
| Median    |   2.83 |  3.05 |  +7.6% |
| Average   |   3.10 |  3.13 |  +1.0% |
| p95       |   8.20 |  8.18 |  -0.2% |
| p99       |  10.54 | 10.31 |  -2.3% |
| Maximum   |  70.02 | 35.30 | -49.6% |

The overall median increased because point reads, the largest request group, became slower. Average latency was almost unchanged. The p95 remained flat and the p99 improved slightly.

Maximum latency dropped for every substantial operation group:

- Point read: 40.68 to 12.36 ms
- Update read: 21.12 to 11.33 ms
- Primary scan: 46.04 to 11.54 ms
- Seed create: 34.97 to 19.07 ms
- Indexed update: 70.02 to 35.30 ms
- Range query: 48.45 to 15.57 ms
- Indexed create: 54.24 to 20.45 ms

Maxima are noisy, but the consistent reduction matches the lower scan and query tails seen at p95 and p99.

## Run duration and traffic

The byte counts were effectively identical: about 243 MiB sent and 384 MiB received in each run. This supports that both runs performed the same work with equivalent payload sizes.

The summary-wide HTTP rate increased from 230.7 to 244.5 requests per second, about 6%. Total measured time fell from roughly 633 to 597 seconds. This rate includes sequential seeding, so it does not indicate a higher active-workload rate. Both active workloads used the same fixed arrival rates and completed every scheduled iteration.

## Assessment

The after build completed the same work without changing correctness or reliability. Its main cost was higher point-read and update-read latency, though both remained low in absolute terms. Indexed updates were also modestly slower. In return, primary scans, range-query tails, seed writes, and worst-case request times improved.

There is no broad latency regression in these results. Overall average, p95, and p99 stayed close or improved, while the median rose by 0.22 ms. One run per build is not enough to attribute every difference to the code change, especially the large changes in maximum latency. Repeated runs would show which shifts are stable.
