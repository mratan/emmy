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

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { registerEmmyProvider, type ProfileSnapshot } from "@emmy/provider";
import {
	emitEvent,
	type EmmyToolRegistration,
} from "@emmy/telemetry";
import {
	applyMemorySnapshot,
	type ApplyMemorySnapshotResult,
	buildMcpToolDefs,
	buildMemoryTelemetryHook,
	buildMemoryTool,
	buildNativeToolDefs,
	getOrCreateDefaultStore,
	loadMcpServersConfig,
	MemoryTelemetryCounters,
	NATIVE_TOOL_NAMES,
	registerMcpServers,
	registerNativeTools,
	resolveMemoryConfig,
	revertMemorySnapshot,
	type MemoryConfig,
	type RecentSearchUrlStore,
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
	createAgentSessionRuntime,
	createAgentSessionServices,
	InteractiveMode,
	ModelRegistry,
	SessionManager,
	type CreateAgentSessionRuntimeFactory,
} from "@mariozechner/pi-coding-agent";

import { SpOkCanaryError } from "./errors";
import {
	flipToGreen,
	flipToViolation,
	flipToYellow,
	renderBadgePlain,
	runBootOfflineAudit,
	setInitialAudit,
} from "./offline-badge";
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
	/** Plan 04.4-05: --no-memory disables memory tool registration. */
	noMemory?: boolean;
	/** Plan 04.4-05: --memory-snapshot DIR mirrors DIR/{project,global} into
	 *  live memory roots before the session and reverts after.  Used by eval
	 *  workers; D-3X invariant unaffected (the prefix doesn't reference memory). */
	memorySnapshot?: string;
	/**
	 * Plan 03-05: emmy-owned session identifier propagated into the turn_id
	 * scheme `${sessionId}:${turnIndex}`. pi-emmy.ts computes this as
	 * `<ISO8601-with-dashes>-<profile-hash-8hex>` and passes it through.
	 * Omitted in tests that don't exercise rating capture.
	 */
	sessionId?: string;
	/**
	 * Plan 03-05: mirrors @emmy/telemetry's resolveTelemetryEnabled. When
	 * false, the pi.on("input") Alt+Up/Down intercept is skipped and no
	 * turn_end tracker is populated.
	 */
	telemetryEnabled?: boolean;
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
	sessionId: string | undefined,
	telemetryEnabled: boolean,
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
	// Plan 03-04 (UX-02): pass baseUrl so the extension can start a 1 Hz
	// footer poller on session_start (scrapes vLLM /metrics + nvidia-smi).
	const emmyExtensionOpts: Parameters<typeof createEmmyExtension>[0] = {
		profile,
		assembledPromptProvider,
		baseUrl,
		telemetryEnabled,
	};
	if (sessionId !== undefined) emmyExtensionOpts.sessionId = sessionId;
	const emmyExtension = createEmmyExtension(emmyExtensionOpts);
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

/**
 * Plan 03-08 — pi 0.68 interactive TUI wire-through.
 *
 * Graduates from the --print-path's `createAgentSessionFromServices` (SDK
 * path Plan 02-04 chose) to pi's full `createAgentSessionRuntime` + binds
 * the resulting runtime to `new InteractiveMode(runtime).run()`. Same
 * customTools + ExtensionFactory + AuthStorage + ModelRegistry wiring as
 * buildRealPiRuntime (above) — divergence is the final factory shape, not
 * the inputs. Plan 03-08 deliberately keeps buildRealPiRuntime untouched
 * for --print because Plan 03-07 certified it at phase close.
 *
 * T-03-08-06: agentDir under `~/.emmy/agent` (emmy-scoped) — NOT
 * `~/.pi/agent` (pi-scoped) — so pi's settings writer stays inside emmy's
 * namespace. Path is autocreated via `ensureEmmyAgentDir()` before the
 * createAgentSessionRuntime call so pi's first-run session directory
 * bootstrap doesn't fail with ENOENT.
 *
 * Every Phase-3 extension binding carries through the factory's
 * resourceLoaderOptions.extensionFactories — IDENTICAL args to the --print
 * path (session.ts:236-247). Plan 03-08 Task 1 tests assert this contract.
 */
