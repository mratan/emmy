# Pitfalls Research

**Domain:** Local-first coding agent on DGX Spark — specialized vLLM serving stack + custom pi.dev harness, dual mandate (daily driver + reproducible research artifact)
**Researched:** 2026-04-20
**Confidence:** HIGH (most pitfalls cite reproducible incidents from vLLM GitHub, NVIDIA Developer Forums, recent papers, and the prior `setup_local_opencode` repo's own data)

---

## Critical Pitfalls

### Pitfall 1: KV-cache budget set from theory, not measurement (vLLM serving)

**What goes wrong:**
The team sets `--gpu-memory-utilization=0.95` and a max-context number based on the model card, then under real coding-agent traffic (long prefills, large tool-call histories, concurrent requests) vLLM starts preempting requests, latency spikes 3-10×, and "fast" benchmarks are unreproducible. In severe cases, kernel-warmup memory leaks silently steal cache (e.g. vLLM issue #36973: a Triton autotuned kernel's warmup leaks ~3.4 GiB after `empty_cache()`, dropping max context from 134K → 44K with no warning).

**Why it happens:**
KV-cache requirements scale as `max_num_seqs × max_model_len`, not just model size. Default `gpu_memory_utilization` leaves no headroom for CUDA allocator spikes during bursty traffic. The model card's "supports 128K context" is a capacity claim, not a serving claim. On DGX Spark's unified-memory architecture, the picture is worse: model weights, KV cache, AND CPU workload all contend for the same DRAM pool, and `cudaMemGetInfo` reports inaccurate available memory because it doesn't see swap reclaimable space.

**How to avoid:**
- Compute the budget explicitly: model weights (FP8) + (target_concurrency × max_practical_context × bytes_per_token_kv) + 15% allocator safety margin. Document it in the model profile.
- Run a sustained-load smoke test on the actual coding workload (not synthetic prompts) for at least 30 minutes before declaring a profile good.
- Track preemption rate as a first-class metric. Any non-zero preemption in steady-state is a profile bug.
- On DGX Spark, leave more headroom than NVIDIA recommends (try 0.85 first, not 0.95) because of UMA contention with the harness process running on the same box.
- Profile-specific `max_model_len` — do not set it to the model's theoretical maximum.

**Warning signs:**
- vLLM logs "preempted" or "swapped" entries
- TTFT or ITL latency increases over time during a session even with constant prompt size
- OOM killer firing on the harness process (UMA contention)
- `gpu_memory_utilization` was chosen by feel, not calculation

**Phase to address:** Phase 1 (vLLM serving baseline / model profile v0). Severity: **Critical**.

---

### Pitfall 2: vLLM API/version churn breaks the profile mid-experiment

**What goes wrong:**
Mid-project, a vLLM minor release removes a flag, renames an env var, deprecates a quantization backend, or changes a default. A pinned-version benchmark suddenly produces different numbers, and you cannot tell whether the serving change or your harness change caused it. Recent removals (BitBlas, Marlin 24, `reasoning_content`, `VLLM_ALL2ALL_BACKEND`, IPEX for XPU) and scheduled removals (Torchair, LLMDatadist KV connector by Q1 2026) bite anyone who upgrades casually. vLLM ships ~biweekly and is not yet at 1.0 (no API stability commitment).

**Why it happens:**
vLLM is a fast-moving research codebase optimizing toward 1.0. The team explicitly states "major releases are reserved for architectural milestones similar to PyTorch 2.0." Minor versions can break user-facing behavior. Coupled with DGX Spark's need for SM121 kernel patches (stock vLLM from PyPI doesn't run on GB10 — pulls CPU-only PyTorch on aarch64), most users end up on a custom build, which compounds fragility.

**How to avoid:**
- Pin vLLM to an exact commit (not just a minor version) inside the model profile.
- Maintain a `serving_dockerfile` per profile that captures CUDA, PyTorch, NCCL versions and the exact build flags for SM121 support.
- Treat vLLM upgrades as a benchmark-invalidating event: re-run the full benchmark suite under the new version before declaring the profile still valid.
- Subscribe to vLLM release notes; flag any change touching `--max-model-len` semantics, scheduler, KV cache, structured-output backends, or chat template handling.

**Warning signs:**
- A benchmark number drifts but no harness/profile change is in git diff
- A flag the README mentions doesn't exist anymore
- The release notes contain "removed" or "deprecated" for anything you use

**Phase to address:** Phase 1 (profile schema must include exact vLLM commit). Severity: **High**.

---

### Pitfall 3: Grammar-constrained output that the model "fights"

**What goes wrong:**
Constrained decoding via XGrammar/Outlines is enabled to guarantee tool-call parseability. Quality silently drops because the grammar masks tokens the model would prefer; the model wastes capacity emitting placeholder text or producing structurally valid but semantically empty calls. Bad signs include `{"name": "edit_file", "arguments": {"path": "TODO", "diff": ""}}` — schema-valid, content-useless. Worse, oversized JSON schemas (large enums, deeply nested unions) blow context AND inflate per-token grammar processing.

**Why it happens:**
Grammar constraints are a *correctness backstop*, not a quality lever. When the underlying model wasn't trained to emit your exact schema, masking forces it down low-probability paths. JSONSchemaBench (arxiv 2501.10868) shows wide quality variance across constrained-decoding frameworks; XGrammar is the fastest and best on complex schemas (97.1% accuracy on GitHub-issues schema vs Outlines' 76.4% on Qwen-2.5-32B), but no framework rescues a fundamentally bad schema.

**How to avoid:**
- Treat grammar as a *fallback*: parse the unconstrained output first, only retry under grammar on parse failure. Measure how often the fallback fires per model — high frequency means the prompt or tool format needs work, not stronger constraints.
- Keep tool schemas small and flat. Prefer `{"command": "str", "args": "str[]"}` over deeply nested unions. Vercel's "1 bash tool replaces 17 specialized tools" result (success rate 80% → 100%, 3.5× faster, 37% fewer tokens) generalizes.
- Use XGrammar as the structured-output backend, not Outlines, for nested schemas. (HIGH confidence — multiple benchmarks agree.)
- Reuse grammars (XGrammar caches them); avoid emitting a unique schema per request.
- Include a no-grammar baseline benchmark in the profile so quality regression from constraints is visible.

**Warning signs:**
- Schema-valid responses with placeholder content
- Per-token latency creeps up when grammar is enabled (TPOT regression > 5%)
- Tool argument values frequently empty, default, or copy-pasted from the schema
- Model emits the same valid-but-wrong call repeatedly

**Phase to address:** Phase 2 (grammar-constrained tool output). Severity: **Critical** for Gemma/Qwen-class models.

---

### Pitfall 4: Speculative decoding that doesn't pay off (or makes things slower)

