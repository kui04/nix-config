#!/usr/bin/env bash
# Create/update a stable symlink to the Intel coretemp "Package id 0" temperature input.
# Intended for Waybar "temperature" module hwmon-path, so it doesn't depend on hwmonX numbering.

set -euo pipefail

LINK_DIR="/tmp/waybar"
LINK_PATH="$LINK_DIR/coretemp_temp_input"

# Find the hwmon directory whose name is "coretemp"
hwmon_dir=""
for d in /sys/class/hwmon/hwmon*; do
  [[ -f "$d/name" ]] || continue
  if [[ "$(cat "$d/name")" == "coretemp" ]]; then
    hwmon_dir="$d"
    break
  fi
done

[[ -n "$hwmon_dir" ]] || { notify-send "ERROR: coretemp hwmon not found" >&2; exit 1; }

# Prefer the tempN_input whose tempN_label is exactly "Package id 0"
target=""
shopt -s nullglob
for in_file in "$hwmon_dir"/temp*_input; do
  base="$(basename "$in_file")"          # e.g. temp2_input
  n="${base#temp}"; n="${n%_input}"      # e.g. 2
  label_file="$hwmon_dir/temp${n}_label"
  if [[ -f "$label_file" ]] && [[ "$(cat "$label_file")" == "Package id 0" ]]; then
    target="$in_file"
    break
  fi
done
shopt -u nullglob

# Fallbacks if label is missing or doesn't match (varies by platform/driver)
if [[ -z "$target" ]]; then
  [[ -f "$hwmon_dir/temp1_input" ]] && target="$hwmon_dir/temp1_input" || true
fi
if [[ -z "$target" ]]; then
  target="$(ls -1 "$hwmon_dir"/temp*_input 2>/dev/null | head -n 1 || true)"
fi

[[ -n "$target" ]] || { echo "ERROR: no temp*_input under $hwmon_dir" >&2; exit 1; }

mkdir -p "$LINK_DIR"
ln -sf "$target" "$LINK_PATH"