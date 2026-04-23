// packages/emmy-ux/src/profile-loader.ts
//
// loadProfile(profileDir): ProfileSnapshot — reads profile.yaml / serving.yaml /
// harness.yaml from a profile bundle directory and returns the shared
// ProfileSnapshot shape (defined in @emmy/provider/src/types.ts).
//
// Fix anchors:
//   - B3 FIX (D-11): `harness.tools.grammar` is parsed as the nested
//     { path, mode: "reactive"|"disabled" } | null shape. The pre-revision
//     flattened-string shape is explicitly rejected with a dotted-path error.
//   - W4 FIX: `serving.engine.max_model_len` is REQUIRED. A missing field
//     throws ProfileLoadError — Plan 04's max-model-len regression relies on
//     this being a real number, not a guess.
//   - Hash source of truth: profile.yaml's `profile.hash` if present and well
//     formed; otherwise shell out to `uv run emmy profile hash <dir>` (CONTEXT.md
//     §code_context — do NOT reimplement the hasher in TS).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ProfileSnapshot } from "@emmy/provider";
import yaml from "js-yaml";

import { ProfileLoadError } from "./errors";

export async function loadProfile(profileDir: string): Promise<ProfileSnapshot> {
	if (!existsSync(profileDir)) {
		throw new ProfileLoadError(profileDir, "profile directory not found");
	}

	const profileYaml = loadYaml(join(profileDir, "profile.yaml"));
	const servingYaml = loadYaml(join(profileDir, "serving.yaml"));
	const harnessYaml = loadYaml(join(profileDir, "harness.yaml"));

	// Resolve authoritative hash.
	const profileBlock = (profileYaml as { profile?: Record<string, unknown> })?.profile;
	let hash: string;
	if (
		profileBlock &&
		typeof profileBlock.hash === "string" &&
		profileBlock.hash.startsWith("sha256:")
	) {
		hash = profileBlock.hash;
	} else {
		try {
			const out = execFileSync("uv", ["run", "emmy", "profile", "hash", profileDir], {
				encoding: "utf8",
			}).trim();
			const m = out.match(/sha256:[0-9a-f]{64}/);
			if (!m) throw new Error(`unexpected output: ${out.slice(0, 200)}`);
			hash = m[0];
		} catch (e) {
			throw new ProfileLoadError(
				profileDir,
				`could not obtain content hash: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}

	// --- Required fields (throw ProfileLoadError on miss) ---
	const profileYamlPath = `${profileDir}/profile.yaml`;
	const servingYamlPath = `${profileDir}/serving.yaml`;
	const harnessYamlPath = `${profileDir}/harness.yaml`;

	const id = requireStr(profileYaml, `${profileYamlPath}:profile.id`, ["profile", "id"]);
	const version = requireStr(profileYaml, `${profileYamlPath}:profile.version`, [
		"profile",
		"version",
	]);

	const servedModelName = requireStr(
		servingYaml,
		`${servingYamlPath}:engine.served_model_name`,
		["engine", "served_model_name"],
	);
	// W4 FIX: serving.engine.max_model_len is REQUIRED.
	const maxModelLen = requireNum(servingYaml, `${servingYamlPath}:engine.max_model_len`, [
		"engine",
		"max_model_len",
	]);
	const samplingTemp = requireNum(
		servingYaml,
		`${servingYamlPath}:sampling_defaults.temperature`,
		["sampling_defaults", "temperature"],
	);
	const samplingTopP = requireNum(servingYaml, `${servingYamlPath}:sampling_defaults.top_p`, [
		"sampling_defaults",
		"top_p",
	]);
	const samplingMaxTok = requireNum(
		servingYaml,
		`${servingYamlPath}:sampling_defaults.max_tokens`,
		["sampling_defaults", "max_tokens"],
	);

	// Optional serving fields.
	const topKRaw = (servingYaml as Record<string, unknown> | null)?.sampling_defaults as
		| Record<string, unknown>
		| undefined;
	const topK = typeof topKRaw?.top_k === "number" ? (topKRaw.top_k as number) : undefined;
	const stopRaw = (servingYaml as Record<string, unknown> | null)?.sampling_defaults as
		| Record<string, unknown>
		| undefined;
	const stop = Array.isArray(stopRaw?.stop) ? (stopRaw!.stop as string[]) : undefined;

	const quirksRaw =
		((servingYaml as Record<string, unknown> | null)?.quirks as Record<string, unknown>) ?? {};
	const stripFields = Array.isArray(quirksRaw.strip_fields)
		? (quirksRaw.strip_fields as string[])
		: undefined;

	const toolsRaw =
		((harnessYaml as Record<string, unknown> | null)?.tools as Record<string, unknown>) ?? {};
	const agentLoopRaw =
		((harnessYaml as Record<string, unknown> | null)?.agent_loop as
			| Record<string, unknown>
			| undefined) ?? {};

	// B3 FIX: nested { path, mode } shape.
	const grammar = parseGrammarConfig(
		toolsRaw.grammar,
		`${harnessYamlPath}:tools.grammar`,
	);

	const format = toolsRaw.format === "hermes" ? "hermes" : "openai";
	const perToolSampling =
		(toolsRaw.per_tool_sampling as Record<
			string,
			{ temperature?: number; top_p?: number; max_tokens?: number }
		>) ?? {};

	// Plan 03-06 (UX-03 / D-26): parse tools.web_fetch.allowlist (new Phase-3
	// field; Phase-2 v2 does not declare it → absent → default-deny / empty).
	const webFetchRaw = toolsRaw.web_fetch as Record<string, unknown> | undefined;
	const webFetchAllowlist: string[] | undefined = Array.isArray(webFetchRaw?.allowlist)
		? (webFetchRaw!.allowlist as unknown[]).filter(
				(v): v is string => typeof v === "string",
		  )
		: undefined;

	// Plan 03.1-02 (D-34): parse tools.web_search block (Phase-3.1 field; v3/v2/v1
	// don't declare it → absent → tool not registered at session build time).
	const webSearchRaw = toolsRaw.web_search as Record<string, unknown> | undefined;
	const webSearchBlock: {
		enabled: boolean;
		base_url: string;
		max_results_default: number;
		rate_limit_per_turn: number;
		timeout_ms: number;
	} | undefined = webSearchRaw
		? {
				enabled: webSearchRaw.enabled === true,
				base_url:
					typeof webSearchRaw.base_url === "string"
						? webSearchRaw.base_url
						: "http://127.0.0.1:8888",
				max_results_default:
					typeof webSearchRaw.max_results_default === "number"
						? webSearchRaw.max_results_default
						: 10,
				rate_limit_per_turn:
					typeof webSearchRaw.rate_limit_per_turn === "number"
						? webSearchRaw.rate_limit_per_turn
						: 10,
				timeout_ms:
					typeof webSearchRaw.timeout_ms === "number"
						? webSearchRaw.timeout_ms
						: 10000,
		  }
		: undefined;

	const retryOnUnparseableToolCall =
		typeof agentLoopRaw.retry_on_unparseable_tool_call === "number"
			? (agentLoopRaw.retry_on_unparseable_tool_call as number)
			: 2;

	const snap: ProfileSnapshot = {
		ref: { id, version, hash, path: profileDir },
		serving: {
			engine: { served_model_name: servedModelName, max_model_len: maxModelLen },
			sampling_defaults: {
				temperature: samplingTemp,
				top_p: samplingTopP,
				max_tokens: samplingMaxTok,
				...(typeof topK === "number" ? { top_k: topK } : {}),
				...(stop !== undefined ? { stop } : {}),
			},
			quirks: {
				strip_thinking_tags: !!quirksRaw.strip_thinking_tags,
				promote_reasoning_to_content: !!quirksRaw.promote_reasoning_to_content,
				// Default TRUE per @emmy/provider contract (buffer unless explicitly disabled).
				buffer_tool_streams: quirksRaw.buffer_tool_streams !== false,
				...(stripFields !== undefined ? { strip_fields: stripFields } : {}),
			},
		},
		harness: {
			tools: {
				format,
				grammar,
				per_tool_sampling: perToolSampling,
				...(webFetchAllowlist !== undefined
					? { web_fetch: { allowlist: webFetchAllowlist } }
					: {}),
				...(webSearchBlock !== undefined ? { web_search: webSearchBlock } : {}),
			},
			agent_loop: {
				retry_on_unparseable_tool_call: retryOnUnparseableToolCall,
			},
		},
	};
	return snap;
}

// B3 FIX: nested { path, mode } shape. Reject strings, arrays, unknown modes.
function parseGrammarConfig(
	raw: unknown,
	at: string,
): { path: string; mode: "reactive" | "disabled" } | null {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === "string") {
		throw new ProfileLoadError(
			at,
			`must be a mapping with path + mode, or null (pre-revision flattened-string shape is rejected; see CONTEXT D-11)`,
		);
	}
	if (typeof raw !== "object" || Array.isArray(raw)) {
		throw new ProfileLoadError(
			at,
			`must be a mapping with keys {path, mode}, or null`,
		);
	}
	const obj = raw as Record<string, unknown>;
	if (typeof obj.path !== "string" || !obj.path.trim()) {
		throw new ProfileLoadError(
			`${at}.path`,
			`must be a non-empty string (relative to profile dir)`,
		);
	}
	if (obj.mode !== "reactive" && obj.mode !== "disabled") {
		throw new ProfileLoadError(
			`${at}.mode`,
			`must be one of reactive, disabled (got ${JSON.stringify(obj.mode)})`,
		);
	}
	return { path: obj.path, mode: obj.mode };
}

function loadYaml(path: string): unknown {
	if (!existsSync(path)) throw new ProfileLoadError(path, "file not found");
	try {
		return yaml.load(readFileSync(path, "utf8"));
	} catch (e) {
		throw new ProfileLoadError(
			path,
			`YAML parse: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
}

function requireStr(obj: unknown, at: string, keys: string[]): string {
	const v = keys.reduce<unknown>((o, k) => {
		if (o && typeof o === "object") return (o as Record<string, unknown>)[k];
		return undefined;
	}, obj);
	if (typeof v !== "string" || !v.trim()) {
		throw new ProfileLoadError(at, "must be a non-empty string");
	}
	return v;
}

function requireNum(obj: unknown, at: string, keys: string[]): number {
	const v = keys.reduce<unknown>((o, k) => {
		if (o && typeof o === "object") return (o as Record<string, unknown>)[k];
		return undefined;
	}, obj);
	if (typeof v !== "number" || !Number.isFinite(v)) {
		throw new ProfileLoadError(at, "must be a number");
	}
	return v;
}

export { ProfileLoadError } from "./errors";
