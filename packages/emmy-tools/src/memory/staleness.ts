// Phase 04.4-followup — note staleness metadata + view-time verify-before-trust banner.
//
// Diagnosis (V-RESULTS-v3 § "What v3 validates"): two prompt-language
// iterations on the memory instinct directive moved V1 adoption 5%→61%
// (PASS) but did NOT close the V3 rot vulnerability. Probe 1 trusted a
// rotted note over the truth file even with explicit verify-before-trust
// language in the system prompt. Conclusion: prompt language has hit
// diminishing returns; the rot fix needs to be tool-side, not directive-side.
//
// Design: every note carries a `last_updated:` ISO datetime as its FIRST
// LINE. Every `view` of a file prepends a verify-banner that:
//   - states the note's last_updated date + age (or "no last_updated metadata")
//   - explicitly tells the model to cross-check current code before trusting
//
// The banner lives in the view response's content text (visible to the model)
// but does NOT modify the underlying file. The metadata line on disk is
// auto-managed by the create / str_replace / insert commands.

const LAST_UPDATED_PREFIX = "last_updated:";

export interface ParsedHeader {
	/** ISO 8601 datetime parsed from `last_updated:` line, or undefined if absent/malformed. */
	iso?: string;
	/** Header line + trailing newline (length on disk), 0 if no header. */
	headerLength: number;
}

/**
 * Parse the `last_updated:` header from the first line of a note. Returns
 * `{ iso, headerLength }` if matched, else `{ headerLength: 0 }`.
 *
 * Spec:
 *   - First line MUST start with "last_updated: " (note the space)
 *   - Value MUST be a parseable ISO 8601 datetime
 *   - Anything else → no header, `iso: undefined`
 */
export function parseLastUpdatedHeader(text: string): ParsedHeader {
	const newlineIdx = text.indexOf("\n");
	const firstLine = newlineIdx === -1 ? text : text.slice(0, newlineIdx);
	if (!firstLine.startsWith(LAST_UPDATED_PREFIX)) return { headerLength: 0 };
	const iso = firstLine.slice(LAST_UPDATED_PREFIX.length).trim();
	const parsed = Date.parse(iso);
	if (Number.isNaN(parsed)) return { headerLength: 0 };
	const headerLength = newlineIdx === -1 ? text.length : newlineIdx + 1;
	return { iso, headerLength };
}

/**
 * Build the verify-before-trust banner shown above note content in `view`
 * responses. The banner is the load-bearing piece — the model sees it
 * EVERY time it reads a note, regardless of metadata presence.
 */
export function buildStalenessBanner(text: string, now: Date = new Date()): string {
	const parsed = parseLastUpdatedHeader(text);
	if (!parsed.iso) {
		return [
			"# ⚠ Verify before trusting",
			"",
			"This note has no `last_updated:` metadata — its age is unknown.",
			"Treat it as potentially stale. **Cross-check the current code** before",
			"relying on anything written here. Trust order: current code > recent",
			"notes > older notes.",
			"---",
			"",
		].join("\n");
	}
	const ageMs = now.getTime() - Date.parse(parsed.iso);
	const ageDays = Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
	const ageLabel =
		ageDays === 0
			? "today"
			: ageDays === 1
				? "1 day ago"
				: `${ageDays} days ago`;
	return [
		"# ⚠ Verify before trusting",
		"",
		`This note was last updated **${parsed.iso}** (${ageLabel}).`,
		"Notes can be stale. **Cross-check the current code** before relying on",
		"anything written here. Trust order: current code > recent notes > older",
		"notes.",
		"---",
		"",
	].join("\n");
}

/**
 * Wrap user-supplied note content with a `last_updated:` header. Used by
 * `create` (always prepends) and `str_replace` / `insert` (refreshes
 * existing header, or prepends if absent).
 */
export function withLastUpdatedHeader(
	body: string,
	now: Date = new Date(),
): string {
	const iso = now.toISOString();
	const headerLine = `${LAST_UPDATED_PREFIX} ${iso}`;
	const parsed = parseLastUpdatedHeader(body);
	if (parsed.iso) {
		// Replace existing header line.
		return `${headerLine}${body.slice(parsed.headerLength - 1)}`;
	}
	// Prepend new header (with blank line separator).
	if (body.length === 0) return `${headerLine}\n`;
	return `${headerLine}\n\n${body}`;
}
