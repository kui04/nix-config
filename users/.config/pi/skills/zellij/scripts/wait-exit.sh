#!/usr/bin/env bash
# Poll `list-panes --json` until the given pane (launched with
# `new-pane -- <command>`) shows exited == true, then print its final full
# screen (including scrollback). Requires `jq`.
#
# Usage: wait-exit.sh <session> <pane-id> [timeout-seconds] [poll-interval]
set -euo pipefail

SESSION="${1:?usage: wait-exit.sh <session> <pane-id> [timeout] [interval]}"
PANE="${2:?usage: wait-exit.sh <session> <pane-id> [timeout] [interval]}"
TIMEOUT="${3:-300}"
INTERVAL="${4:-2}"

# Accept "terminal_5" or bare "5"; list-panes --json keys panes by bare id.
NUM="${PANE#terminal_}"

elapsed=0
while true; do
  EXITED=$(zellij --session "$SESSION" action list-panes --json \
    | jq -r --argjson n "$NUM" '.[] | select(.id == $n) | .exited')
  if [ "$EXITED" = "true" ]; then
    zellij --session "$SESSION" action dump-screen --pane-id "$PANE" --full
    exit 0
  fi
  if [ "$elapsed" -ge "$TIMEOUT" ]; then
    echo "wait-exit.sh: timed out after ${TIMEOUT}s waiting for pane $PANE to exit" >&2
    exit 1
  fi
  sleep "$INTERVAL"
  elapsed=$((elapsed + INTERVAL))
done
