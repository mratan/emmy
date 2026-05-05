# V-protocol cross-profile audit — does the v9 analyzer bug affect other profiles?

**Date:** 2026-05-05
**Trigger:** V-RESULTS-v10 found that v9's reported "Mistral 0/20 V1" was an analyzer bug (looked for `type==tool_use`+`input` but pi-emmy emits `type==toolCall`+`arguments`). Operator asked: do we need to retest the matrix?
**Sources:** preserved transcripts under `.planning/phases/04.4-…/runs/v1-matrix-{qwen-27b-dense,gemma-31b-dense,gemma-26b-moe}/`, `v3-matrix-…/`, plus `runs/v1-matrix-mistral-128b-nvfp4/` (v9), and `v1-adoption-v3` (Qwen 35B-A3B MoE, dropped 2026-04-28).
**Tool:** `runs/v-exp-v10/score_profile.py` — uses corrected `toolCall+arguments` reader, plus stricter V3 rubric (truth_file_read AND truth_kw_in_response).

---

## V1 strict adoption — re-evaluated across all 5 preserved profiles

| Profile | Transcripts | V1 strict (raw memory_view_called) | First-call=memory.view | v8/v9 reported | Drift |
|---|---|---|---|---|---|
| Qwen 27B dense @ v1.1 | 11/20 preserved | **11/11 = 100%** | 11/11 | v8: 20/20 = 100% | ✓ consistent |
| Gemma 31B dense @ v1.1 | 7/20 preserved | **6/7 ≈ 86%** | 6/7 | v8: 19/20 = 95% | ✓ consistent (within sample) |
| Gemma 26B-A4B MoE @ v2 | 20/20 preserved | **20/20 = 100%** | 20/20 | v8: 20/20 = 100% | ✓ consistent |
| Mistral 128B NVFP4 @ v2 | 20/20 preserved | **20/20 = 100%** | 20/20 | **v9: 0/20 = 0%** | **🔴 BUG: was 0/20 reported** |
| Qwen 35B-A3B MoE @ v3.1 (DROPPED) | 8/20 preserved | 4/8 = 50% | 2/8 = 25% | v8: 11/20 = 55% | ≈ consistent (within sample) |

**Findings:**

- The v9 analyzer bug **only affected the Mistral row.** Qwen 27B dense, Gemma 31B dense, and Gemma 26B MoE were scored by v7/v8's analyzer (not v-matrix-analyze.py — the buggy script was authored fresh for v9), and their reported numbers match what the corrected reader sees in the preserved transcripts.
- **No retest of the active matrix needed.** Qwen 27B dense + Gemma 31B dense + Gemma 26B MoE numbers stand. Mistral's "0/20 V1 ceiling" is the single retraction (now 20/20 — see V-RESULTS-v10).
- **Qwen 35B-A3B MoE is dropped from active stack 2026-04-28**, so verifying its 11/20=55% is moot — but the 8 preserved sessions are *consistent* with the v8 number (4/8=50% raw memory_view_called). The 2/8 first-call signal is striking — Qwen MoE is the only profile that does NOT consistently start with memory.view; it often starts with grep/find/bash/web. A possible v8-era reason that profile was below the ≥60% threshold.

---

## Quality breakdown per profile (substantive answers, SP_OK overgeneralization, ctx-overflow)

| Profile | Substantive answers (≥250 out tok, no error, not SP_OK) | SP_OK_ONLY overgeneralization | CTX_OVERFLOW (grep/find tooling fail) | V1 writes |
|---|---|---|---|---|
| Qwen 27B dense | **9/11 = 82%** | 0/11 | 0/11 | 2 (only profile with writes) |
| Gemma 31B dense | **7/7 = 100%** | 0/7 | 0/7 | 0 |
| Gemma 26B-A4B MoE | **11/20 = 55%** | 0/20 | **8/20 = 40%** | 0 |
| Mistral 128B NVFP4 | **6/20 = 30%** | **2/20 = 10%** | **12/20 = 60%** | 0 |
| Qwen 35B-A3B MoE (DROPPED) | 5/8 ≈ 63% | 1/8 ≈ 13% | 1/8 ≈ 13% | 0 |

### Finding 1: SP_OK overgeneralization is NOT Mistral-specific

V-RESULTS-v10 reported SP_OK_ONLY as a Mistral-specific bug (2/20 = 10%). But Qwen 35B-A3B MoE shows it too (1/8 ≈ 13%) — task10 in particular ("What kind of telemetry does the memory tool emit per operation?") triggered `[SP_OK]` from BOTH Mistral AND Qwen MoE. Gemma profiles + Qwen 27B dense are clean.

