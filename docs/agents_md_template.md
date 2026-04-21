# AGENTS.md

> Drop this at the repo root. Emmy reads it verbatim into every session prompt
> (layered after the profile's `prompts/system.md`, before tool defs). Hash logging
> makes drift observable. Keep it short — every token lives in your KV cache.

## Build / Test Commands

- Build: `<your build command>` (e.g. `bun run build`, `cargo build`, `pytest`)
- Test: `<your test command>`
- Lint: `<your lint command>`
- Single-test run: `<pattern>` (e.g. `bun test --filter <name>`)

## Key Paths

- Source: `src/`
- Tests: `tests/`
- Config: `<path>`

## House Style Rules

- <style point 1> (e.g. "No `any` in TypeScript; prefer `unknown` + narrow")
- <style point 2> (e.g. "Imports sorted by biome organizeImports on save")
- <style point 3>

## Preferred Patterns

- <pattern 1> (e.g. "Fail-loud on config errors; never silently default")
- <pattern 2>

## Things to Avoid

- <anti-pattern 1>
- <anti-pattern 2>

## Model Hints (optional)

- When planning a change, write a short `PLAN.md` before editing.
- When refactoring, make one logical change per commit.
- Read `tests/` before modifying production code.
