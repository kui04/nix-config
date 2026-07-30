#!/usr/bin/env bash
# Poll until the given named tab's command has exited, then print its final
# full screen (including scrollback). Requires `jq`.
#
# Usage: wait-exit.sh <session> <tab-name> [timeout-seconds] [poll-interval]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SESSION="${1:?usage: wait-exit.sh <session> <tab-name> [timeout] [interval]}"
NAME="${2:?usage: wait-exit.sh <session> <tab-name> [timeout] [interval]}"
TIMEOUT="${3:-300}"
INTERVAL="${4:-2}"

PANE_ID=$("$SCRIPT_DIR/pane-for-tab.sh" "$SESSION" "$NAME")

elapsed=0
while true; do
  EXITED=$(zellij --session "$SESSION" action list-panes --json \
    | jq -r --argjson n "$PANE_ID" '.[] | select(.id == $n and .is_plugin == false) | .exited')
  if [ "$EXITED" = "true" ]; then
    zellij --session "$SESSION" action dump-screen --pane-id "$PANE_ID" --full
    exit 0
  fi
  if [ "$elapsed" -ge "$TIMEOUT" ]; then
    echo "wait-exit.sh: timed out after ${TIMEOUT}s waiting for tab '$NAME' to exit" >&2
    exit 1
  fi
  sleep "$INTERVAL"
  elapsed=$((elapsed + INTERVAL))
done