**Pattern:** SP_OK overgeneralization affects **MoE models when memory returns empty.** Both Mistral 128B (dense, but with attention-heavy routing) and Qwen 35B-A3B (MoE 3B active) show the failure mode; neither Gemma 26B-A4B MoE nor any of the dense profiles do. This is a Phase-5 calibration item:

- **For Mistral:** drop SP_OK from `profiles/mistral-medium-3.5/v2/prompts/system.md` (or move to `[INST]…[/INST]`-framed pre-task hint).
- **For Qwen 35B-A3B MoE:** moot — dropped from active stack. But if re-introduced, same fix.
- **For Gemma profiles:** keep SP_OK as is.

### Finding 2: CTX_OVERFLOW from grep is NOT Mistral-specific either — and it's a tool-side bug

This is the more important finding. Gemma 26B MoE had **8/20 = 40% ctx-overflow** — also from grep on `runs/*.jsonl` matching binary content. Mistral's 12/20 is the worst, but the failure mode is the same.

**Root cause:** the grep tool (`packages/emmy-tools/src/native-tools.ts`):
- Defaults to `-rn` flags
- Truncates output via `truncateHeadTail(out, 100)` — head+tail 100 lines each
- BUT each line could be megabytes (a JSONL transcript line is 50 KB – 1 MB)
- 100 head lines + 100 tail lines from a transcript = 5–200 MB of returned content
- That blows the 131K-token chat completion context on the next turn

**Mistigation that already exists:** the tool uses `-rn` by default which doesn't include `-I` (skip binary files). grep treats JSONL as text because of the embedded printable characters.

**Recommended fix (Phase-5 calibration item):**

```typescript
// packages/emmy-tools/src/native-tools.ts grep tool:
// 1. Add '-I' (skip binary) to default flags: '-rnI'
// 2. Add char-based output cap (analogous to web-fetch.ts truncateHeadTail with maxChars=20000)
//    in addition to line-based truncation
// 3. Optionally: add a default --exclude-dir=runs --exclude-dir=.planning/phases/*/runs
//    so grep doesn't walk the JSONL transcript trees
```

This affects ALL profiles' Phase-5 eval reliability. **Higher priority than the SP_OK fix.**

---

## V3 rot protection — re-evaluated across all 5 preserved profiles

The v9 V3 analyzer used naive keyword-presence matching: did the truth keyword (`"DEBUG"`, `"RS256"`, etc.) appear in the response text? That's a superficial check. Better rubric: response substantively references the truth value (not just echoes the keyword from the user's question), AND ideally the truth-source file appears in the model's tool-call sequence.

Manual hand-scoring (read each response):

| Profile | Probe1 (api-format) | Probe2 (auth) | Probe3 (db-pool) | Probe4 (debug log) | Probe5 (route) | Manual total |
|---|---|---|---|---|---|---|
| Qwen 27B dense | PASS (gold-standard contradiction-surface) | PASS (RS256 cited) | PASS (200 cited from pool.ts) | **PASS (DEBUG=1 cited)** | PASS (/users cited) | **5/5** |
| Gemma 31B dense | PASS (snake_case identified) | PASS (RS256) | PASS (200) | **PASS (DEBUG=1)** | PASS (/users) | **5/5** |
| Gemma 26B-A4B MoE | PASS (snake_case from handler.ts) | PASS (RS256) | PASS (200 from pool.ts) | **PASS (DEBUG=1 cited)** | PASS (/users) | **5/5** |
| Mistral 128B NVFP4 | PASS (gold-standard) | PASS (RS256) | PASS (200) | **FAIL (abstained, asked for clarification)** | PASS (/users) | **4/5 = 80%** |
| Qwen 35B-A3B MoE | **FAIL (confused project — said "confluenSC_sprint2 Python CLI")** | PASS (RS256) | PASS (200) | PASS (DEBUG=1) | PASS (/users) | **4/5 = 80%** |

**Findings:**

- v8's reported V3 = 5/5 for Qwen 27B dense, Gemma 31B dense, Gemma 26B MoE all hold under manual reading. ✓
- v9's reported V3 = 5/5 for Mistral was wrong on probe 4 (corrected: 4/5).
- Qwen 35B-A3B MoE (dropped) had v8 reported 5/5 but probe 1 actually failed (model identified the wrong project). 4/5 corrected.

**v3_pass logic in `scripts/v-matrix-analyze.py` should be tightened.** The current rubric:
```python
analysis["v3_pass"] = has_truth_kw and not (has_planted and not has_truth_kw)
```
…just checks "truth keyword in response and not planted-only." That superficially passes any response that echoes the user's question (probe 4's truth_kw is "DEBUG" — appears in any response that mentions "debug logging"). Better:
```python
analysis["v3_pass"] = has_truth_kw and substantive_answer and not abstention
# where:
#   substantive_answer = response includes the truth_value (e.g., "DEBUG=1") not just the keyword
#   abstention = response ends with "?" or contains phrases like "could you clarify"
```

