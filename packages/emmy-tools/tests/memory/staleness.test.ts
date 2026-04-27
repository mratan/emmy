import { describe, expect, test } from "bun:test";
import {
	buildStalenessBanner,
	parseLastUpdatedHeader,
	withLastUpdatedHeader,
} from "../../src/memory/staleness";

describe("memory staleness — parseLastUpdatedHeader", () => {
	test("parses well-formed `last_updated: <ISO>` first line", () => {
		const text = "last_updated: 2026-04-26T10:00:00.000Z\n\nbody line\n";
		const r = parseLastUpdatedHeader(text);
		expect(r.iso).toBe("2026-04-26T10:00:00.000Z");
		expect(r.headerLength).toBe("last_updated: 2026-04-26T10:00:00.000Z\n".length);
	});

	test("returns no header when first line lacks the prefix", () => {
		const text = "Random first line\nlast_updated: 2026-04-26T10:00:00.000Z\n";
		const r = parseLastUpdatedHeader(text);
		expect(r.iso).toBeUndefined();
		expect(r.headerLength).toBe(0);
	});

	test("returns no header when ISO date is malformed", () => {
		const text = "last_updated: not-a-date\nbody\n";
		const r = parseLastUpdatedHeader(text);
		expect(r.iso).toBeUndefined();
		expect(r.headerLength).toBe(0);
	});
});

describe("memory staleness — buildStalenessBanner", () => {
	test("notes WITH last_updated get age in banner", () => {
		const now = new Date("2026-04-26T00:00:00.000Z");
		const text = "last_updated: 2026-04-20T00:00:00.000Z\n\nbody\n";
		const banner = buildStalenessBanner(text, now);
		expect(banner).toContain("Verify before trusting");
		expect(banner).toContain("2026-04-20T00:00:00.000Z");
		expect(banner).toContain("6 days ago");
	});

	test("notes WITHOUT last_updated get unknown-age banner", () => {
		const text = "no header here\nbody\n";
		const banner = buildStalenessBanner(text);
		expect(banner).toContain("Verify before trusting");
		expect(banner).toContain("no `last_updated:` metadata");
		expect(banner).toContain("Cross-check the current code");
	});

	test("0-day-old note shows 'today'", () => {
		const now = new Date("2026-04-26T12:00:00.000Z");
		const text = "last_updated: 2026-04-26T08:00:00.000Z\n\nbody\n";
		const banner = buildStalenessBanner(text, now);
		expect(banner).toContain("today");
	});

	test("1-day-old note shows '1 day ago' (singular)", () => {
		const now = new Date("2026-04-26T12:00:00.000Z");
		const text = "last_updated: 2026-04-25T08:00:00.000Z\n\nbody\n";
		const banner = buildStalenessBanner(text, now);
		expect(banner).toContain("1 day ago");
	});
});

describe("memory staleness — withLastUpdatedHeader", () => {
	test("prepends header when absent", () => {
		const out = withLastUpdatedHeader("hello world", new Date("2026-04-26T00:00:00.000Z"));
		expect(out).toBe("last_updated: 2026-04-26T00:00:00.000Z\n\nhello world");
	});

	test("refreshes existing header (replaces in-place)", () => {
		const old = "last_updated: 2026-04-20T00:00:00.000Z\n\nbody\n";
		const out = withLastUpdatedHeader(old, new Date("2026-04-26T00:00:00.000Z"));
		expect(out).toBe("last_updated: 2026-04-26T00:00:00.000Z\n\nbody\n");
	});

	test("handles empty body — header alone", () => {
		const out = withLastUpdatedHeader("", new Date("2026-04-26T00:00:00.000Z"));
		expect(out).toBe("last_updated: 2026-04-26T00:00:00.000Z\n");
	});

	test("malformed existing header is replaced (treated as absent)", () => {
		const old = "last_updated: malformed\nbody\n";
		const out = withLastUpdatedHeader(old, new Date("2026-04-26T00:00:00.000Z"));
		// Malformed → no header detected → prepended (with separator)
		expect(out.startsWith("last_updated: 2026-04-26T00:00:00.000Z\n\n")).toBe(true);
	});
});
