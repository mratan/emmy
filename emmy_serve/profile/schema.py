"""Pydantic v2 schema for profile bundles (01-RESEARCH.md §2, §3, §4, §6).

Every BaseModel gets `model_config = ConfigDict(extra='forbid', frozen=True)` —
this is the typo-safety + immutability floor for the keystone abstraction.

Field list copied from 01-RESEARCH.md §2 lines 502-585 (serving.yaml) and §3
lines 617-679 (harness.yaml). Cross-field rules from §2 lines 598-609.

D-03: schema is strict from v1 onward. No phase-scoped validation flags.
"""
from __future__ import annotations

import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# --- shared domain error class -------------------------------------------------


class ProfileConfigError(Exception):
    """Raised by loader layer when YAML fails schema or cross-field validation.

    The loader wraps `pydantic.ValidationError` with dotted-path messages so the
    D-06 diagnostic bundle and `emmy profile validate` stderr have the shape
    established by the prior repo's `ConfigError` (01-PATTERNS.md Pattern A).
    """


# --- shared regex --------------------------------------------------------------

_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_SHA256_PLACEHOLDER = "sha256:REPLACE_AT_FIRST_PULL"


# --- serving.yaml schema (01-RESEARCH.md §2) ----------------------------------


class EngineConfig(BaseModel):
    """vLLM engine config — every field maps to a `vllm serve` CLI flag.

    Changes to any field require a container restart (PROFILE-03); the pydantic
    layer does NOT enforce restart ergonomics, the boot orchestrator does.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    # --- immutable identity ---
    model: str
    model_hf_id: str
    # Phase 04.7 — explicit tokenizer override. Used by GGUF profiles where the
    # bundled GGUF tokenizer is "time-consuming and unstable" to extract per
    # vLLM GGUF docs; the recommended value is the base-model HF id (e.g.
    # "mistralai/Mistral-Medium-3.5-128B"). Default None = vLLM uses the value
    # of `model:` (HF model_id or local path). Strictly additive — every pre-
    # 04.7 profile validates with .tokenizer is None and renders identically.
    tokenizer: Optional[str] = None
    # Phase 04.7-02 (Workaround A) — explicit HF config path override. Used when
    # vLLM's GGUF backend cannot derive a usable HF config from the GGUF file
    # itself (e.g. transformers' GGUF parser does not yet allowlist a given
    # `general.architecture` string — Mistral 3.x's `mistral3` falls in this
    # gap as of vLLM 0.19.2rc1.dev134). Pointing at a directory that contains
    # config.json (and optionally tokenizer.json/tokenizer_config.json/
    # generation_config.json) lets vLLM's get_config() construct the
    # PretrainedConfig directly from those files, bypassing the GGUF parser
    # for everything except the actual weight load. Container-internal path —
    # the directory must be visible inside the container (typically mounted
    # under /models or /hf-cache). Default None = vLLM uses the value of
    # `model:` for config resolution. Strictly additive — every pre-04.7
    # profile validates with .hf_config_path is None and renders identically.
    hf_config_path: Optional[str] = None
    # Phase 04.7-02 follow-up (Decision Option 5, sitecustomize hot-patch
    # iteration, 2026-05-02). Profile-bundle-relative path to a directory of
    # Python hot-patches mounted into the vLLM container at /airgap_patches/
    # and prepended to PYTHONPATH so `sitecustomize.py` is auto-imported at
    # process start (BEFORE vLLM imports transformers). Used when an upstream
    # gap blocks boot AND the gap is small enough to bridge with a
    # narrowly-scoped runtime monkey-patch (e.g. the `mistral3` allowlist gap
    # in transformers 5.6.0 — see profiles/mistral-medium-3.5/v1/airgap_patches/
    # README.md for the canonical case). Each patch is opt-in via its own env
    # variable that the boot runner sets; the bind-mount alone does NOT enable
    # any patch. Container-internal mount path is fixed at /airgap_patches.
    # Strictly additive — every pre-04.7-02 profile validates with the field
    # unset and renders identically (no new bind-mount, no new env var).
    airgap_patch_dir: Optional[str] = None
    served_model_name: str
    container_image: str
    container_image_digest: str
    # Phase 4 v2 — optional per-profile `docker run --entrypoint` override.
    # NGC images carry `/opt/nvidia/nvidia_entrypoint.sh` which just `exec`s the
    # CMD, so the runner's default `vllm serve <flags>` CMD works as-is. Some
    # upstream images (e.g. `vllm/vllm-openai:gemma4-*-arm64-cu130`) bake
    # `[vllm serve]` as the ENTRYPOINT, which concatenates with the CMD and
    # breaks the CLI parse. Setting this to an empty string clears the
    # entrypoint so the CMD runs as the full exec chain. Unset = use image's
    # default ENTRYPOINT (backward-compat with Qwen v1/v2/v3/v3.1 profiles).
    container_entrypoint_override: Optional[str] = None

    # --- context + memory ---
    max_model_len: int = Field(gt=0)
    gpu_memory_utilization: float = Field(gt=0.0, le=1.0)
    kv_cache_dtype: Literal["auto", "fp8", "fp16", "bf16"] = "fp8"
    enable_prefix_caching: bool = True
    enable_chunked_prefill: bool = True
    max_num_batched_tokens: int = Field(gt=0)
    # Phase 4 — max_num_seqs (vLLM concurrent-sequence cap). Optional because
    # Qwen v1/v2/v3/v3.1 profiles don't ship it (vLLM default = 256 applies).
    # Gemma 4 v1 pins it to 4 per NVIDIA Day-1 DGX Spark recipe and as a
    # defensive knob against vLLM Gemma4ToolParser bug #39392 (pad-token leak
    # under concurrent batch). See 04-RESEARCH.md §2 + PROFILE_NOTES.md.
    max_num_seqs: Optional[int] = Field(default=None, gt=0)

    # --- loader ---
    load_format: Literal["auto", "fastsafetensors", "safetensors"] = "fastsafetensors"

    # Phase 04.7-02 follow-up Decision Option 5 (sitecustomize boot smoke
    # 2026-05-02). Optional dtype override for the model weights/computation.
    # Required for Mistral Medium 3.5 128B Q4_K_M GGUF: the upstream config.json
    # declares `"dtype": "bfloat16"` but vLLM's GGUF backend rejects bfloat16
    # with `torch.bfloat16 is not supported for quantization method gguf.
    # Supported dtypes: [torch.float16, torch.float32]` from
    # `vllm/engine/arg_utils.py:2094` create_engine_config (and the GGUF
    # backend separately warns "GGUF has precision issues with bfloat16 on
    # Blackwell" — gguf.py:69). Setting `float16` makes the GGUF backend
    # happy without forcing fp32 (which would double KV cache size).
    # Strictly additive — every pre-04.7-02-followup profile validates with
    # dtype=None and renders identically (vLLM auto-detects from config).
    dtype: Optional[Literal["auto", "float16", "bfloat16", "float32"]] = None

    # --- quantization ---
    # Phase 04.7 — "gguf" added for Mistral Medium 3.5 128B Q4_K_M (CONTEXT D-02).
    # vLLM experimental GGUF backend; long-context flagged WIP by Mistral. The
    # tokenizer field above is the partner setting — GGUF docs strongly recommend
    # passing --tokenizer <base-model-hf-id> rather than letting vLLM extract from
    # the bundled GGUF (slow + unstable). See profiles/mistral-medium-3.5/v1/.
    quantization: Literal["fp8", "bf16", "auto", "gguf"] = "fp8"

    # --- tool-call parser ---
    tool_call_parser: Optional[str] = None
    # Phase 4 D-17 — reasoning_parser is an optional vLLM flag separate from
    # tool_call_parser. Gemma 4 sets it to "gemma4" so the engine strips
    # reasoning tokens from the SSE stream; Qwen profiles leave it unset and
    # validate identically (backward-compat: Optional default None).
    reasoning_parser: Optional[str] = None
    enable_auto_tool_choice: bool = True

    # --- attention + backends ---
    attention_backend: Optional[str] = None

    # --- network / runtime ---
    host: str
    port: int = Field(gt=0, le=65535)

    @field_validator("container_image_digest")
    @classmethod
    def _digest_shape(cls, v: str) -> str:
        if v == _SHA256_PLACEHOLDER:
            raise ValueError(
                "container_image_digest is still the template sentinel "
                f"({_SHA256_PLACEHOLDER!r}) — run "
                "`docker pull nvcr.io/nvidia/vllm:26.03.post1-py3` then "
                "`docker inspect ... | jq -r '.[0].RepoDigests[0]'` and paste the real "
                "digest (see 01-RESEARCH.md §12)"
            )
        if not _SHA256.match(v):
            raise ValueError(
                f"container_image_digest must match sha256:<64 hex>, got {v!r}"
            )
        return v


class SamplingDefaults(BaseModel):
    """Prior-sampling settings; harness per-tool sampling overrides these."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    temperature: float = Field(ge=0.0, le=2.0)
    top_p: float = Field(gt=0.0, le=1.0)
    top_k: int = Field(gt=0)
    repetition_penalty: float = Field(gt=0.0)
    max_tokens: int = Field(gt=0)
    stop: list[str] = []


