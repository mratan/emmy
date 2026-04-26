#!/usr/bin/env bash
# tests/smoke/verify_memory_airgap.sh
# Phase 04.4 plan 04 — V5 verifier for the memory tool.
#
# Runs MEMORY_AIRGAP_STRESS_OPS=100 mixed memory ops under
# `strace -e trace=network` and asserts the only network syscalls observed
# are loopback (127.0.0.1 / ::1 / 0.0.0.0). The optional OTel exporter at
# localhost:4318 is permitted — it's loopback. Any non-loopback connect()
# fails the check.
#
# Exit codes:
#   0 — clean run, zero non-loopback connect
#   1 — non-loopback connect detected OR bun test failed
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

BUN_BIN="${BUN_BIN:-$HOME/.bun/bin/bun}"

# Run the bun test under strace.
strace -e trace=network -f -o "$LOG" -- "$BUN_BIN" test \
  packages/emmy-tools/tests/memory/airgap-stress.test.ts \
  > /dev/null 2>&1 || {
    echo "verify_memory_airgap: bun test FAILED — see strace log" >&2
    cat "$LOG" >&2
    exit 1
  }

# Look for connect() to non-loopback addresses (sin_addr != 127.0.0.1 / ::1).
# strace output for AF_INET reads like:
#   connect(N, {sa_family=AF_INET, sin_port=htons(P), sin_addr=inet_addr("X.Y.Z.W")}, ...) = ...
BAD_LINES=$(grep -E 'connect\(' "$LOG" \
  | grep -E 'AF_INET|AF_INET6' \
  | grep -vE 'sin_addr=inet_addr\("(127\.0\.0\.1|0\.0\.0\.0)"\)|inet_pton\([^)]*"::1"[^)]*\)|sin6_addr=.*"::1"' \
  || true)

if [[ -n "$BAD_LINES" ]]; then
  echo "verify_memory_airgap: NON-LOOPBACK CONNECT DETECTED — V5 FAIL" >&2
  echo "$BAD_LINES" >&2
  exit 1
fi

echo "verify_memory_airgap: 100 ops completed, zero non-loopback connect — V5 PASS"
exit 0
