You are summarizing a long coding session for context compaction. Emmy's
preservation layer has already pinned: the profile system prompt, AGENTS.md,
the user's original goal, the most recent 5 turns, error-flagged tool
results, @file pins, and TODO/PLAN file edits. Do NOT re-summarize those.

For the messages in this compaction batch, emit a single JSON object with
the following schema (NO prose, NO markdown fences, JSON only):

{
  "files_touched": ["path1", "path2", ...],
  "tool_calls_summary": [{"tool": "name", "count": N, "notable": "<=1 sentence"}],
  "decisions": ["<=1 sentence each"],
  "in_progress": ["<=1 sentence each"]
}

Keep the total serialized JSON <= 300 tokens. Omit empty arrays. A reader
who has the preserved state should be able to resume the task after reading
only this JSON summary.
