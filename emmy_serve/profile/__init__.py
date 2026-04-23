"""Emmy serving-layer profile subpackage.

The keystone abstraction: versioned model profiles (see CLAUDE.md §"Keystone
Abstraction"). Every field-change in any bundle file -> new version directory
(D-02). This package ships schema, loader, and hasher; `immutability.py` ships
the validator CLI that enforces the recompute-vs-stored hash invariant.
"""
from __future__ import annotations

from .hasher import (
    HASH_MANIFEST_VERSION,
    EXCLUDE_NAMES,
    EXCLUDE_SUFFIXES,
    HasherError,
    TEXT_EXTS,
    compute_manifest,
    hash_bundle,
)
from .loader import (
    ProfileRef,
    load_harness,
    load_profile,
    load_profile_manifest,
    load_serving,
)
from .schema import (
    AgentLoopConfig,
    CommunitySource,
    CompactionConfig,
    ContextConfig,
    EngineConfig,
    EnvVars,
    GrammarConfig,
    GuidedDecoding,
    HarnessConfig,
    ProfileConfigError,
    ProfileManifest,
    ProfileYaml,
    PromptsConfig,
    Quirks,
    SamplingDefaults,
    ServingConfig,
    ToolsConfig,
    WebFetchConfig,
    WebSearchConfig,
)

__all__ = [
    # schema
    "ServingConfig",
    "HarnessConfig",
    "ProfileManifest",
    "ProfileYaml",
    "EngineConfig",
    "SamplingDefaults",
    "GuidedDecoding",
    "Quirks",
    "EnvVars",
    "PromptsConfig",
    "CompactionConfig",
    "ContextConfig",
    "GrammarConfig",
    "WebFetchConfig",
    "WebSearchConfig",
    "ToolsConfig",
    "AgentLoopConfig",
    "CommunitySource",
    "ProfileConfigError",
    # loader
    "load_serving",
    "load_harness",
    "load_profile",
    "load_profile_manifest",
    "ProfileRef",
    # hasher
    "hash_bundle",
    "compute_manifest",
    "HasherError",
    "TEXT_EXTS",
    "EXCLUDE_NAMES",
    "EXCLUDE_SUFFIXES",
    "HASH_MANIFEST_VERSION",
]
