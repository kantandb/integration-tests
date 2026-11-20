#!/bin/sh
set -eu

if [ "$#" -lt 1 ]; then
    printf 'Usage: %s <test.js> [phase ...]\n' "$0" >&2
    exit 2
fi

script=$1
shift
if [ "$#" -eq 0 ]; then
    set -- default
fi

(cd server-go && mise run build)

port=$((40000 + ($$ % 20000)))
addr="${KANTAN_K6_ADDR:-127.0.0.1:$port}"
base_url="http://$addr"
bulk_concurrency="${KANTAN_K6_BULK_CONCURRENCY:-1}"
data_dir=$(mktemp -d "${TMPDIR:-/tmp}/kantan-k6.XXXXXX")
log_file="$data_dir/server.log"
key_file="$data_dir/kantan.key"

openssl rand -base64 32 >"$key_file"
chmod 600 "$key_file"

server_pid=

stop_server() {
    if [ -n "$server_pid" ]; then
        kill "$server_pid" 2>/dev/null || true
        wait "$server_pid" 2>/dev/null || true
        server_pid=
    fi
}

cleanup() {
    status=$?
    trap - EXIT
    stop_server

    if [ "$status" -ne 0 ]; then
        printf '\nServer log:\n' >&2
        cat "$log_file" >&2
    fi

    rm -rf "$data_dir"
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Restart between phases, preserving the key and storage for durability checks.
for phase in "$@"; do
    case "$phase" in
        limits) flags="-max-body-bytes 256 -bulk-max-bytes 512 -bulk-max-documents 3 -bulk-max-batch-bytes 4096" ;;
        batch) flags="-bulk-max-batch-bytes 1" ;;
        timeout) flags="-bulk-timeout 1ns" ;;
        bulk) flags="-bulk-concurrency 1" ;;
        *) flags="" ;;
    esac

    printf '\nPhase: %s\n' "$phase" >>"$log_file"
    # Flags contain only the fixed profiles above.
    ./server-go/kantan -addr "$addr" -data "$data_dir/db" -key-file "$key_file" \
        -bulk-concurrency "$bulk_concurrency" $flags >>"$log_file" 2>&1 &
    server_pid=$!

    hurl --test --retry 30 --retry-interval 100ms \
        --variable "base_url=$base_url" hurl/health.hurl

    if [ -n "${K6_SUMMARY_EXPORT:-}" ]; then
        summary=$K6_SUMMARY_EXPORT
        if [ "$phase" != default ]; then
            summary="${summary%.json}-$phase.json"
        fi
        k6 run --summary-export "$summary" --env "BASE_URL=$base_url" \
            --env "TEST_RUN=$$" --env "TEST_PHASE=$phase" "$script"
    else
        k6 run --env "BASE_URL=$base_url" \
            --env "TEST_RUN=$$" --env "TEST_PHASE=$phase" "$script"
    fi

    stop_server
done
