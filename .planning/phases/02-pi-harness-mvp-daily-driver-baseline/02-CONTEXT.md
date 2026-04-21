# Phase 2: Pi-Harness MVP — Daily-Driver Baseline - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a TypeScript/Node harness on `@mariozechner/pi-coding-agent` v0.68.0 — extended via pi's public extension API (no fork) — that points at Phase 1's `emmy-serve:8002` loopback endpoint and becomes the author's daily driver. Phase 2 fills in every `TODO(Phase-2)` field in `profiles/qwen3.6-35b-a3b/v1/harness.yaml`, ships the `pi-emmy` CLI, and proves the daily-driver bar by passing the 5 ROADMAP success criteria on Qwen3.6.

**Scope of Phase 2** (23 REQ-IDs):
- HARNESS-01/02/03/04/06/07/10 — substrate, provider, tool-call format owned by profile, agent loop, layered system prompt with hash logging, per-tool sampling, extensible registry
- TOOLS-01/02/03/04/05/06/07/08/09 — read/write/edit (hash-anchored **default**) / bash / grep-find-ls / web_fetch / MCP / post-hoc unified diff / TODO-PLAN file pattern
- CONTEXT-01/03/04/05 — AGENTS.md discipline; file pinning via `@file`; prompt-prefix order; honest `max_model_len`
- SERVE-05 — XGrammar parse-rate gate (reactive, not always-on)
- UX-01/05 — pi TUI as primary surface; `pi-emmy --print` and `--json` scripted modes

**Out of Phase 2** (deferred per ROADMAP + Phase 1 CONTEXT):
GPU/KV/spec-accept TUI footer (UX-02 → P3), offline-OK badge (UX-03 → P3), OTel/Langfuse observability (HARNESS-09 → P3), auto-compaction (HARNESS-05 / CONTEXT-02 → P3), Gemma 4 second profile (→ P4), model-swap UX (UX-04 → P4), eval runner (→ P5), SDK/RPC mode (UX-06 → P5), spec-decoding bench (→ P6), journal tool (FEATURES differentiator → P3), LSP integration (→ v1.x).

</domain>

<decisions>
## Implementation Decisions

### Package topology & workspace

- **D-01:** Phase 2 ships **four TS/Node packages** inside one repo workspace: `@emmy/provider` (vLLM `registerProvider` + OpenAI-compat strip for `reasoning_content` etc.), `@emmy/tools` (hash-anchored edit wrapper + web_fetch + MCP bridge + post-hoc diff renderer), `@emmy/ux` (`pi-emmy` CLI shell, `--print` / `--json` modes), `@emmy/telemetry` (empty stub scaffold — Phase 3 fills it). Rationale: crisp per-concern boundaries, matches CLAUDE.md repo sketch, avoids Phase 3 retrofitting the workspace. Empty telemetry stub now ≫ telemetry-retrofit-workspace later.
- **D-02:** Workspace tool is **Bun workspaces + Bun runtime**. No `tsc` compile step — `bun` runs `.ts` directly. pi-mono itself is TS; Bun gives the fastest extension-dev iteration loop per STACK.md. Node 22 stays present for any pi-internal code paths that need it; Bun is the primary dev/exec runtime for emmy code.
- **D-03:** Binary entry point is **`pi-emmy`** — a thin bin in `@emmy/ux` that imports `createAgentSessionRuntime` from `@mariozechner/pi-coding-agent`, pre-registers the four emmy extensions, forwards pi-native `--print` / `--json` flags, and is the one-command daily-driver invocation SC-1 calls out by name. Running bare `pi` with emmy extensions is not supported in Phase 2.
- **D-04:** Install path on a fresh Spark is **clone + workspace install + link** — no npm publish in Phase 2. Concretely: `git clone …/emmy && cd emmy && bun install && bun link` (inside `@emmy/ux`), which exposes `pi-emmy` on `$PATH`. Phase 7 (public artifact) re-decides whether to publish to npm. Note: the `--text`-mode option that presented `pnpm install` was generic workspace-language — the canonical command is **`bun install && bun link`** since D-02 picked Bun.

