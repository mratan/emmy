#!/usr/bin/env python3
"""128K-context needle-in-a-haystack retrieval test for KV-quant comparison.

Phase 04.7-02 followup E4 (2026-05-06). Designed to discriminate fp8 vs int4
KV cache fidelity at long context — the regime where V1/V3 are insensitive
because they don't approach the 128K KV ceiling.

Test design
===========
For each (haystack_size, needle_position) pair:
  1. Generate a haystack of `haystack_size` tokens of distractor text:
     filler paragraphs (deterministic via seeded faker-style generator), so
     the same seed produces byte-identical haystacks across model A/B.
  2. Insert ONE needle sentence at the requested position (as a fraction
     0.0..1.0 of the haystack length): the needle is a unique fact like
     "The secret password for vault #7842 is BANANA-MOUNTAIN-94."
  3. Append a question that requires retrieving the needle: "What is the
     secret password for vault #7842?"
  4. Send to the model, parse the response, score: did it return
     "BANANA-MOUNTAIN-94"?

Tested grid: 5 haystack sizes × 5 needle positions = 25 queries per profile.
Sizes:  16K, 32K, 64K, 96K, 120K (just under the 128K limit)
Positions: 0.05, 0.25, 0.50, 0.75, 0.95 (depth into the haystack)

Each query has its own unique needle (different password) so we can
distinguish "model retrieved it" vs "model hallucinated a generic answer".

Per-query timing: at single-digit tok/s decode + a 120K-token prefill, expect
~1-3 minutes per query. So total wall time ~30-75 minutes per profile.

Output
======
JSONL log to runs/needle/<profile_label>.jsonl:
  {haystack_size, needle_position, needle, question, response, retrieved, ms}

Plus a summary line at end.

Usage:
  needle_in_haystack.py --base-url http://127.0.0.1:8002 \\
    --model mistral-medium-3.5 \\
    --label v2.6-fp8 \\
    --output runs/needle/v2.6-fp8.jsonl
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
import urllib.request
from pathlib import Path


# Distractor sentences — deterministic, unrelated to the needle topic
DISTRACTORS = [
    "The library catalog system was upgraded to version 4.2 last quarter.",
    "Quarterly maintenance schedules require coordination across three departments.",
    "Documentation standards mandate UTF-8 encoding for all new files.",
    "Export controls apply to certain encryption modules in the framework.",
    "Annual performance reviews are conducted in March and September.",
    "The conference room booking system uses a first-come-first-served policy.",
    "Network latency measurements are recorded every fifteen seconds during peak hours.",
    "Vendor support contracts must be renewed thirty days before expiration.",
    "Backup verification procedures run on the first Sunday of each month.",
    "Software license audits occur biannually per organizational compliance policy.",
    "The mailroom processes incoming packages between 10 AM and 4 PM daily.",
    "Capacity planning reviews evaluate storage growth on a rolling basis.",
    "Travel reimbursements require pre-approval for amounts exceeding the threshold.",
    "Server room temperature is maintained between 68 and 72 degrees Fahrenheit.",
    "Patch deployment windows are scheduled outside of business hours.",
    "The intern program runs from June through August in odd-numbered years.",
    "Retention policies vary by document classification and legal hold status.",
    "Conference call etiquette guidelines are published in the employee handbook.",
    "Vendor onboarding requires completion of the security questionnaire.",
    "The break room coffee machine was replaced after the third repair attempt.",
    "Quarterly tax filings are prepared by the accounting team in advance of deadlines.",
    "Internal audits cover financial controls and operational procedures.",
    "The visitor sign-in process requires identification and host approval.",
    "Document retention rules are reviewed annually by legal counsel.",
    "Project status reports are due every Friday by 5 PM local time.",
    "Equipment requisitions must include cost-center allocations.",
    "The fire drill is held quarterly to ensure evacuation procedures remain familiar.",
    "Performance metrics are calculated using a weighted moving average.",
    "Stakeholder updates are circulated via the weekly newsletter on Thursdays.",
    "The new badge access system was deployed in three phases over six weeks.",
]

# Adjective + noun pools for password generation — deterministic per seed
PWD_ADJECTIVES = [
    "BANANA", "PURPLE", "CRIMSON", "GOLDEN", "SILVER", "MARBLE", "VELVET",
    "AMBER", "OBSIDIAN", "EMERALD", "SAPPHIRE", "QUARTZ", "OPAL", "JADE",
    "RUBY", "TOPAZ", "PEARL", "ONYX", "GRANITE", "CORAL",
]
PWD_NOUNS = [
    "MOUNTAIN", "RIVER", "FOREST", "OCEAN", "DESERT", "VALLEY", "CANYON",
    "MEADOW", "GLACIER", "LAGOON", "ARCHIPELAGO", "PLATEAU", "FJORD",
    "TUNDRA", "SAVANNAH", "MARSHLAND", "PRAIRIE", "ESTUARY", "DELTA",
    "PENINSULA",
]


def gen_password(rng: random.Random) -> str:
    a = rng.choice(PWD_ADJECTIVES)
    n = rng.choice(PWD_NOUNS)
    num = rng.randint(10, 99)
    return f"{a}-{n}-{num}"


def gen_haystack(target_tokens: int, needle: str, position: float, vault_id: int, seed: int) -> str:
    """Generate a haystack of approximately target_tokens tokens of distractor
    text with the needle inserted at fraction `position` (0.0..1.0).

    Token count is approximate (4 chars ≈ 1 token rule-of-thumb). We aim
    slightly under target to leave room for the prompt wrapper.
    """
    rng = random.Random(seed)
    target_chars = target_tokens * 4

    # Build paragraph chunks first; insert needle at the right offset
    chunks: list[str] = []
    chunks.append(
        f"# Operational handbook: Vault directory & maintenance log\n\n"
        f"This document contains operational notes for vault facilities, "
        f"including access procedures, maintenance schedules, and other "
        f"reference material. Sections are not chronologically ordered.\n\n"
    )

    chars_so_far = sum(len(c) for c in chunks)
    needle_inserted = False

    while chars_so_far < target_chars:
        # Decide if we should insert the needle here
        if not needle_inserted and chars_so_far >= int(target_chars * position):
            chunks.append(f"\n## Vault #{vault_id}\n\n")
            chunks.append(f"{needle}\n")
            chunks.append(
                "This entry is a maintenance record. Verify periodically.\n\n"
            )
            needle_inserted = True

        # Add a section header occasionally
        if rng.random() < 0.05:
            chunks.append(f"\n## Section {rng.randint(100,999)}\n\n")

        # Add 3-7 distractor sentences
        n_sents = rng.randint(3, 7)
        for _ in range(n_sents):
            chunks.append(rng.choice(DISTRACTORS) + " ")
        chunks.append("\n\n")

        chars_so_far = sum(len(c) for c in chunks)

    if not needle_inserted:
        # Edge case: position was very late, append at end
        chunks.append(f"\n## Vault #{vault_id}\n\n{needle}\n")

    return "".join(chunks)


def call_model(base_url: str, model: str, prompt: str, timeout_s: int = 600) -> tuple[str, float]:
    """Send a single chat completion request, return (response_text, ms)."""
    url = base_url.rstrip("/") + "/v1/chat/completions"
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 100,
        "temperature": 0.0,
    }
    t0 = time.time()
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        body = json.loads(resp.read())
    ms = (time.time() - t0) * 1000
    text = body["choices"][0]["message"]["content"]
    return text, ms


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://127.0.0.1:8002")
    ap.add_argument("--model", default="mistral-medium-3.5")
    ap.add_argument("--label", required=True, help="Run label for output filename")
    ap.add_argument("--output", required=True, help="Output JSONL path")
    ap.add_argument(
        "--sizes",
        default="16384,32768,65536,98304,122880",
        help="Comma-separated haystack token sizes",
    )
    ap.add_argument(
        "--positions",
        default="0.05,0.25,0.50,0.75,0.95",
        help="Comma-separated needle positions (fractions 0..1)",
    )
    ap.add_argument("--seed", type=int, default=42, help="Base seed for haystack generation")
    ap.add_argument("--timeout-s", type=int, default=900)
    args = ap.parse_args()

    sizes = [int(x) for x in args.sizes.split(",")]
    positions = [float(x) for x in args.positions.split(",")]

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"[needle] label={args.label} model={args.model} base={args.base_url}")
    print(f"[needle] sizes={sizes} positions={positions}")
    print(f"[needle] output={output_path}")

    results: list[dict] = []
    correct = 0
    total = 0

    for size in sizes:
        for position in positions:
            total += 1
            # Unique seed per query so each test gets a unique password
            seed = args.seed + total * 1000
            rng = random.Random(seed)
            password = gen_password(rng)
            vault_id = rng.randint(1000, 9999)
            needle = (
                f"The secret password for vault #{vault_id} is {password}. "
                f"This password must be entered before unlocking the inner door."
            )

            haystack = gen_haystack(size, needle, position, vault_id, seed)

            prompt = (
                f"{haystack}\n\n"
                f"---\n\n"
                f"Based on the document above, what is the secret password "
                f"for vault #{vault_id}? Reply with the password only, in "
                f"the exact format ADJECTIVE-NOUN-NN. Nothing else."
            )

            print(
                f"[needle] size={size} pos={position:.2f} "
                f"vault=#{vault_id} expected={password}",
                flush=True,
            )
            try:
                text, ms = call_model(args.base_url, args.model, prompt, args.timeout_s)
            except Exception as exc:
                text = f"<ERROR: {type(exc).__name__}: {exc}>"
                ms = -1

            retrieved = password in text
            if retrieved:
                correct += 1

            result = {
                "label": args.label,
                "size": size,
                "position": position,
                "vault_id": vault_id,
                "expected": password,
                "response": text.strip()[:200],
                "retrieved": retrieved,
                "ms": ms,
            }
            results.append(result)
            with open(output_path, "a") as f:
                f.write(json.dumps(result) + "\n")

            print(
                f"  → {'✓' if retrieved else '✗'} "
                f"resp={text.strip()[:80]!r} ({ms:.0f} ms)",
                flush=True,
            )

    print(f"\n[needle] DONE: {correct}/{total} retrieved ({100.0*correct/total:.0f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
