#!/usr/bin/env bash
# Phase 04.2 — systemd unit syntax smoke check.
# Run on any systemd-host (developer laptop or Spark): asserts the in-repo unit
# parses cleanly via systemd-analyze verify. CI gates on this script's exit code.
#
# Note: systemd-analyze may emit non-fatal warnings about
# `Documentation=file://...` not resolving on hosts where the documented file
# does not exist (the unit assumes %h/code/emmy on the operator's box). These
# are warnings, not errors — exit 0 is the only acceptance bar.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
exec systemd-analyze verify emmy_serve/systemd/emmy-sidecar.service
