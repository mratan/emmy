// packages/emmy-provider/src/variant-resolver.ts
//
// Phase 4 Plan 04-04 Task 2b (HARNESS-08 / D-11) — pure transform from
// (role, routes, profilesRoot) → resolved variant path. No I/O. The
// before_provider_request hook does the actual variant bundle load via
// profile-loader.ts (in @emmy/ux); this resolver only computes which
// variant DIR to load.
//
// Fallback: when the requested role is not present in routes.roles, falls
// back to routes.default. This matches routes-loader's "roles default to
// default" policy for absent entries.
//
// Dependency direction note: RoutesConfig + RouteRef live in @emmy/provider
// (this file) to avoid a circular dependency with @emmy/ux (which imports
// @emmy/provider already for ProfileSnapshot etc.). @emmy/ux's
// routes-loader.ts imports these types from here.

import { join } from "node:path";

export type RoleKey = "plan" | "edit" | "critic" | "default";

export interface RouteRef {
	profileId: string;
	variant: string;
}

export interface RoutesConfig {
	default: RouteRef;
	roles: {
		plan: RouteRef;
		edit: RouteRef;
		critic: RouteRef;
	};
}

export interface ResolvedVariant {
	variantPath: string;
	profileId: string;
	variant: string;
}

export function resolveVariant(
	role: RoleKey,
	routes: RoutesConfig,
	profilesRoot: string,
): ResolvedVariant {
	let ref: RouteRef;
	if (role === "default") {
		ref = routes.default;
	} else {
		// routes.roles is strongly-typed with plan/edit/critic keys in
		// RoutesConfig; any non-string fallback is defensive (routes-loader
		// already normalized absent roles to the default ref).
		ref = routes.roles[role] ?? routes.default;
	}
	return {
		variantPath: join(profilesRoot, ref.profileId, ref.variant),
		profileId: ref.profileId,
		variant: ref.variant,
	};
}
