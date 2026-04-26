// H2 — Per-session customTools scope.
// When parent and child are built from the same services with DIFFERENT
// customTools arrays, do their tool registries actually differ? Or does
// some shared services state leak (e.g. a global tool registry)?
//
// Pass: each session sees only the tools it was constructed with (plus
//   pi's defaults). No cross-leakage.
// Fail: tools are unioned/shared.

import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionServices,
	defineTool,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import { fauxAssistantMessage, registerFauxProvider, Type } from "@mariozechner/pi-ai";

const parentOnlyTool = defineTool({
	name: "parent_only_marker",
	description: "Marker tool present only on the parent.",
	label: "ParentOnly",
	parameters: Type.Object({}),
	execute: async () => ({
		output: "ok",
		details: { ok: true } as any,
	}),
});

const childOnlyTool = defineTool({
	name: "child_only_marker",
	description: "Marker tool present only on the child.",
	label: "ChildOnly",
	parameters: Type.Object({}),
	execute: async () => ({
		output: "ok",
		details: { ok: true } as any,
	}),
});

async function main() {
	const findings: any = { hypothesis: "H2 — customTools scope", checks: [] };

	const reg = registerFauxProvider({
		api: "spike-h2",
		provider: "spike-h2",
		models: [{ id: "h2-model", contextWindow: 4096, maxTokens: 1024 }],
	});
	reg.setResponses(Array(8).fill(fauxAssistantMessage("ok", { stopReason: "stop" })));

	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey("spike-h2", "fake-key");

	const services = await createAgentSessionServices({
		cwd: process.cwd(),
		authStorage,
	});

	const { session: parent } = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.inMemory(process.cwd()),
		model: reg.getModel(),
		customTools: [parentOnlyTool] as any,
	});

	const { session: child } = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.inMemory(process.cwd()),
		model: reg.getModel(),
		customTools: [childOnlyTool] as any,
	});

	const parentTools = parent.getActiveToolNames();
	const childTools = child.getActiveToolNames();
	const parentAll = parent.getAllTools().map((t: any) => t.name);
	const childAll = child.getAllTools().map((t: any) => t.name);

	findings.parentActiveTools = parentTools;
	findings.childActiveTools = childTools;
	findings.parentAllTools = parentAll;
	findings.childAllTools = childAll;

	findings.checks.push({
		name: "parent has parent_only_marker in active tools",
		pass: parentTools.includes("parent_only_marker"),
	});
	findings.checks.push({
		name: "parent does NOT have child_only_marker",
		pass: !parentTools.includes("child_only_marker"),
	});
	findings.checks.push({
		name: "child has child_only_marker in active tools",
		pass: childTools.includes("child_only_marker"),
	});
	findings.checks.push({
		name: "child does NOT have parent_only_marker",
		pass: !childTools.includes("parent_only_marker"),
	});

	// Same checks against the broader getAllTools registry (includes inactive).
	findings.checks.push({
		name: "parent.getAllTools omits child marker",
		pass: !parentAll.includes("child_only_marker"),
	});
	findings.checks.push({
		name: "child.getAllTools omits parent marker",
		pass: !childAll.includes("parent_only_marker"),
	});

	parent.dispose();
	child.dispose();
	reg.unregister();

	const allPass = findings.checks.every((c: any) => c.pass);
	findings.verdict = allPass ? "PASS" : "FAIL";
	console.log(JSON.stringify(findings, null, 2));
	if (!allPass) process.exit(1);
}

main().catch((e) => {
	console.error("H2 FAILED with exception:", e);
	process.exit(2);
});
