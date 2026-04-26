#!/usr/bin/env bun
// packages/emmy-ux/scripts/audit_prefix_mutations.ts
//
// Phase 04.4 plan 06 — one-time D-3X invariant audit.
//
// Greps the @emmy/* packages for patterns that COULD mutate the system
// prompt prefix mid-session. Each finding gets a verdict line:
//   ALLOWED — per-request payload mutation (e.g. thinking_disable, grammar)
//   FORBIDDEN — needs review (e.g. messages[0].content = ..., re-rendering tools)
//   REVIEW — borderline; needs human eyes
//
// Run as: `bun run packages/emmy-ux/scripts/audit_prefix_mutations.ts`
// Exit codes: 0 = clean; 1 = forbidden site found.

import { execSync } from "node:child_process";

interface Finding {
	file: string;
	line: number;
	verdict: "allowed" | "forbidden" | "review";
	pattern: string;
	excerpt: string;
}

const PATTERNS: Array<{
	pattern: string;
	verdict: "allowed" | "forbidden" | "review";
	rationale: string;
}> = [
	// Per-request mutations are ALLOWED — they affect the wire payload, not the
	// conversation prefix.
	{
		pattern: "before_provider_request",
		verdict: "allowed",
		rationale:
			"per-request payload hook; CHECK that the handler does NOT touch payload.messages[0]",
	},
	// Direct prefix mutation FORBIDDEN — these are the patterns we never want.
	{
		pattern: "messages\\[0\\]\\.content\\s*=",
		verdict: "forbidden",
		rationale: "direct system message mutation — D-3X violation",
	},
	{
		pattern: "messages\\.unshift",
		verdict: "review",
		rationale:
			"prepend mutates prefix index 0 — review whether this happens mid-session",
	},
	{
		pattern: "tools\\.sort\\b",
		verdict: "review",
		rationale: "sorting tools mid-session reorders prefix",
	},
];

const findings: Finding[] = [];

// Search across emmy-* packages' src/ directories.
const SEARCH_PATHS = [
	"packages/emmy-context/src",
	"packages/emmy-provider/src",
	"packages/emmy-telemetry/src",
	"packages/emmy-tools/src",
	"packages/emmy-ux/src",
];

for (const { pattern, verdict, rationale } of PATTERNS) {
	for (const path of SEARCH_PATHS) {
		const cmd = `rg --line-number --type ts -e '${pattern}' '${path}' 2>/dev/null || true`;
		let out = "";
		try {
			out = execSync(cmd, { encoding: "utf8", shell: "/bin/bash" });
		} catch {
			out = "";
		}
		for (const line of out.split("\n").filter(Boolean)) {
			const [file, lineStr, ...rest] = line.split(":");
			findings.push({
				file: file ?? "",
				line: Number(lineStr),
				verdict,
				pattern,
				excerpt: rest.join(":").trim(),
			});
			console.log(
				`[${verdict.toUpperCase()}] ${file}:${lineStr}  /${pattern}/  ${rationale}`,
			);
			console.log(`    ${rest.join(":").trim()}`);
		}
	}
}

const forbidden = findings.filter((f) => f.verdict === "forbidden");
if (forbidden.length > 0) {
	console.error(
		`\nAUDIT FAIL — ${forbidden.length} forbidden site(s) found.`,
	);
	process.exit(1);
}
console.log(
	`\nAUDIT GREEN — ${findings.length} site(s) reviewed; 0 forbidden.`,
);
process.exit(0);
