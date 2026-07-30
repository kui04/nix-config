#!/usr/bin/env bash
# Poll a named tab's current viewport (dump-screen) until an extended-regex
# pattern appears, or time out. Useful for REPL prompts, SSH shell prompts,
# or a unique sentinel string echoed after a command.
#
# Usage: wait-for.sh <session> <tab-name> <grep-ERE-pattern> [timeout-seconds] [poll-interval]
#
# Prints the final screen and exits 0 on match; exits 1 on timeout (also
# printing the last screen, to stderr, for debugging).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SESSION="${1:?usage: wait-for.sh <session> <tab-name> <pattern> [timeout] [interval]}"
NAME="${2:?usage: wait-for.sh <session> <tab-name> <pattern> [timeout] [interval]}"
PATTERN="${3:?usage: wait-for.sh <session> <tab-name> <pattern> [timeout] [interval]}"
TIMEOUT="${4:-60}"
INTERVAL="${5:-1}"

PANE_ID=$("$SCRIPT_DIR/pane-for-tab.sh" "$SESSION" "$NAME")

elapsed=0
while true; do
  if zellij --session "$SESSION" action dump-screen --pane-id "$PANE_ID" 2>/dev/null | grep -Eq "$PATTERN"; then
    zellij --session "$SESSION" action dump-screen --pane-id "$PANE_ID"
    exit 0
  fi
  if [ "$elapsed" -ge "$TIMEOUT" ]; then
    echo "wait-for.sh: timed out after ${TIMEOUT}s waiting for pattern: $PATTERN" >&2
    zellij --session "$SESSION" action dump-screen --pane-id "$PANE_ID" >&2 || true
    exit 1
  fi
  sleep "$INTERVAL"
  elapsed=$((elapsed + INTERVAL))
done
