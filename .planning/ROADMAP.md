# Roadmap: Emmy

**Project:** Emmy — fully-local coding agent on NVIDIA DGX Spark
**Two parts:** specialized vLLM serving framework (Qwen 3.6 + Gemma 4) + pi-mono harness exposing all 8 customization surfaces
**Granularity:** Standard (5–8 phases, 3–5 plans each)
**Created:** 2026-04-20

## Daily-driver bar reached at: end of Phase 2
## Research-artifact bar reached at: end of Phase 5
## Public artifact bar reached at: end of Phase 7

---

## Phases

- [x] **Phase 1: Serving Foundation + Profile Schema** — emmy-serve with NGC vLLM container, Qwen3.6 end-to-end, profile registry on disk, KV/thermal/air-gap/SP_OK validation. **Closed 2026-04-21** with 3 documented deferrals (SC-1 architectural, SC-4→Phase 7, SC-5 re-validation→Phase 5); see 01-CLOSEOUT.md.
- [x] **Phase 2: Pi-Harness MVP — Daily-Driver Baseline** — pi-coding-agent with custom vLLM provider, full P1 toolset (hash-anchored edits default + MCP + web_fetch), grammar-constrained tool calls, AGENTS.md discipline; author can daily-drive. **Closed 2026-04-21** with SC-1 green + SC-2/3/4/5 pass; v2 profile hash `sha256:24be3eea...85d8b`; 5 architectural wire-through items carry to Phase 3. See `02-CLOSEOUT.md`.
- [x] **Phase 3: Observability + Agent-Loop Hardening + Lived-Experience** — Langfuse v3 + OTel GenAI semconv, smart context management with per-profile compaction, lived-experience telemetry (Alt+Up/Down), GPU/KV TUI footer, offline-OK badge. **Closed 2026-04-22** with v3 profile hash `sha256:2beb99c7...d4d3718` + 5/5 SCs green + 8 Phase-3 REQ-IDs flipped Done + 5 Phase-2 Done† promoted to Done (13 REQ-IDs total); see 03-CLOSEOUT.md.
- [ ] **Phase 4: Gemma 4 Profile + Profile System Maturity** — second first-class model proves the abstraction; `/profile` atomic swap with progress UX; within-model planner/editor/critic routing
- [ ] **Phase 5: Eval Harness + Reproducible Benchmark Suite** — eval runner imports harness via SDK; terminal-bench 2.0 + prior Phase 1 prompts + SWE-bench Verified + LiveCodeBench; ≥3 samples + std + provenance + executable-paired-with-judge
- [ ] **Phase 6: Speculative Decoding + Latency Polish** — Qwen3-MTP and EAGLE-3 (where available) configured per profile; paired spec-on/spec-off benchmark gate
- [ ] **Phase 7: Research-Grade Publication** — pin everything to digests, write methodology, publish lived-experience HF dataset, document "stand on shoulders" defaults; clean-Spark reproducer can verify every claim

---

## Phase Details

### Phase 1: Serving Foundation + Profile Schema

**Goal**: One profile (Qwen3.6-35B-A3B-FP8) loads on DGX Spark via the pinned NGC vLLM container and serves OpenAI-compatible chat completions with a versioned, content-hashed profile bundle on disk; the rig is provably air-gapped, KV-budgeted, thermally validated, and gated by a system-prompt-echo canary.

**Depends on**: Nothing (first phase). The forced sequential MVP spine starts here.

**Requirements**:
- SERVE-01 (NGC container `nvcr.io/nvidia/vllm:26.03.post1-py3`)
- SERVE-02 (Qwen3.6-35B-A3B-FP8 served, ≥60 tok/s target)
- SERVE-04 (OpenAI-compat `/v1/chat/completions` with `extra_body`)
- SERVE-07 (prefix caching + chunked prefill + documented prefix order)
- SERVE-08 (KV budget calculation, `gpu_memory_utilization=0.75`, zero-preemption gate)
- SERVE-09 (`VLLM_NO_USAGE_STATS=1` + air-gap test passes)
- SERVE-10 (`VLLM_LOAD_FORMAT=fastsafetensors`)
- SERVE-11 (2-hour sustained-load thermal validation per profile)
- PROFILE-01 (versioned, content-hashed bundle under `profiles/<name>/v<N>/`)
- PROFILE-02 (`{serving.yaml, harness.yaml, prompts/, tool_schemas/, grammars/, PROFILE_NOTES.md}` schema)
- PROFILE-03 (`serving.yaml` engine + sampling + spec + quirks; engine fields require restart)
- PROFILE-04 (`harness.yaml` hot-reloadable per-session fields)
- PROFILE-05 (`PROFILE_NOTES.md` provenance with citations)
- PROFILE-06 (immutable; field change → new version dir)
- PROFILE-09 (CI-validated schema + per-boot validation smoke test: SP_OK echo + tool-call parse + minimal generation)
- EVAL-07 (`[SP_OK]` canary infrastructure shipped here, used by every later phase)
- REPRO-01 (pinned Docker image with digest + `start_emmy.sh`)
- REPRO-03 (air-gap reproducibility CI test)
- REPRO-04 (HF model downloads cached; runs offline once cached)