**What goes wrong:**
Speculative decoding (draft + target) is enabled hoping for 2-3× latency win. In practice acceptance rate sits at 0.3-0.5 (vs the 0.6-0.8 the team expected), and total throughput drops because draft compute now exceeds saved target compute. Documented case: a 1.7B target with a 135M draft model showed a consistent ~30% slowdown at 5 speculative tokens despite "high" acceptance rate (vLLM issue #15025). Acceptance rate also degrades over a long session (vLLM issue #11188).

**Why it happens:**
Speculative decoding only wins when (a) draft model is meaningfully cheaper than target, (b) drafts are accepted often, and (c) the workload isn't already compute-bound from a packed batch. Failure cases:
- Target too small: draft overhead dominates (a 7B draft for a 13B target is slower than vanilla)
- High temperature or diverse-token tasks: acceptance rate collapses
- High-QPS / batched serving: spec decode adds compute that was already saturated
- Long generations: error compounds, divergence accumulates
- Out-of-domain draft: EAGLE/Medusa drafts trained on chat data fight coding-task distributions
- EAGLE training-inference discrepancy: drafts use ground-truth features in training but not inference, causing drift
- Beginning of sequence: first few tokens have low acceptance because draft has no context

**How to avoid:**
- Run a paired benchmark (spec on vs spec off) on the actual coding workload before enabling.
- For small Gemma-class targets, consider skipping spec decode entirely; the win envelope is narrow.
- Set `speculative_draft_tensor_parallel_size=1` for EAGLE drafts (the main model can still TP).
- Track per-session acceptance rate; alert if it drops below the break-even threshold for that profile.
- Prefer suffix decoding for code-edit tasks (high repetition) and EAGLE-3 for general generation; don't use Medusa for coding (its Cartesian-product tree generates nonsensical combinations like "I am begin").

**Warning signs:**
- Acceptance rate < 0.5 during steady-state
- p50 latency with spec on > p50 latency with spec off
- Acceptance rate trending down across the session
- Spec decode disabled itself due to scheduler back-pressure

**Phase to address:** Phase 2 or 3 (latency optimization, after baseline serving works). Severity: **High** (wasted complexity; could silently regress production).

---

### Pitfall 5: The "more prompting" trap (grounded in setup_local_opencode Phase 2)

**What goes wrong:**
Confronted with a model that's already at 8.5/10, the team adds explicit rules ("when NOT to search," "be concise," "follow these 10 steps") trying to push to 9. The added rules confuse the model, it starts skipping necessary actions, and average score regresses. Documented prior outcome: Qwen3 went from **8.5 → 6.8** on the literature task (PMIDs found dropped from 8 → 0; response length fell from 10,629 → 210 chars) after adding "Rule 10: When NOT to search." MiniMax meanwhile *improved* from 6.5 → 8.5 on coding when given a different concise tuning — so the lesson isn't "tuning bad," it's "tuning is model- and task-specific and frequently negative."

**Why it happens:**
- Negative rules ("don't do X") are harder to follow than positive rules ("do Y when Z"), especially for smaller models.
- Cross-domain over-generalization: a coding-conciseness rule applied globally torpedoes literature-task verbosity that was actually needed.
- Sunk-cost: the team commits to a tuning hypothesis and tests subset tasks (which look fine) instead of the full suite (which would expose regression).
- Strong defaults: well-tuned community defaults already encode hundreds of person-hours of A/B testing — adding ad-hoc rules on top is a high-variance bet.
- Over-specified prompts also slow generation: same prior data showed Task 1.3 went from 24.8s → 60.5s (2.4× slower) under the tuned prompt while quality stayed flat.

**How to avoid:**
- **Default to community-validated defaults.** Run new prompts only when there is signal a default is failing.
- Always evaluate prompt changes against the **full** benchmark suite, not a subset. Subset tests hid the literature regression in Phase 2.
- Separate prompt rules by task type. Coding-conciseness rules should not be in literature-task prompts.
- Prefer positive instructions ("search PubMed first") over negative ("don't search if X").
- Set a regression budget: a tuning attempt that costs > 0.5 quality points on any task category is rolled back automatically.
- Track *both* quality and latency — a "neutral" tuning that doubles latency is a regression.

**Warning signs:**
- Subset test passes but full suite shows regression
- Quality flat, latency up — prompt is causing overthinking
- Response length dropped 5-50× — model interpreted "be concise" as "don't try"
- Tool-use rate (e.g. searches per task) collapsed

**Phase to address:** Phase 2 (per-model profile defaults), Phase 6 (benchmark suite must include regression alarms). Severity: **Critical** — this is the prior repo's #1 lesson and most likely to repeat.

---

### Pitfall 6: System-prompt delivery silently broken (the Qwen3 Phase 3 incident)

**What goes wrong:**
The harness sends a system prompt via one transport path; the serving layer doesn't actually apply it. The model returns plausible-looking but minimal placeholder responses (200-300 chars where 4-10K expected), benchmark scores collapse to ~5/10 across the board, and the team initially blames the model instead of the wire format. Documented prior outcome: Qwen3 went from a verified 8.5/10 in Phase 1 to **0/5 task success in Phase 3** because the `system` parameter on vLLM's `/v1/messages` (Anthropic-format) endpoint wasn't being honored. Same model, same weights — the harness path was the bug.

**Why it happens:**
- vLLM's Anthropic-compatible endpoint may handle `system` differently from `/v1/chat/completions`, and the chat template determines whether the system message lands in the model's actual context.
- Different chat templates (Hermes, Qwen-tool, Gemma) have different system-message handling, and vLLM's `--enable-auto-tool-choice` flag interacts with this.
- Harnesses like Claude Code/opencode silently strip or override system prompts with their own scaffolding (opencode has a documented bug doing global "opencode" → "Claude" string replacement on Anthropic models — exactly the kind of invisible mutation that breaks reproducibility).
- "Zero-character response" is rare; "300-character generic response" looks like a model failure, not a delivery failure.

**How to avoid:**
- Add a **system-prompt echo test** to the benchmark suite: prepend "Begin every reply with the literal token `[SP_OK]`" to the system prompt and assert the token appears. Run before every benchmark batch.
- Log the *actual* prompt vLLM received (not what the harness intended to send) at request time. vLLM has a debug log mode for this.
- Test both `/v1/chat/completions` and `/v1/messages` paths during profile bring-up; document which one each model profile uses.
- Never assume harness transparency — the eight pain points in PROJECT.md exist because Claude Code/opencode mutate the prompt.
- For pi.dev: instrument the prompt-construction layer with a hash of the final assembled prompt; surface it in observability.

**Warning signs:**
- Response length suddenly an order of magnitude shorter than baseline
- Quality score uniformly low across diverse tasks (not a model weakness — a delivery failure)
- Tool-use rate near zero on tasks that obviously need tools
- Model output looks like the *generic* model, not the system-prompt-tuned model

**Phase to address:** Phase 1 (serving smoke tests), Phase 3 (harness instrumentation), Phase 6 (eval suite). Severity: **Critical** — invalidates entire benchmark batches, hard to detect.

---

### Pitfall 7: DGX Spark thermal throttle / shutdown under sustained load

**What goes wrong:**
A benchmark run that completes in 15 minutes shows good numbers; a daily-driver session that runs the model for 2 hours shows degraded throughput, increased latency variance, and possibly a hard shutdown. Documented incidents: GPU clocks throttled from 2.8GHz to ~2GHz under modest load; system shutdown around 95°C during nanoChat pretraining (20-30 min in); thermal-test data confirms heat soak from adjacent components accumulates over time, independent of workload spikes. Internal 2242 Gen5 NVMe is throughput-limited under heavy I/O (e.g., model swapping).

**Why it happens:**
- Spark's compact form factor + 240W TDP + dense memory subsystem creates heat-soak dynamics that don't show up in short benchmarks.
- Coding-agent workloads alternate prefill (compute-bound, hot) and decode (memory-bound, also hot in different sites) — sustained interleaved load thermally stresses different subsystems.
- vLLM by default keeps the model resident; if the agent harness also runs heavy local work (search indexes, type checkers), CPU heat compounds.
- Storage thermal rise is independent of workload — model swapping for multi-model routing accelerates it.

**How to avoid:**
- Run a 2-hour sustained-load thermal validation as part of every profile (not just a 5-minute throughput run).
- Monitor `nvidia-smi` clock speeds across the session; flag any sustained throttle.
- Keep the agent harness on the same box but isolate its CPU cores (cgroups) so harness compute doesn't compete with vLLM kernel launches.
- For multi-model routing: prefer keeping a small subset hot rather than swapping; cold starts thrash storage thermally and waste seconds.
- Consider an external NVMe-oF mount for model storage if heavy swapping is in scope (NVIDIA's own guidance).
- Set up alerts for GPU temp > 85°C, storage temp > 70°C, sustained clock < 2.5 GHz.

**Warning signs:**
- Latency tail (p99) grows over a session even with constant prompt size
- `nvidia-smi` shows clocks below rated frequency
- Tokens-per-second is 5-15% lower at the end of an hour than at the start
- Spontaneous restarts or shutdowns during long sessions

**Phase to address:** Phase 1 (DGX Spark serving setup must include thermal test). Severity: **High**.

---

### Pitfall 8: FP4/FP8 quantization quality cliff for code

**What goes wrong:**
The team picks FP4 to fit a larger model in Spark's memory budget. Coding benchmarks look acceptable on average but the model produces shorter or less reliable reasoning, more code-generation failures, and rare-token brittleness (variable names, library symbols). Math/reasoning regress more than chat. The Qwen3.5 vs Gemma 4 comparison on Go coding showed Qwen3.5 compiles less often than Gemma 4 across every quantization level — hypothesized to be MoE architecture being more weight-precision-sensitive.

**Why it happens:**
- FP4 has only 16 distinct representable values; tensor-wise scaling has significant error.
- Activations are harder to quantize than weights; coding tasks emit rare tokens (identifier names, string literals) that hit activation outlier paths.
- MoE architectures (relevant for Qwen3-Next, gpt-oss-120b) are more sensitive to per-expert weight precision loss than dense models.
- "Average benchmark" hides per-task degradation — long code reasoning regresses more than short code completion.

**How to avoid:**
- Pin quantization at FP8 (or BF16 for small models) as the **default**; treat FP4 as an experimental track requiring explicit benchmark validation.
- Validate every quantization choice against a code-generation benchmark with **compile-rate** as a primary metric (not just style/quality).
- Compare same-model BF16 → FP8 → FP4 on the same benchmark to characterize the cliff for that specific model. The cliff location is model-architecture-specific.
- Profile metadata must include exact quantization recipe (NVFP4, MXFP4, AWQ, GPTQ — all behave differently).

**Warning signs:**
- Compile rate or test-pass rate drops >5% vs higher-precision baseline
- Model invents library/function names that don't exist
- Reasoning chains become noticeably shorter
- Same prompt, different runs, wildly different code (rare-token brittleness)

**Phase to address:** Phase 1 (model profile must specify quantization + compile-rate validation). Severity: **High**.

---

### Pitfall 9: Test-set contamination invalidates benchmark claims

**What goes wrong:**
The benchmark suite uses HumanEval, MBPP, or original SWE-bench tasks. Models score impressively. The published claim is rejected in review (or post-publication critique) because OpenAI's internal audit found every major frontier model could reproduce verbatim gold patches for some SWE-bench Verified tasks — the 500 Python tasks appeared in training data before benchmark publication. ChatGPT shows high contamination potential on HumanEval. Simple paraphrasing bypasses string-match decontamination.

**Why it happens:**
- Public benchmarks (HumanEval since 2021, original SWE-bench) are likely in pretraining for any 2024+ model.
- String-match decontamination is insufficient: a 13B model can be fine-tuned to ace a "decontaminated" benchmark via paraphrased copies.
- "Prior repo's Phase 1 prompts" inherited from `setup_local_opencode` carry contamination risk if those prompts overlap with public datasets.
- Reproducibility ≠ validity: a fully reproducible benchmark on contaminated data measures memorization, not capability.

**How to avoid:**
- Use **LiveCodeBench** (rolling updates, contamination-resistant) and **SWE-bench Verified** as primary benchmarks, not HumanEval.
- For the bespoke prompt suite (extending Phase 1 prompts), add held-out prompts the team writes from scratch and never publishes — these bound the contamination uplift.
- Include a "negative control": rephrased / structurally-modified versions of public benchmarks. Big delta between original and rephrased = contamination signal.
- Publish prompt SHA and provenance with every benchmark claim.
- For research-artifact mandate: explicitly state contamination risk and present both "public-benchmark" and "private-benchmark" numbers.

**Warning signs:**
- Local model matches frontier-model benchmark numbers on tasks where it qualitatively feels weaker
- Verbatim reproduction of canonical solutions (especially error messages, comment text)
- Big drop on rephrased version of a task that worked on the original

**Phase to address:** Phase 6 (benchmark suite design). Severity: **Critical** for the "research artifact" mandate.

---

### Pitfall 10: Benchmark variance hidden by single-shot evaluation

**What goes wrong:**
The team runs each task once per model and reports a 8.5 vs 7.8 differential. Variance across seeds at the same temperature is ~0.5-1.5 quality points; the differential is noise. Worse: even greedy decoding (`temperature=0`) is non-deterministic in practice because of *batch-invariance failure* — vLLM kernel outputs depend on batch size, which fluctuates with server load. Single-shot safety evaluation agrees with multi-sample ground truth only ~92% of the time; 18-28% of prompts flip refusal decisions across seeds.

**Why it happens:**
- Stochastic sampling (temperature > 0) introduces variance proportional to temperature.
- Even at temp=0, batch-size-dependent kernels (matmul, RMSNorm, attention) produce different floating-point results.
- Hardware/system-level numerical nondeterminism persists even after fixing seeds.
- Researchers default to single-shot to save compute; the prior repo's 7-hour eval used (effectively) single-shot per task.

**How to avoid:**
- Minimum 3 samples per prompt for any reported number; surface mean ± std.
- Enable **vLLM batch invariance** (FlexAttention backend + `torch.Library`) for benchmarks requiring true reproducibility. Accept the throughput hit (intentional trade-off).
- Pin batch size during benchmarks: serve benchmark traffic alone (no concurrent load) so the batch-invariance issue is masked even without the FlexAttention path.
- Report effect size *and* variance. A 0.3 differential with 0.7 std is not a result.
- Use paired comparisons (same prompts, different configs) so within-prompt variance cancels.

**Warning signs:**
- Benchmark numbers move when you re-run the same script
- Numbers depend on what other workload is on the box
- Differential between two profiles is < 1 std of within-profile variance

**Phase to address:** Phase 6 (eval methodology). Severity: **High** — easy to hit, undermines all comparisons.

---

### Pitfall 11: LLM-as-judge bias when scoring agent outputs

**What goes wrong:**
The team uses an LLM judge to score open-ended coding outputs (the Phase 1 method). The judge has learned to prefer minimal, gold-answer-like outputs over working ones. Verbose-but-correct solutions score lower than brief-and-buggy ones. Position bias (preferring response A in pairwise comparisons), length bias (preferring longer or shorter depending on training), and self-preference bias (model judges its own family more highly) all distort the ranking.

**Why it happens:**
- Judge models are trained on canonical code; "looks like a textbook solution" gets reward.
- AI21's documented finding: gold-like answers reveal LLM judge bias in coding benchmarks — the judge favors solutions that look like gold over ones that work.
- Temperature affects judge stability: setting judge temperature > 0.2 introduces meaningful judgment variance.
- Same model used for inference AND judging creates feedback loops.

**How to avoid:**
- For coding tasks, prefer **executable correctness** (compile, run, test pass) over judge scores wherever possible. The Phase 1 "PMIDs found" metric is a good shape — count something objective.
- When judge scores are unavoidable, use a different model family for judging than for generation; never self-judge.
- Pin judge `temperature=0` (or very low) and run judge ≥3 times; report std.
- Use rubrics with explicit positive criteria, not "rate quality 1-10."
- Spot-check 10% of judgments by hand; quantify human-judge agreement.

**Warning signs:**
- Models from the judge's family score systematically higher
- Verbose-but-correct outputs score lower than terse-but-broken ones
- Re-running the judge produces different ordering
- Hand-sampling reveals "good" solutions marked low

**Phase to address:** Phase 6 (eval methodology). Severity: **High** for the research-artifact claim.

---

### Pitfall 12: Hidden cloud dependencies that violate the "fully local" thesis

**What goes wrong:**
The project ships, then someone asks "does it work air-gapped?" and the answer is no. Sources of leak:
- HuggingFace gated-model auth (`HF_TOKEN`) required even to *load* a cached model offline — the from_XXX method must be run online once to create empty placeholder files.
- vLLM's anonymous **usage-stats telemetry** is on by default (must explicitly opt out via `VLLM_NO_USAGE_STATS=1`, `DO_NOT_TRACK=1`, or `~/.config/vllm/do_not_track`).
- Pip/conda mirrors during builds (especially DGX Spark's custom NCCL/vLLM build pulling from PyTorch/NVIDIA channels).
- Model card / tokenizer downloads at startup if not pre-cached.
- Web search MCP, web fetch tools — if the harness wires them in, "local agent" no longer holds.
- Telemetry from observability frameworks (Langfuse SaaS, etc.).

**Why it happens:**
"Local" usually means "model inference is local" but the supply chain (model fetch, tokenizer download, telemetry) is implicitly cloud. Most "local LLM" tutorials assume online setup; the air-gapped case is rarely tested.

**How to avoid:**
- Define "fully local" precisely in the project README: "After initial setup, the box can be air-gapped and the agent still works on real coding tasks for at least N hours."
- Disable vLLM telemetry in every profile (`VLLM_NO_USAGE_STATS=1`).
- Pre-cache all model artifacts and run the from_XXX method once online to materialize gated-model placeholders.
- Use `pip download --no-deps` to materialize a local wheel cache; build vLLM offline.
- Reproducibility test: pull the network cable, then run the benchmark suite. Any failure is a leak.
- For the harness: web search / web fetch tools must be opt-in and clearly tagged as cloud-dependent.

**Warning signs:**
- Setup instructions assume internet access
- A profile that worked yesterday fails today after an unrelated upstream change
- Outbound traffic on `nvidia-smi`-busy intervals
- Token-required errors when model is "already cached"

**Phase to address:** Phase 1 (serving setup), Phase 3 (harness setup), Phase 6 (an explicit air-gapped reproducibility test). Severity: **Critical** for the project thesis.

---

### Pitfall 13: Daily-driver UX sacrificed for benchmark scores (and vice versa)

**What goes wrong:**
Two failure modes mirror each other:
- **Optimize-for-eval:** Model scores well on the benchmark suite. In actual use it feels slow, verbose, repetitive, or unhelpful — the eval rewards different behaviors than daily-driver use values.
- **Optimize-for-vibes:** Model "feels great" on the author's recent sessions. Benchmark suite never re-run; numbers silently rot. Reproducibility claim breaks.

The PROJECT.md explicitly flags this as the "subjective ↔ objective tension."

**Why it happens:**
- Benchmarks measure pass-rates, not flow. Real coding-agent UX depends on latency tail (p99 > p50), tool-call cadence, recovery from errors, and "did it ask the right clarifying question."
- "Vibes" is a small-N, biased sample (the author's recent project type). It misses regressions on tasks the author hasn't done lately.
- The two are rarely in conflict for very strong models; they often conflict for weaker local models being scaffolded.
- Comment from rlancemartin/vibe-code-benchmark and the broader "IDE agent for daily / terminal agent for hard problems" pattern shows users de facto split into two tools — Emmy is trying to be both.

**How to avoid:**
- Maintain **two parallel measurement streams**: (1) the automated benchmark suite (objective), (2) a structured journal the author fills out after every real session (subjective: rating + free-text + link to transcript).
- Define UX-side metrics that *are* automatable: p99 latency on coding edits, time-to-first-edit, number of clarifying questions per task, tool-call retry rate. These bridge the two.
- Track when the two streams *disagree* — disagreement is signal, not noise. A profile that wins benchmarks but loses vibes-journal is a profile bug, not an eval bug.
- Write the daily-driver experience down as a third type of artifact (transcript replay) the public can verify.

**Warning signs:**
- Benchmark went up but author has stopped reaching for emmy
- "Felt great" but no benchmark run in 4+ weeks
- A profile change reads as +0.3 quality on benchmark, -2 on the author's journal
- Multiple sessions end with author opening Claude Code instead

**Phase to address:** Phase 6 (dual-stream eval), recurring at every milestone (`/gsd-complete-milestone`). Severity: **Critical** — this *is* the project's central design tension.

---

### Pitfall 14: Profile sprawl, untestable profiles, code-vs-profile drift

**What goes wrong:**
The "first-class model profile" abstraction starts clean. Six months in: 30+ profiles, half are duplicates with one tweak, no one remembers which is "current best for Qwen3.6 + coding," profile YAML references env vars that no longer exist in code, and a profile change silently invalidates a benchmark from last month.

**Why it happens:**
- Profiles look like config but behave like code. Without versioning + tests, they degrade into drift.
- Easy to copy-paste a profile and forget. Hard to know which fields a profile *must* set vs which inherit defaults.
- Multiple consumers (serving + harness) each interpret the profile slightly differently.
- "Stand on shoulders" → community defaults shift → profiles created against last quarter's defaults are now silently wrong.

**How to avoid:**
- Version every profile (semver: major bump = benchmark-invalidating change). Store the profile *by SHA* in benchmark result files.
- Each profile must come with a **profile-validation test** that runs a tiny smoke benchmark; CI-style. A profile that doesn't pass its smoke test is non-mergeable.
- Schema for profiles enforced (Pydantic / JSON Schema), no free-form YAML keys.
- A profile that hasn't been re-validated in N days is flagged "stale" in the registry.
- `profile diff` tool: human-readable diff between two profile versions, with auto-flagging of fields known to invalidate benchmarks (sampling, quantization, system prompt, tool format).
- Limit profile count: a profile is "promoted" only if it beats existing profiles on at least one benchmark category.

**Warning signs:**
- Two profiles differ in 1 field but nobody knows which is current
- A benchmark JSON references a profile that no longer exists or has changed
- A profile sets a field the code no longer reads
- Duplicate profiles for the same model with no clear winner

**Phase to address:** Phase 4 (profile abstraction), Phase 6 (eval suite ties results to profile SHA). Severity: **High**.

---

### Pitfall 15: Tool-result truncation that drops critical info

**What goes wrong:**
A tool returns 50KB (e.g., a long test failure with stack trace + diff). The harness truncates to 4KB to save context. The truncation drops the crucial line. The agent now reasons about a fictional version of the failure, "fixes" the wrong thing, loops. Worse: summarization can introduce **trajectory elongation** (cited blog) — the LLM summarizes a failed test as "the test mostly passed with a minor issue," and the agent loses the signal that it's stuck.

**Why it happens:**
- Naive head/tail truncation drops the middle, where build errors usually live.
- Summarization inverts the severity (LLMs are biased to be reassuring).
- "Tool result clearing" (drop old, re-fetchable results) is correct *most* of the time but lossy for irreproducible results.
- No observability into truncation rate — happens silently.

**How to avoid:**
- Structured truncation by content type: error/diagnostic messages preserved verbatim; bulk file content tail-truncated; HTML/rendered output stripped first.
- For long tool results: emit a "result summary + handle" pair. Agent can pull the full result back via a follow-up tool call if needed.
- Track truncation rate per tool. High rate = tool needs better default output formatting.
- Never summarize error output. Truncate or chunk, but don't paraphrase.
- Test: inject a synthetic tool result with a critical line in the middle; assert the agent acts on it.

**Warning signs:**
- Agent fixes the wrong thing on test failures
- Same tool called 3+ times in succession with similar arguments
- Tool result hash differs from what was sent to the model

**Phase to address:** Phase 3 (harness context management). Severity: **High**.

---

### Pitfall 16: Infinite ReAct loop / no-progress detection missing

**What goes wrong:**
A tool starts returning empty results (target page changed, file deleted, API rate-limited). The agent retries, retries again, retries 400 times in 5 minutes per the documented incident, burning thousands of tokens before hitting any external limit. On a local-only system there *is* no external limit — only Spark's compute and the author's patience.

**Why it happens:**
- Default `max_iterations` is too high or unset.
- "Self-correction" loops have no progress check.
- ReAct's Thought → Action → Observation cycle has no built-in stopping condition beyond "model says done."
- Local models are more prone to repetitive loops than frontier models.

**How to avoid:**
Layered stopping conditions per the agent-patterns.tech recipe:
- Hard `max_iterations` (low, e.g. 20-30 for daily driver, then ask user)
- Token / cost budget per session (compute, even if free, shouldn't infinite-loop)
- **No-progress detection**: if last 3 iterations produced no new tool result hash and no new file edit, stop and ask
- Goal-achievement check: explicit "done?" sub-call before deep loops
- Per-tool retry caps with backoff; same tool + same args = increment counter

**Warning signs:**
- Same tool call repeated with identical args
- Iteration count rising without observable progress
- Token budget burn rate > N tokens/sec sustained
- Author Ctrl-C events as a metric (humans hitting kill)

**Phase to address:** Phase 3 (harness agent loop). Severity: **High**.

---

### Pitfall 17: System-prompt scaffolding bloat from harness opacity

**What goes wrong:**
Inheriting Claude Code/opencode mental model, the team writes a 5-10K-token system prompt with detailed instructions for each tool, edge cases, formatting rules. Pi's own system prompt is **~200 tokens**, and Vercel found that 1 bash tool replaced 17 specialized tools with a 80→100% success-rate jump. Context gets wasted on instructions the model already learned during RL training; the model has less room for actual task context.

**Why it happens:**
- Inherited mental model from frontier-model harnesses where prompt-shaped scaffolding is the only lever.
- "If the model can't do X, add a rule" — instead of "if the model can't do X, simplify the surface."
- Step-by-step instructions instead of boundary-setting (Pi's principle: "Never delete user data without explicit instruction" beats "Step 1: check, Step 2: delete").

**How to avoid:**
- Start with a minimal system prompt (~200-500 tokens). Add only when a concrete failure justifies it.
- Default to one general tool (bash) before adding specialized ones. Each specialized tool earns its place by solving something bash cannot do safely.
- Boundary-setting language, not procedure language.
- For each system-prompt addition: log which benchmark task drove it and what the failure was. Quarterly: revisit and remove additions whose driving failure no longer reproduces.
- Cap system-prompt length per profile; a hard ceiling forces tradeoffs.

**Warning signs:**
- System prompt > 2000 tokens for a small local model
- Tool count > 8 without obvious orthogonality
- Heavy specialization with overlapping tool descriptions
- Prompt grew over time without removing anything

**Phase to address:** Phase 3 (harness design). Severity: **High**.

---

### Pitfall 18: Sub-agent black-boxes destroying observability

**What goes wrong:**
The harness spawns sub-agents for "complex" tasks. Each sub-agent has its own context, its own tool calls, its own loop — none of which surface in the top-level trace. Debugging becomes "the sub-agent did something, returned this, and now the parent is confused." Pi's own design explicitly omits a sub-agent tool for this reason: "a black box within a black box."

**Why it happens:**
- Sub-agents look like an architectural win (decomposition!).
- Frontier-model harness patterns normalize them.
- Easier to hide complexity in a sub-call than to refactor the parent loop.

**How to avoid:**
- Default to no sub-agents. The agent loop runs flat.
- If decomposition is needed, prefer deterministic decomposition (parent calls deterministic helper functions, each emits a clear trace) over agentic decomposition.
- If a sub-agent is unavoidable: full trace propagation — every sub-agent step is in the parent's session log with clear nesting.
- Observability hook before merging any sub-agent feature: "can I replay and inspect this?"

**Warning signs:**
- Trace gaps where a sub-agent ran
- Sub-agent results that the parent treats as opaque
- Debugging requires opening multiple log files

**Phase to address:** Phase 3 (harness architecture). Severity: **Medium**.

---

### Pitfall 19: Multi-model routing latency overhead exceeds gain

**What goes wrong:**
The harness routes planning to model A, editing to model B, search to model C. Each route incurs a model load (if not hot), a cold prefix-cache penalty, and a routing-decision latency. Total latency is worse than just using model B for everything. On DGX Spark this is amplified — only one model fits "comfortably," so swapping costs disk I/O + warmup.

**Why it happens:**
- "Specialized models" looks like a free win.
- Routing decisions are themselves LLM calls in some patterns — adds 100-2000ms per route.
- Cold-start cost ignored. Spark's 2242 NVMe is not fast enough for casual model swapping.
- Prefix cache invalidates when switching models — first request to the new model is slow.

**How to avoid:**
- Router-overhead measured: only enable routing if the routed-model wins by more than the routing cost.
- Keep routed models *hot* in memory or accept they're not options. Don't route to models that swap.
- For decision-routing: prefer rule-based router (cheap regex / heuristic) over LLM router until LLM router is justified.
- A/B benchmark: single-model baseline vs routed setup, on the actual workload.
- Track per-route success rate; routes with low utilization get retired.

**Warning signs:**
- Cold-start latency > savings from using a smaller model
- Disk I/O spikes correlated with model switches
- Router decision adds > 200ms
- Routed paths called rarely (low utilization → prune)

**Phase to address:** Phase 3 (harness routing). Severity: **Medium**.

---

### Pitfall 20: Local-model-specific weaknesses ignored

**What goes wrong:**
Treating Gemma 4 / Qwen 3.6 as if they are frontier models. Documented and likely-to-recur weaknesses for this class of model:
- **Nested tool calls fail.** NESTFUL benchmark: GPT-4o gets 28% on nested API sequences; local models worse. Flattening nested argument schemas reduces parameter hallucination by 40-60%.
- **Long planning chains drift.** Without explicit `planning_interval`, CodeAgent writes invalid solutions on multi-step tasks; with planning, ToolCallingAgent plans well but fails to execute. Planning-step presence moves accuracy from 60% to 85%.
- **Sequential tool calls unreliable** (smolagents issue #938 reports sequential tool calls unreliable with local Ollama models).
- **Generic tool names ambiguous**: "search" vs "search_files" vs "grep" — local models pick wrong one without context.
- **Quantization compounds**: Qwen3.5 compiles less than Gemma 4 at every quantization level (Gated DeltaNet + 256 tiny experts more weight-precision-sensitive than Gemma 4's 128 experts).
- **System-prompt sensitivity higher**: small models more affected by chat-template / system-message handling differences.

**Why it happens:**
Capability gap between frontier and local models is real and asymmetric (some skills hold, others fall off a cliff — composition is one).

**How to avoid:**
- Tool schemas: flat, not nested. Concrete names, not generic ones (`grep` not `search`).
- Insert explicit planning steps for multi-step tasks. Don't rely on the model to plan implicitly.
- For sequential tool calls, prefer one composite tool that runs the sequence over N separate calls.
- Per-model profile encodes which tool-call patterns the model handles well. Routing/scaffolding adapts.
- Benchmark tests should include nested-tool-call and long-chain tasks specifically — not just isolated tool use.

**Warning signs:**
- Model invents tool argument values rather than fetching them
- Plans that include 3+ steps regularly fail at step 2-3
- Same task succeeds at frontier-model baseline, fails at local
- Generic tool names called with wrong args

**Phase to address:** Phase 2 (profile defaults), Phase 3 (harness tool design), Phase 6 (eval coverage). Severity: **Critical** — this is what makes "weak local model" work or not.

---

### Pitfall 21: NGC container Transformers pin drifts behind upstream model releases

NGC `nvcr.io/nvidia/vllm:YY.MM-py3` ships on a monthly cadence; the bundled `transformers` and `vllm` are frozen at tag time. New model architectures (new `model_type` string, new `*ForCausalLM` class) land first in upstream HuggingFace Transformers + upstream vLLM, and the NGC container usually lags by **4+ weeks**. For day-1 serving of a new model family, the NGC image may validate every other profile check (image digest present, schema valid, preflight green) then fail at vLLM boot with `pydantic ValidationError: model_type <X> not recognized`.

**Verified empirically 2026-04-23:** Gemma 4 26B-A4B released 2026-04-02 with native `gemma4` model class. NGC `vllm:26.03.post1-py3` (released 2026-04-09, vLLM 0.17.1 + Transformers 4.57.x) does NOT load it — even after patching `tool_call_parser: gemma4` → `functiongemma` (the Gemma 3 parser name). Transformers library itself predates `Gemma4ForCausalLM`. Loss of work: two real swap attempts, ~15 minutes of wall-clock + two clean D-04 rollbacks (which at least proves the rollback primitive works).

**Examples (this project):**
- Gemma 4 26B-A4B on NGC 26.03.post1: `ValidationError: The checkpoint you are trying to load has model type 'gemma4' but Transformers does not recognize this architecture`
- Qwen3.5 architecture on NGC 26.01 prior repo incident: similar class-missing error (forum thread vllm-ngc-container-26-01-py3-incompatible-with-new-qwen3-5-architecture-transformers-dependency-conflict #363328)

**Mitigations:**
- **Per-slot container pinning:** do NOT hard-couple every profile to the same container digest. Phase 4 v2 formalizes `container_image` + `container_image_digest` as per-profile fields, so Gemma 4 can sit on upstream `vllm/vllm-openai:*-arm64-cu130` while Qwen slots stay on NGC. Single project-wide container constant was Phase 1/2's simplification; it breaks the first time any model out-paces NGC's cadence.
- **Bundle validation that EXERCISES vLLM boot, not just schema:** profile validator passing is necessary but insufficient — add a "preflight boot" mode to the swap primitive that attempts a `docker run --rm ... vllm --help` against the pinned image before committing to a schema bump. (Out of scope for Phase 4; queue for Phase 5 eval-harness boot matrix.)
- **Upstream day-1 fallback path:** when NGC lags, upstream `vllm/vllm-openai:<model>-<date>-<arch>-<cu>` images ship Day-1. They're bigger-surface (less NVIDIA-integration-tested) but they boot. Pin by digest to preserve reproducibility; re-migrate to NGC when a tag catches up.
- **Detection:** this failure surfaces ONLY at vLLM startup — the swap primitive's exit-6 post-stop rollback path catches it cleanly, but the symptom is `wait_for_vllm timeout: /v1/models did not respond in 300s; last error: Connection refused`. That's too generic to diagnose from the rollback envelope alone; rely on `runs/boot-failures/*/docker-logs.txt` which captures the failing container's stderr before it's removed.

**Warning signs:**
- Brand-new model family (<30 days from release)
- Profile `model_hf_id` bumps but `container_image_digest` doesn't
- STACK.md claims "vLLM 0.19.x" support but the pinned NGC tag ships 0.17.x (check with `docker run --rm <image> python -c 'import vllm; print(vllm.__version__)'`)
- Forum posts from NVIDIA engineers recommending "upgrading transformers to X.Y.Z and patching vLLM"

**Phase to address:** Phase 4 v2 (this profile); Phase 5 (add boot-matrix test to eval harness). Severity: **Medium** — phase can close with deferrals but blocks the operator-gated evidence chain until resolved.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Bake sampling params into harness code instead of profile YAML | One less file to edit | Profile abstraction loses meaning; can't reproduce old benchmarks | Never — this is the project's central abstraction |
| Skip the air-gapped reproducibility test ("we have internet") | Saves test cycle | Project ships violating its own thesis; embarrassment when re-tested | Never — air-gapped is the thesis |
| Single-shot benchmark numbers | 3× faster eval cycle | All comparisons are noisy; can't trust profile changes | Acceptable for *exploratory* runs only; never for published numbers |
| Use HumanEval/original SWE-bench as primary | Easy comparison to published numbers | Contamination invalidates research-artifact claim | Never as primary; OK as one data point alongside contamination-resistant benchmarks |
| Reuse Phase 1 prompts verbatim from `setup_local_opencode` | Continuity | Inherited prompts may be contaminated; benchmarking measures memorization not capability | OK as one of multiple suites, with rephrased variants |
| Run vLLM at `--gpu-memory-utilization=0.95` | More KV cache | UMA contention with harness, OOM under bursty load | Only after sustained-load thermal validation passes |
| Pin vLLM to "latest" instead of exact commit | Get fixes automatically | Silent breakage; unreproducible benchmarks | Never for committed profiles; OK on a scratch branch |
| Use one summary system prompt across all models | Fewer prompts to maintain | Phase 2 lesson: cross-model prompt sharing causes regression | Never for production profiles |
| Skip system-prompt-echo test in benchmark loop | Faster benchmark startup | Will eventually hit a Phase-3-style silent system-prompt failure and waste a benchmark batch | Never — the cost of one debug cycle exceeds N test cycles |
| Use LLM-as-judge with `temperature > 0` and single judge run | "More natural" scoring | Judge variance dominates effect size; comparisons unreliable | Never for published numbers |
| Hot-swap models for multi-model routing on Spark's internal NVMe | Implements routing feature | Disk thermal accumulation, swap latency | Only with external NVMe-oF or with all routed models hot in memory |

## Integration Gotchas

Common mistakes when connecting components.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| pi.dev harness ↔ vLLM `/v1/messages` | Sending `system` parameter; assuming it's applied | Use chat-template-correct path for the model; add system-prompt echo test |
| Harness ↔ tool calling | Specialized tools per task | Start with `bash`; add specialized only after concrete failure (Vercel result) |
| Profile YAML ↔ serving config | Profile fields not validated against vLLM CLI flags | Pydantic schema; CI-validated against the pinned vLLM version |
| Profile YAML ↔ harness | Same field name, different semantics | Single source-of-truth schema shared by both; importable type definitions |
| HuggingFace gated models ↔ offline | Assuming cached = usable | Run `from_XXX()` once online to materialize placeholder files; document the step |
| vLLM ↔ DGX Spark | Stock PyPI install | Custom build with SM121 patches; pin vLLM commit |
| vLLM ↔ telemetry | Default-on telemetry violates "fully local" | `VLLM_NO_USAGE_STATS=1` in every profile and dockerfile |
| Speculative decoder ↔ EAGLE draft | Default tensor parallel for draft | `speculative_draft_tensor_parallel_size=1` (main can still TP) |
| Grammar backend ↔ vLLM | Outlines as default | XGrammar for nested schemas (multiple benchmarks agree) |
| Multi-model routing ↔ DGX Spark memory | Routing across models that swap | Keep all routed models hot, or don't route |
| Benchmark suite ↔ benchmark runs | Profile not pinned by SHA in result file | Embed full profile + vLLM commit + harness commit in result JSON |

## Performance Traps

Patterns that work in early development but fail under sustained use.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Aggressive `gpu_memory_utilization` without UMA accounting | Preemption logs, latency variance, harness OOM | Calculate budget; sustained-load test; reserve UMA headroom for harness | First time author runs harness + serving + heavy IDE on Spark |
| Speculative decoding always-on | Throughput regression under high QPS or high temperature | Per-profile spec-decode validation; track acceptance rate; disable if below break-even | High-temperature creative tasks, batched serving, long generations |
| Default `max_num_batched_tokens` for coding workload | TTFT swings; ITL during decode interrupts | Tune for the actual workload — code prefills are big | When real coding context (10K-40K) hits the system |
| Single-shot benchmark | Numbers don't reproduce on rerun | Multi-sample, batch-invariance, paired comparisons | First time someone outside the team tries to verify a claim |
| Tool-result truncation by length only | Agent loops on misread errors | Structured truncation; preserve diagnostic text verbatim | Real test failures, not synthetic ones |
| LLM-as-judge as the only quality metric | Numbers move when judge model updated | Pair judge scores with executable correctness (compile, test pass, count of objective signals) | Judge model swap or temperature change |
| System-prompt echo unverified | Phase 3 Qwen3 incident: 0/5 task success without warning | System-prompt-echo test in every benchmark loop | Any harness change that touches prompt assembly; any vLLM upgrade |
| Internal NVMe for model storage with multi-model routing | Storage thermal climb over sustained sessions | External NVMe-oF or all-hot-in-RAM strategy | Hour 2+ of sustained multi-model use |
| Benchmark suite pinned to once-off prompts | Looks reproducible until the prompt set turns out contaminated | Mix held-out + rephrased + LiveCodeBench; declare contamination risk | First serious external review |
| Profile drift unmonitored | Benchmark from last month no longer reproducible | Profile SHA in result file; staleness flag; CI validation per profile | Quarterly cleanup or first reproducibility request |

## Security / Privacy Mistakes

Domain-specific issues beyond general web security. Emmy is local, so the threat model is mostly *exfiltration* and *supply chain*.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Tool-call descriptions trust model output | Tool poisoning via crafted descriptions in MCP/plugins (researchers showed harmless-looking "joke_teller" with invisible instructions) | Static-validate tool descriptions; reject hidden Unicode / instruction-injection patterns; do not auto-load tools from untrusted sources |
| Default-on vLLM telemetry | "Local" claim breached; metadata leaks model + workload patterns | Set `VLLM_NO_USAGE_STATS=1` and `DO_NOT_TRACK=1` in every profile dockerfile and verify outbound traffic is zero |
| Bash tool exposed unsandboxed (Pi pattern) | Author personal-machine takeover via injection | Sandbox the bash tool (pi-mono includes sandboxing options); never run on a host with secrets in env |
| Web search / web fetch tools enabled by default | Cloud dependency leak; SSRF risk | Opt-in per session; clearly tagged as cloud; per-domain allowlist |
| Caching tool outputs to disk without scrub | Sensitive code/text persisted in plain text | Encrypt tool-result cache; document retention; allow per-session ephemeral mode |
| Prompt logging sent to cloud observability | Code from author's repos leaks to SaaS | Local-only observability stack (e.g. Langfuse self-hosted, or filesystem JSONL) |
| HuggingFace gated-model auth token in env | Token in process env exposes to all subprocesses | Use a dedicated read-only token; rotate quarterly |
| Model from untrusted source / community fine-tune | Backdoored weights — known precedent in HF ecosystem | Verified model checksums (sha256 against upstream); restrict to vendor-released weights for "stock" claim |
| Tool-output rendering passes raw model output to terminal | Terminal escape sequence injection (ANSI bombs from web fetches) | Strip / sanitize all rendered content before display |
| Multi-model routing across models with different sandboxes | Privilege escalation between model contexts | Single sandbox boundary at the harness layer, not per-model |

## UX Pitfalls

Common user-experience mistakes for daily-driver coding agents.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| p99 latency ignored in favor of p50 | Author abandons emmy when one slow turn breaks flow | Track p99 and tail-cut; profile changes that improve p50 but worsen p99 fail the gate |
| No way to interrupt mid-stream cleanly | Author has to kill the process; loses session context | Streaming + clean cancellation; session resume |
| Tool-call output dumped raw at high volume | Terminal floods, hard to skim | Smart formatting per tool type; collapsible; keep raw available via shortcut |
| Agent asks the same clarifying question twice | Looks dumb; trust collapses | Track asked-questions per session; suppress duplicates |
| No "what is the model doing?" affordance | Author waits in silence, doesn't know if to interrupt | Streaming reasoning + tool-call announcements; progress visible |
| Re-prompting on transient failures invisible | Token burn invisible to author | Surface retry count; fail loudly after N retries instead of silently |
| Sub-tasks complete but author can't see what changed | Manual diff hunting after every session | Per-session change manifest (files touched, tests run, commits made) |
| Silent context truncation | Agent suddenly forgets earlier session content | Surface "context compacted" event with summary of what was kept |
| Model swap mid-session (multi-routing) without notice | Different style/tone causes friction | Either route invisibly (consistent persona) or announce |
| "Daily driver" tested only on author's preferred task type | Regressions on other workflows hidden | Journal must rotate task type; benchmark suite covers task diversity |

## "Looks Done But Isn't" Checklist

- [ ] **vLLM serving setup:** Often missing `VLLM_NO_USAGE_STATS=1` — verify outbound traffic is zero during inference
- [ ] **Model profile:** Often missing exact vLLM commit hash — verify profile pins commit, not just minor version
- [ ] **Model profile:** Often missing system-prompt-echo test result — verify smoke test passes before declaring profile valid
- [ ] **Model profile:** Often missing sustained-load thermal test — verify 2-hour run shows stable clocks
- [ ] **Grammar-constrained output:** Often missing no-grammar baseline comparison — verify quality regression < 5%
- [ ] **Speculative decoding:** Often missing per-workload spec-on/spec-off comparison — verify spec actually wins on this profile
- [ ] **Quantization choice:** Often missing compile-rate validation — verify FP4/FP8 doesn't drop compile rate >5% vs higher precision
- [ ] **Benchmark numbers:** Often single-shot — verify ≥3 samples per prompt with std reported
- [ ] **Benchmark suite:** Often only public benchmarks — verify includes held-out + rephrased contamination control
- [ ] **Benchmark result files:** Often missing profile SHA + vLLM commit + harness commit — verify all three embedded
- [ ] **Air-gapped reproducibility:** Often assumed, never tested — verify pulling network cable doesn't break the workflow
- [ ] **System prompt:** Often grew over time — verify length is justified per addition; quarterly review/prune
- [ ] **Tool count:** Often grew over time — verify each non-bash tool earns its place against bash
- [ ] **Sub-agents:** Often introduced for "complex" tasks — verify trace shows each step (no black boxes)
- [ ] **Tool-result truncation:** Often head/tail by length — verify error/diagnostic content preserved
- [ ] **Daily-driver claim:** Often based on author's last 3 sessions — verify journal entries span ≥2 weeks and ≥3 task types
- [ ] **HuggingFace gated models:** Often "downloaded" but not materialized — verify offline `from_pretrained()` works without re-auth
- [ ] **Telemetry / observability:** Often defaults to SaaS — verify entire stack runs local
- [ ] **Multi-model routing:** Often demoed with hot models — verify steady-state behavior including any required swaps

## Recovery Strategies

When pitfalls occur despite prevention.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| KV cache OOM / preemption discovered post-deploy | LOW | Lower `gpu_memory_utilization` and/or `max_num_seqs`; rerun thermal/throughput validation; bump profile minor version |
| vLLM upgrade silently changed behavior | MEDIUM | Pin to last-known-good commit; re-run benchmark suite under both versions to characterize delta; document migration |
| Grammar quality regression detected | LOW | Disable grammar; verify quality recovers; redesign tool schema (flatter, smaller); re-enable; bump profile |
| Speculative decoding regression | LOW | Disable spec decode in profile; profile minor bump; flag for revisit when EAGLE-3+ improves |
| "More prompting" regression detected | LOW | Revert prompt; bump profile minor; document the failed tuning as evidence in the profile changelog |
| System-prompt delivery silently broken (Phase 3 incident) | MEDIUM | Add system-prompt-echo to all benchmarks; redo any benchmark batch run during the broken window; document fix in profile metadata |
| DGX Spark thermal shutdown | MEDIUM | Reduce sustained load; add cooldown breaks; consider throttling target clock; rerun thermal validation |
| FP4 quality cliff discovered | LOW–MEDIUM | Switch profile to FP8; rerun benchmark suite; document compile-rate delta as evidence |
| Test-set contamination revealed | HIGH | Republish all benchmark numbers with rephrased and held-out tracks; update research-artifact claims; run LiveCodeBench |
| Benchmark variance discovery | MEDIUM | Re-run all comparisons with 3+ samples + batch invariance; recompute deltas with std; refute or confirm prior claims |
| LLM-as-judge bias discovered | MEDIUM | Re-judge with different model family; cross-validate with executable metrics; update eval methodology |
| Hidden cloud dependency discovered | MEDIUM | Air-gap test, identify the leak, eliminate (offline cache, telemetry off, etc.); add to "looks done" checklist |
| Daily-driver / benchmark divergence detected | MEDIUM | Investigate which subjective signal disagreed; modify benchmark suite to capture it; document profile as "wins X, loses Y" rather than "best" |
| Profile drift / sprawl discovered | MEDIUM | Profile audit + cull; CI-enforce profile validation; bump major version on the surviving canonical set |
| Tool-result truncation caused agent loop | LOW | Patch truncation strategy; add inject-test to harness test suite; verify with replay |
| Infinite ReAct loop in production | LOW | Lower `max_iterations`; add no-progress detection; ship hotfix; run replay against historical sessions to find similar near-misses |

## Pitfall-to-Phase Mapping

How roadmap phases should address each pitfall. Phases are notional — adjust to roadmap output.

| # | Pitfall | Prevention Phase | Verification |
|---|---------|------------------|--------------|
| 1 | KV-cache budget mis-set | Phase 1 (vLLM serving) | Sustained-load test passes; preemption rate = 0 |
| 2 | vLLM API churn | Phase 1 (profile schema) | Profile SHA-pins exact commit; CI builds dockerfile |
| 3 | Grammar fights model | Phase 2 (structured output) | No-grammar baseline benchmark; XGrammar perf within 5% TPOT |
| 4 | Speculative decoding regression | Phase 2/3 (latency) | Spec-on vs spec-off paired benchmark on actual workload |
| 5 | "More prompting" trap | Phase 2 (profile defaults), Phase 6 (eval) | Full-suite eval mandatory; subset-only changes blocked |
| 6 | System-prompt delivery broken | Phase 1, Phase 3, Phase 6 | System-prompt-echo test in every benchmark loop |
| 7 | DGX Spark thermal | Phase 1 (serving setup) | 2-hour sustained-load test; clock + temp monitoring |
| 8 | Quantization quality cliff | Phase 1 (model profile) | Compile-rate validation per quantization choice |
| 9 | Test-set contamination | Phase 6 (benchmark suite) | LiveCodeBench + held-out + rephrased tracks |
| 10 | Benchmark variance hidden | Phase 6 (eval methodology) | ≥3 samples; batch invariance enabled; std reported |
| 11 | LLM-as-judge bias | Phase 6 (eval methodology) | Different judge family; executable metrics paired |
| 12 | Hidden cloud dependencies | Phase 1, Phase 3, Phase 6 | Air-gap reproducibility test in CI |
| 13 | Daily-driver / benchmark divergence | Phase 6, recurring at every milestone | Dual-stream measurement; disagreement tracked |
| 14 | Profile sprawl / drift | Phase 4 (profile abstraction) | Profile-validation test in CI; SHA in result files |
| 15 | Tool-result truncation drops critical info | Phase 3 (harness context) | Inject-test for critical-line preservation |
| 16 | Infinite ReAct loop | Phase 3 (agent loop) | Layered stopping conditions; chaos test with broken tool |
| 17 | System-prompt scaffolding bloat | Phase 3 (harness design) | System prompt length cap; quarterly prune |
| 18 | Sub-agent observability black-box | Phase 3 (harness architecture) | Replay test for any sub-agent flow |
| 19 | Multi-model routing overhead | Phase 3 (harness routing) | Routed vs single-model paired benchmark |
| 20 | Local-model weaknesses ignored | Phase 2, Phase 3, Phase 6 | Profile encodes model-specific scaffolding; eval includes nested-tool & long-chain tasks |

## Sources

**Prior repo (highest signal — direct evidence):**
- `/data/projects/setup_local_opencode/validation/PHASE2_TUNING_REPORT.md` — Qwen3 8.5 → 6.8 regression on tuning; "more guidance is not always better"
- `/data/projects/setup_local_opencode/validation/COMPREHENSIVE_FINAL_ANALYSIS.md` — Qwen3 Phase 3 system-prompt delivery failure (5/5 tasks scored 5.0/10 at 200-300 chars)
- `/data/projects/setup_local_opencode/validation/EXECUTIVE_SUMMARY.md` — model rankings + GPT-OSS endpoint failure mode
- `/data/projects/emmy/.planning/PROJECT.md` — eight pain points motivating pi.dev harness; subjective/objective tension

**vLLM serving:**
- vLLM Issue #36973: Triton autotuned kernel warmup leaks ~3.4 GiB after empty_cache (KV cache OOM)
- vLLM Issue #11188: Speculative decoding draft acceptance rate decreasing over time
- vLLM Issue #15025: Speculative decoding with draft model makes generation slower
- vLLM Issue #21313: Anthropic `/v1/messages` endpoint feature
- vLLM Issue #39043: vLLM + Gemma 4 + Claude Code tool calling problems
- vLLM Optimization & Tuning docs (https://docs.vllm.ai/en/stable/configuration/optimization/)
- vLLM Speculative Decoding docs (https://docs.vllm.ai/en/latest/features/spec_decode/)
- vLLM Tool Calling docs (https://docs.vllm.ai/en/latest/features/tool_calling/)
- vLLM Batch Invariance docs (https://docs.vllm.ai/en/latest/features/batch_invariance/)
- vLLM Usage Stats docs (https://docs.vllm.ai/en/latest/usage/usage_stats.html)
- SitePoint vLLM Production Deployment Guide 2026 (KV cache + load balancing pitfalls)
- BentoML "3× Faster LLM Inference with Speculative Decoding" — draft model selection
- Red Hat "Performance improvements with speculative decoding in vLLM for gpt-oss" (April 2026)

**DGX Spark:**
- NVIDIA Developer Forum: "DGX Spark Thermal throttling" (clocks throttled 2.8 → 2GHz)
- NVIDIA Developer Forum: "DGX Spark Shutdown around 95°C during nanoChat Pretraining"
- NVIDIA Developer Forum: "Effective PyTorch and CUDA" (compatibility)
- NVIDIA Developer Forum: "Custom built vLLM + Qwen3.5-35B on DGX Spark — 50 tok/s, 1M context"
- NVIDIA Developer Forum: "vLLM 0.17.0 MXFP4 Patches for DGX Spark"
- StorageReview "NVIDIA DGX Spark Thermal Test"
- LMSYS DGX Spark In-Depth Review (October 2025)
- DGX Spark User Guide (March 2026)
- llama.cpp Issue #21912: full prompt reprocessing in OpenCode/Pi with Gemma 4 + Qwen 3.5

**Grammar / structured output:**
- arxiv 2501.10868 (JSONSchemaBench): constrained-decoding framework comparison
- arxiv 2411.15100 (XGrammar paper)
- BentoML LLM Handbook: structured outputs
- Red Hat "Structured outputs in vLLM"
- vLLM Forum: "Improving Speculative Decoding for Beginning Tokens & Structured Output"

**Coding-agent harness / pi.dev:**
- Mario Zechner "What I learned building an opinionated and minimal coding agent" (Pi)
- Armin Ronacher "Pi: The Minimal Agent Within OpenClaw"
- HumanLayer "Skill Issue: Harness Engineering for Coding Agents"
- Martin Fowler "Harness engineering for coding agent users"
- Avi Chawla "The Anatomy of an Agent Harness"
- agentpatterns.tech "Infinite Agent Loop"
- LlamaIndex Issue #16499: Infinite ReAct loop bug
- arxiv 2603.05344 "Building AI Coding Agents for the Terminal"
- DEV "Pi Coding Agent: A Self-Documenting, Extensible AI Partner"
- pi-mono GitHub (badlogic/pi-mono)

**Local model tool calling:**
- Miguel Filipe "Gemma 4 vs Qwen3.5: benchmarking quantized local LLMs on Go coding"
- MindStudio "Gemma 4 31B vs Qwen 3.5 for Agentic Workflows"
- NESTFUL benchmark (aclanthology 2025.emnlp-main.1702): nested API call accuracy
- ToolHop benchmark
- smolagents Issue #938: Sequential tool calls unreliable with local Ollama models
- DEV "Why LLM agents break when you give them tools"

**Context management:**
- Anthropic Claude Cookbook: Automatic context compaction
- LangChain "Context engineering in Deep Agents"
- Microsoft Agent Framework: Compaction
- dbreunig "How Long Contexts Fail"

**Evaluation / contamination:**
- arxiv 2311.11123 "(Why) Is My Prompt Getting Worse?" — 58.8% prompt+model combos drop accuracy on API updates
- arxiv 2310.10508 "Prompt Engineering or Fine-Tuning"
- LiveCodeBench (livecodebench.github.io)
- LiveBench (OpenReview)
- SWE-bench Verified leaderboard (codeant.ai)
- arxiv 2512.12066 "The Instability of Safety: How Random Seeds and Temperature Expose Inconsistent LLM Refusal Behavior"
- arxiv 2506.09501 "Numerical Sources of Nondeterminism in LLM Inference"
- arxiv 2408.04667 "LLM Stability"
- AI21 "Gold-Like Answers Reveal LLM Judge Bias in Coding Benchmarks"
- arxiv 2412.05579 "LLMs-as-Judges Survey"
- Thinking Machines "Defeating Nondeterminism in LLM Inference" (batch invariance)
- arxiv 2501.17116 "Optimizing Large Language Model Training Using FP4 Quantization"
- DeepInfra "From Precision to Quantization"
- aimultiple "LLM Quantization: BF16 vs FP8 vs INT4"
- HuggingFace gated-models docs + Issue #29177 (offline gated repo authentication)

**Multi-model routing:**
- TrueFoundry "Multi-Model Routing"
- AWS "Multi-LLM routing strategies"
- liteLLM Routing docs
- agenta "Top LLM Gateways 2025"
- Bifrost / Solo.io routing performance data

**Profile / config / drift:**
- DVC blog "Don't Just Track Your ML Experiments, Version Them"
- Neptune "ML Experiment Management"
- lakeFS "ML Model Versioning"
- Hydra config management

---
*Pitfalls research for: local-first coding agent on DGX Spark (vLLM serving + pi.dev harness)*
*Researched: 2026-04-20*
