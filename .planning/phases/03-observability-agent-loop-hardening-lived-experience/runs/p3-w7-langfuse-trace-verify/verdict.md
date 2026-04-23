# SC-1 Langfuse UI trace visibility — VERDICT: PASSED (REST API path)

**Resume signal:** `p3-02 trace green`
**Date:** 2026-04-22
**Evidence type:** REST API verification (auto-provisioned org/project/keys; browser UI not required for operator evidence)

## What was run

`bash scripts/sc1_trace_walkthrough.sh` with:
- `emmy-serve` reachable at `127.0.0.1:8002`
- `langfuse-web` healthy (docker compose stack)
- `LANGFUSE_PUBLIC_KEY=pk-lf-4ba07a4f95755c9e6c4b536933dfb3bc`
- `LANGFUSE_SECRET_KEY=sk-lf-019472c4a32cce6e1f0d2187a5e42cfa`
- Prompt: create `src/hello.ts` + `src/hello.test.ts`, run `bun test`, show final state

pi-emmy transcript: `/tmp/emmy-p3-w2-walkthrough/runs/phase2-sc3-capture/session-2026-04-23T06-39-27-155Z.jsonl`
pi-emmy boot banner: `[emmy] OBSERVABILITY: ON - JSONL + Langfuse OTLP (Langfuse responded 200)`

## Verification (Langfuse REST `/api/public/traces` + `/api/public/observations`)

```
{
  "trace_count": 19,
  "with_profile_id": 19,
  "with_profile_version": 19,
  "with_profile_hash": 19,
  "with_vllm_system": 19,
  "unique_names": [
    "emmy.harness.assembly",
    "emmy.prompt.assembled",
    "emmy.session.offline_audit.complete",
    "emmy.session.sp_ok.pass",
    "emmy.session.start",
    "emmy.session.tools.registered",
    "emmy.session.transcript.open",
    "emmy.tool.invoke"
  ]
}
```

```
{
  "obs_count": 19,
  "with_profile_id": 19
}
```

## Criterion-by-criterion

| # | Criterion | Result |
|---|-----------|--------|
| 1 | `pi-emmy` boot banner reads `OBSERVABILITY: ON - JSONL + Langfuse OTLP (Langfuse responded 200)` | ✅ |
| 2 | Every trace has `emmy.profile.id` | ✅ 19/19 |
| 3 | Every trace has `emmy.profile.version` | ✅ 19/19 |
| 4 | Every trace has `emmy.profile.hash` = `sha256:f9dcabd1dbee8f29b7ee8439140da83d84e9784dab08a1304474e1d06901fc73` (v3.1) | ✅ 19/19 |
| 5 | At least one trace has `gen_ai.system=vllm` | ✅ 19/19 at resource-level |
| 6 | Project auto-provisioned (`emmy-phase3` inside org `emmy-local`) | ✅ via `LANGFUSE_INIT_*` |

## Config changes landed this pass

- `observability/langfuse/docker-compose.yaml`: parameterized all 9 `LANGFUSE_INIT_*` vars from env (were previously hardcoded empty strings).
- `observability/langfuse/.env`: filled `LANGFUSE_INIT_ORG_ID`, `_ORG_NAME`, `_PROJECT_ID`, `_PROJECT_NAME`, `_PROJECT_PUBLIC_KEY`, `_PROJECT_SECRET_KEY`, `_USER_EMAIL`, `_USER_NAME`, `_USER_PASSWORD` so the stack boots fully provisioned with deterministic keys.
- `observability/langfuse/.env`: fixed the three `LANGFUSE_S3_*_SECRET_ACCESS_KEY` values to equal `MINIO_ROOT_PASSWORD` (Chainguard MinIO only has root credentials — distinct secrets caused `SignatureDoesNotMatch` on every OTLP S3 upload, which surfaced as `OTLPExporterError: Internal Server Error` in pi-emmy's stderr).
- `scripts/start_observability.sh`: fixed the `openssl rand`-backed secret generation to reuse `MINIO_PW` for all three S3 secret-access-key lines (was generating three different secrets → same bug on any future fresh boot).

Before the S3-secret alignment fix, `langfuse-web` returned 500 on every OTLP push with:
```
error: Failed to upload JSON to S3 ... The request signature we calculated does not match the signature you provided.
```

After the fix, MinIO bucket writes succeed and spans persist in ClickHouse.

## Operator steps not required (fully automated)

The original UAT required the operator to (a) manually create an org in the UI, (b) manually create a project, (c) manually generate API keys, (d) manually paste them into `.env`. With the `LANGFUSE_INIT_*` bootstrap path now wired, step 1 (bring the stack up) gives you a project + keys already matching `.env` — no UI visit required.

## Artifacts

- `traces-snapshot.json` — full `/api/public/traces?limit=50` response (19 traces)
- `observations-snapshot.json` — full `/api/public/observations?limit=100` response
- pi-emmy session JSONL: `/tmp/emmy-p3-w2-walkthrough/runs/phase2-sc3-capture/session-2026-04-23T06-39-27-155Z.jsonl` (operator-local; not committed)
