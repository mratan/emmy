#!/usr/bin/env bash
# scripts/phase3_1_02_walkthrough.sh — Phase 3.1 Plan 03.1-02 Task 3 driver.
#
# 8-step operator walkthrough for D-33..D-37 acceptance:
#   1. SearxNG stack health
#   2. SearxNG JSON endpoint returns sensible results
#   3. web_search tool end-to-end via pi-emmy
#   4. web_fetch returned-URL bypass (D-35) + T-03.1-02-02 path-mutation denial
#   5. Badge transitions (yellow on SearxNG up, green on down)
#   6. Kill-switch sanity (EMMY_WEB_SEARCH=off)
#   7. Air-gap CI dry-run (both strict + research-egress)
#   8. Append validation_run entry to v3.1/PROFILE_NOTES.md
#
# Prints each step, asks the operator to paste evidence, collects into
# runs/phase3.1-02/walkthrough.md for commit at plan close.
#
# Usage:
#   bash scripts/phase3_1_02_walkthrough.sh
#
# Operator drives this interactively; the orchestrator presses <enter> to
# advance between steps and pastes curl outputs / badge screenshots when asked.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

OUT_DIR="$ROOT_DIR/runs/phase3.1-02"
OUT_FILE="$OUT_DIR/walkthrough.md"
mkdir -p "$OUT_DIR"

V3_1_PROFILE_NOTES="profiles/qwen3.6-35b-a3b/v3.1/PROFILE_NOTES.md"

pause() {
  echo
  echo "  ---- Press ENTER to continue ----"
  read -r _
}

prompt_paste() {
  local label="$1"
  echo
  echo "  Paste $label (end with a single line containing just '.'):"
  local line content=""
  while IFS= read -r line; do
    [[ "$line" == "." ]] && break
    content+="$line"$'\n'
  done
  printf '%s' "$content"
}

write_header() {
  {
    echo "# Phase 3.1 Plan 03.1-02 Task 3 — Operator Walkthrough"
    echo
    echo "- Run date: $(date -u +%FT%TZ)"
    echo "- Host: $(hostname)"
    echo "- Profile: qwen3.6-35b-a3b/v3.1"
    echo "- Driver: scripts/phase3_1_02_walkthrough.sh"
    echo
  } > "$OUT_FILE"
}

append_section() {
  local title="$1"; shift
  {
    echo
    echo "## $title"
    echo
    for arg in "$@"; do
      echo "$arg"
    done
  } >> "$OUT_FILE"
}

echo "============================================================"
echo "Phase 3.1 Plan 03.1-02 Task 3 — Operator Walkthrough"
echo "============================================================"
echo
echo "Collecting evidence into: $OUT_FILE"
write_header

# -------- Step 1 --------
cat <<'EOF'

Step 1 — SearxNG stack health

Run:
  bash scripts/start_searxng.sh

EXPECT: exits 0 within 90s; banner reads "[emmy] SearxNG ready at http://127.0.0.1:8888"

Then run:
  bash observability/searxng/test_stack_healthy.sh

EXPECT: exits 0; prints "searxng: healthy"
EOF
pause
step1_output=$(prompt_paste "start_searxng.sh + test_stack_healthy.sh stdout")
append_section "Step 1 — SearxNG stack health" '```' "$step1_output" '```'

# -------- Step 2 --------
cat <<'EOF'

Step 2 — SearxNG JSON endpoint returns sensible results

Run:
  curl -s 'http://127.0.0.1:8888/search?q=bun+runtime&format=json' | jq '.results | length'

EXPECT: >= 5

Then run:
  curl -s 'http://127.0.0.1:8888/search?q=bun+runtime&format=json' | jq '.results[0] | {title, url, engine}'

EXPECT: title string, url starts with https://, engine is one of google/duckduckgo/brave/bing
EOF
pause
step2_output=$(prompt_paste "curl outputs (both commands)")
append_section "Step 2 — SearxNG JSON endpoint returns sensible results" '```' "$step2_output" '```'

# -------- Step 3 --------
cat <<'EOF'

Step 3 — web_search tool end-to-end via pi-emmy

1. Open pi-emmy in a fresh shell:
     pi-emmy

2. Confirm the boot banner shows [emmy] LOCAL LLM · WEB (yellow) once a
   web_search has been executed. (Boot banner starts green OFFLINE OK; flips
   yellow on first successful search.)

3. Prompt: "Search for the latest Bun release notes and summarize them in 3 bullets."

