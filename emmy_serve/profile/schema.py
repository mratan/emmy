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

    # --- context + memory ---
    max_model_len: int = Field(gt=0)
    gpu_memory_utilization: float = Field(gt=0.0, le=1.0)
    kv_cache_dtype: Literal["auto", "fp8", "fp16", "bf16"] = "fp8"
    enable_prefix_caching: bool = True
    enable_chunked_prefill: bool = True
    max_num_batched_tokens: int = Field(gt=0)

    # --- loader ---
    load_format: Literal["auto", "fastsafetensors", "safetensors"] = "fastsafetensors"

    # --- quantization ---
    quantization: Literal["fp8", "bf16", "auto"] = "fp8"

    # --- tool-call parser ---
    tool_call_parser: Optional[str] = None
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


class ContextConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    max_input_tokens: int = Field(gt=0)
    include_repo_map: bool
    repo_map_max_tokens: int = Field(ge=0)
    default_pruning: Literal["head_tail", "recency_window", "importance"]
    # D-15 — optional per-profile compaction policy. v1/v2 validate without it;
    # v3 ships the block. Presence is opt-in; absence means compaction disabled.
    compaction: Optional[CompactionConfig] = None


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
    """web_fetch allowlist policy (Phase 3 D-26..D-28).

    Shipped in v3; v1/v2 validate without it (Optional[WebFetchConfig] = None on
    ToolsConfig). Hostname-EXACT matching enforced at runtime by
    ``packages/emmy-tools/src/web-fetch-allowlist.ts`` (Plan 03-06). An empty
    allowlist means default-deny (all non-loopback hosts blocked).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)
    allowlist: list[str] = Field(default_factory=list)


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


class AgentLoopConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    max_iterations: int = Field(gt=0)
    retry_on_unparseable_tool_call: int = Field(ge=0)
    retry_on_empty_response: int = Field(ge=0)
    self_correction: Literal["enabled", "disabled"]


class HarnessConfig(BaseModel):
    """Root of harness.yaml — Phase-2 placeholder values allowed as long as they type-check."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    prompts: PromptsConfig
    context: ContextConfig
    tools: ToolsConfig
    agent_loop: AgentLoopConfig
    advanced_settings_whitelist: list[str] = []


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
    "ContextConfig",
    "GrammarConfig",
    "WebFetchConfig",
    "ToolsConfig",
    "AgentLoopConfig",
    "HarnessConfig",
    "CommunitySource",
    "ProfileManifest",
    "ProfileYaml",
]