async function buildRealPiRuntimeTui(
	cwd: string,
	baseUrl: string,
	profile: ProfileSnapshot,
	customTools: ToolDefinitionLike[],
	assembledPromptProvider: () => { text: string; sha256: string },
	sessionId: string | undefined,
	telemetryEnabled: boolean,
): Promise<PiRuntime> {
	// 1. Auth + ModelRegistry — IDENTICAL to buildRealPiRuntime.
	const EMMY_KEY_ENV = "EMMY_VLLM_API_KEY";
	if (!process.env[EMMY_KEY_ENV]) process.env[EMMY_KEY_ENV] = "unused";
	const authStorage = AuthStorage.inMemory({});
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
	const emmyModel = modelRegistry.find("emmy-vllm", modelId);
	if (!emmyModel) {
		throw new Error(
			`emmy-vllm provider not registered in ModelRegistry (model=${modelId})`,
		);
	}

	// 2. Emmy ExtensionFactory — IDENTICAL to buildRealPiRuntime. Plumbs
	// sessionId + telemetryEnabled through so Plan 03-05 Alt+Up/Down capture
	// works on the TUI path and Plan 03-02 EMMY_TELEMETRY=off kill-switch is
	// honored. baseUrl enables Plan 03-04 footer poller on session_start.
	// profileDir + profilesRoot gate the Plan 04-03 /profile slash command
	// registration at pi-emmy-extension.ts:721 (absence signals --print mode
	// where atomic swap makes no sense). profilesRoot is derived from the
	// loaded bundle (profiles/<name>/<version>/ → ../../) rather than the
	// cwd-relative default so `pi-emmy` works from any directory.
	const profilesRoot = dirname(dirname(profile.ref.path));
	const emmyExtensionOpts: Parameters<typeof createEmmyExtension>[0] = {
		profile,
		assembledPromptProvider,
		baseUrl,
		telemetryEnabled,
		profileDir: profile.ref.path,
		profilesRoot,
	};
	if (sessionId !== undefined) emmyExtensionOpts.sessionId = sessionId;
	const emmyExtension = createEmmyExtension(emmyExtensionOpts);

	// 3. SessionManager — in-memory, same as --print.
	const sessionManager = SessionManager.inMemory(cwd);

	// 4. agentDir — emmy-scoped to keep air-gap discipline + avoid pi's
	// global ~/.pi/agent namespace (T-03-08-06).
	const agentDir = ensureEmmyAgentDir();

	// 5. CreateAgentSessionRuntimeFactory closure (pi's main.js 404-483 shape).
	// pi passes {cwd, agentDir, sessionManager, sessionStartEvent?} — we
	// close over authStorage + modelRegistry + emmyExtension + customTools.
	const createRuntime: CreateAgentSessionRuntimeFactory = async ({
		cwd: rtCwd,
		agentDir: rtAgentDir,
		sessionManager: rtSm,
		sessionStartEvent,
	}) => {
		const services = await createAgentSessionServices({
			cwd: rtCwd,
			agentDir: rtAgentDir,
			authStorage,
			modelRegistry,
			resourceLoaderOptions: {
				extensionFactories: [emmyExtension],
				noExtensions: false,
			},
		});
		const fromServicesArgs: Parameters<typeof createAgentSessionFromServices>[0] = {
			services,
			sessionManager: rtSm,
			model: emmyModel,
			customTools: customTools as unknown as Parameters<
				typeof createAgentSessionFromServices
			>[0]["customTools"],
		};
		if (sessionStartEvent)
			(fromServicesArgs as { sessionStartEvent?: unknown }).sessionStartEvent = sessionStartEvent;
		const created = await createAgentSessionFromServices(fromServicesArgs);
		return {
			...created,
			services,
			diagnostics:
				(services as unknown as { diagnostics?: unknown[] }).diagnostics ?? [],
		} as Awaited<ReturnType<CreateAgentSessionRuntimeFactory>>;
	};

	// 6. Build the runtime via pi's SDK factory — this is the graduation
	// from Plan 02-04's SDK-only path to the full runtime.
	const agentSessionRuntime = await createAgentSessionRuntime(createRuntime, {
		cwd,
		agentDir,
		sessionManager,
	});

	// 7. Local handler dispatch table for emmy-side on(...) listeners
	// (transcript wiring in createEmmySession subscribes to turn/tool_call/
	// etc. via this). The real pi ExtensionAPI events flow through the
	// emmyExtension → pi.on(...) path inside the runtime; the adapter's on()
	// is a secondary observation point kept for contract-compatibility.
	const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
	const sessionObj = agentSessionRuntime.session as unknown as {
		subscribe: (h: (event: unknown) => void) => void;
	};
	if (sessionObj && typeof sessionObj.subscribe === "function") {
		sessionObj.subscribe((event: unknown) => {
			const type = (event as { type?: string })?.type;
			if (!type) return;
			const ours = handlers[type];
			if (ours) for (const h of ours) h(event);
		});
	}

	const _registeredCustomTools: Array<{ name: string }> = customTools.map((t) => ({
		name: t.name,
	}));
	const _registeredProviders: Array<{ name: string; impl: unknown }> = [];

	const adapter: PiRuntime = {
		registerProvider: (name: string, impl: unknown) => {
			// Kept introspectable for wire-through regression tests; the
			// authoritative provider seed happened above in modelRegistry.
			_registeredProviders.push({ name, impl });
		},
		registerTool: () => {
			// customTools path is authoritative (D-01 no-split-brain); calls
			// via the legacy PiRuntime path are observed but do NOT duplicate
			// into the tool registry.
		},
		on: (event, handler) => {
			(handlers[event] ||= []).push(handler);
		},
		session: agentSessionRuntime.session,
		runTui: async () => {
			// Bind pi's InteractiveMode to the runtime and run the TUI main
			// loop. Resolves when the user quits (Ctrl-C / Ctrl-D / /quit).
			// verbose:false preserves emmy's own stderr boot banner.
			const interactiveMode = new InteractiveMode(agentSessionRuntime, {
				verbose: false,
			});
			await interactiveMode.run();
		},
		introspect: () => ({
			registeredProviders: _registeredProviders.slice(),
			registeredCustomTools: _registeredCustomTools.slice(),
		}),
	};
	return adapter;
}

