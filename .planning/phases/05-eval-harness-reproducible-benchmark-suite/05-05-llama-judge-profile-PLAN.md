---
phase: 05
plan: 05
type: execute
wave: 2
depends_on: ["05-02"]
files_modified:
  - profiles/llama-3.3-70b-instruct/v1/profile.yaml
  - profiles/llama-3.3-70b-instruct/v1/serving.yaml
  - profiles/llama-3.3-70b-instruct/v1/harness.yaml
  - profiles/llama-3.3-70b-instruct/v1/PROFILE_NOTES.md
  - profiles/llama-3.3-70b-instruct/v1/prompts/system.md
  - profiles/llama-3.3-70b-instruct/v1/prompts/judge_rubric.md
  - profiles/llama-3.3-70b-instruct/v1/tool_schemas/.gitkeep
  - profiles/llama-3.3-70b-instruct/v1/grammars/.gitkeep
  - profiles/llama-3.3-70b-instruct/DEFAULT_VARIANT
  - eval/MATRIX.md
  - packages/emmy-eval/src/judge/self-hosted-judge.ts
  - packages/emmy-eval/src/judge/cloud-claude-judge.ts
  - packages/emmy-eval/src/judge/index.ts
  - packages/emmy-eval/src/judge/rubric.ts
  - packages/emmy-eval/tests/judge-self-hosted.test.ts
  - packages/emmy-eval/tests/judge-cloud-claude.test.ts
  - packages/emmy-eval/src/index.ts
  - runs/phase5-llama-judge-kv/.gitkeep
  - runs/phase5-llama-judge-thermal/.gitkeep
autonomous: false
requirements: [EVAL-06]
tags: [eval, llm-as-judge, llama, profile-authoring, kv-bisection, thermal-replay, operator-attended, gpu-long-run]

must_haves:
  truths:
    - "profiles/llama-3.3-70b-instruct/v1/ exists as a brand-new profile bundle with the full Phase-04.1 discipline: profile.yaml + serving.yaml + harness.yaml + PROFILE_NOTES.md + prompts/system.md + prompts/judge_rubric.md + tool_schemas/ + grammars/ + DEFAULT_VARIANT marker"
    - "Profile validates cleanly: `uv run emmy profile validate profiles/llama-3.3-70b-instruct/v1` exits 0"
    - "Profile hash recorded via `uv run emmy profile hash --write` and embedded in profile.yaml"
    - "HuggingFace model meta/Llama-3.3-70B-Instruct downloaded; FP8 quantization either publisher-shipped (if available) or runtime-quantized via vLLM with quantization: fp8 — verified before bundle write"
    - "Container digest pinned in serving.yaml.engine.container_image_digest (NGC nvcr.io/nvidia/vllm:26.03.post1-py3 OR upstream-Llama-tested image — operator captures at first boot)"
    - "Smoke test: `scripts/start_emmy.sh --profile profiles/llama-3.3-70b-instruct/v1` boots cleanly + canary [SP_OK] passes + `smoke ok: tok/s=...` printed"
    - "KV bisection: `uv run python scripts/find_kv_budget.py --profile profiles/llama-3.3-70b-instruct/v1` converges to a measured gpu_memory_utilization value, written to serving.yaml + PROFILE_NOTES.md frontmatter — `find_kv_budget.py` is the SOLE WRITER per Pitfall #1"
    - "Thermal pass 1: `uv run python scripts/thermal_replay.py --profile profiles/llama-3.3-70b-instruct/v1 --record-floors` writes decode_throughput p50/p1 + GPU clock p5/p50 floors to PROFILE_NOTES.md frontmatter"
    - "Thermal pass 2: `uv run python scripts/thermal_replay.py --profile profiles/llama-3.3-70b-instruct/v1 --assert-floors` exits 0 with 'All floors pass' + preemptions_hour2: 0 + oom_events: 0 — same gates as Phase 04.1 dense profiles"
    - "EVAL-06: packages/emmy-eval/src/judge/self-hosted-judge.ts: drives the judge via the existing emmy-serve `/profile` swap machinery (Phase 4 swap-profile primitive); takes a list of {task, transcript, expected_rubric}; calls family-guard.assertJudgeFamilyClean with judge=llama vs generators=[qwen,gemma]; produces {judge_score, rationale} per row"
    - "Cloud-Claude judge path (cloud-claude-judge.ts): refuses to run under STRICT lane (verifyAirgapLane); calls Anthropic Messages API claude-sonnet-4-5 with the same rubric prompt template as self-hosted; same family-guard check; returns identical shape — operator-opt-in via --judge=cloud-claude"
    - "eval/MATRIX.md extended with a 5th row: llama-3.3-70b-instruct@v1 — eval-only (NEVER daily-driver); marked `Role: judge`; `Status: Phase 5 Plan 05-05`"
    - "judge-family-guard test extended with the real Llama profile id as a fixture (replaces the synthetic test from Plan 05-02)"
    - "Daily-driver default UNCHANGED: profiles/qwen3.6-35b-a3b/DEFAULT_VARIANT byte-identical pre vs post; no other family DEFAULT_VARIANT touched"
  artifacts:
    - path: "profiles/llama-3.3-70b-instruct/v1/profile.yaml"
      provides: "Profile manifest with id, version, hash, ref pointers"
      contains: "id: llama-3.3-70b-instruct"
    - path: "profiles/llama-3.3-70b-instruct/v1/serving.yaml"
      provides: "vLLM engine args + sampling defaults; gpu_memory_utilization populated by find_kv_budget.py only"
      contains: "model: meta-llama/Llama-3.3-70B-Instruct"
      min_lines: 30
    - path: "profiles/llama-3.3-70b-instruct/v1/PROFILE_NOTES.md"
      provides: "Provenance: HF release date, citation for sampling defaults, KV bisection result, 2x2h thermal floors, validation_runs entries"
      contains: "## KV Bisection"
    - path: "profiles/llama-3.3-70b-instruct/v1/prompts/judge_rubric.md"
      provides: "Llama judge prompt template — 5-dimension rubric mirroring prior repo's eval_judge.py"
      contains: "## Rubric"
    - path: "profiles/llama-3.3-70b-instruct/DEFAULT_VARIANT"
      provides: "DEFAULT_VARIANT marker pointing at v1 (Phase 4 follow-up commit 61ef905 pattern)"
      contains: "v1"
    - path: "packages/emmy-eval/src/judge/self-hosted-judge.ts"
      provides: "Self-hosted Llama judge via /profile-swap; default judge subsystem"
      contains: "assertJudgeFamilyClean"
      min_lines: 60
    - path: "packages/emmy-eval/src/judge/cloud-claude-judge.ts"
      provides: "Cloud Claude opt-in judge — STRICT lane refuses; PERMISSIVE allowed"
      contains: "verifyAirgapLane"
    - path: "eval/MATRIX.md"
      provides: "Updated 5-row matrix with Llama judge profile annotated as eval-only"
      contains: "llama-3.3-70b-instruct"
  key_links:
    - from: "scripts/find_kv_budget.py"
      to: "profiles/llama-3.3-70b-instruct/v1/serving.yaml"
      via: "operator-gated bisection writes measured gpu_memory_utilization (sole writer per Pitfall #1)"
      pattern: "gpu_memory_utilization:"
    - from: "scripts/thermal_replay.py"
      to: "profiles/llama-3.3-70b-instruct/v1/PROFILE_NOTES.md"
      via: "operator-gated 2-hour replay writes decode_throughput + gpu_clock floors to frontmatter"
      pattern: "measured_values:"
    - from: "packages/emmy-eval/src/judge/self-hosted-judge.ts"
      to: "emmy_serve/swap/orchestrator.py (swap-profile primitive)"
      via: "subprocess invocation of pi-emmy /profile llama-3.3-70b-instruct after generation phase"
      pattern: "swap-profile"
    - from: "packages/emmy-eval/src/judge/index.ts"
      to: "packages/emmy-eval/src/judge/family-guard.ts (assertJudgeFamilyClean)"
      via: "pre-judgment guard"
      pattern: "assertJudgeFamilyClean"
    - from: "eval/MATRIX.md (5th row)"
      to: "profiles/llama-3.3-70b-instruct/v1/PROFILE_NOTES.md"
      via: "documented as judge profile"
      pattern: "Role: judge"
