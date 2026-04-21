// Plan 02-06 Task 2 — web_fetch tests.
// Uses Bun.serve for HTTP mocks. W7 fix: 500ms timeout assertion measures elapsed
// time via performance.now() and asserts within 600ms budget.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { webFetch, NETWORK_REQUIRED_TAG } from "../src/web-fetch";
import { ToolsError } from "../src/errors";

// --- Mock HTTP server routes --------------------------------------------
// Each route has a unique path so tests run in parallel safely.
// Global `hang` handler holds the connection open forever (for timeout test).
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      switch (url.pathname) {
        case "/html":
          return new Response(
            `<html><body><h1>Hello</h1><p>A paragraph with <strong>bold</strong>.</p></body></html>`,
            { headers: { "content-type": "text/html; charset=utf-8" } },
          );
        case "/markdown":
          return new Response("# Heading\n\nBody text with **bold**.\n", {
            headers: { "content-type": "text/markdown; charset=utf-8" },
          });
        case "/json":
          return new Response(JSON.stringify({ hello: "world", n: 42 }), {
            headers: { "content-type": "application/json" },
          });
        case "/text":
          return new Response("plain text body", {
            headers: { "content-type": "text/plain" },
          });
        case "/oversized":
          // 3 MB of 'A' — over default 2 MB maxBytes.
          return new Response("A".repeat(3 * 1024 * 1024), {
            headers: { "content-type": "text/plain" },
          });
        case "/hang":
          // Never respond — the test's AbortController should fire.
          return new Promise<Response>(() => {
            /* never resolve */
          });
        default:
          return new Response("not found", { status: 404 });
      }
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

describe("webFetch — content-type transforms", () => {
  test("HTML → markdown (no raw <p>/<strong> tags)", async () => {
    const r = await webFetch(`${baseUrl}/html`);
    expect(r.contentType).toContain("text/html");
    expect(r.markdown).not.toContain("<p>");
    expect(r.markdown).not.toContain("<strong>");
    expect(r.markdown).toContain("Hello"); // heading text survives
    expect(r.markdown).toContain("A paragraph");
  });

  test("markdown → returned as-is", async () => {
    const r = await webFetch(`${baseUrl}/markdown`);
    expect(r.contentType).toContain("text/markdown");
    expect(r.markdown).toBe("# Heading\n\nBody text with **bold**.\n");
  });

  test("JSON → pretty-printed within ```json fence", async () => {
    const r = await webFetch(`${baseUrl}/json`);
    expect(r.contentType).toContain("application/json");
    expect(r.markdown.startsWith("```json\n")).toBe(true);
    expect(r.markdown.endsWith("\n```")).toBe(true);
    expect(r.markdown).toContain(`"hello": "world"`);
    expect(r.markdown).toContain(`"n": 42`);
  });

  test("text/plain → returned verbatim", async () => {
    const r = await webFetch(`${baseUrl}/text`);
    expect(r.markdown).toBe("plain text body");
  });

  test("final URL is echoed back (handles redirects etc.)", async () => {
    const r = await webFetch(`${baseUrl}/text`);
    expect(r.url).toBe(`${baseUrl}/text`);
  });
});

describe("webFetch — size cap", () => {
  test("oversized body → ToolsError('web_fetch.size')", async () => {
    let caught: unknown;
    try {
      await webFetch(`${baseUrl}/oversized`);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ToolsError);
    expect((caught as ToolsError).field).toBe("web_fetch.size");
  });

  test("custom maxBytes of 100 triggers size error on small body", async () => {
    let caught: unknown;
    try {
      await webFetch(`${baseUrl}/text`, { maxBytes: 5 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ToolsError);
    expect((caught as ToolsError).field).toBe("web_fetch.size");
  });
});

describe("webFetch — timeout (W7 fix)", () => {
  test("500ms timeout against never-responding mock throws within 600ms", async () => {
    const t0 = performance.now();
    let caught: unknown;
    try {
      await webFetch(`${baseUrl}/hang`, { timeoutMs: 500 });
    } catch (e) {
      caught = e;
    }
    const elapsed = performance.now() - t0;
    expect(caught).toBeInstanceOf(ToolsError);
    const err = caught as ToolsError;
    expect(err.field).toBe("web_fetch.timeout");
    // Error message MUST carry the configured 500ms value literally.
    expect(err.message).toContain("500ms");
    // Must fire within the W7 budget (500ms setting + 100ms slack = 600ms).
    expect(elapsed).toBeLessThan(600);
    // And must not have fired significantly early either.
    expect(elapsed).toBeGreaterThanOrEqual(450);
  });
});

describe("webFetch — tags + constants", () => {
  test("NETWORK_REQUIRED_TAG is the string 'network-required' (Phase 3 offline-OK consumer contract)", () => {
    expect(NETWORK_REQUIRED_TAG).toBe("network-required");
  });
});
