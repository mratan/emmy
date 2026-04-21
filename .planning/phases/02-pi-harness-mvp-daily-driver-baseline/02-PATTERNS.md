# Phase 2: Pi-Harness MVP — Daily-Driver Baseline - Pattern Map

**Mapped:** 2026-04-21
**Files analyzed:** ~35 new TS/Node files + 6 profile-side modifications + 4 docs/fixtures
**Phase 1 analogs located:** 14 Python analogs reused as cross-language shape donors
**Pure-greenfield files:** 8 (Hashline, MCP bridge, XGrammar reactive retry, pi provider shims, Unicode blocklist, diff renderer, max-model-len computation, text/binary detect)

## Executive Summary

Phase 2 is the TS/Node side of Emmy — **zero pre-existing TypeScript analogs** in this repo. Everything is greenfield on the TS side. The pattern discipline is therefore:

1. **Cross-language shape reuse from Phase 1 Python** — strict schema + typed validation (pydantic v2 → zod/TypeBox), atomic JSONL append (Python `append_jsonl_atomic` → Node `fs.writeFile` + `fs.fsync` + `fs.rename`), fail-loud boot rejection (Python raises + exit 1 → TS throws `ProfileConfigError`-shaped errors + `process.exit(1)`), 8-field `CanaryResult` shape for session-start SP_OK events, and `ProfileRef`-embedded-in-every-event reproducibility contract.
2. **External canonical references are load-bearing for 5 modules** — Hashline (oh-my-pi), MCP bridge (`@modelcontextprotocol/sdk` + `mcp_servers.yaml` layering), XGrammar reactive retry (vLLM `extra_body.guided_decoding.grammar`), pi extension API (`registerProvider` / `registerTool` / `createAgentSessionRuntime`), and the SP_OK canary wire shape (Python `emmy_serve/canary/sp_ok.py` → **literal re-send, same payload**).
3. **Profile-side modifications must bump v1 → v2** — any change to `harness.yaml` schema fields (adding grammars, tool_schemas, per_tool_sampling contents) is, by Phase 1 D-02, a content-hash bump. Planner must decide whether to edit v1 in-place during phase dev and rename-to-v2 at close, or to spin v2 immediately. The safer default is to **build v2 as a sibling directory** so Phase 1's v1-locked smoke test keeps passing unchanged.

**The key invariant for Phase 2:** anything model-shaped lives in the profile, not in TS code (CLAUDE.md: "anti-pattern: model-shaped logic in code"). The TS harness reads profiles, it doesn't compute profiles.

---

## Classification Summary

| Package / Area | New Files | Phase 1 Analog Available? | Greenfield-Risk Flag |
|----------------|-----------|---------------------------|----------------------|
| workspace root (package.json, tsconfig, biome.json, bun.lockb) | 4 | none | low — standard toolchain |
| `@emmy/provider` (vLLM HTTP client, compat strip) | 3 src + 1 pkg + 1 test | **partial** — Python httpx canaries are shape donors | **HIGH** for reactive-grammar path (unique to Phase 2) |
| `@emmy/tools` (hash-anchor edit + MCP + web_fetch + diff) | 10 src + 1 pkg + 4 tests | **partial** — text-normalization from hasher; JSONL append pattern | **HIGH** for Hashline, MCP bridge, Unicode blocklist |
| `@emmy/ux` (CLI + session + prompt assembly + canary ping) | 5 src + 1 bin + 1 pkg + 1 test | **strong** — SP_OK shape + 3-layer prompt + ProfileRef | **MEDIUM** (pi API wiring is greenfield but bounded by pi docs) |
| `@emmy/telemetry` (stub) | 2 files | **exact** — atomic writer pattern reused later | low — stub only |
| profile-side (harness.yaml, system.md, grammars/, tool_schemas/, PROFILE_NOTES.md) | 6 modified/new | **exact** — Phase 1 authored these files | low — schema/validator already enforces shape |
| docs & scripts (mcp_servers_template, AGENTS.md template, start_harness.sh) | 3 | partial — start_emmy.sh is the orchestrator analog | low |
| fixtures (SC-2 5 tasks, SC-3 100 tool calls, air_gap/session.jsonl already exists) | 3 dirs | **exact** — eval_tasks.py + session.jsonl | low — lifted from prior repo |

---

## Pattern Assignments by Package

### Package: `@emmy/provider`

Purpose: thin TS wrapper around OpenAI-compat `/v1/chat/completions` that (a) applies profile sampling/grammar to `extra_body`, (b) strips `reasoning_content` on the response side, (c) surfaces reactive-grammar retry signal (D-11) to the agent loop.

| New file | Role | Data flow | Closest analog | Pattern fidelity | Excerpt ref |
|----------|------|-----------|----------------|------------------|-------------|
| `packages/emmy-provider/package.json` | npm manifest | static | none | greenfield | pi docs `custom-provider.md` |
| `packages/emmy-provider/src/index.ts` | pi `registerProvider` entry; exports `registerEmmyProvider(pi, profile)` | harness → vLLM HTTP | `emmy_serve/canary/replay.py` `chat_completions()` (Py httpx POST) | **adapt** — same payload shape, TS `fetch`/`undici` instead of `httpx`; same `temperature=0.0`/`max_tokens`/`stream:false` defaults | `replay.py:17-37` below |
| `packages/emmy-provider/src/openai-compat.ts` | request/response shaping: inject `extra_body.guided_decoding.grammar` on reactive retry; strip `reasoning_content` / `thinking_tags` per `serving.yaml.quirks` | transform | STACK.md line 145 ("reasoning_content: null" strip lesson); Phase 1 `Quirks` schema (`emmy_serve/profile/schema.py` lines 116-120) | **adapt** — Python `Quirks` pydantic model → TS equivalent (zod) reading the same 3 fields (`strip_thinking_tags`, `promote_reasoning_to_content`, `buffer_tool_streams`) | `schema.py:116-120` |
| `packages/emmy-provider/tests/provider.test.ts` | bun test | test | `tests/unit/test_canary.py` | **adapt** — same assertion shape (importorskip → `import.meta`, field presence checks, no network in unit test) | `test_canary.py:7-18` |

#### Shape-to-copy excerpts for `@emmy/provider`

**Excerpt 1 — POST payload (adapt from Python httpx to TS undici/fetch).** Source: `/data/projects/emmy/emmy_serve/canary/replay.py` lines 17-37:

