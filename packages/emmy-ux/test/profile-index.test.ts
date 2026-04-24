// packages/emmy-ux/test/profile-index.test.ts
//
// Plan 04-03 Task 1 — unit tests for scanProfileIndex.
//
// Covers:
//   - resolve() honors profiles/<name>/DEFAULT_VARIANT (Gemma → v2, Qwen → v3.1)
//   - resolve() returns null for unknown profiles
//   - complete() autocompletes prefix matches on names
//   - complete() autocompletes "<name>@<variantPrefix>" on known name
//   - routes.yaml (top-level file) is skipped — synthetic fixture in tmpdir
//   - DEFAULT_VARIANT file handling: valid / invalid / missing fallback

import { describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import { scanProfileIndex } from "../src/profile-index";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const REAL_PROFILES_DIR = join(REPO_ROOT, "profiles");

describe("scanProfileIndex (real profiles/ tree)", () => {
	test("resolve('gemma-4-26b-a4b-it') honors DEFAULT_VARIANT → v2 (v1 is unbootable)", () => {
		const idx = scanProfileIndex(REAL_PROFILES_DIR);
		const p = idx.resolve("gemma-4-26b-a4b-it");
		expect(p).toBeString();
		expect(p).not.toBeNull();
		expect(isAbsolute(p!)).toBe(true);
		expect(p!.endsWith("/gemma-4-26b-a4b-it/v2")).toBe(true);
	});

	test("resolve('qwen3.6-35b-a3b') honors DEFAULT_VARIANT → v3.1", () => {
		const idx = scanProfileIndex(REAL_PROFILES_DIR);
		const p = idx.resolve("qwen3.6-35b-a3b");
		expect(p).not.toBeNull();
		expect(p!.endsWith("/qwen3.6-35b-a3b/v3.1")).toBe(true);
	});

	test("resolve with explicit variant overrides the default picker", () => {
		const idx = scanProfileIndex(REAL_PROFILES_DIR);
		const p = idx.resolve("qwen3.6-35b-a3b", "v1");
		expect(p).not.toBeNull();
		expect(p!.endsWith("/qwen3.6-35b-a3b/v1")).toBe(true);
	});

	test("resolve returns null for unknown profile", () => {
		const idx = scanProfileIndex(REAL_PROFILES_DIR);
		expect(idx.resolve("does-not-exist")).toBeNull();
	});

	test("resolve returns null for known profile but unknown variant", () => {
		const idx = scanProfileIndex(REAL_PROFILES_DIR);
		expect(idx.resolve("gemma-4-26b-a4b-it", "v999")).toBeNull();
	});

	test("complete('gem') returns the Gemma profile name", () => {
		const idx = scanProfileIndex(REAL_PROFILES_DIR);
		const results = idx.complete("gem");
		expect(results).toContain("gemma-4-26b-a4b-it");
	});

	test("complete('qwen3.6-35b-a3b@v3') returns v3 + v3.1 variant tokens", () => {
		const idx = scanProfileIndex(REAL_PROFILES_DIR);
		const results = idx.complete("qwen3.6-35b-a3b@v3");
		// The Qwen bundle ships v1/v2/v3/v3.1 — both v3* variants match.
		expect(results).toContain("qwen3.6-35b-a3b@v3");
		expect(results).toContain("qwen3.6-35b-a3b@v3.1");
		// No cross-profile pollution.
		expect(results.every((r) => r.startsWith("qwen3.6-35b-a3b@"))).toBe(true);
	});

	test("complete('qwen3.6-35b-a3b@') returns ALL variants of the profile", () => {
		const idx = scanProfileIndex(REAL_PROFILES_DIR);
		const results = idx.complete("qwen3.6-35b-a3b@");
		// Empty prefix after '@' → all variants match.
		expect(results.length).toBeGreaterThanOrEqual(4);
		expect(results).toContain("qwen3.6-35b-a3b@v1");
		expect(results).toContain("qwen3.6-35b-a3b@v3.1");
	});

	test("complete('') returns all profile names", () => {
		const idx = scanProfileIndex(REAL_PROFILES_DIR);
		const results = idx.complete("");
		expect(results).toContain("gemma-4-26b-a4b-it");
		expect(results).toContain("qwen3.6-35b-a3b");
	});
});

describe("scanProfileIndex (synthetic fixtures for edge cases)", () => {
	test("routes.yaml at the top level is skipped (D-08 top-level file not a profile)", () => {
		const root = mkdtempSync(join(tmpdir(), "emmy-profile-index-"));
		try {
			// Top-level routes.yaml file — should be ignored.
			writeFileSync(
				join(root, "routes.yaml"),
				"default: fake-profile@v1\nroles: {}\n",
			);
			// A legitimate profile bundle alongside it.
			mkdirSync(join(root, "fake-profile", "v1"), { recursive: true });
			writeFileSync(
				join(root, "fake-profile", "v1", "profile.yaml"),
				"profile:\n  id: fake-profile\n  version: v1\n",
			);

			const idx = scanProfileIndex(root);
			const completes = idx.complete("");
			expect(completes).toContain("fake-profile");
			// routes.yaml must NOT be enumerated as a profile.
			expect(completes).not.toContain("routes.yaml");
			expect(idx.resolve("routes.yaml")).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("variant dir missing profile.yaml is skipped (partial bundle ignored)", () => {
		const root = mkdtempSync(join(tmpdir(), "emmy-profile-index-"));
		try {
			// One valid variant + one scratch variant dir with no profile.yaml.
			mkdirSync(join(root, "pseudo", "v1"), { recursive: true });
			writeFileSync(
				join(root, "pseudo", "v1", "profile.yaml"),
				"profile:\n  id: pseudo\n  version: v1\n",
			);
			mkdirSync(join(root, "pseudo", "scratch"), { recursive: true });
			// No profile.yaml inside scratch.

			const idx = scanProfileIndex(root);
			const variants = idx.complete("pseudo@");
			expect(variants).toEqual(["pseudo@v1"]);
			expect(idx.resolve("pseudo", "scratch")).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("profile dir with no variants at all is omitted from the index", () => {
		const root = mkdtempSync(join(tmpdir(), "emmy-profile-index-"));
		try {
			// Empty top-level dir — no variants with profile.yaml.
			mkdirSync(join(root, "abandoned"), { recursive: true });
			const idx = scanProfileIndex(root);
			expect(idx.complete("")).toEqual([]);
			expect(idx.resolve("abandoned")).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("missing profilesRoot yields an empty index (safe fallback)", () => {
		const idx = scanProfileIndex(
			join(tmpdir(), "definitely-does-not-exist-" + Date.now()),
		);
		expect(idx.complete("")).toEqual([]);
		expect(idx.resolve("anything")).toBeNull();
	});

	test("DEFAULT_VARIANT marker picks the named variant, overriding alphabetical fallback", () => {
		const root = mkdtempSync(join(tmpdir(), "emmy-profile-index-"));
		try {
			mkdirSync(join(root, "bundle", "v1"), { recursive: true });
			writeFileSync(
				join(root, "bundle", "v1", "profile.yaml"),
				"profile:\n  id: bundle\n  version: v1\n",
			);
			mkdirSync(join(root, "bundle", "v2"), { recursive: true });
			writeFileSync(
				join(root, "bundle", "v2", "profile.yaml"),
				"profile:\n  id: bundle\n  version: v2\n",
			);
			// Without DEFAULT_VARIANT the historical fallback picks "v1"
			// (first v* alphabetically); with it, v2 wins.
			writeFileSync(join(root, "bundle", "DEFAULT_VARIANT"), "v2\n");

			const idx = scanProfileIndex(root);
			const p = idx.resolve("bundle");
			expect(p).not.toBeNull();
			expect(p!.endsWith("/bundle/v2")).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("DEFAULT_VARIANT pointing at a missing variant is ignored — historical chain still applies", () => {
		const root = mkdtempSync(join(tmpdir(), "emmy-profile-index-"));
		try {
			mkdirSync(join(root, "bundle", "v1"), { recursive: true });
			writeFileSync(
				join(root, "bundle", "v1", "profile.yaml"),
				"profile:\n  id: bundle\n  version: v1\n",
			);
			// DEFAULT_VARIANT names a variant we didn't index — ignore.
			writeFileSync(
				join(root, "bundle", "DEFAULT_VARIANT"),
				"v999\n",
			);

			const idx = scanProfileIndex(root);
			const p = idx.resolve("bundle");
			expect(p).not.toBeNull();
			expect(p!.endsWith("/bundle/v1")).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("DEFAULT_VARIANT absence leaves historical preference chain intact (v3.1 > any v* > first)", () => {
		const root = mkdtempSync(join(tmpdir(), "emmy-profile-index-"));
		try {
			mkdirSync(join(root, "bundle", "v1"), { recursive: true });
			writeFileSync(
				join(root, "bundle", "v1", "profile.yaml"),
				"profile:\n  id: bundle\n  version: v1\n",
			);
			mkdirSync(join(root, "bundle", "v3.1"), { recursive: true });
			writeFileSync(
				join(root, "bundle", "v3.1", "profile.yaml"),
				"profile:\n  id: bundle\n  version: v3.1\n",
			);
			// No DEFAULT_VARIANT file.

			const idx = scanProfileIndex(root);
			const p = idx.resolve("bundle");
			expect(p).not.toBeNull();
			expect(p!.endsWith("/bundle/v3.1")).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
