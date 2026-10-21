#!/bin/bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <booted-simulator-UDID>" >&2
  exit 1
fi

app_dir=$(cd "$(dirname "$0")" && pwd)
device_id=$1
build_dir="$app_dir/.build"

# Ad-hoc signing embeds the App Group entitlement, which the simulator needs to create the group container.
xcodebuild \
  -project "$app_dir/NativeStorageTest.xcodeproj" \
  -scheme NativeStorageTest \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=$device_id" \
  -derivedDataPath "$build_dir" \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= \
  build

xcrun simctl install "$device_id" "$build_dir/Build/Products/Debug-iphonesimulator/NativeStorageTest.app"
xcrun simctl launch --terminate-running-process "$device_id" dev.mobile.nativestoragetest
