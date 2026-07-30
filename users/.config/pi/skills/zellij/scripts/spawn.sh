#!/usr/bin/env bash
# Start a task as a brand-new, named tab — never a pane split next to
# something else. If a client is currently attached and looking at some
# other tab, focus is restored to it right after creation, so spawning a
# task doesn't yank the user (or pi) away from what they were doing; the
# task keeps running regardless of which tab is focused.
#
# Prints "<tab-id> <pane-id>" on one line (handy for immediate use in the
# same script). For anything after that — reading output, sending input,
# closing it — re-resolve by name with pane-for-tab.sh instead of holding
# onto these numbers, since they won't survive into a separate tool call.
#
# Usage: spawn.sh <session> <tab-name> -- <command...>
set -euo pipefail

SESSION="${1:?usage: spawn.sh <session> <tab-name> -- <command...>}"
NAME="${2:?usage: spawn.sh <session> <tab-name> -- <command...>}"
shift 2 || true

if [ "${1:-}" != "--" ]; then
  echo "spawn.sh: expected -- before the command, e.g. spawn.sh S name -- docker compose build" >&2
  exit 64
fi
shift

# Remember whatever tab is currently active for a real attached client (if
# any), so we can jump back to it after creating the new tab.
CUR_ACTIVE=$(zellij --session "$SESSION" action list-tabs --json 2>/dev/null \
  | jq -r '[.[] | select(.active == true)] | first | .tab_id // empty' 2>/dev/null || true)

TAB_ID=$(zellij --session "$SESSION" action new-tab --name "$NAME" -- "$@")

if [ -n "$CUR_ACTIVE" ]; then
  zellij --session "$SESSION" action go-to-tab-by-id "$CUR_ACTIVE" >/dev/null 2>&1 || true
fi

PANE_ID=$(zellij --session "$SESSION" action list-panes --json \
  | jq -r --argjson t "$TAB_ID" '[.[] | select(.tab_id == $t and .is_plugin == false)] | sort_by(.id) | .[0].id')

echo "$TAB_ID $PANE_ID"
