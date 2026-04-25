#!/usr/bin/env bash
# emmy client-install bootstrap.
#
# Sets up a Mac (or Linux) machine to run pi-emmy as a remote client against a
# Spark host that's already running emmy-serve + tailscale serve. After this
# script: `emmy` works from any folder; tools (bash/edit/read) act on the
# client's filesystem; inference offloads to Spark over Tailscale.
#
# Usage (one-press):
#   curl -fsSL https://raw.githubusercontent.com/mratan/emmy/main/scripts/install-client.sh | bash
#
# Usage (review first):
#   curl -fsSL https://raw.githubusercontent.com/mratan/emmy/main/scripts/install-client.sh -o install-client.sh
#   less install-client.sh
#   bash install-client.sh
#
# Env overrides (rarely needed):
#   EMMY_REPO_URL    — git URL to clone (default: https://github.com/mratan/emmy.git)
#   EMMY_INSTALL_DIR — where to clone (default: $HOME/code/emmy)
#   EMMY_SPARK_HOST  — Tailscale MagicDNS for emmy-serve (default: auto-detected)
#   EMMY_SKIP_SMOKE  — set to 1 to skip the end-to-end inference smoke test

set -euo pipefail

EMMY_REPO_URL="${EMMY_REPO_URL:-https://github.com/mratan/emmy.git}"
EMMY_INSTALL_DIR="${EMMY_INSTALL_DIR:-$HOME/code/emmy}"
EMMY_SPARK_HOST="${EMMY_SPARK_HOST:-}"
EMMY_SKIP_SMOKE="${EMMY_SKIP_SMOKE:-0}"

color_red()    { printf '\033[31m%s\033[0m\n' "$*"; }
color_green()  { printf '\033[32m%s\033[0m\n' "$*"; }
color_yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
color_bold()   { printf '\033[1m%s\033[0m\n' "$*"; }

step() { echo; color_bold "▶ $*"; }
ok()   { color_green "  ✓ $*"; }
warn() { color_yellow "  ⚠ $*"; }
die()  { color_red   "  ✗ $*"; exit 1; }

OS="$(uname -s)"

# ----------------------------------------------------------------------------
# 1. Detect prereqs (bun, git, curl, tailscale)
# ----------------------------------------------------------------------------
step "Checking prerequisites"

case "$OS" in
  Darwin)
    if ! command -v brew >/dev/null 2>&1; then
      die "Homebrew not installed. Install from https://brew.sh first, then re-run."
    fi
    ok "Homebrew found"
    ;;
  Linux) ok "Linux detected (using existing package manager)" ;;
  *) die "Unsupported OS: $OS (Mac and Linux only)" ;;
esac

install_pkg() {
  local pkg="$1"
  if command -v "$pkg" >/dev/null 2>&1; then ok "$pkg found"; return; fi
  warn "$pkg missing — installing"
  case "$OS" in
    Darwin) brew install "$pkg" ;;
    Linux)
      if   command -v apt-get >/dev/null 2>&1; then sudo apt-get install -y "$pkg"
      elif command -v dnf     >/dev/null 2>&1; then sudo dnf install -y "$pkg"
      elif command -v pacman  >/dev/null 2>&1; then sudo pacman -S --noconfirm "$pkg"
      else die "No supported package manager (apt/dnf/pacman) — install $pkg manually."
      fi
      ;;
  esac
  ok "$pkg installed"
}

install_pkg git
install_pkg curl

if ! command -v bun >/dev/null 2>&1; then
  warn "bun missing — installing via official installer"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  command -v bun >/dev/null 2>&1 || die "bun install failed; check ~/.bun/bin"
fi
ok "bun $(bun --version)"

