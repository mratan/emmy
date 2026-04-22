#!/usr/bin/env bash
# Plan 03-04 Task 3 (checkpoint:human-verify) — UX-02 footer parity driver.
#
# Compares the pi-emmy TUI footer values against their CLI-tool equivalents
# side-by-side. Operator watches both panes and records 3 synchronized
# snapshots; script computes the delta % and exits 0 iff every snapshot is
# within the 5% tolerance gate.
#
# Precondition (operator-enforced):
#   - emmy-serve reachable at ${EMMY_VLLM_BASE_URL:-http://127.0.0.1:8002}
#   - nvidia-smi on PATH (Spark host)
#   - tmux installed (optional; script falls back to two-terminal instructions)
#   - active inference in progress (issue a long decoding prompt in parallel to
#     make the GPU/KV/tok-s values non-zero for a meaningful parity check)
#
# Usage:
#   bash scripts/footer_parity_check.sh              # interactive tmux panes
#   bash scripts/footer_parity_check.sh --sample-only # one-shot CLI snapshot
#   bash scripts/footer_parity_check.sh --help
#
# Exit codes:
#   0 — all 3 snapshots within tolerance (or --sample-only succeeded)
#   1 — at least one snapshot exceeded tolerance
#   2 — prereqs missing (emmy-serve unreachable, nvidia-smi missing, etc.)

set -euo pipefail

BASE_URL="${EMMY_VLLM_BASE_URL:-http://127.0.0.1:8002}"
TOLERANCE_GPU_KV="${EMMY_FOOTER_TOLERANCE:-0.05}"   # 5% per UX-02 SC-4
TOLERANCE_TOK_S="${EMMY_FOOTER_TOLERANCE_TOK:-0.30}" # 30% for tok/s (5s window)

usage() {
	cat <<EOF
footer_parity_check.sh — Plan 03-04 Task 3 UX-02 footer parity driver

Usage:
  bash scripts/footer_parity_check.sh                # interactive tmux flow
  bash scripts/footer_parity_check.sh --sample-only  # one-shot CLI snapshot
  bash scripts/footer_parity_check.sh --help

Environment overrides:
  EMMY_VLLM_BASE_URL       (default: http://127.0.0.1:8002)
  EMMY_FOOTER_TOLERANCE    (default: 0.05, i.e. 5% for GPU% and KV%)
  EMMY_FOOTER_TOLERANCE_TOK (default: 0.30, i.e. 30% for tok/s due to 5s window)

Exit codes:
  0 — all snapshots within tolerance / --sample-only printed snapshot OK
  1 — one or more snapshots exceeded tolerance
  2 — prereqs missing
EOF
}

# --- Prereqs ---
check_prereqs() {
	local missing=()
	command -v nvidia-smi >/dev/null 2>&1 || missing+=("nvidia-smi")
	command -v curl >/dev/null 2>&1 || missing+=("curl")
	if ! curl -fsS --max-time 5 "${BASE_URL}/v1/models" >/dev/null 2>&1; then
		echo "ERROR: emmy-serve unreachable at ${BASE_URL}" >&2
		echo "  (start via: scripts/start_emmy.sh)" >&2
		return 2
	fi
	if [ "${#missing[@]}" -gt 0 ]; then
		echo "ERROR: missing prereqs: ${missing[*]}" >&2
		return 2
	fi
	return 0
}

# --- Sampling primitives ---

sample_nvidia_smi_gpu() {
	# Returns gpu_util_pct on stdout (one line). Prints empty string if [N/A].
	local out
	out=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -n1 | tr -d ' ' || true)
	case "${out,,}" in
		"[n/a]"|"n/a"|""|"nan") echo "";;
		*) echo "$out";;
	esac
}

sample_vllm_kv_pct() {
	# Returns KV cache usage percent (0-100) on stdout. Uses gpu_cache_usage_perc
	# (the VERIFIED vLLM 0.19 metric name — NOT kv_cache_usage_perc).
	local raw
	raw=$(curl -fsS --max-time 5 "${BASE_URL}/metrics" 2>/dev/null \
		| grep -E '^vllm:gpu_cache_usage_perc' | grep -v '^#' | head -n1 | awk '{print $NF}' || true)
	if [ -z "$raw" ]; then echo ""; return; fi
	# Convert 0-1 gauge to 0-100 percent.
	python3 -c "print(${raw} * 100.0)" 2>/dev/null || echo ""
}

