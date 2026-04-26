// H7 — Child compaction independence.
// If child compacts, does parent's state get touched?
// Tests: compaction running flags, parent JSONL has no compaction entry.

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionServices,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import { fauxAssistantMessage, registerFauxProvider } from "@mariozechner/pi-ai";

async function main() {
	const findings: any = { hypothesis: "H7 — child compaction independence", checks: [] };

	const tmpRoot = mkdtempSync(join(tmpdir(), "emmy-h7-"));
	const reg = registerFauxProvider({
		api: "spike-h7",
		provider: "spike-h7",
		// contextWindow must be > pi's DEFAULT_COMPACTION_SETTINGS.reserveTokens (16384)
		// otherwise pi auto-compacts on every turn (compaction's "available" budget is negative).
		models: [{ id: "h7-model", contextWindow: 200_000, maxTokens: 1024 }],
	});

	// Compaction calls the model to produce a summary. Make every response
	// a generic "summary text" string.
	reg.setResponses(Array(64).fill(fauxAssistantMessage("turn or summary text", { stopReason: "stop" })));

	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey("spike-h7", "fake-key");

	const services = await createAgentSessionServices({
		cwd: tmpRoot,
		authStorage,
	});

	const parentSm = SessionManager.create(tmpRoot, join(tmpRoot, "parent"));
	const childSm = SessionManager.create(tmpRoot, join(tmpRoot, "child"));

	const { session: parent } = await createAgentSessionFromServices({
		services,
		sessionManager: parentSm,
		model: reg.getModel(),
	});
	const { session: child } = await createAgentSessionFromServices({
		services,
		sessionManager: childSm,
		model: reg.getModel(),
	});

	// Build up some history in each session.
	await parent.prompt("parent turn 1: lay groundwork");
	await parent.prompt("parent turn 2: continue");
	await child.prompt("child turn 1: research thing");
	await child.prompt("child turn 2: more research");

	const parentMsgsBefore = parent.messages.length;
	const childMsgsBefore = child.messages.length;
	const parentCompactingBefore = parent.isCompacting;
	const childCompactingBefore = child.isCompacting;

	// Manually compact CHILD only.
	let parentCompactingDuringChild = false;
	const checkInterval = setInterval(() => {
		if (parent.isCompacting) parentCompactingDuringChild = true;
	}, 5);
	let childCompactionResult: any;
	try {
		childCompactionResult = await child.compact("manual compaction for h7 test");
	} finally {
		clearInterval(checkInterval);
	}

	const parentMsgsAfter = parent.messages.length;
	const childMsgsAfter = child.messages.length;

	findings.parentMsgsBefore = parentMsgsBefore;
	findings.childMsgsBefore = childMsgsBefore;
	findings.parentMsgsAfter = parentMsgsAfter;
	findings.childMsgsAfter = childMsgsAfter;
	findings.parentCompactingBefore = parentCompactingBefore;
	findings.childCompactingBefore = childCompactingBefore;
	findings.parentCompactingDuringChild = parentCompactingDuringChild;
	findings.childCompactionResult = {
		hasResult: !!childCompactionResult,
		summary:
			childCompactionResult?.summary ??
			childCompactionResult?.summaryEntry?.summary,
	};

	findings.checks.push({
		name: "parent.isCompacting was never true while child compacted",
		pass: !parentCompactingDuringChild,
	});
	findings.checks.push({
		name: "parent message count unchanged across child compaction",
		pass: parentMsgsAfter === parentMsgsBefore,
		before: parentMsgsBefore,
		after: parentMsgsAfter,
	});
	findings.checks.push({
		name: "child compaction returned a result",
		pass: childCompactionResult !== undefined,
	});

	// Check JSONL files for compaction entries.
	const parentFile = parent.sessionFile;
	const childFile = child.sessionFile;
	let parentHasCompaction = false;
	let childHasCompaction = false;
	let parentEntryTypes: string[] = [];
	let childEntryTypes: string[] = [];
	let parentCompactionEntries: any[] = [];
	let childCompactionEntries: any[] = [];
	if (parentFile) {
		const lines = readFileSync(parentFile, "utf8").split("\n").filter(Boolean);
		for (const l of lines) {
			try {
				const e = JSON.parse(l);
				parentEntryTypes.push(e.type ?? "?");
				if (e.type === "compaction") {
					parentHasCompaction = true;
					parentCompactionEntries.push(e);
				}
			} catch {}
		}
	}
	if (childFile) {
		const lines = readFileSync(childFile, "utf8").split("\n").filter(Boolean);
		for (const l of lines) {
			try {
				const e = JSON.parse(l);
				childEntryTypes.push(e.type ?? "?");
				if (e.type === "compaction") {
					childHasCompaction = true;
					childCompactionEntries.push(e);
				}
			} catch {}
		}
	}
	findings.parentEntryTypes = parentEntryTypes;
	findings.childEntryTypes = childEntryTypes;
	findings.parentCompactionEntries = parentCompactionEntries;
	findings.childCompactionEntries = childCompactionEntries;
	findings.parentHasCompactionEntry = parentHasCompaction;
	findings.childHasCompactionEntry = childHasCompaction;
	findings.checks.push({
		name: "parent's JSONL has NO compaction entry",
		pass: !parentHasCompaction,
	});
	findings.checks.push({
		name: "child's JSONL HAS a compaction entry",
		pass: childHasCompaction,
	});

	parent.dispose();
	child.dispose();
	reg.unregister();
	const fs = await import("node:fs");
	fs.rmSync(tmpRoot, { recursive: true, force: true });

	const allPass = findings.checks.every((c: any) => c.pass);
	findings.verdict = allPass ? "PASS" : "FAIL";
	console.log(JSON.stringify(findings, null, 2));
	if (!allPass) process.exit(1);
}

main().catch((e) => {
	console.error("H7 FAILED with exception:", e);
	process.exit(2);
});
