// H3 — Cross-model child via different `model` arg.
// Build parent and child from the SAME services, but with different models
// (registered via two separate faux providers). Verify each session routes
// to its own provider's response.
//
// Pass: parent's prompt hits provider A, child's hits provider B; both work.
// Fail: model is sticky inside services and both sessions hit the same one.

import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionServices,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
import { fauxAssistantMessage, registerFauxProvider } from "@mariozechner/pi-ai";

function lastAssistantText(messages: any[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m?.role === "assistant" && Array.isArray(m.content)) {
			return m.content
				.filter((c: any) => c.type === "text")
				.map((c: any) => c.text)
				.join("");
		}
	}
	return "";
}

async function runOneTurn(session: any, prompt: string): Promise<string> {
	let captured = "";
	const unsub = session.subscribe((evt: any) => {
		if (evt?.type === "agent_end") captured = lastAssistantText(evt.messages ?? []);
	});
	await session.prompt(prompt);
	unsub();
	return captured;
}

async function main() {
	const findings: any = { hypothesis: "H3 — cross-model child", checks: [] };

	const regA = registerFauxProvider({
		api: "spike-h3-a",
		provider: "spike-h3-a",
		models: [{ id: "model-a", contextWindow: 4096, maxTokens: 1024 }],
	});
	regA.setResponses(Array(64).fill(fauxAssistantMessage("FROM_A", { stopReason: "stop" })));

	const regB = registerFauxProvider({
		api: "spike-h3-b",
		provider: "spike-h3-b",
		models: [{ id: "model-b", contextWindow: 4096, maxTokens: 1024 }],
	});
	regB.setResponses(Array(64).fill(fauxAssistantMessage("FROM_B", { stopReason: "stop" })));

	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey("spike-h3-a", "key-a");
	authStorage.setRuntimeApiKey("spike-h3-b", "key-b");

	const services = await createAgentSessionServices({
		cwd: process.cwd(),
		authStorage,
	});

	const { session: parent } = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.inMemory(process.cwd()),
		model: regA.getModel(), // parent uses provider A
	});
	const { session: child } = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.inMemory(process.cwd()),
		model: regB.getModel(), // child uses provider B
	});

	const before = { a: regA.state.callCount, b: regB.state.callCount };

	const parentText = await runOneTurn(parent, "ping parent");
	const aAfterParent = regA.state.callCount;
	const bAfterParent = regB.state.callCount;

	const childText = await runOneTurn(child, "ping child");
	const aAfterChild = regA.state.callCount;
	const bAfterChild = regB.state.callCount;

	findings.callCounts = {
		before,
		afterParent: { a: aAfterParent, b: bAfterParent },
		afterChild: { a: aAfterChild, b: bAfterChild },
	};

	findings.checks.push({
		name: "parent's prompt hit provider A",
		pass: aAfterParent > before.a,
	});
	findings.checks.push({
		name: "parent's prompt did NOT hit provider B",
		pass: bAfterParent === before.b,
	});
	findings.checks.push({
		name: "parent received FROM_A",
		pass: parentText === "FROM_A",
		actual: parentText,
	});

	findings.checks.push({
		name: "child's prompt hit provider B",
		pass: bAfterChild > bAfterParent,
	});
	findings.checks.push({
		name: "child's prompt did NOT hit provider A",
		pass: aAfterChild === aAfterParent,
	});
	findings.checks.push({
		name: "child received FROM_B",
		pass: childText === "FROM_B",
		actual: childText,
	});

	parent.dispose();
	child.dispose();
	regA.unregister();
	regB.unregister();

	const allPass = findings.checks.every((c: any) => c.pass);
	findings.verdict = allPass ? "PASS" : "FAIL";
	console.log(JSON.stringify(findings, null, 2));
	if (!allPass) process.exit(1);
}

main().catch((e) => {
	console.error("H3 FAILED with exception:", e);
	process.exit(2);
});