class GuidedDecoding(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    default_backend: Literal["xgrammar", "outlines", "guidance"]


class Quirks(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    strip_thinking_tags: bool
    promote_reasoning_to_content: bool
    buffer_tool_streams: bool


class EnvVars(BaseModel):
    """Environment variables set on the vLLM container.

    Cross-field policy (01-RESEARCH.md §2 lines 607-609):
      - VLLM_NO_USAGE_STATS must equal "1" (SERVE-09 / D-12 layer c)
      - HF_HUB_OFFLINE must equal "1" (REPRO-04 / D-12 layer d)

    These are correctness requirements, not defaults — a profile that weakens
    either is rejected at validate time.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)
    VLLM_NO_USAGE_STATS: str
    DO_NOT_TRACK: str
    VLLM_LOAD_FORMAT: str
    VLLM_FLASHINFER_MOE_BACKEND: str
    VLLM_DISABLE_COMPILE_CACHE: str
    HF_HUB_OFFLINE: str
    TRANSFORMERS_OFFLINE: str

    @model_validator(mode="after")
    def _airgap_policy(self) -> "EnvVars":
        if self.VLLM_NO_USAGE_STATS != "1":
            raise ValueError(
                'env.VLLM_NO_USAGE_STATS must equal "1" (SERVE-09, D-12 layer c)'
            )
        if self.HF_HUB_OFFLINE != "1":
            raise ValueError(
                'env.HF_HUB_OFFLINE must equal "1" (REPRO-04, D-12 layer d)'
            )
        return self


class ServingConfig(BaseModel):
    """Root of serving.yaml — one pydantic call validates the entire file."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    engine: EngineConfig
    sampling_defaults: SamplingDefaults
    # speculative=None in Phase 1 per CONTEXT.md deferred list / D-16.
    # Phase 6 will replace this with a SpeculativeConfig BaseModel.
    speculative: Optional[dict[str, Any]] = None
    guided_decoding: GuidedDecoding
    quirks: Quirks
    env: EnvVars


# --- harness.yaml schema (01-RESEARCH.md §3) ----------------------------------


class PromptsConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    system: str
    edit_format: Optional[str] = None
    tool_descriptions: Optional[str] = None
    use_system_role: bool
    prepend_system_text: str


class CompactionConfig(BaseModel):
    """Per-profile auto-compaction policy (Phase 3 D-11..D-17).

    Shipped in v3 as the first profile to carry the block; v2 (and v1) validate
    without it (Optional[CompactionConfig] = None on ContextConfig). See
    CONTEXT.md D-11..D-17 + ``packages/emmy-context/`` for the runtime that
    consumes this.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)
    soft_threshold_pct: float = Field(..., ge=0.0, le=1.0)
    preserve_recent_turns: int = Field(..., ge=0)
    summarization_prompt_path: str = Field(..., min_length=1)
    preserve_tool_results: Literal["error_only", "none", "all"] = "error_only"


class MemoryConfig(BaseModel):
    """Per-profile filesystem-memory tool config (Phase 04.4 plan 03).

    See `.planning/pre-phase/04.4-memory-compaction/MEMORY-TOOL-SPEC.md` §3.2
    for design + defaults rationale. The runtime tool lives at
    `packages/emmy-tools/src/memory/`; this schema is the only validated
    contract between profile bundles and that runtime.

    Fields:
      - enabled: master switch. False → tool not registered; description omitted.
      - project_root: relative-to-cwd dir for /memories/project/...; null = scope disabled.
      - global_root: ~-prefixed or absolute dir for /memories/global/...; null = scope disabled.
      - read_at_session_start: whether the instinct prompt fires at session boot.
      - max_file_bytes: per-file write cap (deliberate; forces consolidation).
      - max_total_bytes: per-scope cap (deliberate; prevents unbounded growth).
      - blocked_extensions: belt-and-braces secret-accumulation guard.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)
    enabled: bool = True
    project_root: Optional[str] = ".emmy/notes"
    global_root: Optional[str] = "~/.emmy/memory"
    read_at_session_start: bool = True
    max_file_bytes: int = Field(default=65536, gt=0)
    max_total_bytes: int = Field(default=10_485_760, gt=0)
    blocked_extensions: list[str] = Field(default_factory=lambda: [".env", ".key", ".pem"])

    @model_validator(mode="after")
    def _scope_cap_at_least_file_cap(self) -> "MemoryConfig":
        if self.max_total_bytes < self.max_file_bytes:
            raise ValueError(
                f"max_total_bytes ({self.max_total_bytes}) must be >= max_file_bytes "
                f"({self.max_file_bytes}) — a single max-size file must fit in the scope"
            )
        return self


class ContextConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    max_input_tokens: int = Field(gt=0)
    include_repo_map: bool
    repo_map_max_tokens: int = Field(ge=0)
    default_pruning: Literal["head_tail", "recency_window", "importance"]
    # D-15 — optional per-profile compaction policy. v1/v2 validate without it;
    # v3 ships the block. Presence is opt-in; absence means compaction disabled.
    compaction: Optional[CompactionConfig] = None
    # Phase 04.4 plan 03 — optional per-profile memory tool config. Profiles
    # without the block validate (None); the four shipped profiles (v3.1, v1.1,
    # v2, v1.1) ship the block. Runtime in packages/emmy-tools/src/memory/.
    memory: Optional[MemoryConfig] = None


class GrammarConfig(BaseModel):
    """Nested grammar config (Phase-2 D-11 lock — see CONTEXT.md §D-11).

    The pre-revision shape was a bare `str` (path only). Phase 2 locks a nested
    `{path, mode}` shape so the harness can carry the reactive/disabled knob
    alongside the grammar file. The `reactive` mode is Phase 2's production path
    per CLAUDE.md Pitfall #6 ("grammar is a correctness backstop, not a quality
    lever"); the `disabled` mode is reserved for the SC-3 no-grammar baseline
    (Plan 02-08, D-14).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)
    path: str
    mode: Literal["reactive", "disabled"] = "reactive"


class WebFetchConfig(BaseModel):
    """web_fetch allowlist policy (Phase 3 D-26..D-28 + Phase 3.1 D-35).

    Shipped in v3; v1/v2 validate without it (Optional[WebFetchConfig] = None on
    ToolsConfig). Hostname-EXACT matching enforced at runtime by
    ``packages/emmy-tools/src/web-fetch-allowlist.ts`` (Plan 03-06). An empty
    allowlist means default-deny (all non-loopback hosts blocked).

    Plan 03.1-02 D-35 — ``search_bypass_ttl_ms`` extends enforcement: URLs
    returned by a recent ``web_search`` call are fetchable without allowlist
    entry for ``search_bypass_ttl_ms`` milliseconds (default 300000 = 5 min).
    0 disables the bypass entirely. Exact URL match (NOT hostname substring)
    per T-03.1-02-02 SSRF mitigation.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)
    allowlist: list[str] = Field(default_factory=list)
    # D-35 — Plan 03.1-02 returned-URL bypass TTL (ms). 0 = disabled.
    search_bypass_ttl_ms: int = Field(default=300000, ge=0)


