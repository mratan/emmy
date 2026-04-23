// packages/emmy-tools/tests/web-fetch-bypass.test.ts
//
// Plan 03.1-02 Task 2 (RED) — D-35 returned-URL bypass for web_fetch.
//
// Covers:
//   (1) Recent-search URL is fetchable even without hostname allowlist entry.
//   (2) T-03.1-02-02 SSRF mitigation: exact URL match — different path on the
//       same hostname is NOT bypassed.
//   (3) TTL eviction: after prune at nowMs > (recordedAt + ttlMs), entry is gone.
//   (4) Default store gets lazy-initialized on first recordSearchUrl call.

import { afterEach, describe, expect, test } from "bun:test";

import {
	__resetSearchStoreForTests,
	enforceWebFetchAllowlist,
	getOrCreateDefaultStore,
	recordSearchUrl,
	WebFetchAllowlistError,
	type RecentSearchUrlStore,
} from "../src/web-fetch-allowlist";

const PROFILE_REF = { id: "test", version: "v3.1", hash: "sha256:deadbeef" };

afterEach(() => {
	__resetSearchStoreForTests();
});

describe("RecentSearchUrlStore — bypass via recent-search URL (D-35)", () => {
	test("URL recorded via recordSearchUrl is fetchable even when hostname NOT in allowlist", () => {
		const store = getOrCreateDefaultStore(300000);
		recordSearchUrl("https://bun.sh/blog/release-notes");
		// bun.sh is NOT in the allowlist; normally would throw. With bypass,
		// must NOT throw.
		let caught: unknown = null;
		try {
			enforceWebFetchAllowlist("https://bun.sh/blog/release-notes", {
				allowlist: ["docs.python.org"],
				profileRef: PROFILE_REF,
				recentSearchUrls: store,
			});
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeNull();
	});

	test("T-03.1-02-02 — different path on same hostname is NOT bypassed (exact URL match)", () => {
		const store = getOrCreateDefaultStore(300000);
		recordSearchUrl("https://bun.sh/blog/release-notes");
		// Attacker tries a different path on the same host. Must throw.
		let caught: unknown = null;
		try {
			enforceWebFetchAllowlist("https://bun.sh/evil-path", {
				allowlist: ["docs.python.org"],
				profileRef: PROFILE_REF,
				recentSearchUrls: store,
			});
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(WebFetchAllowlistError);
		expect((caught as WebFetchAllowlistError).hostname).toBe("bun.sh");
	});

	test("T-03.1-02-02 — recorded URL with query string ≠ URL without query string", () => {
		const store = getOrCreateDefaultStore(300000);
		recordSearchUrl("https://example.org/docs?ref=search");
		let caught: unknown = null;
		try {
			enforceWebFetchAllowlist("https://example.org/docs", {
				allowlist: [],
				profileRef: PROFILE_REF,
				recentSearchUrls: store,
			});
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(WebFetchAllowlistError);
	});

	test("TTL eviction — entry past ttlMs is gone; enforce throws", () => {
		// Build a store explicitly with a small TTL for testability. Use a
		// deterministic now() by calling prune() with an explicit nowMs.
		const store: RecentSearchUrlStore = getOrCreateDefaultStore(100);
		recordSearchUrl("https://bun.sh/blog");
		// Simulate time-advance past TTL via prune(explicit-nowMs):
		store.prune(Date.now() + 1000);
		expect(store.has("https://bun.sh/blog")).toBe(false);
		let caught: unknown = null;
		try {
			enforceWebFetchAllowlist("https://bun.sh/blog", {
				allowlist: [],
				profileRef: PROFILE_REF,
				recentSearchUrls: store,
			});
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(WebFetchAllowlistError);
	});

	test("recordSearchUrl with no explicit store initializes the default store lazily", () => {
		// Fresh state — no prior getOrCreateDefaultStore call.
		__resetSearchStoreForTests();
		recordSearchUrl("https://searched.example/path");
		const store = getOrCreateDefaultStore(300000);
		expect(store.has("https://searched.example/path")).toBe(true);
	});

	test("recentSearchUrls bypass PRECEDES allowlist check — cheaper path wins", () => {
		const store = getOrCreateDefaultStore(300000);
		// Record + allowlist BOTH match — bypass wins; still OK:
		recordSearchUrl("https://docs.python.org/3/");
		let caught: unknown = null;
		try {
			enforceWebFetchAllowlist("https://docs.python.org/3/", {
				allowlist: ["docs.python.org"],
				profileRef: PROFILE_REF,
				recentSearchUrls: store,
			});
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeNull();
	});

	test("no recentSearchUrls in ctx → existing allowlist behavior unchanged", () => {
		// Regression guard: absence of recentSearchUrls must not regress Plan
		// 03-06 behavior. Allowlisted host still passes.
		let caught: unknown = null;
		try {
			enforceWebFetchAllowlist("https://docs.python.org/3/", {
				allowlist: ["docs.python.org"],
				profileRef: PROFILE_REF,
			});
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeNull();
	});
});
