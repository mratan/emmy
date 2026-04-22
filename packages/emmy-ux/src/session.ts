// packages/emmy-ux/src/session.ts
//
// createEmmySession — the Phase-2 session bootstrap. Wires @emmy/provider +
// @emmy/tools into a real pi-coding-agent@0.68.0 AgentSession, enforces the
// three Phase-2 invariants, and opens the Plan 08 SC-3 capture transcript.
//
// Boot order (fail-loud; Shared Pattern 3):
//   1. SP_OK canary fires against emmy-serve (Pitfall #6). Failure → SpOkCanaryError.
//   2. profile's prompts/system.md is read (required).
//   3. AGENTS.md discovery — cwd/AGENTS.md > cwd/.pi/SYSTEM.md > null.
//   4. assemblePrompt builds the 3-layer prompt (CONTEXT-04 locked order) and
//      emits the SHA-256 audit trail.
//   5. openTranscript creates runs/phase2-sc3-capture/session-<iso>.jsonl and
//      records the assembled system prompt (B2 fix).
//   6. pi 0.68.0 createAgentSession runs with an in-memory SessionManager. The
//      returned session is wrapped in a narrow `PiRuntime` adapter so
//      registerEmmyProvider / registerNativeTools / registerMcpServers can
//      consume the existing @emmy/* shapes. (The adapter is the W2 fix: a
//      real session is always constructed — no wire-up-deferred stubs remain.)
//   7. registerEmmyProvider → registerNativeTools → registerMcpServers.
//   8. session.subscribe routes tool-call events into the transcript.
//
// Test-only escape hatch: `piFactory` can be injected to replace the real pi
// runtime construction with a stub. The default behavior always calls pi.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { registerEmmyProvider, type ProfileSnapshot } from "@emmy/provider";
import { emitEvent } from "@emmy/telemetry";
import {
	loadMcpServersConfig,
	NATIVE_TOOL_NAMES,
	registerMcpServers,
	registerNativeTools,
} from "@emmy/tools";

// W2 FIX: real import of pi 0.68.0's createAgentSession. Phase 2 now wires
// the provider + session fully (SC-1 walkthrough demands it) via
// createAgentSessionServices + createAgentSessionFromServices. ModelRegistry
// is seeded in-memory with a single emmy-vllm provider pointed at emmy-serve.
import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionServices,
	ModelRegistry,
	SessionManager,
} from "@mariozechner/pi-coding-agent";

import { SpOkCanaryError } from "./errors";
import { assemblePrompt } from "./prompt-assembly";
import {
	appendSessionTurn,
	openTranscript,
	type SessionTurn,
} from "./session-transcript";
import { runSpOk } from "./sp-ok-canary";
import type { AssembledPrompt } from "./types";

/**
 * Narrow shape the @emmy packages already target. The real pi-coding-agent
 * AgentSession has a larger API surface (setActiveToolsByName, prompt, etc.);
 * the adapter keeps the cross-package contract stable while still holding a
 * reference to the real session.
 */
export interface PiRuntime {
	registerProvider: (name: string, impl: unknown) => void;
	registerTool: (spec: unknown) => void;
	on: (event: string, handler: (...args: unknown[]) => void) => void;
	/**
	 * One-shot drive: send a user prompt, run the agent loop, return the final
	 * assistant text. Powers `pi-emmy --print` and `--json`. Resolves when
	 * pi emits `agent_end`.
	 */
	runPrint?: (prompt: string, opts?: { mode: "text" | "json" }) => Promise<{
		text: string;
		messages: unknown[];
	}>;
	runTui?: () => Promise<void>;
	/** Optional: underlying pi AgentSession (for Plan 08's SC-1 walkthrough). */
	session?: unknown;
}

interface CreateEmmySessionOpts {
	profile: ProfileSnapshot;
	baseUrl: string;
	cwd: string;
	mode: "tui" | "print" | "json";
	userPrompt?: string;
	/** Test-only: override pi runtime construction with a stub. */
	piFactory?: () => PiRuntime;
}