### Hash-anchored edit format (Hashline)

- **D-05:** Anchor granularity is **per-line** — canonical Hashline. Read output tags every line with its own hash; edits reference individual line hashes. This is the exact pattern documented by oh-my-pi and the one behind Grok Code Fast 1's 6.7 → 68.3% result on 180 tasks. No window, no block — the weak-model empirical evidence is specifically for per-line.
- **D-06:** Hash function is **SHA-256 truncated to the first 8 hex characters** (32 bits) per line. Matches Emmy's existing hash style (Phase 1 profile content hash is SHA-256 hex). Node/Bun built-in `crypto.createHash('sha256')`. 32 bits = ~4B collision space per file — ample for single-file edits.
- **D-07:** Read-tool output renders hashes as a **fixed prefix column**: `{8hex}  {line_content}` (two-space separator). Every line is tagged on every read. The model learns a predictable shape; edits naturally re-use the hash it saw on the preceding read.
- **D-08:** Fallback to plain string-replace triggers **only on binary content or newly-created files** (no prior read to establish hashes). Any text file — TS / Python / YAML / JSON / MD / lark — stays on the hash-anchored path. Stale-hash stays on the hash path too (re-read, re-anchor, re-edit); there is no silent drift to string-replace on text files.
- **D-09:** Edit-tool API shape is **per-line list**: `{edits: [{hash: '<8hex>', new_content: '<replacement line>' | null}, …]}`. `new_content: null` deletes the line; insertions use a sibling op `{after_hash: '<8hex>', insert: ['line a', 'line b', …]}`. The simplest grammar that covers replace + delete + insert. Concrete JSON-schema and Lark grammar shape is planner territory (must support XGrammar reactive decoding per D-11).
- **D-10:** SC-2 regression fixture source is **lift from the prior repo + audit for edit-coverage**. Start from `/data/projects/setup_local_opencode/validation/eval_tasks.py` + `PHASE1_RESULTS_QWEN3.json` (the 5 Qwen3-Next tasks). Planner audits that all 5 actually exercise the edit tool (not just read/bash). If coverage gaps show up, augment with 1–2 synthetic edit-heavy tasks (rename-across-files, whitespace-adjacent edit, identical-content-lines edit) to stress the hash-anchor surface. SC-2's "prior repo's 5 Phase 1 coding tasks" wording survives; augmentation is called out in the test report so the delta is honest.

### XGrammar strategy & SC-3 parse-rate gate

- **D-11:** Grammar activation is **reactive** — the harness parses the model's unconstrained tool-call output first; only on parse failure does it retry the same turn with `extra_body.guided_decoding.grammar` populated. This is CLAUDE.md Pitfall #6 verbatim: grammar is a correctness backstop, not a quality lever. Baseline measurement is free — the retry counter *is* the signal. Phase 2 does **not** ship an always-on path; the `harness.yaml.tools.grammar.mode` knob is reserved in the schema but only the `reactive` mode is exercised.
- **D-12:** SC-3 parse-rate SLA is **graduated**: ≥98% on the synthetic half of the corpus, ≥95% on the real-session-replay half. Acknowledges that lived-experience prompt shapes are harder than designed-for-coverage synthetics; both gates must pass independently. Overall aggregate ≥97% as a watchdog (corpus-wide pass rate below that == investigation).
- **D-13:** 100-call corpus composition is **50 synthetic + 50 real-session replay**. Synthetic half: every table-stakes tool (read / write / edit / bash / grep / find / ls / web_fetch / MCP-client-synthetic) exercised with normal + adversarial shapes (long paths, nested JSON args, edge-case arg values, unicode filenames, empty-arg edge cases). Real-session half: Qwen3.6 tool-call transcripts captured during the Phase 2 dev sessions themselves — harness logs tool-call raw output to `runs/phase2-sc3-capture/` while the author daily-drives, 50 are sampled for the fixture at phase close.
- **D-14:** No-grammar baseline is **run once at Phase 2 close with `harness.yaml.tools.grammar.mode=disabled`**, on the same 100-call corpus; raw output committed alongside the grammar-on result in `runs/phase2-sc3/`. Not re-run every CI cycle — grammar-on is the production path, baseline is the "what would we lose without it" datapoint. Re-run only if model/profile version changes (caught automatically by the profile hash in the trace).

