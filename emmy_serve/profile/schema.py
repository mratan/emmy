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

    # --- quantization ---
    quantization: Literal["fp8", "bf16", "auto"] = "fp8"

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
    "ToolsConfig",
    "AgentLoopConfig",
    "HarnessConfig",
    "CommunitySource",
    "ProfileManifest",
    "ProfileYaml",
]
