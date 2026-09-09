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
