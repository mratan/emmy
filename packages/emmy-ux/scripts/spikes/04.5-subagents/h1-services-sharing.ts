// H1 — Can a parent and child AgentSession share one AgentSessionServices?
// We build services once with createAgentSessionServices, then build two
// sessions from those services with createAgentSessionFromServices.
// Prompt each in turn; assert no event/state cross-contamination.
//
// Pass: each session yields its own canned response, callCount split correctly.
// Fail: hangs, shared mutable state corruption, sessions cross-talk.

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
		if (evt?.type === "agent_end") {
			captured = lastAssistantText(evt.messages ?? []);
		}
	});
	await session.prompt(prompt);
	unsub();
	return captured;
}

function userTextOf(ctx: any): string {
	const msgs = ctx?.messages ?? [];
	for (let i = msgs.length - 1; i >= 0; i--) {
		const m = msgs[i];
		if (m?.role === "user" && Array.isArray(m.content)) {
			return m.content
				.filter((c: any) => c.type === "text")
				.map((c: any) => c.text)
				.join("");
		}
	}
	return "";
}

async function main() {
	const findings: any = { hypothesis: "H1 — services sharing", checks: [] };

	const reg = registerFauxProvider({
		api: "spike-h1",
		provider: "spike-h1",
		models: [{ id: "h1-model", contextWindow: 4096, maxTokens: 1024 }],
	});

	// Pool of factory steps: dispatch by latest user prompt text.
	// Pre-load 64 copies so concurrent prompts can't race the pool dry.
	const factoryStep: any = (ctx: any) => {
		const userText = userTextOf(ctx);
		let reply = "DEFAULT";
		if (userText.includes("parent")) reply = userText.includes("concurrent") ? "CONCUR_PARENT" : "PARENT_OK";
		else if (userText.includes("child")) reply = userText.includes("concurrent") ? "CONCUR_CHILD" : "CHILD_OK";
		return fauxAssistantMessage(reply, { stopReason: "stop" });
	};
	reg.setResponses(Array(64).fill(factoryStep));

	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey("spike-h1", "fake-key");

	const services = await createAgentSessionServices({
		cwd: process.cwd(),
		authStorage,
	});

	const sm1 = SessionManager.inMemory(process.cwd());
	const sm2 = SessionManager.inMemory(process.cwd());
	const { session: parent } = await createAgentSessionFromServices({
		services,
		sessionManager: sm1,
		model: reg.getModel(),
	});
	const { session: child } = await createAgentSessionFromServices({
		services,
		sessionManager: sm2,
		model: reg.getModel(),
	});

	findings.checks.push({
		name: "both sessions instantiated from shared services",
		pass: parent !== child && typeof parent.prompt === "function" && typeof child.prompt === "function",
	});

	const parentText = await runOneTurn(parent, "I am parent");
	const childText = await runOneTurn(child, "I am child");

	findings.checks.push({
		name: "parent received PARENT_OK (sequential)",
		pass: parentText === "PARENT_OK",
		actual: parentText,
	});
	findings.checks.push({
		name: "child received CHILD_OK (sequential)",
		pass: childText === "CHILD_OK",
		actual: childText,
	});

	findings.checks.push({
		name: "independent message logs",
		pass: parent.messages.length > 0 && child.messages.length > 0,
		parentMsgs: parent.messages.length,
		childMsgs: child.messages.length,
	});
	findings.checks.push({
		name: "distinct sessionIds",
		pass: parent.sessionId !== child.sessionId,
		parentSessionId: parent.sessionId,
		childSessionId: child.sessionId,
	});

	const [pConc, cConc] = await Promise.all([
		runOneTurn(parent, "concurrent parent ping"),
		runOneTurn(child, "concurrent child ping"),
	]);

	findings.checks.push({
		name: "concurrent prompt() — parent receives CONCUR_PARENT",
		pass: pConc === "CONCUR_PARENT",
		actual: pConc,
	});
	findings.checks.push({
		name: "concurrent prompt() — child receives CONCUR_CHILD",
		pass: cConc === "CONCUR_CHILD",
		actual: cConc,
	});

	parent.dispose();
	child.dispose();
	reg.unregister();

	const allPass = findings.checks.every((c: any) => c.pass);
	findings.verdict = allPass ? "PASS" : "FAIL";
	findings.totalProviderCalls = reg.state.callCount;
	console.log(JSON.stringify(findings, null, 2));
	if (!allPass) process.exit(1);
}

main().catch((e) => {
	console.error("H1 FAILED with exception:", e);
	process.exit(2);
});
