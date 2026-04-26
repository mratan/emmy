// Smoke test: confirm we can spin a pi-mono session against a faux provider
// and run a single turn end-to-end. If this fails, every spike below is moot.
import { AuthStorage, createAgentSession } from "@mariozechner/pi-coding-agent";
import { fauxAssistantMessage, registerFauxProvider } from "@mariozechner/pi-ai";

async function main() {
	const reg = registerFauxProvider({
		api: "spike-smoke",
		provider: "spike-smoke",
		models: [{ id: "smoke-model-1", contextWindow: 4096, maxTokens: 1024 }],
	});

	reg.setResponses([
		fauxAssistantMessage("hello from the spike", { stopReason: "stop" }),
	]);

	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey("spike-smoke", "fake-key-for-faux");

	const { session } = await createAgentSession({
		model: reg.getModel(),
		authStorage,
		// no customTools, no resourceLoader — accept defaults
	});

	let endText = "";
	const unsub = session.subscribe((evt: any) => {
		if (evt?.type === "agent_end") {
			const msgs = evt.messages ?? [];
			for (let i = msgs.length - 1; i >= 0; i--) {
				const m = msgs[i];
				if (m?.role === "assistant" && Array.isArray(m.content)) {
					endText = m.content
						.filter((c: any) => c.type === "text")
						.map((c: any) => c.text)
						.join("");
					break;
				}
			}
		}
	});

	await session.prompt("ping");
	unsub();
	session.dispose();
	reg.unregister();

	console.log(JSON.stringify({
		ok: endText === "hello from the spike",
		endText,
		callCount: reg.state.callCount,
	}, null, 2));

	if (endText !== "hello from the spike") process.exit(1);
}

main().catch((e) => {
	console.error("SMOKE FAILED:", e);
	process.exit(2);
});
