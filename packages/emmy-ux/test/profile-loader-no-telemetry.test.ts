// packages/emmy-ux/test/profile-loader-no-telemetry.test.ts
//
// Plan 03-02 Task 2 (RED, becomes GREEN on landing). Enforces the initOtel
// call-order invariant: @emmy/ux's loadProfile module MUST NOT import from
// @emmy/telemetry nor call emitEvent. If it does, pi-emmy.ts's
// parseCliArgs -> loadProfile -> initOtel sequencing would emit spans before
// the OTel SDK is initialized (RESEARCH Pitfall #2).
//
// Implementation: shells out to grep via child_process.spawnSync and asserts
// zero matches on the file set covered by the invariant.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");

describe("profile-loader must not import from @emmy/telemetry (Pitfall #2 guard)", () => {
	test("grep returns zero matches across profile-loader.ts", () => {
		const target = resolve(pkgRoot, "src/profile-loader.ts");
		// If the file was renamed or moved, treat as an invariant failure —
		// forces a conscious update to this guard.
		expect(existsSync(target)).toBe(true);

		// Use grep -E with the same pattern the plan's acceptance criteria use.
		const result = spawnSync(
			"grep",
			["-E", "emitEvent|import.*emmy-telemetry", target],
			{ encoding: "utf8" },
		);
		// grep exits 1 when no match is found (this is the success case).
		// exit 0 means at least one match → invariant broken.
		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
	});
});
