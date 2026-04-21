"""YAML -> pydantic loaders for serving.yaml / harness.yaml / profile.yaml.

File-I/O boundary: `load_serving / load_harness / load_profile_manifest` read
a YAML file and return a validated pydantic model, or raise `ProfileConfigError`
with a dotted-path message compatible with the D-06 diagnostic bundle shape.

Shape copied from 01-PATTERNS.md Pattern A — the prior repo's
`dgx_stack/config.py` / `dgx_stack/providers/config.py` typed-YAML loader,
rewritten against pydantic v2 (01-RESEARCH.md §6).
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml
from pydantic import ValidationError

from .schema import (
    HarnessConfig,
    ProfileConfigError,
    ProfileYaml,
    ServingConfig,
)


@dataclass(frozen=True)
class ProfileRef:
    """Compact reference for every observability event (Shared Pattern 3).

    Every log record, every run summary, every thermal sample embeds these
    three fields so a record can always be traced back to the exact profile
    bundle that produced it.
    """

    id: str
    version: str
    hash: str
    path: Path


def _load_yaml(path: Path) -> dict:
    """Read a YAML file, raising `ProfileConfigError` with the file path on failure."""
    if not path.exists():
        raise ProfileConfigError(f"file not found: {path}")
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as e:
        raise ProfileConfigError(f"yaml parse error in {path}: {e}") from e


def _dotted_path(loc: tuple) -> str:
    """Map pydantic `err['loc']` tuple -> `engine.gpu_memory_utilization` style."""
    return ".".join(str(p) for p in loc)


def _format_validation_error(path: Path, err: ValidationError) -> str:
    """Render pydantic errors with dotted paths + file location."""
    lines = []
    for e in err.errors():
        loc = _dotted_path(e["loc"])
        lines.append(f"{loc}: {e['msg']}")
    body = "\n  ".join(lines) if lines else str(err)
    return f"yaml invalid ({path}):\n  {body}"


def load_serving(path: Path) -> ServingConfig:
    """Load & validate serving.yaml; raise ProfileConfigError on any issue."""
    path = Path(path)
    raw = _load_yaml(path)
    try:
        return ServingConfig(**raw)
    except ValidationError as e:
        raise ProfileConfigError(_format_validation_error(path, e)) from e


def load_harness(path: Path) -> HarnessConfig:
    """Load & validate harness.yaml."""
    path = Path(path)
    raw = _load_yaml(path)
    try:
        return HarnessConfig(**raw)
    except ValidationError as e:
        raise ProfileConfigError(_format_validation_error(path, e)) from e


def load_profile_manifest(path: Path) -> ProfileYaml:
    """Load & validate profile.yaml (manifest + stored hash + community_sources)."""
    path = Path(path)
    raw = _load_yaml(path)
    try:
        return ProfileYaml(**raw)
    except ValidationError as e:
        raise ProfileConfigError(_format_validation_error(path, e)) from e


def load_profile(
    bundle_dir: Path,
) -> tuple[ServingConfig, HarnessConfig, ProfileRef]:
    """Load all three YAML files from a bundle + return a ProfileRef."""
    bundle_dir = Path(bundle_dir)
    serving = load_serving(bundle_dir / "serving.yaml")
    harness = load_harness(bundle_dir / "harness.yaml")
    manifest = load_profile_manifest(bundle_dir / "profile.yaml")
    return (
        serving,
        harness,
        ProfileRef(
            id=manifest.profile.id,
            version=manifest.profile.version,
            hash=manifest.profile.hash,
            path=bundle_dir,
        ),
    )


__all__ = [
    "ProfileRef",
    "load_serving",
    "load_harness",
    "load_profile_manifest",
    "load_profile",
]
