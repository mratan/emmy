# observability/searxng

Phase 3.1 Plan 03.1-02 D-33 — self-hosted SearxNG stack for emmy's
`web_search` tool. Sibling of `observability/langfuse` with the same
air-gap discipline (digest-pinned image; loopback-only bind).

## Stack

Two containers, own compose project (NOT shared with Langfuse — self-contained
for startup robustness):

| Service  | Image                       | Port binding         | Purpose                              |
| -------- | --------------------------- | -------------------- | ------------------------------------ |
| searxng  | `searxng/searxng@sha256:37c616a7...` | `127.0.0.1:8888:8080` | SearxNG web UI + JSON API           |
| redis    | `redis@sha256:0c87e07e...`  | no host bind         | SearxNG's search result cache        |

First pull requires network. Subsequent starts are fully local.

## Boot / teardown

```bash
# Start (90s health gate)
bash scripts/start_searxng.sh

# Stop (preserves cache volumes)
bash scripts/stop_searxng.sh

# Stop + wipe Redis cache
bash scripts/stop_searxng.sh --volumes
```

## Operator-facing behavior

- Boot banner: `[emmy] SearxNG ready at http://127.0.0.1:8888`
- Browser debug UI: open http://127.0.0.1:8888 (loopback-only; not a
  supported pi-emmy path — use the `web_search` tool via the agent for
  production use).
- JSON API smoke test:

```bash
curl -s 'http://127.0.0.1:8888/search?q=bun+runtime&format=json' | jq '.results | length'
# Expect: ≥ 5 (on first run; depends on engines answering)
```

## Trust boundaries (T-03.1-02-01..T-03.1-02-07)

Documented in plan threat_model:

- SearxNG image pinned by SHA256 digest (T-03.1-02-01 supply chain).
- Bypass uses exact URL match, populated only by `web_search`'s success path
  (T-03.1-02-02 SSRF guard — tested in `web-fetch-bypass.test.ts`).
- Rate limit: 10 searches / agent turn (T-03.1-02-03 DoS guard).
- SearxNG's OWN outbound to google/ddg/brave/bing is explicit in the
  refined thesis (T-03.1-02-04 accepted + documented).
- settings.yml mounted read-only (T-03.1-02-05 tampering).

## Kill switches

- `EMMY_WEB_SEARCH=off` before `pi-emmy` → tool NOT registered.
- `EMMY_TELEMETRY=off` → `web_search` + observability both off.
- SearxNG stack not running → tool call returns ToolError; badge flips
  `OFFLINE OK` green automatically.
