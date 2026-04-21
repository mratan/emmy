// PLAN-03-MERGE-NOTE: Owned by Plan 02-03. Stubbed so native-tools.ts compiles.
// On merge-back: `git checkout --theirs packages/emmy-tools/src/text-binary-detect.ts`.

const NUL_SCAN_LIMIT = 8192;

export function isBinary(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  const end = Math.min(buf.length, NUL_SCAN_LIMIT);
  for (let i = 0; i < end; i++) if (buf[i] === 0) return true;
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
