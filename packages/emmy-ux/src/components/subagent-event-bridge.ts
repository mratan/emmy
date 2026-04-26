// Phase 04.5 Plan 05 — pi event subscription → ChildEventSnapshot stream.
//
// Decouples the TUI from pi-mono's AgentSessionEvent shape so the SubagentBlock
// component (subagent-block.ts) renders pure data, not raw SDK events. This is
// the only seam between pi 0.68 and the Ink/text rendering layer.
//
// Wave 1 parallel-safe (I1 fix): consumes ONLY generic pi events
// (tool_call_start, tool_call_end, agent_end). Does NOT depend on Plans
// 04.5-01/03 outputs (no @emmy/tools subagent imports, no OTel).

export interface ChildTurnSnapshot {
	toolName: string;
	argsPreview: string; // truncated to 80 chars
	resultPreview: string; // truncated to 200 chars
	status: "running" | "ok" | "error";
}

export interface ChildEventSnapshot {
	persona: string;
	promptPreview: string; // truncated to 60 chars
	turns: ChildTurnSnapshot[];
	done: boolean;
	finalText?: string;
}

const PREVIEW_PROMPT_MAX = 60;
const PREVIEW_ARGS_MAX = 80;
const PREVIEW_RESULT_MAX = 200;

function trunc(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, max - 1) + "…";
}

interface SubscribableSession {
	subscribe: (handler: (e: any) => void) => () => void;
}

/**
 * Subscribe to a child AgentSession's event stream and call onUpdate with a
 * fresh snapshot whenever the relevant events fire. The returned function
 * unsubscribes — call it in finally() so the bridge doesn't outlive the dispatch.
 */
export function subscribeChildSession(
	session: SubscribableSession,
	persona: string,
	promptPreview: string,
	onUpdate: (snapshot: ChildEventSnapshot) => void,
): () => void {
	const turnsByCallId = new Map<string, ChildTurnSnapshot>();
	const orderedCallIds: string[] = [];
	let done = false;
	let finalText: string | undefined;

	const emit = () => {
		onUpdate({
			persona,
			promptPreview: trunc(promptPreview, PREVIEW_PROMPT_MAX),
			turns: orderedCallIds.map((id) => turnsByCallId.get(id)!),
			done,
			finalText,
		});
	};

	const unsub = session.subscribe((evt: any) => {
		if (!evt || typeof evt !== "object" || typeof evt.type !== "string") return;
		if (evt.type === "tool_call_start") {
			const id =
				typeof evt.toolCallId === "string"
					? evt.toolCallId
					: `_anon_${orderedCallIds.length}`;
			const turn: ChildTurnSnapshot = {
				toolName: String(evt.toolName ?? "unknown"),
				argsPreview: trunc(JSON.stringify(evt.args ?? {}), PREVIEW_ARGS_MAX),
				resultPreview: "",
				status: "running",
			};
			turnsByCallId.set(id, turn);
			orderedCallIds.push(id);
			emit();
		} else if (evt.type === "tool_call_end") {
			const id =
				typeof evt.toolCallId === "string"
					? evt.toolCallId
					: orderedCallIds[orderedCallIds.length - 1];
			const turn = id !== undefined ? turnsByCallId.get(id) : undefined;
			if (turn) {
				const result = evt.result ?? {};
				const ok = !(
					result &&
					typeof result === "object" &&
					((result as any).ok === false || "error" in result)
				);
				turn.status = ok ? "ok" : "error";
				const previewSrc =
					result && typeof result === "object" && "output" in result
						? String((result as any).output ?? "")
						: JSON.stringify(result ?? {});
				turn.resultPreview = trunc(previewSrc, PREVIEW_RESULT_MAX);
				emit();
			}
		} else if (evt.type === "agent_end") {
			done = true;
			const messages: any[] = Array.isArray(evt.messages) ? evt.messages : [];
			for (let i = messages.length - 1; i >= 0; i--) {
				const m = messages[i];
				if (m?.role === "assistant" && Array.isArray(m.content)) {
					finalText = m.content
						.filter((c: any) => c?.type === "text")
						.map((c: any) => String(c.text ?? ""))
						.join("");
					break;
				}
			}
			emit();
		}
	});
	return unsub;
}
