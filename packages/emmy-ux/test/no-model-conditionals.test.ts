// packages/emmy-ux/test/no-model-conditionals.test.ts
//
// D-19 LOCKED. TypeScript counterpart of tests/unit/test_no_model_conditionals.py.
// Two modes:
//   1. Self-test: target the fixture, REQUIRE audit regex to fire.
//   2. Real mode: walk packages/*/src ex. allowlist, REQUIRE zero hits.
//
// Enforces Phase 4 SC-2 verbatim on the TS side: "neither profile contains
// model-name-conditional code paths in the harness or serve layers — all
// model-shaped behavior is in YAML." Runs under `bun test` on every CI pass.
//
// Allowlist discipline (documented here VERBATIM per the plan's key_links):
//   Path-fragment matches (any occurrence in absolute path):
//       /node_modules/         — third-party JS/TS deps
//       /dist/                 — build output
//       /.vitest_cache/        — test runner cache
//       /test/fixtures/        — deliberate positives; read only by self-test
//       /.git/                 — git internals
//       /.claude/              — agent tooling + parallel worktrees
//   Explicit file allowlist (absolute paths):
//       this file itself       — contains the regex pattern
//       the positive fixture   — deliberate violations
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Same pattern set as the Python side (fewer keywords — JS/TS has if/else/switch/case;
// no elif/match/when). Case-insensitive; conditional keyword + model name on SAME line.
const PATTERN = /(?:\b(if|else\s+if|else|switch|case)\b).*\b(qwen|gemma|hermes|llama)\b/i;

const HERE = dirname(fileURLToPath(import.meta.url));
const THIS_FILE = fileURLToPath(import.meta.url);
// HERE = .../packages/emmy-ux/test; REPO_ROOT is three levels up.
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const FIXTURE_POSITIVE = join(HERE, "fixtures", "no-model-conditionals-positive.ts");

const SCAN_ROOTS = [
    "packages/emmy-ux/src",
    "packages/emmy-telemetry/src",
    "packages/emmy-provider/src",
    "packages/emmy-tools/src",
    "packages/emmy-context/src",
].map((r) => join(REPO_ROOT, r));

const ALLOWLIST_PATHS = new Set<string>([
    resolve(THIS_FILE),         // this file itself contains the regex
    resolve(FIXTURE_POSITIVE),  // deliberate positive
]);

const ALLOWLIST_DIR_FRAGMENTS = [
    "/node_modules/",
    "/dist/",
    "/.vitest_cache/",
    "/test/fixtures/",
    "/.git/",
    "/.claude/",
];

function isAllowlisted(absPath: string): boolean {
    if (ALLOWLIST_PATHS.has(absPath)) return true;
    for (const frag of ALLOWLIST_DIR_FRAGMENTS) {
        if (absPath.includes(frag)) return true;
    }
    return false;
}

function* iterTsFiles(root: string): Generator<string> {
    try {
        if (!statSync(root).isDirectory()) return;
    } catch {
        return;
    }
    for (const name of readdirSync(root)) {
        const full = join(root, name);
        let s;
        try {
            s = statSync(full);
        } catch {
            continue;
        }
        if (s.isDirectory()) {
            if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
            yield* iterTsFiles(full);
        } else if (s.isFile() && (full.endsWith(".ts") || full.endsWith(".tsx"))) {
            if (isAllowlisted(full)) continue;
            yield full;
        }
    }
}

function findHits(path: string): Array<{ line: number; text: string }> {
    const hits: Array<{ line: number; text: string }> = [];
    let text: string;
    try {
        text = readFileSync(path, "utf8");
    } catch {
        return hits;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith("//")) continue; // line comment
        if (trimmed.startsWith("*") || trimmed.startsWith("/*")) continue; // block-comment continuation
        if (PATTERN.test(line)) hits.push({ line: i + 1, text: line });
    }
    return hits;
}

describe("D-19 no-model-conditionals audit", () => {
    test("audit catches fixture (self-test)", () => {
        // If this fails, the PATTERN regex has been weakened and no longer
        // detects the intended violations — revert whatever commit broke it.
        const hits = findHits(FIXTURE_POSITIVE);
        expect(hits.length).toBeGreaterThanOrEqual(2);
    });

    test("no model-name conditionals in TS source tree (real mode)", () => {
        // If this fails, a production .ts file has introduced a
        // model-name-conditional code path (SC-2 violation). Refactor the
        // model-shaped behavior into profile YAML before merging.
        const violations: Array<{ path: string; hits: Array<{ line: number; text: string }> }> = [];
        for (const root of SCAN_ROOTS) {
            for (const p of iterTsFiles(root)) {
                const hits = findHits(p);
                if (hits.length > 0) violations.push({ path: p, hits });
            }
        }
        if (violations.length > 0) {
            const msg = violations
                .flatMap((v) =>
                    v.hits.map(
                        (h) => `  ${relative(REPO_ROOT, v.path)}:${h.line}: ${h.text.trim()}`,
                    ),
                )
                .join("\n");
            throw new Error(`model-name conditional(s) found in TS source (SC-2 violation):\n${msg}`);
        }
        expect(violations.length).toBe(0);
    });
});
