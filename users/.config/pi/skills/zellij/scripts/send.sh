#!/usr/bin/env bash
# Send one line of input to a named tab's shell/REPL: paste the text
# (bracketed paste, safe for multi-line strings), then press Enter
# separately, since `paste` alone does not submit.
#
# Usage: send.sh <session> <tab-name> "<text>"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SESSION="${1:?usage: send.sh <session> <tab-name> <text>}"
NAME="${2:?usage: send.sh <session> <tab-name> <text>}"
TEXT="${3:?usage: send.sh <session> <tab-name> <text>}"

PANE_ID=$("$SCRIPT_DIR/pane-for-tab.sh" "$SESSION" "$NAME")

zellij --session "$SESSION" action paste --pane-id "$PANE_ID" "$TEXT"
zellij --session "$SESSION" action send-keys --pane-id "$PANE_ID" "Enter"
