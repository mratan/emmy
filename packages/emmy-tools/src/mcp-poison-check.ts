// Plan 02-06 Task 1 — Unicode poison blocklist (D-18).
//
// Blocks any codepoint in Unicode category Cf (format), Co (private use),
// or Cs (surrogate), plus the bidi-override ranges:
//   U+202A..U+202E  — LRE/RLE/PDF/LRO/RLO
//   U+2066..U+2069  — LRI/RLI/FSI/PDI
//
// Applied to every MCP tool's `name` AND `description` at registration time.
// Rejected tools are NOT added to the active tool registry (see mcp-bridge.ts).
// Prompt-injection detection is explicitly NOT implemented in Phase 2 (CONTEXT.md
// D-18): the false-positive surface is too high for a registration-time gate;
// lived-experience data from Phase 2+ informs the next layer in Phase 3.

import { PoisonError } from "./errors";

const BIDI_RANGES: ReadonlyArray<{ lo: number; hi: number; name: string }> = [
  { lo: 0x202a, hi: 0x202e, name: "bidi U+202A-U+202E" },
  { lo: 0x2066, hi: 0x2069, name: "bidi U+2066-U+2069" },
];

const RE_CF = /\p{Cf}/u;
const RE_CO = /\p{Co}/u;

/**
 * Throw PoisonError if `text` contains any blocked codepoint.
 * `field` is preserved in the error for clearer diagnostics ("rejected name: ..."
 * vs "rejected description: ...").
 *
 * Order of checks per codepoint:
 *   1. UTF-16 surrogate scan (Cs) — must run first because JS strings are
 *      UTF-16 and lone surrogates break later iteration via `for..of`.
 *   2. Bidi-override ranges — bidi codepoints are ALSO category Cf, but the
 *      range-specific categoryOrRange string is more actionable, so we emit
 *      that first.
 *   3. Generic Cf / Co categories.
 */
export function assertNoPoison(text: string, field: "name" | "description"): void {
  // Step 1: scan UTF-16 code units for lone surrogates (Cs). Must happen before
  // for..of because for..of iterates by codepoint and would throw on a lone
  // surrogate OR silently yield the replacement character depending on runtime.
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      // High surrogate — MUST be followed by a low surrogate.
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new PoisonError(code, "Cs (surrogate)", field);
      }
      i++; // skip the low surrogate; the pair is a legitimate scalar value
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // Lone low surrogate — illegal.
      throw new PoisonError(code, "Cs (surrogate)", field);
    }
  }

  // Step 2 & 3: scalar-value scan for bidi ranges + Cf/Co.
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    // Bidi-override ranges take precedence over the generic Cf classification.
    for (const r of BIDI_RANGES) {
      if (cp >= r.lo && cp <= r.hi) {
        throw new PoisonError(cp, r.name, field);
      }
    }
    if (RE_CO.test(ch)) {
      throw new PoisonError(cp, "Co (private use)", field);
    }
    if (RE_CF.test(ch)) {
      throw new PoisonError(cp, "Cf (format)", field);
    }
  }
}

export { PoisonError } from "./errors";
