#!/usr/bin/env python3
"""Strip vision_tower + multi_modal_projector tensors from RecViking's
Mistral 3.5 NVFP4 checkpoint by direct byte manipulation.

Phase 04.7-02 followup E4 (2026-05-06).

Format reference:
  https://github.com/huggingface/safetensors/blob/main/safetensors/README.md
  - Bytes 0..7: header length (little-endian uint64 N)
  - Bytes 8..8+N: header JSON (UTF-8): {tensor_name: {dtype, shape, data_offsets}, ...}
  - Bytes 8+N..end: tensor data, concatenated in header-declared order

Strategy
========
- Inspect index.json: identify which tensors live in which shard
- For each shard:
    - If shard contains zero vision tensors → symlink (no rewrite)
    - Otherwise:
        - Read source header
        - Filter out vision/projector entries
        - Compute new offsets (compacted, source order preserved)
        - Write new header + copy kept tensor data byte ranges
- Generate new index.json
- Symlink config.json + tokenizer files

This avoids any torch/numpy dep — just file I/O. Streams data in chunks to
keep CPU RAM bounded (~16 MB chunk buffer).

Idempotent: refuses to overwrite dst unless --force.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import struct
import sys
import time
from pathlib import Path


SKIP_PREFIXES = (
    "model.vision_tower.",
    "vision_tower.",
    "model.multi_modal_projector.",
    "multi_modal_projector.",
)

CHUNK_BYTES = 16 * 1024 * 1024  # 16 MB streaming chunk


def should_skip(name: str) -> bool:
    return any(name.startswith(p) for p in SKIP_PREFIXES)


def read_safetensors_header(path: Path) -> tuple[int, dict, int]:
    """Return (header_length_bytes, header_dict, data_start_offset)."""
    with open(path, "rb") as f:
        len_bytes = f.read(8)
        if len(len_bytes) != 8:
            raise ValueError(f"truncated safetensors file: {path}")
        n = struct.unpack("<Q", len_bytes)[0]
        header_bytes = f.read(n)
        if len(header_bytes) != n:
            raise ValueError(f"truncated header in {path}")
        header = json.loads(header_bytes)
        return n, header, 8 + n


def repack_shard(src_shard: Path, dst_shard: Path, kept_names: list[str]) -> int:
    """Re-pack src_shard into dst_shard keeping only kept_names.

    Returns dst file size in bytes. kept_names order is preserved.
    """
    n_header, src_header, data_start = read_safetensors_header(src_shard)

    # Special "__metadata__" key is the file-level metadata field
    src_meta = src_header.pop("__metadata__", None)

    # Build new header in kept order, computing compacted offsets.
    new_header: dict = {}
    if src_meta is not None:
        new_header["__metadata__"] = src_meta

    # Need to compute output data layout
    # For each kept name, copy [src_offset_start, src_offset_end] from source
    # and assign new compacted [dst_offset_start, dst_offset_end] in output.
    cumulative = 0
    copy_plan: list[tuple[str, int, int]] = []  # (name, src_data_start, length)
    for name in kept_names:
        if name not in src_header:
            raise KeyError(f"tensor {name!r} not in source header")
        entry = src_header[name]
        src_off = entry["data_offsets"]
        if not (isinstance(src_off, list) and len(src_off) == 2):
            raise ValueError(f"bad data_offsets for {name}: {src_off}")
        src_data_start = src_off[0]
        src_data_end = src_off[1]
        length = src_data_end - src_data_start

        new_entry = {
            "dtype": entry["dtype"],
            "shape": entry["shape"],
            "data_offsets": [cumulative, cumulative + length],
        }
        new_header[name] = new_entry
        copy_plan.append((name, src_data_start, length))
        cumulative += length

    # Encode new header
    new_header_bytes = json.dumps(new_header, separators=(",", ":")).encode("utf-8")
    # Pad to 8-byte alignment (safetensors-tools convention; not strictly required by spec)
    pad = (8 - (len(new_header_bytes) % 8)) % 8
    new_header_bytes += b" " * pad
    new_n = len(new_header_bytes)

    # Write output: header_length + header + tensor data (streamed)
    with open(src_shard, "rb") as src_f, open(dst_shard, "wb") as dst_f:
        dst_f.write(struct.pack("<Q", new_n))
        dst_f.write(new_header_bytes)

        for name, src_data_start, length in copy_plan:
            src_f.seek(data_start + src_data_start)
            remaining = length
            while remaining > 0:
                chunk = src_f.read(min(CHUNK_BYTES, remaining))
                if not chunk:
                    raise IOError(f"unexpected EOF reading {name}")
                dst_f.write(chunk)
                remaining -= len(chunk)

    return dst_shard.stat().st_size


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--src",
        default="/data/models/Mistral-Medium-3.5-128B-NVFP4",
        help="Raw RecViking checkpoint dir",
    )
    ap.add_argument(
        "--dst",
        default="/data/models/Mistral-Medium-3.5-128B-NVFP4-stripped",
        help="Output dir for the stripped checkpoint",
    )
    ap.add_argument("--force", action="store_true", help="Overwrite dst if it exists")
    args = ap.parse_args()

    src = Path(args.src)
    dst = Path(args.dst)

    src_index_path = src / "model.safetensors.index.json"
    if not src_index_path.is_file():
        print(f"ERROR: src index not found: {src_index_path}", file=sys.stderr)
        return 1

    if dst.exists():
        if not args.force:
            print(f"ERROR: dst exists: {dst} (use --force)", file=sys.stderr)
            return 1
        print(f"removing existing dst: {dst}")
        shutil.rmtree(dst)

    dst.mkdir(parents=True)

    with open(src_index_path) as f:
        src_index = json.load(f)
    weight_map: dict[str, str] = src_index["weight_map"]
    metadata = src_index.get("metadata", {})

    total = len(weight_map)
    skipped = sum(1 for k in weight_map if should_skip(k))
    kept = total - skipped
    print(f"src index: {total} tensors total, {skipped} to skip, {kept} to keep")

    # Group kept tensors by shard, preserving header order
    shards_to_kept: dict[str, list[str]] = {}
    for name, shard in weight_map.items():
        if should_skip(name):
            continue
        shards_to_kept.setdefault(shard, []).append(name)

    new_weight_map: dict[str, str] = {}
    new_total_size = 0

    for shard_filename in sorted(shards_to_kept.keys()):
        kept_names_in_shard = shards_to_kept[shard_filename]
        src_shard = src / shard_filename
        dst_shard = dst / shard_filename

        # Determine if this shard has any vision tensors
        names_in_shard = [n for n, s in weight_map.items() if s == shard_filename]
        skipped_in_shard = [n for n in names_in_shard if should_skip(n)]

        if not skipped_in_shard:
            print(
                f"  shard {shard_filename}: text-only "
                f"({len(kept_names_in_shard)} tensors), symlinking"
            )
            os.symlink(os.fspath(src_shard), os.fspath(dst_shard))
            shard_size = src_shard.stat().st_size
            new_total_size += shard_size
            for name in kept_names_in_shard:
                new_weight_map[name] = shard_filename
            continue

        print(
            f"  shard {shard_filename}: re-packing — "
            f"{len(kept_names_in_shard)} keep, {len(skipped_in_shard)} drop"
        )
        t0 = time.time()
        # Need kept tensors in source-header order, not sorted alphabetically
        # (preserves natural layer ordering for sequential reads at load time)
        n_header, src_header, _ = read_safetensors_header(src_shard)
        src_meta = src_header.pop("__metadata__", None)
        kept_set = set(kept_names_in_shard)
        kept_in_header_order = [n for n in src_header if n in kept_set]

        new_size = repack_shard(src_shard, dst_shard, kept_in_header_order)
        elapsed = time.time() - t0
        new_total_size += new_size
        print(
            f"    re-pack done in {elapsed:.1f}s ({new_size/1e9:.1f} GB written; "
            f"src was {src_shard.stat().st_size/1e9:.1f} GB)"
        )

        for name in kept_in_header_order:
            new_weight_map[name] = shard_filename

    # Write new index
    new_metadata = dict(metadata)
    new_metadata["total_size"] = new_total_size
    new_index = {"metadata": new_metadata, "weight_map": new_weight_map}
    new_index_path = dst / "model.safetensors.index.json"
    with open(new_index_path, "w") as f:
        json.dump(new_index, f, indent=2)
    print(f"wrote new index: {new_index_path} ({len(new_weight_map)} tensors)")

    # Symlink sidecar files
    sidecar_files = [
        "config.json",
        "generation_config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "tekken.json",
        "chat_template.jinja",
        "processor_config.json",
        "SYSTEM_PROMPT.txt",
    ]
    for fname in sidecar_files:
        src_f = src / fname
        if src_f.exists() and not (dst / fname).exists():
            os.symlink(os.fspath(src_f), os.fspath(dst / fname))
            print(f"  symlinked: {fname}")

    print(f"\nstripped checkpoint ready at: {dst}")
    print(f"  total size: {new_total_size/1e9:.1f} GB ({len(new_weight_map)} tensors)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
