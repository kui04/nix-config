#!/usr/bin/env bash
# Resolve the pane id of a tab by its name, re-deriving it fresh every time.
# This is the key piece that makes tasks addressable across separate tool
# calls/turns: don't thread a numeric pane id through shell variables that
# may not survive between calls — just remember the tab's name (e.g.
# "build", "background") and look its pane id up again whenever needed.
#
# If more than one tab currently has this name, the most recently created
# one (highest tab_id) wins — use distinct names ("build-frontend",
# "build-backend") if you need two same-category tasks addressable at once.
#
# Usage: pane-for-tab.sh <session> <tab-name>
# Prints the bare numeric pane id on stdout.
set -euo pipefail

SESSION="${1:?usage: pane-for-tab.sh <session> <tab-name>}"
NAME="${2:?usage: pane-for-tab.sh <session> <tab-name>}"

TAB_ID=$(zellij --session "$SESSION" action list-tabs --json \
  | jq -r --arg n "$NAME" '[.[] | select(.name == $n)] | sort_by(.tab_id) | last | .tab_id // empty')

if [ -z "$TAB_ID" ]; then
  echo "pane-for-tab.sh: no tab named '$NAME' in session '$SESSION'" >&2
  exit 1
fi

PANE_ID=$(zellij --session "$SESSION" action list-panes --json \
  | jq -r --argjson t "$TAB_ID" '[.[] | select(.tab_id == $t and .is_plugin == false)] | sort_by(.id) | .[0].id // empty')

if [ -z "$PANE_ID" ]; then
  echo "pane-for-tab.sh: tab '$NAME' (tab_id $TAB_ID) has no terminal pane" >&2
  exit 1
fi

echo "$PANE_ID"
