// H6 — Per-child SessionManager and JSONL location.
// SessionManager.create(cwd, sessionDir?) takes an optional sessionDir
// override. Question: can two sessions write to DIFFERENT JSONL files
// in DIFFERENT directories without colliding?
//
// Pass: each session's file ends up where its sessionDir says, with
//   correct content, no cross-writes.
// Fail: SessionManager state shared / cwd-bound singletoned, only one
//   file per process.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionServices,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import { fauxAssistantMessage, registerFauxProvider } from "@mariozechner/pi-ai";

async function runOneTurn(session: any, prompt: string): Promise<void> {
	await session.prompt(prompt);
	// give pi a tick to flush the JSONL write
	await new Promise((r) => setTimeout(r, 50));
}

function listJsonlFiles(dir: string): string[] {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((d) => d.isFile() && d.name.endsWith(".jsonl"))
			.map((d) => d.name);
	} catch {
		return [];
	}
}

async function main() {
	const findings: any = { hypothesis: "H6 — per-child JSONL location", checks: [] };

	const tmpRoot = mkdtempSync(join(tmpdir(), "emmy-h6-"));
	const parentDir = join(tmpRoot, "parent-sessions");
	const childDir = join(tmpRoot, "child-sessions");

	const reg = registerFauxProvider({
		api: "spike-h6",
		provider: "spike-h6",
		models: [{ id: "h6-model", contextWindow: 4096, maxTokens: 1024 }],
	});
	reg.setResponses(Array(32).fill(fauxAssistantMessage("written", { stopReason: "stop" })));

	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey("spike-h6", "fake-key");

	const services = await createAgentSessionServices({
		cwd: tmpRoot,
		authStorage,
	});

	const parentSm = SessionManager.create(tmpRoot, parentDir);
	const childSm = SessionManager.create(tmpRoot, childDir);

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

	await runOneTurn(parent, "I am parent, write to my dir");
	await runOneTurn(child, "I am child, write to my dir");

	const parentFiles = listJsonlFiles(parentDir);
	const childFiles = listJsonlFiles(childDir);

	findings.parentDir = parentDir;
	findings.childDir = childDir;
	findings.parentFiles = parentFiles;
	findings.childFiles = childFiles;
	findings.parentSessionFile = parent.sessionFile;
	findings.childSessionFile = child.sessionFile;

	findings.checks.push({
		name: "parent's session file path is in parentDir",
		pass: !!parent.sessionFile && parent.sessionFile.startsWith(parentDir),
	});
	findings.checks.push({
		name: "child's session file path is in childDir",
		pass: !!child.sessionFile && child.sessionFile.startsWith(childDir),
	});
	findings.checks.push({
		name: "parentDir contains exactly 1 jsonl",
		pass: parentFiles.length === 1,
	});
	findings.checks.push({
		name: "childDir contains exactly 1 jsonl",
		pass: childFiles.length === 1,
	});

	// Inspect content: parent's jsonl should mention "I am parent",
	// child's should mention "I am child", neither should cross-leak.
	if (parentFiles.length === 1 && childFiles.length === 1) {
		const pContent = readFileSync(join(parentDir, parentFiles[0]!), "utf8");
		const cContent = readFileSync(join(childDir, childFiles[0]!), "utf8");
		findings.checks.push({
			name: "parent's jsonl contains 'I am parent'",
			pass: pContent.includes("I am parent"),
		});
		findings.checks.push({
			name: "parent's jsonl does NOT contain 'I am child'",
			pass: !pContent.includes("I am child"),
		});
		findings.checks.push({
			name: "child's jsonl contains 'I am child'",
			pass: cContent.includes("I am child"),
		});
		findings.checks.push({
			name: "child's jsonl does NOT contain 'I am parent'",
			pass: !cContent.includes("I am parent"),
		});
	}

	parent.dispose();
	child.dispose();
	reg.unregister();
	rmSync(tmpRoot, { recursive: true, force: true });

	const allPass = findings.checks.every((c: any) => c.pass);
	findings.verdict = allPass ? "PASS" : "FAIL";
	console.log(JSON.stringify(findings, null, 2));
	if (!allPass) process.exit(1);
}

main().catch((e) => {
	console.error("H6 FAILED with exception:", e);
	process.exit(2);
});
