# Agent Guide

## Repository

- This repository tests the KantanDB HTTP API with Hurl and k6.
- `server-go/` is the API source-of-truth submodule.
- Hurl integration tests live in `hurl/*.hurl`.
- k6 tests live in `k6/correctness`, `k6/reliability`, and `k6/performance`.
- Both runners build `server-go/kantan`, start it with a temporary key and storage, and remove all temporary state.
- Executable reliability tests live in `reliability/api.py` and use the Python 3 standard library.
- `hurl/run.sh` supplies `base_url` and a unique `database`; `k6/run.sh` supplies `BASE_URL`.

## Commands

Use Mise tasks:

```sh
mise run hurlfmt-check     # Check Hurl formatting
mise run hurl              # Run Hurl integration tests
mise run k6                # Run all k6 correctness tests
mise run k6-load           # Run CRUD reliability load
mise run k6-etag           # Run concurrent conditional writes
mise run k6-range          # Run jq range filters
mise run k6-query          # Run concurrent QUERY and writes
mise run k6-bulk           # Run bulk transfer correctness
mise run k6-api            # Run API validation and mutation contracts
mise run k6-pages          # Run pagination and query plan correctness
mise run reliability       # Run restart, cancellation, and boundary tests
mise run k6-benchmark      # Run mixed storage benchmark
mise run k6-bulk-benchmark # Run bulk transfer benchmark
mise run check             # Run Hurl formatting and integration tests
```

Each k6 task starts a separate server. Configuration variables and defaults are documented in `README.md` and declared near the top of each script. Set `K6_SUMMARY_EXPORT` to write a JSON summary.

## Test conventions

### Hurl

- Capture generated IDs and ETags; do not hardcode them.
- Keep related stateful requests in one file and delete created resources.
- Assert status codes, response data, and relevant headers.
- Assert public errors through `$.error.code` and, when significant, `$.error.message`.
- Keep requests ordered; the suite runs with one Hurl job.
- Update existing lifecycle coverage when API behavior changes.

### k6

- Put correctness, reliability, and performance coverage in the matching directory.
- Give databases unique names and delete them after use; use `setup()` and `teardown()` for shared state.
- Validate environment values before running a scenario.
- Use checks for API behavior and thresholds for suite guarantees.
- Tag requests by operation so thresholds and benchmark output stay useful.
- Keep benchmark settings fixed when comparing revisions.

## Definition of done

Run `mise run check`. Run the affected k6 task for k6 changes; run `mise run k6` when shared correctness behavior changes. Run `mise run reliability` for executable reliability changes.
