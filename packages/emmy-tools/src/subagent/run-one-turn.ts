// Phase 04.5 Plan 01 — runOneTurnReturningText helper.
//
// Subscribes to the child's `agent_end` event, walks the resulting
// messages array from the END to find the last role==="assistant" entry
// with array-shaped content, and concatenates its text-typed content
// blocks into a single string. Mirrors INTEGRATION-SKETCH.md §2 lines
// 142-162 verbatim and the spike helper in
// packages/emmy-ux/scripts/spikes/04.5-subagents/h1-services-sharing.ts:30-39.
//
// Resolves to "" when no assistant message is present (e.g. immediate
// stop). Rejects iff `child.prompt(prompt)` rejects — the unsubscribe
// fires on both paths so dispose() in the dispatcher's finally is a
// pure-cleanup hook.

export async function runOneTurnReturningText(child: any, prompt: string): Promise<string> {
	let captured = "";
	const unsub = child.subscribe((evt: any) => {
		if (evt?.type === "agent_end") {
			const messages: any[] = evt.messages ?? [];
			for (let i = messages.length - 1; i >= 0; i--) {
				const m = messages[i];
				if (m?.role === "assistant" && Array.isArray(m.content)) {
					captured = m.content
						.filter((c: any) => c?.type === "text")
						.map((c: any) => c.text)
						.join("");
					break;
				}
			}
		}
	});
	try {
		await child.prompt(prompt);
	} finally {
		unsub();
	}
	return captured;
}
