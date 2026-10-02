#!/bin/bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <booted-simulator-UDID>" >&2
  exit 1
fi

app_dir=$(cd "$(dirname "$0")" && pwd)
device_id=$1
build_dir="$app_dir/.build"

xcodebuild \
  -project "$app_dir/MobileDevTestApp.xcodeproj" \
  -scheme MobileDevTestApp \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=$device_id" \
  -derivedDataPath "$build_dir" \
  CODE_SIGNING_ALLOWED=NO \
  build

xcrun simctl install "$device_id" "$build_dir/Build/Products/Debug-iphonesimulator/MobileDevTestApp.app"
xcrun simctl launch --terminate-running-process "$device_id" dev.mobile.testapp