class WebSearchConfig(BaseModel):
    """web_search tool config (Phase 3.1 D-34).

    Shipped in v3.1; v1/v2/v3 validate without it (Optional[WebSearchConfig]
    = None on ToolsConfig). SearxNG JSON API at ``base_url`` is the only
    permitted target (loopback-only). Runtime enforcement in
    ``packages/emmy-tools/src/web-search.ts``.

    Knobs:
      - enabled: master switch. False or None → tool not registered.
      - base_url: SearxNG endpoint; MUST be loopback-bound for T-03.1-02
        trust-boundary containment.
      - max_results_default: returned to the model when it omits max_results.
      - rate_limit_per_turn: T-03.1-02-03 DoS guard; hard-cap per agent turn.
      - timeout_ms: per-call HTTP timeout; keeps agent loop responsive.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)
    enabled: bool = False
    base_url: str = "http://127.0.0.1:8888"
    max_results_default: int = Field(default=10, ge=1, le=50)
    rate_limit_per_turn: int = Field(default=10, ge=1, le=100)
    timeout_ms: int = Field(default=10000, ge=1000, le=60000)


class AskClaudeConfig(BaseModel):
    """ask_claude tool config (Phase 04.6 D-13).

    Per-profile opt-in for the model-side ``ask_claude`` tool that bridges to
    the Spark's locally-installed Claude Code CLI via the sidecar's
    ``POST /ask-claude`` endpoint. Strictly additive (D-04): all 7 currently-
    shipping bundles validate without this block (Optional[AskClaudeConfig] =
    None on ToolsConfig). Default ``enabled=False`` even when the block is
    present — D-13 requires an explicit operator gesture per profile.

    Runtime enforcement in ``packages/emmy-tools/src/ask-claude.ts``; sidecar
    pre-flight gate in ``emmy_serve/swap/ask_claude.py`` (Phase 04.6 plans
    04.6-01..04.6-06). Slash-command path (``/ask-claude``) bypasses these
    per-turn limits per D-05 (operator-only, no model-side gating). The
    sidecar still enforces the global hourly cap (D-07) regardless of
    invocation path.

    Knobs:
      - enabled: master switch. False or None → tool not registered for the
        model. Slash command remains operator-accessible regardless.
      - rate_limit_per_turn: D-07 per-turn harness-side gate; hard-cap on
        ``ask_claude`` calls per single agent turn. Cap (le=100) prevents
        accidental runaway-loop foot-guns (T-02).
      - rate_limit_per_hour: documented operator intent; the *enforcement*
        of the hourly limit lives sidecar-side (D-07 single-source-of-truth).
        Profile carries it for observability + audit; harness reads but does
        not enforce. Cap (le=1000) is a generous schema upper bound — sidecar
        ships its own ceiling (defaults to 30 per CONTEXT.md).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)
    enabled: bool = False
    rate_limit_per_turn: int = Field(default=5, gt=0, le=100)
    rate_limit_per_hour: int = Field(default=30, gt=0, le=1000)


class ToolsConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    format: Literal["openai", "hermes"]
    schemas: Optional[str] = None
    # Phase-2 D-11: nested GrammarConfig. None = no grammar configured (Phase 1
    # v1 default; the reactive-retry path fails loud with `no_grammar_configured`
    # when a model emits an unparseable tool-call).
    grammar: Optional[GrammarConfig] = None
    per_tool_sampling: dict[str, Any] = {}
    # D-26..D-28 — per-profile web_fetch allowlist. v1/v2 validate without it;
    # v3 ships the block. Runtime enforcement in @emmy/tools/web-fetch-allowlist.
    web_fetch: Optional[WebFetchConfig] = None
    # Phase 3.1 D-34 — per-profile web_search config. v1/v2/v3 validate without
    # it; v3.1 ships the block. Runtime enforcement in @emmy/tools/web-search.
    web_search: Optional[WebSearchConfig] = None
    # Phase 04.6 D-04 / D-13 — strictly-additive per-profile ask_claude config.
    # All 7 currently-shipping bundles validate without it (None); future
    # bundles flip enabled=True via Plan 04.6-05. Runtime enforcement in
    # @emmy/tools/ask-claude; sidecar enforcement in emmy_serve/swap/ask_claude.
    ask_claude: Optional[AskClaudeConfig] = None


class AgentLoopConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    max_iterations: int = Field(gt=0)
    retry_on_unparseable_tool_call: int = Field(ge=0)
    retry_on_empty_response: int = Field(ge=0)
    self_correction: Literal["enabled", "disabled"]


class VariantSamplingDefaults(BaseModel):
    """Phase 4 HARNESS-08 — variant-level sampling_defaults.

    Sibling variants under the same profile share a byte-identical serving.yaml
    (engine byte-identity invariant, CI-enforced in
    tests/unit/test_variant_engine_byte_identity.py). Per-turn sampling
    overrides therefore live in harness.yaml and are applied by
    packages/emmy-provider/src/before-request-hook.ts at wire time.

    All fields are OPTIONAL because a variant may only diverge on a subset
    (e.g. v3.1-default overrides nothing and v3.1-reason overrides only
    temperature + top_p). Absent fields fall through to the base serving.yaml
    sampling_defaults.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)
    temperature: Optional[float] = Field(default=None, ge=0.0, le=2.0)
    top_p: Optional[float] = Field(default=None, gt=0.0, le=1.0)
    top_k: Optional[int] = Field(default=None, gt=0)
    max_tokens: Optional[int] = Field(default=None, gt=0)
    repetition_penalty: Optional[float] = Field(default=None, gt=0.0)


class PersonaConfig(BaseModel):
    """One persona under harness.yaml `subagents.personas.<name>` (Phase 04.5 plan 02).

    See `.planning/pre-phase/04.5-subagents/INTEGRATION-SKETCH.md` § persona schema
    for design rationale; runtime in `packages/emmy-tools/src/subagent/`.

    Fields:
      - description: surfaced on the parent's tool description for `subagent_type` enum.
      - pattern: "lean" reuses parent services; "persona" loads a persona_dir.
      - persona_dir: REQUIRED when pattern == "persona"; relative to bundle root.
      - tool_allowlist: subset of parent tools the child may call (V3).
      - model_override: v1 single-model only — must be null for both patterns.
      - max_turns: child agent-loop hard cap.
      - persist_transcript: write child JSONL alongside parent's session dir.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)
    description: str
    pattern: Literal["lean", "persona"]
    persona_dir: Optional[str] = None
    tool_allowlist: list[str] = []
    model_override: Optional[str] = None
    max_turns: int = Field(default=10, gt=0)
    persist_transcript: bool = False

    @model_validator(mode="after")
    def _persona_pattern_needs_dir(self) -> "PersonaConfig":
        if self.pattern == "persona" and not self.persona_dir:
            raise ValueError("pattern='persona' requires persona_dir")
        if self.pattern == "lean" and self.persona_dir:
            raise ValueError("pattern='lean' must not declare persona_dir")
        if self.model_override is not None:
            raise ValueError(
                "model_override must be null in v1 (single-model only); "
                "cross-model dispatch deferred per 04.5 CONTEXT.md"
            )
        return self


