# Native tool descriptions

Nine tools are always available (eight Phase-2-stable + `web_search` added in Phase 3.1). Call exactly one per assistant turn.

## read

Read a file. Every line returned is tagged `{8hex}  {content}`. Use those
hashes with `edit`. Args: `path` (abs), optional `line_range: [start, end]`
(1-based, inclusive).

## write

Overwrite a file with new content. Atomic fsync. Args: `path`, `content`.
Use `edit` for in-place changes; `write` when the file doesn't exist yet
or is being replaced wholesale.

## edit

Hash-anchored edit (the default edit path). See the edit-format doc for
hash usage, insert/delete semantics, and error classes. Args: `path`,
`edits: [{hash, new_content}]`, `inserts: [{after_hash, insert: [...]}]`.

## bash

Run a shell command. YOLO default. Output truncated head+tail at 50 lines
per side; default timeout 60s. Denylist rejects `rm -rf /` and fork bombs.
Args: `command` (required), optional `cwd`, `timeout_ms`.

## grep

Run `grep` against a path. Returns stdout + exit_code, truncated head+tail
at 100 lines. Args: `pattern` (required), optional `path` (defaults to
`.`), `flags` (defaults to `-rn`).

## find

Run `find` on a path. Returns matching paths one per line, truncated
head+tail at 100 lines. Args: `path` (required), optional `name` glob,
optional `type: "f" | "d"`.

## ls

List directory contents. Args: `path` (required), optional `long`,
optional `all`.

## web_fetch

HTTP GET → markdown. Reads documentation only (no inference). Gated by a
per-profile allowlist (hostname-exact) PLUS a returned-URL bypass: URLs
emitted by a recent `web_search` call are fetchable without allowlist
entry. Without search, only allowlisted hosts (currently `docs.python.org`,
`developer.mozilla.org`, `docs.vllm.ai`, `huggingface.co`, `docs.langfuse.com`)
resolve. Args: `url` (required), optional `timeout_ms` (default 30000).

## web_search

Search the open web via a local self-hosted SearxNG instance at
`http://127.0.0.1:8888`. Returns `{title, url, snippet, engine}[]`.
Upstream engines rotate automatically (Google, DuckDuckGo, Brave, Bing,
Startpage) with fallback on rate-limit or timeout. Rate-limited to 10
calls per agent turn. Use this when you need to look up current
information, latest versions, docs, or answers not in your training;
then follow up with `web_fetch` on any returned URL (bypass preserves
air-gap — only search-returned URLs bypass the allowlist). Args:
`query` (required), optional `max_results` (1-50, default 10).

## Style

Prefer `read` + `edit` over `write` for anything that already exists.
Prefer `grep` + `find` over recursive `ls -R`. Keep `bash` invocations
purposeful — one logical action per call.