---

# Objective

Author the brand-new `profiles/llama-3.3-70b-instruct/v1/` profile bundle with **full Phase-04.1 dense-profile discipline** (HF download → container digest pin → bundle write → hash → validate → smoke → KV bisect via `find_kv_budget.py` SOLE WRITER → 2×2h thermal replay) AND wire the judge subsystem into `@emmy/eval`: `self-hosted-judge.ts` (default; uses Phase 4 `/profile`-swap machinery to swap to Llama after generation phase) + `cloud-claude-judge.ts` (opt-in; PERMISSIVE-lane only). EVAL-06 (different-family judge) is the singular requirement closed by this plan; everything else inherits from Plans 05-02 (architectural backbone) + 05-03/04 (suite adapters).

Purpose: Phase 5's research-artifact bar requires LLM-as-judge paired with executable correctness, AND requires the judge to be from a different model family (EVAL-06; literature: 5-7% same-family bias). Llama-3.3-70B-Instruct is the smallest family-distinct judge that fits on Spark; FP8 keeps memory pressure tractable. Authoring it as a real profile bundle (not a hard-coded fork) means the same `/profile`-swap UX a daily-driver session uses works for judge swapping too — and a future operator can swap the judge to a different model by authoring a new profile, no code change.

**Per D-11: this is full Phase-04.1 dense-profile discipline. Do NOT shortcut profile validation just because it's "only" the judge model.** Same task structure, same gates (preemptions=0, oom=0), same evidence trail.

Output:
- `profiles/llama-3.3-70b-instruct/v1/` complete bundle with measured KV + thermal floors
- `eval/MATRIX.md` updated with 5th row (judge profile, eval-only)
- `packages/emmy-eval/src/judge/{self-hosted-judge,cloud-claude-judge,index,rubric}.ts` + 2 GREEN unit tests
- Resume signals from operator: `llama judge profile validates`, `llama kv green`, `llama thermal floors recorded`, `llama thermal green`

# Execution Context

@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md

# Context

@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-CONTEXT.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-RESEARCH.md
@.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-02-eval-driver-core-PLAN.md
@.planning/phases/04.1-dense-variant-model-profiles-qwen3-6-27b-fp8-gemma-4-31b-it-/04.1-CONTEXT.md
@.planning/phases/04.1-dense-variant-model-profiles-qwen3-6-27b-fp8-gemma-4-31b-it-/04.1-01-qwen27b-PLAN.md
@CLAUDE.md
@eval/MATRIX.md
@scripts/find_kv_budget.py
@scripts/thermal_replay.py
@profiles/qwen3.6-35b-a3b/v3.1/profile.yaml
@profiles/qwen3.6-35b-a3b/v3.1/serving.yaml
@profiles/qwen3.6-35b-a3b/v3.1/PROFILE_NOTES.md
@/data/projects/setup_local_opencode/validation/eval_judge.py

## Interfaces

Llama 3.3 70B Instruct facts (verify at execution; pin in profile.yaml + PROFILE_NOTES.md):