if ! command -v tailscale >/dev/null 2>&1; then
  case "$OS" in
    Darwin)
      # App Store Tailscale on Mac bundles the CLI inside the .app but doesn't
      # symlink into PATH by default. Detect this and give a precise fix.
      if [[ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]]; then
        warn "Tailscale.app found, but the 'tailscale' CLI isn't on PATH."
        warn "Two ways to fix:"
        warn "  GUI:  Click the Tailscale menu-bar icon → 'Install Command Line Tools...'"
        warn "  CLI:  Pick the right one for your Mac:"
        if [[ -d /opt/homebrew ]]; then
          warn "          sudo ln -sf /Applications/Tailscale.app/Contents/MacOS/Tailscale /opt/homebrew/bin/tailscale"
        else
          warn "          sudo ln -sf /Applications/Tailscale.app/Contents/MacOS/Tailscale /usr/local/bin/tailscale"
        fi
        warn "Then verify with 'tailscale status' and re-run this installer."
        die "Tailscale CLI not on PATH"
      fi
      die "Tailscale not installed. Get it from https://tailscale.com/download/mac (App Store version recommended)."
      ;;
    Linux)  die "Tailscale not installed. See https://tailscale.com/download/linux for distro-specific install." ;;
  esac
fi
ok "tailscale found"

if ! tailscale status >/dev/null 2>&1; then
  die "Tailscale not logged in. Run 'tailscale up' (Linux) or sign into the Mac app first."
fi
ok "tailscale active"

# ----------------------------------------------------------------------------
# 2. Auto-detect Spark MagicDNS (or use override)
# ----------------------------------------------------------------------------
step "Locating Spark on the tailnet"

if [[ -z "$EMMY_SPARK_HOST" ]]; then
  EMMY_SPARK_HOST="$(
    tailscale status --json 2>/dev/null | python3 -c '
import json, sys
d = json.load(sys.stdin)
peers = list(d.get("Peer", {}).values())
# Prefer hostnames containing "spark"; fall back to printing all linux peers
spark = [p for p in peers if "spark" in p.get("HostName","").lower() and p.get("OS")=="linux"]
if spark:
    name = spark[0].get("DNSName","").rstrip(".")
    print(name)
' || true
  )"
fi

if [[ -z "$EMMY_SPARK_HOST" ]]; then
  warn "Could not auto-detect Spark from tailnet. Set EMMY_SPARK_HOST=<spark>.<tailnet>.ts.net and re-run."
  warn "Available tailnet peers:"
  tailscale status 2>/dev/null | awk '/^[0-9]/ { print "    " $1, $2, $4 }'
  die "EMMY_SPARK_HOST not set"
fi

ok "Spark host: $EMMY_SPARK_HOST"

# ----------------------------------------------------------------------------
# 3. Verify Spark Tailscale Serve is exposing emmy-serve
# ----------------------------------------------------------------------------
step "Verifying Tailscale Serve reachability"

if ! curl -sf --max-time 10 "https://$EMMY_SPARK_HOST/v1/models" >/dev/null 2>&1; then
  warn "Cannot reach https://$EMMY_SPARK_HOST/v1/models — checks before retrying:"
  warn "  1. emmy-serve is running on Spark:        ssh $EMMY_SPARK_HOST 'docker ps | grep emmy-serve'"
  warn "  2. Tailscale Serve config exists on Spark: ssh $EMMY_SPARK_HOST 'tailscale serve status'"
  warn "  3. Tailscale routes are healthy:           tailscale ping $EMMY_SPARK_HOST"
  die "Spark unreachable; aborting before clone"
fi

MODEL_ID="$(curl -sf "https://$EMMY_SPARK_HOST/v1/models" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"][0]["id"])' 2>/dev/null || echo "?")"
ok "Spark replied — current served model: $MODEL_ID"

# ----------------------------------------------------------------------------
# 4. Clone (or update) the emmy repo
# ----------------------------------------------------------------------------
step "Cloning emmy repo to $EMMY_INSTALL_DIR"

if [[ -d "$EMMY_INSTALL_DIR/.git" ]]; then
  ok "Existing checkout found — pulling latest"
  git -C "$EMMY_INSTALL_DIR" pull --ff-only || warn "pull failed; manual resolution may be needed"
else
  mkdir -p "$(dirname "$EMMY_INSTALL_DIR")"
  git clone "$EMMY_REPO_URL" "$EMMY_INSTALL_DIR"
  ok "Cloned"
fi

step "Installing JS dependencies (bun install)"
( cd "$EMMY_INSTALL_DIR" && bun install )
ok "Dependencies installed"