EXPECT: agent makes a web_search tool call (visible as `tool: web_search` in
the transcript); gets results; summarizes from snippets OR web_fetches one of
the returned URLs.
EOF
pause
step3_output=$(prompt_paste "pi-emmy transcript excerpt + badge observation")
append_section "Step 3 — web_search end-to-end" '```' "$step3_output" '```'

# -------- Step 4 --------
cat <<'EOF'

Step 4 — web_fetch returned-URL bypass (D-35) + T-03.1-02-02 path-mutation

In a separate shell (don't use the agent for this — we're testing the
enforcement directly):

  bun --eval '
    import { enforceWebFetchAllowlist, recordSearchUrl, getOrCreateDefaultStore } from "@emmy/tools";
    const ctx = {
      allowlist: ["docs.python.org"],
      profileRef: { id: "test", version: "v3.1", hash: "sha256:test" },
      recentSearchUrls: getOrCreateDefaultStore(300000),
    };
    recordSearchUrl("https://bun.sh/blog/release-notes");
    try { enforceWebFetchAllowlist("https://bun.sh/blog/release-notes", ctx); console.log("PASS: exact URL bypassed"); } catch (e) { console.log("FAIL:", e.message); }
    try { enforceWebFetchAllowlist("https://bun.sh/evil-path", ctx); console.log("FAIL: hostname substring bypassed"); } catch (e) { console.log("PASS: different path denied"); }
  '

EXPECT: two PASS lines. The integration test at packages/emmy-tools/tests/web-fetch-bypass.test.ts covers this programmatically; this is empirical re-verify.
EOF
pause
step4_output=$(prompt_paste "bun --eval output")
append_section "Step 4 — web_fetch bypass + path-mutation denial" '```' "$step4_output" '```'

# -------- Step 5 --------
cat <<'EOF'

Step 5 — Badge transitions

a. With pi-emmy running and SearxNG up AFTER a web_search: badge = LOCAL LLM · WEB (yellow)
b. Stop SearxNG:  bash scripts/stop_searxng.sh
c. In pi-emmy, ask the agent to search again.
   EXPECT: web_search returns ToolError; badge flips to OFFLINE OK (green).
d. Restart SearxNG: bash scripts/start_searxng.sh
   Next successful web_search flips badge back to LOCAL LLM · WEB (yellow).
EOF
pause
step5_output=$(prompt_paste "badge-state observations (yellow → green → yellow)")
append_section "Step 5 — Badge transitions" '```' "$step5_output" '```'

# -------- Step 6 --------
cat <<'EOF'

Step 6 — Kill-switch sanity

1. Stop pi-emmy.
2. export EMMY_WEB_SEARCH=off
3. Restart pi-emmy.
4. Ask the agent: "What tools do you have?"
   EXPECT: no web_search in the list; web_fetch still works for allowlisted hosts.
EOF
pause
step6_output=$(prompt_paste "tool list showing web_search absent")
append_section "Step 6 — Kill-switch sanity" '```' "$step6_output" '```'

# -------- Step 7 --------
cat <<'EOF'

Step 7 — Air-gap CI dry-run

Run:
  uv run python -m emmy_serve.airgap.ci_verify_phase3 --dry-run
  uv run python -m emmy_serve.airgap.ci_verify_research_egress --dry-run

BOTH must exit 0.
EOF
pause
step7_output=$(prompt_paste "both dry-run outputs")
append_section "Step 7 — Air-gap CI dry-run" '```' "$step7_output" '```'

# -------- Step 8 --------
cat <<'EOF'

Step 8 — Append to v3.1 PROFILE_NOTES.md validation_runs

The planned entry shape is:

  - run_id: phase3.1-02-walkthrough
    hash: <v3.1 hash>
    purpose: "Plan 03.1-02 operator walkthrough — D-33..D-37 SearxNG + web_search + bypass + 3-state badge; verdict p3.1-02 searxng green"
    searxng_stack_healthy: true
    web_search_returns_results: true
    web_fetch_bypass_exact_url_match: true
    badge_3_state_transitions: true
    kill_switch_honored: true

The orchestrator's follow-up commit will add this block to $V3_1_PROFILE_NOTES.

Final verdict: type EXACTLY 'p3.1-02 searxng green' (with single spaces) to complete, or describe the failing step.
EOF
pause
read -r -p "Verdict: " verdict
append_section "Step 8 — Verdict + validation_run entry" "- Verdict: \`$verdict\`" "- v3.1 hash at walkthrough time: \`$(uv run emmy profile hash profiles/qwen3.6-35b-a3b/v3.1/ 2>&1 | tail -1)\`"

echo
echo "============================================================"
echo "Walkthrough evidence written to: $OUT_FILE"
echo "============================================================"
exit 0
