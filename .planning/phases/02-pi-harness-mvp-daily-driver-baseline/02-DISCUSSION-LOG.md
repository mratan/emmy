# Phase 2: Pi-Harness MVP — Daily-Driver Baseline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 02-pi-harness-mvp-daily-driver-baseline
**Areas discussed:** Package topology & workspace, Hash-anchored edit format, XGrammar strategy & parse-rate gate, MCP bridge dispatch & poison rejection

---

## Gate: Pre-discussion gates (from /gsd-plan-phase 2)

| Gate | Option | Selected |
|------|--------|----------|
| Context gate | Run /gsd-discuss-phase 2 first (Recommended) | ✓ |
| Context gate | Continue without CONTEXT.md | |
| AI-SPEC gate | Skip AI-SPEC — substrate is already chosen | ✓ |
| AI-SPEC gate | Run /gsd-ai-integration-phase 2 first | |
| UI-SPEC gate | Skip UI-SPEC (--skip-ui) | ✓ |
| UI-SPEC gate | Run /gsd-ui-phase 2 first | |

**Rationale:** Skipped AI-SPEC because the framework is fixed (pi-coding-agent v0.68.0) and eval strategy is milestone-level, not per-phase. Skipped UI-SPEC because Phase 2 consumes pi-mono's existing TUI; no fresh UI surfaces to design.

---

## Gray-area selection

| Option | Description | Selected |
|--------|-------------|----------|
| A. Package topology & workspace | TS/Node monorepo shape, workspace tool, binary name, install story | ✓ |
| B. Hash-anchored edit format spec | Hashline spec: hash fn, granularity, read/edit shape, fallback trigger, fixture source | ✓ |
| C. XGrammar strategy & parse-rate gate | Activation mode, SLA strictness, corpus composition, baseline capture | ✓ |
| D. MCP bridge dispatch & poison rejection | Namespacing, config location, transport scope, poison heuristic | ✓ |
| E. System-prompt layering + AGENTS.md template | (presented after A–D) | (defaulted) |
| F. Phase 2 close-gate methodology (SC-3 + CONTEXT-05) | (presented after A–D) | (defaulted) |

**User's choice:** All four core areas selected; E and F defaulted to planner/researcher judgment.

---

## A. Package topology & workspace

### A.1 — Package split

| Option | Description | Selected |
|--------|-------------|----------|
| 3 packages: provider / tools / ux | Telemetry added Phase 3 | |
| 4 packages w/ empty telemetry stub | Phase 3 fills the stub; matches CLAUDE.md sketch | ✓ |
| 1 package: `@emmy/harness` | Single package with subpaths | |
| 2 packages: core + ux | Provider + tools bundled | |

### A.2 — Workspace tool + runtime

| Option | Description | Selected |
|--------|-------------|----------|
| pnpm workspaces + Node 22 | Widest familiarity | |
| Bun workspaces + Bun runtime | Fastest iteration; no tsc step | ✓ |
| npm workspaces + Node 22 | Zero extra install | |

### A.3 — Binary / entry-point contract

| Option | Description | Selected |
|--------|-------------|----------|
| `pi-emmy` as a new binary wrapping pi | Matches SC-1 verbatim | ✓ |
| Plain `pi` with emmy installed as extensions | Leans on pi's mechanisms | |
| Both — `pi-emmy` default + docs for bare pi | Two install paths | |

### A.4 — Install path

| Option | Description | Selected |
|--------|-------------|----------|
| `npm i -g pi-emmy` — publish to npm | Cleanest SC-1 reproducibility | |
| Local repo clone + workspace install && link | No publish required | ✓ |
| Local clone + `bun link` or `npm link` | Workspace-specific tool | |

**Notes:**
- User selected "Bun workspaces + Bun runtime" for A.2 but "pnpm install && pnpm link" for A.4. Resolved in CONTEXT.md as `bun install && bun link` — the `pnpm install` phrasing in the option was generic workspace-language; Bun is the canonical workspace tool per D-02.

---

## B. Hash-anchored edit format (Hashline)

### B.1 — Hash granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Per-line (Hashline canonical) | Matches oh-my-pi, Grok Code Fast 1 6.7→68.3% | ✓ |
| Window (3-line anchor) | Robust to whitespace, more tokens | |
| Block (min N lines / function) | Lower granularity, bigger rewrites | |

### B.2 — Hash function + truncation

| Option | Description | Selected |
|--------|-------------|----------|
| SHA-256, first 8 hex chars (32 bits) | Matches repo's existing hash style | ✓ |
| BLAKE3, first 8 hex chars | Faster, extra dep | |
| xxhash64, first 8 hex chars | Fastest, non-crypto | |

### B.3 — Read-tool output rendering

| Option | Description | Selected |
|--------|-------------|----------|
| Prefix column: `a3f2b1c4  def foo():` | Fixed column, predictable | ✓ |
| Suffix comment: `def foo():  # @a3f2b1c4` | Language-aware | |
| Separate manifest + plain lines | Cleanest data, more cognitive load | |

### B.4 — Fallback trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Binary content only (Recommended default) | Text always hash-anchored | ✓ |
| Binary OR no-match after retry | More forgiving, undermines contract | |
| Binary only + reject stale hashes loudly | Hardest contract | |

### B.5 — Edit-tool API shape

| Option | Description | Selected |
|--------|-------------|----------|
| Per-line: `[{hash, new_line}]` list | Simplest grammar, lowest tokens | ✓ |
| Block: `[{old_hashes[], new_lines[]}]` | Handles contiguous ops | |
| Unified-diff with hash anchors | Universal, weak-model-unfriendly | |

### B.6 — SC-2 regression-fixture source

