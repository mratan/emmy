// packages/emmy-ux/test/session-resolveSearxngBaseUrl.test.ts
//
// Phase 04.2 follow-up — Plan 04.2-05 shipped EMMY_SEARXNG_URL inside
// web-search.ts as the runtime default for DEFAULT_CFG.baseUrl. But session.ts
// was passing the profile-derived base_url explicitly into webSearchConfig,
// which shadowed the getter on every call (the getter only fired when no
// explicit baseUrl was provided — never on the live integration path). This
// test pins the corrected precedence in resolveSearxngBaseUrl():
//   env > profile > literal loopback default
//
// Why three layers (not two):
//   - env layer is the remote-client escape hatch (Mac wrapper sets it)
//   - profile layer lets a self-hosted Spark deployment customize per-profile
//     (e.g. point at a different SearxNG container)
//   - literal default preserves D-33 LOCKED loopback when neither is set
//
// S-2 env-restore discipline (per PATTERNS.md §Group C): every test saves +
// restores process.env.EMMY_SEARXNG_URL so test-order doesn't matter.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { resolveSearxngBaseUrl } from "../src/session";

describe("resolveSearxngBaseUrl precedence (env > profile > default)", () => {
	let oldEnv: string | undefined;

	beforeEach(() => {
		oldEnv = process.env.EMMY_SEARXNG_URL;
	});
	afterEach(() => {
		if (oldEnv === undefined) delete process.env.EMMY_SEARXNG_URL;
		else process.env.EMMY_SEARXNG_URL = oldEnv;
	});

	test("env unset + profile unset → literal loopback default (D-33 LOCKED preserved in local mode)", () => {
		delete process.env.EMMY_SEARXNG_URL;
		expect(resolveSearxngBaseUrl(undefined)).toBe("http://127.0.0.1:8888");
	});

	test("env unset + profile set → profile wins (per-profile customization)", () => {
		delete process.env.EMMY_SEARXNG_URL;
		expect(resolveSearxngBaseUrl("http://searxng.internal:8888")).toBe(
			"http://searxng.internal:8888",
		);
	});

	test("env set + profile unset → env wins", () => {
		process.env.EMMY_SEARXNG_URL = "https://spark.example.ts.net:8888";
		expect(resolveSearxngBaseUrl(undefined)).toBe("https://spark.example.ts.net:8888");
	});

	test("env set + profile set → env beats profile (the bug this helper fixes)", () => {
		// Pre-fix: session.ts hardcoded `webSearchProfile.base_url ?? "http://127.0.0.1:8888"`,
		// so the env override was masked whenever a profile defined base_url
		// (i.e. always — every shipped v1+ profile sets it to loopback).
		// Post-fix: env > profile, so the Mac wrapper's EMMY_SEARXNG_URL actually
		// reaches the call path.
		process.env.EMMY_SEARXNG_URL = "https://spark.example.ts.net:8888";
		expect(resolveSearxngBaseUrl("http://127.0.0.1:8888")).toBe(
			"https://spark.example.ts.net:8888",
		);
	});

	test("empty-string env is honored verbatim (no surprise fallback)", () => {
		// Documented behavior: the user explicitly setting EMMY_SEARXNG_URL=""
		// should produce "" (and downstream URL parsing will fail loud), not
		// silently fall back to the profile or default. This pins the JS
		// `??` semantics — "" is a defined value, only null/undefined fall through.
		process.env.EMMY_SEARXNG_URL = "";
		expect(resolveSearxngBaseUrl("http://127.0.0.1:8888")).toBe("");
	});
});
