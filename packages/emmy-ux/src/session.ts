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
//   6. Phase-3 Plan 03-01: buildNativeToolDefs + (optional) buildMcpToolDefs
//      produce the customTools array BEFORE pi's session is constructed — this
//      is the "pi's customTools as the authoritative tool registry" flip.
//   7. pi 0.68.0 createAgentSession runs with an in-memory SessionManager AND
//      the Emmy ExtensionFactory (pi-emmy-extension) installed via
//      resourceLoaderOptions.extensionFactories. The extension installs the
//      before_provider_request hook that injects enable_thinking:false,
//      reactive-grammar retry state, and the Emmy 3-layer system prompt on
//      every wire request (D-02a/b/c + D-04 atomic wave).
//   8. The returned session is wrapped in a narrow `PiRuntime` adapter so
//      legacy callers keep working. The adapter also exposes an `introspect()`
//      method for Plan 03-01's wire-through regression tests.
//   9. session.subscribe routes tool-call events into the transcript.
//
// Test-only escape hatch: `piFactory` can be injected to replace the real pi
// runtime construction with a stub. The default behavior always calls pi.
//
// Phase-3 wire-through flips landed atomically in Plan 03-01:
//   (1) @emmy/provider → pi's ModelRegistry.registerProvider (already Phase-2)
//   (2) @emmy/tools 8 native + MCP → createAgentSessionFromServices({customTools})
//   (3) Emmy 3-layer prompt authoritative via before_provider_request mutation
//   (4) chat_template_kwargs.enable_thinking:false at request level (REMOVED
//       the a17f4a9 <think>-strip render-time stopgap; see 02-CLOSEOUT §SC-1)
//   (5) Reactive XGrammar retry (Phase 2 D-11) fires on the live pi-session
//       path via before_provider_request + WeakMap<AbortSignal, RetryState>.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { registerEmmyProvider, type ProfileSnapshot } from "@emmy/provider";
import { emitEvent } from "@emmy/telemetry";
import {
	buildMcpToolDefs,
	buildNativeToolDefs,
	loadMcpServersConfig,
	NATIVE_TOOL_NAMES,
	registerMcpServers,
	registerNativeTools,
	type ToolDefinitionLike,
} from "@emmy/tools";

// W2 FIX (Phase 2): real import of pi 0.68.0's createAgentSession. Phase 2
// wires the provider + session fully (SC-1 walkthrough demands it) via
// createAgentSessionServices + createAgentSessionFromServices. ModelRegistry
// is seeded in-memory with a single emmy-vllm provider pointed at emmy-serve.
// Plan 03-01 adds the Emmy ExtensionFactory at session-services construction
// time so every chat call routes through our before_provider_request mutator.
import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionServices,
	ModelRegistry,
	SessionManager,
} from "@mariozechner/pi-coding-agent";

import { SpOkCanaryError } from "./errors";
import { createEmmyExtension } from "./pi-emmy-extension";
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
 *
 * Plan 03-01 adds `introspect()` so Wave-1 wire-through regression tests can
 * assert which providers and customTools the adapter surfaced without having
 * to call out to pi's internal state.
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
	/**
	 * Plan 03-01: wire-through regression introspection. Returns a snapshot of
	 * the providers + customTools this adapter registered during session boot.
	 * The shape is deliberately narrow — tests assert on `.length`,
	 * `.name`, and `impl.chat` only.
	 */
	introspect?: () => {
		registeredProviders: Array<{ name: string; impl: unknown }>;
		registeredCustomTools: Array<{ name: string }>;
	};
}

interface CreateEmmySessionOpts {
	profile: ProfileSnapshot;
	baseUrl: string;
	cwd: string;
	mode: "tui" | "print" | "json";
	userPrompt?: string;
	/**
	 * Test-only: override pi runtime construction with a stub. Receives the
	 * already-built customTools array so stubs can mirror the real adapter's
	 * `introspect()` surface without having to replicate native-tool + MCP
	 * assembly logic. Plan 03-01: customTools arg is the single source of
	 * truth consumed by both real and stub paths.
	 */
	piFactory?: (args: { customTools: ToolDefinitionLike[] }) => PiRuntime;
}

