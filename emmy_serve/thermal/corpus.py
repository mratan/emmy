"""Thermal replay corpus: 5 prior coding prompts + 6 synthetic agent-shape
prompts + 6 tool-call-shape prompts per RESEARCH.md §9.4.

Purpose (D-14): sustain representative GPU load for 2 hours. The prior-repo's
5 functional coding tasks (§9.1) are kept for continuity but under-exercise
prefill and lack tool-call shape; §9.4 prescribes augmentation to cover
10K/20K/30K prefill sizes, long-output decode, and multi-turn tool-call
alternation. Every prompt text is deterministic (no random seeds) so the
corpus content hash is stable across re-generation.

Pattern F (01-PATTERNS.md) — field-by-field analog of the prior repo's
validation/eval_tasks.py EvalTask. Dropped: rubric, execution_mode,
allowed_tools (thermal replay measures wire behavior, not correctness).
Added: expected_prefill_tokens + expected_decode_tokens for the §9.5
audit math.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ThermalPrompt:
    """One prompt in the thermal corpus.

    ``expected_prefill_tokens`` is a deterministic estimate from the
    generated text (≈ len(text) / 4) so the §9.5 audit math is
    reproducible without running the model. The replay harness logs
    the real ``usage.prompt_tokens`` / ``usage.completion_tokens`` from
    vLLM; any large divergence between expected_* and actual_* is a
    corpus-drift signal worth investigating (Rule 1 bug territory).
    """

    task_id: str
    category: str  # "coding" | "agent_synthetic" | "tool_sequence"
    difficulty: str  # "easy" | "medium" | "hard"
    title: str
    prompt: str
    expected_prefill_tokens: int
    expected_decode_tokens: int
    max_tokens: int = 4096
    includes_tool_call: bool = False


# ---------------------------------------------------------------------------
# §9.1 — Prior-repo coding prompts (verbatim continuity from
# /data/projects/setup_local_opencode/validation/eval_tasks.py CODE_01..CODE_05)
# ---------------------------------------------------------------------------

CODE_01 = ThermalPrompt(
    task_id="code_01",
    category="coding",
    difficulty="easy",
    title="CSV CLI tool",
    prompt=(
        "Write a Python CLI tool that reads a CSV file and prints summary "
        "statistics.\n\nRequirements:\n"
        "- Accept a CSV file path as a command-line argument using argparse\n"
        "- Print: number of rows, number of columns, column names\n"
        "- For numeric columns: print mean, min, max\n"
        "- For non-numeric columns: print number of unique values\n"
        "- Handle errors gracefully: file not found, empty file, malformed CSV\n"
        "- Use only the standard library (csv, argparse, statistics)\n\n"
        "Output the complete, runnable Python script."
    ),
    # ~492 chars / 4 ≈ 123 tokens; we use 150 to account for chat-template overhead
    expected_prefill_tokens=150,
    expected_decode_tokens=1400,  # historical avg ~1400 tokens per EXECUTIVE_SUMMARY.md
    max_tokens=2048,
)

CODE_02 = ThermalPrompt(
    task_id="code_02",
    category="coding",
    difficulty="easy",
    title="Fibonacci optimization",
    prompt=(
        "Write three Python implementations of Fibonacci number computation:\n\n"
        "1. fib_recursive(n) — naive recursive (exponential time)\n"
        "2. fib_memo(n) — memoized recursive (linear time)\n"
        "3. fib_iterative(n) — iterative bottom-up (linear time, O(1) space)\n\n"
        "Then write a benchmark that:\n"
        "- Computes fib(30) with all three and prints each result\n"
        "- Times each implementation using time.perf_counter()\n"
        "- Prints a comparison showing the speedup of memo and iterative vs recursive\n\n"
        "Output the complete, runnable Python script."
    ),
    expected_prefill_tokens=160,
    expected_decode_tokens=1400,
    max_tokens=2048,
)

CODE_03 = ThermalPrompt(
    task_id="code_03",
    category="coding",
    difficulty="easy",
    title="Pytest for email validator",
    prompt=(
        "Given this email validation function:\n\n"
        "```python\nimport re\n\n"
        "def is_valid_email(email: str) -> bool:\n"
        "    if not isinstance(email, str):\n"
        "        return False\n"
        "    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{2,}$'\n"
        "    return bool(re.match(pattern, email))\n```\n\n"
        "Write a comprehensive pytest test suite for this function. Requirements:\n\n"
        "1. Use @pytest.mark.parametrize for valid and invalid email test cases\n"
        "2. Include at least 10 valid emails and 10 invalid emails\n"
        "3. Test edge cases: empty string, None, integers, very long emails, special characters\n"
        "4. Include a test that identifies a FALSE NEGATIVE — an email that is technically valid "
        "per RFC 5321 but rejected by this regex. Explain why in a comment.\n"
        "5. Group tests logically with clear test function names\n\n"
        "Output the complete test file (including the import of the function or inline definition)."
    ),
    expected_prefill_tokens=260,
    expected_decode_tokens=2000,
    max_tokens=3072,
)

CODE_04 = ThermalPrompt(
    task_id="code_04",
    category="coding",
    difficulty="medium",
    title="Debug binary search with 2 bugs",
    prompt=(
        "The following binary search implementation has exactly TWO bugs. Find both bugs, "
        "fix them, and explain each one.\n\n"
        "```python\n"
        "def binary_search(arr, target):\n"
        "    \"\"\"Return index of target in sorted array, or -1 if not found.\"\"\"\n"
        "    left = 0\n"
        "    right = len(arr)  # Bug is somewhere around here or not\n\n"
        "    while left < right:\n"
        "        mid = (left + right) // 2\n"
        "        if arr[mid] == target:\n"
        "            return mid\n"
        "        elif arr[mid] < target:\n"
        "            left = mid\n"
        "        else:\n"
        "            right = mid - 1\n\n"
        "    return -1\n```\n\n"
        "Requirements:\n"
        "1. Identify and describe BOTH bugs precisely (what's wrong and why it causes incorrect behavior)\n"
        "2. Provide the corrected implementation\n"
        "3. Explain the loop invariant that the correct version maintains\n"
        "4. Write 5 test cases that would catch these bugs (at least one test per bug), including "
        "edge cases (empty array, single element, target not present, first element, last element)\n"
        "5. Show the output of running your test cases\n\n"
        "Output the complete fixed code with tests."
    ),
    expected_prefill_tokens=300,
    expected_decode_tokens=2600,
    max_tokens=4096,
)

CODE_05 = ThermalPrompt(
    task_id="code_05",
    category="coding",
    difficulty="hard",
    title="LRU cache from scratch",
    prompt=(
        "Implement an LRU (Least Recently Used) cache from scratch in Python.\n\n"
        "Requirements:\n"
        "1. Implement using a doubly-linked list and a hash map — do NOT use OrderedDict or "
        "functools.lru_cache\n"
        "2. Class LRUCache(capacity: int) with methods:\n"
        "   - get(key) -> value or -1  (moves key to most-recently-used)\n"
        "   - put(key, value) -> None  (adds or updates; evicts LRU if at capacity)\n"
        "3. Both get and put must be O(1) time complexity\n"
        "4. Implement the doubly-linked list node class explicitly\n"
        "5. Write tests covering these scenarios:\n"
        "   a. Basic get/put\n"
        "   b. Eviction when capacity exceeded\n"
        "   c. Access pattern updates recency (get refreshes position)\n"
        "   d. Update existing key (put with existing key updates value and recency)\n"
        "   e. Capacity of 1 (edge case)\n"
        "6. Include brief comments explaining your design choices\n\n"
        "Output the complete implementation with all tests."
    ),
    expected_prefill_tokens=280,
    expected_decode_tokens=2800,
    max_tokens=4096,
)

PRIOR_CODING_TASKS: list[ThermalPrompt] = [CODE_01, CODE_02, CODE_03, CODE_04, CODE_05]


# ---------------------------------------------------------------------------
# §9.4 — Synthetic agent-shape prompts (pasted-file / multi-file / history)
#
# Deterministic generators: each _build_*() returns the same text every call so
# the corpus content is stable and the emmy_serve.profile.hasher sees the same
# bytes on every run. These simulate mid-session agent state that the prior
# prompts don't exercise (§9.3 verdict: not representative of sustained stress).
# ---------------------------------------------------------------------------


def _build_pasted_python_file(approx_tokens: int) -> str:
    """Generate a ~approx_tokens-token synthetic Python file.

    Uses 4 chars/token as the approximation. Content is a 200-function data-model
    module so it pattern-matches a real pasted file without random noise (the
    model sees repeating-but-structured Python, which is what long-context
    prefills look like in practice).
    """
    target_chars = approx_tokens * 4
    header = (
        '"""Synthetic data-model module (thermal corpus filler).\n\n'
        "Deterministically generated for reproducibility. Simulates the shape of a\n"
        "real pasted-file context in a mid-session coding agent interaction.\n"
        '"""\n'
        "from __future__ import annotations\n\n"
        "from dataclasses import dataclass\n"
        "from typing import Optional\n\n"
    )
    out = [header]
    i = 0
    while sum(len(s) for s in out) < target_chars:
        block = (
            f"\n@dataclass\n"
            f"class Entity{i:04d}:\n"
            f'    """Entity {i} — represents a data record for testing thermal pipelines."""\n'
            f"    id_{i}: int\n"
            f"    name_{i}: str\n"
            f"    label_{i}: Optional[str] = None\n"
            f"    created_at_{i}: Optional[int] = None\n"
            f"    updated_at_{i}: Optional[int] = None\n\n"
            f"    def describe_{i}(self) -> str:\n"
            f'        return f"Entity {i}: id={{self.id_{i}}} name={{self.name_{i}}}"\n\n'
            f"    def normalize_{i}(self) -> 'Entity{i:04d}':\n"
            f"        return Entity{i:04d}(\n"
            f"            id_{i}=self.id_{i},\n"
            f"            name_{i}=self.name_{i}.strip().lower() if self.name_{i} else '',\n"
            f"            label_{i}=self.label_{i},\n"
            f"            created_at_{i}=self.created_at_{i} or 0,\n"
            f"            updated_at_{i}=self.updated_at_{i} or 0,\n"
            f"        )\n"
        )
        out.append(block)
        i += 1
    return "".join(out)


