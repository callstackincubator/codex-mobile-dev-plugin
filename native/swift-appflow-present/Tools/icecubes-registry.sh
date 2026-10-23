#!/bin/bash
# Parse IceCubesApp and codegen its screen registry into the app's DEBUG-only harness dir.
#
# This is the `build.sh` wiring applied to a real multi-module app. Two things differ:
#
#  - The source root is the whole repo, not one directory. `detectSwiftProject` returns only
#    the conventional root (`IceCubesApp/`), which sees 36 of 408 files and misses `Packages/`,
#    where most of the app lives.
#  - The generated file has to live inside the app target's source directory, because the
#    target is a `PBXFileSystemSynchronizedRootGroup`: a .swift file dropped in is compiled,
#    and that is what makes this integration need zero pbxproj edits. It is therefore inside
#    the parsed tree, so the parser skips any directory named `Generated` -- the same
#    mechanism that already skips `.build` and `Tests`. Without that the parser reads its own
#    previous output as call sites.
set -euo pipefail

cd "$(dirname "$0")/.."
APP=${APP:-/Users/hurali/Desktop/callstack/open-source/IceCubesApp}
PARSER=${PARSER:-../swift-appflow-parse/.build/release/swift-appflow-parse}
OUT="$APP/IceCubesApp/AppFlow/Generated/ScreenRegistry.generated.swift"

if [ ! -x "$PARSER" ]; then
  echo "icecubes-registry.sh: no parser at $PARSER" >&2
  echo "  build it with: (cd ../swift-appflow-parse && swift build -c release)" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"

# Module names read off `Packages/` -- the app's own SPM module list, not a guess.
# `--testable-import` is used for the three packages that hold a screen declared
# `internal`; a debug build has testability on, and the generated file is DEBUG-guarded, so
# nothing here can reach a release build.
#
# The three `--exclude`s are compiler-verified refusals, each a parser soundness gap that
# this integration found. A rung is a claim that the lifted expression compiles where it is
# lifted to; when the compiler refuses, the screen is not constructible and belongs in
# `missing` with the compiler's own reason. Nothing is invented to make them build.
"$PARSER" "$APP" | python3 -I Tools/generate-registry.py - -o "$OUT" \
  --exclude 'DraftsListView=nested in `StatusEditor`; the lifted expression is unqualified and does not resolve at the lift site' \
  --exclude 'PushNotificationsView=`@State public var subscription` has no default, so it is a required memberwise-init parameter the parser did not see' \
  --debug-guard \
  --testable-import Account \
  --testable-import Notifications \
  --testable-import StatusKit \
  --import AppAccount \
  --import Conversations \
  --import DesignSystem \
  --import Env \
  --import Explore \
  --import Lists \
  --import MediaUI \
  --import Models \
  --import NetworkClient \
  --import Timeline

echo "wrote $OUT"
