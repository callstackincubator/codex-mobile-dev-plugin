#!/bin/bash
# Build, install, launch, and run the whole readiness-signal experiment.
#
# Tools/serve-assets.py must already be running on 127.0.0.1:8766 for
# RemoteAvatarView; start it with `python3 -I Tools/serve-assets.py &`.
set -uo pipefail
cd "$(dirname "$0")"

DEV=${DEV:-booted}
BUNDLE=dev.codex.appflow.demo

./build.sh 2>&1 | grep -v incompatible-sysroot
xcrun simctl install "$DEV" build/AppflowDemo.app
xcrun simctl terminate "$DEV" "$BUNDLE" >/dev/null 2>&1
xcrun simctl launch "$DEV" "$BUNDLE" >/dev/null
until curl -s --max-time 2 http://127.0.0.1:8765/screens >/dev/null; do sleep 0.2; done

echo "=== ground truth (4s settle, pixel-exact drawHierarchy raster) ==="
python3 -I Tools/measure.py truth --settle-ms 4000 --kind draw

echo
echo "=== signal timings (one presentation per screen, all signals observed) ==="
python3 -I Tools/measure.py signals --budget-ms 5000

echo
echo "=== correctness metric calibration ==="
python3 -I Tools/measure.py calibrate

echo
echo "=== per-signal capture + verdict against ground truth ==="
python3 -I Tools/measure.py verdict --budget-ms 4000 --kind draw
python3 -I Tools/measure.py rejudge --threshold 0.004

echo
python3 -I Tools/measure.py table
