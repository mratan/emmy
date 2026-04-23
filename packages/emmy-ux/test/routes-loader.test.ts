// packages/emmy-ux/test/routes-loader.test.ts
//
// Phase 4 Plan 04-04 Task 2h — routes.yaml loader tests. Asserts:
//   1. Repo's shipped profiles/routes.yaml loads with the expected refs.
//   2. Malformed YAML / missing default / invalid ref shape throw
//      RoutesLoadError with a useful field path.
//   3. Absent roles fall back to the default ref (D-08 partial-config path).

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { loadRoutes, RoutesLoadError } from "../src/routes-loader";

const HERE = dirname(fileURLToPath(import.meta.url));
// test/ is at packages/emmy-ux/test; REPO_ROOT is three levels up.
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const SHIPPED_ROUTES = join(REPO_ROOT, "profiles", "routes.yaml");

describe("loadRoutes", () => {
	test("loads the repo's shipped routes.yaml with the expected Qwen variant refs", () => {
		const cfg = loadRoutes(SHIPPED_ROUTES);
		expect(cfg.default.profileId).toBe("qwen3.6-35b-a3b");
		expect(cfg.default.variant).toBe("v3.1-default");
		expect(cfg.roles.plan.profileId).toBe("qwen3.6-35b-a3b");
		expect(cfg.roles.plan.variant).toBe("v3.1-reason");
		expect(cfg.roles.edit.profileId).toBe("qwen3.6-35b-a3b");
		expect(cfg.roles.edit.variant).toBe("v3.1-precise");
		expect(cfg.roles.critic.profileId).toBe("qwen3.6-35b-a3b");
		expect(cfg.roles.critic.variant).toBe("v3.1-default");
	});

	test("throws RoutesLoadError when the `default` key is missing", () => {
		const tmp = mkdtempSync(join(tmpdir(), "emmy-routes-"));
		try {
			const p = join(tmp, "routes.yaml");
			writeFileSync(p, "roles:\n  plan: qwen@v1\n", "utf8");
			let err: Error | null = null;
			try {
				loadRoutes(p);
			} catch (e) {
				err = e as Error;
			}
			expect(err).toBeInstanceOf(RoutesLoadError);
			expect(err?.message).toContain("default");
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("throws RoutesLoadError on malformed ref shape (no @ separator)", () => {
		const tmp = mkdtempSync(join(tmpdir(), "emmy-routes-"));
		try {
			const p = join(tmp, "routes.yaml");
			writeFileSync(p, "default: invalid-no-at-sign\n", "utf8");
			let err: Error | null = null;
			try {
				loadRoutes(p);
			} catch (e) {
				err = e as Error;
			}
			expect(err).toBeInstanceOf(RoutesLoadError);
			expect(err?.message).toContain("invalid ref shape");
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("absent roles fall back to the default ref (D-08 partial-config)", () => {
		const tmp = mkdtempSync(join(tmpdir(), "emmy-routes-"));
		try {
			const p = join(tmp, "routes.yaml");
			writeFileSync(p, "default: qwen3.6-35b-a3b@v3.1-default\n", "utf8");
			const cfg = loadRoutes(p);
			expect(cfg.default.profileId).toBe("qwen3.6-35b-a3b");
			expect(cfg.default.variant).toBe("v3.1-default");
			// All three roles fall back to default when roles: is omitted.
			expect(cfg.roles.plan.variant).toBe("v3.1-default");
			expect(cfg.roles.edit.variant).toBe("v3.1-default");
			expect(cfg.roles.critic.variant).toBe("v3.1-default");
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	test("empty YAML document throws RoutesLoadError", () => {
		const tmp = mkdtempSync(join(tmpdir(), "emmy-routes-"));
		try {
			const p = join(tmp, "routes.yaml");
			writeFileSync(p, "", "utf8");
			let err: Error | null = null;
			try {
				loadRoutes(p);
			} catch (e) {
				err = e as Error;
			}
			expect(err).toBeInstanceOf(RoutesLoadError);
			expect(err?.message).toContain("empty YAML");
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	// --- WR-01 (04-REVIEW.md) path-traversal hardening ---
	// parseRef must reject path-traversal characters in both profileId and
	// variant since these halves concatenate into a filesystem path downstream.
	describe("path-traversal hardening (WR-01)", () => {
		const badRefs: Array<[string, string]> = [
			["default: ../escape@v1\n", "profile id '../escape'"],
			["default: ..@v1\n", "profile id '..'"],
			["default: ./local@v1\n", "profile id './local'"],
			["default: /absolute@v1\n", "profile id '/absolute'"],
			["default: qwen/sub@v1\n", "profile id 'qwen/sub'"],
			["default: .hidden@v1\n", "profile id '.hidden'"],
			["default: qwen@../escape\n", "variant '../escape'"],
			["default: qwen@..\n", "variant '..'"],
			["default: qwen@/absolute\n", "variant '/absolute'"],
			["default: qwen@v1/sub\n", "variant 'v1/sub'"],
			["default: qwen@.hidden\n", "variant '.hidden'"],
			["default: qwen@v..1\n", "variant 'v..1'"],
		];

		for (const [yamlText, _descExcerpt] of badRefs) {
			test(`rejects '${yamlText.trim()}'`, () => {
				const tmp = mkdtempSync(join(tmpdir(), "emmy-routes-"));
				try {
					const p = join(tmp, "routes.yaml");
					writeFileSync(p, yamlText, "utf8");
					let err: Error | null = null;
					try {
						loadRoutes(p);
					} catch (e) {
						err = e as Error;
					}
					expect(err).toBeInstanceOf(RoutesLoadError);
					expect(err?.message).toContain("disallowed characters");
				} finally {
					rmSync(tmp, { recursive: true, force: true });
				}
			});
		}

		test("NUL byte is caught by an earlier layer (YAML parser), still throws RoutesLoadError", () => {
			// Defense in depth: js-yaml rejects NUL at parse time before our
			// allowlist regex runs. The important invariant is that the loader
			// surfaces SOME RoutesLoadError — not the specific message.
			const tmp = mkdtempSync(join(tmpdir(), "emmy-routes-"));
			try {
				const p = join(tmp, "routes.yaml");
				writeFileSync(p, "default: qwen\x00bad@v1\n", "utf8");
				let err: Error | null = null;
				try {
					loadRoutes(p);
				} catch (e) {
					err = e as Error;
				}
				expect(err).toBeInstanceOf(RoutesLoadError);
			} finally {
				rmSync(tmp, { recursive: true, force: true });
			}
		});

		test("accepts the shipped refs (regression guard)", () => {
			// The 3 shipped variant names must all pass hardening.
			const tmp = mkdtempSync(join(tmpdir(), "emmy-routes-"));
			try {
				const p = join(tmp, "routes.yaml");
				writeFileSync(
					p,
					[
						"default: qwen3.6-35b-a3b@v3.1-default",
						"roles:",
						"  plan: qwen3.6-35b-a3b@v3.1-reason",
						"  edit: qwen3.6-35b-a3b@v3.1-precise",
						"  critic: qwen3.6-35b-a3b@v3.1-default",
						"",
					].join("\n"),
					"utf8",
				);
				const cfg = loadRoutes(p);
				expect(cfg.default.profileId).toBe("qwen3.6-35b-a3b");
				expect(cfg.default.variant).toBe("v3.1-default");
			} finally {
				rmSync(tmp, { recursive: true, force: true });
			}
		});
	});
});
