// packages/emmy-ux/test/pi-emmy-profile-autodetect.test.ts
//
// Plan 04-03 D-23 (followup) — pi-emmy auto-detects which profile bundle
// matches the sidecar's currently-loaded engine. Closes the gap that bites
// when an operator does /profile X then exits the TUI without swapping
// back: pi-emmy's hardcoded defaultProfilePath() points at the daily-driver
// bundle, but vLLM is now serving the swapped one. Without auto-detect,
// the next `emmy` launch sends `model: <default-name>` and gets a 404
// (confusing UX with no client-side recovery path).
//
// Test surface:
//   - fetchSidecarProfileId(serveUrl) parses /status correctly
//   - Returns null on every documented failure mode (network, non-200,
//     state != ready, missing/empty profile_id, malformed JSON)
//   - resolveBundleForProfileId works with a temp profiles/ tree
//
// We don't test main() integration directly — that's covered by the manual
// QA path documented in the commit message + the e2e smoke. These unit
// tests pin the helpers' contracts.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fetchSidecarProfileId, resolveBundleForProfileId } from "../bin/pi-emmy";

// ---------------------------------------------------------------------------
// fetchSidecarProfileId — happy path + 6 failure modes
// ---------------------------------------------------------------------------

describe("fetchSidecarProfileId", () => {
	let originalFetch: typeof fetch;

	beforeAll(() => {
		originalFetch = global.fetch;
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	function stubFetch(response: Response | Error): void {
		global.fetch = (async (..._args: unknown[]) => {
			if (response instanceof Error) throw response;
			return response;
		}) as typeof fetch;
	}

	test("returns profile_id when sidecar reports state=ready + profile_id set", async () => {
		stubFetch(
			new Response(
				JSON.stringify({ state: "ready", profile_id: "qwen3.6-27b" }),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		const id = await fetchSidecarProfileId("https://spark.example:8003");
		expect(id).toBe("qwen3.6-27b");
	});

	test("returns null when state is not ready (e.g. stopped)", async () => {
		stubFetch(
			new Response(
				JSON.stringify({ state: "stopped", profile_id: null }),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		const id = await fetchSidecarProfileId("https://spark.example:8003");
		expect(id).toBeNull();
	});

	test("returns null when profile_id is missing", async () => {
		stubFetch(
			new Response(JSON.stringify({ state: "ready" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const id = await fetchSidecarProfileId("https://spark.example:8003");
		expect(id).toBeNull();
	});

	test("returns null when profile_id is empty string", async () => {
		stubFetch(
			new Response(
				JSON.stringify({ state: "ready", profile_id: "" }),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		const id = await fetchSidecarProfileId("https://spark.example:8003");
		expect(id).toBeNull();
	});

	test("returns null on non-200 response", async () => {
		stubFetch(new Response("server error", { status: 500 }));
		const id = await fetchSidecarProfileId("https://spark.example:8003");
		expect(id).toBeNull();
	});

	test("returns null on network failure", async () => {
		stubFetch(new TypeError("connection refused"));
		const id = await fetchSidecarProfileId("https://spark.example:8003");
		expect(id).toBeNull();
	});

	test("returns null on malformed JSON body", async () => {
		stubFetch(
			new Response("not json at all", {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const id = await fetchSidecarProfileId("https://spark.example:8003");
		expect(id).toBeNull();
	});

	test("trims trailing slash from serveUrl when building /status URL", async () => {
		let observedUrl = "";
		global.fetch = (async (input: unknown) => {
			observedUrl = String(input);
			return new Response(JSON.stringify({ state: "ready", profile_id: "x" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as typeof fetch;
		await fetchSidecarProfileId("https://spark.example:8003/");
		expect(observedUrl).toBe("https://spark.example:8003/status");
	});
});

// ---------------------------------------------------------------------------
// resolveBundleForProfileId — temp profiles/ tree
// ---------------------------------------------------------------------------

describe("resolveBundleForProfileId", () => {
	let tmp: string;
	let profilesRoot: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "emmy-autodetect-"));
		profilesRoot = join(tmp, "profiles");
		mkdirSync(profilesRoot, { recursive: true });
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	function makeVariant(family: string, variant: string): void {
		// scanProfileIndex requires a profile.yaml inside a variant dir to count
		// it as a valid variant. We don't need real content for these tests —
		// scanProfileIndex only checks existsSync; the loader (loadProfile) is a
		// separate downstream call.
		mkdirSync(join(profilesRoot, family, variant), { recursive: true });
		writeFileSync(join(profilesRoot, family, variant, "profile.yaml"), "stub: true\n");
	}

	test("resolves to bundle path when profile_id matches a known family", () => {
		makeVariant("gemma-4-26b-a4b-it", "v2.1");
		makeVariant("gemma-4-26b-a4b-it", "v2");
		// Mark v2.1 as the family default so resolve(family) picks it.
		writeFileSync(join(profilesRoot, "gemma-4-26b-a4b-it", "DEFAULT_VARIANT"), "v2.1\n");

		const path = resolveBundleForProfileId(profilesRoot, "gemma-4-26b-a4b-it");
		expect(path).toBe(join(profilesRoot, "gemma-4-26b-a4b-it", "v2.1"));
	});

	test("returns null when profile_id has no matching family", () => {
		makeVariant("gemma-4-26b-a4b-it", "v2.1");
		const path = resolveBundleForProfileId(profilesRoot, "qwen3.6-27b");
		expect(path).toBeNull();
	});

	test("returns null when profilesRoot does not exist", () => {
		const path = resolveBundleForProfileId(join(tmp, "does-not-exist"), "anything");
		expect(path).toBeNull();
	});

	test("works without DEFAULT_VARIANT marker (falls back per scanProfileIndex precedence)", () => {
		// Single variant, no DEFAULT_VARIANT marker — resolve should still pick it.
		makeVariant("qwen3.6-27b", "v1.1");
		const path = resolveBundleForProfileId(profilesRoot, "qwen3.6-27b");
		expect(path).toBe(join(profilesRoot, "qwen3.6-27b", "v1.1"));
	});
});
