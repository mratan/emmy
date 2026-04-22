# Native tool descriptions

Eight tools are always available. Call exactly one per assistant turn.

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

HTTP GET → markdown. Reads documentation only (no inference). Tagged
network-required; air-gap builds reject this tool at registration. Args:
`url` (required), optional `timeout_ms` (default 30000).

## Style

Prefer `read` + `edit` over `write` for anything that already exists.
Prefer `grep` + `find` over recursive `ls -R`. Keep `bash` invocations
purposeful — one logical action per call.
