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
});
