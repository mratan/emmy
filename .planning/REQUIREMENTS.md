# Requirements: Emmy

**Defined:** 2026-04-20
**Core Value:** A local coding agent good enough to be the author's daily driver, structured rigorously enough to be a public research artifact others can reproduce — with no cloud dependency anywhere in the loop.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Serving (SERVE) — specialized vLLM layer

- [ ] **SERVE-01**: System runs vLLM 0.19.x inside the pinned NGC container `nvcr.io/nvidia/vllm:26.03.post1-py3` on DGX Spark (no upstream PyPI wheels — SM121 kernel failures)
- [ ] **SERVE-02**: System serves `Qwen/Qwen3.6-35B-A3B-FP8` as the primary model with measurable throughput (target ≥ 60 tok/s on Spark)
- [ ] **SERVE-03**: System serves `google/gemma-4-26B-A4B-it` (the MoE variant — *not* the 31B dense, which is bandwidth-bound at 6.9 tok/s) as the second first-class model
- [ ] **SERVE-04**: vLLM endpoint is OpenAI-compatible (`/v1/chat/completions`) and harness uses it with `extra_body` for grammar / `chat_template_kwargs` overrides
- [x] **SERVE-05
**: Grammar-constrained tool-call output via XGrammar (vLLM 0.19 default) is enabled per profile and validated by a parse-rate smoke test
- [ ] **SERVE-06**: Speculative decoding is configured per profile (Qwen3-MTP for Qwen models, EAGLE-3 for Gemma when speculator is available) and gated by a paired spec-on/spec-off benchmark before being kept
- [ ] **SERVE-07**: Long-context optimization is in place: prefix caching, chunked prefill, deliberate prompt-prefix order documented per profile so KV reuse is maximized
- [ ] **SERVE-08**: KV-cache budget is calculated explicitly per profile (start at `gpu_memory_utilization=0.75`) and validated against zero preemption under 30-min sustained load
- [ ] **SERVE-09**: Telemetry is off by default (`VLLM_NO_USAGE_STATS=1`) and the system passes an explicit air-gap test (no outbound network traffic during a representative session)
- [ ] **SERVE-10**: Boot uses `fastsafetensors` (`VLLM_LOAD_FORMAT=fastsafetensors`) — proven in prior repo for ~3× faster cold start
- [ ] **SERVE-11**: A 2-hour sustained-load thermal validation per profile confirms no throttle below an acceptable threshold (documented per profile)

### Profiles (PROFILE) — keystone abstraction

- [ ] **PROFILE-01**: Versioned, content-hashed profile bundle is the only shared contract between serving + harness; lives on disk under `profiles/<name>/v<N>/`
- [ ] **PROFILE-02**: Profile bundle has the structure `{serving.yaml, harness.yaml, prompts/, tool_schemas/, grammars/, PROFILE_NOTES.md}` with documented schema
- [ ] **PROFILE-03**: `serving.yaml` carries vLLM engine args, sampling defaults, speculative config, and quirk flags; engine-affecting changes require vLLM restart
- [ ] **PROFILE-04**: `harness.yaml` carries prompt paths, context limits, tool format, per-tool sampling overrides, retry policy, compaction settings; hot-reloadable per session
- [ ] **PROFILE-05**: `PROFILE_NOTES.md` records provenance for every default with citations (e.g. "source: Qwen team blog 2026-04-16") — implements the "stand on shoulders" project principle
- [ ] **PROFILE-06**: Profiles are immutable: any field change creates a new version directory; never mutated in place
- [ ] **PROFILE-07**: System ships v1 profiles for both `qwen3.6-35b-a3b` and `gemma-4-26b-a4b-it`
- [ ] **PROFILE-08**: `/profile <name>` slash command swaps both vLLM (via reload) and harness state atomically with visible progress
- [ ] **PROFILE-09**: Profile schema is CI-validated; a per-profile validation smoke test runs at boot (system-prompt echo `[SP_OK]` + tool-call parse + minimal generation)

### Harness (HARNESS) — pi.dev integration & customization surfaces