/**
 * Resolve the SearxNG base URL with documented precedence:
 *   1. EMMY_SEARXNG_URL env var (Plan 04.2-05 — remote-client escape hatch)
 *   2. profile.harness.tools.web_search.base_url (per-profile config)
 *   3. literal loopback default "http://127.0.0.1:8888" (D-33 LOCKED)
 *
 * Phase 04.2 follow-up — Plan 04.2-05 added the env getter inside
 * web-search.ts but session.ts was passing the profile URL explicitly,
 * shadowing the env override on the live call path. The env var only fired
 * when the profile config was missing entirely (never the case in v1+
 * profiles). This helper makes the precedence work in BOTH the prompt-
 * layer description text the model reads AND the runtime URL the call
 * actually hits — so Mac client and local Spark agree on the URL.
 *
 * Exported for unit tests (precedence assertions live in
 * test/session-resolveSearxngBaseUrl.test.ts).
 */
export function resolveSearxngBaseUrl(profileBaseUrl: string | undefined): string {
	return process.env.EMMY_SEARXNG_URL ?? profileBaseUrl ?? "http://127.0.0.1:8888";
}

/**
 * Ensure `~/.emmy/agent/` exists (T-03-08-06 air-gap discipline).
 * Creates the directory tree if absent; no-op if present. Returns the
 * absolute path that pi 0.68's AgentSessionRuntime will write settings /
 * session-state into.
 */