### MCP bridge dispatch & poison rejection

- **D-15:** Tool-name dispatch is **flat**. MCP-server-provided tools appear in the model's tool list by their raw MCP-declared name (e.g., `read_file`, `playwright_click`). If an MCP tool's name collides with a native emmy tool (e.g., MCP declares `read`), registration **fails loud** at session start with a named error; the user fixes by renaming in config (config-side `alias: <new_name>` field). Cleanest model-facing surface, zero naming bloat per tool def, no silent shadowing.
- **D-16:** MCP config is **layered**: `~/.emmy/mcp_servers.yaml` (user-level defaults) + `./.emmy/mcp_servers.yaml` (project-level), **project overrides user** on conflict (same key = project wins). Mirrors the CONTEXT-01 global → project → user layering pattern. User-level holds common MCPs (filesystem, web-search); project-level adds per-repo specialties (Playwright for web repos, Context7 only where used). A `~/.emmy/mcp_servers.yaml` example ships in `docs/mcp_servers_template.yaml`.
- **D-17:** MCP transport scope for Phase 2 is **stdio-only**. Every MCP server is launched as a subprocess; communication via stdin/stdout per the canonical MCP spec. Covers the Dec-2025 LF-donation ecosystem essentially in full (filesystem, GitHub, Playwright, Context7, and the dominant 10k-server population). HTTP/SSE transport is deferred to v1.x unless a concrete need surfaces.
- **D-18:** Tool-poison rejection at registration is a **Unicode category blocklist** applied to every MCP tool's `description` and `name`. Reject if any char falls in categories **Cf** (format), **Co** (private use), **Cs** (surrogate), or in the bidi-override range **U+202A–U+202E** or **U+2066–U+2069**. Deterministic, fast, zero-false-positive-risk for ASCII-safe descriptions. Covers the known invisible-Unicode / RTL-override tool-poisoning families. Prompt-injection (natural-language "ignore previous instructions") detection is **not** added in Phase 2 — the false-positive surface is too high for a registration-time gate; lived-experience surfaces real cases before Phase 3 designs the next layer.

### Claude's Discretion (E + F defaulted — planner may refine)

