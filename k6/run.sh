#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
    printf 'Usage: %s <test.js>\n' "$0" >&2
    exit 2
fi

script=$1

(cd prototype && mise run build)

port=$((40000 + ($$ % 20000)))
addr="${KANTAN_K6_ADDR:-127.0.0.1:$port}"
base_url="http://$addr"
data_dir=$(mktemp -d "${TMPDIR:-/tmp}/kantan-k6.XXXXXX")
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

# Wait until the server accepts requests.
hurl --test --retry 30 --retry-interval 100ms \
    --variable "base_url=$base_url" hurl/health.hurl

k6 run --env "BASE_URL=$base_url" "$script"
