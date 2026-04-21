#!/usr/bin/env bun
// eval/phase2/sc4/test_mcp_fs_server.ts
//
// Minimal in-process MCP filesystem server (SC-4 test double).
//
// Exposes two tools — `fs_read_file` and `fs_list_dir` — scoped to a sandbox
// root passed as argv[2]. Communicates via stdio per MCP spec. Used by
// run_sc4.ts as the "real MCP server dispatches identically to native"
// evidence (no external binary required).
//
// This is NOT a production MCP server — it's the minimum surface needed to
// prove the bridge's flat-name registration + dispatch path. Phase 3+ will
// use real MCP servers (filesystem, github, playwright) in production.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const SANDBOX_ROOT = process.argv[2] ? resolve(process.argv[2]) : "/tmp/emmy-sc4-root";

function safePath(relOrAbs: string): string {
	const candidate = isAbsolute(relOrAbs) ? relOrAbs : join(SANDBOX_ROOT, relOrAbs);
	const r = resolve(candidate);
	if (!r.startsWith(SANDBOX_ROOT)) {
		throw new Error(`path escapes sandbox: ${relOrAbs}`);
	}
	return r;
}

async function main(): Promise<void> {
	const server = new Server(
		{ name: "emmy-sc4-fs-server", version: "0.1.0" },
		{ capabilities: { tools: {} } },
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: [
			{
				name: "fs_read_file",
				description: "Read a text file from the sandbox.",
				inputSchema: {
					type: "object",
					properties: { path: { type: "string" } },
					required: ["path"],
				},
			},
			{
				name: "fs_list_dir",
				description: "List a directory inside the sandbox.",
				inputSchema: {
					type: "object",
					properties: { path: { type: "string" } },
					required: ["path"],
				},
			},
		],
	}));

	server.setRequestHandler(CallToolRequestSchema, async (req) => {
		const { name, arguments: args } = req.params as {
			name: string;
			arguments: { path?: string };
		};
		const p = safePath(String(args?.path ?? ""));
		if (name === "fs_read_file") {
			const content = readFileSync(p, "utf8");
			return { content: [{ type: "text", text: content }] };
		}
		if (name === "fs_list_dir") {
			const entries = readdirSync(p).map((e) => {
				const abs = join(p, e);
				let kind = "?";
				try {
					const st = statSync(abs);
					kind = st.isDirectory() ? "dir" : st.isFile() ? "file" : "other";
				} catch {
					/* fall through */
				}
				return `${e} (${kind})`;
			});
			return { content: [{ type: "text", text: entries.join("\n") }] };
		}
		throw new Error(`unknown tool: ${name}`);
	});

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((e) => {
	console.error(`fs-server: FATAL: ${e instanceof Error ? e.message : String(e)}`);
	process.exit(1);
});
