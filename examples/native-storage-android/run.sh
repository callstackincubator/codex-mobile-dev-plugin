#!/usr/bin/env bash
# Build the debuggable Native Storage app, install it on one device, and launch it.
# Usage: ./run.sh <device-serial>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <device-serial>" >&2
  exit 64
fi

SERIAL="$1"
APP_ID="dev.mobile.nativestorage.android"
cd "$(dirname "$0")"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
ADB="$ANDROID_HOME/platform-tools/adb"
command -v "$ADB" >/dev/null 2>&1 || ADB="adb"

./gradlew --console=plain :app:assembleRelease

APK="app/build/outputs/apk/release/app-release.apk"
"$ADB" -s "$SERIAL" install -r "$APK"
"$ADB" -s "$SERIAL" shell am force-stop "$APP_ID"
"$ADB" -s "$SERIAL" shell am start -n "$APP_ID/.MainActivity" >/dev/null
echo "Launched $APP_ID on $SERIAL"
