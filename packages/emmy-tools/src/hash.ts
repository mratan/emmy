// Hash primitives — D-06 SHA-256 truncated to 8 hex chars.
// Normalization matches emmy_serve/profile/hasher.py (Phase 1 hasher parity):
// NFC → CRLF→LF → CR→LF → UTF-8 encode. D-06 adds the 8-char truncation
// (see the single `.slice` call in hash8hex below).
import { createHash } from "node:crypto";
import { HasherError } from "./errors";

export function normalizeText(raw: string): string {
	// Lone-surrogate detection (JS strings are UTF-16). NFC on a lone surrogate
	// silently survives, so we explicitly reject before normalize().
	for (let i = 0; i < raw.length; i++) {
		const code = raw.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = raw.charCodeAt(i + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) {
				throw new HasherError(
					`lone high surrogate at index ${i}: U+${code.toString(16).toUpperCase()}`,
				);
			}
			i++; // skip validated low-surrogate half of the pair
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			throw new HasherError(
				`lone low surrogate at index ${i}: U+${code.toString(16).toUpperCase()}`,
			);
		}
	}
	const nfc = raw.normalize("NFC");
	return nfc.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function hash8hex(text: string): string {
	return createHash("sha256")
		.update(normalizeText(text), "utf8")
		.digest("hex")
		.slice(0, 8);
}

export { HasherError } from "./errors";
