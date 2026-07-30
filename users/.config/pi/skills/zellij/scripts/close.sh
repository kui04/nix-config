#!/usr/bin/env bash
# Close a tab by name (resolved fresh, like the other scripts here).
#
# Usage: close.sh <session> <tab-name>
set -euo pipefail

SESSION="${1:?usage: close.sh <session> <tab-name>}"
NAME="${2:?usage: close.sh <session> <tab-name>}"

TAB_ID=$(zellij --session "$SESSION" action list-tabs --json \
  | jq -r --arg n "$NAME" '[.[] | select(.name == $n)] | sort_by(.tab_id) | last | .tab_id // empty')

if [ -z "$TAB_ID" ]; then
  echo "close.sh: no tab named '$NAME' in session '$SESSION'" >&2
  exit 1
fi

zellij --session "$SESSION" action close-tab --tab-id "$TAB_ID"
