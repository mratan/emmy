# air_gap/ — Air-Gap Reproducibility Fixture

This directory holds the 50-turn scripted replay used by the air-gap CI workflow
(`.github/workflows/airgap.yml`) to prove **Success Criterion 4** of Phase 1:
a 50-turn synthetic coding session produces zero outbound non-loopback packets
when replayed inside a `docker run --network none` container.

## Files

- `session.jsonl` — 50 JSONL turns covering all 8 Phase-2 tool types
  (`read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`, `web_fetch`).
  The replay measures vLLM's wire-format round-trip handling, not model
  correctness. Schema comes from
  `.planning/phases/01-serving-foundation-profile-schema/01-RESEARCH.md` §10.3.
- `tool_registry.json` — The 8-tool OpenAI-format schema registry the replay
  hands to vLLM on every round. Tools never execute; the replay only verifies
  that vLLM accepts the tool schema and that the model produces parseable
  `tool_calls` entries.

## Pattern mix (per 01-RESEARCH.md §10.3)

| Group | Turns    | Pattern                                |
| ----- | -------- | -------------------------------------- |
| 1     | 1–4      | `read` round-trip                      |
| 2     | 5–8      | `write` round-trip                     |
| 3     | 9–14     | `edit` — two hash-anchored exchanges   |
| 4     | 15–20    | `bash` — two short exchanges           |
| 5     | 21–24    | `grep`                                 |
| 6     | 25–28    | `find`                                 |
| 7     | 29–32    | `ls`                                   |
| 8     | 33–36    | `web_fetch` — mocked result, no network |
| 9     | 37–42    | multi-tool sequential (read → edit → bash) |
| 10    | 43–50    | context-growing (history accumulation) |

Every `web_fetch` tool-result row begins with
`(mock — no network in air-gap)` so it is unmistakable that no network
request crossed the boundary.

## Consumer

`emmy_serve.canary.replay.run_replay(base_url, served_model_name, session_path, tools=tools)`
(see `emmy_serve/canary/replay.py`). The CI workflow invokes this inside the
container via `docker exec` against loopback.

## Regeneration

`session.jsonl` is hand-authored once and committed verbatim — the test
`tests/unit/test_session_jsonl.py` is the schema contract. If a future plan
needs to extend the fixture (e.g. to cover new Phase-2 tool types), write a
new generator, keep the turn count and pattern mix aligned with §10.3, and
bump the fixture in a single deterministic commit (the airgap workflow's
triggering-paths filter includes `air_gap/**`).