function ensureEmmyAgentDir(): string {
	const dir = join(homedir(), ".emmy", "agent");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

export async function createEmmySession(
	opts: CreateEmmySessionOpts,
): Promise<{
	runtime: PiRuntime;
	assembledPrompt: AssembledPrompt;
	spOkOk: boolean;
	spOkSkipped: boolean;
	transcriptPath: string;
}> {
	// 1. SP_OK canary (Pitfall #6 fail-loud).
	//
	// CRITICAL: this fires via @emmy/provider's raw postChat path — it MUST
	// run BEFORE buildRealPiRuntime is called, so the canary request never
	// routes through pi's before_provider_request hook (which would overwrite
	// the canary's deliberately-terse system prompt with Emmy's 3-layer
	// assembled prompt). RESEARCH Pitfall #7 / 03-CONTEXT T-03-01-02 guard.
	//
	// Phase 04.2 follow-up — SKIP when remote-client mode is on AND the
	// sidecar reports vllm_up=false. The canary's purpose is to detect SP_OK
	// system-prompt delivery breakage (Pitfall #6), NOT to verify vLLM is
	// alive (the prereq probe upstream owns that check now). Running the
	// canary against a dead vLLM produces a misleading
	// "ERROR (runtime): provider.network 502" instead of letting the operator
	// into the TUI to /start vLLM through the sidecar. Skip with a loud
	// SKIPPED log + telemetry event so future first-prompt SP_OK breakage
	// (if any) still surfaces — the canary is one of two SP_OK guards (the
	// other is per-benchmark-loop in eval/), this one is just session-boot.
	let spOkSkipped = false;
	if (process.env.EMMY_REMOTE_CLIENT === "1") {
		const sidecarUrl = process.env.EMMY_SERVE_URL;
		if (sidecarUrl && sidecarUrl.length > 0) {
			try {
				const statusResp = await fetch(
					`${sidecarUrl.replace(/\/$/, "")}/status`,
					{ signal: AbortSignal.timeout(3000) },
				);
				if (statusResp.ok) {
					const status = (await statusResp.json()) as { vllm_up?: boolean };
					if (status.vllm_up === false) {
						spOkSkipped = true;
						console.error(
							`pi-emmy SP_OK canary: SKIPPED (remote-client mode + sidecar reports vllm_up=false; ` +
								`run /start <profile>[@<variant>] from the TUI to bring vLLM up)`,
						);
						emitEvent({
							event: "session.sp_ok.skipped",
							ts: new Date().toISOString(),
							profile: opts.profile.ref,
							reason: "remote_client_vllm_down",
						});
					}
				}
			} catch {
				// Sidecar unreachable for /status — fall through to canary which
				// will surface the real network error. Don't mask sidecar issues.
			}
		}
	}

	if (!spOkSkipped) {
		const spOk = await runSpOk(opts.baseUrl, opts.profile.serving.engine.served_model_name);
		if (!spOk.ok) throw new SpOkCanaryError(spOk.responseText);
		emitEvent({
			event: "session.sp_ok.pass",
			ts: new Date().toISOString(),
			profile: opts.profile.ref,
		});
	}
	// Plan 03-02: first event in the session carries the session-scope
	// metadata so downstream JSONL readers + Langfuse traces have a
	// self-describing header row.
	emitEvent({
		event: "session.start",
		ts: new Date().toISOString(),
		profile: opts.profile.ref,
		cwd: opts.cwd,
		mode: opts.mode,
		base_url: opts.baseUrl,
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

	// 4. Tool-def overview text (descriptions for the native tool floor).
	// Phase 3.1 D-34: conditionally append web_search when the profile enables
	// it + kill-switches are off, so the model actually knows the tool exists.
	// (buildNativeToolDefs registers the pi ToolSpec; the system-prompt layer
	// here is the user-facing description the LLM reads.)
	const toolDefLines = [
		"# Tools available",
		"- read(path, line_range?): read a file; output tags each line with an 8-hex content-hash prefix for hash-anchored edits.",
		"- write(path, content): overwrite a file (atomic fsync).",
		"- edit(path, edits?, inserts?): hash-anchored edit — reference hashes from the last read.",
		"- bash(command, cwd?, timeout_ms?): run a shell command (YOLO default; denylist applied).",
		"- grep(pattern, path?, flags?): ripgrep-style search.",
		"- find(path, name?, type?): filesystem find.",
		"- ls(path, long?, all?): list a directory.",
		"- web_fetch(url, timeout_ms?): HTTP GET → markdown. Output capped at ~40K chars (~10K tokens) with head+tail truncation — for research, prefer reading web_search snippets directly; only web_fetch when you need structured content a snippet can't convey. Gated by per-profile allowlist PLUS recent-web_search-URL bypass.",
	];
	// Phase 3.1 D-34: check the profile directly (webSearchConfig is derived later
	// at the buildNativeToolDefs call site, but for the prompt layer we inspect
	// the raw profile block so the declaration order stays intact).
	const _ws = (opts.profile.harness.tools as { web_search?: { enabled?: boolean; base_url?: string } }).web_search;
	const webSearchActiveInPrompt =
		_ws?.enabled === true &&
		process.env.EMMY_WEB_SEARCH !== "off" &&
		process.env.EMMY_TELEMETRY !== "off";
	if (webSearchActiveInPrompt) {
		toolDefLines.push(
			"- web_search(query, max_results?): search the open web via local SearxNG at " +
				resolveSearxngBaseUrl(_ws?.base_url) +
				". Returns {title, url, snippet, engine}[] with upstream-engine fallback. Use before web_fetch to look up current info / latest versions / docs.",
		);
	}
	const toolDefsText = toolDefLines.join("\n");

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
	// Plan 03-06 (UX-03 / D-26 + D-27): extract the web_fetch allowlist from
	// the profile harness block (Phase-2 v2 has no such block → empty array →
	// default-deny). The onViolation callback flips the module-level badge
	// state to red; if the pi extension has already bound ctx (Plan 03-01
	// session_start), the flip renders immediately; otherwise it replays on
	// the next bindBadge call.
	const webFetchAllowlist: readonly string[] =
		opts.profile.harness.tools.web_fetch?.allowlist ?? [];
	const webFetchOnViolation = (details: { url: string; hostname: string }): void => {
		flipToViolation("web_fetch", details.hostname);
		// Stderr reminder so the allowlist block is visible outside the TUI
		// (e.g. pi-emmy --print / --json) where ctx.ui.setStatus is a no-op.
		// Plan 03-06 SC-5 UAT criterion: "the denied-call must print a
		// stderr reminder noting the allowlist block."
		const RED = "\x1b[31m";
		const RESET = "\x1b[0m";
		process.stderr.write(
			`${RED}[emmy] NETWORK USED (web_fetch → ${details.hostname}) — blocked by profile allowlist${RESET}\n`,
		);
	};

	// Plan 03.1-02 D-35 — recent-search URL bypass store (shared singleton).
	// TTL from profile's tools.web_fetch.search_bypass_ttl_ms (defaults to
	// 5 min if the profile's block omits it — pydantic Optional[int]=300000).
	const searchBypassTtlMs: number =
		(opts.profile.harness.tools.web_fetch as { search_bypass_ttl_ms?: number } | undefined)
			?.search_bypass_ttl_ms ?? 300000;
	const recentSearchUrls: RecentSearchUrlStore = getOrCreateDefaultStore(searchBypassTtlMs);

	// Plan 03.1-02 D-34 — web_search config from profile.harness.tools.web_search.
	// When absent OR enabled=false, the tool is NOT registered. Env kill-switches
	// (EMMY_WEB_SEARCH=off, EMMY_TELEMETRY=off) are honored inside
	// registerWebSearchTool — absent from the check here.
	interface WebSearchProfileBlock {
		enabled?: boolean;
		base_url?: string;
		max_results_default?: number;
		rate_limit_per_turn?: number;
		timeout_ms?: number;
	}
	const webSearchProfile =
		(opts.profile.harness.tools as { web_search?: WebSearchProfileBlock }).web_search;
	const webSearchConfig = webSearchProfile
		? {
				baseUrl: resolveSearxngBaseUrl(webSearchProfile.base_url),
				maxResultsDefault: webSearchProfile.max_results_default ?? 10,
				rateLimitPerTurn: webSearchProfile.rate_limit_per_turn ?? 10,
				timeoutMs: webSearchProfile.timeout_ms ?? 10000,
		  }
		: undefined;
	const webSearchEnabled = webSearchProfile?.enabled === true;

	// D-36 — badge transitions. On first successful web_search, flip yellow;
	// on any fallback (searxng unreachable), flip green.
	const webSearchOnSuccess = (): void => {
		flipToYellow("searxng responded healthy");
	};
	const webSearchOnFallback = (reason: string): void => {
		flipToGreen(reason);
	};

	const nativeToolOpts: Parameters<typeof buildNativeToolDefs>[0] = {
		cwd: opts.cwd,
		profileRef: opts.profile.ref,
		webFetchAllowlist,
		webFetchOnViolation,
		recentSearchUrls,
	};
	if (webSearchConfig) nativeToolOpts.webSearchConfig = webSearchConfig;
	if (webSearchEnabled) nativeToolOpts.webSearchEnabled = true;
	nativeToolOpts.webSearchOnSuccess = webSearchOnSuccess;
	nativeToolOpts.webSearchOnFallback = webSearchOnFallback;

	const nativeTools: ToolDefinitionLike[] = buildNativeToolDefs(nativeToolOpts);
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
	// Plan 04.4-05 — resolve memory config with precedence env > profile > flag.
	// The pre-existing harness type doesn't expose context.memory; defensive
	// unknown-cast (pattern matched from compaction config readMaxInputTokens).
	// Memory tool registers ONLY when the profile explicitly declares the
	// memory: block — same convention as web_search. Profiles WITHOUT the block
	// (older bundles, test fixtures) skip registration cleanly.
	const profileMemory = (
		opts.profile.harness as unknown as {
			context?: { memory?: MemoryConfig };
		}
	).context?.memory;
	const memoryConfigured = profileMemory !== undefined;
	const resolvedMemoryConfig = resolveMemoryConfig({
		profileMemory,
		noMemory: opts.noMemory ?? false,
	});

	// Plan 04.4-05 — apply memory snapshot if --memory-snapshot supplied.
	let memorySnapshotHandle: ApplyMemorySnapshotResult | null = null;
	if (
		opts.memorySnapshot !== undefined &&
		resolvedMemoryConfig.enabled
	) {
		const projDir = join(opts.memorySnapshot, "project");
		const globDir = join(opts.memorySnapshot, "global");
		memorySnapshotHandle = applyMemorySnapshot({
			projectSnapshotDir: existsSync(projDir) ? projDir : undefined,
			globalSnapshotDir: existsSync(globDir) ? globDir : undefined,
			resolvedConfig: resolvedMemoryConfig,
			cwd: opts.cwd,
			home: homedir(),
		});
	}

	// Plan 04.4-05 — build memory tool ONLY if profile declares the block AND
	// resolvedMemoryConfig.enabled is true. Plan 04.4-04 telemetry hook routes
	// ops through emitEvent (auto-stamped by EmmyProfileStampProcessor).
	const memoryCounters = new MemoryTelemetryCounters();
	const memoryTools: ToolDefinitionLike[] =
		memoryConfigured && resolvedMemoryConfig.enabled
		? [
				buildMemoryTool({
					config: resolvedMemoryConfig,
					cwd: opts.cwd,
					onOp: buildMemoryTelemetryHook({
						emitEvent: (rec) => emitEvent(rec),
						counters: memoryCounters,
						blockedExtensions:
							resolvedMemoryConfig.blocked_extensions,
					}),
				}) as unknown as ToolDefinitionLike,
			]
		: [];

	const customTools: ToolDefinitionLike[] = [
		...nativeTools,
		...mcpTools,
		...memoryTools,
	];

	// 7b. Plan 03-06 (UX-03): boot-time offline audit (D-26). Runs AFTER
	// native + MCP tool defs are assembled so the audit sees the full
	// registered set. Pure-local tools (all 8 native + stdio-only MCP per
	// Phase 2 D-15) declare required_hosts=[]; web_fetch's dynamic hosts
	// are gated at call time by enforceWebFetchAllowlist (D-27). Result
	// drives:
	//   - Stderr [emmy] OFFLINE OK/NETWORK USED banner
	//   - setInitialAudit → module-level badge state (rendered when pi
	//     extension binds ctx on session_start)
	//   - emitEvent("session.offline_audit.complete") for Langfuse + JSONL
	const toolRegistrations: EmmyToolRegistration[] = [
		...NATIVE_TOOL_NAMES.map((name) => ({ name, required_hosts: [] as string[] })),
		// MCP tools are stdio-only per Phase 2 D-15 — they declare no
		// required_hosts. If a future profile binds MCP to HTTP transport,
		// buildMcpToolDefs would surface the required_hosts here.
		...mcpTools.map((t) => ({ name: t.name, required_hosts: [] as string[] })),
	];
	const auditResult = runBootOfflineAudit({
		toolRegistrations,
		allowlist: webFetchAllowlist,
	});
	setInitialAudit(auditResult);
	emitEvent({
		event: "session.offline_audit.complete",
		ts: new Date().toISOString(),
		profile: opts.profile.ref,
		offline_ok: auditResult.offline_ok,
		violating_tool: auditResult.violating_tool,
		violating_host: auditResult.violating_host,
		allowlist_size: webFetchAllowlist.length,
		plain_banner: renderBadgePlain(auditResult),
	});

	// 8. Build the pi runtime (W2 FIX — real pi factory unless overridden).
	//    Phase-3 wire: customTools are passed through so pi's AgentSession
	//    uses them at creation time. Extension factory installs
	//    before_provider_request hook (see pi-emmy-extension.ts).
	//
	//    Plan 03-08 (SC-3-TUI-WIRE gap closure): TUI path uses
	//    buildRealPiRuntimeTui which graduates to pi's full
	//    createAgentSessionRuntime + InteractiveMode. --print / --json paths
	//    keep buildRealPiRuntime (Plan 03-07 certified-at-close). Both
	//    builders receive identical arguments — divergence is the final
	//    factory shape, not the inputs.
	const builder = opts.mode === "tui" ? buildRealPiRuntimeTui : buildRealPiRuntime;
	const pi: PiRuntime = opts.piFactory
		? opts.piFactory({ customTools })
		: await builder(
				opts.cwd,
				opts.baseUrl,
				opts.profile,
				customTools,
				() => ({ text: assembledPrompt.text, sha256: assembledPrompt.sha256 }),
				opts.sessionId,
				opts.telemetryEnabled !== false,
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
	// Plan 03-06: plumb the allowlist + violation hook so stub-piFactory tests
	// that exercise the legacy path see the same enforcement surface.
	// Plan 03.1-02: plumb recentSearchUrls + web_search wiring identically.
	const legacyNativeToolOpts: Parameters<typeof registerNativeTools>[1] = {
		cwd: opts.cwd,
		profileRef: opts.profile.ref,
		webFetchAllowlist,
		webFetchOnViolation,
		recentSearchUrls,
	};
	if (webSearchConfig) legacyNativeToolOpts.webSearchConfig = webSearchConfig;
	if (webSearchEnabled) legacyNativeToolOpts.webSearchEnabled = true;
	legacyNativeToolOpts.webSearchOnSuccess = webSearchOnSuccess;
	legacyNativeToolOpts.webSearchOnFallback = webSearchOnFallback;
	registerNativeTools(
		pi as unknown as { registerTool: (spec: unknown) => void } as Parameters<typeof registerNativeTools>[0],
		legacyNativeToolOpts,
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

	return { runtime: pi, assembledPrompt, spOkOk: true, spOkSkipped, transcriptPath };
}