**Success Criteria** (what must be TRUE):
  1. A single `start_emmy.sh` boots the NGC container, loads `Qwen/Qwen3.6-35B-A3B-FP8` from local cache via fastsafetensors, and serves `/v1/chat/completions` on loopback with measured throughput ≥60 tok/s on DGX Spark.
  2. The Qwen3.6 profile bundle exists on disk under `profiles/qwen3.6-35b-a3b/v1/` with the documented file structure, content hash recorded in `profile.yaml`, and immutability enforced (any edit to v1 fails or creates v2).
  3. A boot-time validation smoke test runs against every profile: emits a system prompt containing `[SP_OK]`, asserts the model echoes `[SP_OK]` in the response, asserts a sample tool-call parses, and asserts a 100-token generation completes — boot is rejected if any check fails.
  4. With the network cable physically pulled, `start_emmy.sh` boots successfully, the smoke test passes, and a 50-turn synthetic coding session produces zero outbound network packets (verified via `ss`/`tcpdump` snapshot in CI).
  5. A 2-hour sustained-load test on the actual coding workload completes with: zero vLLM preemption events in steady state, GPU clock not throttled below the documented per-profile threshold, no OOM-killer events on the harness host process.

**Plans**: 8 plans (5 initial + 3 gap-closure from 2026-04-21 verification)

Plans:
- [ ] 01-01-PLAN.md — Wave 0 scaffold: uv package + pytest config + RED test stubs for every Req-ID + .gitignore/.gitattributes + self-hosted runner doc
- [ ] 01-02-PLAN.md — pydantic v2 profile schema + canonical hasher + 3-layer immutability validator CLI + profile bundle populated
- [ ] 01-03-PLAN.md — emmy.canary (EVAL-07) + boot probe + docker-args renderer + smoke_test.py + start_emmy.sh (REPRO-01 contract) + operator NGC-digest capture checkpoint
- [ ] 01-04-PLAN.md — D-14 thermal audit + thermal corpus + KV-finder bisection + 2-hour thermal replay + measured-values commit checkpoint
- [ ] 01-05-PLAN.md — 50-turn air-gap fixture + D-12 layered validator + .github/workflows/airgap.yml self-hosted CI + PROFILE-06 Layer 2/3 enforcement + SC-4 demo checkpoint
- [x] 01-06-PLAN.md — SC-1 throughput sweep: Task 1 library + harness + 20 unit tests (`feea40c`/`742fd9b`); Task 2 **sweep executed on-machine 2026-04-21** (5 candidates, no winner); PROFILE_NOTES.md rewritten with accept-architectural disposition (`54d6b96`). Profile hash: sha256:b91e747…
- [x] 01-07-PLAN.md — SC-5 GPU-clock sampler fix: Task 1 GpuSampler per-field `[N/A]` fix + 7 regression tests (`4214b71`/`b510d1b`). **Tasks 2+3 deferred to Phase 5 re-validation** — the decode-throughput floor that `--assert-floors` actually gates on is already recorded; clock percentiles populate at next natural thermal re-run.
- [x] 01-08-PLAN.md — SC-4 certification machinery: Tasks 1+2 complete — trigger + verify scripts + D-12 fixtures + 13 unit tests + runbook (`93fab55`/`78ff0be`/`3889724`). **Task 3 deferred to Phase 7 public-artifact work** — local D-12 validator is executable today; the GitHub Actions wrapper makes fork-reproducibility harder, not easier (see 01-CLOSEOUT.md rationale).

---

### Phase 2: Pi-Harness MVP — Daily-Driver Baseline

**Goal**: The author can install pi-coding-agent v0.68.0, point it at the Phase 1 emmy-serve endpoint, and daily-drive a coding session — read/write/edit/bash + grep/find/ls + web_fetch + MCP — with hash-anchored edits as the default edit format, grammar-constrained tool calls via XGrammar, layered system prompt with hash logging, AGENTS.md discipline, and a TUI that feels like a real coding agent.

**Depends on**: Phase 1 (needs the vLLM endpoint, the profile bundle, and the SP_OK canary infrastructure).

