#!/usr/bin/env bash
# Ensure a named, DETACHED Zellij session exists, creating it if missing.
# Safe to call repeatedly (no-op if the session is already running).
#
# Use this directly only when a task must survive independently of whatever
# session pi/the user is currently looking at (e.g. it should keep running
# even after they close their terminal). For the common case, use
# current-or-new-session.sh instead, which reuses the session pi is already
# running inside when there is one, so tasks show up as a tab the user can
# watch live.
#
# Usage: background-session.sh <session-name> [layout]
#   layout: optional layout name (e.g. "compact") or path to a .kdl file
#
# Prints the session name on success.
set -euo pipefail

SESSION="${1:?usage: background-session.sh <session-name> [layout]}"
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
