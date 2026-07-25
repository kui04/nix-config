#!/usr/bin/env bash
# Send one line of input to a pane's shell/REPL: paste the text (bracketed
# paste, safe for multi-line strings), then press Enter separately, since
# `paste` alone does not submit.
#
# Usage: send.sh <session> <pane-id> "<text>"
set -euo pipefail

SESSION="${1:?usage: send.sh <session> <pane-id> <text>}"
PANE="${2:?usage: send.sh <session> <pane-id> <text>}"
TEXT="${3:?usage: send.sh <session> <pane-id> <text>}"

zellij --session "$SESSION" action paste --pane-id "$PANE" "$TEXT"
zellij --session "$SESSION" action send-keys --pane-id "$PANE" "Enter"