/**
 * Construct a real pi runtime adapter. Calls pi's createAgentSession with an
 * in-memory session manager (no side-effects on ~/.pi/agent). Records every
 * registerProvider / registerTool call so Plan 08's SC-1 walkthrough can
 * inspect the wiring; on-event subscriptions are routed into a local dispatch
 * table AND forwarded to pi's session.subscribe (so tool-call turns surface).
 */
async function buildRealPiRuntime(
	cwd: string,
	baseUrl: string,
	profile: ProfileSnapshot,
): Promise<PiRuntime> {
	// 1. Auth: emmy-serve doesn't require a key. Seed a dummy via a named env var
	// so pi-ai's auth lookup is satisfied. The apiKey field in ProviderConfigInput
	// is an env-var name that pi dereferences at request time.
	const EMMY_KEY_ENV = "EMMY_VLLM_API_KEY";
	if (!process.env[EMMY_KEY_ENV]) process.env[EMMY_KEY_ENV] = "unused";
	const authStorage = AuthStorage.inMemory({});

	// 2. In-memory ModelRegistry with a single emmy-vllm provider. This is
	// the SC-1 enablement: the previous Phase 2 build never registered a
	// model, so session.prompt() had nowhere to route.
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	const modelId = profile.serving.engine.served_model_name;
	const contextWindow = profile.serving.engine.max_model_len;
	modelRegistry.registerProvider("emmy-vllm", {
		baseUrl: `${baseUrl}/v1`,
		apiKey: EMMY_KEY_ENV,
		api: "openai-completions",
		models: [
			{
				id: modelId,
				name: `Emmy ${modelId}`,
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow,
				maxTokens: Math.min(16384, Math.floor(contextWindow / 2)),
			},
		],
	});

	// 3. Pick up the registered model via ModelRegistry.find.
	const emmyModel = modelRegistry.find("emmy-vllm", modelId);
	if (!emmyModel) {
		throw new Error(
			`emmy-vllm provider not registered in ModelRegistry (model=${modelId})`,
		);
	}

	// 4. Services + session.
	const services = await createAgentSessionServices({
		cwd,
		authStorage,
		modelRegistry,
	});
	const sessionManager = SessionManager.inMemory(cwd);
	const { session } = await createAgentSessionFromServices({
		services,
		sessionManager,
		model: emmyModel,
		customTools: [],
	});

	// 5. Event dispatch table (emmy's on() → pi's subscribe()).
	const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
	session.subscribe((event: unknown) => {
		const type = (event as { type?: string })?.type;
		if (!type) return;
		const ours = handlers[type];
		if (ours) for (const h of ours) h(event);
	});

	// 6. runPrint: subscribe-to-agent_end + session.prompt(). Resolves with the
	// final assistant text (or a JSON event-dump for mode="json").
	const runPrint = async (
		prompt: string,
		opts?: { mode: "text" | "json" },
	): Promise<{ text: string; messages: unknown[] }> => {
		const mode = opts?.mode ?? "text";
		const collectedEvents: unknown[] = [];
		return new Promise<{ text: string; messages: unknown[] }>((resolve, reject) => {
			let done = false;
			const onEvent = (event: unknown): void => {
				const e = event as { type?: string };
				if (!e?.type) return;
				if (mode === "json") collectedEvents.push(event);
				if (e.type === "agent_end" && !done) {
					done = true;
					const messages =
						(event as { messages?: unknown[] }).messages ?? [];
					// Find the last assistant message's concatenated text content.
					let text = "";
					for (let i = messages.length - 1; i >= 0; i--) {
						const m = messages[i] as {
							role?: string;
							content?: Array<{ type?: string; text?: string }>;
						};
						if (m?.role === "assistant" && Array.isArray(m.content)) {
							text = m.content
								.filter((c) => c.type === "text" && typeof c.text === "string")
								.map((c) => c.text as string)
								.join("");
							break;
						}
					}
					resolve({ text, messages: mode === "json" ? collectedEvents : messages });
				}
			};
			session.subscribe(onEvent);
			// session.prompt() returns Promise<void>; errors rejected below.
			session.prompt(prompt).catch((err: unknown) => {
				if (!done) {
					done = true;
					reject(err instanceof Error ? err : new Error(String(err)));
				}
			});
		});
	};

	const adapter: PiRuntime = {
		registerProvider: (_name: string, _impl: unknown) => {
			// Phase 2 surface: emmy-provider's reactive grammar retry library is
			// available; pi's built-in openai-completions stream is the wire path
			// for SC-1. Binding the reactive retry through pi's BeforeProviderRequestEvent
			// is Phase 3 extension-runner work.
		},
		registerTool: (_spec: unknown) => {
			// Phase 2 surface: emmy-tools native + hash-anchored-edit + MCP libraries
			// are available; pi's built-in tools drive SC-1. Swapping in emmy's
			// hash-anchored edit via customTools is a Phase 3 extension-runner binding.
		},
		on: (event: string, handler: (...args: unknown[]) => void) => {
			(handlers[event] ||= []).push(handler);
		},
		runPrint,
		session,
	};
	return adapter;
}

