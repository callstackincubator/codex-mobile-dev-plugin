#!/bin/bash
# Drive the running app through every registry entry and capture each one.
# Usage: ./capture.sh [signal] [screens...]
#        signal = ready | frame | stable | idle | timeout   (default: ready)
#
# For the signal-vs-signal comparison and the correctness verdicts, use
# ./run-experiment.sh instead; this script is the plain "capture the screens"
# path a pipeline would actually use.
#
# The control channel is the app's own loopback socket, not `simctl openurl`:
# a custom URL scheme makes LaunchServices put an "Open in <app>?" alert on
# screen, which is then what the screenshot contains.
#
# Captures go through the app's own `drawHierarchy` raster, which measured
# pixel-identical to `simctl io screenshot` at a quarter of the cost. Set
# SHOT=simctl to use the simulator path instead.
set -uo pipefail
cd "$(dirname "$0")"

DEV=${DEV:-booted}
CTRL=${CTRL:-http://127.0.0.1:8765}
SHOT=${SHOT:-draw}
SIGNAL=${1:-ready}; shift || true
BUDGET=${BUDGET:-5000}
OUTDIR=shots/$SIGNAL
mkdir -p "$OUTDIR"

if [ "$#" -gt 0 ]; then
  SCREENS="$*"
else
  SCREENS=$(curl -s --max-time 5 "$CTRL/screens" |
    python3 -I -c 'import json,sys;print(" ".join(json.load(sys.stdin)["screens"]))')
fi

# The HUD is for driving by hand; it must not be in the artifact.
curl -s --max-time 5 "$CTRL/hud?on=0" >/dev/null

now_ms() { python3 -I -c 'import time;print(int(time.time()*1000))'; }

printf "%-22s %9s %9s %9s  %s\n" screen rtt_ms wait_ms shot_ms env_missing
for s in $SCREENS; do
  # Dismissing between captures is mandatory: presenting screen->screen means
  # `onAppear` never fires again and an onAppear-based signal deadlocks.
  curl -s --max-time 5 "$CTRL/dismiss" >/dev/null
  t0=$(now_ms)
  resp=$(curl -s --max-time 30 "$CTRL/present?screen=$s&signal=$SIGNAL&budget_ms=$BUDGET")
  t1=$(now_ms)
  if [ "$SHOT" = "simctl" ]; then
    xcrun simctl io "$DEV" screenshot --type=png "$OUTDIR/$s.png" >/dev/null 2>&1
  else
    curl -s --max-time 20 "$CTRL/snapshot?kind=$SHOT" -o "$OUTDIR/$s.png"
  fi
  t2=$(now_ms)
  read -r wait_ms missing <<<"$(printf '%s' "$resp" | python3 -I -c '
import json,sys
try:
  d = json.load(sys.stdin)
  print(d.get("wait_ms", "-"), ",".join(d.get("env", {}).get("missing", [])) or "-")
except Exception:
  print("- -")')"
  printf "%-22s %9s %9s %9s  %s\n" "$s" "$((t1-t0))" "$wait_ms" "$((t2-t1))" "$missing"
done
echo "captures in $OUTDIR"
curl -s --max-time 5 "$CTRL/state"; echo