- **System-prompt layering (HARNESS-06, CONTEXT-04):** Default to **3-layer**: (1) the profile's `prompts/system.md` (model-shaped baseline — stays under 200-token base budget per HARNESS-06 unless profile overrides with rationale), (2) project `./AGENTS.md` (verbatim include, counted against prompt-token budget per SC-5), (3) user turn. Prompt-prefix order is system → AGENTS.md → tool defs → user, never reordered (CONTEXT-04 locked). The SHA-256 of the assembled prompt is emitted both to the structured session event stream and as a `prompt.assembled sha256=<hex>` log line on every session start per HARNESS-06 / SC-5.
- **AGENTS.md starter template:** Minimal stub shipped in `docs/agents_md_template.md` — sections for build/test commands, key paths, house-style rules, with placeholder text. Not a reference example (too much to maintain in sync); just enough that `pi-emmy init` could `cp` it.
- **CONTEXT-05 honest `max_model_len`:** Compute once during Phase 2 shakeout from Phase 1's measured `gpu_memory_utilization=0.88` KV ceiling + an assumed output token budget (e.g., 16K reserve); commit the number into `harness.yaml.context.max_input_tokens`. Planner may add a regression test that asserts `harness.yaml` is consistent with the recorded Phase 1 ceiling.
- **SC-3 gate wiring:** A committed parse-rate test invoked via `bun test` at Phase 2 close (not on every boot — boot stays fast). Per-boot smoke still runs the single tool-call smoke (Phase 1 D-08); the 100-call corpus is a deliberate CI / phase-close invocation.
- **Edit-tool grammar details:** Exact JSON schema for `{edits, inserts}` payload + the lark grammar shape for D-09 — planner decides based on what XGrammar parses cheapest under D-11 reactive mode.
- **Per-tool sampling seed values (`harness.yaml.tools.per_tool_sampling`):** Planner seeds with Qwen team / community defaults for edit (temp 0.0), bash (temp 0.0), read (temp 0.0); natural-language turns use the profile default. `PROFILE_NOTES.md` cites each source per PROFILE-05.
- **Text/binary detection heuristic for D-08 fallback:** Planner picks — `istextorbinary` npm lib, NUL-byte scan, or MIME-type sniff. Any correct implementation fine.
- **Bash tool-result truncation (HARNESS-04 "structured"):** Default to head + tail split (first N lines + "…" + last N lines) with total budget ~2000 tokens; planner tunes N on daily-driver observation.
- **AGENTS.md file-name precedence:** If both `./AGENTS.md` and `./.pi/SYSTEM.md` exist, `./AGENTS.md` wins (more-familiar open-agent convention). Planner can adopt pi's native `.pi/SYSTEM.md` too, but `AGENTS.md` is the advertised-to-users path per CONTEXT-01.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level scope and constraints
- `.planning/PROJECT.md` — vision, "stand on shoulders" principle, eight pi.dev pain-point axes, stock-weights-only
- `.planning/REQUIREMENTS.md` — 66 v1 REQ-IDs; Phase 2 specifically covers HARNESS-01/02/03/04/06/07/10, TOOLS-01..09, CONTEXT-01/03/04/05, SERVE-05, UX-01/05
- `.planning/ROADMAP.md` §"Phase 2: Pi-Harness MVP — Daily-Driver Baseline" — goal + 5 success criteria (all five MUST be demonstrable by phase close)
- `.planning/STATE.md` — Phase 1 closed 2026-04-21 with 3 deferrals; current focus = Phase 2 pi-mono harness
- `CLAUDE.md` — pinned tech stack, keystone profile abstraction (immutable versioned profiles, hash-anchored edits as default, reactive grammar, bash-first minimal tool floor, YOLO + denylist), 8 critical pitfalls mapped to phases

### Research docs (already synthesized — do not re-research)
- `.planning/research/STACK.md` — pi-coding-agent v0.68.0 API surface (`registerProvider`, `registerTool`, `on()`, `createAgentSessionRuntime`), Node ≥20 requirement, Bun optional-but-recommended, custom-provider docs link, 10k-server MCP ecosystem baseline, `reasoning_content`-strip lesson from prior repo
- `.planning/research/ARCHITECTURE.md` §1 (component boundaries: harness ↔ emmy-serve HTTP loopback, harness ↔ profile-registry filesystem), §3 (per-turn data flow — step 7 defines the `extra_body.guided_decoding.grammar` seam used by D-11), §4 (deployment topology; "two processes on the same box" locked), §8 (eight extension seams — tool runtime, profile, response post-processor, etc.)
- `.planning/research/FEATURES.md` — v1 table-stakes list (read/write/edit/bash/grep/find/ls/web_fetch/MCP — final 9-tool floor), edit-tool table (pi built-in + emmy hash-anchor wrapper — **wrapper, not replacement**), MCP differentiator callout ("most-leveraged single addition"), anti-patterns (20+ specialized tools, browser automation in-process, plugin marketplace)
- `.planning/research/PITFALLS.md` — Pitfall #3 (grammar fighting the model — D-11 reactive resolves), Pitfall #5 (more-prompting trap — Phase 2's biggest ambient risk: measure with the full corpus always), Pitfall #6 (SP delivery silently broken — D-07 SP_OK canary from Phase 1 covers the envelope; Phase 2 must invoke it on every session start), Pitfall #1 (KV theory vs practice — CONTEXT-05 honest max_model_len enforces), Pitfall #8 (hidden cloud deps — every new dep in `@emmy/*` audited against the air-gap contract)

