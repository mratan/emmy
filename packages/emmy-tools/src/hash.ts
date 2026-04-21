// PLAN-03-MERGE-NOTE: This file is OWNED by Plan 02-03. Stubbed here so that
// Plan 02-06's native-tools.ts compiles in isolation. On merge-back the
// orchestrator should `git checkout --theirs packages/emmy-tools/src/hash.ts`.
//
// This stub matches Plan 02-03's intended contract (D-05, D-06):
//   - SHA-256, lowercase hex, truncated to first 8 chars.
//   - Normalization: NFC + CRLF→LF + CR→LF.
//   - Lone-surrogate detection → HasherError.

import { createHash } from "node:crypto";
import { HasherError } from "./errors";

export function normalizeText(raw: string): string {
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = raw.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new HasherError(`lone high surrogate at index ${i}: U+${code.toString(16).toUpperCase()}`);
      }
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new HasherError(`lone low surrogate at index ${i}: U+${code.toString(16).toUpperCase()}`);
    }
  }
  const nfc = raw.normalize("NFC");
  return nfc.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function hash8hex(text: string): string {
  return createHash("sha256").update(normalizeText(text), "utf8").digest("hex").slice(0, 8);
}

export { HasherError } from "./errors";
