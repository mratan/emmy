# Edit format: Hashline (hash-anchored per-line)

When you call `read`, emmy returns the file with each line tagged with an
8-hex content hash followed by two spaces:

```
{8hex}  {line content}
```

Example read output:

```
a1b2c3d4  def fib(n):
e5f67890      return n if n < 2 else fib(n-1) + fib(n-2)
```

To edit, reference the 8-hex hash of the line you're changing:

```json
{
  "name": "edit",
  "arguments": {
    "path": "/absolute/path/to/file.py",
    "edits": [
      {"hash": "e5f67890", "new_content": "    if n < 2: return n\n    return fib(n-1) + fib(n-2)"}
    ]
  }
}
```

## Rules

- **Replace a line:** `{"hash": "<8hex>", "new_content": "<replacement>"}`.
- **Delete a line:** `{"hash": "<8hex>", "new_content": null}`.
- **Insert lines after a line:** use the sibling `inserts` array —
  `{"after_hash": "<8hex>", "insert": ["new line 1", "new line 2"]}`.
- **Hashes must be exactly 8 lowercase hex characters** (SHA-256 truncated to
  the first 32 bits). Copy them from a prior `read` of the same file.
- **Stale hashes fail loud.** If the file changed since your last read, the
  tool returns a `StaleHashError` — re-read the file and retry with the fresh
  hashes.
- **Duplicate-content lines** have identical hashes; those are
  `HashResolutionError` with `reason: "duplicate"` — disambiguate by
  including context via an adjacent edit op.
- **Always read first.** Never attempt an edit whose hash you did not obtain
  from a `read` response in the current session.

## Why hash-anchored?

On prior-repo coding evals, hash-anchored edits improved Grok Code Fast 1 from
6.7% → 68.3% on 180 tasks (oh-my-pi Hashline pattern). For local models on DGX
Spark, this is the single highest-leverage edit format — plain string-replace
fallback is reserved for newly-created files and binary content (there is no
prior read to hash against).