| Option | Description | Selected |
|--------|-------------|----------|
| Lift from prior repo verbatim + planner audits fit | Low-effort, faithful | |
| Lift + augment if audit flags gaps | Honest about measurement | ✓ |
| Synthesize a new 5-task Hashline-specific fixture | Cleanest isolation, breaks continuity | |

---

## C. XGrammar strategy & parse-rate gate

### C.1 — Grammar activation strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Reactive: parse unconstrained, retry under grammar on parse failure | Matches CLAUDE.md Pitfall #6 | ✓ |
| Always-on for tool calls | Simpler envelope, risks quality | |
| Profile-toggled with reactive as default | Most flexible, extra knob | |

### C.2 — SC-3 parse-rate SLA

| Option | Description | Selected |
|--------|-------------|----------|
| ≥98% with XGrammar on, baseline captured (roadmap wording) | Binary pass/fail | |
| ≥99% — tighten the contract | More ambitious | |
| ≥98% + graduated: >98% synthetic, >95% real-session | Honest about session skew | ✓ |

### C.3 — 100-call corpus composition

| Option | Description | Selected |
|--------|-------------|----------|
| 50 synthetic + 50 real-session replay | Comprehensive + representative | ✓ |
| 100 synthetic, designed for coverage | Fully deterministic | |
| 100 real-session transcripts | Most honest, coverage depends on use | |

### C.4 — No-grammar baseline capture

| Option | Description | Selected |
|--------|-------------|----------|
| Same corpus with grammar disabled — captured once, committed | Low overhead | ✓ |
| Paired run on every parse-rate test (CI) | Always current, 2× GPU cost | |
| Captured once + quarterly re-run | Catches drift, scheduler infra | |

---

## D. MCP bridge dispatch & poison rejection

### D.1 — Dispatch surface

| Option | Description | Selected |
|--------|-------------|----------|
| Flat names, collision → fail-loud at registration | Cleanest model-facing surface | ✓ |
| Namespaced: `mcp:<server>:<tool>` | Unambiguous, token cost | |
| Prefix: `mcp_<server>_<tool>` (underscore-only) | Flat-ish, schema-safe | |

### D.2 — Config location

| Option | Description | Selected |
|--------|-------------|----------|
| Layered: `~/.emmy/` + `./.emmy/`, project wins | Matches CONTEXT-01 layering | ✓ |
| Project-only: `./.emmy/mcp_servers.yaml` | Version-controlled per repo | |
| Profile-embedded | Wrong layer (env, not model concern) | |

### D.3 — MCP transport scope

| Option | Description | Selected |
|--------|-------------|----------|
| stdio-only | Covers ~95% of ecosystem | ✓ |
| stdio + HTTP/SSE | Phase 2 YAGNI | |

### D.4 — Tool-poison rejection heuristic

| Option | Description | Selected |
|--------|-------------|----------|
| Unicode category blocklist at registration | Fast, deterministic, zero false-positives on ASCII | ✓ |
| Blocklist + hidden-prompt regex scan | False-positive surface too high for v1 | |
| Blocklist + schema-shape validation (plain-ASCII-only) | Strictest, breaks non-ASCII MCPs | |

---

## E. System-prompt layering + AGENTS.md template

**Discussed?** No — defaulted.

**Default captured in CONTEXT.md <decisions> → Claude's Discretion:** 3-layer (profile's `prompts/system.md` → project `./AGENTS.md` → user turn); minimal AGENTS.md starter in `docs/agents_md_template.md`; SHA-256 hash of assembled prompt emitted to event stream + log line per session start.

---

## F. Phase 2 close-gate methodology (SC-3 + CONTEXT-05)

**Discussed?** No — defaulted.

**Default captured in CONTEXT.md <decisions> → Claude's Discretion:** SC-3 parse-rate gate is a committed `bun test` invocation at phase close (not on every boot). CONTEXT-05 honest `max_model_len` is computed once during harness shakeout from Phase 1's measured `gpu_memory_utilization=0.88` + a documented output-budget reserve, committed to `harness.yaml.context.max_input_tokens`, with an optional regression test asserting consistency with the Phase 1 ceiling.

---

## Claude's Discretion (summary)

- Exact edit-tool JSON schema + Lark grammar shape for D-09 payloads
- Per-tool sampling seed values (`harness.yaml.tools.per_tool_sampling`) — planner seeds from Qwen community defaults
- Text/binary detection heuristic for D-08 fallback
- Bash tool-result truncation N-lines tuning (HARNESS-04 "structured")
- `./AGENTS.md` vs `./.pi/SYSTEM.md` precedence (defaulted AGENTS.md wins)
- Node-vs-Bun fallback if Bun conflicts with a pi internal
- E: 3-layer prompt, minimal AGENTS.md template, SHA-256 hash emission mechanics
- F: `bun test` phase-close gate + one-shot honest `max_model_len` computation

---

## Deferred Ideas

All captured in CONTEXT.md `<deferred>` — summary:
- Always-on grammar mode (schema knob reserved, not exercised)
- Prompt-injection natural-language detection (too many false positives; Phase 3+)
- npm publish of @emmy/* (Phase 7)
- HTTP/SSE MCP transport (unlikely need)
- 4-layer prompt with global ~/.emmy/SYSTEM.md (if daily-driving reveals the pattern)
- Per-tool sampling tuning (Phase 5 eval)
- LSP (v1.x or Phase 5)
- Journal tool (Phase 3)
- Repo-map (Phase 3 or later)
- Model-swap UX (Phase 4)
- Offline-OK badge + GPU/KV footer (Phase 3)
- SDK/RPC embedding mode (Phase 5)
- `start_emmy.sh --airgap` 300s timeout fix (Phase 1 latent; fix as separate patch)