### Phase 1 artifacts Phase 2 builds on (read before planning)
- `.planning/phases/01-serving-foundation-profile-schema/01-CONTEXT.md` — locked profile-bundle schema (D-01 Phase 1), content-hash discipline (D-02 Phase 1), SP_OK canary library shape (D-07 Phase 1) — Phase 2 imports, doesn't reinvent
- `.planning/phases/01-serving-foundation-profile-schema/01-CLOSEOUT.md` — Phase 1 disposition; note SC-1 throughput accepted-architectural at 48–50 tok/s (not 60); Phase 2 measures daily-driver feel at this throughput
- `profiles/qwen3.6-35b-a3b/v1/harness.yaml` — every `TODO(Phase-2)` comment is a Phase 2 deliverable; Phase 2 fills these, bumps to v2 if any schema field changes (per Phase 1 D-02 content-hash contract)
- `profiles/qwen3.6-35b-a3b/v1/prompts/system.md` — current SP_OK-tuned system prompt; Phase 2 keeps the SP_OK echo path and layers project AGENTS.md on top (per HARNESS-06)
- `profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md` — measured `gpu_memory_utilization=0.88`, thermal floors; CONTEXT-05 honest `max_model_len` computes from these
- `emmy_serve/canary/` (Phase 1) — SP_OK module emmy harness must import for per-session envelope check

