"""Boot orchestration: health probe + docker-args renderer.

RESEARCH.md §7.1 (wait_for_vllm) and §14 (start_emmy.sh contract).
"""
from __future__ import annotations

from .probe import wait_for_vllm

__all__ = ["wait_for_vllm"]
