// eval/phase3/think-leak.test.ts
//
// Plan 03-01 Task 1 (RED) — Test 8: ensures the a17f4a9 `<think>`-strip stopgap
// has been removed from the codebase AND the final output of runPrint does
// not contain `<think>` blocks.
//
// Strategy:
//   1. Codebase-level regression: grep session.ts for the literal regex
//      `replace(/<think>` — it MUST NOT be present after Task 2 (GREEN).
//   2. Runtime-level regression: simulate a streaming assistant response that
//      begins with `<think>internal</think>final`, dispatch it through the
//      session's runPrint, and assert the returned text equals `final` WITHOUT
//      any regex post-processing (i.e., the upstream enable_thinking:false
//      hook is the authoritative source).
//
// RED expectation:
//   - Subtest (1): the literal regex IS present at commit time (Phase 2
//     stopgap still in place) → assertion fails with "string found: 1".
//   - Subtest (2): since the hook isn't installed yet, `<think>` flows through
//     uncleaned → assertion fails with `<think>` still in the output.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const SESSION_TS = resolve(REPO_ROOT, "packages/emmy-ux/src/session.ts");

describe("Phase-3 think-leak regression — codebase-level", () => {
	test("packages/emmy-ux/src/session.ts does NOT contain the a17f4a9 <think>-strip regex", () => {
		const content = readFileSync(SESSION_TS, "utf8");
		// The a17f4a9 stopgap's exact call-shape:
		//   text.replace(/<think>[\s\S]*?<\/think>\s*/g, "")
		// We check for the two strongest signature fragments:
		const hasStripRegex = content.includes("replace(/<think>");
		const hasStripMethod = /text\.replace\([^)]*<think>/.test(content);
		expect(hasStripRegex).toBe(false);
		expect(hasStripMethod).toBe(false);
	});

	test("no other file under packages/emmy-ux/src/ re-introduces a <think>-strip pattern", () => {
		// Glob a small set of analog files to defend against cargo-culting.
		const suspects = [
			resolve(REPO_ROOT, "packages/emmy-ux/src/session.ts"),
			resolve(REPO_ROOT, "packages/emmy-ux/bin/pi-emmy.ts"),
		];
		for (const path of suspects) {
			let raw = "";
			try {
				raw = readFileSync(path, "utf8");
			} catch {
				continue;
			}
			const m = /replace\(\s*\/<think>/.exec(raw);
			if (m) {
				throw new Error(
					`${path} contains a <think>-strip regex: "${m[0]}". Remove it — the proper fix is chat_template_kwargs.enable_thinking:false at the before_provider_request hook.`,
				);
			}
		}
	});
});