def _build_multifile_codebase(approx_tokens: int) -> str:
    """Generate a ~approx_tokens-token multi-file codebase dump.

    Files are separated by `# --- <path> --- ` headers so the model sees a
    realistic multi-file context (Phase 2+ agent sessions will pass repo
    extracts in this shape).
    """
    target_chars = approx_tokens * 4
    out = []
    file_idx = 0
    while sum(len(s) for s in out) < target_chars:
        path = f"src/module_{file_idx:03d}.py"
        file_tokens = min(2500, approx_tokens - (sum(len(s) for s in out) // 4))
        body = _build_pasted_python_file(max(400, file_tokens))
        out.append(f"\n# --- {path} ---\n{body}\n")
        file_idx += 1
        if file_idx > 30:
            break  # defensive upper bound
    return "".join(out)


def _build_conversation_history(approx_tokens: int) -> str:
    """Generate a ~approx_tokens-token conversation history transcript.

    Simulates the kind of long back-and-forth that accumulates over a
    daily-driver session before a "fix the bug in foo.py" follow-up.
    """
    target_chars = approx_tokens * 4
    out = ["# Prior conversation history (for context)\n\n"]
    turn = 0
    while sum(len(s) for s in out) < target_chars:
        if turn % 2 == 0:
            block = (
                f"## Turn {turn} — User\n\n"
                f"Can you help me refactor the authentication module in `src/auth.py`? "
                f"Currently the login flow handles {turn * 3 + 5} different user roles "
                f"via a long if/elif chain. I'd like to switch to a registry pattern "
                f"where each role registers its permission set at import time. "
                f"Specifically, the functions `check_read_access()`, "
                f"`check_write_access()`, `check_admin_access()` all share boilerplate "
                f"that I want to factor out. Show me the refactored code and explain "
                f"the trade-offs.\n\n"
            )
        else:
            block = (
                f"## Turn {turn} — Assistant\n\n"
                f"Here's the refactored approach. I've introduced a `RoleRegistry` class "
                f"that accepts decorator-style registration:\n\n"
                f"```python\n"
                f"class RoleRegistry:\n"
                f"    def __init__(self):\n"
                f"        self._registry = {{}}\n\n"
                f"    def register(self, role_name, permissions):\n"
                f"        self._registry[role_name] = frozenset(permissions)\n\n"
                f"    def check(self, role, required):\n"
                f"        if role not in self._registry:\n"
                f"            return False\n"
                f"        return required in self._registry[role]\n\n"
                f"registry = RoleRegistry()\n"
                f"registry.register('admin', {{'read', 'write', 'admin'}})\n"
                f"registry.register('user_{turn}', {{'read', 'write'}})\n"
                f"```\n\n"
                f"The trade-off is that roles are registered at import time rather than "
                f"evaluated lazily. This means a misconfigured role fails on module load "
                f"(fail-fast), which is usually desirable. For per-request role checks "
                f"the `check()` call is O(1) versus the O(N) if/elif chain you had.\n\n"
            )
        out.append(block)
        turn += 1
        if turn > 200:
            break
    return "".join(out)


# Long deterministic bodies — computed once at import time.
_PASTED_10K = _build_pasted_python_file(10000)
_MULTIFILE_20K = _build_multifile_codebase(20000)
_HISTORY_30K = _build_conversation_history(30000)
_PASTED_15K = _build_pasted_python_file(15000)
_HISTORY_12K = _build_conversation_history(12000)


AGENT_10K_REFACTOR = ThermalPrompt(
    task_id="agent_10k_refactor",
    category="agent_synthetic",
    difficulty="medium",
    title="10K-token refactor prompt",
    prompt=(
        f"{_PASTED_10K}\n\n"
        "Refactor the Entity classes above to use a registry pattern instead of the "
        "ad-hoc describe/normalize methods. Introduce a single `EntityRegistry` "
        "class that entities register against at class-definition time, and "
        "rewrite describe/normalize as registry-dispatched methods. Show the "
        "full refactored module."
    ),
    expected_prefill_tokens=10000,
    expected_decode_tokens=8000,
    max_tokens=8192,
)

AGENT_20K_MULTIFILE = ThermalPrompt(
    task_id="agent_20k_multifile",
    category="agent_synthetic",
    difficulty="hard",
    title="20K-token multi-file add-feature prompt",
    prompt=(
        f"{_MULTIFILE_20K}\n\n"
        "Add a feature to the codebase above: every Entity subclass should gain an "
        "async `persist()` method that writes itself to a shared `EntityStore` "
        "(use aiosqlite). Provide the new EntityStore class in a new file "
        "`src/store.py`, and diff each existing module to add the `persist()` "
        "implementation. Include tests in `tests/test_store.py` that cover "
        "concurrent persists and retrieval."
    ),
    expected_prefill_tokens=20000,
    expected_decode_tokens=12000,
    max_tokens=8192,
)

AGENT_30K_HISTORY = ThermalPrompt(
    task_id="agent_30k_history",
    category="agent_synthetic",
    difficulty="hard",
    title="30K-token long-history bug-fix prompt",
    prompt=(
        f"{_HISTORY_30K}\n\n"
        "## Turn 201 — User\n\n"
        "Going back to the RoleRegistry we built earlier — I'm seeing a bug in "
        "production where `check()` sometimes returns True for roles that were "
        "unregistered after being registered (mutation across threads). Fix the "
        "bug in `src/auth.py` and explain the race condition."
    ),
    expected_prefill_tokens=30000,
    expected_decode_tokens=4000,
    max_tokens=4096,
)

AGENT_LONG_OUTPUT_12K = ThermalPrompt(
    task_id="agent_long_output_12k",
    category="agent_synthetic",
    difficulty="hard",
    title="12K-prefill + long-planning-output prompt",
    prompt=(
        f"{_HISTORY_12K}\n\n"
        "## Turn — User\n\n"
        "Given the full conversation above, produce a detailed migration plan "
        "(4K+ tokens output) for moving this auth module from the current "
        "registry pattern to a plugin architecture where each role lives in its "
        "own Python module under `src/roles/`. Include: directory structure, "
        "import-resolution plan, backwards-compatibility strategy, test migration "
        "plan, and a phased rollout (4 phases)."
    ),
    expected_prefill_tokens=12000,
    expected_decode_tokens=8000,
    max_tokens=8192,
)

AGENT_15K_PASTED = ThermalPrompt(
    task_id="agent_15k_pasted",
    category="agent_synthetic",
    difficulty="medium",
    title="15K-token pasted-file analysis",
    prompt=(
        f"{_PASTED_15K}\n\n"
        "Analyze the module above and write a concise architectural critique "
        "(~2K tokens output): what patterns are overused, what abstractions are "
        "leaking, and how would you break the file into smaller modules."
    ),
    expected_prefill_tokens=15000,
    expected_decode_tokens=6000,
    max_tokens=8192,
)

AGENT_SHORT_OUTPUT = ThermalPrompt(
    task_id="agent_short_output",
    category="agent_synthetic",
    difficulty="easy",
    title="Short-output (tool-call-shape) prompt",
    prompt=(
        "In exactly one line, what Python standard library module parses TOML?"
    ),
    expected_prefill_tokens=50,
    expected_decode_tokens=80,
    max_tokens=128,
)


_PASTED_6K = _build_pasted_python_file(6000)
_PASTED_8K = _build_pasted_python_file(8000)
_MULTIFILE_18K = _build_multifile_codebase(18000)


AGENT_6K_DEBUG = ThermalPrompt(
    task_id="agent_6k_debug",
    category="agent_synthetic",
    difficulty="medium",
    title="6K-token debug prompt",
    prompt=(
        f"{_PASTED_6K}\n\n"
        "There's a subtle bug in this module: the `normalize_N` methods mutate "
        "their input when they should return a new instance. Identify every "
        "method that has this bug and produce a patch."
    ),
    expected_prefill_tokens=6000,
    expected_decode_tokens=3500,
    max_tokens=4096,
)

AGENT_8K_REFACTOR = ThermalPrompt(
    task_id="agent_8k_refactor",
    category="agent_synthetic",
    difficulty="medium",
    title="8K-token refactor prompt",
    prompt=(
        f"{_PASTED_8K}\n\n"
        "Extract the repeated `describe_N`/`normalize_N` boilerplate from this "
        "module into a base class `EntityBase` with abstract hooks, then rewrite "
        "the first five Entity classes to inherit from it."
    ),
    expected_prefill_tokens=8000,
    expected_decode_tokens=4500,
    max_tokens=6144,
)

AGENT_18K_MULTIFILE_TRACE = ThermalPrompt(
    task_id="agent_18k_multifile_trace",
    category="agent_synthetic",
    difficulty="hard",
    title="18K-token multi-file call-graph trace",
    prompt=(
        f"{_MULTIFILE_18K}\n\n"
        "For the multi-file codebase above, trace the call graph starting from "
        "Entity0000.describe_0 and list every function that is reachable. Group "
        "the reachable set by file and note any cross-file dependencies."
    ),
    expected_prefill_tokens=18000,
    expected_decode_tokens=6000,
    max_tokens=8192,
)


SYNTHETIC_AGENT_PROMPTS: list[ThermalPrompt] = [
    AGENT_10K_REFACTOR,
    AGENT_20K_MULTIFILE,
    AGENT_30K_HISTORY,
    AGENT_LONG_OUTPUT_12K,
    AGENT_15K_PASTED,
    AGENT_18K_MULTIFILE_TRACE,
    AGENT_8K_REFACTOR,
    AGENT_6K_DEBUG,
    AGENT_SHORT_OUTPUT,
]


# ---------------------------------------------------------------------------
# §9.4 — Tool-call-shape prompts (agent-loop alternation)
#
# These prompts carry `includes_tool_call=True` so the §9.5 audit's 20%
# tool-call threshold is computable without actually running the model; the
# replay harness posts them as ordinary /v1/chat/completions calls (real
# tool round-trips live in Plan 05's air_gap/session.jsonl, which is
# scripted turn-by-turn — the audit just needs the shape marker).
# ---------------------------------------------------------------------------


def _build_multiturn_context(approx_tokens: int) -> str:
    """Simulate a multi-turn session where prior tool calls + results
    accumulate in the history (agent-loop alternation)."""
    target_chars = approx_tokens * 4
    out = []
    turn = 0
    while sum(len(s) for s in out) < target_chars:
        block = (
            f"\n# Turn {turn}\n"
            f"User: Read the file /tmp/example_{turn}.py and summarize its functions.\n"
            f"Assistant [tool_call read_file(path='/tmp/example_{turn}.py')]\n"
            f"Tool: def process_{turn}(items):\n"
            f"    return [transform_{turn}(x) for x in items]\n"
            f"\n"
            f"def transform_{turn}(x):\n"
            f"    return x * 2 + {turn}\n"
            f"Assistant: The file defines process_{turn}() which applies "
            f"transform_{turn}() to each item in a list. transform_{turn} "
            f"doubles the input and adds {turn}.\n"
        )
        out.append(block)
        turn += 1
        if turn > 100:
            break
    return "".join(out)


TOOL_SEQ_SIMPLE_READ = ThermalPrompt(
    task_id="tool_seq_simple_read",
    category="tool_sequence",
    difficulty="easy",
    title="Simple read_file tool call",
    prompt="Read /tmp/example.py and tell me what functions it defines.",
    expected_prefill_tokens=100,
    expected_decode_tokens=250,
    max_tokens=512,
    includes_tool_call=True,
)

TOOL_SEQ_WRITE_THEN_READ = ThermalPrompt(
    task_id="tool_seq_write_then_read",
    category="tool_sequence",
    difficulty="easy",
    title="Write-then-read tool call sequence",
    prompt=(
        "Write a simple hello-world Python script to /tmp/hello.py, then "
        "read it back and confirm its contents."
    ),
    expected_prefill_tokens=120,
    expected_decode_tokens=300,
    max_tokens=512,
    includes_tool_call=True,
)

TOOL_SEQ_BASH_RESULT = ThermalPrompt(
    task_id="tool_seq_bash_result",
    category="tool_sequence",
    difficulty="easy",
    title="Bash command with result interpretation",
    prompt=(
        "Run `ls -la /tmp` and tell me the three largest files by size."
    ),
    expected_prefill_tokens=100,
    expected_decode_tokens=300,
    max_tokens=512,
    includes_tool_call=True,
)


_MULTITURN_5K = _build_multiturn_context(5000)
_MULTITURN_8K = _build_multiturn_context(8000)
_MULTITURN_12K = _build_multiturn_context(12000)


TOOL_SEQ_MULTITURN_5K = ThermalPrompt(
    task_id="tool_seq_multiturn_5k",
    category="tool_sequence",
    difficulty="medium",
    title="5K-token multi-turn tool-call history + follow-up",
    prompt=(
        f"{_MULTITURN_5K}\n\n"
        "User: Now summarize the pattern across all the transform_N functions I "
        "asked about above — is the doubling + offset behavior consistent?"
    ),
    expected_prefill_tokens=5000,
    expected_decode_tokens=3000,
    max_tokens=4096,
    includes_tool_call=True,
)

TOOL_SEQ_MULTITURN_8K = ThermalPrompt(
    task_id="tool_seq_multiturn_8k",
    category="tool_sequence",
    difficulty="medium",
    title="8K-token multi-turn tool-call history + refactor ask",
    prompt=(
        f"{_MULTITURN_8K}\n\n"
        "User: Refactor all transform_N functions into a single "
        "`transform(x, offset)` — show me the diff for each file."
    ),
    expected_prefill_tokens=8000,
    expected_decode_tokens=4000,
    max_tokens=4096,
    includes_tool_call=True,
)

TOOL_SEQ_MULTITURN_12K = ThermalPrompt(
    task_id="tool_seq_multiturn_12k",
    category="tool_sequence",
    difficulty="hard",
    title="12K-token multi-turn tool-call history + planning ask",
    prompt=(
        f"{_MULTITURN_12K}\n\n"
        "User: Looking at all the tool calls above, propose a single shared "
        "helper module that eliminates the boilerplate across all transform_N "
        "and process_N functions. Plan the refactor in detail before writing code."
    ),
    expected_prefill_tokens=12000,
    expected_decode_tokens=6000,
    max_tokens=6144,
    includes_tool_call=True,
)

TOOL_SEQ_GREP_FILES = ThermalPrompt(
    task_id="tool_seq_grep_files",
    category="tool_sequence",
    difficulty="easy",
    title="Grep then summarize matches",
    prompt=(
        "Search all Python files under /tmp for the string 'TODO', then list "
        "the three files with the most TODO occurrences."
    ),
    expected_prefill_tokens=110,
    expected_decode_tokens=400,
    max_tokens=512,
    includes_tool_call=True,
)

TOOL_SEQ_EDIT_AFTER_READ = ThermalPrompt(
    task_id="tool_seq_edit_after_read",
    category="tool_sequence",
    difficulty="easy",
    title="Read-then-edit sequence",
    prompt=(
        "Read /tmp/config.py, then replace every occurrence of 'DEBUG = True' "
        "with 'DEBUG = False' via the edit tool."
    ),
    expected_prefill_tokens=130,
    expected_decode_tokens=400,
    max_tokens=512,
    includes_tool_call=True,
)


_MULTITURN_3K = _build_multiturn_context(3000)
_MULTITURN_6K = _build_multiturn_context(6000)
_MULTITURN_10K = _build_multiturn_context(10000)


TOOL_SEQ_MULTITURN_3K = ThermalPrompt(
    task_id="tool_seq_multiturn_3k",
    category="tool_sequence",
    difficulty="medium",
    title="3K-token multi-turn tool-call follow-up",
    prompt=(
        f"{_MULTITURN_3K}\n\n"
        "User: Write one unit test that covers every transform_N function "
        "referenced above."
    ),
    expected_prefill_tokens=3000,
    expected_decode_tokens=1500,
    max_tokens=2048,
    includes_tool_call=True,
)

TOOL_SEQ_MULTITURN_6K = ThermalPrompt(
    task_id="tool_seq_multiturn_6k",
    category="tool_sequence",
    difficulty="medium",
    title="6K-token multi-turn tool-call refactor",
    prompt=(
        f"{_MULTITURN_6K}\n\n"
        "User: Propose a factory function that eliminates the repetition "
        "across the process_N functions you saw above."
    ),
    expected_prefill_tokens=6000,
    expected_decode_tokens=3500,
    max_tokens=4096,
    includes_tool_call=True,
)


TOOL_SEQ_MULTITURN_10K = ThermalPrompt(
    task_id="tool_seq_multiturn_10k",
    category="tool_sequence",
    difficulty="hard",
    title="10K-token multi-turn tool-call audit",
    prompt=(
        f"{_MULTITURN_10K}\n\n"
        "User: Across the tool-call history above, identify any transform_N "
        "functions that return negative numbers for positive input. List them "
        "and propose a sign-check fix."
    ),
    expected_prefill_tokens=10000,
    expected_decode_tokens=5000,
    max_tokens=4096,
    includes_tool_call=True,
)


TOOL_CALL_SEQUENCE: list[ThermalPrompt] = [
    TOOL_SEQ_SIMPLE_READ,
    TOOL_SEQ_WRITE_THEN_READ,
    TOOL_SEQ_BASH_RESULT,
    TOOL_SEQ_GREP_FILES,
    TOOL_SEQ_EDIT_AFTER_READ,
    TOOL_SEQ_MULTITURN_3K,
    TOOL_SEQ_MULTITURN_5K,
    TOOL_SEQ_MULTITURN_6K,
    TOOL_SEQ_MULTITURN_8K,
    TOOL_SEQ_MULTITURN_10K,
    TOOL_SEQ_MULTITURN_12K,
]


# ---------------------------------------------------------------------------
# Combined corpus
# ---------------------------------------------------------------------------

ALL_THERMAL_PROMPTS: list[ThermalPrompt] = (
    PRIOR_CODING_TASKS + SYNTHETIC_AGENT_PROMPTS + TOOL_CALL_SEQUENCE
)


def get_prompt(task_id: str) -> ThermalPrompt:
    """Lookup by task_id; raises KeyError if not found."""
    for p in ALL_THERMAL_PROMPTS:
        if p.task_id == task_id:
            return p
    raise KeyError(task_id)


__all__ = [
    "ThermalPrompt",
    "CODE_01",
    "CODE_02",
    "CODE_03",
    "CODE_04",
    "CODE_05",
    "PRIOR_CODING_TASKS",
    "AGENT_10K_REFACTOR",
    "AGENT_20K_MULTIFILE",
    "AGENT_30K_HISTORY",
    "AGENT_LONG_OUTPUT_12K",
    "AGENT_15K_PASTED",
    "AGENT_18K_MULTIFILE_TRACE",
    "AGENT_8K_REFACTOR",
    "AGENT_6K_DEBUG",
    "AGENT_SHORT_OUTPUT",
    "SYNTHETIC_AGENT_PROMPTS",
    "TOOL_SEQ_SIMPLE_READ",
    "TOOL_SEQ_WRITE_THEN_READ",
    "TOOL_SEQ_BASH_RESULT",
    "TOOL_SEQ_GREP_FILES",
    "TOOL_SEQ_EDIT_AFTER_READ",
    "TOOL_SEQ_MULTITURN_3K",
    "TOOL_SEQ_MULTITURN_5K",
    "TOOL_SEQ_MULTITURN_6K",
    "TOOL_SEQ_MULTITURN_8K",
    "TOOL_SEQ_MULTITURN_10K",
    "TOOL_SEQ_MULTITURN_12K",
    "TOOL_CALL_SEQUENCE",
    "ALL_THERMAL_PROMPTS",
    "get_prompt",
]