class SubagentsConfig(BaseModel):
    """Per-profile sub-agent dispatch config (Phase 04.5 plan 02).

    See `.planning/pre-phase/04.5-subagents/INTEGRATION-SKETCH.md` for design
    rationale + LOCKED defaults. Runtime in `packages/emmy-tools/src/subagent/`.
    Profile bundles without a subagents block validate (None at HarnessConfig);
    the four shipped profiles (v3.1, v1.1, v2, v1.1) all ship the block.

    Fields:
      - enabled: master switch; false → Agent tool not registered.
      - max_concurrent: hardware cap on simultaneous children (LOCKED 2 on Spark).
      - long_context_serialize_threshold_tokens: parent input above which
        children serialize instead of running concurrently (40K LOCKED per
        04.5 CONTEXT.md V6 design).
      - default_memory_scope: project | global | none — children's memory scope.
      - personas: persona name → PersonaConfig.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)
    enabled: bool = True
    max_concurrent: int = Field(default=2, gt=0)
    long_context_serialize_threshold_tokens: int = Field(default=40000, gt=0)
    default_memory_scope: Literal["project", "global", "none"] = "project"
    personas: dict[str, PersonaConfig] = Field(default_factory=dict)


class HarnessConfig(BaseModel):
    """Root of harness.yaml — Phase-2 placeholder values allowed as long as they type-check."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    prompts: PromptsConfig
    context: ContextConfig
    tools: ToolsConfig
    agent_loop: AgentLoopConfig
    advanced_settings_whitelist: list[str] = []
    # Phase 4 HARNESS-08 (D-10 variant harness divergence) — optional variant-
    # level sampling_defaults. Applied per-turn by before_provider_request;
    # sibling variants of the same profile share a byte-identical serving.yaml
    # but may declare different harness-side sampling_defaults. v1/v2/v3/v3.1
    # base bundles validate without this block (None).
    sampling_defaults: Optional[VariantSamplingDefaults] = None
    # Phase 4 HARNESS-08 — optional variant-level chat_template_kwargs (e.g.
    # {"enable_thinking": true} on v3.1-reason). Merged into the outgoing chat
    # request's chat_template_kwargs by before_provider_request. Values are
    # free-form because upstream chat templates accept arbitrary keys; the
    # "no-model-conditionals" D-19 audit ensures we don't branch on these
    # values in code.
    chat_template_kwargs: Optional[dict[str, Any]] = None
    # Phase 04.5 plan 02 — optional per-profile sub-agent dispatch config.
    # Profiles without the block validate (None); the four shipped profiles
    # (v3.1, v1.1, v2, v1.1) ship the block. Runtime in
    # packages/emmy-tools/src/subagent/.
    subagents: Optional[SubagentsConfig] = None


