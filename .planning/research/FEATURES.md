# Feature Research: Emmy

**Domain:** Local-first AI coding agent (vLLM serving + pi.dev harness, on NVIDIA DGX Spark)
**Researched:** 2026-04-20
**Confidence:** HIGH (table stakes, MCP, LSP, eval) / MEDIUM (lived-experience telemetry, multi-model routing UX)

---

## Scope reminder

Emmy = (1) specialized vLLM serving for Gemma 4 + Qwen 3.6 + (2) pi.dev-based harness exposing all 8 surfaces opinionated harnesses hide. Done bar = author's daily-driver replacement for Claude Code AND a research-grade reproducible artifact. No cloud in the critical loop. No fine-tuning. Stock weights only.

The 2026 reference set surveyed: Claude Code (Anthropic), Cursor 3, OpenCode (140k stars), Aider, Cline (58k stars), Roo Code (Cline fork), Continue.dev 1.0, gptme, pi-coding-agent (badlogic/pi-mono), oh-my-pi (can1357 fork — adds LSP/Python kernel/browser/subagents), GitHub Copilot CLI, Codex CLI, Windsurf.

---

## Feature Landscape

### Table Stakes (Users Leave Without These)

These are the floor. If Emmy is missing any of them, the author won't pick it over Claude Code on a real day. Verified from multiple 2026 sources covering Claude Code, opencode, Cline, Roo Code, Aider, pi.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **File read / write / edit (string-replace)** | Universal — every agent has this. pi's 4-tool floor (read/write/edit/bash) is the absolute minimum. | S | Edit must be safe — rejected on stale view. Hash-anchored edits (oh-my-pi) eliminate "string not found" failures and are SOTA in 2026; emmy should adopt for weak local models specifically. |
| **Bash / shell execution** | Without it the agent is read-only. Every harness has it. | S | Must support cwd persistence per session; must surface stderr; should support timeout + abort. |
| **Grep / find / ls (structured search)** | Models burn tokens reinventing this with bash one-liners. Built-in is faster and more reliable. | S | pi exposes grep/find/ls behind flags; Claude Code has them as first-class. Table stakes for daily-driver feel. |
| **Project context file (AGENTS.md / CLAUDE.md / .pi/SYSTEM.md)** | Universal in 2026 — Claude Code, opencode, Cursor (`.cursorrules`), pi all support this. Authors expect to drop a file and have the agent pick up conventions. | S | AGENTS.md is the emerging cross-tool standard pi already uses. Emmy should match. |
| **Session persistence + resume** | All 2026 agents persist sessions (pi → `~/.pi/agent/sessions/`, Claude Code does append-oriented JSONL, opencode does the same). Daily drivers are interrupted constantly; resume is non-negotiable. | M | pi-mono already gives this for free; emmy inherits. Branch/fork is also pi-native and useful. |
| **Slash commands (`/model`, `/help`, `/compact`, `/resume`, `/settings`)** | Claude Code has ~85; pi has the core set. Users expect terminal-native command discovery. | S | pi already provides `/model`, `/settings`, `/resume`, `/tree`, `/compact`, `/fork`, `/clone`, `/export`, `/share`, `/reload`, `/hotkeys`. Emmy should add `/profile` (model profile selection) and `/eval` (run benchmark on current session). |
| **Streaming output with abort (Ctrl+C / Esc)** | Long generations need to be interruptible; users won't wait through bad outputs. | S | Standard in pi; verify graceful abort delivers partial state cleanly. |
| **Tool-use loop (ReAct-style: model → tool call → result → model)** | The agent definition. | S | pi-mono's agent loop is the substrate. |
| **Token / cost / context-usage display** | Every 2026 harness shows this in the footer. For local models, "cost" is GPU-time / KV-cache utilization; the indicator must remain. | S | pi's footer already shows token usage and context metrics. For local: replace $ cost with GPU-seconds and KV-cache % full. |
| **Auto-compaction of older turns at context limit** | Without it, long sessions die. Claude Code has 5-layer compaction pipeline; pi has `/compact` plus auto. | M | pi's customizable compaction is a 3rd-axis control surface emmy will lean on per model (different summarization budgets for Gemma 4 vs Qwen 3.6). |
| **Multi-model selection at runtime (`/model`)** | Pi has it; opencode is famous for it (75+ providers). With Gemma 4 AND Qwen 3.6 both first-class, runtime swap is mandatory. | M | Special twist: model swap on Spark requires reloading vLLM (only one model fits at a time). UX must hide that — show "swapping..." with progress, not a crash. See "Local-first specifics" below. |
| **Permission gates with allowlist (`--dangerously-skip-permissions` equivalent)** | Without allowlist, prompt-fatigue makes the agent unusable; without prompts at all, it's unsafe. Every modern agent has both modes. Pi defaults to YOLO; emmy should match (pi's philosophy fits the single-user local-machine threat model). | S | YOLO default + per-tool denylist. Don't build approval popups — pi's principle: real isolation impossible inside the loop, so don't pretend. |
| **MCP server support** | 2026 inflection point: Anthropic donated MCP to Linux Foundation in Dec 2025, 10k+ public MCP servers, all major vendors aboard. *Without* MCP support, emmy is excluded from the broader 2026 tooling ecosystem. | M | This contradicts pi-coding-agent's explicit "no MCP" stance. Emmy must override that philosophy — author wants daily-driver parity, MCP is now infrastructural. Implement as a pi extension, not a fork. |
| **Project-aware system prompt (loaded from file, layered with global)** | Every harness layers global → project → user prompt. The Phase 3 lesson from `setup_local_opencode` was that prompt delivery problems silently regressed Qwen3 by 2 points — emmy must own this surface. | S | pi's `.pi/SYSTEM.md` and `APPEND_SYSTEM.md` give this for free. Surface it in the footer ("system prompt: 743 tokens, 3 layers"). |
| **Tool-call format that matches the model** | This was a primary pain point in `setup_local_opencode` — Hermes XML had to be reparsed mid-stream. For weak local models, tool-call format is the difference between a working agent and an infinite retry loop. | M | Grammar-constrained / structured tool output via XGrammar (vLLM's default backend since Dec 2024) is mandatory for Gemma 4 (function calling) and recommended for Qwen 3.6 (Hermes-style XML). One profile per model. |
| **Diff display of edits before/after** | Cline pioneered "show the diff, ask permission" UX; users expect to see what changed. Even in YOLO mode, post-hoc diff is mandatory. | S | Render unified diff inline. |
| **TODO/Plan file as agent-managed artifact** | Plan mode is in Codex, Claude Code, opencode. Pi explicitly does this via TODO.md / PLAN.md (file-based, user-editable). For long tasks the model needs externalized state. | S | File-based, not in-memory. Pi's pattern wins for transparency. |
| **Web fetch tool** | Reading docs at runtime is essential for daily-driver coding. Local models don't know 2026 APIs. | S | Standard HTTP fetch returning text/markdown. Don't build browser automation in v1; defer to MCP (Playwright MCP exists). |
| **Quiet error recovery / retry on transient failures** | Models occasionally produce malformed tool calls; retry-with-corrective-feedback is in every modern harness. Without it, a single bad token kills the session. | M | This is one of emmy's 8 surfaces (agent loop / retry / self-correction). For weak local models, this surface needs *more* tuning than for cloud models. |

**Total table-stakes count:** 18. About half come for free from pi-mono. The rest are emmy-specific work or local-first adaptations.

---

### Differentiators (Where Emmy Competes)

These are where emmy earns its existence. The bar: each one should be either (a) underserved in the local-agent space, or (b) directly enabled by the local + research-artifact thesis.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Versioned model profiles (sampling + prompt + tool format + KV strategy as one artifact)** | Highest-leverage differentiator. No other open local agent treats "this model with these settings" as a first-class versioned object. Encodes "stand on shoulders" community knowledge as code. Shared across serving and harness layers (PROJECT.md key decision). | M | Profile = `{model_id, vllm_args, sampling, system_prompt, tool_format, grammar, compaction_policy}`. Stored as YAML in repo, tagged with provenance ("source: Qwen team blog 2026-04-16"). `/profile` switches both vLLM and harness atomically. |
| **Reproducible benchmark suite extending Phase 1 prompts** | Direct PROJECT.md requirement. No SOTA local-agent project ships a re-runnable eval that anyone with a Spark can reproduce. Aider Polyglot is the closest comparable; emmy's eval is per-profile, capturing serving-layer choices too. | L | 5 prior coding tasks + 3 literature tasks + add 5–10 SWE-bench-style tasks. Pinned vLLM version, pinned profile, deterministic seeds where possible. Outputs JSON + markdown report. Runnable as `pi /eval` slash command or standalone CLI. |
| **Lived-experience telemetry: in-session 👍/👎 + free-text feedback, written to dataset** | PROJECT.md called this out explicitly: "subjective ↔ objective tension". No local agent does this; cloud agents log it but don't expose it. The dataset becomes a research artifact in itself ("100 hours of daily-driver feedback on Qwen 3.6 with Profile X"). | M | Implement as pi extension. Bind keys (Alt+Up / Alt+Down) per turn. Feedback rows: `{session_id, turn_id, profile_id, rating, comment, model_response, tool_calls, latency_ms, kv_used}`. Append to JSONL. |
| **Session replay with profile swap** | Reload a past session, re-run it under a different model profile, diff outcomes. Directly enables A/B comparisons that today require manual scripting. Builds on pi's `/tree` and JSONL session storage. | M | Pi already saves JSONL. Add `/replay <session_id> --profile <new_profile>`. Critical for "did the new sampling change actually help?" |
| **Hash-anchored edits (Hashline-style)** | SOTA 2026 edit format — Grok Code Fast 1 went from 6.7% to 68.3% on 180 tasks just by switching format. For weaker local models, this is the highest-leverage edit-tool improvement available. Underused in open agents (oh-my-pi has it; Cursor/Aider/Claude Code do not). | M | Tag every line with short content hash on read; require hash anchors on edit; reject stale edits. Especially valuable for Gemma 4 / Qwen 3.6 where exact-string-match failures are common. |
| **LSP integration (definitions, references, diagnostics)** | Claude Code added native LSP in Dec 2025; opencode has LSP support. For navigation-heavy tasks LSP is 1000× faster than text search (50ms vs 45s per Claude Code's blog). For local models with small context windows, this matters even more — every saved token is real. | L | 11 LSP operations per oh-my-pi: diagnostics, definition, type_definition, implementation, references, hover, symbols, rename, code_actions. Start with Pyright + ts-language-server; add Rust/Go later. Implement as pi extension. |
| **Persistent Python kernel (oh-my-pi-style)** | Variables / imports / loaded data survive across turns. For data-science and refactoring sessions, drastically reduces re-execution overhead. Differentiator vs every text-only harness. | M | Embed jupyter kernel via pi extension. Start with python; defer node/julia. |
| **Multi-model routing per task class (planner / editor / critic)** | 2026 best practice (per Augment, Anthropic engineering): different models for different roles. Locally constrained: only one big model loads at a time on Spark, but routing across *profile-on-same-model* is feasible (e.g., Qwen 3.6 with high-reasoning profile for plans, low-temp profile for edits). Eventually: dual-model with one big + one tiny draft. | L | Start with profile-routing, not model-routing. Spec: declarative routing rules (`role: planner → profile: qwen3.6-reason`, `role: editor → profile: qwen3.6-precise`). Defer cross-model routing to v2 (requires either swap latency optimization or dual-load sizing). |
| **Speculative decoding (draft + target) baked into serving profile** | Verified 2026 win: vLLM speculative decoding gives 1.4–1.6× on Qwen3.5 35B and up to 4× on SWE-bench-style agentic workloads. Direct PROJECT.md requirement. Underused in open local agents (Ollama / LM Studio don't expose it). | M | Per-profile spec-decode config: which draft model, draft tokens per step. Memory budget on Spark: target + draft must coexist; pick draft sizes accordingly. |
| **Long-context KV-cache strategy + prompt prefix caching** | Claude Code reports 92% prompt-cache hit rate, 81% cost savings. Locally, prompt caching = latency, not dollars — but the KV cache is the bottleneck on Spark (128GB shared). Per-profile cache strategy (stable prefix order, layered system prompt for max prefix reuse) is high-impact. | M | Already enabled in vLLM by default; emmy's contribution is *deliberate prompt-prefix design* (system prompt → AGENTS.md → tool defs → user → never reorder) so cache reuse is maximized. Document the contract in each profile. |
| **GPU-utilization / KV-cache / model-load progress in TUI footer** | Local-first specific. Users on local hardware care viscerally about whether the GPU is saturating, KV is filling, or model swap is in progress. None of the surveyed agents (designed for cloud) show this. | S | Read `nvidia-smi` once per second; show `[GPU 87% • KV 34% • spec accept 71%]` in footer. Pi extension. |
| **Offline operation guarantee + visual indicator** | "Local-first" is differentiator. Make it visible: a green "OFFLINE OK" badge if every tool path is local; red "NETWORK USED" the moment any tool (web fetch, MCP-over-net) goes external. | S | Audit tool registry at startup; render badge. Useful research-claim signal too. |
| **OpenTelemetry traces of agent turns (gen_ai semantic conventions)** | OTel published GenAI semantic conventions in 2025; production agents use them. For a research artifact, exporting to a self-hosted Tempo/Jaeger gives "here's exactly what happened, replayable" — far stronger than text logs. | M | Pi extension that emits OTel spans per turn / tool call. Enables both debugging and the eval harness ("show me all turns where tool X was called > 3 times in this profile"). |
| **HTML / shareable session export with full tool trace** | Pi already has `/export` (HTML) and `/share` (gist). Emmy's research-artifact thesis means every shared session should include profile metadata, GPU stats, and the exact eval prompt — making bug reports and reproducibility trivial. | S | Extend pi's export with profile + telemetry. |
| **A/B benchmark runner: same prompts, two profiles, side-by-side report** | Concrete realization of the research-artifact bar. Run profile A vs profile B on the eval suite, get a markdown diff. No local agent has this. | M | Builds on benchmark suite + telemetry. Output: per-task pass/fail + judge score + tokens + latency, side-by-side. |

**Differentiator priority (P1 = ship first):**
- P1: Versioned model profiles, hash-anchored edits, GPU/KV footer, lived-experience telemetry, reproducible benchmark suite, OTel traces.
- P2: LSP integration, session replay with profile swap, A/B benchmark runner, speculative decoding profile, multi-model routing (within-model profiles).
- P3: Persistent Python kernel, true cross-model routing.

---

### Anti-Features (Deliberately NOT Building)

These are commonly requested but explicitly excluded. Each entry includes the reason they're *not* a fit and what emmy does instead. Narrow focus = better specialization.

| Feature | Why Tempting | Why NOT in Emmy | What to Do Instead |
|---------|-------------|-----------------|-------------------|
| **Cloud model fallback / hybrid routing (`shannon --team` Opus-led from prior repo)** | The prior `setup_local_opencode` has this and it's powerful. | Defeats local-first thesis and the research-artifact reproducibility story. Out of Scope per PROJECT.md. | If the user wants Opus, they can use Claude Code in a different terminal. Emmy's contract: zero cloud in the critical loop. |
| **IDE plugin (VS Code / JetBrains)** | Cursor / Continue.dev / Cline live in the editor; many users won't leave the IDE. | Massive scope explosion (LSP-as-server vs LSP-as-client, editor extension API, multi-language packaging). Pi is a TUI-first harness. Emmy's daily-driver author works in terminal. | TUI only in v1. Pi-mono has a web UI library if a v2 wants browser-based UI; defer. |
| **Multi-user hosted deployment / SaaS mode** | Open agents (Roo Cloud, Cursor cloud agents) are moving here. | Out of Scope per PROJECT.md. Personal tool / research artifact. | Single-user, single-machine, single-vLLM-process. Document this constraint. |
| **General chat / literature review / non-coding workflows** | Spark is capable; reusing the stack for other domains is appealing. | Out of Scope per PROJECT.md. Narrow focus is the specialization. The Phase 2 lesson confirmed: domain-aware prompting matters and one-prompt-fits-all regresses. | Coding agent only. Revisit only after coding v1 is solid. |
| **Model fine-tuning / LoRA training** | "Local agent that improves itself" is seductive. | Out of Scope per PROJECT.md. The bet is scaffolding, not training. Keeps reproducibility tractable. | Stock weights only. All gains from serving + harness. |
| **Approval popups for every tool use (Cline-style)** | Safety. | Pi-coding-agent's correct insight: once an agent has read+write+bash, real isolation is impossible inside the loop. Approval popups create 40% slowdown (per AIFire 2026) and a false sense of safety. | YOLO default with per-tool denylist; rely on git for undo, snapshots for rollback, sandboxed execution (git worktree) for high-risk runs (oh-my-pi pattern, deferred to v2). |
| **20+ specialized built-in tools (Roo Code-style)** | Convenience. | Burns context tokens regardless of need. Pi's 4-tool floor is a deliberate token-budget choice — every extra tool def in the system prompt costs cache space and confuses small models. | Keep the floor minimal (read/write/edit/bash + grep/find/ls + web_fetch). Everything else as MCP server or pi extension, loaded on demand. |
| **Background bash / long-running daemons inside the agent** | Convenient for dev servers. | Pi's correct take: tmux is better at this than the agent will ever be, with vastly better observability. | Document the tmux pattern in AGENTS.md. Provide a `pi-tmux` skill. |
| **Built-in browser automation (Playwright in-process)** | Common in 2026 (Cline has it). | Massive dependency, heavy on memory. Playwright MCP exists and is the industry pick (GitHub Copilot ships with it). | Recommend Playwright MCP; document the install. |
| **In-house repo map / RAG index (Aider-style PageRank ranking)** | Aider's repo map is impressive. | LSP gives most of the benefit (definitions, references, symbols) with much less complexity. Symbol-graph repo maps add ~1000 lines of indexing code per language. | LSP-first navigation. Add a thin `repo_overview` tool that calls `tree -L 3` + LSP symbol search. Reconsider full repo map only if LSP proves insufficient on the eval suite. |
| **Custom "modes" UX (Roo's Architect/Code/Debug/Ask)** | Users like the structure. | Profiles + slash commands give equivalent flexibility without a new UX concept. A "mode" is just a profile + system-prompt overlay. | `/profile architect` does the same job; less to learn, fewer abstractions. |
| **Plugin marketplace (Cline-style MCP marketplace)** | Network effects, discoverability. | Pi already has a package install mechanism (`pi install npm:...`). MCP servers come from the official MCP registry. Don't build a third storefront. | Document recommended MCP servers + pi packages in README. |
| **Autonomous self-improvement loops (telemetry → self-edits → re-eval)** | "Closing the loop" is in the air (Arize 2026, Future AGI). | Out of scope; conflicts with reproducibility (artifact must be deterministic for outside parties to verify). | Telemetry is read-only data for the human. Emmy doesn't edit emmy. |

---

## Local-First Specifics (Section 2 of question)

Local agents have UX obligations that cloud-served agents don't. Distilled from NVIDIA DGX Spark forums, LM Studio docs, and the prior `setup_local_opencode` lessons.

| Local-first concern | Emmy approach | Complexity |
|---|---|---|
| **Offline operation guarantee** | Audit every tool path at startup; tag tools as `local`, `network-required`, or `network-optional`. Footer badge. | S |
| **Model swap UX (only one model fits in 128GB)** | Block during swap, show progress (`stopping vLLM`, `loading weights 23%`, `warmup 60%`, `ready`). Make swap a first-class slash command (`/profile gemma-4`). Use `fastsafetensors` (3.25× speedup, ~3 min vs 10 min cold load — proven in prior repo). | M |
| **Hardware utilization view** | TUI footer: `[GPU 87% • VRAM 91GB/120GB • KV 34% • spec accept 71% • tok/s 38]`. Reads `nvidia-smi` + vLLM `/metrics`. | M |
| **Performance modes per profile** | Profile encodes: `gpu_memory_utilization`, `max_model_len`, `kv_dtype`, `enforce_eager`. Per-task overrides (long context vs low latency). | S |
| **Startup time visibility** | Big visible "loading… 0:42 / ~3:00" during model boot. From prior repo: this is the #1 daily-driver friction point. | S |
| **Idle / sleep policy** | Optional `unload_after_idle_minutes` per profile so KV cache and weights free RAM when not in use. | M |
| **Reproducibility as a feature** | `pi --print-environment` dumps vLLM version, CUDA, driver, profile hash, model SHA — pasteable into bug reports and required by the eval harness. | S |
| **No cloud-dependent default tools** | WebFetch is allowed (it's documentation reading, not inference). No "phone-home" telemetry. No required Google sign-in. | S |

---

## Tool Catalog (Section 3 of question)

What tools a 2026 daily-driver coding agent actually needs, ranked by frequency-of-use in real coding sessions (synthesized from Claude Code telemetry blogs, opencode usage patterns, and the prior repo's eval tasks).

| Tool | Table stakes? | How emmy provides it | Notes |
|---|---|---|---|
| `read` (file, with line ranges) | Yes | pi built-in | Must support line offsets to keep tokens down. |
| `write` (overwrite file) | Yes | pi built-in | |
| `edit` (string-replace, surgical) | Yes | pi built-in + emmy hash-anchor wrapper | Hash anchors are the differentiator. |
| `bash` (sync command, cwd-persistent) | Yes | pi built-in | Timeout + abort + stderr capture. |
| `grep` / `find` / `ls` | Yes | pi behind flags | Enable by default in emmy's profile. |
| `web_fetch` (HTTP GET → markdown) | Yes | Pi extension | Local models don't know 2026 APIs. Defer to crawl/scrape (Firecrawl/Playwright MCP) for advanced cases. |
| MCP client (any MCP server) | Yes (2026 inflection) | Pi extension overriding pi's "no MCP" stance | Most-leveraged single addition; opens the entire 10k-server ecosystem. |
| Git operations (`git status`, `diff`, `log`, `commit`, `worktree`) | Yes | Bash + skill (`git.md`) | Don't wrap as separate tools; bash is fine and matches user mental model. |
| LSP (definitions, references, diagnostics, symbols) | Differentiator (becoming table stakes — Claude Code added Dec 2025) | Pi extension (start: pyright, ts-server) | Ship in v1 if scoping allows; otherwise v1.x. |
| Test runner (pytest, jest, cargo test) | No (just bash it) | Bash + skill (`test.md` per language) | Building dedicated tools adds tokens for no benefit. |
| Code interpreter / persistent Python kernel | Differentiator | Pi extension (oh-my-pi pattern) | v2; large complexity, real value for data sci flows. |
| Browser automation | No (defer to MCP) | Document Playwright MCP as recommended | Don't bundle. |
| Language formatters / linters (ruff, prettier) | No (just bash it) | AGENTS.md instructs the model | Hooks-style auto-format on save can be a pi extension if/when needed. |
| Documentation lookup (Context7, devdocs) | Differentiator | MCP (Context7 has an MCP server) | Reduces hallucination on API surfaces. |
| Image read (screenshots, diagrams) | Differentiator | pi supports image paste; Gemma 4 is multimodal | Surface this for design / debugging tasks. |

**Final tool list for emmy v1**: read, write, edit (hash-anchored), bash, grep, find, ls, web_fetch, MCP client. Everything else is a skill or MCP server.

---

## Context Management (Section 4 of question)

How top agents handle long codebases, with emmy's chosen approach.

| Approach | Who uses it | Emmy stance |
|---|---|---|
| **AGENTS.md / CLAUDE.md (always-loaded project conventions)** | All major 2026 agents | YES — pi already supports. Layered global → project → user. |
| **Auto-compaction (summarize older turns)** | Claude Code (5-layer pipeline), pi (`/compact` + auto), opencode | YES — pi gives this. Per-profile compaction policy (Gemma 4 may want more aggressive than Qwen 3.6). |
| **File pinning** | Claude Code (via reading at start), Cursor (manual @ pin) | YES — pi's `@file` reference + `read` at session start = effective pinning. |
| **Repo map (Aider-style PageRank symbol graph)** | Aider, RepoMapper MCP | NO — defer to LSP. Reconsider only if eval shows LSP insufficient. |
| **RAG over codebase (vector index)** | Continue.dev, Cursor, Cline (optional) | NO in v1 — burns memory, breaks reproducibility (index drift), and LSP+grep cover most queries. Reconsider if needed. |
| **Sub-agents (isolated context with own tools)** | Claude Code (Explore/Plan/general), Roo Code (modes), oh-my-pi (worktree-isolated) | YES (limited) — pi spawns subprocess `pi` instances which is the right primitive. Emmy adds a `subagent` skill: spawn `pi` with restricted tools and a focused prompt. Don't build hidden in-process subagents. |
| **TODO / Plan files (model-managed external state)** | Claude Code (todo tool), pi (file-based PLAN.md), Codex (plan mode) | YES — file-based per pi's pattern. `PLAN.md` and `TODO.md` in working dir, model reads/writes via edit tool. |
| **Session memory across runs (persistent "brain")** | gptme (git-tracked journal), Continue (custom assistants) | NO in v1 — keep sessions independent for reproducibility; AGENTS.md is the durable channel. |
| **Prompt prefix caching (KV reuse)** | Anthropic (90% hit rate), vLLM (built-in) | YES — vLLM does this automatically; emmy's contribution is *deliberate prompt order* (stable prefix, dynamic suffix) documented in each profile. |
| **Long context (256K+)** | Qwen 3.6 (262K native, 1M extended), Gemma 4 (128K small / 256K medium) | YES — but 48K was the practical limit on Spark in prior eval. Each profile sets `max_model_len` honestly. Don't claim 256K if KV cache won't fit. |

---

## UX Surfaces (Section 5 of question)

What's expected in 2026 + what pi natively supports.

| Surface | 2026 expectation | Pi native? | Emmy decision |
|---|---|---|---|
| TUI | Yes (Claude Code, opencode, Aider, gptme, pi all primary-TUI) | Yes (pi-tui library) | YES — primary surface |
| CLI / scripted (one-shot prompts, JSON I/O) | Yes (Claude Code `-p`, opencode print mode, pi print/JSON mode) | Yes (pi `print` and `json` modes) | YES — needed for eval harness automation |
| RPC / SDK (programmatic embedding) | Less common; pi has it | Yes (pi RPC stdin/stdout, pi SDK) | YES — eval harness uses SDK directly |
| Web UI (browser-based) | Cursor, Roo Cloud, Cline web view; some agents have it | Yes (`@mariozechner/pi-web-ui` library exists) | NO in v1 — TUI is enough for daily driver |
| IDE plugin | Cursor/Cline/Roo dominate; not pi's territory | No | NO — out of scope (anti-feature) |
| Mobile / Termux | Pi documents it | Yes | NO — not a use case |
| Slack bot | Pi has a Slack bot reference | Yes | NO — out of scope |

---

## Eval / Benchmarking Features (Section 6 — research-artifact requirement)

This is where emmy must be best-in-class for the research thesis to land. **No surveyed local agent ships a comparable feature set.**

| Feature | Spec | Complexity |
|---|---|---|
| **Reproducible benchmark suite** | Docker-pinned vLLM image + pinned profile YAML + seeded eval driver. `pi-eval run --profile P --task-set T` produces JSON + markdown. Outputs include per-task pass/fail (executable assertions where possible), judge scores (LLM-as-judge with named judge model + prompt hash), latency per task, tokens in/out, GPU stats. | L |
| **Eval task suite (extending Phase 1)** | Reuses 5 prior coding tasks (CSV CLI, Fibonacci memo, email validator tests, plus 2 lit) — backwards-traceable to prior data. Adds 5–10 SWE-bench-Lite-style multi-file tasks. Adds 3 long-context tasks (read 30K-token codebase, find pattern). | L |
| **A/B profile comparison** | `pi-eval compare --profile A --profile B --task-set T` generates side-by-side markdown report. | M |
| **Lived-experience telemetry dataset** | `~/.emmy/telemetry/feedback.jsonl` rows = `{session_id, turn_id, profile_id, rating, comment, model_response, tool_calls, latency_ms, kv_used, tokens_in, tokens_out}`. Append-only, 100% local, opt-out via flag. Exportable to HuggingFace dataset format. | M |
| **OTel traces (gen_ai semantic conventions)** | Per-turn spans with attributes: `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, etc. Emit to local Tempo/Jaeger or just JSON file. | M |
| **Session replay under different profile** | `pi-eval replay <session_id> --profile <new>` — re-runs the exact user inputs through a new profile, captures new outputs + diff. | M |
| **Bench dashboard (static HTML)** | `pi-eval report` regenerates a static site from JSONL results: leaderboard across profiles, per-task drill-down, latency histograms. Hostable on GitHub Pages. | M |
| **Provenance every output** | Every eval result includes: vLLM version, CUDA driver, profile YAML hash, model SHA, eval driver git commit, hardware ID. | S |

---

## Multi-Model Routing (Section 7 of question)

How modern agents route subtasks across models, and how emmy exposes it.

**Survey of 2026 patterns:**
- **Augment Code routing guide:** Opus 4.6 for coordination, Sonnet 4.6 for implementation, Haiku 4.5 for file navigation, GPT-5.2 for code review.
- **OpenCode:** Manual `/model` switch; user-driven. 75+ providers. No automatic routing.
- **Cursor 3:** Cloud agents on isolated VMs, parallel agent tabs.
- **Pi:** `/model` switch, manual.
- **Pattern naming (multi-agent literature):** producer / consumer / coordinator / critic / judge.

**Emmy's constraints + approach:**
1. Only one big model fits in Spark RAM at a time. True cross-model routing requires either a swap (~3 min with `fastsafetensors`) or dual-load (only feasible with 1 big + 1 small/draft model).
2. **v1 approach: profile-routing within one model.** Different sampling/prompt for planner vs editor vs critic, all using e.g. Qwen 3.6. Routing rule expressed declaratively in the profile bundle.
3. **v1.5: speculative-decoding pair (target + draft) co-loaded.** Already required for the speculative-decoding feature; the draft model can also serve "fast path" for simple lookups.
4. **v2: orchestration across models via workflow checkpointing.** Save state, swap model, resume. Only worth doing if profile-routing isn't enough.

**Surfaced to user as:** `routing.yaml` per project, plus `/route show` slash command displaying which profile is handling which role. Always overridable.

---

## Differentiators Emmy Could Own (Section 8 — synthesis)

Crossreference of (a) what's underserved in local agents and (b) what emmy's stack uniquely enables. Ranked by "would I tell another local-agent author about this?":

1. **Versioned model profiles as first-class artifact.** No one does this well. Profiles get tagged with provenance, shared as YAML, version-controlled. This is the single highest-leverage idea in the project.
2. **Reproducible eval harness paired with the profiles.** Profile + eval results are co-versioned. "Here's profile v2.1 and the exact run on a Spark that produced these numbers."
3. **Lived-experience telemetry dataset.** A 100-hour personal usage corpus with subjective ratings is a uniquely local-agent artifact (cloud agents could collect it, but don't expose it; nobody else can publish theirs because of TOS).
4. **GPU/KV/spec-decode visibility in TUI.** A local-first feature that makes the local-ness viscerally felt and useful.
5. **Hash-anchored edits for weak local models.** Proven 10× improvement for some models; underused outside oh-my-pi.
6. **Grammar-constrained tool output via XGrammar per profile.** No surveyed open agent exposes this control to the user; emmy makes it part of the profile.
7. **Speculative decoding configured per profile.** Same — a serving-layer detail that matters for daily-driver feel and is hidden in other tools.
8. **Profile-aware compaction policy.** Gemma 4 and Qwen 3.6 may need different summarization aggressiveness; emmy's profile bundle owns this whereas every other harness uses one strategy.
9. **OTel-based replayable agent traces.** Standard schema, self-hostable backend (Tempo, Jaeger). Nobody in the local-agent space ships this.

---

## Feature Dependencies

```
Versioned model profiles  (FOUNDATION)
    ├──enables──> Per-profile sampling control
    ├──enables──> Per-profile tool-call format + grammar (XGrammar)
    ├──enables──> Per-profile compaction policy
    ├──enables──> Per-profile speculative decoding config
    ├──enables──> Per-profile prompt-prefix design (KV cache)
    ├──enables──> Multi-model routing (within-model variant)
    ├──enables──> Reproducible benchmark suite
    ├──enables──> A/B profile comparison
    └──enables──> Session replay under different profile

vLLM serving (FOUNDATION)
    ├──provides──> Long context, prompt caching, structured outputs
    ├──hosts────> Speculative decoding
    └──exports──> /metrics  ──feeds──> GPU/KV TUI footer

pi.dev harness (FOUNDATION)
    ├──provides──> All table-stakes UX (read/write/edit/bash, sessions, slash, compaction)
    ├──extension API──> Hash-anchored edits
    ├──extension API──> MCP client (overrides pi's "no MCP" stance)
    ├──extension API──> LSP integration
    ├──extension API──> Lived-experience telemetry
    ├──extension API──> OTel exporter
    ├──extension API──> GPU/KV footer
    └──extension API──> /eval slash command

Reproducible benchmark suite
    ├──requires──> Versioned profiles
    ├──requires──> Pinned vLLM version + Docker image
    ├──requires──> Eval task suite (Phase 1 prompts + new SWE-bench-style)
    └──enables──> A/B comparison report
                       └──enhanced-by──> OTel traces
                       └──enhanced-by──> Lived-experience telemetry

Multi-model routing
    ├──v1: requires──> Versioned profiles (within-model variants)
    └──v2: requires──> Either (a) optimized swap + workflow checkpointing
                              or (b) dual-model load (target + draft)

LSP integration ──reduces-need-for──> Repo map / RAG
                ──complements──> grep/find/ls

Hash-anchored edits ──conflicts──> Generic string-replace edit
                    (resolution: hash-anchored is the new default;
                     fall back to plain string-replace only when hashes
                     can't be computed, e.g. binary files)
```

### Dependency notes

- **Versioned model profiles is the single keystone feature.** Almost everything novel in emmy depends on it. Build first; everything else gets easier.
- **MCP client must override pi's "no MCP" philosophy.** Build as an extension that imports `@modelcontextprotocol/sdk` and registers an MCP-tool-bridge. Don't fork pi.
- **Hash-anchored edits should replace plain edit, not coexist.** Coexistence creates a UX choice the model has to make; replacement is simpler and the fallback path covers the rare exceptions.
- **Lived-experience telemetry depends on profile being known per turn.** Bind feedback rows to the active profile so the dataset is sliceable.
- **Eval harness depends on `pi --print-environment` and pinned Docker image.** Without provenance, "reproducible" is marketing.

---

## MVP Definition

### Launch With (v1) — must work for "author daily-drives this for one week"

- [ ] Specialized vLLM serving with two profiles: `qwen3.6-35b-a3b` and `gemma4-31b-dense` (or appropriate Gemma 4 variant for Spark RAM). Both with grammar-constrained tool output via XGrammar.
- [ ] Speculative decoding configured per profile (target + small draft).
- [ ] Long-context optimization: prompt-prefix discipline + per-profile `max_model_len` honest to KV cache.
- [ ] pi-mono installed; default tools: read, write, edit, bash, grep, find, ls.
- [ ] Hash-anchored edit wrapper around pi's edit tool.
- [ ] `web_fetch` extension.
- [ ] MCP client extension (overriding pi's no-MCP stance).
- [ ] AGENTS.md + `.pi/SYSTEM.md` discipline; example AGENTS.md template for emmy projects.
- [ ] `pi-emmy-profiles` package: profile YAMLs, with `/profile <name>` slash command that swaps both vLLM (via reload) and harness state.
- [ ] GPU/KV/spec-accept TUI footer extension.
- [ ] Offline-OK badge + tool registry audit.
- [ ] Lived-experience telemetry: Alt+Up / Alt+Down to thumb a turn, free-text prompt for thumbs-down. Append to JSONL.
- [ ] `/eval` slash command + standalone `pi-emmy-eval` CLI: runs benchmark suite (Phase 1 prompts + 5–10 SWE-bench-Lite tasks). Outputs JSON + markdown.
- [ ] Reproducibility: `pi-emmy --print-environment` dumping vLLM version, profile hash, CUDA, etc.
- [ ] Pinned Docker image for serving; one-command `start_emmy.sh`.
- [ ] README documenting "stand on shoulders" defaults sourced for each profile (with citations to community sources used).

### Add After Validation (v1.x) — once the v1 has been daily-driven for a few weeks

- [ ] LSP integration (Pyright + ts-language-server first).
- [ ] OTel trace exporter (gen_ai semantic conventions).
- [ ] A/B profile comparison report generator.
- [ ] Session replay under different profile (`/replay`).
- [ ] Profile-routing for planner / editor / critic roles within one model.
- [ ] `pi-eval report` static-site generator.

### Future Consideration (v2+) — after PMF for the author + ≥1 outside reproducer

- [ ] Persistent Python kernel (oh-my-pi pattern).
- [ ] True cross-model routing (target swap or dual-load with workflow checkpointing).
- [ ] Idle/sleep policy for model unload.
- [ ] Web UI (using `@mariozechner/pi-web-ui`).
- [ ] More LSP languages (Rust, Go, Java).
- [ ] Sandboxed execution via git worktree (oh-my-pi-style isolation backends).

---

## Feature Prioritization Matrix

(User = the author; "value" weights daily-driver feel + research-artifact strength.)

| Feature | User Value | Implementation Cost | Priority |
|---------|-----------|--------------------|---|
| Versioned model profiles | HIGH | M | **P1** |
| Specialized vLLM serving (Gemma 4 + Qwen 3.6) | HIGH | M | **P1** |
| Grammar-constrained tool output (XGrammar) | HIGH | S | **P1** |
| Pi.dev base TUI (read/write/edit/bash/sessions/compact) | HIGH | S (mostly free) | **P1** |
| Hash-anchored edits | HIGH | M | **P1** |
| MCP client extension | HIGH | M | **P1** |
| `web_fetch` tool | HIGH | S | **P1** |
| AGENTS.md / SYSTEM.md discipline | HIGH | S | **P1** |
| `/profile` slash command + atomic swap | HIGH | M | **P1** |
| GPU/KV/spec TUI footer | MEDIUM | S | **P1** |
| Lived-experience telemetry | HIGH | M | **P1** |
| Reproducible benchmark suite | HIGH (artifact bar) | L | **P1** |
| Speculative decoding per profile | MEDIUM | M | **P1** |
| Long-context KV strategy + prompt prefix design | HIGH | M | **P1** |
| Reproducibility env dump | MEDIUM | S | **P1** |
| Offline-OK badge | LOW | S | **P1** (cheap, signals correctly) |
| LSP integration | HIGH | L | **P2** |
| OTel traces | MEDIUM | M | **P2** |
| A/B comparison report | MEDIUM | M | **P2** |
| Session replay | MEDIUM | M | **P2** |
| Profile-routing for planner/editor/critic | MEDIUM | M | **P2** |
| Static-site bench dashboard | MEDIUM | M | **P2** |
| Python kernel | MEDIUM | M | **P3** |
| True cross-model routing | LOW | L | **P3** |
| Idle / sleep policy | LOW | M | **P3** |

---

## Competitor Feature Matrix

Comparative mapping of who has what. Used to validate "differentiator" claims and to clarify positioning. (✓ = present, ◐ = partial, ✗ = absent)

| Feature | Claude Code | OpenCode | Aider | Cline | Pi (base) | oh-my-pi | Continue.dev | Emmy |
|---|---|---|---|---|---|---|---|---|
| Read/write/edit/bash | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Hash-anchored edits | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ |
| MCP client | ✓ | ✓ | ✗ | ✓ | ✗ (rejected) | ✓ | ✓ | ✓ (override) |
| LSP integration | ✓ (Dec 2025) | ✓ | ✗ | ✓ (via plugin) | ✗ | ✓ | ✓ | v1.x |
| Repo map (PageRank/symbol graph) | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ◐ | ✗ (LSP instead) |
| Multi-model runtime swap | ✗ | ✓ (75+) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Versioned model profiles (sampling+prompt+grammar+spec-decode) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ (configs) | ✓ (differentiator) |
| Grammar-constrained tool output exposed | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (differentiator) |
| Speculative decoding exposed in profile | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (differentiator) |
| Subagents | ✓ | ✓ | ✗ | ◐ | ✓ (subprocess) | ✓ | ◐ | v2 |
| Plan / TODO file | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Hooks (PreToolUse/PostToolUse) | ✓ | ✓ | ✗ | ✗ | ✓ (extensions) | ✓ | ◐ | ✓ (via pi extensions) |
| Slash commands extensible | ✓ | ✓ | ✗ | ◐ | ✓ | ✓ | ✓ | ✓ |
| Skills / packages | ✓ | ◐ | ✗ | ◐ | ✓ | ✓ | ✓ | ✓ |
| Session persistence | ✓ | ✓ | ✓ (git) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Session branching / fork | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ |
| Auto-compaction | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ (per-profile) |
| GPU/KV utilization view | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (differentiator) |
| Offline-OK indicator | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Lived-experience telemetry (in-session 👍/👎 dataset) | ◐ (internal) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (differentiator) |
| Reproducible benchmark suite shipped | ✗ | ✗ | ✓ (Polyglot) | ✗ | ✗ | ✗ | ✗ | ✓ (differentiator) |
| A/B profile comparison | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (differentiator) |
| OTel traces (gen_ai) | ◐ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | v1.x |
| Web UI | ✗ | ◐ | ✗ | ✓ | ◐ (lib) | ✗ | ✓ (IDE) | ✗ (anti-feature) |
| IDE plugin | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✗ (anti-feature) |
| Cloud fallback | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (anti-feature) |
| Plugin marketplace | ✓ | ◐ | ✗ | ✓ | ◐ (npm) | ◐ (npm) | ✓ (hub) | ✗ (anti-feature) |

---

## Confidence and Sources

**HIGH confidence (multiple sources, official docs):**
- Pi-coding-agent feature inventory (verified via README + Mario Zechner blog post + npm page)
- Claude Code 2026 features (subagents, hooks, skills, MCP, LSP-since-Dec-2025) (verified via code.claude.com docs + multiple 2026 articles)
- MCP industry adoption (verified via modelcontextprotocol.io 2026 roadmap)
- vLLM + XGrammar structured outputs (verified via vLLM docs + xgrammar repo)
- Speculative decoding gains for coding (verified via Red Hat Developers + vLLM docs)
- Aider repo-map mechanism (verified via aider.chat docs)
- Hash-anchored edits results (verified via oh-my-pi README + Hashline write-up)
- Qwen 3.6 specs and SWE-bench score (verified via Qwen blog + HuggingFace)
- Gemma 4 capabilities (verified via Google blog + HuggingFace)

**MEDIUM confidence:**
- Lived-experience telemetry as "no other agent does this in-session" — based on absence in surveyed tool docs; possible some tool ships a thumbs-up button I missed. Risk: low; even if one does, the *exposed dataset* + tie to profile is novel.
- Multi-model routing UX patterns — synthesized from 2026 architecture posts; less authoritative than official docs.

**LOW confidence:**
- None of the load-bearing claims rely on LOW-confidence sources.

### Sources

- Pi: https://github.com/badlogic/pi-mono ; https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md ; https://mariozechner.at/posts/2025-11-30-pi-coding-agent/
- Oh-my-pi (LSP, Python kernel, hash-anchored edits, subagents): https://github.com/can1357/oh-my-pi ; https://dudarik.com/en/blog/oh-my-pi/
- Claude Code subagents/hooks/skills/LSP/context: https://code.claude.com/docs/en/sub-agents ; https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk ; https://blog.lakshminp.com/p/claude-code-lsp-semantic-context-agents ; https://smartscope.blog/en/generative-ai/claude/claude-code-best-practices-advanced-2026/
- Claude Code prompt caching numbers: https://www.walturn.com/insights/how-prompt-caching-elevates-claude-code-agents
- OpenCode 2026: https://www.nxcode.io/resources/news/opencode-vs-claude-code-vs-cursor-2026 ; https://opencode.ai/docs/agents/ ; https://opencode.ai/docs/lsp/
- Aider polyglot benchmark / repo map: https://aider.chat/docs/repomap.html ; https://aider.chat/docs/leaderboards/ ; https://github.com/Aider-AI/polyglot-benchmark
- Cline / Roo Code 2026: https://www.qodo.ai/blog/roo-code-vs-cline/ ; https://www.morphllm.com/comparisons/roo-code-vs-cline
- Continue.dev 2026: https://docs.continue.dev/reference ; https://changelog.continue.dev/
- gptme 2026: https://github.com/gptme/gptme ; https://gptme.org/
- MCP 2026 roadmap: https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/ ; https://thenewstack.io/model-context-protocol-roadmap-2026/
- vLLM structured outputs: https://docs.vllm.ai/en/v0.8.2/features/structured_outputs.html ; https://github.com/mlc-ai/xgrammar ; https://blog.vllm.ai/2025/01/14/struct-decode-intro.html
- Speculative decoding (vLLM, gpt-oss, SWE-bench): https://developers.redhat.com/articles/2026/04/16/performance-improvements-speculative-decoding-vllm-gpt-oss ; https://docs.vllm.ai/en/latest/features/spec_decode/
- Qwen 3.6: https://qwen.ai/blog?id=qwen3.6-35b-a3b ; https://huggingface.co/Qwen/Qwen3.6-35B-A3B
- Gemma 4: https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/ ; https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4 ; https://huggingface.co/blog/gemma4
- DGX Spark local-agent context: https://forums.developer.nvidia.com/t/managing-local-llm-orchestration/363264 ; https://build.nvidia.com/spark/lm-studio
- OpenTelemetry GenAI semantic conventions: https://opentelemetry.io/blog/2025/ai-agent-observability/ ; https://uptrace.dev/blog/opentelemetry-ai-systems
- Hashline / hash-anchored edit format results: https://abit.ee/en/artificial-intelligence/hashline-ai-agents-cursor-aider-claude-code-oh-my-pi-diff-format-grok-gemini-benchmark-open-source-g-en ; https://dev.to/nwyin/hashline-vs-replace-does-the-edit-format-matter-15n2
- Open-source local agent gaps 2026: https://wetheflywheel.com/en/guides/open-source-ai-coding-agents-2026/ ; https://www.opensourceaireview.com/blog/best-open-source-coding-agents-in-2026-reviewed-ranked
- Multi-model routing patterns 2026: https://www.augmentcode.com/guides/ai-model-routing-guide ; https://www.digitalapplied.com/blog/multi-agent-orchestration-patterns-producer-consumer
- Playwright / browser automation in 2026 agents: https://www.firecrawl.dev/blog/playwright-vs-puppeteer ; https://www.morphllm.com/comparisons/playwright-vs-puppeteer
- Coding agent telemetry / closing the loop: https://arize.com/blog/closing-the-loop-coding-agents-telemetry-and-the-path-to-self-improving-software/

---

*Feature research for: Emmy (local coding agent on DGX Spark, vLLM + pi.dev)*
*Researched: 2026-04-20*