```python
def chat_completions(base_url: str, served_model_name: str, history: list, *, tools: list | None = None) -> dict:
    payload = {
        "model": served_model_name,
        "messages": history,
        "temperature": 0.0,
        "max_tokens": 256,
        "stream": False,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    r = httpx.post(f"{base_url}/v1/chat/completions", json=payload, timeout=120.0)
    r.raise_for_status()
    return r.json()
```

TS adaptation rule: identical payload keys, identical `temperature: 0.0` determinism for system-level calls (overridden per-tool from `harness.yaml.tools.per_tool_sampling`), `stream: true` for daily-driver UX, `base_url` from `serving.yaml.engine.host` + `.port` (NOT hardcoded 8002).

**Excerpt 2 — reasoning-content strip.** STACK.md line 145 verbatim:

> `stream: true` without proxy field stripping — vLLM emits `reasoning_content: null` and other non-OpenAI-standard fields that hang `@ai-sdk/openai-compatible` clients. Documented in prior repo's compat proxy. Either configure pi's `streamSimple` to strip these, or keep a thin compat proxy in front of vLLM.

The TS module implements the strip in `openai-compat.ts` — one function that walks a streaming chunk and deletes `reasoning_content`, `thinking`, and any field listed in `serving.yaml.quirks.strip_thinking_tags`. This is the TS side of Phase 1's `Quirks` pydantic model.

**Excerpt 3 — reactive grammar retry (D-11, no in-repo analog).** Data flow sketch:

```typescript
// packages/emmy-provider/src/openai-compat.ts (sketch — planner implements)
async function callWithReactiveGrammar(req, profile) {
  const resp = await postChat(req);                       // first try: unconstrained
  const toolCalls = resp.choices[0]?.message?.tool_calls;
  if (!toolCalls || isToolCallParseable(toolCalls)) return resp;
  // parse failed — retry same turn with grammar
  const grammarPath = profile.harness.tools.grammar;       // "grammars/tool_call.lark"
  const grammarText = await readFile(profilePath / grammarPath);
  const retry = await postChat({
    ...req,
    extra_body: { guided_decoding: { grammar: grammarText } },
  });
  emitEvent('grammar.retry', { profile_id, profile_hash, reason: 'parse_failure' });
  return retry;
}
```

The retry-counter emission is what SC-3's parse-rate metric consumes. No Phase 1 analog — this is purely Phase 2 territory.

---

### Package: `@emmy/tools`

Purpose: Hash-anchored edit wrapper (D-05..D-09), read-with-hashes tag (D-07), SHA-256 truncation helper (D-06), MCP stdio bridge + Unicode blocklist (D-15..D-18), web_fetch, text/binary detection (D-08), post-hoc unified diff (TOOLS-08).

| New file | Role | Data flow | Closest analog | Pattern fidelity | Excerpt ref |
|----------|------|-----------|----------------|------------------|-------------|
| `packages/emmy-tools/package.json` | npm manifest | static | none | greenfield | — |
| `packages/emmy-tools/src/hash.ts` | SHA-256 → 8 hex chars | transform | `emmy_serve/profile/hasher.py` `_hash_file()` + text normalization | **adapt** — same algorithm (SHA-256), same normalization rules (NFC + CRLF→LF) before hashing; 8-char truncation is new (D-06) | `hasher.py:65-84` below |
| `packages/emmy-tools/src/read-with-hashes.ts` | read-tool wrapper: tag every line `{8hex}  content` | transform | none in-repo — oh-my-pi canonical | **greenfield** — external-only pattern; cite oh-my-pi README in header comment | oh-my-pi repo |
| `packages/emmy-tools/src/edit-hashline.ts` | edit wrapper: validate hash, resolve to line content, delegate to pi's built-in edit | filesystem + transform | none in-repo | **greenfield** — external-only (oh-my-pi); wrapper-not-replacement per FEATURES.md line 125 | oh-my-pi edit tool |
| `packages/emmy-tools/src/text-binary-detect.ts` | D-08 fallback heuristic | transform | `emmy_serve/profile/hasher.py` `_normalize_text()` UTF-8 decode check | **adapt** — same NUL-byte / UTF-8-decodability signal; extend with `istextorbinary` npm dep if planner wants richer detection | `hasher.py:65-74` |
| `packages/emmy-tools/src/web-fetch.ts` | HTTP GET → markdown | request-response | none in-repo | **greenfield** — FEATURES.md line 128; `undici`/`node:fetch` + `@mozilla/readability` or `turndown` | — |
| `packages/emmy-tools/src/mcp-bridge.ts` | MCP stdio client; spawns subprocesses per `mcp_servers.yaml`; registers tools via `pi.registerTool` | stdio subprocess + transform | none in-repo | **greenfield** — `@modelcontextprotocol/sdk` TypeScript SDK is the canonical ref | MCP SDK docs |
| `packages/emmy-tools/src/mcp-poison-check.ts` | D-18 Unicode category blocklist | transform | none in-repo | **greenfield** — Unicode categories Cf/Co/Cs + bidi range U+202A-U+202E / U+2066-U+2069 | CONTEXT.md D-18 |
| `packages/emmy-tools/src/diff-render.ts` | post-hoc unified diff (TOOLS-08) | transform | none in-repo | **greenfield** — `diff` npm lib or `@types/diff` | FEATURES.md line 40 |
| `packages/emmy-tools/tests/hash.test.ts` | test | test | `tests/unit/test_hasher.py` | **adapt** — same invariants: NFC, CRLF→LF, non-UTF-8 rejection, determinism across runs | `test_hasher.py` shape |
| `packages/emmy-tools/tests/edit-hashline.test.ts` | test | test | none | greenfield — test the wrapper: stale hash, delete via `new_content: null`, insert via `after_hash` | D-09 payload shape |
| `packages/emmy-tools/tests/mcp-bridge.test.ts` | test | test | `tests/unit/test_session_jsonl.py` (shape of schema coverage tests) | **adapt** — coverage: every rejected Unicode category has ≥1 fixture | D-18 + per CONTEXT.md specifics |
| `packages/emmy-tools/tests/mcp_poison.test.ts` | test | test | none | **greenfield** — at least 1 fixture per category (Cf, Co, Cs, bidi-override); assertion: registration throws named error, tool not in registry | specifics section of CONTEXT.md |
| `packages/emmy-tools/tests/fixtures/sc2/` | fixtures dir — 5 SC-2 tasks lifted from prior repo | static | `/data/projects/setup_local_opencode/validation/eval_tasks.py` (309 lines) + `PHASE1_RESULTS_QWEN3.json` | **exact** — lift verbatim, audit edit-coverage per D-10; augment with 1-2 synthetic edit-heavy tasks if gap found | D-10 + Phase 1 PATTERNS.md Pattern F |