# --- profile.yaml manifest (01-RESEARCH.md §4) --------------------------------


class CommunitySource(BaseModel):
    """One entry in profile.yaml.profile.community_sources (PROFILE-05)."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    title: str
    url: str
    retrieved: str  # YYYY-MM-DD


class ProfileManifest(BaseModel):
    """Inner `profile:` block of profile.yaml."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    version: str
    family: str
    base_model: str
    description: str
    created: str
    hash: str
    hash_algorithm: Literal["sha256"] = "sha256"
    hash_manifest_version: int = 1
    tags: list[str] = []
    community_sources: list[CommunitySource] = []

    @field_validator("hash")
    @classmethod
    def _hash_shape(cls, v: str) -> str:
        if not _SHA256.match(v):
            raise ValueError(
                f"hash must match sha256:<64 hex>, got {v!r} "
                "(run `emmy profile hash <path> --write` to compute)"
            )
        return v


class ProfileYaml(BaseModel):
    """Root of profile.yaml — wraps the manifest under a single `profile:` key."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    profile: ProfileManifest


__all__ = [
    "ProfileConfigError",
    "EngineConfig",
    "SamplingDefaults",
    "GuidedDecoding",
    "Quirks",
    "EnvVars",
    "ServingConfig",
    "PromptsConfig",
    "CompactionConfig",
    "MemoryConfig",
    "ContextConfig",
    "GrammarConfig",
    "WebFetchConfig",
    "WebSearchConfig",
    "AskClaudeConfig",
    "ToolsConfig",
    "AgentLoopConfig",
    "HarnessConfig",
    "CommunitySource",
    "ProfileManifest",
    "ProfileYaml",
]
