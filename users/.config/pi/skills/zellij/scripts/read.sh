#!/usr/bin/env bash
# Print a tab's current output, resolved fresh by name. This is the
# straightforward "what does it say right now" command — no pattern
# matching, no waiting, just a snapshot.
#
# Usage: read.sh <session> <tab-name> [--full] [--ansi]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SESSION="${1:?usage: read.sh <session> <tab-name> [--full] [--ansi]}"
NAME="${2:?usage: read.sh <session> <tab-name> [--full] [--ansi]}"
shift 2

PANE_ID=$("$SCRIPT_DIR/pane-for-tab.sh" "$SESSION" "$NAME")

zellij --session "$SESSION" action dump-screen --pane-id "$PANE_ID" "$@"