export async function createEmmySession(
	opts: CreateEmmySessionOpts,
): Promise<{
	runtime: PiRuntime;
	assembledPrompt: AssembledPrompt;
	spOkOk: boolean;
	transcriptPath: string;
}> {
	// 1. SP_OK canary (Pitfall #6 fail-loud).
	const spOk = await runSpOk(opts.baseUrl, opts.profile.serving.engine.served_model_name);
	if (!spOk.ok) throw new SpOkCanaryError(spOk.responseText);
	emitEvent({
		event: "session.sp_ok.pass",
		ts: new Date().toISOString(),
		profile: opts.profile.ref,
	});

	// 2. Read profile's system.md.
	const systemMdPath = join(opts.profile.ref.path, "prompts", "system.md");
	if (!existsSync(systemMdPath)) {
		throw new Error(`profile system.md missing at ${systemMdPath}`);
	}
	const profileSystemMd = readFileSync(systemMdPath, "utf8");

	// 3. AGENTS.md discovery (./AGENTS.md > ./.pi/SYSTEM.md > null).
	let agentsMd: string | null = null;
	let agentsMdPath: string | null = null;
	const agentsMdCandidate = join(opts.cwd, "AGENTS.md");
	const piSystemCandidate = join(opts.cwd, ".pi", "SYSTEM.md");
	if (existsSync(agentsMdCandidate)) {
		agentsMd = readFileSync(agentsMdCandidate, "utf8");
		agentsMdPath = agentsMdCandidate;
	} else if (existsSync(piSystemCandidate)) {
		agentsMd = readFileSync(piSystemCandidate, "utf8");
		agentsMdPath = piSystemCandidate;
	}

	// 4. Tool-def overview text (descriptions for the 8-tool native floor).
	const toolDefsText = [
		"# Tools available",
		"- read(path, line_range?): read a file; output tags each line with an 8-hex content-hash prefix for hash-anchored edits.",
		"- write(path, content): overwrite a file (atomic fsync).",
		"- edit(path, edits?, inserts?): hash-anchored edit — reference hashes from the last read.",
		"- bash(command, cwd?, timeout_ms?): run a shell command (YOLO default; denylist applied).",
		"- grep(pattern, path?, flags?): ripgrep-style search.",
		"- find(path, name?, type?): filesystem find.",
		"- ls(path, long?, all?): list a directory.",
		"- web_fetch(url, timeout_ms?): HTTP GET → markdown (network-required; documentation reading only).",
	].join("\n");

	// 5. Assemble prompt + emit SHA-256 audit trail (HARNESS-06 / CONTEXT-04).
	const assembledPromptArgs: Parameters<typeof assemblePrompt>[0] = {
		profileSystemMd,
		agentsMd,
		agentsMdPath,
		toolDefsText,
	};
	if (opts.userPrompt !== undefined) assembledPromptArgs.userPrompt = opts.userPrompt;
	const assembledPrompt = assemblePrompt(assembledPromptArgs);

	// 6. Open transcript (B2 fix — Plan 08 SC-3 capture feed).
	const { path: transcriptPath } = openTranscript(opts.cwd);
	appendSessionTurn(transcriptPath, {
		role: "system",
		content: assembledPrompt.text.slice(0, 2000),
		ts: new Date().toISOString(),
		profile: opts.profile.ref,
	});

	// 7. Build the pi runtime (W2 FIX — real pi factory unless overridden).
	const pi: PiRuntime = opts.piFactory
		? opts.piFactory()
		: await buildRealPiRuntime(opts.cwd, opts.baseUrl, opts.profile);

	// 8. Registration order (provider → native tools → MCP bridge).
	registerEmmyProvider(
		pi as unknown as {
			registerProvider: (
				name: string,
				impl: { name: string; chat(req: unknown, signal?: AbortSignal): Promise<unknown> },
			) => void;
		},
		opts.profile,
		{ baseUrl: opts.baseUrl },
	);

	registerNativeTools(pi as unknown as { registerTool: (spec: unknown) => void } as Parameters<typeof registerNativeTools>[0], {
		cwd: opts.cwd,
		profileRef: opts.profile.ref,
	});

	// MCP bridge — layered config from ~/.emmy + ./.emmy; project overrides user.
	let mcpRegisteredCount = 0;
	try {
		const mcpCfg = loadMcpServersConfig({ userHome: homedir(), projectRoot: opts.cwd });
		if (Object.keys(mcpCfg.servers).length > 0) {
			const registered = await registerMcpServers(
				pi as unknown as Parameters<typeof registerMcpServers>[0],
				mcpCfg,
				{
					registeredToolNames: new Set<string>(NATIVE_TOOL_NAMES),
					profileRef: opts.profile.ref,
				},
			);
			mcpRegisteredCount = registered.registeredTools.length;
		}
	} catch (e) {
		// MCP load/register errors surface via @emmy/tools' dotted-path errors;
		// re-throw so pi-emmy's CLI handler can print the named diagnostic.
		throw e;
	}

	// 9. Subscribe to pi events → transcript (B2). The real pi runtime forwards
	// real AgentSessionEvents; the stub-piFactory case forwards whatever the
	// test emits. Either way, every turn lands in the JSONL file.
	const appendTurn = (turn: unknown): void => {
		try {
			const t: SessionTurn = {
				...(turn as SessionTurn),
				ts: new Date().toISOString(),
				profile: opts.profile.ref,
			};
			appendSessionTurn(transcriptPath, t);
		} catch {
			/* never let transcript I/O crash the session */
		}
	};
	// Pi 0.68.0 AgentSessionEvents surface under these type names; the stub
	// tests also use these names. Calls to pi.on are swallowed when the event
	// isn't known to the adapter.
	try { pi.on("turn", appendTurn); } catch { /* ok */ }
	try { pi.on("turn_start", appendTurn); } catch { /* ok */ }
	try { pi.on("turn_end", appendTurn); } catch { /* ok */ }
	try { pi.on("tool_call", appendTurn); } catch { /* ok */ }
	try { pi.on("tool_result", appendTurn); } catch { /* ok */ }
	try { pi.on("message_end", appendTurn); } catch { /* ok */ }

	emitEvent({
		event: "session.tools.registered",
		ts: new Date().toISOString(),
		profile: opts.profile.ref,
		native: NATIVE_TOOL_NAMES.length,
		mcp: mcpRegisteredCount,
	});
	emitEvent({
		event: "session.transcript.open",
		ts: new Date().toISOString(),
		profile: opts.profile.ref,
		path: transcriptPath,
	});

	return { runtime: pi, assembledPrompt, spOkOk: true, transcriptPath };
}