- [x] **HARNESS-01
**: System is built on `@mariozechner/pi-coding-agent` v0.68.0 (pi-mono); harness extends pi via its public extension API rather than forking
- [x] **HARNESS-02**: Custom pi `registerProvider` for the local vLLM endpoint, including the prior repo's compat-proxy lessons (e.g. strip `reasoning_content` if needed)
- [x] **HARNESS-03**: Tool-call format is owned by the profile (not hardcoded); each model uses what it parses best (Hermes-style XML for Qwen, function calling for Gemma 4)
- [x] **HARNESS-04
**: Agent loop is customizable: configurable retry-with-corrective-feedback, layered ReAct stopping conditions, infinite-loop guard, structured (not length-based) tool-result truncation
- [ ] **HARNESS-05**: Context management is owned by the harness: smart pruning, injection control, file pinning (via pi's `@file`), per-profile compaction policy
- [x] **HARNESS-06
**: System prompt assembly is layered (global → project → user), every assembly emits a hash to logs, and the assembled prompt fits a budget (default ≤ 200 tokens base, profile may extend with rationale)
- [x] **HARNESS-07
**: Sampling control is per-tool / per-task via the profile (planner, editor, critic can use different sampling)
- [ ] **HARNESS-08**: Multi-model routing is supported within a single model first (profile-routing for planner/editor/critic roles); cross-model routing deferred to v2 unless dual-load proves feasible
- [ ] **HARNESS-09**: Observability hooks emit OTel GenAI semconv spans across the vLLM ↔ harness boundary; profile fields embedded in every event
- [x] **HARNESS-10**: Tool registry is extensible: adding/removing/composing tools is a simple pi extension, no fork required

### Tools (TOOLS) — table-stakes coding-agent toolset

- [x] **TOOLS-01**: `read` (file with line ranges) — pi built-in
- [x] **TOOLS-02**: `write` (overwrite file) — pi built-in
- [x] **TOOLS-03
**: `edit` with hash-anchored format as default (Hashline pattern; documented 6.7→68.3% on 180 tasks for weak models); falls back to plain string-replace only when hashes can't be computed (e.g. binary)
- [x] **TOOLS-04**: `bash` (cwd-persistent, timeout, abort, stderr capture) — pi built-in
- [x] **TOOLS-05**: `grep` / `find` / `ls` enabled by default in emmy's profile
- [x] **TOOLS-06**: `web_fetch` (HTTP GET → markdown) — pi extension; documentation reading allowed (not inference)
- [x] **TOOLS-07
**: MCP client extension — overrides pi's "no MCP" stance; bridges MCP servers via `@modelcontextprotocol/sdk` so emmy can consume the LF-governed 10k+ MCP server ecosystem
- [x] **TOOLS-08**: Diff display of edits inline (post-hoc unified diff, even in YOLO mode)
- [x] **TOOLS-09**: TODO/PLAN file pattern (file-based, model reads/writes via edit tool — pi's existing pattern)

### Context (CONTEXT) — codebase comprehension

- [x] **CONTEXT-01
**: AGENTS.md / `.pi/SYSTEM.md` discipline; layered global → project → user; example AGENTS.md template shipped for emmy projects
- [ ] **CONTEXT-02**: Auto-compaction with per-profile policy (Gemma 4 may want different aggressiveness than Qwen 3.6)
- [x] **CONTEXT-03**: File pinning via pi's `@file` reference + read-at-session-start
- [x] **CONTEXT-04
**: Per-profile prompt-prefix discipline documented (system → AGENTS.md → tool defs → user; never reorder) so prefix caching is maximized
- [x] **CONTEXT-05
**: Per-profile honest `max_model_len` — documented and constrained to what KV cache actually fits

### Evaluation (EVAL) — research-grade reproducibility

- [ ] **EVAL-01**: Reproducible benchmark suite extending the prior repo's Phase 1 prompts (continuity baseline) plus terminal-bench 2.0 (primary) and SWE-bench Verified (milestone scoreboard)
- [ ] **EVAL-02**: Eval runner imports the harness as a library and drives `session.run(task)` through the public SDK — never bypasses
- [ ] **EVAL-03**: Each eval result embeds full provenance: `{profile.id, profile.version, profile.hash, vllm_version, container_digest, cuda_version, model_sha, eval_driver_commit, hardware_id}`
- [ ] **EVAL-04**: Eval supports ≥ 3 samples per task with std reporting (variance must not be hidden by single-shot runs)
- [ ] **EVAL-05**: Eval includes contamination-resistant tracks: held-out hand-written tasks, rephrased variants, plus rolling LiveCodeBench
- [ ] **EVAL-06**: Eval pairs executable correctness with LLM-as-judge (judge bias is a known pitfall)
- [ ] **EVAL-07**: System-prompt-echo (`[SP_OK]` canary token) gates every benchmark loop — prevents silent prompt-delivery failures (the Phase 3 incident)
- [ ] **EVAL-08**: Full eval suite (not subset) is required to declare any prompt or sampling change positive — directly mitigates the "more prompting" trap (Qwen3 8.5→6.8 in prior repo)
- [ ] **EVAL-09**: `pi-emmy --print-environment` dumps full environment for pasteable bug reports and required by every eval result

### Telemetry (TELEM) — observability + lived experience

- [ ] **TELEM-01**: Self-hosted Langfuse v3 over OTel GenAI semconv runs locally (Docker Compose); spans propagate across vLLM ↔ harness boundary
- [ ] **TELEM-02**: Lived-experience telemetry: Alt+Up / Alt+Down to thumb a turn, free-text prompt for thumbs-down; appended to JSONL with `{session_id, turn_id, profile_id, rating, comment, model_response, tool_calls, latency_ms, kv_used, tokens_in, tokens_out}`
- [ ] **TELEM-03**: Telemetry is 100% local, opt-out via flag, exportable to HuggingFace dataset format (the daily-driver corpus is itself a publishable artifact)

### UX (UX) — daily-driver feel

- [x] **UX-01**: TUI is the primary surface (pi-tui-based)
- [ ] **UX-02**: GPU/KV/spec-accept TUI footer (`[GPU 87% • KV 34% • spec accept 71% • tok/s 38]`) — reads `nvidia-smi` + vLLM `/metrics`
- [ ] **UX-03**: Offline-OK badge — startup audits tool registry; green "OFFLINE OK" if every path is local, red "NETWORK USED" if any tool went external
- [ ] **UX-04**: Model-swap UX — visible progress during `/profile` swap (`stopping vLLM`, `loading weights X%`, `warmup`, `ready`); no crash UX
- [x] **UX-05**: CLI / scripted mode (one-shot prompts, JSON I/O) — pi `print` and `json` modes; needed for eval automation
- [ ] **UX-06**: SDK / RPC mode (programmatic embedding) — eval harness uses pi SDK directly

### Reproducibility (REPRO) — research-artifact infrastructure

- [ ] **REPRO-01**: Pinned Docker image for serving with digest, plus one-command `start_emmy.sh`
- [ ] **REPRO-02**: README documents "stand on shoulders" defaults sourced for each profile with full citations to community sources used
- [ ] **REPRO-03**: Air-gap reproducibility test runs in CI: container starts, model loads, benchmark runs, no outbound network traffic — anyone with a Spark can verify
- [ ] **REPRO-04**: All HF model downloads are cached locally; gated-model auth tokens are documented but the system runs offline once cached

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Polish (POLISH)

- **POLISH-01**: A/B profile comparison report generator (`pi-eval compare --profile A --profile B`)
- **POLISH-02**: Session replay under a different profile (`pi-eval replay <session_id> --profile <new>`)
- **POLISH-03**: Static-site bench dashboard (`pi-eval report` regenerates a leaderboard site)
- **POLISH-04**: Profile-routing for planner/editor/critic roles within one model
- **POLISH-05**: Idle/sleep policy for model unload after configurable idle minutes

### Navigation (NAV)

- **NAV-01**: LSP integration (Pyright + ts-language-server first); becoming table stakes since Claude Code added native LSP Dec 2025
- **NAV-02**: Additional LSP languages (Rust, Go, Java)

### Power (POWER)

- **POWER-01**: Persistent Python kernel (oh-my-pi pattern — variables/imports survive across turns)
- **POWER-02**: True cross-model routing via either optimized swap + workflow checkpointing or dual-model load (target + draft co-loaded)
- **POWER-03**: Sandboxed execution via git worktree (oh-my-pi-style isolation backends)
- **POWER-04**: Web UI (using `@mariozechner/pi-web-ui`)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Cloud model fallback / hybrid routing | Defeats the local-first thesis and the research-artifact reproducibility story (PROJECT.md). If user wants Opus, use Claude Code in another terminal. |
| Hosted multi-user deployment / SaaS mode | Personal tool / research artifact (PROJECT.md). Single-user, single-machine, single-vLLM-process. |
| General chat / literature review / non-coding workflows | Narrow focus = better specialization (PROJECT.md). Phase 2 lesson confirmed domain-aware prompting matters. |
| Model fine-tuning / LoRA training | The bet is scaffolding, not training (PROJECT.md). Stock weights only — keeps reproducibility tractable. |
| Backwards compatibility with `setup_local_opencode` codebase | Emmy is a clean rebuild that draws on lessons, not code (PROJECT.md). |
| Approval popups for every tool use (Cline-style) | Pi-coding-agent's correct insight: once the agent has read+write+bash, real isolation is impossible inside the loop. ~40% slowdown for false safety. YOLO + per-tool denylist + git rollback instead. |
| 20+ specialized built-in tools (Roo Code-style) | Burns context tokens regardless of need. Pi's minimal-tool floor is a deliberate token-budget choice. Everything beyond the floor is an MCP server or pi extension loaded on demand. |
| Background bash / long-running daemons inside the agent | tmux is better at this. Document the tmux pattern in AGENTS.md; provide a `pi-tmux` skill. |
| Built-in browser automation (Playwright in-process) | Massive dependency, heavy on memory. Recommend Playwright MCP instead. |
| In-house repo map / RAG index (Aider PageRank-style) | LSP gives most of the benefit with much less complexity. Reconsider only if eval shows LSP insufficient. |
| Custom "modes" UX (Roo's Architect/Code/Debug/Ask) | `/profile` + system-prompt overlay does the same job with one fewer abstraction. |
| Plugin marketplace | Pi already has package install (`pi install npm:...`); MCP servers come from the official MCP registry. Don't build a third storefront. |
| Autonomous self-improvement loops (telemetry → self-edits → re-eval) | Conflicts with reproducibility (artifact must be deterministic for outsiders to verify). Emmy doesn't edit emmy. |
| IDE plugin (VS Code / JetBrains) | Massive scope explosion; pi-mono is TUI-first; daily-driver author works in terminal. |
| NVFP4 quantization on DGX Spark | Slower than FP16 on GB10 UMA (-23.6% at 32K context); ModelOpt 0.42.0 NaN bug. FP8 is the right call. |
| Gemma-4-31B (dense) on DGX Spark | Bandwidth-bound at 6.9 tok/s — unusable for daily driver. The 26B MoE variant is the only practical choice. |

## Traceability

Which phases cover which requirements. Updated by roadmapper 2026-04-20.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SERVE-01 | Phase 1 | Pending |
| SERVE-02 | Phase 1 | Pending |
| SERVE-03 | Phase 4 | Pending |
| SERVE-04 | Phase 1 | Pending |
| SERVE-05 | Phase 2 | Done |
| SERVE-06 | Phase 6 | Pending |
| SERVE-07 | Phase 1 | Pending |
| SERVE-08 | Phase 1 | Pending |
| SERVE-09 | Phase 1 | Pending |
| SERVE-10 | Phase 1 | Pending |
| SERVE-11 | Phase 1 | Pending |
| PROFILE-01 | Phase 1 | Pending |
| PROFILE-02 | Phase 1 | Pending |
| PROFILE-03 | Phase 1 | Pending |
| PROFILE-04 | Phase 1 | Pending |
| PROFILE-05 | Phase 1 | Pending |
| PROFILE-06 | Phase 1 | Pending |
| PROFILE-07 | Phase 4 | Pending |
| PROFILE-08 | Phase 4 | Pending |
| PROFILE-09 | Phase 1 | Pending |
| HARNESS-01 | Phase 2 | Done |
| HARNESS-02 | Phase 2 | Done † |
| HARNESS-03 | Phase 2 | Done |
| HARNESS-04 | Phase 2 | Done |
| HARNESS-05 | Phase 3 | Pending |
| HARNESS-06 | Phase 2 | Done † |
| HARNESS-07 | Phase 2 | Done † |
| HARNESS-08 | Phase 4 | Pending |
| HARNESS-09 | Phase 3 | Pending |
| HARNESS-10 | Phase 2 | Done |
| TOOLS-01 | Phase 2 | Done |
| TOOLS-02 | Phase 2 | Done |
| TOOLS-03 | Phase 2 | Done † |
| TOOLS-04 | Phase 2 | Done |
| TOOLS-05 | Phase 2 | Done |
| TOOLS-06 | Phase 2 | Done |
| TOOLS-07 | Phase 2 | Done † |
| TOOLS-08 | Phase 2 | Done |
| TOOLS-09 | Phase 2 | Done |
| CONTEXT-01 | Phase 2 | Done |
| CONTEXT-02 | Phase 3 | Pending |
| CONTEXT-03 | Phase 2 | Done |
| CONTEXT-04 | Phase 2 | Done |
| CONTEXT-05 | Phase 2 | Done |
| EVAL-01 | Phase 5 | Pending |
| EVAL-02 | Phase 5 | Pending |
| EVAL-03 | Phase 5 | Pending |
| EVAL-04 | Phase 5 | Pending |
| EVAL-05 | Phase 5 | Pending |
| EVAL-06 | Phase 5 | Pending |
| EVAL-07 | Phase 1 | Pending |
| EVAL-08 | Phase 5 | Pending |
| EVAL-09 | Phase 5 | Pending |
| TELEM-01 | Phase 3 | Pending |
| TELEM-02 | Phase 3 | Pending |
| TELEM-03 | Phase 3 | Pending |
| UX-01 | Phase 2 | Done |
| UX-02 | Phase 3 | Pending |
| UX-03 | Phase 3 | Pending |
| UX-04 | Phase 4 | Pending |
| UX-05 | Phase 2 | Done |
| UX-06 | Phase 5 | Pending |
| REPRO-01 | Phase 1 | Pending |
| REPRO-02 | Phase 7 | Pending |
| REPRO-03 | Phase 1 | Pending |
| REPRO-04 | Phase 1 | Pending |

**Status legend:**

- **Done** — shipped + tested + evidence captured in phase close-out.
- **Done †** — library shipped, unit-tested, and evidence captured via eval driver or SC runner; the pi-pipeline wire-through (pi `customTools` / `BeforeProviderRequestEvent` / `streamSimple`) is a documented Phase-3 deferral per `.planning/phases/02-pi-harness-mvp-daily-driver-baseline/02-CLOSEOUT.md` § Carry-forward. Counts as complete against the REQ-ID (the library is the authoritative deliverable; the pi-side hookup is integration).
- **Pending** — not yet started.

**Coverage:**

- v1 requirements: 66 actual REQ-IDs across 9 categories
  - SERVE: 11 (P1: 8 · P2: 1 · P4: 1 · P6: 1)
  - PROFILE: 9 (P1: 7 · P4: 2)
  - HARNESS: 10 (P2: 7 · P3: 2 · P4: 1)
  - TOOLS: 9 (P2: 9)
  - CONTEXT: 5 (P2: 4 · P3: 1)
  - EVAL: 9 (P1: 1 · P5: 8)
  - TELEM: 3 (P3: 3)
  - UX: 6 (P2: 2 · P3: 2 · P4: 1 · P5: 1)
  - REPRO: 4 (P1: 3 · P7: 1)
- Mapped to phases: 66 / 66 ✓
- Unmapped: 0 ✓

**Note on count:** the prior version of this footer said "60 total" but the categorical sub-counts in that footer also summed to 66. The 66 figure is the verified enumerated total of REQ-IDs in the document; the 60 figure was a transcription error.

---
*Requirements defined: 2026-04-20*
*Last updated: 2026-04-20 — traceability filled by roadmapper*
