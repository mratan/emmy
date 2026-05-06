#!/usr/bin/env bash
# boot-monitor.sh — sample memory state every 5s during a vLLM boot.
#
# Usage:
#   scripts/boot-monitor.sh runs/boot-experiments/v2.3-e1/anon-rss.tsv
#
# Writes one line per 5s sample with these columns:
#   ts_iso  ec_rss_kb  total_anon_kb  swap_used_kb  buff_cache_kb
#   mem_avail_kb  mem_free_kb  gpu_used_mib  shard_pct  vllm_state
#
# Stops automatically when the emmy-serve container exits (success or OOM).
# Otherwise runs for the timeout (default 1200s = 20 min).

set -uo pipefail

OUT="${1:?usage: boot-monitor.sh <output_tsv>}"
TIMEOUT="${2:-1200}"

# Header
{
  echo -e "ts_iso\tec_rss_kb\ttotal_anon_kb\tswap_used_kb\tbuff_cache_kb\tmem_avail_kb\tmem_free_kb\tgpu_used_mib\tshard_pct\tvllm_state"
} > "$OUT"

start_ts=$(date +%s)
while true; do
  now=$(date +%s)
  elapsed=$((now - start_ts))
  if (( elapsed > TIMEOUT )); then
    echo "boot-monitor timeout reached ($TIMEOUT s); stopping" >&2
    break
  fi

  # Container alive check
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^emmy-serve$"; then
    # container gone (either before start, or after exit/OOM)
    if (( elapsed > 10 )); then
      echo "container emmy-serve no longer running (elapsed=${elapsed}s); stopping" >&2
      break
    fi
  fi

  ts_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # EngineCore RSS
  ec_rss=$(ps -eo rss,comm 2>/dev/null | awk '$2 ~ /VLLM::EngineCor/ {sum+=$1} END {print (sum?sum:0)}')

  # /proc/meminfo derived
  meminfo=$(cat /proc/meminfo 2>/dev/null)
  mem_free=$(echo "$meminfo" | awk '/^MemFree:/ {print $2}')
  mem_avail=$(echo "$meminfo" | awk '/^MemAvailable:/ {print $2}')
  buff_cache=$(echo "$meminfo" | awk '/^Buffers:/ {b=$2} /^Cached:/ {c=$2} END {print b+c}')
  active_anon=$(echo "$meminfo" | awk '/^Active\(anon\):/ {print $2}')
  inactive_anon=$(echo "$meminfo" | awk '/^Inactive\(anon\):/ {print $2}')
  total_anon=$((active_anon + inactive_anon))
  swap_total=$(echo "$meminfo" | awk '/^SwapTotal:/ {print $2}')
  swap_free=$(echo "$meminfo" | awk '/^SwapFree:/ {print $2}')
  swap_used=$((swap_total - swap_free))

  # GPU memory (may not be available on iGPU per Spark Known Issues)
  gpu_used="n/a"
  if command -v nvidia-smi >/dev/null 2>&1; then
    gpu_used=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ' || echo "n/a")
    [ -z "$gpu_used" ] && gpu_used="n/a"
  fi

  # vLLM shard load progress (from container logs, last matching line)
  shard_pct="n/a"
  vllm_state="loading"
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^emmy-serve$"; then
    last_log=$(docker logs --tail 50 emmy-serve 2>&1 | tail -50)
    # grab last "Loading safetensors checkpoint shards: NN%" or similar
    shard_pct=$(echo "$last_log" | grep -oE "Loading safetensors checkpoint shards:\s+[0-9]+%" | tail -1 | grep -oE "[0-9]+%" || echo "n/a")
    if echo "$last_log" | grep -q "Application startup complete"; then
      vllm_state="ready"
    elif echo "$last_log" | grep -q "estimated max_model_len"; then
      vllm_state="profiling"
    fi
    [ -z "$shard_pct" ] && shard_pct="n/a"
  fi

  printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
    "$ts_iso" "$ec_rss" "$total_anon" "$swap_used" "$buff_cache" \
    "$mem_avail" "$mem_free" "$gpu_used" "$shard_pct" "$vllm_state" >> "$OUT"

  # Bail if vllm reached ready state
  if [ "$vllm_state" = "ready" ]; then
    echo "vLLM reached ready state at elapsed=${elapsed}s; stopping" >&2
    break
  fi

  sleep 5
done

echo "boot-monitor done; output at $OUT"
