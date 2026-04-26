// packages/emmy-ux/test/profile-swap-runner-http-relativize.test.ts
//
// Phase 04.2 follow-up — relativize Mac-absolute profile paths before
// shipping them to the sidecar over HTTP.
//
// Bug this fixes: profileIndex.resolve() returns Mac-absolute paths like
// "/Users/me/code/emmy/profiles/gemma-4-26b-a4b-it/v2-default". The local-
// mode dispatcher passes them verbatim to the orchestrator subprocess, which
// runs on Mac too — paths resolve fine. The HTTP dispatcher used to forward
// them verbatim to the sidecar, which runs on Spark with a different
// filesystem layout — schema validation failed with exit 5 ("prior model
// still serving").
//
// Fix: strip everything up to and including the parent of "profiles/".
// The sidecar joins "profiles/<name>/<variant>" against its own
// WorkingDirectory (/data/projects/emmy per the systemd unit).

import { describe, expect, test } from "bun:test";

import { _relativizeProfilePath } from "../src/profile-swap-runner-http";

describe("_relativizeProfilePath (Phase 04.2 follow-up)", () => {
	test("Mac-absolute → strips Mac prefix, keeps profiles/<name>/<variant>", () => {
		expect(
			_relativizeProfilePath(
				"/Users/me/code/emmy/profiles/qwen3.6-35b-a3b/v3.1-default",
			),
		).toBe("profiles/qwen3.6-35b-a3b/v3.1-default");
	});

	test("Spark-absolute → strips Spark prefix, keeps profiles/<name>/<variant>", () => {
		expect(
			_relativizeProfilePath(
				"/data/projects/emmy/profiles/gemma-4-26b-a4b-it/v2-default",
			),
		).toBe("profiles/gemma-4-26b-a4b-it/v2-default");
	});

	test("already-relative → pass through unchanged", () => {
		expect(_relativizeProfilePath("profiles/qwen3.6-35b-a3b/v3.1-default")).toBe(
			"profiles/qwen3.6-35b-a3b/v3.1-default",
		);
	});

	test("empty string (cold-start has no `from` path) → empty string", () => {
		expect(_relativizeProfilePath("")).toBe("");
	});

	test("non-standard layout without /profiles/ → pass through (sidecar will surface the real error)", () => {
		// If the path doesn't contain /profiles/, we don't know how to
		// relativize it. Pass through and let the sidecar's schema
		// validation produce a meaningful error.
		expect(_relativizeProfilePath("/some/random/path")).toBe(
			"/some/random/path",
		);
	});

	test("multiple /profiles/ in path → uses the LAST occurrence (defensive against weird layouts)", () => {
		// If someone has /profiles/ as an intermediate dir name, prefer the
		// last occurrence — that's the one closest to the bundle.
		expect(
			_relativizeProfilePath("/old/profiles/backup/profiles/qwen/v1"),
		).toBe("profiles/qwen/v1");
	});

	test("trailing-slash path → preserved (sidecar tolerates it; we don't normalize)", () => {
		// We don't aggressively normalize — let the sidecar handle whatever
		// shape it receives. Keeps the relativizer's behavior surgical.
		expect(
			_relativizeProfilePath("/Users/me/code/emmy/profiles/qwen/v3.1-default/"),
		).toBe("profiles/qwen/v3.1-default/");
	});
});