/**
 * Construct a real pi runtime adapter. Calls pi's createAgentSession with an
 * in-memory session manager (no side-effects on ~/.pi/agent). Records every
 * registerProvider / registerTool call so Plan 08's SC-1 walkthrough can
 * inspect the wiring; on-event subscriptions are routed into a local dispatch
 * table AND forwarded to pi's session.subscribe (so tool-call turns surface).
 *
 * Plan 03-01 additions:
 *   - customTools array is assembled from buildNativeToolDefs + buildMcpToolDefs
 *     and passed to createAgentSessionFromServices.
 *   - The Emmy ExtensionFactory is passed via resourceLoaderOptions so the
 *     before_provider_request hook is installed on every chat call.
 *   - The adapter's registerProvider + registerTool record entries (no-op
 *     body → introspectable collector body) so Wave-1 regression tests can
 *     verify the wire-through landed.
 *   - The a17f4a9 <think>-strip stopgap (was at lines 198-207) is REMOVED;
 *     proper fix via chat_template_kwargs.enable_thinking:false lives in the
 *     before_provider_request hook (see 02-CLOSEOUT.md § SC-1 findings).
 */
async function buildRealPiRuntime(
	cwd: string,
	baseUrl: string,
	profile: ProfileSnapshot,
	customTools: ToolDefinitionLike[],
	assembledPromptProvider: () => { text: string; sha256: string },
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

	// 4. Services — Plan 03-01: install the Emmy ExtensionFactory here so pi's
	// before_provider_request hook is authoritative on every wire request.
	const emmyExtension = createEmmyExtension({
		profile,
		assembledPromptProvider,
	});
	const services = await createAgentSessionServices({
		cwd,
		authStorage,
		modelRegistry,
		resourceLoaderOptions: {
			extensionFactories: [emmyExtension],
			// Phase 3 keeps pi's on-disk extension discovery disabled by default
			// — Emmy owns the extension surface via the factory passed above.
			// Future plans may flip this back on (Plan 03-05 input handler, etc.).
			noExtensions: false,
		},
	});
	const sessionManager = SessionManager.inMemory(cwd);
	// 5. Session — with the Phase-3 customTools flip landed.
	const { session } = await createAgentSessionFromServices({
		services,
		sessionManager,
		model: emmyModel,
		customTools: customTools as unknown as Parameters<
			typeof createAgentSessionFromServices
		>[0]["customTools"],
	});

	// 6. Event dispatch table (emmy's on() → pi's subscribe()).
	const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
	session.subscribe((event: unknown) => {
		const type = (event as { type?: string })?.type;
		if (!type) return;
		const ours = handlers[type];
		if (ours) for (const h of ours) h(event);
	});

	// 7. runPrint: subscribe-to-agent_end + session.prompt(). Resolves with the
	// final assistant text (or a JSON event-dump for mode="json").
	//
	// Plan 03-01 NOTE: the a17f4a9 <think>-strip render-time regex has been
	// REMOVED. The proper fix is chat_template_kwargs.enable_thinking:false
	// injected by the before_provider_request hook (see pi-emmy-extension.ts +
	// packages/emmy-provider/src/before-request-hook.ts). The model never emits
	// <think> blocks on a live Phase-3 wire path; render-time stripping is no
	// longer required and would mask future regressions.
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

	// 8. Build the adapter. Plan 03-01 flips registerProvider + registerTool
	// from NO-OP to introspectable collectors so wire-through regression tests
	// can verify the Wave-1 work landed.
	const _registeredProviders: Array<{ name: string; impl: unknown }> = [];
	const _registeredCustomTools: Array<{ name: string }> = customTools.map((t) => ({ name: t.name }));
	const adapter: PiRuntime = {
		registerProvider: (name: string, impl: unknown) => {
			_registeredProviders.push({ name, impl });
		},
		registerTool: (_spec: unknown) => {
			// The authoritative tool surface is customTools (passed above).
			// Calls to registerTool via the legacy PiRuntime path are observed
			// but do NOT duplicate into customTools — they would shadow and
			// create a split-brain between pi's baseToolDefinitions and our
			// customTools array (D-01 anti-pattern).
		},
		on: (event: string, handler: (...args: unknown[]) => void) => {
			(handlers[event] ||= []).push(handler);
		},
		runPrint,
		session,
		introspect: () => ({
			registeredProviders: _registeredProviders.slice(),
			registeredCustomTools: _registeredCustomTools.slice(),
		}),
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
	//
	// CRITICAL: this fires via @emmy/provider's raw postChat path — it MUST
	// run BEFORE buildRealPiRuntime is called, so the canary request never
	// routes through pi's before_provider_request hook (which would overwrite
	// the canary's deliberately-terse system prompt with Emmy's 3-layer
	// assembled prompt). RESEARCH Pitfall #7 / 03-CONTEXT T-03-01-02 guard.
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

	// 7. Phase-3 Plan 03-01: build customTools BEFORE pi session is constructed.
	//    - native: buildNativeToolDefs returns the 8 native tools as pi
	//      ToolDefinition-shaped objects (label/description/parameters/execute).
	//    - MCP: only invoked if ~/.emmy or ./.emmy has a non-empty config. The
	//      D-18 poison gate is re-asserted inside buildMcpToolDefs (regression
	//      test: packages/emmy-ux/test/session.mcp-poison.test.ts).
	const nativeTools: ToolDefinitionLike[] = buildNativeToolDefs({
		cwd: opts.cwd,
		profileRef: opts.profile.ref,
	});
	const registeredToolNames = new Set<string>(NATIVE_TOOL_NAMES);
	let mcpTools: ToolDefinitionLike[] = [];
	let mcpRegisteredCount = 0;
	let mcpSpawnedForTeardown: Array<{ name: string; pid: number; kill: () => void }> = [];
	try {
		const mcpCfg = loadMcpServersConfig({ userHome: homedir(), projectRoot: opts.cwd });
		if (Object.keys(mcpCfg.servers).length > 0) {
			const res = await buildMcpToolDefs(mcpCfg, {
				registeredToolNames,
				profileRef: opts.profile.ref,
			});
			mcpTools = res.tools;
			mcpRegisteredCount = res.registeredCount;
			mcpSpawnedForTeardown = res.spawned;
		}
	} catch (e) {
		// MCP load/register errors surface via @emmy/tools' dotted-path errors;
		// re-throw so pi-emmy's CLI handler can print the named diagnostic.
		throw e;
	}
	const customTools: ToolDefinitionLike[] = [...nativeTools, ...mcpTools];

	// 8. Build the pi runtime (W2 FIX — real pi factory unless overridden).
	//    Phase-3 wire: customTools are passed through so pi's AgentSession
	//    uses them at creation time. Extension factory installs
	//    before_provider_request hook (see pi-emmy-extension.ts).
	const pi: PiRuntime = opts.piFactory
		? opts.piFactory({ customTools })
		: await buildRealPiRuntime(
				opts.cwd,
				opts.baseUrl,
				opts.profile,
				customTools,
				() => ({ text: assembledPrompt.text, sha256: assembledPrompt.sha256 }),
		  );

	// 9. Pi-layer provider + legacy tool registrations. For the real adapter
	// these append to introspection arrays; for the stub piFactory the stub
	// decides what to do (the test-only path).
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

	// Legacy registerNativeTools — still called for stub-piFactory paths and
	// for introspection side effects. The live customTools path above is the
	// authoritative tool registry; this call is a no-op on the real adapter
	// (adapter.registerTool body is a no-op by design, per D-01 no-split-brain).
	registerNativeTools(
		pi as unknown as { registerTool: (spec: unknown) => void } as Parameters<typeof registerNativeTools>[0],
		{
			cwd: opts.cwd,
			profileRef: opts.profile.ref,
		},
	);

	// For stub-piFactory tests that do NOT exercise buildMcpToolDefs (Phase 2's
	// session.test.ts still uses registerMcpServers — unchanged), the legacy
	// bridge stays functional. The stub factory dispatches `registerTool`
	// calls; the real adapter's registerTool is a no-op (customTools path
	// above is authoritative).
	if (!opts.piFactory) {
		// Real adapter already has customTools; skip legacy registerMcpServers.
		// Teardown: if MCP spawned anything, its kill() hooks live in
		// mcpSpawnedForTeardown; Plan 03-04 adds shutdown wiring.
		void mcpSpawnedForTeardown;
	} else {
		// Stub path — exercise the legacy registerMcpServers for Phase 2 test
		// compatibility (these tests pass a mock pi that records calls).
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
			throw e;
		}
	}

	// 10. Subscribe to pi events → transcript (B2). The real pi runtime
	// forwards real AgentSessionEvents; the stub-piFactory case forwards
	// whatever the test emits. Either way, every turn lands in the JSONL file.
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
