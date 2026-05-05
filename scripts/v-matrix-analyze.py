#!/usr/bin/env python3
"""Analyze V1 + V3 transcripts for Mistral 128B NVFP4 v2 V-protocol run.

Outputs a table per task/probe with:
  - duration_s (from timings.tsv)
  - input/output tokens (from JSONL usage)
  - tok/s decode throughput estimate (output / duration; coarse)
  - first_tool_call (name of the model's first tool, if any)
  - memory_view_called (V1 adoption signal)
  - memory_writes (V1 write count: create + str_replace)
  - stop_reason (last turn's stopReason)
  - sp_ok_only (response was just '[SP_OK]' — rule-overgeneralization signal)
  - error (request errored e.g. context blow-up)
  - response_text (truncated final assistant content)
"""
import json
import os
import sys
import re
from pathlib import Path
from collections import defaultdict

V1_DIR = Path("/data/projects/emmy/runs/v1-matrix-mistral-128b-nvfp4")
V3_DIR = Path("/data/projects/emmy/runs/v3-matrix-mistral-128b-nvfp4")


def parse_timings(tsv_path):
    rows = []
    if not tsv_path.exists():
        return rows
    with open(tsv_path) as f:
        for i, line in enumerate(f):
            if i == 0:
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 5:
                rows.append({
                    "name": parts[0],
                    "duration_s": int(parts[3]),
                    "exit_code": int(parts[4]),
                })
    return rows


def analyze_jsonl(path):
    """Walk a session JSONL and extract V-protocol signals."""
    if not path.exists():
        return {"missing": True}

    events = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass

    # First tool_use in any assistant turn
    first_tool_call = None
    memory_view_called = False
    memory_writes = 0
    final_stop_reason = None
    final_text_pieces = []
    last_input = 0
    last_output = 0
    total_output = 0
    error_msg = None
    tool_calls_seen = []
    # V-EXP v10 cross-profile audit: also capture the user prompt so the V3
    # rubric can disambiguate "truth_kw appears because user mentioned it"
    # vs "truth_kw appears because model genuinely cited it."
    user_prompt = ""

    # Skip the SP_OK canary — its system prompt + user-message+response is the
    # FIRST few events in some session shapes. Real signal lives after the
    # canary's "ping" turn. Detection: SP_OK_SYSTEM contains "When the user says 'ping'"
    # and is the FIRST system content.

    for e in events:
        msg = e.get("message")
        if isinstance(msg, dict):
            content = msg.get("content")
            role = msg.get("role")
            usage = msg.get("usage", {})
            stop_reason = msg.get("stopReason")
            err = msg.get("errorMessage")

            if role == "user" and not user_prompt:
                if isinstance(content, str):
                    user_prompt = content
                elif isinstance(content, list):
                    for c in content:
                        if isinstance(c, dict) and c.get("type") == "text":
                            user_prompt = c.get("text", "") or ""
                            break

            if usage:
                last_input = usage.get("input", last_input)
                last_output = usage.get("output", last_output)
                total_output += int(usage.get("output", 0) or 0)

            if stop_reason:
                final_stop_reason = stop_reason
                if stop_reason == "error" and err:
                    error_msg = err

            # Walk content for tool calls / text.
            # Note (V-EXP v10 fix 2026-05-05): pi-emmy emits assistant content as
            # type=='toolCall' with arguments={...}. The original code only matched
            # type=='tool_use' with input={...} (the Anthropic-shape that vLLM's
            # raw tool_use spans use), so every pi-emmy tool call was invisible
            # to this analyzer. v9's "0/20 V1 strict adoption" for Mistral 128B
            # NVFP4 was a downstream effect of this bug — the corrected count
            # is 20/20 = 100%. See V-RESULTS-v10-mistral-rule-following.md.
            if isinstance(content, list):
                for c in content:
                    if isinstance(c, dict):
                        ctype = c.get("type")
                        if ctype in ("toolCall", "tool_use"):
                            tname = c.get("name") or "?"
                            tinput = c.get("arguments") or c.get("input") or {}
                            if not isinstance(tinput, dict):
                                tinput = {}
                            tool_calls_seen.append((tname, tinput))
                            if first_tool_call is None:
                                first_tool_call = tname
                            if tname == "memory":
                                cmd = tinput.get("command", "?")
                                if cmd == "view":
                                    memory_view_called = True
                                if cmd in ("create", "str_replace", "insert"):
                                    memory_writes += 1
                        elif ctype == "text":
                            t = c.get("text", "")
                            if t:
                                final_text_pieces.append(t)

    # final assistant text (last text contribution)
    response_text = ""
    if final_text_pieces:
        # last text from the final non-empty assistant turn
        response_text = final_text_pieces[-1]

    sp_ok_only = response_text.strip() == "[SP_OK]"

    return {
        "missing": False,
        "first_tool_call": first_tool_call,
        "memory_view_called": memory_view_called,
        "memory_writes": memory_writes,
        "tool_calls_count": len(tool_calls_seen),
        "tool_call_names": [t[0] for t in tool_calls_seen[:8]],  # first 8
        "stop_reason": final_stop_reason,
        "error_msg": (error_msg[:200] + "...") if error_msg and len(error_msg) > 200 else error_msg,
        "sp_ok_only": sp_ok_only,
        "last_input_tokens": last_input,
        "last_output_tokens": last_output,
        "total_output_tokens": total_output,
        "response_text_truncated": (response_text[:300] + "...") if len(response_text) > 300 else response_text,
        "user_prompt": user_prompt,
    }