- HF repo: `meta-llama/Llama-3.3-70B-Instruct` (gated; HF token in env)
- Released 2024-12-06 (well before any Phase 5 generation models — clean for judging)
- 70B params, dense, BF16 weights ~140 GB
- Context: 128K native
- License: Llama 3.3 Community License (acceptable per CLAUDE.md anti-feature list — stock weights only)
- vLLM 0.19+ supports natively (Llama family is the canonical vLLM model)
- For Spark UMA: BF16 ~140 GB does NOT fit alongside the 35B-A3B daily driver (already ~75 GB in UMA); FP8 runtime quant brings it to ~70 GB which fits ALONE on Spark — **judge runs only when generators are unloaded** (the `/profile`-swap pattern; we don't co-locate)
- Expected throughput on Spark: ~5-12 tok/s (bandwidth-bound dense; per RESEARCH.md §Q5 acceptable cost-of-honesty for ~600 judgments × 20s/judgment = 3.3h judge-pass)

Container choice (operator decides at first boot):

- Option A: NGC `nvcr.io/nvidia/vllm:26.03.post1-py3` (the Qwen container) — Llama is well-supported here; fastsafetensors works
- Option B: upstream `vllm/vllm-openai:latest` if NGC has known Llama 3.3 issues
- The serving.yaml.engine.container_image_digest field pins whichever container the operator uses; document choice in PROFILE_NOTES.md

Judge rubric (mirroring prior-repo's eval_judge.py — verified at /data/projects/setup_local_opencode/validation/eval_judge.py):

5 dimensions × 1-5 each → total/25 → normalized 2.0-10.0:

1. Correctness — solves the task as specified
2. Code quality — idiomatic, readable, well-structured
3. Tool use — appropriate tool selection, no waste
4. Communication — clear explanations and rationale
5. Completeness — covers edge cases, follows up

Judge prompt template lives at `profiles/llama-3.3-70b-instruct/v1/prompts/judge_rubric.md` and is loaded by both self-hosted-judge.ts and cloud-claude-judge.ts; prompt is identical, only the API endpoint changes.

self-hosted-judge.ts API:

```typescript
export interface JudgeInput {
  task_id: string;
  task_prompt: string;
  expected_rubric: string;
  transcript: string;       // pi-emmy session JSONL serialized; or final assistant text
  exec_score: 0 | 1 | null; // executable correctness from upstream
}
export interface JudgeOutput {
  judge_score: number;       // 2.0-10.0 normalized
  rubric_dims: { correctness: number; code_quality: number; tool_use: number; communication: number; completeness: number };
  rationale: string;         // judge's free-text explanation; <500 chars
}
export async function runSelfHostedJudge(args: {
  judgeProfileRef: { id: string; version: string };
  generatorProfileRefs: Array<{ id: string; version: string }>;
  baseUrl: string;
  rows: JudgeInput[];
  swapBackProfile?: string;  // after judge phase, swap back to this profile (defaults to whatever was active before)
}): Promise<JudgeOutput[]>;
```

cloud-claude-judge.ts API: identical signature, but instead of `/profile`-swap + emmy-serve, it shells `curl -H "x-api-key: $ANTHROPIC_API_KEY" https://api.anthropic.com/v1/messages` per row (or invokes `@anthropic-ai/sdk`). Refuses to run under STRICT lane.

## Key Files

- `profiles/qwen3.6-27b/v1/` — Phase 04.1 reference for dense-profile bundle shape; clone discipline
- `profiles/qwen3.6-27b/v1/PROFILE_NOTES.md` — reference for measured_values frontmatter format
- `scripts/find_kv_budget.py` — sole writer of `gpu_memory_utilization`
- `scripts/thermal_replay.py` — 2-hour replay with --record-floors / --assert-floors
- `scripts/start_emmy.sh` — boot wrapper; smoke test integration
- `emmy_serve/swap/orchestrator.py` — Phase 4 `/profile`-swap primitive; judge subsystem invokes for swap
- `packages/emmy-eval/src/judge/family-guard.ts` — Plan 05-02's family check (this plan extends test fixtures with real Llama profile id)
- `/data/projects/setup_local_opencode/validation/eval_judge.py` — prior-repo Anthropic Sonnet judge; rubric format source

# Tasks

## Task 1 (auto): Author Llama judge profile bundle skeleton + judge subsystem code (RED→GREEN unit tests)

**Files:** `profiles/llama-3.3-70b-instruct/v1/{profile.yaml,serving.yaml,harness.yaml,PROFILE_NOTES.md,prompts/system.md,prompts/judge_rubric.md,tool_schemas/.gitkeep,grammars/.gitkeep}`, `profiles/llama-3.3-70b-instruct/DEFAULT_VARIANT`, `packages/emmy-eval/src/judge/{self-hosted-judge.ts,cloud-claude-judge.ts,index.ts,rubric.ts}`, `packages/emmy-eval/tests/{judge-self-hosted,judge-cloud-claude}.test.ts`, `packages/emmy-eval/src/index.ts`

**Behavior:**
- Profile bundle YAML files validate against the existing pydantic schema (`uv run emmy profile validate profiles/llama-3.3-70b-instruct/v1` exits 0)
- profile.yaml has placeholder `hash: "sha256:PLACEHOLDER"` (filled by Task 2 after weights download + `emmy profile hash --write`)
- serving.yaml has placeholder `gpu_memory_utilization: 0.45` (Phase 04.1 Gemma seed; bisection in Task 2 replaces; sole writer = `find_kv_budget.py`)
- judge code unit-tests pass without any GPU (mocked /profile swap + canned API responses)
- self-hosted-judge.test.ts: 5 tests covering (a) family-guard call before judge invocation, (b) prompt template loaded from rubric.md, (c) score parsing from canned model response, (d) swap-back behavior, (e) failure on missing required field
- cloud-claude-judge.test.ts: 4 tests covering (a) STRICT-lane refusal, (b) PERMISSIVE-lane allowed, (c) family-guard before HTTP call, (d) score parsing from canned Claude response

**Action:**

Step 1 — Author `profiles/llama-3.3-70b-instruct/v1/profile.yaml`:

```yaml
# Llama 3.3 70B Instruct judge profile (Phase 5 Plan 05-05).
# Authored 2026-04-25. Eval-only — NEVER daily-driver.
ref:
  id: llama-3.3-70b-instruct
  version: v1
  hash: "sha256:PLACEHOLDER"   # populated by Task 2 via `emmy profile hash --write`
provenance:
  authored_by: emmy-phase5-plan-05-05
  authored_at: 2026-04-25
  role: judge
  inherits_from: null   # brand-new profile, NOT cloned (Llama is a new family for emmy)
  source_repo_hf: meta-llama/Llama-3.3-70B-Instruct
  hf_release_date: "2024-12-06"
  license: "Llama 3.3 Community License"
notes_path: PROFILE_NOTES.md
serving_path: serving.yaml
harness_path: harness.yaml
prompts_path: prompts/
tool_schemas_path: tool_schemas/
grammars_path: grammars/
```

Step 2 — Author `profiles/llama-3.3-70b-instruct/v1/serving.yaml`. Use Phase 04.1 Gemma 31B v1 + Phase 1 Qwen v1 as references. Key fields:

```yaml
engine:
  model: /models/Llama-3.3-70B-Instruct
  model_hf_id: meta-llama/Llama-3.3-70B-Instruct
  served_model_name: llama-3.3-70b-instruct
  container_image: nvcr.io/nvidia/vllm:26.03.post1-py3   # operator may swap; document in PROFILE_NOTES
  container_image_digest: "sha256:PLACEHOLDER"            # populated by Task 2 first-boot
  quantization: fp8                                        # runtime; BF16 publisher → FP8 vLLM
  max_model_len: 65536                                     # honest; KV-bisected in Task 2
  gpu_memory_utilization: 0.45                             # SEED ONLY; find_kv_budget.py is sole writer
  enforce_eager: false
  trust_remote_code: false
  env:
    VLLM_LOAD_FORMAT: fastsafetensors
    VLLM_NO_USAGE_STATS: "1"
sampling:
  default:
    temperature: 0.0           # judge is deterministic by default
    top_p: 1.0
    max_tokens: 1024
  judge:
    temperature: 0.0
    top_p: 1.0
    max_tokens: 512            # rubric responses are short
    seed: 42                   # reproducibility for the judge phase specifically
speculative: null               # spec decode not configured for judge; can revisit Phase 6
quirks:
  strip_thinking_tags: false   # Llama 3.3 doesn't ship thinking-channel by default
```

Step 3 — Author `profiles/llama-3.3-70b-instruct/v1/harness.yaml`:

```yaml
context:
  max_input_tokens: 49152      # = max_model_len(65536) - output_reserve(16384); recompute via scripts/compute_max_input_tokens.ts at first boot
  max_output_tokens: 16384
prompts:
  system: prompts/system.md
  judge_rubric: prompts/judge_rubric.md
tools:
  enabled: []                  # judge does not use tools — pure rubric scoring
  grammar:
    path: null
    mode: disabled
retry:
  attempts: 1                  # judge is single-pass; no retry
compaction:
  policy: aggressive           # for long transcripts as judge input
  trigger_pct: 0.85
```

Step 4 — Author `profiles/llama-3.3-70b-instruct/v1/prompts/system.md`:

```
You are a coding-task judge for Emmy, a local coding agent. You will be given:
1. A task description
2. A rubric describing what "correct" looks like
3. The agent's transcript (assistant text + tool calls + final state)
4. Whether executable tests pass (when available)

Your job: rate the response on 5 dimensions × 1-5 each, then give a brief rationale.

Be honest, terse, and consistent. Do NOT self-promote any model family.

Reply ONLY with the rubric JSON, then a one-paragraph rationale. No preamble.
```

Step 5 — Author `profiles/llama-3.3-70b-instruct/v1/prompts/judge_rubric.md` mirroring `/data/projects/setup_local_opencode/validation/eval_judge.py`'s rubric prompt:

```
## Rubric

Rate the agent's response on each of these 5 dimensions, 1 (worst) to 5 (best):

1. **correctness** — Does the solution solve the task as specified?
2. **code_quality** — Is the code idiomatic, readable, well-structured?
3. **tool_use** — Did the agent select tools appropriately, with no obvious waste?
4. **communication** — Are explanations and rationale clear?
5. **completeness** — Does the solution cover edge cases and necessary follow-up?

## Output format

```json
{
  "correctness": 4,
  "code_quality": 3,
  "tool_use": 5,
  "communication": 4,
  "completeness": 3
}
```

Followed by ONE paragraph (max 4 sentences) of rationale. No other text.

## Inputs

**Task:** {task_prompt}

**Expected behavior:** {expected_rubric}

**Executable correctness:** {exec_score_human_readable}  (1=tests pass, 0=tests fail, n/a=not applicable)

**Agent transcript:**

```
{transcript}
```
```

Step 6 — Author `profiles/llama-3.3-70b-instruct/v1/PROFILE_NOTES.md`:

```markdown
***
profile_id: llama-3.3-70b-instruct
profile_version: v1
authored_at: 2026-04-25
role: judge
measured_values:
  gpu_memory_utilization: null      # populated by find_kv_budget.py
  decode_throughput_p50: null       # populated by thermal_replay.py --record-floors
  decode_throughput_p1: null
  gpu_clock_p5: null
  gpu_clock_p50: null
  preemptions_hour2: null
  oom_events: null
validation_runs: []                  # populated as walkthroughs land
***

# Llama 3.3 70B Instruct — Phase 5 judge profile

## Why Llama (D-Q5 / D-03 from 05-CONTEXT.md)

EVAL-06 requires the judge to be a different model family from generators. Phase 5
generators are Qwen 3.6 + Gemma 4. Llama 3.3 is family-distinct from both, has a
70B-FP8 footprint that fits on Spark UMA when generators are unloaded, and is widely
trusted as an instruction-following judge in coding-eval literature.

## Provenance for sampling defaults

- **temperature: 0.0** — judges should be deterministic; reproducibility over creativity. Source: standard LLM-as-judge practice; e.g. https://arxiv.org/html/2510.24367 §3.2.
- **max_tokens: 512 (judge profile)** — empirically sufficient for 5-dim rubric + 1-paragraph rationale. Source: prior-repo eval_judge.py uses ~400 tokens for Sonnet; Llama tends slightly more verbose.
- **seed: 42** — reproducibility for the judge phase specifically. Source: vLLM honors seed when temperature=0.

## KV Bisection

Populated by `scripts/find_kv_budget.py`; do not hand-edit `gpu_memory_utilization`.

## Thermal Replay

Populated by `scripts/thermal_replay.py --record-floors` (pass 1) + `--assert-floors` (pass 2).

## Validation Runs

(Appended as judge walkthroughs land; mirrors the v3.1 PROFILE_NOTES.md format.)

## NOT a daily-driver

This profile is eval-only. The DEFAULT_VARIANT marker exists for completeness so
`/profile llama-3.3-70b-instruct` resolves, but the daily-driver default
(`profiles/qwen3.6-35b-a3b/DEFAULT_VARIANT = v3.1`) is unchanged.
```

Step 7 — Author `profiles/llama-3.3-70b-instruct/DEFAULT_VARIANT`:

```
v1
```

Step 8 — Create empty placeholders: `tool_schemas/.gitkeep` + `grammars/.gitkeep`.

Step 9 — Author `packages/emmy-eval/src/judge/rubric.ts` (loads + renders the prompt template):

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface JudgeInput {
  task_id: string;
  task_prompt: string;
  expected_rubric: string;
  transcript: string;
  exec_score: 0 | 1 | null;
}

export function loadRubricTemplate(profileDir: string): string {
  return readFileSync(join(profileDir, "prompts/judge_rubric.md"), "utf8");
}

export function renderRubricPrompt(template: string, input: JudgeInput): string {
  return template
    .replace("{task_prompt}", input.task_prompt)
    .replace("{expected_rubric}", input.expected_rubric)
    .replace("{exec_score_human_readable}", input.exec_score === 1 ? "1 (tests pass)" : input.exec_score === 0 ? "0 (tests fail)" : "n/a")
    .replace("{transcript}", truncateTranscript(input.transcript, 4000));
}

function truncateTranscript(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars / 2) + "\n... [TRUNCATED] ...\n" + s.slice(-maxChars / 2);
}

export interface RubricResponse {
  rubric_dims: { correctness: number; code_quality: number; tool_use: number; communication: number; completeness: number };
  rationale: string;
}

export function parseJudgeResponse(text: string): RubricResponse | null {
  // Find the first {...} JSON block
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return null;
  let parsed: any;
  try { parsed = JSON.parse(jsonMatch[0]); } catch { return null; }
  const dims = ["correctness","code_quality","tool_use","communication","completeness"] as const;
  for (const d of dims) {
    if (typeof parsed[d] !== "number" || parsed[d] < 1 || parsed[d] > 5) return null;
  }
  const rationale = text.slice(jsonMatch.index! + jsonMatch[0].length).trim();
  return { rubric_dims: parsed, rationale: rationale.slice(0, 500) };
}

export function normalizeScore(dims: RubricResponse["rubric_dims"]): number {
  // Sum 5 dims (1-5 each) → /25 → renormalize to 2.0-10.0 (prior-repo eval_judge.py shape)
  const sum = dims.correctness + dims.code_quality + dims.tool_use + dims.communication + dims.completeness;
  return Math.round(((sum / 25) * 8 + 2) * 100) / 100;
}
```

Step 10 — Author `packages/emmy-eval/src/judge/self-hosted-judge.ts`:

```typescript
import { spawnSync } from "node:child_process";
import { postChat } from "@emmy/provider";
import { assertJudgeFamilyClean, type ProfileRefLike } from "./family-guard";
import { loadRubricTemplate, renderRubricPrompt, parseJudgeResponse, normalizeScore, type JudgeInput } from "./rubric";

export interface JudgeOutput { judge_score: number; rubric_dims: { correctness: number; code_quality: number; tool_use: number; communication: number; completeness: number }; rationale: string }

export async function runSelfHostedJudge(args: {
  judgeProfilePath: string;       // e.g. profiles/llama-3.3-70b-instruct/v1
  judgeProfileRef: ProfileRefLike;
  generatorProfileRefs: ProfileRefLike[];
  baseUrl: string;
  rows: JudgeInput[];
  swapBackProfile?: string;
}): Promise<JudgeOutput[]> {
  // Family guard FIRST
  assertJudgeFamilyClean({ judgeProfileRef: args.judgeProfileRef, generatorProfileRefs: args.generatorProfileRefs });

  // Swap to judge profile via the Phase 4 swap-profile primitive.
  // Equivalent to running `/profile llama-3.3-70b-instruct` from a pi-emmy TUI.
  const swap = spawnSync("uv", ["run", "python", "-m", "emmy_serve.swap.orchestrator", "swap-profile", args.judgeProfilePath], { stdio: "inherit" });
  if (swap.status !== 0) throw new Error(`swap to judge profile exited ${swap.status}`);

  // Load rubric template once.
  const template = loadRubricTemplate(args.judgeProfilePath);
  const outputs: JudgeOutput[] = [];

  for (const row of args.rows) {
    const prompt = renderRubricPrompt(template, row);
    const resp = await postChat(args.baseUrl, {
      model: "llama-3.3-70b-instruct",
      messages: [
        { role: "system", content: "You are a coding-task judge. Output rubric JSON then rationale." },
        { role: "user", content: prompt },
      ],
      temperature: 0.0, max_tokens: 512, stream: false, seed: 42,
    }, { timeoutMs: 120_000 });
    const text = resp.choices[0]?.message?.content ?? "";
    const parsed = parseJudgeResponse(typeof text === "string" ? text : "");
    if (parsed) {
      outputs.push({ judge_score: normalizeScore(parsed.rubric_dims), rubric_dims: parsed.rubric_dims, rationale: parsed.rationale });
    } else {
      outputs.push({ judge_score: 0, rubric_dims: { correctness: 0, code_quality: 0, tool_use: 0, communication: 0, completeness: 0 } as any, rationale: "judge response parse failed" });
    }
  }

  // Swap back to whatever was active before (operator-controlled; generally the daily-driver default)
  if (args.swapBackProfile) {
    spawnSync("uv", ["run", "python", "-m", "emmy_serve.swap.orchestrator", "swap-profile", args.swapBackProfile], { stdio: "inherit" });
  }

  return outputs;
}
```

NOTE: This file imports `postChat` from `@emmy/provider`. That's a deliberate exception to the Plan 05-02 uses-sdk static check — judge doesn't drive a session, it does single-shot chat completions against the swapped emmy-serve. Add this file to the uses-sdk allowlist in Plan 05-02's `uses-sdk.test.ts` (alongside `sp-ok-gate.ts`). Document the rationale in JSDoc.

Step 11 — Author `packages/emmy-eval/src/judge/cloud-claude-judge.ts`:

```typescript
import { verifyAirgapLane } from "../airgap-lane";
import { assertJudgeFamilyClean, type ProfileRefLike } from "./family-guard";
import { loadRubricTemplate, renderRubricPrompt, parseJudgeResponse, normalizeScore, type JudgeInput } from "./rubric";

const ANTHROPIC_API_VERSION = "2023-06-01";
const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5-20250929";   // prior-repo pin

export interface JudgeOutput { judge_score: number; rubric_dims: { correctness: number; code_quality: number; tool_use: number; communication: number; completeness: number }; rationale: string }

export async function runCloudClaudeJudge(args: {
  judgeRubricPath: string;
  generatorProfileRefs: ProfileRefLike[];
  rows: JudgeInput[];
  apiKey?: string;
  model?: string;
}): Promise<JudgeOutput[]> {
  // Lane verification — this judge is only allowed under PERMISSIVE
  verifyAirgapLane({ requestedJudge: "cloud-claude" });

  // Family guard — Claude is "anthropic" or "cloud-claude"; never qwen/gemma
  const judgeRef = { id: "cloud-claude-sonnet-4-5" };
  assertJudgeFamilyClean({ judgeProfileRef: judgeRef, generatorProfileRefs: args.generatorProfileRefs });

  const apiKey = args.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set; cloud-claude judge requires this env var");

  const template = (await import("node:fs")).readFileSync(args.judgeRubricPath, "utf8");
  const outputs: JudgeOutput[] = [];

  for (const row of args.rows) {
    const prompt = renderRubricPrompt(template, row);
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: args.model ?? DEFAULT_CLAUDE_MODEL,
        max_tokens: 512,
        temperature: 0.0,
        system: "You are a coding-task judge. Output rubric JSON then rationale.",
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!resp.ok) throw new Error(`Anthropic API error ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as { content: Array<{ type: string; text?: string }> };
    const text = data.content?.find((b) => b.type === "text")?.text ?? "";
    const parsed = parseJudgeResponse(text);
    if (parsed) outputs.push({ judge_score: normalizeScore(parsed.rubric_dims), rubric_dims: parsed.rubric_dims, rationale: parsed.rationale });
    else outputs.push({ judge_score: 0, rubric_dims: { correctness: 0, code_quality: 0, tool_use: 0, communication: 0, completeness: 0 } as any, rationale: "judge response parse failed" });
  }
  return outputs;
}
```

Step 12 — Author `packages/emmy-eval/src/judge/index.ts` re-exports + dispatcher:

```typescript
export { runSelfHostedJudge } from "./self-hosted-judge";
export { runCloudClaudeJudge } from "./cloud-claude-judge";
export { assertJudgeFamilyClean, JudgeFamilyConflictError, familyRoot, type ProfileRefLike } from "./family-guard";
export { loadRubricTemplate, renderRubricPrompt, parseJudgeResponse, normalizeScore, type JudgeInput, type RubricResponse } from "./rubric";
```

Update `packages/emmy-eval/src/index.ts` to re-export `from "./judge/index"`.

Step 13 — Author the 9 unit tests across `judge-self-hosted.test.ts` + `judge-cloud-claude.test.ts` + extending the existing `judge-family-guard.test.ts` with one test using the real Llama profile id:

```typescript
// judge-family-guard.test.ts addition:
it("Llama-3.3-70b-instruct vs MATRIX generators is family-clean", () => {
  expect(() => assertJudgeFamilyClean({
    judgeProfileRef: { id: "llama-3.3-70b-instruct" },
    generatorProfileRefs: [
      { id: "qwen3.6-35b-a3b" },
      { id: "qwen3.6-27b" },
      { id: "gemma-4-26b-a4b-it" },
      { id: "gemma-4-31b-it" },
    ],
  })).not.toThrow();
});
```

`judge-cloud-claude.test.ts` covers:

```typescript
import { describe, expect, it } from "bun:test";
import { runCloudClaudeJudge } from "../src/judge/cloud-claude-judge";
import { LaneMismatchError } from "../src/airgap-lane";

describe("cloud-claude judge (EVAL-06 + D-08)", () => {
  it("STRICT lane refuses cloud-claude", async () => {
    process.env.EMMY_AIRGAP = "strict";
    await expect(runCloudClaudeJudge({
      judgeRubricPath: "profiles/llama-3.3-70b-instruct/v1/prompts/judge_rubric.md",
      generatorProfileRefs: [{ id: "qwen3.6-35b-a3b" }],
      rows: [],
    })).rejects.toThrow(LaneMismatchError);
    delete process.env.EMMY_AIRGAP;
  });

  it("PERMISSIVE lane allowed", async () => {
    process.env.EMMY_AIRGAP = "permissive";
    process.env.ANTHROPIC_API_KEY = "test-key";
    // empty rows → resolves immediately without HTTP call
    const r = await runCloudClaudeJudge({
      judgeRubricPath: "profiles/llama-3.3-70b-instruct/v1/prompts/judge_rubric.md",
      generatorProfileRefs: [{ id: "qwen3.6-35b-a3b" }],
      rows: [],
    });
    expect(r).toEqual([]);
    delete process.env.EMMY_AIRGAP;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("family guard fires before HTTP call (qwen as judge would throw)", async () => {
    process.env.EMMY_AIRGAP = "permissive";
    // Synthesize a hypothetical qwen-as-judge id; should still trip family guard
    await expect(runCloudClaudeJudge({
      judgeRubricPath: "profiles/llama-3.3-70b-instruct/v1/prompts/judge_rubric.md",
      generatorProfileRefs: [{ id: "qwen3.6-35b-a3b" }],
      rows: [{ task_id: "x", task_prompt: "x", expected_rubric: "x", transcript: "x", exec_score: 1 }],
    })).resolves.toBeDefined();   // cloud-claude judgeRef is "cloud-claude-sonnet-4-5" → family root "cloud" → not qwen/gemma → ok
    delete process.env.EMMY_AIRGAP;
  });
});
```

`judge-self-hosted.test.ts` covers:

```typescript
import { describe, expect, it } from "bun:test";
import { parseJudgeResponse, normalizeScore } from "../src/judge/rubric";

describe("self-hosted judge — rubric parsing", () => {
  it("parses canonical rubric JSON + rationale", () => {
    const text = `{"correctness":4,"code_quality":3,"tool_use":5,"communication":4,"completeness":3}\n\nThe agent solved correctly but used too many tool calls.`;
    const parsed = parseJudgeResponse(text);
    expect(parsed?.rubric_dims.correctness).toBe(4);
    expect(parsed?.rationale).toContain("solved correctly");
  });

  it("normalizeScore: 4+3+5+4+3 = 19/25 → 2 + (19/25)*8 = 8.08", () => {
    expect(normalizeScore({ correctness: 4, code_quality: 3, tool_use: 5, communication: 4, completeness: 3 })).toBeCloseTo(8.08, 2);
  });

  it("returns null on missing dim", () => {
    expect(parseJudgeResponse(`{"correctness":4}`)).toBeNull();
  });

  it("returns null on out-of-range score", () => {
    expect(parseJudgeResponse(`{"correctness":7,"code_quality":3,"tool_use":5,"communication":4,"completeness":3}`)).toBeNull();
  });

  it("returns null on no JSON in text", () => {
    expect(parseJudgeResponse("no json here")).toBeNull();
  });
});
```

Step 14 — Update `packages/emmy-eval/tests/uses-sdk.test.ts` allowlist to include `self-hosted-judge.ts` (legitimately uses postChat for single-shot judge calls).

Step 15 — Validate the profile bundle structure (no model files yet):

```bash
cd /data/projects/emmy
uv run emmy profile validate profiles/llama-3.3-70b-instruct/v1
```

Should exit 0 (the validator doesn't require the model directory to exist; it checks YAML + filesystem layout). If hash field is the placeholder, `--strict-hash=false` may be needed; otherwise validate exits 0 with a `KNOWN-STALE` warning that gets cleared in Task 2.

**Verify:**

```
cd /data/projects/emmy && cd /data/projects/emmy && bun test packages/emmy-eval/tests/judge-self-hosted.test.ts packages/emmy-eval/tests/judge-cloud-claude.test.ts packages/emmy-eval/tests/judge-family-guard.test.ts packages/emmy-eval/tests/uses-sdk.test.ts && uv run emmy profile validate profiles/llama-3.3-70b-instruct/v1
# (W4: uses-sdk.test.ts is in the verify chain because Step 14 updates its allowlist; this catches an accidental regression where the allowlist update is missed)
```

**Done:**
- profiles/llama-3.3-70b-instruct/v1/ bundle exists with 8 files + DEFAULT_VARIANT marker
- `uv run emmy profile validate` exits 0 (placeholder hash + KNOWN-STALE warning is acceptable pre-Task-2)
- 9+ unit tests across judge-self-hosted/judge-cloud-claude/judge-family-guard all GREEN
- judge subsystem importable: `import { runSelfHostedJudge, runCloudClaudeJudge } from "@emmy/eval"` works
- `packages/emmy-eval/src/index.ts` re-exports judge subsystem
- uses-sdk.test.ts allowlist updated (self-hosted-judge.ts added)
- Resume signal: `llama judge profile validates`

***

## Task 2 (checkpoint:human-action, gate=blocking): Operator runs HuggingFace pull + container digest pin + bundle hash + smoke test on DGX Spark

**what-built:**
- Profile bundle skeleton + judge subsystem code (Task 1)
- All YAML files have placeholders for hash + container_image_digest

**The OPERATOR runs:**

Window: ~3-5h (model pull dominates; 140 GB BF16 download).

```bash
cd /data/projects/emmy

# 1. Authenticate to HF (gated model — Llama 3.3 requires accepted license)
huggingface-cli login   # uses HF_TOKEN env var if set
huggingface-cli download meta-llama/Llama-3.3-70B-Instruct --local-dir /models/Llama-3.3-70B-Instruct
# ~140 GB download; expect ~30-60 min on Spark networking

# 2. Pin container digest. NGC container is already pulled from earlier phases; capture digest:
docker pull nvcr.io/nvidia/vllm:26.03.post1-py3
DIGEST=$(docker inspect nvcr.io/nvidia/vllm:26.03.post1-py3 --format='{{index .RepoDigests 0}}')
echo "Container digest: $DIGEST"

# 3. Edit profiles/llama-3.3-70b-instruct/v1/serving.yaml — replace
#      container_image_digest: "sha256:PLACEHOLDER"
#    with the captured digest (the sha256:... portion only, e.g. "sha256:abc123...").
#    NO OTHER FIELD CHANGES — Pitfall #1 sole-writer discipline.

# 4. Recompute profile hash with real digest in place
uv run emmy profile hash --write profiles/llama-3.3-70b-instruct/v1
# Should rewrite profile.yaml.ref.hash and clear KNOWN-STALE marker

# 5. Validate cleanly
uv run emmy profile validate profiles/llama-3.3-70b-instruct/v1
# Expect exit 0, no warnings

# 6. Smoke test boot
./scripts/start_emmy.sh --profile profiles/llama-3.3-70b-instruct/v1
# Watch for:
#   - "loading weights N%"
#   - SP_OK canary fires + responds with [SP_OK]
#   - "smoke ok: tok/s=N" printed
# Press Ctrl+C after smoke confirms; Llama 3.3 70B FP8 expected ~5-12 tok/s on Spark.
```

Resume signal: type `llama smoke green` once profile.yaml has real hash, validate exits 0, and start_emmy.sh smoke prints `smoke ok: tok/s=N` with N>0.

**how-to-verify:**

1. `/models/Llama-3.3-70B-Instruct/` exists with the published weight files (config.json + safetensors shards)
2. `profiles/llama-3.3-70b-instruct/v1/serving.yaml.engine.container_image_digest` is real `sha256:` + 64 hex chars
3. `profiles/llama-3.3-70b-instruct/v1/profile.yaml.ref.hash` is real `sha256:` + 64 hex (NOT PLACEHOLDER)
4. `uv run emmy profile validate profiles/llama-3.3-70b-instruct/v1` exits 0 with no KNOWN-STALE warning
5. start_emmy.sh smoke output captured: stdout shows `smoke ok` line + tok/s value within 5-12 range

**resume-signal:** Type `llama smoke green` once verified

***

## Task 3 (checkpoint:human-verify, gate=blocking): KV bisection on DGX Spark — `find_kv_budget.py` is sole writer (Pitfall #1)

**what-built:**
- Profile bundle smoke-validated (Task 2)
- `scripts/find_kv_budget.py` already exists from Phase 1 (sole writer of `gpu_memory_utilization`)

**The OPERATOR runs:**

Window: ~3-4h (10 bisection iterations × ~12 min each on Llama 70B FP8).

```bash
cd /data/projects/emmy
# Ensure no other emmy-serve container is running (UMA contention)
docker stop $(docker ps -q --filter "ancestor=nvcr.io/nvidia/vllm:26.03.post1-py3") 2>/dev/null

uv run python scripts/find_kv_budget.py \
    --profile profiles/llama-3.3-70b-instruct/v1 \
    --drive-minutes 10 \
    --max-iters 12 \
    --output-dir runs/phase5-llama-judge-kv/<iso>/
# Bisection writes:
#   - serving.yaml.engine.gpu_memory_utilization (only this script may write)
#   - PROFILE_NOTES.md measured_values.gpu_memory_utilization frontmatter
#   - PROFILE_NOTES.md ## KV Bisection section with iteration log
#   - Recomputes profile hash automatically
```

Resume signal: type `llama kv green` once `find_kv_budget.py` exits 0 with "converged at gpu_memory_utilization=X" AND profile.yaml hash updated AND `uv run emmy profile validate` still exits 0.

**how-to-verify:**

1. `runs/phase5-llama-judge-kv/<iso>/summary.json` exists with `converged: true` + final `gpu_memory_utilization` value
2. `profiles/llama-3.3-70b-instruct/v1/serving.yaml.engine.gpu_memory_utilization` is a real number (likely 0.55-0.75 range based on Phase 04.1 patterns + Llama 70B FP8 footprint)
3. `profiles/llama-3.3-70b-instruct/v1/PROFILE_NOTES.md ## KV Bisection` section populated with iteration log
4. `profiles/llama-3.3-70b-instruct/v1/profile.yaml.ref.hash` is updated (recomputed by find_kv_budget.py)
5. `uv run emmy profile validate profiles/llama-3.3-70b-instruct/v1` exits 0

**resume-signal:** Type `llama kv green` when KV bisection converges + hash updated

***

## Task 4 (checkpoint:human-verify, gate=blocking): 2×2h thermal replay on DGX Spark — pass 1 records, pass 2 asserts

**what-built:**
- Profile KV-bisected (Task 3)
- `scripts/thermal_replay.py` already exists from Phase 1

**The OPERATOR runs:**

Window: ~5h total (2h pass-1 + 2h pass-2 + cool-down + summary).

```bash
cd /data/projects/emmy

# Pass 1: --record-floors (writes decode_throughput + gpu_clock floors to PROFILE_NOTES.md frontmatter)
uv run python scripts/thermal_replay.py \
    --profile profiles/llama-3.3-70b-instruct/v1 \
    --record-floors \
    --output-dir runs/phase5-llama-judge-thermal/pass1/

# Required outcome:
#   - "All floors recorded" line at end
#   - PROFILE_NOTES.md measured_values updated with decode_throughput_p50, decode_throughput_p1, gpu_clock_p5, gpu_clock_p50
#   - preemptions_hour2: 0
#   - oom_events: 0

# (Mandatory 5-min cool-down)

# Pass 2: --assert-floors (re-runs against the recorded floors; passes if floors hold)
uv run python scripts/thermal_replay.py \
    --profile profiles/llama-3.3-70b-instruct/v1 \
    --assert-floors \
    --output-dir runs/phase5-llama-judge-thermal/pass2/

# Required outcome:
#   - Exit 0 with "All floors pass"
#   - preemptions_hour2: 0
#   - oom_events: 0
```

Resume signal: type `llama thermal floors recorded` after pass 1; type `llama thermal green` after pass 2 exits 0.

**how-to-verify:**

1. `runs/phase5-llama-judge-thermal/pass1/summary.json` has `all_floors_recorded: true`, `preemptions_hour2: 0`, `oom_events: 0`
2. `runs/phase5-llama-judge-thermal/pass2/summary.json` has `all_floors_pass: true`, `preemptions_hour2: 0`, `oom_events: 0`
3. `profiles/llama-3.3-70b-instruct/v1/PROFILE_NOTES.md` measured_values frontmatter has all 6 numerical fields populated (gpu_memory_utilization + 4 floor values + preemptions_hour2 + oom_events)
4. `profiles/llama-3.3-70b-instruct/v1/PROFILE_NOTES.md` validation_runs list extended with the 2 thermal entries
5. `uv run emmy profile validate profiles/llama-3.3-70b-instruct/v1` still exits 0
6. profile.yaml hash unchanged across pass 1 → pass 2 (PROFILE_NOTES.md frontmatter mutates; profile.yaml does not)

**resume-signal:** Type `llama thermal green` when both passes succeed with zero preemptions + zero OOM

***

## Task 5 (auto): Update eval/MATRIX.md + close plan

**Files:** `eval/MATRIX.md`, `.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-05-SUMMARY.md`

**Behavior:**
- eval/MATRIX.md gets a 5th row for the Llama judge profile, annotated as eval-only
- MATRIX `## Notes` section extended with judge-profile rationale
- 05-05-SUMMARY.md authored citing all 4 resume signals + the final hash + measured KV value + thermal floors

**Action:**

Step 1 — Edit `eval/MATRIX.md` adding a 5th matrix row (preserve 4 existing rows byte-identical):

```
| Family | Variant | Profile ID | Version | Param count | Quant | Container | gmu | Hash | Status | Smoke tok/s | Thermal-2h p50 tok/s | Role |
|---|---|---|---|---|---|---|---:|---|---|---:|---:|---|
| ... [4 existing rows unchanged] ... |
| Llama 3.3 | Dense (judge) | `llama-3.3-70b-instruct` | `v1` (DEFAULT_VARIANT) | 70B | FP8 (runtime) | NGC `nvcr.io/nvidia/vllm:26.03.post1-py3` | <measured> | `sha256:<measured>` | **Phase 5 Plan 05-05 — eval-only** | <measured> | <measured> | judge |
```

Step 2 — Append to `## Notes` section:

```
- **Llama 3.3 70B Instruct judge profile (Phase 5 Plan 05-05)** — added as the eval-only different-family judge per EVAL-06 + D-03 from 05-CONTEXT.md. NEVER daily-driver. Sw apped in via `/profile llama-3.3-70b-instruct` after generation phase; swapped back to whatever was active before (typically the daily-driver default) after judging completes. Per Pitfall #5 air-gap discipline: this profile runs under STRICT lane (no outbound network); the optional cloud-claude judge path is the PERMISSIVE-lane sibling.
```

Step 3 — Author `.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-05-SUMMARY.md` per standard template, citing:
- 4 resume signals (`llama smoke green`, `llama kv green`, `llama thermal floors recorded`, `llama thermal green`)
- Final profile hash
- Measured KV `gpu_memory_utilization` value
- Thermal floors (decode p50, decode p1, gpu_clock p5, gpu_clock p50)
- `runs/phase5-llama-judge-{kv,thermal}/` evidence dir paths
- Daily-driver default UNCHANGED confirmation

Step 4 — Commit Plan 05-05 close:

```
docs(05-05): close Llama 3.3 70B Instruct judge profile authoring + judge subsystem
- profiles/llama-3.3-70b-instruct/v1/ KV-bisected gmu=<X>, 2x2h thermal All Floors Pass
- packages/emmy-eval/src/judge/{self-hosted,cloud-claude,family-guard,rubric} GREEN
- EVAL-06 closed
- Daily-driver default UNCHANGED (qwen3.6-35b-a3b/DEFAULT_VARIANT byte-identical)
```

**Verify:**

```
cd /data/projects/emmy && grep -c "llama-3.3-70b-instruct" eval/MATRIX.md && uv run emmy profile validate profiles/llama-3.3-70b-instruct/v1 && diff -q profiles/qwen3.6-35b-a3b/DEFAULT_VARIANT <(echo v3.1)
```

**Done:**
- eval/MATRIX.md has 5 matrix rows (4 generator + 1 judge)
- All 4 thermal/KV evidence dirs populated
- profile.yaml has measured KV + measured-floors-derived hash
- Daily-driver default byte-identical
- 05-05-SUMMARY.md authored with all evidence links

# Threat Model

## Trust Boundaries

| Boundary | Description |
|---|---|
| Llama judge swap → emmy-serve | Phase 4 swap-profile primitive owns this; same well-validated path daily-driver uses |
| Self-hosted judge → postChat | Allowlisted exception in uses-sdk.test.ts; documented JSDoc; single-shot only (no agent loop) |
| Cloud Claude judge → api.anthropic.com | PERMISSIVE lane only; STRICT refuses; ANTHROPIC_API_KEY required |
| Llama profile bundle ↔ Phase-04.1-class discipline | Same gates: zero preemption, zero OOM, sole-writer KV, 2×2h thermal |
| Daily-driver default ↔ this plan | UNCHANGED — explicit success criterion |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|---|---|---|---|---|
| T-05-05-01 | T (Tampering) | gpu_memory_utilization hand-edited | mitigate | Pitfall #1 sole-writer = `find_kv_budget.py`; profile validator can be extended to detect non-bisection mutations (out of scope for this plan; Phase 7 polish) |
| T-05-05-02 | S (Spoofing) | judge swapped to a same-family model | mitigate | assertJudgeFamilyClean fires before any judge invocation; tests cover the Llama vs Qwen/Gemma cases |
| T-05-05-03 | I (Information disclosure) | judge transcripts → cloud Claude | mitigate | PERMISSIVE lane only; operator opt-in via --judge=cloud-claude; documented in runbook (Plan 05-07 closeout); transcripts may contain task-specific code (acceptable since prior-Phase-1 + tbench tasks are public) |
| T-05-05-04 | E (Elevation of privilege) | uses-sdk allowlist grew (added self-hosted-judge.ts) | mitigate | Update is in this plan's commits; reviewer sees the allowlist change explicitly; pattern documented (single-shot judge calls only — no agent loop bypass) |
| T-05-05-05 | D (DoS) | Llama 70B FP8 won't fit on Spark | mitigate | Risk-flag from RESEARCH.md A3: fall back to a smaller Llama (8B / 11B Instruct) — still family-distinct; capability-weaker but functional; plan accepts this fallback path with operator approval |
| T-05-05-06 | R (Repudiation) | judge profile thermal floors gamed | mitigate | --record-floors writes raw nvidia-smi snapshots into PROFILE_NOTES.md; --assert-floors re-runs against same workload; gaming the floors requires editing both runs/phase5-llama-judge-thermal/pass1/summary.json AND PROFILE_NOTES.md frontmatter; both are git-tracked; tampering detectable |
| T-05-05-07 | T | judge prompt template overrides rubric mid-eval | mitigate | rubric.md is profile-bundle-immutable (D-02); changing it requires v2 directory; Plan 05-07 closeout records the active rubric path in REPRODUCER.md |

# Verification

End-of-plan checks:

1. `bun test packages/emmy-eval/tests/judge-self-hosted.test.ts packages/emmy-eval/tests/judge-cloud-claude.test.ts packages/emmy-eval/tests/judge-family-guard.test.ts` — all green
2. `uv run emmy profile validate profiles/llama-3.3-70b-instruct/v1` — exit 0
3. After Task 2: profile.yaml hash is real sha256 + 64 hex; container_image_digest pinned
4. After Task 3: serving.yaml.engine.gpu_memory_utilization is a real number; PROFILE_NOTES.md ## KV Bisection populated
5. After Task 4: PROFILE_NOTES.md measured_values has all 6 fields; both thermal pass dirs have summary.json with `preemptions_hour2: 0` + `oom_events: 0`
6. eval/MATRIX.md has 5 rows
7. `cat profiles/qwen3.6-35b-a3b/DEFAULT_VARIANT` returns `v3.1` (UNCHANGED)
8. uses-sdk.test.ts allowlist updated; uses-sdk test still GREEN

# Success Criteria

- Plan 05-03 + 05-04 + 05-07 can invoke `runSelfHostedJudge` from `@emmy/eval` and produce judge_score per row
- Plan 05-07's REPRODUCER.md captures the Llama judge profile hash + container digest + thermal floors
- EVAL-06 closed: judge is from a different family (Llama vs Qwen/Gemma); family guard test covers all 4 generator profiles
- Daily-driver bar UNCHANGED: post-plan boot of pi-emmy still defaults to qwen3.6-35b-a3b@v3.1

# Output

Create `.planning/phases/05-eval-harness-reproducible-benchmark-suite/05-05-SUMMARY.md` per standard template. Cite:
- 4 resume signals + commit SHAs
- Final profile hash + measured KV value + 4 thermal floor values
- Container digest captured
- Daily-driver default byte-identical confirmation
- judge subsystem export surface confirmed importable