#### Shape-to-copy excerpts for `@emmy/tools`

**Excerpt 4 — hash-function shape (adapt for Node's `crypto.createHash`).** Source: `/data/projects/emmy/emmy_serve/profile/hasher.py` lines 65-84:

```python
def _normalize_text(raw: bytes, *, path: Path) -> bytes:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        raise HasherError(f"non-UTF-8 text in {path}: {e}") from e
    text = unicodedata.normalize("NFC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return text.encode("utf-8")

def _hash_file(p: Path) -> str:
    if p.is_symlink():
        raise HasherError(f"symlink not allowed in profile: {p}")
    raw = p.read_bytes()
    if p.suffix in TEXT_EXTS:
        raw = _normalize_text(raw, path=p)
    return hashlib.sha256(raw).hexdigest()
```

**TS adaptation rule for `packages/emmy-tools/src/hash.ts`:**
- Use Node's `crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 8)` — the 8-hex truncation is D-06.
- Same normalization: UTF-8 decode check via `Buffer.toString('utf8')` + round-trip comparison for validity; NFC via `String.prototype.normalize('NFC')`; CRLF/CR → LF via `.replace(/\r\n?/g, '\n')`.
- Per D-08, text detection falls back to binary on: (a) `Buffer.indexOf(0) !== -1` (NUL-byte), (b) `String.prototype.normalize` throwing or round-trip mismatch.

**Excerpt 5 — edit-tool API shape from D-09 (pure greenfield but shape is locked).** From CONTEXT.md D-09:

> Edit-tool API shape is **per-line list**: `{edits: [{hash: '<8hex>', new_content: '<replacement line>' | null}, …]}`. `new_content: null` deletes the line; insertions use a sibling op `{after_hash: '<8hex>', insert: ['line a', 'line b', …]}`.

The JSON schema that ships at `profiles/qwen3.6-35b-a3b/v1/tool_schemas/edit-hashline.schema.json` must encode exactly this; the Lark grammar shape is planner territory per CONTEXT.md D-09 ("must support XGrammar reactive decoding per D-11"). There is no in-repo analog — oh-my-pi is the external reference.

**Excerpt 6 — MCP layered config (adapt CONTEXT-01 layering pattern).** Source: Phase 1 `harness.yaml`'s layered-prompt idea (system.md + AGENTS.md + user) extended to MCP:

```yaml
# ~/.emmy/mcp_servers.yaml (user-level — template in docs/mcp_servers_template.yaml)
servers:
  filesystem:
    command: npx
    args: ["@modelcontextprotocol/server-filesystem", "/home/me"]
  web-search:
    command: npx
    args: ["@modelcontextprotocol/server-brave-search"]
    env:
      BRAVE_API_KEY: "$BRAVE_API_KEY"   # passed through process env, not secrets-managed in Phase 2

# ./.emmy/mcp_servers.yaml (project-level — overrides user on same key)
servers:
  playwright:
    command: npx
    args: ["@playwright/mcp"]
```

D-16 locks: project wins on key conflict; MCP servers launch stdio subprocesses (D-17); names registered flat (D-15); name collision with native emmy tools is **fail-loud** at session start (not silent rename). No in-repo analog — this is the canonical MCP config shape.

**Excerpt 7 — Unicode blocklist (D-18, pure greenfield).** No in-repo analog. Shape from CONTEXT.md D-18:

```typescript
// packages/emmy-tools/src/mcp-poison-check.ts (sketch)
const BLOCKED_CATEGORIES = new Set(['Cf', 'Co', 'Cs']);
const BLOCKED_BIDI_RANGES: [number, number][] = [
  [0x202A, 0x202E],    // LRE/RLE/PDF/LRO/RLO
  [0x2066, 0x2069],    // LRI/RLI/FSI/PDI
];

export function assertNoPoison(text: string, field: 'name' | 'description'): void {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    // Unicode category check would use a lib like `unicode-properties` or regex \p{Cf} via `u` flag
    if (/\p{Cf}|\p{Co}|\p{Cs}/u.test(ch)) {
      throw new PoisonError(`MCP tool ${field} contains U+${cp.toString(16).padStart(4, '0')} (category Cf/Co/Cs)`);
    }
    for (const [lo, hi] of BLOCKED_BIDI_RANGES) {
      if (cp >= lo && cp <= hi) throw new PoisonError(/* ... */);
    }
  }
}
```

Assertion target per CONTEXT.md §specifics: "registration throws a named error; the offending tool is not in the active tool registry."

---

### Package: `@emmy/ux`

Purpose: `pi-emmy` CLI shell (D-03), `createAgentSessionRuntime` wiring, 3-layer system-prompt assembly + SHA-256 logging (SC-5 / HARNESS-06), session-start SP_OK ping, honest `max_model_len` computation (CONTEXT-05).

| New file | Role | Data flow | Closest analog | Pattern fidelity | Excerpt ref |
|----------|------|-----------|----------------|------------------|-------------|
| `packages/emmy-ux/package.json` | npm manifest | static | none | greenfield | — |
| `packages/emmy-ux/bin/pi-emmy.ts` | binary entry: parse argv, resolve profile, construct runtime, dispatch TUI / `--print` / `--json` | orchestrator + subprocess-like | `scripts/start_emmy.sh` (bash orchestrator shape) | **adapt** — same discipline: pre-flight checks (profile exists, vLLM reachable) → fail-loud with named exit code; bash shape → TS shape | `start_emmy.sh:20-60` |
| `packages/emmy-ux/src/session.ts` | `createAgentSessionRuntime` wiring + extension registration + event routing | in-process | none in-repo | **greenfield** — bounded by pi SDK `createAgentSessionRuntime` docs (STACK.md line 193) | pi docs |
| `packages/emmy-ux/src/prompt-assembly.ts` | 3-layer assembly: `system.md` → `./AGENTS.md` → user; SHA-256 hash emission | transform + log | `emmy_serve/profile/hasher.py` (SHA-256 pattern) + `emmy_serve/canary/logging.py` (event log pattern) | **adapt** — Python SHA-256 → Node `crypto.createHash`; Python `append_jsonl_atomic` → TS atomic append (excerpt below) | `hasher.py:83` + `logging.py:43-45` |
| `packages/emmy-ux/src/sp-ok-canary.ts` | session-start SP_OK ping; wire shape imports the literal Phase 1 payload | request-response (HTTP) | **`emmy_serve/canary/sp_ok.py`** | **exact wire shape** — same `SP_OK_SYSTEM_PROMPT` text, same `SP_OK_ASSERTION_SUBSTR = "[SP_OK]"`, same `chat_template_kwargs: {enable_thinking: false}`, same assertion (`substr in response`) | `sp_ok.py:21-49` below |
| `packages/emmy-ux/src/max-model-len.ts` | CONTEXT-05 honest computation | transform | `profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md` (measured `gpu_memory_utilization=0.88`) | **adapt** — reads `serving.yaml.engine.max_model_len` + `PROFILE_NOTES.md` frontmatter; formula: `max_input_tokens = max_model_len - output_budget_tokens` (with 16K reserve per specifics §SC-5) | notes.md frontmatter lines 1-21 |
| `packages/emmy-ux/tests/prompt-hash.test.ts` | test | test | `tests/unit/test_hasher.py` (determinism tests) | **adapt** — assert SHA-256 of assembled prompt is deterministic across runs; assert 3-layer ordering is stable (system → AGENTS.md → tool defs → user, never reordered per CONTEXT-04) | `test_hasher.py` shape |

#### Shape-to-copy excerpts for `@emmy/ux`

**Excerpt 8 — SP_OK canary (EXACT wire-shape reuse).** Source: `/data/projects/emmy/emmy_serve/canary/sp_ok.py` lines 21-49:

```python
SP_OK_SYSTEM_PROMPT = (
    "When the user says 'ping' you must reply with the exact literal text "
    "[SP_OK] and nothing else."
)
SP_OK_USER_MESSAGE = "ping"
SP_OK_ASSERTION_SUBSTR = "[SP_OK]"


def run_sp_ok(base_url: str, served_model_name: str) -> tuple[bool, str]:
    payload = {
        "model": served_model_name,
        "messages": [
            {"role": "system", "content": SP_OK_SYSTEM_PROMPT},
            {"role": "user", "content": SP_OK_USER_MESSAGE},
        ],
        "temperature": 0.0,
        "max_tokens": 32,
        "stream": False,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    r = httpx.post(f"{base_url}/v1/chat/completions", json=payload, timeout=60.0)
    r.raise_for_status()
    text = r.json()["choices"][0]["message"]["content"] or ""
    return (SP_OK_ASSERTION_SUBSTR in text), text
```

**Critical invariant** (CONTEXT.md §code_context): the TS harness MUST NOT duplicate the fingerprint — the source of truth is the Python module + `profiles/qwen3.6-35b-a3b/v1/prompts/system.md`. The TS `sp-ok-canary.ts` uses **the same three string constants** (`SP_OK_SYSTEM_PROMPT`, `SP_OK_USER_MESSAGE`, `SP_OK_ASSERTION_SUBSTR`) with the same text, and posts the identical wire payload. If the profile's `prompts/system.md` ever drifts from the Python constant, both canaries fail in the same way — that's the coupling we want.

Fail-loud shape per CONTEXT.md §specifics: "a failure aborts the session with a named error (same diagnostic format as D-06)."

**Excerpt 9 — prompt assembly SHA-256 log (pattern adapted from hasher + canary logging).** Combine sources:

```python
# emmy_serve/profile/hasher.py:83 — SHA-256 of normalized text
return hashlib.sha256(raw).hexdigest()

# emmy_serve/canary/logging.py:43-45 — append-once event with profile embed
def log_canary_event(jsonl_path: Path, result: CanaryResult) -> None:
    append_jsonl_atomic(jsonl_path, asdict(result))
```

TS shape for `prompt-assembly.ts`:

```typescript
// sketch — planner implements
const assembled = [
  profileSystemMd,
  projectAgentsMd ?? '',
  toolDefsText,
].join('\n\n');
const hash = createHash('sha256').update(assembled).digest('hex');
logger.info(`prompt.assembled sha256=${hash}`);                          // per HARNESS-06
emitSessionEvent({
  event: 'prompt.assembled',
  sha256: hash,
  layers: ['system.md', 'AGENTS.md', 'tools', 'user'],                   // CONTEXT-04 locked order
  profile: { id, version, hash: profileHash },                           // Shared Pattern 3
  ts: new Date().toISOString(),
});
```

SC-5 gate: the regression test in `prompt-hash.test.ts` asserts that for a given `(profile, AGENTS.md, toolset)` triple, the `sha256` is byte-stable across runs — catches the Pitfall #2 "silent system-prompt delivery failure."

**Excerpt 10 — CLI fail-loud orchestrator (adapt bash → TS).** Source: `/data/projects/emmy/scripts/start_emmy.sh` lines 42-60:

```bash
# --- 1. Pre-flight (exit 4 on any missing prereq) ---
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR (prereq): docker not installed" >&2; exit 4
fi
if ! docker info >/dev/null 2>&1; then
  echo "ERROR (prereq): cannot connect to Docker daemon (try: sudo usermod -aG docker \$USER)" >&2; exit 4
fi
```

TS adaptation for `bin/pi-emmy.ts`:

```typescript
// sketch
if (!existsSync(profilePath)) {
  console.error(`ERROR (prereq): profile not found: ${profilePath}`);
  process.exit(4);
}
try { await probeVllm(baseUrl); } catch (e) {
  console.error(`ERROR (prereq): cannot reach emmy-serve at ${baseUrl}: ${e}`);
  console.error(`  (try: scripts/start_emmy.sh)`);
  process.exit(4);
}
```

Exit-code discipline inherited from Phase 1 (`start_emmy.sh` lines 7-12): 0 = ready, 1 = runtime failure (SP_OK fail → session abort), 4 = prerequisite missing.

---

### Package: `@emmy/telemetry`

Purpose: Phase 3 fills this. Phase 2 ships the empty stub so Phase 3 doesn't have to retrofit the workspace (D-01 rationale).

| New file | Role | Data flow | Closest analog | Pattern fidelity | Excerpt ref |
|----------|------|-----------|----------------|------------------|-------------|
| `packages/emmy-telemetry/package.json` | npm manifest | static | none | greenfield (stub) | — |
| `packages/emmy-telemetry/src/index.ts` | no-op shim; exports placeholder `emitEvent()` that is a function pointer the other packages import | event-driven (stub) | `emmy_serve/diagnostics/atomic.py` `append_jsonl_atomic` | **adapt (deferred)** — Phase 3 replaces the no-op body with the real atomic JSONL writer | `atomic.py:62-75` |

#### Stub contract

The `emitEvent(record: object)` signature must be stable in Phase 2 so that `@emmy/provider`, `@emmy/tools`, `@emmy/ux` can `import { emitEvent } from '@emmy/telemetry'` today without Phase 3 requiring call-site changes. The Phase 3 implementation will be `append_jsonl_atomic`-shaped (excerpt below) — Phase 2 only guarantees the signature, not the body.

**Excerpt 11 — atomic JSONL append (Phase 3 will adapt).** Source: `/data/projects/emmy/emmy_serve/diagnostics/atomic.py` lines 62-75:

```python
def append_jsonl_atomic(path: str | Path, obj: dict) -> None:
    dest = Path(path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(obj, sort_keys=True, separators=(",", ":")) + "\n"
    with open(dest, "a", encoding="utf-8") as f:
        f.write(line)
        f.flush()
        os.fsync(f.fileno())
```

Phase 3's TS implementation: `await fh.writeFile(line, {flag:'a'}); await fh.sync(); await fh.close();` with the same determinism (`sort_keys=true`, `separators=(',',':')`).

---

### Workspace root

| New file | Role | Data flow | Closest analog | Pattern fidelity | Excerpt ref |
|----------|------|-----------|----------------|------------------|-------------|
| `package.json` (workspace root) | Bun workspace manifest | static | `pyproject.toml` (workspace-style deps) | **adapt** — `workspaces: ["packages/*"]`; `engines: {bun: ">=1.1"}`; Node 22 fallback allowed per CONTEXT.md §specifics | `pyproject.toml` shape |
| `tsconfig.json` | shared TS compile config | static | none | greenfield | — |
| `biome.json` | linter/formatter config (planner may pick eslint+prettier instead) | static | none | greenfield | — |
| `bun.lockb` | lockfile (generated) | static | `uv.lock` | **exact-shape role** — both are lockfiles tracked by content-hash-aware toolchain | — |

---

### Profile-side modifications

**CRITICAL — per CONTEXT.md §canonical_refs and Phase 1 D-02:** Any field change to any file under `profiles/qwen3.6-35b-a3b/v1/` bumps the content hash. Per "profiles are immutable" (Phase 1 D-02), Phase 2 has two options:

1. **Edit v1 in place during phase dev, bump to v2 at phase close.** Risk: Phase 1's v1-locked smoke test fails mid-phase; air-gap CI gate re-runs on every profile edit.
2. **Create v2 alongside v1 at phase start**, leave v1 untouched. Phase 2 ships a new `profiles/qwen3.6-35b-a3b/v2/` bundle; Phase 1's v1 remains the locked Phase 1 baseline. **This is the recommended path** — preserves reproducibility of Phase 1 closeout.

The table below lists the files as written under `v1/` for clarity; the planner reshapes to `v2/` at plan time.

| Modified file | Role | Data flow | Closest analog | Pattern fidelity | Excerpt ref |
|---------------|------|-----------|----------------|------------------|-------------|
| `profiles/qwen3.6-35b-a3b/v{1,2}/harness.yaml` (MODIFIED) | config | static | current `v1/harness.yaml` (stub with `TODO(Phase-2)` per line) | **exact** — keep every field that already type-checks; fill real values for every TODO comment (see below) | `harness.yaml:1-33` |
| `profiles/qwen3.6-35b-a3b/v{1,2}/prompts/system.md` (MODIFIED) | fixture | static | current `prompts/system.md` (SP_OK line only) | **exact + append** — keep the SP_OK line byte-identical (it's load-bearing for the Phase 1 canary and the Phase 2 session-start ping); append the daily-driver coding-agent persona + AGENTS.md layering slot | `system.md:1` |
| `profiles/qwen3.6-35b-a3b/v{1,2}/grammars/tool_call.lark` (NEW) | grammar | static | none in-repo | **greenfield** — external reference is XGrammar lark syntax docs; grammar shape must cover D-09 edit-tool payload plus native tools | vLLM guided_decoding docs |
| `profiles/qwen3.6-35b-a3b/v{1,2}/tool_schemas/edit-hashline.schema.json` (NEW) | JSON schema | static | `emmy_serve/canary/tool_schemas/read_file.json` (shape donor) | **adapt** — same JSON-Schema Draft-7 shape; payload is D-09 (`{edits: [...], inserts: [...]}`) | `read_file.json` below |
| `profiles/qwen3.6-35b-a3b/v{1,2}/tool_schemas/*.schema.json` (NEW, 8 more) | JSON schemas | static | `emmy_serve/canary/tool_schemas/read_file.json` | **adapt** — one schema per native tool (read / write / edit / bash / grep / find / ls / web_fetch); same shape | `read_file.json` |
| `profiles/qwen3.6-35b-a3b/v{1,2}/PROFILE_NOTES.md` (APPENDED) | doc | static | current notes.md frontmatter + tables | **exact append** — add section "Phase 2: harness defaults" with per-tool sampling citations (Qwen community defaults per CONTEXT.md Claude's-discretion section), max_model_len computation, and a validation_runs entry for SC-3 parse rate | `PROFILE_NOTES.md:1-60` |

#### Shape-to-copy for profile-side

**Excerpt 12 — tool schema shape (exact analog).** Source: `/data/projects/emmy/emmy_serve/canary/tool_schemas/read_file.json` (full file, 19 lines):

```json
{
  "type": "function",
  "function": {
    "name": "read_file",
    "description": "Read the contents of a file at the given absolute path.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Absolute filesystem path of the file to read."
        }
      },
      "required": ["path"],
      "additionalProperties": false
    }
  }
}
```

**Invariants to preserve verbatim across all 9 new tool schemas:**
- Top-level shape `{type: "function", function: {name, description, parameters}}` — this is OpenAI tool-spec, not bare JSON Schema.
- `parameters.additionalProperties: false` — matches the "extra='forbid'" discipline from Phase 1 pydantic (Shared Pattern 1).
- `required: [...]` lists every mandatory field explicitly.
- Every field has a `description` — XGrammar uses these to constrain better (though D-11 reactive path parses unconstrained first).

**Excerpt 13 — filling harness.yaml TODOs (planner work).** Source: `/data/projects/emmy/profiles/qwen3.6-35b-a3b/v1/harness.yaml` lines 1-33 (every `TODO(Phase-2)` is a Phase 2 deliverable per CONTEXT.md §code_context):

```yaml
# BEFORE (Phase 1 stub):
prompts:
  edit_format: null                             # TODO(Phase-2): prompts/edit_format.md for Hashline
  tool_descriptions: null                       # TODO(Phase-2): prompts/tool_descriptions.md
  prepend_system_text: ""                       # TODO(Phase-2): global + project AGENTS.md layering

tools:
  schemas: null                                 # TODO(Phase-2): tool_schemas/default.json
  grammar: null                                 # TODO(Phase-2): grammars/tool_call.lark ...
  per_tool_sampling: {}                         # TODO(Phase-2): {edit: {temperature: 0.0}, ...}
```

**After Phase 2 fills** (sketch — planner composes the actual values; cite each non-trivial default in `PROFILE_NOTES.md` per PROFILE-05):

```yaml
prompts:
  edit_format: prompts/edit_format.md
  tool_descriptions: prompts/tool_descriptions.md
  prepend_system_text: ""                        # AGENTS.md layering happens in @emmy/ux prompt-assembly, not here
                                                 # (Claude's-discretion: 3-layer = system.md -> AGENTS.md -> user)

tools:
  schemas: tool_schemas/                         # directory of all 9 schemas
  grammar: grammars/tool_call.lark               # reactive only (D-11); mode knob in advanced_settings_whitelist
  per_tool_sampling:
    edit:  {temperature: 0.0}                    # Qwen team default, cite
    bash:  {temperature: 0.0}                    # Qwen team default, cite
    read:  {temperature: 0.0}                    # Qwen team default, cite
```

**`PROFILE_NOTES.md` append (excerpt 14)** — follow the existing shape (`/data/projects/emmy/profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md` lines 28-53):

```markdown
### Harness (Phase 2)

| Field | Value | Source | Retrieved |
|-------|-------|--------|-----------|
| `tools.per_tool_sampling.edit.temperature` | 0.0 | [Qwen3.6 model card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B-FP8) — "set temperature=0 for structured output" | 2026-04-21 |
| `tools.grammar` (reactive mode) | grammars/tool_call.lark | [vLLM guided_decoding docs](https://docs.vllm.ai/en/v0.19.0/features/structured_outputs/) | 2026-04-21 |
| `context.max_input_tokens` | <computed from measured gpu_memory_utilization=0.88> | This profile's Phase 1 thermal run + 16K output reserve per CONTEXT-05 | 2026-04-21 |
```

---

### Docs, Scripts, Fixtures

| New file | Role | Data flow | Closest analog | Pattern fidelity | Excerpt ref |
|----------|------|-----------|----------------|------------------|-------------|
| `docs/mcp_servers_template.yaml` | example config | static | none | **greenfield** — shape from MCP SDK docs + D-16 layering | Excerpt 6 above |
| `docs/agents_md_template.md` | starter AGENTS.md stub | static | `CLAUDE.md` (this repo's own AGENTS-like file) | **adapt** — section headings: build/test commands, key paths, house-style rules; smaller than emmy's CLAUDE.md | `CLAUDE.md` shape |
| `scripts/start_harness.sh` (OPTIONAL) | wrapper that invokes `start_emmy.sh` then `pi-emmy` | subprocess orchestrator | `scripts/start_emmy.sh` | **adapt** — minimal 15-20 line wrapper; check if emmy-serve is up (curl `/v1/models`), if not run `start_emmy.sh`, then exec `pi-emmy` | `start_emmy.sh:20-40` |
| `runs/phase2-sc2/` (dir, results committed post-run) | artifact | static | `runs/<iso>-kv-finder/` / `runs/<iso>-thermal/` from Phase 1 | **adapt** — same `RunLayout` shape (per-run subdir, summary.json, per-task jsonl); lifted via Python-side RunLayout from Phase 1 Pattern C | `emmy_serve/diagnostics/layout.py` |
| `runs/phase2-sc3/` (dir) | artifact | static | same | same | same |
| `runs/phase2-sc3-capture/` (dir, captured during dev) | artifact | static | same | same | same |

#### Shape-to-copy for fixtures

**Excerpt 15 — SC-2 fixtures lifted from prior repo.** Source: `/data/projects/setup_local_opencode/validation/eval_tasks.py` (309 lines, Phase 1 CODE_01..CODE_05 + literature tasks). The Phase 1 `01-PATTERNS.md` already established the lift pattern (Pattern F):

> Module-level `EvalTask` dataclass with task_id, category, difficulty, prompt, expected rubric/shape, max_tokens, timeout.
> Module-level constants `CODE_01`, `CODE_02`, ... for each task, defined with explicit kwargs.

For SC-2, the 5 coding tasks (CODE_01..CODE_05) are lifted into `packages/emmy-tools/tests/fixtures/sc2/` as one JSON file per task (TS-side fixture format — planner picks JSON vs TS module). D-10 requires audit of edit-coverage; **Phase 2 plan must include**:

1. Read the 5 tasks + `PHASE1_RESULTS_QWEN3.json`.
2. Tag each task with `exercises_edit: bool`.
3. If fewer than 3 of the 5 exercise the edit tool, augment with 1-2 synthetic edit-heavy tasks (rename-across-files, whitespace-adjacent edit, identical-content-lines edit).
4. Document the augmentation in the test report per CONTEXT.md D-10.

**Excerpt 16 — existing `air_gap/session.jsonl` already uses hash-anchor shape.** Phase 1 shipped `/data/projects/emmy/air_gap/session.jsonl` with turns like:

```json
{"turn":9,"role":"user","content":"In /tmp/foo.py change `return 42` to `return 0`. The hash of the target block is 'ab12cd'.","_expected_tool_call":{"name":"edit","args":{"path":"/tmp/foo.py","old_hash":"ab12cd","new_content":"def foo():\n    return 0\n"}}}
```

Observation: Phase 1's `session.jsonl` ALREADY encodes a single-`old_hash` / `new_content` payload. D-09 extends this to a list shape (`{edits: [...], inserts: [...]}`). The planner must decide whether to:
- Regenerate `session.jsonl` to match the new D-09 shape (and bump v1 → v2 per D-02), OR
- Keep v1's `session.jsonl` frozen (it's a Phase 1 artifact) and add a new `air_gap/session-v2.jsonl` under a v2 profile.

Recommended path: v2 profile gets its own `session.jsonl`. Phase 1's file stays read-only.

---

## Shared Patterns (cross-package, inherited from Phase 1)

### Shared Pattern 1: Strict schema + content-hash discipline

**Source:** Phase 1 PATTERNS.md Shared Pattern 1 + `emmy_serve/profile/schema.py` + `emmy_serve/profile/hasher.py`.

**Apply to:** Every TS data object that crosses a boundary (`MCPServersConfig` for `mcp_servers.yaml`, `EditHashlinePayload` for the edit-tool API, `SessionStartEvent` for the SHA-256 prompt-assembly log, any new YAML-shaped file emmy reads).

**Rule:** TS-side uses `zod` or `@sinclair/typebox` (planner picks) with strict mode (`.strict()` / `additionalProperties: false`) + JSON-Schema export. Every parse failure raises a domain error with dotted-path messages (same shape as Phase 1's `ProfileConfigError`). If the TS harness reads `harness.yaml`, it does NOT re-validate against a duplicate TS schema — it **shells out** to `uv run emmy profile validate <path>` (CONTEXT.md §code_context: "profile-hash computation stays authoritative on the Python side"). This preserves the single-source-of-truth discipline.

### Shared Pattern 2: Atomic JSONL append for event streams (deferred to `@emmy/telemetry` Phase 3)

**Source:** `emmy_serve/diagnostics/atomic.py` `append_jsonl_atomic` (Excerpt 11).

**Apply to:** Phase 3's observability bus. Phase 2 ships the `emitEvent()` signature only; body is no-op. Every call site in `@emmy/provider` / `@emmy/tools` / `@emmy/ux` that emits a structured record uses `emitEvent(...)` today; Phase 3 replaces the body. This avoids Phase 3 retrofitting the call-graph.

### Shared Pattern 3: Fail-loud boot rejection

**Source:** `scripts/start_emmy.sh` lines 42-60 (Excerpt 10) + Phase 1 D-06 rollback pattern + CONTEXT.md §code_context ("if emmy's harness fails its SP_OK assertion, fails MCP registration (tool poison or name collision), or can't reach emmy-serve:8002, exit 1 with a named diagnostic — do not quietly degrade").

**Apply to:** `bin/pi-emmy.ts` session startup, `mcp-bridge.ts` registration loop, `sp-ok-canary.ts` assertion handler. Named exit codes: `4 = prerequisite missing`, `1 = runtime failure`, `0 = ready`. Every fail-loud path writes a diagnostic record to `runs/<iso>-session-failure/` in the same shape as Phase 1's `runs/boot-failures/<iso>/` (same layout via reuse of `emmy_serve/diagnostics/layout.py` shape — Python-side layout helper exists, TS may shell out or use its own 1:1 port).

### Shared Pattern 4: Every event embeds `profile.id`, `profile.version`, `profile.hash`

**Source:** `emmy_serve/canary/logging.py` `CanaryResult` (8 fields) + Phase 1 PATTERNS.md Shared Pattern 3.

**Apply to:** Every TS-side event — `emitEvent()` records, `sp-ok-canary.ts` session-start assertion, `prompt-assembly.ts` hash log, `mcp-bridge.ts` registration events, `edit-hashline.ts` stale-hash events. The TS `ProfileRef` mirrors the Python `ProfileRef` (`emmy_serve/profile/loader.py` lines 27-40):

```typescript
// sketch
interface ProfileRef {
  id: string;         // "qwen3.6-35b-a3b"
  version: string;    // "v1" or "v2"
  hash: string;       // "sha256:<64-hex>"
  path: string;       // absolute path to bundle dir
}
```

Source value: `profile.yaml` manifest loaded via shell-out `uv run emmy profile hash <path>` at session start.

### Shared Pattern 5: SP_OK canary on every session start

**Source:** CONTEXT.md §specifics (explicit) + Phase 1 D-07 (shipped library).

**Apply to:** `packages/emmy-ux/bin/pi-emmy.ts` — first action after profile resolution and vLLM probe. Failure aborts the session (Shared Pattern 3). The TS canary uses the exact wire shape of `emmy_serve/canary/sp_ok.py` (Excerpt 8). Not optional; not toggleable.

---

## Greenfield Risks (planner attention)

These Phase 2 files have **no in-repo analog** and take their shape from external references. Planner must read the external source before writing the plan for any of them.

| File | Why greenfield | External reference | Risk dimension |
|------|----------------|---------------------|-----------------|
| `packages/emmy-tools/src/edit-hashline.ts` + `read-with-hashes.ts` | Hashline is not implemented anywhere in emmy; oh-my-pi is the canonical | [oh-my-pi repo](https://github.com/can1357/oh-my-pi) — read the read-tool rendering + edit-tool schema before writing the plan | Correctness — 6.7→68.3% result depends on exact anchor granularity (D-05 per-line is locked) |
| `packages/emmy-tools/src/mcp-bridge.ts` | Pi explicitly has a "no MCP" stance (STACK.md line 37); emmy overrides via extension (FEATURES.md line 37) | [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) + [modelcontextprotocol.io 2026 roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/) | API stability — 10k-server ecosystem exists but stdio-transport API shape must be verified against current SDK version |
| `packages/emmy-tools/src/mcp-poison-check.ts` | D-18 deterministic blocklist is Phase 2 invention | None — CONTEXT.md D-18 is the canonical spec | Completeness — per-category fixture coverage is the verifier (SC-4) |
| `packages/emmy-provider/src/openai-compat.ts` (reactive grammar path) | D-11 reactive retry is not exercised anywhere pre-Phase-2 | [vLLM guided_decoding docs](https://docs.vllm.ai/en/v0.19.0/features/structured_outputs/) + CLAUDE.md Pitfall #6 | Correctness — "grammar is a correctness backstop, not a quality lever" — wrong trigger condition regresses (Pitfall #5) |
| `packages/emmy-provider/src/index.ts` (pi `registerProvider`) | No emmy-side provider has been built; pi `registerProvider` is external API | [pi custom-provider docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md) | API contract — version-pinned to `@mariozechner/pi-coding-agent@0.68.0` per CONTEXT.md §code_context |
| `packages/emmy-ux/src/session.ts` (`createAgentSessionRuntime`) | No emmy-side session has been built | Same pi docs — `createAgentSessionRuntime` signature | API contract |
| `packages/emmy-ux/src/max-model-len.ts` | CONTEXT-05 honest computation is a new invariant | CONTEXT.md §specifics SC-5 item (c) | Numerical correctness — regression test required per CONTEXT.md Claude's-discretion |
| `packages/emmy-tools/src/text-binary-detect.ts` (D-08 fallback) | Planner-picked library (`istextorbinary` vs NUL-scan vs MIME) | CONTEXT.md D-08 + Claude's-discretion | Edge cases — UTF-16 BOM, zero-width chars in valid UTF-8, etc. |

Every item above is called out in CONTEXT.md's §canonical_refs or §decisions. The planner should NOT re-research — just read the referenced external URL and produce a plan that cites it.

---

## Files with No Analog (greenfield — summary table)

| File | Role | Shape source | Key invariants |
|------|------|--------------|----------------|
| `packages/emmy-provider/src/index.ts` | pi provider entry | pi custom-provider docs | Must pin `pi-coding-agent` version to 0.68.0; must pass profile object through to request shaping |
| `packages/emmy-provider/src/openai-compat.ts` | strip + grammar retry | CLAUDE.md Pitfall #6, D-11 | Reactive only (not always-on); retry counter feeds SC-3 parse-rate metric |
| `packages/emmy-tools/src/read-with-hashes.ts` | hash-tagged read | oh-my-pi | Every line tagged with 8-hex prefix + two-space separator (D-07 exactly) |
| `packages/emmy-tools/src/edit-hashline.ts` | hash-anchored edit | oh-my-pi + D-09 | Per-line anchors (D-05); `new_content:null`=delete, sibling `after_hash`+`insert`=insert (D-09) |
| `packages/emmy-tools/src/mcp-bridge.ts` | stdio MCP bridge | MCP SDK | Stdio-only (D-17); flat name dispatch (D-15); fail-loud on collision (D-15) |
| `packages/emmy-tools/src/mcp-poison-check.ts` | Unicode blocklist | D-18 | Cf/Co/Cs + bidi-override ranges; applied to name AND description |
| `packages/emmy-tools/src/web-fetch.ts` | HTTP→markdown | FEATURES.md line 128 | Local-ness: tag as "network-required" for offline-OK badge (Phase 3) |
| `packages/emmy-tools/src/diff-render.ts` | post-hoc unified diff | TOOLS-08 / FEATURES.md line 40 | Shown even in YOLO mode |
| `packages/emmy-ux/src/session.ts` | `createAgentSessionRuntime` wiring | pi docs | Pre-registers all 4 emmy extensions before surfacing the session |
| `packages/emmy-ux/src/prompt-assembly.ts` | 3-layer + SHA-256 | HARNESS-06 + SC-5 | Order locked: system.md → AGENTS.md → tool defs → user (CONTEXT-04 never reordered) |
| `packages/emmy-ux/src/max-model-len.ts` | CONTEXT-05 computation | CONTEXT.md §specifics SC-5 | Reads measured `gpu_memory_utilization` from `PROFILE_NOTES.md` frontmatter; 16K output reserve |
| `packages/emmy-ux/bin/pi-emmy.ts` | CLI shell | D-03 + pi docs | Binary name is not discretionary (SC-1 verbatim); forwards `--print` / `--json` |
| `profiles/.../grammars/tool_call.lark` | XGrammar grammar | vLLM docs | Must cover all 9 native tools + edit-hashline D-09 payload |

---

## Metadata

**Analog search scope (read in this mapping):**
- `/data/projects/emmy/CLAUDE.md`
- `/data/projects/emmy/.planning/phases/02-pi-harness-mvp-daily-driver-baseline/02-CONTEXT.md`
- `/data/projects/emmy/.planning/phases/01-serving-foundation-profile-schema/01-CONTEXT.md`
- `/data/projects/emmy/.planning/phases/01-serving-foundation-profile-schema/01-PATTERNS.md`
- `/data/projects/emmy/.planning/research/ARCHITECTURE.md`
- `/data/projects/emmy/.planning/research/STACK.md`
- `/data/projects/emmy/.planning/research/FEATURES.md`
- `/data/projects/emmy/emmy_serve/profile/schema.py` (201 lines incl. EngineConfig, HarnessConfig, ProfileManifest)
- `/data/projects/emmy/emmy_serve/profile/hasher.py` (149 lines — SHA-256, NFC, CRLF/LF rules)
- `/data/projects/emmy/emmy_serve/profile/loader.py` (120 lines — pydantic-to-domain-error mapping; ProfileRef)
- `/data/projects/emmy/emmy_serve/canary/sp_ok.py` (49 lines — full file)
- `/data/projects/emmy/emmy_serve/canary/tool_call.py` (65 lines — full file)
- `/data/projects/emmy/emmy_serve/canary/generate.py` (43 lines — full file)
- `/data/projects/emmy/emmy_serve/canary/replay.py` (~77 lines — full file)
- `/data/projects/emmy/emmy_serve/canary/logging.py` (46 lines — full file — CanaryResult 8 fields)
- `/data/projects/emmy/emmy_serve/canary/tool_schemas/read_file.json` (19 lines — shape donor)
- `/data/projects/emmy/emmy_serve/diagnostics/atomic.py` (76 lines — atomic JSONL append pattern)
- `/data/projects/emmy/emmy_serve/diagnostics/bundle.py` (first 80 lines — 7-file D-06 bundle shape)
- `/data/projects/emmy/emmy_serve/cli.py` (first 80 lines — argparse subcommand shape)
- `/data/projects/emmy/emmy_serve/boot/runner.py` (first 50 lines — render_docker_args shape)
- `/data/projects/emmy/emmy_serve/airgap/validator.py` (first 60 lines — CLI shim + JSON-report shape)
- `/data/projects/emmy/scripts/start_emmy.sh` (first 60 lines — fail-loud pre-flight)
- `/data/projects/emmy/profiles/qwen3.6-35b-a3b/v1/harness.yaml` (full file — TODO(Phase-2) markers)
- `/data/projects/emmy/profiles/qwen3.6-35b-a3b/v1/prompts/system.md` (full file — SP_OK line)
- `/data/projects/emmy/profiles/qwen3.6-35b-a3b/v1/PROFILE_NOTES.md` (first 60 lines — frontmatter + table shape)
- `/data/projects/emmy/air_gap/session.jsonl` (first 10 lines — session replay fixture shape)
- `/data/projects/emmy/tests/unit/test_canary.py` (first 60 lines — TS test shape donor)

**Phase 1 analog reuse rate:** 14 of ~48 new files have strong Phase 1 cross-language analogs. The remaining 34 fall under "external canonical reference" or "greenfield with CONTEXT.md spec" buckets. This is expected — the harness is the TS/Node side of Emmy and is greenfield on the TS side (CONTEXT.md §code_context verbatim: "None in-repo yet. The harness is greenfield on the TS side.").

**Pattern extraction date:** 2026-04-21

---

## PATTERN MAPPING COMPLETE
