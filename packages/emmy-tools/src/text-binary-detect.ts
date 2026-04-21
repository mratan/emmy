// D-08 fallback trigger: NUL-byte scan + UTF-8 round-trip.
// CONTEXT.md Claude's discretion: no `istextorbinary` dep needed — this is sufficient.
const NUL_SCAN_LIMIT = 8192;

export function isBinary(buf: Buffer): boolean {
	if (buf.length === 0) return false;
	const end = Math.min(buf.length, NUL_SCAN_LIMIT);
	for (let i = 0; i < end; i++) if (buf[i] === 0) return true;
	// UTF-8 round-trip: if decoding-then-re-encoding doesn't match, buffer is not
	// valid UTF-8 — treat as binary.
	try {
		const decoded = buf.toString("utf8");
		const re = Buffer.from(decoded, "utf8");
		if (re.length !== buf.length) return true;
		for (let i = 0; i < buf.length; i++) if (re[i] !== buf[i]) return true;
		return false;
	} catch {
		return true;
	}
}