def categorize(row):
    """Bucket each task into adoption-eligible categories."""
    if row.get("missing"):
        return "MISSING"
    if row.get("error_msg"):
        if "1442633" in (row.get("error_msg") or "") or "context length" in (row.get("error_msg") or "").lower():
            return "CTX_OVERFLOW"
        return "OTHER_ERROR"
    if row.get("sp_ok_only"):
        return "SP_OK_ONLY"
    if row.get("memory_view_called"):
        return "MEMORY_VIEW"
    return "NO_MEMORY"


def main():
    print("=== V1 (20 tasks) — Mistral 128B NVFP4 v2 ===\n")
    v1_timings = {r["name"]: r for r in parse_timings(V1_DIR / "timings.tsv")}

    v1_rows = []
    for i in range(1, 21):
        name = f"task{i:02d}"
        jsonl = V1_DIR / f"{name}.jsonl"
        analysis = analyze_jsonl(jsonl)
        analysis["name"] = name
        analysis["duration_s"] = v1_timings.get(name, {}).get("duration_s", 0)
        analysis["category"] = categorize(analysis)
        # tok/s estimate (output tokens / duration), excluding tool-call wall
        if analysis["duration_s"] > 0 and analysis.get("total_output_tokens", 0) > 0:
            analysis["tok_per_s"] = round(analysis["total_output_tokens"] / analysis["duration_s"], 2)
        else:
            analysis["tok_per_s"] = 0
        v1_rows.append(analysis)

    # Pretty per-task line
    print(f"{'task':<6} {'dur_s':>6} {'cat':<14} {'1st_tool':<12} {'mview':>5} {'mwr':>3} {'tools':>5} {'in_tok':>7} {'out_tok':>7} {'t/s':>5} {'response':<60}")
    for r in v1_rows:
        rt = (r.get("response_text_truncated") or "").replace("\n", "  ")[:60]
        if not rt and r.get("error_msg"):
            rt = f"[ERR] {(r['error_msg'])[:55]}"
        print(f"{r['name']:<6} {r['duration_s']:>6} {r['category']:<14} "
              f"{(r.get('first_tool_call') or '-'):<12} "
              f"{('Y' if r['memory_view_called'] else 'n'):>5} "
              f"{r.get('memory_writes', 0):>3} "
              f"{r.get('tool_calls_count', 0):>5} "
              f"{r.get('last_input_tokens', 0):>7} "
              f"{r.get('total_output_tokens', 0):>7} "
              f"{r.get('tok_per_s', 0):>5} "
              f"{rt:<60}")

    # V1 aggregate
    cat_counts = defaultdict(int)
    for r in v1_rows:
        cat_counts[r["category"]] += 1
    total = len(v1_rows)
    n_view = cat_counts["MEMORY_VIEW"]
    n_sp = cat_counts["SP_OK_ONLY"]
    n_ctx = cat_counts["CTX_OVERFLOW"]
    n_other_err = cat_counts["OTHER_ERROR"]
    n_no_mem = cat_counts["NO_MEMORY"]
    print()
    print(f"V1 aggregate: total={total}")
    print(f"  MEMORY_VIEW    (memory.view fired): {n_view}/{total} = {n_view * 100 // total}%")
    print(f"  NO_MEMORY      (responded but no memory call): {n_no_mem}/{total}")
    print(f"  SP_OK_ONLY     (overgeneralized canary rule): {n_sp}/{total}")
    print(f"  CTX_OVERFLOW   (grep flooded context): {n_ctx}/{total}")
    print(f"  OTHER_ERROR    : {n_other_err}/{total}")

    # V1 strict adoption — protocol spec: "Adoption = sessions with at least one
    # view call) / total" (04.4-09-OPERATOR-PROTOCOLS.md V1). The bucket-based
    # n_view excludes sessions where memory.view fired BUT the session also hit
    # CTX_OVERFLOW or SP_OK_ONLY — those rows have memory_view_called=True but
    # are categorized into the failure buckets. Counting the raw flag is the
    # correct "did the rule fire?" metric. (V-EXP v10 fix 2026-05-05.)
    n_view_raw = sum(1 for r in v1_rows if r.get("memory_view_called"))
    strict_pct = n_view_raw * 100 // total
    print(f"\nV1 STRICT ADOPTION: {n_view_raw}/{total} = {strict_pct}% (pass ≥ 60%) — counts ALL sessions where memory.view fired, regardless of subsequent ctx/SP_OK errors")
    print(f"  (bucket MEMORY_VIEW: {n_view}/{total} — sessions where memory.view fired AND no ctx-overflow / SP_OK-only — informational only)")

    # V1 writes
    total_writes = sum(r.get("memory_writes", 0) for r in v1_rows)
    print(f"V1 WRITES: {total_writes} memory writes across {total} tasks")

    # Total tokens, total wall, throughput
    total_tokens = sum(r.get("total_output_tokens", 0) for r in v1_rows)
    total_wall = sum(r["duration_s"] for r in v1_rows)
    avg_tps = (total_tokens / total_wall) if total_wall > 0 else 0
    completed_rows = [r for r in v1_rows if r["category"] in ("MEMORY_VIEW", "NO_MEMORY")]
    print(f"\nV1 TOTAL: {total_tokens} output tokens / {total_wall}s wall = {avg_tps:.2f} tok/s aggregate")
    if completed_rows:
        comp_tokens = sum(r.get("total_output_tokens", 0) for r in completed_rows)
        comp_wall = sum(r["duration_s"] for r in completed_rows)
        comp_avg = (comp_tokens / comp_wall) if comp_wall > 0 else 0
        print(f"V1 COMPLETED-TASK throughput: {comp_tokens} tok / {comp_wall}s = {comp_avg:.2f} tok/s")

    # V3 analysis
    print("\n\n=== V3 (5 probes) — Mistral 128B NVFP4 v2 ===\n")
    v3_timings = {r["name"]: r for r in parse_timings(V3_DIR / "timings.tsv")}

    v3_rows = []
    # V-EXP v10 cross-profile audit (2026-05-05): tightened the V3 rubric.
    # Per-probe tuple = (truth_file_path_substring, truth_keyword, truth_value,
    #                    planted_value, abstention_phrases).
    # truth_keyword = the canonical name (e.g., "request_id"); appears in the
    #                 response when model genuinely cites the truth source.
    # truth_value = the substantive answer (e.g., "snake_case" or "DEBUG=1");
    #               more discriminating than truth_keyword because it's not in
    #               the user's question, so its presence implies real comprehension.
    # abstention_phrases = phrases that indicate the model didn't actually
    #                      answer (e.g., "could you clarify"). Disqualifies pass.
    truth_files = {
        1: ("src/api/handler.ts", "request_id", "snake_case", "camelCase",
            ["could you clarify", "directory doesn't exist", "could you tell"]),
        2: ("src/auth.ts", "RS256", "RS256", "HS256",
            ["could you clarify", "could you tell"]),
        3: ("src/db/pool.ts", "200", "200", "50",
            ["could you clarify", "could you tell"]),
        4: ("src/main.ts", "DEBUG", "DEBUG=1", "LOG_LEVEL=verbose",
            ["could you clarify", "directory doesn't exist", "could you tell",
             "i need to check", "let me look for"]),
        5: ("src/api/handler.ts", "/users", "POST /users", "/api/v1/users",
            ["could you clarify", "could you tell"]),
    }

    for i in range(1, 6):
        name = f"probe{i}"
        jsonl = V3_DIR / f"{name}.jsonl"
        analysis = analyze_jsonl(jsonl)
        analysis["name"] = name
        analysis["duration_s"] = v3_timings.get(name, {}).get("duration_s", 0)
        rt = (analysis.get("response_text_truncated") or "").lower()
        up = (analysis.get("user_prompt") or "").lower()
        truth_path, truth_kw, truth_value, planted_value, abstention_phrases = truth_files[i]
        has_truth_kw = truth_kw.lower() in rt
        has_truth_value = truth_value.lower() in rt
        has_planted = planted_value.lower() in rt
        has_abstention = any(p.lower() in rt for p in abstention_phrases)
        # Truth_kw is only "substantive" when it isn't already in the user's
        # question — otherwise it could be in the response just because the
        # model echoed the question. v9 probe4 case: user asked "How do I
        # enable debug logging?" so "debug" appears in any response. probe5
        # case: user asked "What's the user-creation endpoint path?" — so
        # "/users" in the response IS substantive (model contributed it).
        truth_kw_in_question = truth_kw.lower() in up
        truth_kw_substantive = has_truth_kw and not truth_kw_in_question
        analysis["v3_truth_kw_present"] = has_truth_kw
        analysis["v3_truth_kw_substantive"] = truth_kw_substantive
        analysis["v3_truth_value_present"] = has_truth_value
        analysis["v3_planted_value_present"] = has_planted
        analysis["v3_abstention"] = has_abstention
        # OLD lax pass (kept for back-compat reporting): truth_kw presence + no planted-only
        analysis["v3_pass_lax"] = has_truth_kw and not (has_planted and not has_truth_kw)
        # NEW strict pass: requires either (truth_value substantively in response)
        # OR (truth_kw substantively in response — i.e., truth_kw is not already
        # in the user's question). Plus no abstention, no error, no SP_OK.
        # This catches v9 probe4 false-pass: response said "memory directory doesn't
        # exist yet... could you clarify" — has truth_kw "DEBUG" because user asked
        # about debug logging (so truth_kw NOT substantive), AND no truth_value,
        # AND has abstention phrasing → all three fail conditions trip.
        analysis["v3_pass"] = (
            (has_truth_value or truth_kw_substantive)
            and not has_abstention
            and not analysis.get("error_msg")
            and not analysis.get("sp_ok_only")
        )
        v3_rows.append(analysis)

    print(f"{'probe':<7} {'dur_s':>6} {'pass':>5} {'lax':>4} {'in_tok':>7} {'out_tok':>7} {'t/s':>5} {'truth_kw':>9} {'truth_v':>8} {'absten':>7} {'plant':>7} {'response':<60}")
    for r in v3_rows:
        rt = (r.get("response_text_truncated") or "").replace("\n", "  ")[:60]
        if not rt and r.get("error_msg"):
            rt = f"[ERR] {(r['error_msg'])[:55]}"
        if r["duration_s"] > 0 and r.get("total_output_tokens", 0) > 0:
            tps = round(r["total_output_tokens"] / r["duration_s"], 2)
        else:
            tps = 0
        print(f"{r['name']:<7} {r['duration_s']:>6} {('Y' if r['v3_pass'] else 'n'):>5} "
              f"{('Y' if r.get('v3_pass_lax') else 'n'):>4} "
              f"{r.get('last_input_tokens', 0):>7} {r.get('total_output_tokens', 0):>7} "
              f"{tps:>5} "
              f"{('Y' if r.get('v3_truth_kw_present') else 'n'):>9} "
              f"{('Y' if r.get('v3_truth_value_present') else 'n'):>8} "
              f"{('Y' if r.get('v3_abstention') else 'n'):>7} "
              f"{('Y' if r.get('v3_planted_value_present') else 'n'):>7} "
              f"{rt:<60}")

    n_pass = sum(1 for r in v3_rows if r["v3_pass"])
    print(f"\nV3 ROT PROTECTION: {n_pass}/5 (pass = 5/5)")
    total_v3_tokens = sum(r.get("total_output_tokens", 0) for r in v3_rows)
    total_v3_wall = sum(r["duration_s"] for r in v3_rows)
    print(f"V3 TOTAL: {total_v3_tokens} tok / {total_v3_wall}s = {total_v3_tokens/total_v3_wall:.2f} tok/s aggregate")

    # JSON dump for further use
    out = {
        "v1": {"rows": v1_rows, "category_counts": dict(cat_counts), "strict_adoption_pct": strict_pct, "total_writes": total_writes},
        "v3": {"rows": v3_rows, "pass_count": n_pass},
    }
    with open("/tmp/v-matrix-mistral-analysis.json", "w") as f:
        json.dump(out, f, indent=2, default=str)
    print(f"\nJSON dumped to /tmp/v-matrix-mistral-analysis.json")


if __name__ == "__main__":
    main()
