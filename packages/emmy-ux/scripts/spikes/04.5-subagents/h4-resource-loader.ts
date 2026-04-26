// H4 — Per-session resource loader / system prompt.
// resourceLoaderOptions is wired at services-creation time, so two sessions
// built from one services SHOULD share a resource loader.
//
// But the question is: can we make parent and child have DIFFERENT system
// prompts without separate services? Three angles:
//   (a) Does session.systemPrompt differ if we construct sessions with
//       different inputs (it's a getter — maybe it includes per-session
//       state).
//   (b) Can we pass a per-session resourceLoader override?
//   (c) Can we override systemPrompt via the prompt() text without touching
//       services (i.e., prepend a "you are now a research subagent" message)?
//
// Pass (lean path): per-session system prompt is achievable somehow.
// Fail (standard path): only via separate services per child.

import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionServices,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { fauxAssistantMessage, registerFauxProvider } from "@mariozechner/pi-ai";

async function main() {
	const findings: any = { hypothesis: "H4 — per-session resource loader / system prompt", checks: [] };

	const reg = registerFauxProvider({
		api: "spike-h4",
		provider: "spike-h4",
		models: [{ id: "h4-model", contextWindow: 4096, maxTokens: 1024 }],
	});
	reg.setResponses(Array(32).fill(fauxAssistantMessage("ok", { stopReason: "stop" })));

	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey("spike-h4", "fake-key");

	// Path 1 — shared services, default resource loader.
	const services = await createAgentSessionServices({
		cwd: process.cwd(),
		authStorage,
	});

	const { session: parent } = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.inMemory(process.cwd()),
		model: reg.getModel(),
	});

	const { session: child } = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.inMemory(process.cwd()),
		model: reg.getModel(),
	});

	const parentSP = parent.systemPrompt;
	const childSP = child.systemPrompt;

	findings.parentSystemPromptHash = await sha256(parentSP);
	findings.childSystemPromptHash = await sha256(childSP);
	findings.parentSystemPromptPreview = parentSP.slice(0, 120);
	findings.childSystemPromptPreview = childSP.slice(0, 120);
	findings.parentSystemPromptLength = parentSP.length;
	findings.childSystemPromptLength = childSP.length;

	findings.checks.push({
		name: "shared services → identical system prompts (expected)",
		pass: findings.parentSystemPromptHash === findings.childSystemPromptHash,
		note: "if true, per-session system prompts require separate services",
	});

	parent.dispose();
	child.dispose();

	// Path 2 — TRY per-session services with separate resource loaders.
	// Each session gets its own services instance so its resourceLoader
	// is independent.
	const services2 = await createAgentSessionServices({
		cwd: process.cwd(),
		authStorage,
	});
	const services3 = await createAgentSessionServices({
		cwd: process.cwd(),
		authStorage,
	});

	const { session: p2 } = await createAgentSessionFromServices({
		services: services2,
		sessionManager: SessionManager.inMemory(process.cwd()),
		model: reg.getModel(),
	});
	const { session: c2 } = await createAgentSessionFromServices({
		services: services3,
		sessionManager: SessionManager.inMemory(process.cwd()),
		model: reg.getModel(),
	});

	const p2SP = p2.systemPrompt;
	const c2SP = c2.systemPrompt;
	findings.checks.push({
		name: "separate services → still identical SP if cwd+resource paths match",
		pass: p2SP === c2SP,
		note: "expected; the resource loader's defaults converge on the same content",
	});

	p2.dispose();
	c2.dispose();

	// Path 3 — try a CUSTOM resourceLoader to inject a different system prompt.
	// Use DefaultResourceLoader with a different cwd to simulate a sub-agent
	// living in a different "world" (different project context files).
	// This is the lean-path candidate: per-session resource loader override.
	const customCwd = `${process.cwd()}/.spike-h4-fake`;
	try {
		const fs = await import("node:fs");
		fs.mkdirSync(customCwd, { recursive: true });
		fs.writeFileSync(`${customCwd}/AGENTS.md`, "# AGENTS.md from h4 spike\nYou are a SUB-AGENT. Different instructions here.\n");

		const customLoader = new DefaultResourceLoader({
			cwd: customCwd,
			agentDir: getAgentDir(),
			settingsManager: SettingsManager.create(customCwd),
		});
		await customLoader.reload();

		// Build a NEW services with the custom loader passed in.
		const subagentServices = await createAgentSessionServices({
			cwd: customCwd,
			authStorage,
			resourceLoaderOptions: {} as any,
		});

		// Try to slot the customLoader into a session via the session's
		// resourceLoader getter (read-only on AgentSession). So the only path
		// is per-session services with its own resource loader.
		const { session: subagent } = await createAgentSessionFromServices({
			services: subagentServices,
			sessionManager: SessionManager.inMemory(customCwd),
			model: reg.getModel(),
		});

		const subSP = subagent.systemPrompt;
		findings.checks.push({
			name: "different cwd → different system prompt (per-services override works)",
			pass: subSP !== parentSP,
			note: "this is the path to per-child system prompts",
		});
		findings.subagentSystemPromptPreview = subSP.slice(0, 200);

		subagent.dispose();
		fs.rmSync(customCwd, { recursive: true, force: true });
	} catch (e) {
		findings.checks.push({
			name: "custom resource loader path",
			pass: false,
			error: String(e),
		});
	}

	reg.unregister();

	const allPass = findings.checks.every((c: any) => c.pass);
	findings.verdict = allPass ? "PASS" : "PARTIAL";
	console.log(JSON.stringify(findings, null, 2));
	if (!allPass) process.exit(0); // PARTIAL is acceptable — informs design
}

async function sha256(s: string): Promise<string> {
	const buf = new TextEncoder().encode(s);
	const hash = await crypto.subtle.digest("SHA-256", buf);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
		.slice(0, 16);
}

main().catch((e) => {
	console.error("H4 FAILED with exception:", e);
	process.exit(2);
});