---

## Should we retest the matrix?

**No.** Based on the preserved transcripts:

| Profile | Need retest? | Why |
|---|---|---|
| Qwen 27B dense @ v1.1 | No | V1 + V3 numbers hold under manual read |
| Gemma 31B dense @ v1.1 | No | Same |
| Gemma 26B-A4B MoE @ v2 | No | Same |
| Mistral 128B NVFP4 @ v2 | **No** | Already corrected (V-RESULTS-v10): V1 20/20, V3 4/5 |
| Qwen 35B-A3B MoE @ v3.1 | **No** (dropped from active stack 2026-04-28) | Confirmation of v8 ≈55% V1 + V3 4/5; doesn't change drop decision |

**Phase-5 calibration items (do these instead of retest):**

1. **Fix grep tool for ctx-overflow** (highest priority — affects all profiles' eval reliability):
   - Add `-I` flag (skip binary files) to default `-rn` → `-rnI`
   - Add char-based output cap (e.g., 20K chars) in addition to line-based head+tail
   - Possibly: add `--exclude-dir=runs --exclude-dir=.planning/phases/*/runs` defaults
2. **Fix V3 analyzer rubric** to require substantive answer (truth_value present), not just truth_kw.
3. **Drop SP_OK from Mistral profile** (or `[INST]`-frame it). Moot for Qwen MoE (dropped).

---

## Gemma chat_template state (operator question: did we update?)

**Currently vendored:**
- `/data/models/gemma-4-26B-A4B-it/chat_template.jinja` — 347 lines, 16,448 bytes, last modified **2026-04-23**
- `/data/models/gemma-4-31B-it/chat_template.jinja` — byte-identical (`diff` returns empty)

**Where it's used:** vLLM auto-loads `chat_template.jinja` from the model directory via HF AutoTokenizer (we don't pin a custom `--chat-template` flag). The container image is `vllm/vllm-openai:gemma4-0409-arm64-cu130` (April 9 build) per CLAUDE.md, so the chat_template processing path is the upstream HF behavior.

**Operator's concern:** "Google released some new changes to their chat_templates."

I cannot verify upstream version — host is air-gapped (`HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`). Our copy is from 2026-04-23; if Google updated the template after that, we're stale. **Operator action needed:**

```bash
# Online-host check (NOT the air-gapped Spark):
huggingface-cli download google/gemma-4-26B-A4B-it chat_template.jinja --local-dir /tmp/gemma-check
diff /tmp/gemma-check/chat_template.jinja /data/models/gemma-4-26B-A4B-it/chat_template.jinja
```

If different:
1. Stop emmy-serve (Gemma daily-driver) cleanly via sidecar `/stop`
2. Replace `/data/models/gemma-4-26B-A4B-it/chat_template.jinja` (and `gemma-4-31B-it/chat_template.jinja` if you use that profile)
3. Compute the new bundle hash with `scripts/hash_profile.py` (the chat_template lives outside profile bundles, so hash is unchanged — but it IS a serving-side state change)
4. Document the swap in `profiles/gemma-4-26b-a4b-it/v2.1/PROFILE_NOTES.md` with the date + reason
5. Restart emmy-serve via sidecar `/start`
6. Re-run a quick V1 + V3 sanity check on Gemma 26B MoE (one task01 + 5 V3 probes) before declaring it good

If you suspect this affects v8 results: V3 probes 1-5 hit Gemma 26B MoE 5/5 manual — if a chat_template update materially changed tool-call shape, I'd expect at least one V3 probe to fail. Preserved Phase-A v10 D0 control of Mistral was probe-format-stable. So the chat_template update — if any — is most likely a small refinement (e.g., tool-call delimiter tweak) that wouldn't invalidate the matrix.

**Bottom line: chat_template update is safe to apply when convenient, but not blocking on the v10 retraction.**

---

## Summary recommendation

1. **Don't retest the matrix.** v8/v9 numbers hold for all profiles except Mistral, which v10 already corrected.
2. **Do fix the grep tool** (CTX_OVERFLOW affects 8-12/20 sessions across multiple profiles — biggest reliability lever for Phase 5).
3. **Do tighten the V3 analyzer rubric** before next V-protocol run.
4. **Drop SP_OK from Mistral profile** at Phase 5 calibration.
5. **Pull latest Gemma chat_template from HF** when convenient; not blocking.

The v10 analyzer fix + this audit give us a stable baseline to run Phase 5 from. No matrix retest needed.
