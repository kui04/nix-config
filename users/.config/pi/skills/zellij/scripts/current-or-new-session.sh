#!/usr/bin/env bash
# Pick which Zellij session a task should run in, preferring the session
# pi/the user is already attached to (if any) over a hidden background one.
#
# - If this shell is running inside a Zellij pane ($ZELLIJ is set), prints
#   $ZELLIJ_SESSION_NAME. No session is created — it already exists and is
#   already attached, so tasks spawned into it (see spawn.sh) show up as a
#   new tab the user can switch to and watch in real time.
# - Otherwise, falls back to background-session.sh: ensures/creates a
#   detached session with the given name (or "pi-<cwd basename>" if omitted)
#   and prints its name.
#
# Usage: current-or-new-session.sh [fallback-name] [fallback-layout]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -n "${ZELLIJ:-}" ] && [ -n "${ZELLIJ_SESSION_NAME:-}" ]; then
  echo "$ZELLIJ_SESSION_NAME"
  exit 0
fi

FALLBACK_NAME="${1:-pi-$(basename "$PWD")}"
FALLBACK_LAYOUT="${2:-}"

exec "$SCRIPT_DIR/background-session.sh" "$FALLBACK_NAME" "$FALLBACK_LAYOUT"
