#!/usr/bin/env bash
set -euo pipefail

# Exit if swayidle is already running
if pgrep -x swayidle >/dev/null 2>&1; then
  exit 0
fi

exec swayidle -w \
  timeout 480 "swaylock --daemonize" \
  timeout 600 "niri msg action power-off-monitors" \
  resume      "niri msg action power-on-monitors" \
  # timeout 1200 "systemctl suspend" \
  before-sleep "niri msg action power-off-monitors; swaylock --daemonize" \
  after-resume "niri msg action power-on-monitors" \
  lock   "niri msg action power-off-monitors; swaylock --daemonize" \
  unlock "niri msg action power-on-monitors"