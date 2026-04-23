// packages/emmy-ux/src/profile-index.ts
//
// Plan 04-03 Task 1 — filesystem scanner for the top-level `profiles/` tree.
//
// Walks profiles/<name>/<variant>/profile.yaml entries once at construction
// time and returns an index supporting:
//   - complete(prefix): autocomplete names OR "<name>@<variant>" tokens
//   - resolve(name, variant?): return absolute path of the target variant dir
//
// Design choices:
//   - Read-once at construction. The swap handler resolves via this index
//     before spawning the orchestrator; the index is recreated on each
//     createEmmyExtension factory call (session boot), which covers the
//     "user added a new profile bundle" case without hot-reload complexity.
//   - routes.yaml at the top level is skipped (not a profile directory; D-08
//     reserves it as the within-model routing config).
//   - Variant preference order for unspecified variant (resolve(name)):
//     1. explicit variant argument wins if given
//     2. "v3.1" (current default in Qwen bundle)
//     3. first entry starting with "v"
//     4. first entry overall
//   - Non-directory children + children missing `profile.yaml` are ignored so
//     half-populated scratch dirs don't corrupt the index.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface ProfileIndex {
	/**
	 * Return autocomplete tokens matching the given prefix.
	 *   - "ge" → ["gemma-4-26b-a4b-it"]
	 *   - "qwen3.6-35b-a3b@v3" → ["qwen3.6-35b-a3b@v3", "qwen3.6-35b-a3b@v3.1", …]
	 */
	complete(prefix: string): string[];
	/**
	 * Resolve a profile-name + optional variant to the absolute bundle dir.
	 * Returns null when the profile is unknown OR the requested variant
	 * doesn't exist for the profile.
	 */
	resolve(name: string, variant?: string): string | null;
}

interface Entry {
	name: string;
	variants: string[];
	paths: Record<string, string>;
}

/**
 * Walk `profilesRoot` (typically "profiles") and build an index of all
 * profile bundles. Safe on a missing root (returns an empty index).
 */
export function scanProfileIndex(profilesRoot: string): ProfileIndex {
	const entries: Entry[] = [];
	if (existsSync(profilesRoot)) {
		for (const dir of readdirSync(profilesRoot)) {
			if (dir === "routes.yaml") continue; // D-08: top-level routing file, not a profile
			const full = join(profilesRoot, dir);
			let isDir = false;
			try {
				isDir = statSync(full).isDirectory();
			} catch {
				isDir = false;
			}
			if (!isDir) continue;

			const variants: string[] = [];
			const paths: Record<string, string> = {};
			let subs: string[] = [];
			try {
				subs = readdirSync(full);
			} catch {
				subs = [];
			}
			for (const sub of subs) {
				const subFull = join(full, sub);
				let subIsDir = false;
				try {
					subIsDir = statSync(subFull).isDirectory();
				} catch {
					subIsDir = false;
				}
				if (!subIsDir) continue;
				if (!existsSync(join(subFull, "profile.yaml"))) continue;
				variants.push(sub);
				paths[sub] = subFull;
			}
			if (variants.length > 0) {
				entries.push({ name: dir, variants, paths });
			}
		}
	}

	return {
		complete(prefix: string): string[] {
			const out: string[] = [];
			if (!prefix.includes("@")) {
				for (const e of entries) {
					if (e.name.startsWith(prefix)) out.push(e.name);
				}
			} else {
				const [n, vPrefix] = prefix.split("@");
				const e = entries.find((x) => x.name === n);
				if (e) {
					for (const v of e.variants) {
						if (v.startsWith(vPrefix ?? "")) {
							out.push(`${n}@${v}`);
						}
					}
				}
			}
			return out;
		},
		resolve(name: string, variant?: string): string | null {
			const e = entries.find((x) => x.name === name);
			if (!e) return null;
			if (variant) return e.paths[variant] ?? null;
			// Default variant selection:
			//   explicit > "v3.1" > any v* > first
			const pref =
				e.variants.find((s) => s === "v3.1") ??
				e.variants.find((s) => s.startsWith("v")) ??
				e.variants[0];
			return pref ? (e.paths[pref] ?? null) : null;
		},
	};
}
