#!/bin/sh
set -eu

(cd prototype && mise run build)

port=$((20000 + ($$ % 20000)))
addr="${KANTAN_E2E_ADDR:-127.0.0.1:$port}"
base_url="http://$addr"
database="e2e-$$"
data_dir=$(mktemp -d "${TMPDIR:-/tmp}/kantan-e2e.XXXXXX")
log_file="$data_dir/server.log"

./prototype/kantan -addr "$addr" -data "$data_dir/db" >"$log_file" 2>&1 &
server_pid=$!

cleanup() {
    status=$?
    trap - EXIT
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true

    if [ "$status" -ne 0 ]; then
        printf '\nServer log:\n' >&2
        cat "$log_file" >&2
    fi

    rm -rf "$data_dir"
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Wait until the new process accepts requests.
hurl --test --retry 30 --retry-interval 100ms \
    --variable "base_url=$base_url" e2e/health.hurl

hurl --test --jobs 1 \
    --variable "base_url=$base_url" \
    --variable "database=$database" e2e/*.hurl
