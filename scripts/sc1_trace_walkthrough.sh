#!/usr/bin/env bash
# scripts/sc1_trace_walkthrough.sh — Phase 3 Plan 03-02 Task 4 walkthrough driver.
#
# Creates a clean workspace, runs pi-emmy --print with a multi-tool prompt, and
# records events.jsonl under runs/<session>/. The operator verifies that
# traces appear in Langfuse UI at http://localhost:3000 and that every span
# carries emmy.profile.{id,version,hash} attributes.
#
# Preconditions (fail-loud on missing):
#   - emmy-serve reachable at 127.0.0.1:8002 (scripts/start_emmy.sh)
#   - Langfuse stack healthy (scripts/start_observability.sh)
#   - LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY exported in env
#   - pi-emmy on PATH (bun link from packages/emmy-ux)
#
# Usage:
#   bash scripts/sc1_trace_walkthrough.sh [--no-telemetry | --telemetry-off]
#
# Exit codes: 0 = pi-emmy exited clean; non-zero = pi-emmy failure.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

WORK_DIR="/tmp/emmy-p3-w2-walkthrough"
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

# A richer-than-Phase-2-SC-1 prompt to exercise read + grep + edit + write + bash
# and validate that each produces an emitEvent/turn_start span visible in Langfuse.
PROMPT='Create src/hello.ts that exports function greet(name: string): string returning "Hello, " + name. Add a test in src/hello.test.ts using bun test that asserts greet("world") === "Hello, world". Run bun test and report the result. Show me the final state of both files.'

cd "$WORK_DIR"

# Initialize a minimal workspace so pi-emmy picks up a working bun project.
cat > package.json <<'EOF'
{
  "name": "emmy-walkthrough",
  "version": "0.1.0",
  "type": "module"
}
EOF
cat > tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["bun-types"]
  }
}
EOF

WALKTHROUGH_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --no-telemetry)
      WALKTHROUGH_ARGS+=("--no-telemetry")
      ;;
    --telemetry-off)
      export EMMY_TELEMETRY=off
      ;;
  esac
done

echo "=== pi-emmy SC-1 walkthrough (Phase 3 Wave 2) ===" >&2
echo "work_dir: $WORK_DIR" >&2
echo "prompt:   $PROMPT" >&2

set +e
pi-emmy --print "$PROMPT" "${WALKTHROUGH_ARGS[@]}" 2> stderr.log
EXIT=$?
set -e

echo "=== stderr tail ===" >&2
tail -20 stderr.log >&2

# Locate the session dir under runs/ (pi-emmy created it under cwd).
SESSION_DIR=$(find "$WORK_DIR/runs" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort | tail -1)
if [[ -n "$SESSION_DIR" && -f "$SESSION_DIR/events.jsonl" ]]; then
  echo "=== events.jsonl sample (first 3 lines) ===" >&2
  head -3 "$SESSION_DIR/events.jsonl" >&2
  echo "..." >&2
  echo "=== events.jsonl tail (last 3 lines) ===" >&2
  tail -3 "$SESSION_DIR/events.jsonl" >&2
  echo "=== line count ===" >&2
  wc -l "$SESSION_DIR/events.jsonl" >&2
  echo "=== emmy.profile.hash occurrences in JSONL ===" >&2
  grep -c 'emmy.profile.hash\|"hash"' "$SESSION_DIR/events.jsonl" >&2 || true
fi

exit $EXIT
