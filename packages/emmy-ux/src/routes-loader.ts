// packages/emmy-ux/src/routes-loader.ts
//
// Phase 4 Plan 04-04 Task 2a (HARNESS-08 / D-08 / D-09) — parse profiles/routes.yaml
// into a typed RoutesConfig consumed by the before_provider_request hook.
//
// routes.yaml shape (LiteLLM-inspired; see 04-RESEARCH §4.1):
//
//   default: qwen3.6-35b-a3b@v3.1-default
//   roles:
//     plan:   qwen3.6-35b-a3b@v3.1-reason
//     edit:   qwen3.6-35b-a3b@v3.1-precise
//     critic: qwen3.6-35b-a3b@v3.1-default
//
// Each ref is `<profileId>@<variant>`. The variant resolves to a sibling
// directory under profiles/<profileId>/ whose serving.yaml is byte-identical
// to the base (engine byte-identity; CI-enforced in
// tests/unit/test_variant_engine_byte_identity.py). Only harness.yaml fields
// differ per variant — sampling_defaults, chat_template_kwargs, per_tool_sampling,
// advanced_settings_whitelist — and these mutate the outgoing chat request
// payload at wire time via handleBeforeProviderRequest.
//
// Error discipline: RoutesLoadError is the single typed error surface.
// Callers in pi-emmy-extension.ts catch ENOENT to fall back to default-only
// mode when routes.yaml is absent (opt-in Phase 4 path per D-08 specifics).

import { readFileSync } from "node:fs";
import yaml from "js-yaml";

// RouteRef + RoutesConfig live in @emmy/provider to avoid a circular
// dependency — @emmy/ux already depends on @emmy/provider, but the reverse
// would create a cycle. The resolver that consumes these types
// (variant-resolver.ts) is also in @emmy/provider. Re-export from this
// module so direct callers of the loader get both the types and the
// function from a single surface.
import type { RouteRef, RoutesConfig } from "@emmy/provider";

export type { RouteRef, RoutesConfig } from "@emmy/provider";

export class RoutesLoadError extends Error {
	constructor(
		public readonly field: string,
		message: string,
	) {
		super(`routes.${field}: ${message}`);
		this.name = "RoutesLoadError";
	}
}

// Path-traversal / absolute-path rejection. profileId and variant are both
// concatenated into a filesystem path under `profiles/` downstream; rejecting
// `..`, `/`, leading `.`, NULs, and anything not in [A-Za-z0-9_.-] closes the
// attack surface flagged as WR-01 in 04-REVIEW.md.
// A variant MAY contain `.` (we ship `v3.1-default`), but cannot START with one
// and cannot contain `..`.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function isSafeIdent(s: string): boolean {
	if (!SAFE_ID.test(s)) return false;
	if (s.includes("..")) return false;
	return true;
}

/**
 * Parse a `<profileId>@<variant>` string into a RouteRef. Throws
 * RoutesLoadError if either half is missing, empty, or contains path-traversal
 * characters. Allowed chars: [A-Za-z0-9_.-], must not start with `.`, must not
 * contain `..` — this keeps the downstream filesystem path under
 * `profiles/<profileId>/<variant>/` safe from escape.
 */
function parseRef(raw: unknown, field: string): RouteRef {
	if (typeof raw !== "string") {
		throw new RoutesLoadError(
			field,
			`must be a string of shape '<profileId>@<variant>', got ${typeof raw}`,
		);
	}
	const s = raw.trim();
	if (!s.includes("@")) {
		throw new RoutesLoadError(
			field,
			`invalid ref shape '${s}': expected '<profileId>@<variant>'`,
		);
	}
	const atIdx = s.indexOf("@");
	const profileId = s.slice(0, atIdx).trim();
	const variant = s.slice(atIdx + 1).trim();
	if (!profileId) {
		throw new RoutesLoadError(field, `missing profile id in ref '${s}'`);
	}
	if (!variant) {
		throw new RoutesLoadError(field, `missing variant in ref '${s}'`);
	}
	if (!isSafeIdent(profileId)) {
		throw new RoutesLoadError(
			field,
			`profile id '${profileId}' contains disallowed characters (allowed: [A-Za-z0-9_.-], no leading '.', no '..')`,
		);
	}
	if (!isSafeIdent(variant)) {
		throw new RoutesLoadError(
			field,
			`variant '${variant}' contains disallowed characters (allowed: [A-Za-z0-9_.-], no leading '.', no '..')`,
		);
	}
	return { profileId, variant };
}

/**
 * Read `path` and parse it into a RoutesConfig. Throws RoutesLoadError on
 * any structural problem (missing default, malformed ref, etc.). Missing
 * roles fall back to the `default` ref so partial configs remain valid.
 */
export function loadRoutes(path: string): RoutesConfig {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (e) {
		throw new RoutesLoadError(
			"io",
			`${path}: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
	let parsed: unknown;
	try {
		parsed = yaml.load(text);
	} catch (e) {
		throw new RoutesLoadError(
			"yaml",
			`${path}: YAML parse: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
	if (parsed === null || parsed === undefined) {
		throw new RoutesLoadError("yaml", `${path}: empty YAML document`);
	}
	if (typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new RoutesLoadError("yaml", `${path}: expected a mapping`);
	}
	const raw = parsed as { default?: unknown; roles?: unknown };
	if (raw.default === undefined || raw.default === null) {
		throw new RoutesLoadError(
			"default",
			`${path}: missing required 'default' ref`,
		);
	}
	const defaultRef = parseRef(raw.default, "default");

	// Roles optional at top level; individual roles fall back to default when absent.
	let rolesRaw: Record<string, unknown> = {};
	if (raw.roles !== undefined && raw.roles !== null) {
		if (typeof raw.roles !== "object" || Array.isArray(raw.roles)) {
			throw new RoutesLoadError("roles", `${path}: expected a mapping`);
		}
		rolesRaw = raw.roles as Record<string, unknown>;
	}

	const resolveRole = (key: "plan" | "edit" | "critic"): RouteRef => {
		const v = rolesRaw[key];
		if (v === undefined || v === null) {
			// Fall back to the default ref — caller can still route all roles
			// to the default variant when the routes.yaml only declares
			// `default:`. This matches D-08's "absence = default-only mode".
			return defaultRef;
		}
		return parseRef(v, `roles.${key}`);
	};

	return {
		default: defaultRef,
		roles: {
			plan: resolveRole("plan"),
			edit: resolveRole("edit"),
			critic: resolveRole("critic"),
		},
	};
}
