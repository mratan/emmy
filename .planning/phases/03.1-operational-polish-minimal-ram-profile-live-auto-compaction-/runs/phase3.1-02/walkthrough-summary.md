--- 4 gate summary ---
# Phase 3.1 Plan 03.1-02 walkthrough summary

**Date:** 2026-04-23
**Runtime:** DGX Spark, emmy-serve on v3.1, pi-emmy --print against live SearxNG

## Gates

| Gate | Evidence | Verdict |
|------|----------|---------|
| 1. SearxNG stack health | `docker ps` shows `searxng-searxng-1` + `searxng-redis-1` both `Up (healthy)` | PASS |
| 2. SearxNG JSON endpoint | `curl .../search?q=bun+runtime&format=json` → 28 results from 4 engines (google, duckduckgo, brave, bing) | PASS |
| 3. web_search tool via pi-emmy | `pi-emmy --print "Use web_search to find latest Bun…"` → agent responded `"The latest Bun release version is 1.3.13, as indicated on both the Bun website and npm."` — real SearxNG result successfully delivered to agent and grounded into response | PASS |
| 4. web_fetch bypass + SSRF denial | `bun tests/bypass-probe.ts` → urlA exact-bypass ALLOWED; urlB same-host-different-path DENIED (T-03.1-02-02 SSRF guard); urlC non-allowlist DENIED | PASS |
| 5. Badge transitions | `[emmy] OFFLINE OK` green at boot (stderr); yellow flipToYellow wired via `webSearchOnSuccess → flipToYellow("searxng responded healthy")` in session.ts (not visually verifiable in --print mode; state-machine unit-tested) | PASS (library-proven) |
| 6. Kill switch EMMY_WEB_SEARCH=off | Agent listed exactly 8 tools (web_search absent) on kill-switch run | PASS |
| 7. Air-gap CI dry-run | `ci_verify_phase3 --dry-run` exit 0 (strict) + `ci_verify_research_egress --dry-run` exit 0 (permissive, denies 12 cloud-inference endpoints) | PASS |

## Walkthrough-discovered fixes (committed during this session)

The executor's Tasks 1+2 had three integration gaps that only surfaced when the agent tried to actually USE web_search:

1. **`prompts/tool_descriptions.md` in v3.1** — cloned from v3 without adding web_search section. Model didn't know the tool existed.
2. **`session.ts` system-prompt assembly** — `toolDefsText` was hardcoded with 8 Phase-2 tools. Model's "tools available" list is emmy's assembled prompt, NOT the profile's tool_descriptions.md (which is a separate doc not read by prompt-assembly). Added conditional `web_search` line gated on profile + kill-switches.
3. **`profile-loader.ts`** — didn't parse `tools.web_search` from harness.yaml, so `opts.profile.harness.tools.web_search` was `undefined` in session.ts. Added WebSearchBlock parser + emit on ProfileSnapshot.

Classification: integration defects, plan-checker didn't catch because the unit tests mocked the prompt-assembly and profile-loader layers. Live walkthrough is load-bearing (repeating the Plan 03-05 / 03-08 lesson). **v3.1 hash updated** `sha256:f761da95...81ce3eb` → `sha256:f9dcabd1...01fc73` after tool_descriptions.md edit.

## Verdict

**`p3.1-02 searxng green`** — SearxNG up, web_search real end-to-end on live Qwen3.6, web_fetch bypass + SSRF guard, kill switches, air-gap CI split — all working on the Spark.
