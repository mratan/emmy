// packages/emmy-ux/tests/sp-ok-canary.test.ts
//
// RED tests for runSpOk (Plan 02-04 Task 1).
//   - Mock server returns "[SP_OK]" -> ok:true
//   - Mock server returns thinking-CoT text without [SP_OK] -> ok:false
//   - Wire-shape payload: chat_template_kwargs.enable_thinking === false at TOP level (not under extra_body)
//   - SP_OK_SYSTEM_PROMPT byte-equal to the Python constant in emmy_serve/canary/sp_ok.py
//   - SP_OK_USER_MESSAGE === "ping", SP_OK_ASSERTION_SUBSTR === "[SP_OK]"
//   - Timeout case → throws NetworkError
//   - W1 FIX: sp-ok-canary imports postChat from "@emmy/provider" (bare); the test file imports runSpOk from the local module via package root.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Telemetry mock (sp-ok-canary does not emit, but the module tree imports @emmy/provider which may).
import { mock } from "bun:test";
mock.module("@emmy/telemetry", () => ({ emitEvent: (_r: unknown) => {} }));

// W1 FIX: sp-ok-canary imports postChat via the "@emmy/provider" package root.
// The test asserts the canary constants here via the UX package root.
import {
  runSpOk,
  SP_OK_ASSERTION_SUBSTR,
  SP_OK_SYSTEM_PROMPT,
  SP_OK_USER_MESSAGE,
  SpOkCanaryError,
} from "@emmy/ux";
import { NetworkError } from "@emmy/provider";

// Keep Bun.serve instances so afterEach can stop them.
const openServers: ReturnType<typeof Bun.serve>[] = [];
function makeServer(fetch: (req: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, fetch });
  openServers.push(server);
  return server;
}
afterEach(() => {
  while (openServers.length > 0) {
    const s = openServers.pop();
    try {
      s?.stop(true);
    } catch {
      /* ignore */
    }
  }
});

describe("SP_OK constants — byte-identical to Python source", () => {
  test("SP_OK_SYSTEM_PROMPT matches the Python constant in emmy_serve/canary/sp_ok.py", () => {
    const pySrc = readFileSync(
      "/data/projects/emmy/emmy_serve/canary/sp_ok.py",
      "utf8",
    );
    // Python: SP_OK_SYSTEM_PROMPT = ( "text 1" "text 2" )
    // Extract the concatenation of the parenthesised string literals.
    const m = pySrc.match(
      /SP_OK_SYSTEM_PROMPT\s*=\s*\(([^)]*)\)/m,
    );
    expect(m).not.toBeNull();
    const inside = m?.[1] ?? "";
    // Gather all double-quoted string-literals inside the parens and join them.
    const parts: string[] = [];
    const partRe = /"((?:[^"\\]|\\.)*)"/g;
    let part: RegExpExecArray | null;
    while ((part = partRe.exec(inside)) !== null) {
      parts.push(part[1] ?? "");
    }
    const pyValue = parts.join("");
    expect(SP_OK_SYSTEM_PROMPT).toBe(pyValue);
  });

  test("SP_OK_USER_MESSAGE === 'ping'", () => {
    expect(SP_OK_USER_MESSAGE).toBe("ping");
  });

  test("SP_OK_ASSERTION_SUBSTR === '[SP_OK]'", () => {
    expect(SP_OK_ASSERTION_SUBSTR).toBe("[SP_OK]");
  });
});

describe("runSpOk — wire shape + happy/failure paths", () => {
  test("ok:true when response contains '[SP_OK]'", async () => {
    const server = makeServer(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { role: "assistant", content: "[SP_OK]" },
                finish_reason: "stop",
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const out = await runSpOk(`http://127.0.0.1:${server.port}`, "qwen3.6-35b-a3b");
    expect(out.ok).toBe(true);
    expect(out.responseText).toContain("[SP_OK]");
  });

  test("ok:false when response is thinking CoT without assertion substring", async () => {
    const server = makeServer(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content:
                    "Thinking Process: The user says 'ping'. I should respond. Hmm, maybe I'll just say hello.",
                },
                finish_reason: "stop",
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const out = await runSpOk(`http://127.0.0.1:${server.port}`, "qwen3.6-35b-a3b");
    expect(out.ok).toBe(false);
    expect(out.responseText).toContain("Thinking Process");
  });

  test("request shape: chat_template_kwargs.enable_thinking === false at TOP level (not under extra_body)", async () => {
    let captured: Record<string, unknown> = {};
    const server = makeServer(async (r: Request) => {
      captured = JSON.parse(await r.text()) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { role: "assistant", content: "[SP_OK]" },
              finish_reason: "stop",
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    await runSpOk(`http://127.0.0.1:${server.port}`, "qwen3.6-35b-a3b");
    expect(captured.chat_template_kwargs).toBeDefined();
    expect((captured.chat_template_kwargs as { enable_thinking?: boolean }).enable_thinking).toBe(
      false,
    );
    // Must NOT be nested under extra_body.
    const extra = captured.extra_body as Record<string, unknown> | undefined;
    expect(extra?.chat_template_kwargs).toBeUndefined();
    // Also: temperature 0, max_tokens 32, stream false, messages contain the SP_OK system + ping
    expect(captured.temperature).toBe(0);
    expect(captured.max_tokens).toBe(32);
    expect(captured.stream).toBe(false);
    const messages = captured.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toBe(SP_OK_SYSTEM_PROMPT);
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toBe("ping");
  });

  test("timeout → throws NetworkError (postChat wraps AbortError)", async () => {
    // Server never responds — let postChat's 60s timeout fire via an override at the canary level is hard;
    // we instead point at a port that drops. Use a server that hangs.
    const server = makeServer(
      () => new Promise(() => {/* never resolves */}),
    );
    // Intercept global fetch to abort immediately (simulate network-level timeout).
    const origFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new DOMException("aborted", "AbortError"))) as typeof fetch;
    let thrown: unknown;
    try {
      await runSpOk(`http://127.0.0.1:${server.port}`, "qwen3.6-35b-a3b");
    } catch (e) {
      thrown = e;
    } finally {
      globalThis.fetch = origFetch;
    }
    expect(thrown).toBeInstanceOf(NetworkError);
  });
});

describe("SpOkCanaryError shape", () => {
  test("is an Error subclass carrying first 200 chars of response", () => {
    const long = "X".repeat(500);
    const err = new SpOkCanaryError(long);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SpOkCanaryError");
    expect(err.message).toContain("Pitfall #6");
    expect(err.message).toContain("X".repeat(200));
    expect(err.message).not.toContain("X".repeat(201));
  });
});