### Prior-repo continuity (for SC-2 fixture and prior-lesson audits)
- `/data/projects/setup_local_opencode/validation/eval_tasks.py` — prior-repo Phase 1 task definitions (candidate source for SC-2 fixture per D-10)
- `/data/projects/setup_local_opencode/validation/PHASE1_RESULTS_QWEN3.json` — Qwen3-Next baseline scores; shape of what a "Phase 1 coding task" looks like; audit target for D-10 edit-coverage check
- `/data/projects/setup_local_opencode/validation/COMPREHENSIVE_FINAL_ANALYSIS.md` — SP-delivery incident writeup + "more prompting" regression evidence (Pitfall #5 source) — read before touching the system-prompt layering default
- `/data/projects/setup_local_opencode/validation/eval_harness_v2.py` — prior eval harness shape; reference only, not imported (emmy's eval is Phase 5)

### External (read-only, don't re-research)
- `https://github.com/badlogic/pi-mono` — pi-coding-agent source (for extension-API deep dives during planning)
- `https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md` — `registerProvider` API reference — relevant to D-01 `@emmy/provider` implementation
- `https://github.com/can1357/oh-my-pi` — canonical Hashline implementation (read the read-tool rendering + edit-tool schema before implementing D-05..D-09)
- `https://modelcontextprotocol.io` + `@modelcontextprotocol/sdk` TypeScript SDK — MCP spec and reference client; D-17 uses the stdio transport from this SDK
- vLLM 0.19 docs on `extra_body.guided_decoding.grammar` (XGrammar backend) — already LOCKED in Phase 1 serving.yaml; Phase 2 uses it via the HTTP seam

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (Python-side, from Phase 1)
- **`emmy_serve/canary/`** — SP_OK envelope module. The TS harness talks to this indirectly: every session start, `pi-emmy` sends the SP_OK ping turn as a liveness check against `emmy-serve:8002` and asserts `[SP_OK]` in the response. **Do not duplicate** the fingerprint in TS — the source of truth is the Python module + the profile's `prompts/system.md`.
- **`emmy_serve/profile/`** — profile validator + content hasher. The TS harness reads `harness.yaml` via `js-yaml` / `bun`'s built-in YAML, but profile-hash computation stays authoritative on the Python side (CLI `uv run emmy profile hash`). If the TS harness ever needs the hash, it shells out; it does **not** reimplement the hasher.
- **`profiles/qwen3.6-35b-a3b/v1/harness.yaml`** — every `TODO(Phase-2)` in this file is a Phase 2 deliverable. See lines: `prompts.edit_format`, `prompts.tool_descriptions`, `prompts.prepend_system_text`, `context.max_input_tokens`, `context.include_repo_map` (Phase 3), `tools.schemas`, `tools.grammar`, `tools.per_tool_sampling`, `agent_loop.*`, `advanced_settings_whitelist`.
- **`start_emmy.sh`** + `scripts/smoke_test.py` — Phase 1 boot orchestration. Phase 2's `pi-emmy` is a **separate process** (host TS/Bun); it does not modify the container boot path. A tiny wrapper script (`scripts/start_harness.sh` or similar) can invoke `start_emmy.sh` if not running, then exec `pi-emmy`.

### Reusable Assets (TS-side)
- **None in-repo yet.** The harness is greenfield on the TS side. Node 22 (`v22.22.2` via nvm) is present; Bun and pi-coding-agent are not installed. Phase 2 wave-0 is workspace bootstrap.

### Established Patterns to Replicate
- **Strict schema + content-hash discipline** (from Phase 1 profile-system): any harness-side config artifact (e.g., `mcp_servers.yaml`) should have a declared JSON schema + a validator, even if immutability is not enforced yet. Mirrors the profile-registry shape so the harness feels consistent.
- **Atomic JSON(L) append for event streams** (from `emmy_serve/diagnostics/`): the TS harness's per-turn event emission (for Phase 3 telemetry) should follow the same pattern — fsync-then-rename, never partial writes.
- **Fail-loud boot rejection** (from Phase 1 D-06): if emmy's harness fails its SP_OK assertion, fails MCP registration (tool poison or name collision), or can't reach `emmy-serve:8002`, **exit 1 with a named diagnostic** — do not quietly degrade. This is a daily-driver quality contract; silent fallback is worse than a loud refusal.

### Integration Points
- **`pi-emmy` ↔ `emmy-serve:8002`** — HTTP loopback, OpenAI-compatible. Model configured via `@emmy/provider` which reads the active profile's `serving.yaml.served_model_name` and `harness.yaml.tools.format` + `.grammar` to shape `extra_body`.
- **`pi-emmy` ↔ profile registry** — filesystem read at session start. Profile-active selection via env var `EMMY_PROFILE` or `--profile` CLI flag (defaults to `qwen3.6-35b-a3b/v1`).
- **`@emmy/tools` edit wrapper ↔ pi's built-in edit** — the wrapper *composes* pi's `edit` tool, it doesn't replace it. Flow: read-hashes captured at read-time → emmy's edit wrapper intercepts the tool call, validates hashes, calls pi's underlying string-replace with the hash-resolved content (or fails loud per D-08).
- **MCP bridge → native tool runtime** — `@emmy/tools`'s MCP bridge spawns stdio subprocesses per `mcp_servers.yaml` entry (D-16/D-17), registers each MCP-declared tool via `pi.registerTool` after the D-18 Unicode blocklist check, routes calls through the MCP SDK.

### Node / Bun toolchain status
- `node` 22.22.2 (via nvm) — present
- `bun`, `pnpm`, `pi-coding-agent` — **not installed**; Phase 2 wave-0 includes toolchain bootstrap + pi-coding-agent @ pinned 0.68.0

</code_context>

<specifics>
## Specific Ideas

- **`pi-emmy` is load-bearing SC-1 verbatim.** ROADMAP SC-1 says "run `pi-emmy` against a clean repo" — the binary name is not discretionary; it's the user-facing contract. D-03 locks it.
- **Bun was chosen for iteration speed, not ideology.** If Bun proves flaky against a specific pi-coding-agent internal (e.g., a native binding pi relies on that Bun doesn't yet support), planner may fall back to Node 22 for exec while keeping Bun for install. The fallback is allowed without a new decision — the intent is "fastest working iteration loop," not "must be Bun for purity."
- **Install command is `bun install && bun link`.** The discussion option labeled "`pnpm install`" used generic workspace-language; Bun is the resolved workspace tool per D-02.
- **`emmy-serve` is NOT modified in Phase 2.** The Python container boot path, profile validator, canary module, air-gap wrapper — all stable from Phase 1 closeout. If Phase 2 surfaces an `emmy-serve` bug (e.g., the `start_emmy.sh --airgap` 300s-timeout surfaced in Phase 1 CLOSEOUT), fix it as a separate patch commit; it's not part of the harness scope.
- **SC-5 "the per-profile `max_model_len` matches what KV cache actually fits (no theoretical claims)"** — the verification is: (a) `harness.yaml.context.max_input_tokens` is computed from Phase 1's measured `gpu_memory_utilization=0.88` + a documented output-budget reserve, (b) a regression test asserts this consistency, (c) the number is cited in `PROFILE_NOTES.md` with the computation shown. No back-of-envelope numbers allowed — same discipline as Phase 1 D-13 KV finder.
- **SC-4 "tool poison test (hidden Unicode) is rejected at registration"** — test fixture lives in `packages/emmy-tools/tests/mcp_poison.test.ts`. At least one fixture per rejected Unicode category (Cf, Co, Cs, bidi-override). Assertion: registration throws a named error; the offending tool is not in the active tool registry.
- **Pitfall #5 ("more prompting" trap) is the biggest ambient risk.** Every time a Phase 2 decision involves adjusting the system prompt, adding per-tool sampling, or tweaking the retry policy, the change MUST be measured against the full SC-3 corpus + SC-2 fixture, not a subset. Prior repo lost 8.5 → 6.8 on Qwen3 by ignoring this. Phase 2's measurement discipline is: any prompt/sampling/retry change commits alongside a before/after from the full corpus.
- **SP_OK canary fires on every session start.** The first turn of every `pi-emmy` session sends the `[SP_OK]` ping per Phase 1 D-07; a failure aborts the session with a named error (same diagnostic format as D-06). The user never invokes a tool call with a silently-broken system prompt — that's the entire point of the Phase 1 infrastructure investment.

</specifics>

<deferred>
## Deferred Ideas

- **Always-on grammar mode** (`harness.yaml.tools.grammar.mode=always_on`) — the schema knob exists but is not exercised in Phase 2. Add if Gemma 4's Phase 4 parse-rate benchmark shows reactive is insufficient on that profile.
- **Prompt-injection (natural-language) tool-poison detection** — beyond Unicode categories (D-18). Deferred — false-positive surface at registration-time is too high; lived-experience data from Phase 2+ informs the next layer, probably in Phase 3 alongside observability (detect suspicious tool-call patterns at runtime rather than at registration).
- **npm publish of `@emmy/*`** — Phase 2 installs via clone + link. Publish decision is Phase 7 (public artifact).
- **HTTP / SSE MCP transport** — D-17 locks stdio-only. Add if a concrete need surfaces (unlikely until shared-service MCP hosting matures).
- **4-layer system prompt** (global `~/.emmy/SYSTEM.md` above profile) — planner may add if author's daily driving reveals a "same reminder in every project" pattern. Phase 2 ships 3-layer.
- **Per-tool sampling tuning beyond defaults** — seeded by planner from Qwen community defaults; iterative tuning against eval is Phase 5.
- **LSP tool extension** — FEATURES.md v1 candidate, but out of Phase 2 per ROADMAP. V1.x or Phase 5.
- **Lived-experience journal tool** — Phase 3 differentiator (FEATURES.md).
- **Repo-map / Aider-style PageRank symbol graph** — `harness.yaml.context.include_repo_map` placeholder lives; turning it on is Phase 3 (FEATURES.md says defer to LSP; reconsider only if eval shows LSP insufficient).
- **Model-swap UX (`/profile` command)** — UX-04, Phase 4 when Gemma 4 arrives.
- **Offline-OK badge + GPU/KV/spec-accept TUI footer** — UX-03 / UX-02, Phase 3 alongside telemetry (`@emmy/telemetry` stub lands now; content in Phase 3).
- **SDK/RPC programmatic embedding mode** — UX-06, Phase 5 (eval harness uses pi SDK directly).
- **`start_emmy.sh --airgap` 300s timeout fix** — Phase 1 CLOSEOUT latent issue #1. Not Phase 2 harness scope; fix as a separate 1-2 line emmy-serve patch.

</deferred>

---

*Phase: 02-pi-harness-mvp-daily-driver-baseline*
*Context gathered: 2026-04-21*