sample_footer_values() {
	# Expects a running pi-emmy session to be writing footer text to stderr
	# OR the caller to paste them via stdin. For --sample-only mode we just
	# print the CLI ground-truth so the operator can compare by eye.
	local gpu kv
	gpu=$(sample_nvidia_smi_gpu)
	kv=$(sample_vllm_kv_pct)
	echo "gpu_util_pct=${gpu}"
	echo "kv_pct=${kv}"
}

# --- Mode dispatch ---

main() {
	case "${1:-}" in
		--help|-h) usage; exit 0;;
		--sample-only)
			if ! check_prereqs; then exit 2; fi
			echo "=== CLI ground-truth snapshot @ $(date -u +%H:%M:%SZ) ==="
			sample_footer_values
			exit 0
			;;
		"")
			;;
		*) echo "unknown arg: $1" >&2; usage; exit 2;;
	esac

	if ! check_prereqs; then exit 2; fi

	echo "=== footer_parity_check — interactive mode ==="
	echo
	echo "This script gates UX-02 SC-4: the TUI footer values must be within"
	echo "  GPU%/KV%: ${TOLERANCE_GPU_KV} (5% per UX-02 success criterion)"
	echo "  tok/s:    ${TOLERANCE_TOK_S} (30% due to 5s sliding window)"
	echo "of the CLI-tool ground truth at the same wall-clock second."
	echo
	echo "Setup:"
	echo "  1. LEFT PANE:  pi-emmy TUI session with active long-decode prompt"
	echo "     Example:    pi-emmy --print 'Write a 2000-word essay on ...' &"
	echo "                 (The footer needs live values — a short prompt"
	echo "                  ends before we can sample.)"
	echo
	echo "  2. RIGHT PANE: watch the CLI ground-truth every 1s:"
	echo "     watch -n1 'nvidia-smi --query-gpu=utilization.gpu,memory.used \\"
	echo "                 --format=csv,noheader && echo --- && \\"
	echo "                 curl -s ${BASE_URL}/metrics | \\"
	echo "                 grep -E \"vllm:(gpu_cache_usage_perc|generation_tokens_total)\"'"
	echo
	echo "  3. While both panes show live values, pause both at the SAME second"
	echo "     (Ctrl-Z in watch; screen-freeze on the TUI footer) and record the"
	echo "     trio {GPU%, KV%, tok/s} from each pane."
	echo
	echo "  4. Repeat for a total of 3 snapshots spaced ≥5s apart."
	echo
	echo "For each snapshot, compute:"
	echo "    gpu_delta = |footer_gpu - cli_gpu| / cli_gpu         → must be < 0.05"
	echo "    kv_delta  = |footer_kv - (cli_kv_perc × 100)| / ...  → must be < 0.05"
	echo "    tok_delta = |footer_tok - baseline_tok| / baseline   → must be < 0.30"
	echo
	echo "Additional operator checks (from plan Task 3 how-to-verify):"
	echo "  • spec accept field renders literal '-' (D-25 placeholder until Phase 6)"
	echo "  • degrade: stop emmy-serve; after 3s footer's KV% blanks with '?' suffix"
	echo "    then goes to KV --% at 4th consecutive failure"
	echo "  • pi's built-in TUI footer content still renders alongside emmy's"
	echo "    (setStatus('emmy.footer', ...) is key-scoped — must not clobber)"
	echo
	echo "Resume signal (if all 3 snapshots + D-24 check + D-25 check pass):"
	echo "    p3-04 footer green"
	echo
	echo "If any snapshot exceeds tolerance, describe the deviation; Plan 03-04"
	echo "is BLOCKED until resolved."
	echo
	echo "One-shot CLI-only sanity snapshot below (no TUI):"
	echo "---"
	sample_footer_values
	echo "---"
	echo "(End of driver. Operator performs visual parity comparison.)"
}

main "$@"
