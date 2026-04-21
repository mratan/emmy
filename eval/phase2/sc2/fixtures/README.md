# SC-2 fixtures — prior-repo lift + D-10 synthetic augmentation

Source: CONTEXT.md §D-10. Prior-repo CODE_01..CODE_05 were audited for edit-tool coverage; only
CODE_04 partially exercised the edit tool, and all five were primarily "write a complete script"
prompts (write tool, not edit tool). Per D-10, augmentation is called out here so the delta is honest.

## Audit of prior-repo CODE_01..CODE_05

| Prior task | Prompt shape               | Exercises edit? | Disposition |
|------------|----------------------------|-----------------|-------------|
| CODE_01    | "Output complete script"   | NO (write-only) | Skipped for SC-2 |
| CODE_02    | "Output complete script"   | NO (write-only) | Adapted as sc2_task_03 |
| CODE_03    | "Output complete test file"| NO (write-only) | Adapted as sc2_task_02 |
| CODE_04    | "Output complete fixed code"| AMBIGUOUS (model could edit or rewrite) | Adapted as sc2_task_01 (explicit "edit only the buggy lines") |
| CODE_05    | "Output complete implementation" | NO (write-only) | Skipped for SC-2 |

Edit-coverage in raw prior-repo: **1/5 ambiguous, 0/5 clear**. Below D-10's ≥3/5 threshold →
augment with synthetic edit-heavy fixtures.

## Fixtures shipped in this directory

| File | Source | Edit-exercise mechanic | Justification |
|------|--------|-----------------------|---------------|
| `sc2_task_01.json` | lifted from CODE_04 | Two targeted replace-line edits | Original prompt could be rewrite-only; we force explicit edit by providing a pre-existing file and asking for two specific line changes. |
| `sc2_task_02.json` | lifted from CODE_03 | Insert after-hash | Original prompt asked to output a whole test file; we provide a pre-existing file and ask for a single appended test. |
| `sc2_task_03.json` | lifted from CODE_02 | Insert after-hash | Original prompt asked to output three implementations; we provide broken memoization and ask for one insert. |
| `sc2_task_04.json` | synthetic | Multi-file rename (≥3 edits across 2 files) | Canonical rename-across-files scenario. Not in prior repo. |
| `sc2_task_05.json` | synthetic | Duplicate-line disambiguation via hash | THE canonical Hashline win — identical lines that string-replace cannot disambiguate. Drives HashResolutionError path in edit-hashline.ts. |

## Summary

- **Total fixtures:** 5 (plan allowed 5-7)
- **Adapted from prior repo:** 3 (sc2_task_01..03; all "lifted" bookkeeping preserves SC-2 continuity per D-10)
- **Synthetic:** 2 (sc2_task_04, sc2_task_05; synthetic augmentation per D-10 to close edit-coverage gap)
- **All 5 exercise the edit tool.** `exercises_edit: true` in every fixture.

## Run

```bash
bun eval/phase2/sc2/run_sc2.ts --profile profiles/qwen3.6-35b-a3b/v2 --base-url http://127.0.0.1:8002 --out runs/phase2-sc2/
```

The runner exercises two edit-tool paths per fixture:
- **Hash-anchored (production default):** `edit-hashline.ts` with per-line SHA-256 anchors.
- **Baseline (string-replace fallback simulation):** a plain-text `.replace()` on the file using `old_string`/`new_string` extracted from the model's turn.

verdict=pass iff hash-anchored has 0 "string not found" failures AND baseline has ≥1 (proves the
regression Hashline solves, per D-10 rationale).
