// Plan 04.4-04 Task 2 — V5 air-gap stress test for the memory tool.
// Runs 100 mixed ops; the shell wrapper at tests/smoke/verify_memory_airgap.sh
// runs this under strace -e trace=network and asserts zero non-loopback connect.

import {
	afterAll,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildMemoryTool,
	DEFAULT_MEMORY_CONFIG,
	MemoryTelemetryCounters,
	buildMemoryTelemetryHook,
} from "../../src/index";

/** Number of ops per V5 in MEMORY-TOOL-SPEC.md §10. */
export const MEMORY_AIRGAP_STRESS_OPS = 100;

describe("memory tool — air-gap stress (V5)", () => {
	let tmpRoot: string;
	let cwd: string;

	beforeAll(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "memory-airgap-"));
		cwd = join(tmpRoot, "repo");
		mkdirSync(cwd, { recursive: true });
	});

	afterAll(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	test("runs 100 mixed ops without errors and produces sensible counters", async () => {
		const counters = new MemoryTelemetryCounters();
		const events: Array<{ event: string }> = [];
		const tool = buildMemoryTool({
			config: {
				...DEFAULT_MEMORY_CONFIG,
				project_root: ".emmy/notes",
				global_root: join(tmpRoot, "global-mem"),
			},
			cwd,
			onOp: buildMemoryTelemetryHook({
				emitEvent: (rec) => events.push(rec as { event: string }),
				counters,
				blockedExtensions: DEFAULT_MEMORY_CONFIG.blocked_extensions,
			}),
		});

		const exec = async (params: unknown) =>
			tool.execute(
				"test",
				params,
				new AbortController().signal,
				() => {},
			);

		// Phase 1: 20 creates
		for (let i = 0; i < 20; i++) {
			await exec({
				command: "create",
				path: `/memories/project/note-${i}.md`,
				file_text: `note ${i}\nbody\n`,
			});
		}
		// Phase 2: 30 views
		for (let i = 0; i < 30; i++) {
			await exec({
				command: "view",
				path: `/memories/project/note-${i % 20}.md`,
			});
		}
		// Phase 3: 25 str_replaces
		for (let i = 0; i < 25; i++) {
			await exec({
				command: "str_replace",
				path: `/memories/project/note-${i % 20}.md`,
				old_str: `body`,
				new_str: `BODY-${i}`,
			});
		}
		// Phase 4: 10 inserts (different files)
		for (let i = 0; i < 10; i++) {
			await exec({
				command: "insert",
				path: `/memories/project/note-${i}.md`,
				insert_line: 0,
				insert_text: `inserted ${i}`,
			});
		}
		// Phase 5: 10 deletes (different files than 4)
		for (let i = 10; i < 20; i++) {
			await exec({
				command: "delete",
				path: `/memories/project/note-${i}.md`,
			});
		}
		// Phase 6: 5 renames within scope
		for (let i = 0; i < 5; i++) {
			await exec({
				command: "rename",
				old_path: `/memories/project/note-${i}.md`,
				new_path: `/memories/project/renamed-${i}.md`,
			});
		}

		const snap = counters.snapshot();
		expect(snap.create).toBe(20);
		expect(snap.view).toBe(30);
		expect(snap.str_replace).toBe(25);
		expect(snap.insert).toBe(10);
		expect(snap.delete).toBe(10);
		expect(snap.rename).toBe(5);
		expect(
			snap.create +
				snap.view +
				snap.str_replace +
				snap.insert +
				snap.delete +
				snap.rename,
		).toBe(MEMORY_AIRGAP_STRESS_OPS);
		expect(snap.bytes_written).toBeGreaterThan(0);
		expect(events.length).toBe(MEMORY_AIRGAP_STRESS_OPS);
	});
});