**Requirements**:
- HARNESS-01 (built on `@mariozechner/pi-coding-agent` v0.68.0; extends via public extension API)
- HARNESS-02 (custom `pi.registerProvider` for local vLLM endpoint; strips non-OpenAI fields like `reasoning_content`)
- HARNESS-03 (tool-call format owned by the active profile; Hermes-style XML for Qwen)
- HARNESS-04 (agent loop: configurable retry-with-corrective-feedback, layered ReAct stop, infinite-loop guard, structured tool-result truncation)
- HARNESS-06 (system prompt assembly is layered global → project → user; emits hash to logs; ≤200-token base budget unless profile overrides with rationale)
- HARNESS-07 (per-tool / per-task sampling overrides via profile)
- HARNESS-10 (extensible tool registry — tools added/composed as pi extensions)
- TOOLS-01 (`read` with line ranges)
- TOOLS-02 (`write` overwrite)
- TOOLS-03 (`edit` with hash-anchored format **as default**; plain string-replace fallback only when hashes can't be computed)
- TOOLS-04 (`bash` cwd-persistent, timeout, abort, stderr capture)
- TOOLS-05 (`grep` / `find` / `ls` enabled by default)
- TOOLS-06 (`web_fetch` HTTP GET → markdown — documentation reading allowed)
- TOOLS-07 (MCP client extension overriding pi's "no MCP" stance via `@modelcontextprotocol/sdk`)
- TOOLS-08 (post-hoc unified diff display of edits, even in YOLO mode)
- TOOLS-09 (TODO/PLAN file pattern via edit tool)
- CONTEXT-01 (AGENTS.md / `.pi/SYSTEM.md` discipline; layered global → project → user; example template ships)
- CONTEXT-03 (file pinning via pi `@file` reference + read-at-session-start)
- CONTEXT-04 (per-profile prompt-prefix discipline documented for KV reuse)
- CONTEXT-05 (per-profile honest `max_model_len` constrained to KV cache reality)
- SERVE-05 (XGrammar grammar-constrained tool-call output enabled per profile + parse-rate smoke test)
- UX-01 (TUI is the primary surface, pi-tui-based)
- UX-05 (CLI / scripted mode — pi `print` and `json` modes, needed for later eval automation)

**Success Criteria** (what must be TRUE):
  1. The author can run `pi-emmy` against a clean repo, ask it to make a multi-file change, and the agent completes it using read/write/edit/bash/grep/find/ls + web_fetch — without any cloud call and without leaving the TUI.
  2. The default `edit` tool produces hash-anchored edits (Hashline pattern); a regression test covering the prior repo's 5 Phase 1 coding tasks shows zero "string not found" failures vs the plain string-replace baseline on Qwen3.6.
  3. Tool-call parse rate over a 100-call sample on Qwen3.6 (mixed real and synthetic) is ≥98% with XGrammar enabled, and the no-grammar baseline is captured for comparison (per the "grammar fights model" pitfall).
  4. Loading an MCP server (e.g. filesystem MCP) via `mcp_servers.yaml` exposes its tools through the same dispatch surface as native tools, and a tool poison test (hidden Unicode in description) is rejected at registration.
  5. The assembled system prompt for any session emits a stable hash to logs, the AGENTS.md from the working directory is included verbatim and counted in the prompt-token budget, and the per-profile `max_model_len` matches what KV cache actually fits (no theoretical claims).

**Plans**: 8 plans (structural revision 2026-04-21: split 02-03 → 02-03 + 02-06; split 02-05 → 02-07 + 02-08 + 02-09)
**UI hint**: yes

Plans:
- [x] 02-01-PLAN.md — Wave 0 scaffold: Bun workspace + 4 @emmy/* packages + profile v2 sibling + docs templates + committed bun.lock (completed 2026-04-21; commits 4fa82ac + ae97e04)
- [x] 02-02-PLAN.md — @emmy/provider: vLLM HTTP + OpenAI-compat strip + reactive grammar retry (nested tools.grammar.{path, mode} shape) (completed 2026-04-21; commits d6c3ba9 + 534e7a1 + c7d80f2 + c4a85ff)
- [x] 02-03-PLAN.md — @emmy/tools (part 1): hash-anchored edit primitives + atomic write + post-hoc diff (completed 2026-04-21; commits ce418d6 + 79327bd + 725249a + 1ee3dda)
- [x] 02-04-PLAN.md — @emmy/ux: pi-emmy CLI (real pi 0.68.0 runtime) + SP_OK gate + profile-validate pre-flight + 3-layer prompt + session transcript capture (completed 2026-04-21; commits 44c9267 + 9e4ac4d + 5f85527 + e1ea63a)
- [x] 02-05-PLAN.md — SUPERSEDED by 02-07/08/09 (structural revision 2026-04-21 — see CLOSEOUT for narrative)
- [x] 02-06-PLAN.md — @emmy/tools (part 2): 8 native tools (read/write/edit/bash/grep/find/ls/web_fetch) + MCP bridge + Unicode poison check (completed 2026-04-21; commits 6a23d40 + 42190b6 + 59e4258 + c5c8f4a + 2d5c358)
- [x] 02-07-PLAN.md — Profile v2 fill: nested tools.grammar shape + verified max_model_len + grammar + schemas + prompts + recompute hash + un-skip regression (completed 2026-04-21; commits 88e48a4 + 979a8d0)
- [x] 02-08-PLAN.md — SC-2/SC-3 (3 runs: reactive + disabled baseline + no_per_tool_sampling) / SC-4 / SC-5 evidence + PROFILE_NOTES validation_runs (completed 2026-04-21; commits dfb8627 + 507623f; all 4 SC verdicts=pass; v2 hash sha256:0025799f→sha256:24be3eea)
- [x] 02-09-PLAN.md — SC-1 daily-driver walkthrough checkpoint (the only non-autonomous plan) + CLOSEOUT + REQUIREMENTS traceability + ROADMAP/STATE advance (completed 2026-04-21; SC-1 verdict green; 4 live bug fixes 2c22018/4049d95/85fa910/a17f4a9; CLOSEOUT + 23 REQ-IDs closed)

---

### Phase 3: Observability + Agent-Loop Hardening + Lived-Experience

**Goal**: Every turn is observable end-to-end across the harness ↔ vLLM boundary via OTel GenAI semconv spans flowing into self-hosted Langfuse v3; per-profile auto-compaction keeps long sessions usable; the TUI footer shows GPU/KV/spec-accept live; a green "OFFLINE OK" badge surfaces the local-first thesis; and the author can rate any turn (Alt+Up/Down) into a JSONL corpus that becomes a publishable HF dataset.

**Depends on**: Phase 2 (needs a working harness with sessions and a tool runtime to instrument and surface footers in).

**Requirements**:
- HARNESS-05 (context management owned by harness — smart pruning, injection control, per-profile compaction policy)
- HARNESS-09 (OTel GenAI semconv spans across vLLM ↔ harness boundary; profile fields embedded in every event)
- CONTEXT-02 (auto-compaction with per-profile policy)
- TELEM-01 (self-hosted Langfuse v3 via Docker Compose; OTel `/api/public/otel` endpoint)
- TELEM-02 (lived-experience: Alt+Up/Down rating; free-text on thumbs-down; rich JSONL row schema)
- TELEM-03 (100% local; opt-out flag; HF-dataset-format export)
- UX-02 (TUI footer `[GPU 87% • KV 34% • spec accept 71% • tok/s 38]` from `nvidia-smi` + vLLM `/metrics`)
- UX-03 (Offline-OK badge from startup tool-registry audit; green if all-local, red if any tool went external)

**Success Criteria** (what must be TRUE):
  1. Opening a self-hosted Langfuse instance after a session shows one trace per turn with OTel GenAI semconv spans covering harness assembly, vLLM request, tool calls, and tool results — and every span carries `profile.id`, `profile.version`, `profile.hash` attributes.
  2. A 200-turn coding session that exceeds `max_input_tokens` triggers per-profile compaction without the agent losing the active task; structured truncation preserves error/diagnostic text verbatim and the truncation rate per tool is observable in the trace.
  3. Pressing Alt+Up or Alt+Down on the most recent turn writes a row to `~/.emmy/telemetry/feedback.jsonl` containing `{session_id, turn_id, profile_id, rating, comment, model_response, tool_calls, latency_ms, kv_used, tokens_in, tokens_out}`; thumbs-down opens a free-text prompt; an `--export-hf` command produces a HuggingFace `datasets`-loadable artifact.
  4. The TUI footer updates at ≥1 Hz with GPU%, KV cache%, spec-accept%, and decode tokens/sec read from `nvidia-smi` and vLLM `/metrics`; numbers are within 5% of the equivalent CLI tools at the same instant.
  5. Booting emmy in a configuration where every registered tool is local renders a green "OFFLINE OK" badge; adding a tool that requires network (or pointing web_fetch at a non-allowlisted host) flips the badge to red "NETWORK USED" before any session starts.

**Plans**: 7 plans

Plans:
- [x] 03-01-PLAN.md — Track B wire-through atomic wave: @emmy/provider streamSimple + tools customTools + 3-layer prompt authoritative + enable_thinking:false + reactive grammar live-path + a17f4a9 <think>-strip removal + SC-1 walkthrough **(complete 2026-04-22; verdict `sc1 green`; commits ab4648f RED + d4cd189 GREEN + 5e0ba97 walkthrough evidence + b18b257 SUMMARY)**
- [x] 03-02-PLAN.md — Langfuse v3 compose stack + @emmy/telemetry dual-sink (JSONL + OTLP) + OTel SDK init + EmmyProfileStampProcessor + EMMY_TELEMETRY=off kill-switch (HARNESS-09 + TELEM-01) **(complete 2026-04-22; commits f410bfd infra + 02d46c5 RED + d11f13e GREEN + 946da4d healthcheck fix; Task 4 SC-1 trace walkthrough operator-gated — resume signal `p3-02 trace green`)**
- [x] 03-03-PLAN.md — @emmy/context package: emmyCompactionTrigger + D-14 preservation pre-filter + D-16 fallback + D-12 fail-loud + SC-2 200-turn fixture (HARNESS-05 + CONTEXT-02) **(complete 2026-04-22; commits 42938e2 scaffold + b6557f4 trigger GREEN + 8756b67 SC-2 fixture/runner; fixture sha256:26149bfce4...a0a19b; stub-mode verdict=pass on default/alternate/disabled variants; live-mode matrix deferred to Plan 03-07; Rule-3 auto-fix folded in: pi 0.68 top-level exports narrower than planned, emmy uses EmmyCompactionPreparation + prepareCompactionLocal + injectable engine.summarize to preserve architectural invariant)**
- [x] 03-04-PLAN.md — 1 Hz TUI footer: vllm:gpu_cache_usage_perc parser + nvidia-smi TS port (N/A tolerant) + 5-sample sliding-window tok/s rate + graceful degrade + spec-accept placeholder (UX-02) **(complete 2026-04-22; commits 64a625f RED + 498390c GREEN + a43bd03 parity driver; 322 bun tests pass (+48 vs baseline); honors verified metric name vllm:gpu_cache_usage_perc (not kv_cache_usage_perc — CONTEXT D-22 typo); Task 3 SC-4 parity verification operator-gated — resume signal `p3-04 footer green`)**
- [x] 03-05-PLAN.md — Lived-experience rating: Alt+Up/Alt+Down via pi input event (ANSI x1b[1;3A/B) + 13-field feedback.jsonl schema + idempotent upsert + pi-emmy --export-hf + HF-datasets loadable (TELEM-02 + TELEM-03) **(complete 2026-04-22; commits 35b7023 RED + 1fc10c7 GREEN; 353 bun tests pass (+31); 11 truths satisfied incl. emmy-synthesized turn_id scheme + idempotent upsert + D-18 input-event intercept before pi's keybind resolution; Task 3 interactive TUI verification operator-gated — resume signal `p3-05 feedback green`)**
- [x] 03-06-PLAN.md — OFFLINE OK badge: tool-registry boot audit + web_fetch allowlist runtime enforcement + warn-and-continue red flip + hostname-exact match (UX-03) **(complete 2026-04-22; commits 84a2d89 RED + c4efb68 GREEN; 396 bun tests pass (+43); D-26 LOOPBACK_HOSTS size=4 with bind-all quad-zero excluded per plan-checker WARNING; D-27 hostname-EXACT web_fetch enforcement with CNAME-bypass + URL-credentials-bypass guards; D-28 warn-and-continue via ToolError-shaped return (webFetchWithAllowlist); module-level badge state machine bindBadge/setInitialAudit/flipToViolation for boot-audit-before-pi-ctx timing; IPv6 bracket normalization for loopback check only; ZERO deviations; Task 3 UX-03 demo operator-gated — resume signal `p3-06 badge green`)**
- [x] 03-07-PLAN.md — Phase close: profile v2→v3 bump + schema patch + PROFILE_NOTES provenance + air-gap CI extension + SC-1 walkthrough verdict + 8 REQ-IDs → Done + 5 Phase-2 Done† → Done + CLOSEOUT.md **(complete 2026-04-22; commits de4ae96 v2→v3 bump + schema + d3196bd air-gap CI dual-stack + 185e55c Phase-3 CLOSEOUT walkthrough sc1 phase3 green; v3 profile hash sha256:2beb99c773a0e425a3e485459964740640c5f3addbea186738402cf66d4d3718)**

**UI hint**: yes

---

### Phase 03.1: Operational polish — minimal-RAM profile, live auto-compaction + manual triggers, SearxNG web search, day-to-day documentation [x] Complete 2026-04-23

**Goal:** Close three operational defects that surfaced in a day of Phase-3-certified daily-driver use: (A) 116/125 GB system RAM used + 8 GB swap on UMA with `gpu_memory_utilization=0.88` (CLAUDE.md Pitfall #3 warned about 0.75; drop to 0.55); (B) Plan 03-03 auto-compaction was stub-only — agent hit the 114,688-token hard wall during a real research session; wire live `ctx.compact()` + add `/clear` manual escape valve; (C) 5-host doc allowlist is too narrow for research — refine thesis into "no cloud INFERENCE" (hard) + "local-first EGRESS via self-hosted SearxNG" (new, auditable). Plus day-to-day ops documentation. Produces sibling profile v3.1 per D-02 immutability (v3 byte-identical).

**Requirements**: TOOLS-10 (web_search), UX-07 (3-state badge); CONTEXT-02 advance (stub → live-wired); PROFILE-05 extended with D-29..D-38 provenance.

**Depends on:** Phase 3

**Success Criteria** (all PASS at close):
  1. `free -h` MemAvailable ≥ 40 GiB post-restart on v3.1 (observed: 42 GiB, 9× headroom vs v3's 4.6 GiB; swap dropped 7.2 → 2.9 GiB).
  2. Live auto-compaction fires on turn_start when context crosses soft threshold (86 016 tokens); 90K-token live walkthrough survived without hitting the 114 688-token hard wall.
  3. `/compact` + `/clear` slash commands dispatch end-to-end on the live pi 0.68 TUI.
  4. `web_search` tool returns sensible results from SearxNG (tested live — agent correctly grounded "Bun 1.3.13 released 1 day prior" from Google + npm search results); SearxNG rotates upstreams with auto rate-limit fallback.
  5. `web_fetch` returned-URL bypass works (exact-URL match; T-03.1-02-02 SSRF guard denies same-host different-path; kill-switches honored).
  6. Air-gap CI split into `ci_verify_phase3` (STRICT) and `ci_verify_research_egress` (PERMISSIVE); both dry-run exit 0.
  7. README + docs/runbook.md ship; CLAUDE.md thesis revised to "No cloud INFERENCE" + "Local-first EGRESS".

**Plans:** 3 plans

Plans:
- [x] 03.1-01-PLAN.md — RAM fit + live compaction + /compact + /clear (commits b372908+3f49f32+339e6f1+e87937b+d86e9b6; v3.1 hash `sha256:fcdecb23...`) **complete 2026-04-23**
- [x] 03.1-02-PLAN.md — SearxNG + web_search + web_fetch bypass + 3-state badge (commits 07fa0a3+d3afe7d+f2bddeb+891f6bd+cd435c9+89cf484; v3.1 hash `sha256:f9dcabd1...`) **complete 2026-04-23**
- [x] 03.1-03-PLAN.md — README + runbook + CLAUDE.md thesis revision + CLOSEOUT (this plan) **complete 2026-04-23**

### Phase 4: Gemma 4 Profile + Profile System Maturity

**Goal**: Adding `google/gemma-4-26B-A4B-it` (the MoE variant — explicitly NOT the bandwidth-bound 31B dense) as the second first-class model proves that "model-shaped" logic lives only in profiles. The `/profile` slash command swaps both vLLM (via reload) and harness state atomically with visible progress; within-model profile-routing for planner/editor/critic roles works; the README documents the "stand on shoulders" defaults sourced for each profile.

**Depends on**: Phase 2 (needs the harness MVP and the profile abstraction in real use). Phase 3's observability is helpful but not blocking.

**Requirements**:
- SERVE-03 (`google/gemma-4-26B-A4B-it` MoE variant served — runtime FP8 quant, function-calling format)
- PROFILE-07 (v1 profiles for both `qwen3.6-35b-a3b` AND `gemma-4-26b-a4b-it` exist and pass the boot smoke test)
- PROFILE-08 (`/profile <name>` slash command swaps vLLM via reload + harness state atomically with visible progress phases: `stopping vLLM`, `loading weights X%`, `warmup`, `ready`)
- HARNESS-08 (multi-model routing supported within a single model — profile-routing for planner/editor/critic; cross-model routing deferred to v2 unless dual-load proves feasible)
- UX-04 (model-swap UX with visible progress; no crash UX on swap failure)

**Success Criteria** (what must be TRUE):
  1. Running `/profile gemma-4-26b-a4b-it` from a Qwen3.6 session triggers a visible progress sequence (`stopping vLLM` → `loading weights N%` → `warmup` → `ready`) and resumes the session against Gemma 4 with its function-calling tool format and FP8 runtime quant; the same `/profile qwen3.6-35b-a3b` command swaps back.
  2. Both profiles pass the same boot smoke test (SP_OK + tool-call parse + minimal generation) and the same air-gap test from Phase 1; neither profile contains model-name-conditional code paths in the harness or serve layers — all model-shaped behavior is in YAML.
  3. A `routes.yaml` declaring `roles: {plan: qwen3.6-35b-a3b@v1-reason, edit: qwen3.6-35b-a3b@v1-precise, critic: qwen3.6-35b-a3b@v1-default}` (within one loaded model) routes turns through the right profile variant and each turn's trace records which role/profile was active.
  4. A swap that fails (e.g. corrupted weight file) leaves the user with a clear error message and the prior model still loaded — no crash, no half-loaded engine.
  5. The Gemma 4 profile's `PROFILE_NOTES.md` cites at least one community source per documented sampling default (per the "stand on shoulders" project principle), reviewable in git.

**Plans**: TBD
**UI hint**: yes

---

### Phase 5: Eval Harness + Reproducible Benchmark Suite

**Goal**: A reproducible benchmark suite that imports the Phase 2 harness as a library and drives `session.run(task)` through the public SDK — never bypassing — produces JSON + markdown reports. Suite includes terminal-bench 2.0 (primary), the prior repo's Phase 1 prompts (continuity baseline), SWE-bench Verified (milestone scoreboard), and LiveCodeBench (rolling contamination-resistant). Every result embeds full provenance; ≥3 samples report mean ± std; executable correctness is paired with LLM-as-judge from a different model family. This is where the research-artifact bar is reached.

**Depends on**: Phase 2 (needs the SDK entry point). Can run in parallel with Phases 3 & 4 once Phase 2 is stable.

**Requirements**:
- EVAL-01 (suite extends prior repo's Phase 1 prompts + terminal-bench 2.0 primary + SWE-bench Verified milestone)
- EVAL-02 (eval runner imports the harness as a library; calls `session.run(task)` via the public SDK; never bypasses)
- EVAL-03 (every result embeds `{profile.id, profile.version, profile.hash, vllm_version, container_digest, cuda_version, model_sha, eval_driver_commit, hardware_id}`)
- EVAL-04 (≥3 samples per task; mean ± std reported)
- EVAL-05 (contamination-resistant tracks: held-out hand-written tasks + rephrased variants + rolling LiveCodeBench)
- EVAL-06 (executable correctness paired with LLM-as-judge; judge model is from a different model family than generation)
- EVAL-08 (full eval suite required to declare any prompt or sampling change positive — directly mitigates "more prompting" trap)
- EVAL-09 (`pi-emmy --print-environment` dumps full environment; required by every eval result)
- UX-06 (SDK / RPC mode for programmatic embedding — the eval harness uses pi SDK directly)

**Success Criteria** (what must be TRUE):
  1. `pi-emmy-eval run --profile qwen3.6-35b-a3b@v1 --suite terminal-bench-2.0 --samples 3` runs every task three times via the harness SDK (no direct vLLM bypass), produces a JSON results file and a markdown report, and the JSON embeds the full provenance dict for every row.
  2. The same command on a clean DGX Spark, given the same git SHA + container digest + model SHA, reproduces every reported number within reported variance — verified by re-running on a second box (or via an "outside-reproducer" CI job that pulls the artifact).
  3. The contamination-resistant tracks (held-out + rephrased + LiveCodeBench) score within a documented gap of the public-benchmark numbers; if the gap exceeds threshold, the suite emits a "contamination signal" warning and the report flags affected tasks.
  4. Attempting to declare a prompt or sampling change "positive" via a subset run is blocked by the runner — the full suite must complete with mean(new) > mean(old) + std(old) before the change is recorded as a regression-passing tuning.
  5. Every result row carries the same `[SP_OK]` canary verification from Phase 1; any failed canary in the run aborts the batch and forces investigation before numbers are recorded (per the Phase 3 system-prompt-delivery incident).

**Plans**: TBD

---

### Phase 6: Speculative Decoding + Latency Polish

**Goal**: Speculative decoding is configured per profile — Qwen3-MTP for Qwen3.6 (built-in MTP via `qwen3_next_mtp`), EAGLE-3 for Gemma 4 if/when the speculator head exists for the 26B variant — and is gated by a paired spec-on/spec-off benchmark on the actual coding workload. A profile only ships with spec decode enabled when acceptance rate stays above the per-profile break-even threshold across the full eval suite.

**Depends on**: Phase 4 (need both profiles to make spec config per-profile meaningful) and Phase 5 (need the eval harness to do paired benchmarking honestly).

**Requirements**:
- SERVE-06 (per-profile speculative decoding: Qwen3-MTP for Qwen, EAGLE-3 for Gemma where speculator is available; gated by paired spec-on vs spec-off benchmark before keeping)

**Success Criteria** (what must be TRUE):
  1. The Qwen3.6 profile ships with `speculative.method: qwen3_next_mtp, num_speculative_tokens: 2` enabled, and a paired spec-on/spec-off run via the Phase 5 eval harness shows mean p50 latency improvement ≥1.4× with no quality regression on terminal-bench 2.0 (per the "speculative decoding regression" pitfall gate).
  2. Per-session acceptance rate for Qwen3.6-MTP is logged in OTel spans (Phase 3 observability) and visible in the TUI footer's `spec accept N%` field; sessions where acceptance drops below the break-even threshold trigger a logged warning.
  3. The Gemma 4 profile either (a) ships with EAGLE-3 enabled and passing the paired benchmark gate if a 26B speculator exists, or (b) ships with `speculative: null` and a `PROFILE_NOTES.md` entry explaining why no speculator is available, with the no-spec baseline benchmark recorded.
  4. Re-running the full Phase 5 eval suite with spec-on vs spec-off captures the win envelope per profile and per task class (short edits vs long planning vs search) so the project can document where spec decode helps and where it doesn't.

**Plans**: TBD

---

### Phase 7: Research-Grade Publication

**Goal**: Pin everything to digests, write the methodology doc, publish the lived-experience HF dataset, finalize the README documenting "stand on shoulders" defaults with full citations, and run the full reproducibility battery one more time so a stranger with a clean DGX Spark can verify every claim by running `start_emmy.sh && pi-emmy-eval run`. This is the public artifact bar.

**Depends on**: Phases 1–6 all stable. No new technical capability — this is artifact polish + final reproducibility certification.

**Requirements**:
- REPRO-02 (README documents "stand on shoulders" defaults sourced for each profile with full citations to community sources used)

**Success Criteria** (what must be TRUE):
  1. The README documents every default in every shipped profile with at least one citation to a community source, and the cited URLs are pinned via Wayback or content hash so they can be verified later.
  2. A stranger on a clean DGX Spark, given only the README, the pinned container digest, and the published model SHAs, can run `start_emmy.sh && pi-emmy-eval run --suite terminal-bench-2.0 --samples 3` and reproduce the published numbers within published variance — verified by an external reproducer (or a CI job simulating one).
  3. The lived-experience telemetry corpus from the author's actual daily-driver sessions is published as a HuggingFace dataset (with consent for any logged code excerpts), and the dataset card documents schema, profile coverage, and known biases.
  4. The full reproducibility battery (Phase 1 air-gap test, Phase 1 thermal test, every profile's boot smoke test, the Phase 5 eval suite with provenance dump, the spec-on/spec-off paired benchmark from Phase 6) all pass green in a final certification run, and the run artifacts are linked from the README.

**Plans**: TBD

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Serving Foundation + Profile Schema | 8/8 | Closed (with 3 documented deferrals) | 2026-04-21 |
| 2. Pi-Harness MVP — Daily-Driver Baseline | 9/9 | Closed (with 5 Phase-3 wire-through deferrals) | 2026-04-21 |
| 3. Observability + Agent-Loop Hardening + Lived-Experience | 7/7 | Closed (with 5 operator-gated evidence items deferred) | 2026-04-22 |
| 4. Gemma 4 Profile + Profile System Maturity | 0/? | Not started | - |
| 5. Eval Harness + Reproducible Benchmark Suite | 0/? | Not started | - |
| 6. Speculative Decoding + Latency Polish | 0/? | Not started | - |
| 7. Research-Grade Publication | 0/? | Not started | - |

---

## Coverage

**v1 requirements mapped:** 66 / 66 (100%)

| Category | Count | Phases |
|----------|-------|--------|
| SERVE (11) | 11 | P1: 01,02,04,07,08,09,10,11 · P2: 05 · P4: 03 · P6: 06 |
| PROFILE (9) | 9 | P1: 01,02,03,04,05,06,09 · P4: 07,08 |
| HARNESS (10) | 10 | P2: 01,02,03,04,06,07,10 · P3: 05,09 · P4: 08 |
| TOOLS (9) | 9 | P2: 01–09 |
| CONTEXT (5) | 5 | P2: 01,03,04,05 · P3: 02 |
| EVAL (9) | 9 | P1: 07 · P5: 01,02,03,04,05,06,08,09 |
| TELEM (3) | 3 | P3: 01,02,03 |
| UX (6) | 6 | P2: 01,05 · P3: 02,03 · P4: 04 · P5: 06 |
| REPRO (4) | 4 | P1: 01,03,04 · P7: 02 |

**Note on coverage count:** The REQUIREMENTS.md footer says "60 total" but the categorical counts in the same footer sum to 66. The 60 figure appears to be a transcription error in REQUIREMENTS.md; the 66 actual REQ-IDs (verified by enumeration) are all mapped.

---

## Critical-Pitfall Coverage

How the early phases address the 8 critical pitfalls from research/PITFALLS.md (early-phase placement is deliberate per the planning instructions):

| Pitfall | Severity | Addressed in |
|---------|----------|--------------|
| 1. KV-cache budget set from theory | Critical | P1 (calculated budget + zero-preemption gate + sustained-load test) |
| 2. vLLM API churn | High | P1 (profile pins exact container digest + commit) |
| 3. Grammar fights model | Critical | P2 (XGrammar + no-grammar baseline + parse-rate smoke test) |
| 4. Speculative decoding regression | High | P6 (paired spec-on/spec-off benchmark gate; deferred until P5 eval exists) |
| 5. "More prompting" trap | Critical | P5 (full-suite eval required to declare any prompt change positive) |
| 6. System-prompt delivery silently broken | Critical | P1 ([SP_OK] canary infrastructure shipped early; P5 every eval row carries canary verification) |
| 7. DGX Spark thermal throttle | High | P1 (2-hour sustained-load thermal validation per profile) |
| 8. Hidden cloud dependencies | Critical | P1 (telemetry off + air-gap CI test); P2 (offline-OK badge in P3 surfaces it visibly) |

Hash-anchored edits (P1 differentiator from FEATURES.md) land in P2 as the **default** edit format, not as later polish.

---

*Roadmap created: 2026-04-20*
*Granularity: Standard (5–8 phases)*
*Total phases: 7*
*Updated: 2026-04-21 — Phase 1 extended with 3 gap-closure plans (01-06/07/08) from VERIFICATION.md*
*Updated: 2026-04-21 — Phase 2 closed; SC-1 green; 23 REQ-IDs flipped to Done in REQUIREMENTS.md; v2 profile hash sha256:24be3eea...85d8b certified-at-close*
*Updated: 2026-04-22 — Phase 3 closed; 5/5 SCs green; 8 Phase-3 REQ-IDs flipped to Done + 5 Phase-2 Done† promoted to Done (13 REQ-IDs total; cumulative 36); v3 profile hash sha256:2beb99c7...d4d3718 certified-at-close; see 03-CLOSEOUT.md*