# ----------------------------------------------------------------------------
# 5. Write the emmy wrapper to ~/.local/bin
# ----------------------------------------------------------------------------
step "Installing emmy wrapper to ~/.local/bin/emmy"

mkdir -p "$HOME/.local/bin"
WRAPPER="$HOME/.local/bin/emmy"

cat > "$WRAPPER" <<WRAPPEREOF
#!/bin/sh
# emmy — remote-client wrapper.
# Routes inference to Spark via Tailscale Serve; tools execute locally.
# Generated by emmy/scripts/install-client.sh — re-run that to update.
exec env \\
  EMMY_PROFILE_ROOT="$EMMY_INSTALL_DIR" \\
  EMMY_SKIP_PROFILE_VALIDATE=1 \\
  EMMY_WEB_SEARCH=off \\
  bun "$EMMY_INSTALL_DIR/packages/emmy-ux/bin/pi-emmy.ts" \\
  --base-url "https://$EMMY_SPARK_HOST" \\
  "\$@"
WRAPPEREOF
chmod +x "$WRAPPER"
ok "Wrapper installed: $WRAPPER"

# ----------------------------------------------------------------------------
# 6. Ensure ~/.local/bin is on PATH (zsh + bash; idempotent)
# ----------------------------------------------------------------------------
step "Verifying ~/.local/bin is on PATH"

PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
PATH_NEEDS_ADD=0

case ":$PATH:" in
  *":$HOME/.local/bin:"*) ok "Already on PATH" ;;
  *) PATH_NEEDS_ADD=1 ;;
esac

add_to_rc() {
  local rc="$1"
  [[ -f "$rc" ]] || return 0
  if grep -Fq "$PATH_LINE" "$rc" 2>/dev/null; then
    ok "$rc already has the PATH line"
  else
    echo "" >> "$rc"
    echo "# Added by emmy install-client.sh" >> "$rc"
    echo "$PATH_LINE" >> "$rc"
    ok "Appended PATH line to $rc"
  fi
}

if [[ "$PATH_NEEDS_ADD" -eq 1 ]]; then
  add_to_rc "$HOME/.zshrc"
  add_to_rc "$HOME/.bashrc"
  add_to_rc "$HOME/.bash_profile"
  warn "Open a new terminal (or 'source ~/.zshrc') to pick up the PATH change."
fi

# Make emmy reachable in the current shell session for the smoke test.
export PATH="$HOME/.local/bin:$PATH"

# ----------------------------------------------------------------------------
# 7. End-to-end smoke test
# ----------------------------------------------------------------------------
if [[ "$EMMY_SKIP_SMOKE" == "1" ]]; then
  warn "Skipping end-to-end smoke test (EMMY_SKIP_SMOKE=1)"
else
  step "Running end-to-end smoke test"
  if "$WRAPPER" --print "Reply with: SP_OK_INSTALL_PASS" 2>&1 | tee /tmp/emmy-install-smoke.log | grep -q "SP_OK_INSTALL_PASS"; then
    ok "Smoke test PASSED — emmy is wired up end-to-end"
  else
    warn "Smoke test did not return the expected token. Last 20 log lines:"
    tail -20 /tmp/emmy-install-smoke.log | sed 's/^/    /'
    warn "This may be transient (cold start, network blip). Try: emmy --print 'hi'"
  fi
fi

# ----------------------------------------------------------------------------
# Done
# ----------------------------------------------------------------------------
echo
color_green "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
color_green "  emmy client install complete."
color_green "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo "Try it:"
echo "    cd ~/some-project"
echo "    emmy                                  # interactive TUI"
echo "    emmy --print 'Summarize this repo'    # one-shot"
echo
echo "Where things live on this machine:"
echo "    Repo:    $EMMY_INSTALL_DIR"
echo "    Wrapper: $WRAPPER"
echo "    Config:  baked into the wrapper (re-run install-client.sh to change)"
echo
echo "Update the client (when Spark gets new commits):"
echo "    bash $EMMY_INSTALL_DIR/scripts/install-client.sh"
echo
