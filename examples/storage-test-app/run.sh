#!/bin/bash
set -euo pipefail

if [[ $# -ne 2 || ( $1 != ios && $1 != android ) ]]; then
  echo "Usage: $0 ios <booted-simulator-UDID> | android <device-serial>" >&2
  exit 1
fi

app_dir=$(cd "$(dirname "$0")" && pwd)
cd "$app_dir"
# CocoaPods fails under a non-UTF-8 locale.
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
[[ -d node_modules ]] || npm ci --no-audit --no-fund

# Release builds embed the JavaScript bundle, so the app runs without Metro.
# The Android release build is marked debuggable so the storage tool can read it.
if [[ $1 == ios ]]; then
  [[ -d ios ]] || npx expo prebuild --platform ios
  # expo run:ios cannot launch apps on Xcode 27, so build, install, and launch directly.
  xcodebuild -workspace ios/StorageTest.xcworkspace -scheme StorageTest -configuration Release \
    -destination "platform=iOS Simulator,id=$2" -derivedDataPath .build CODE_SIGNING_ALLOWED=NO build
  xcrun simctl install "$2" .build/Build/Products/Release-iphonesimulator/StorageTest.app
  xcrun simctl launch --terminate-running-process "$2" dev.mobile.storagetest
else
  # Gradle needs the SDK; Android Studio installs it here by default on macOS.
  export ANDROID_HOME=${ANDROID_HOME:-$HOME/Library/Android/sdk}
  [[ -d android ]] || npx expo prebuild --platform android
  npx expo run:android --variant release --device "$2" --no-bundler
fi
