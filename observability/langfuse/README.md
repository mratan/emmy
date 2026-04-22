# observability/langfuse — Self-hosted Langfuse v3 for emmy

Phase 3 Plan 03-02 (D-05, D-06, D-09) ships a self-hosted Langfuse v3 Docker
Compose stack for emmy's OTel trace sink. This directory holds the compose
definition, the committed `.env.example` template, and a health-check test
script. The live `.env` is gitignored.

## Bring-up

```bash
bash scripts/start_observability.sh
```

On first boot the script:

1. Copies `observability/langfuse/.env.example` -> `observability/langfuse/.env`
2. Substitutes every `CHANGEME` token with an `openssl rand`-backed secret
3. Runs `docker compose up -d` against `docker-compose.yaml`
4. Polls `docker compose ps --format json` until all 6 services are healthy
   (or running if no healthcheck is defined). Timeout: 90s.

On subsequent boots the generated `.env` is preserved (existing secrets are
re-used; restart is fast).

## First-login flow

The stack exposes the Langfuse UI at `http://localhost:3000`. On first boot:

1. Open `http://localhost:3000` in your browser
2. Create your first user account and organization
3. Create a project inside that organization
4. Project Settings -> API Keys -> "Create new API keys"
5. Copy both `pk-lf-...` and `sk-lf-...` into `observability/langfuse/.env`:

   ```
   LANGFUSE_PUBLIC_KEY=pk-lf-...
   LANGFUSE_SECRET_KEY=sk-lf-...
   ```

6. Export them in your shell (or restart pi-emmy — it reads them from
   process.env at boot):

   ```bash
   export LANGFUSE_PUBLIC_KEY=pk-lf-...
   export LANGFUSE_SECRET_KEY=sk-lf-...
   ```

7. Start pi-emmy normally; the boot banner should now read:

   ```
   OBSERVABILITY: ON -- JSONL + Langfuse OTLP
   ```

If the keys are missing, pi-emmy prints a warning and runs JSONL-only
(authoritative sink still writes every event to
`runs/<session_id>/events.jsonl`; only the Langfuse UI overlay is disabled).

## Teardown

```bash
# Stop containers, preserve volumes (trace history kept)
bash scripts/stop_observability.sh

# Stop + wipe trace history (langfuse_postgres_data, langfuse_clickhouse_data,
# langfuse_minio_data removed)
bash scripts/stop_observability.sh --volumes
```

## Air-gap discipline (D-09)

All 6 images in `docker-compose.yaml` are pinned by SHA256 digest (captured
2026-04-22 via `docker inspect <image> --format '{{index .RepoDigests 0}}'`).
This means:

- **Re-pulling is byte-identical.** Digest pinning guarantees reproducible
  local images across operator machines and CI runs.
- **First boot requires network.** The operator must pull the 6 images once.
  After that the stack runs fully offline — `start_emmy.sh --airgap` is
  expected to pass while the Langfuse stack is also running.
- **Phase 1 NGC container discipline matches.** Both emmy-serve and this
  Langfuse stack lock to SHA256 digests; upgrades require an explicit digest
  bump commit, never a silent tag re-resolution.

The Phase 3 Plan 03-07 air-gap CI job extends Phase 1's air-gap test to
bring up BOTH emmy-serve AND this Langfuse stack, then verifies that zero
non-loopback packets leave the box while a 50-turn replay drives traffic
through both.

## Port binding policy (T-03-02-07)

All service ports except `langfuse-web:3000` are bound to `127.0.0.1`
explicitly:

| Service | Host port | Purpose |
|---------|-----------|---------|
| langfuse-web | 3000 (all interfaces) | UI + OTLP `/api/public/otel/v1/traces` |
| langfuse-worker | 127.0.0.1:3030 | Internal background-processing endpoints |
| postgres | 127.0.0.1:5432 | Langfuse metadata store |
| redis | 127.0.0.1:6379 | Langfuse queue + cache |
| clickhouse | 127.0.0.1:8123, 127.0.0.1:9000 | Trace analytics store |
| minio | 127.0.0.1:9090 (API), 127.0.0.1:9091 (console) | S3-compatible blob storage for event payloads |

`langfuse-web:3000` binds to all interfaces because the operator connects via
a local browser. On a single-user Spark this is loopback-only in practice;
if you expose the Spark to a LAN, firewall 3000 explicitly.

## Secret rotation

The secrets in `observability/langfuse/.env` are single-user, single-machine.
To rotate:

1. `bash scripts/stop_observability.sh --volumes` (trace history lost)
2. `rm observability/langfuse/.env`
3. `bash scripts/start_observability.sh` (regenerates all secrets)
4. Re-create Langfuse user / project / API keys in the UI
5. Update `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` in `.env`

## Reproducibility test

```bash
bash observability/langfuse/test_stack_healthy.sh
```

Passes if all 6 services are `State: running` AND (no healthcheck OR
`Health: healthy`). Invoked automatically by the Task-1 verification gate.
