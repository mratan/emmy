// PLAN-03-MERGE-NOTE: Owned by Plan 02-03. Stubbed so edit-hashline.ts's post-hoc
// diff emission compiles in isolation. On merge-back:
// `git checkout --theirs packages/emmy-tools/src/diff-render.ts`.

import { createPatch } from "diff";

export function renderUnifiedDiff(before: string, after: string, path: string): string {
  if (before === after) return "";
  return createPatch(path, before, after, "", "", { context: 3 });
}
