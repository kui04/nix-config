#!/usr/bin/env bash
# Ensure a named Zellij background session exists, creating it if missing.
# Safe to call repeatedly (no-op if the session is already running).
#
# Usage: session.sh <session-name> [layout]
#   layout: optional layout name (e.g. "compact") or path to a .kdl file
#
# Prints the session name on success.
set -euo pipefail

SESSION="${1:?usage: session.sh <session-name> [layout]}"
LAYOUT="${2:-}"

if zellij list-sessions --short 2>/dev/null | grep -qx "$SESSION"; then
  echo "$SESSION"
  exit 0
fi

if [ -n "$LAYOUT" ]; then
  zellij attach --create-background "$SESSION" options --default-layout "$LAYOUT" >/dev/null
else
  zellij attach --create-background "$SESSION" >/dev/null
fi

echo "$SESSION"
