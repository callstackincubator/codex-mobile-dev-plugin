#!/bin/bash
# Build the demo app straight into a simulator .app bundle with swiftc.
# No .xcodeproj: the point of this proof is the registry, not project plumbing.
set -euo pipefail

cd "$(dirname "$0")"
APP_NAME=AppflowDemo
BUNDLE_ID=dev.codex.appflow.demo
DEPLOY=18.0
SDK=$(xcrun --sdk iphonesimulator --show-sdk-path)
OUT=build/$APP_NAME.app
PARSER=${PARSER:-../swift-appflow-parse/.build/release/swift-appflow-parse}

# The registry is codegen'd from a real parse of this app's own sources, not from a
# hand-authored list. Two things follow from that and are load-bearing:
#
#  - The generated file lives OUTSIDE Sources/. It is Swift, so leaving it in the parsed
#    tree would feed the previous build's `AnyView(AboutView())` entries back in as call
#    sites on the next one -- the parser would be reading its own output.
#  - The parse happens before codegen, so a screen added to Sources/ reaches the registry
#    without anyone editing a list.
if [ ! -x "$PARSER" ]; then
  echo "build.sh: no parser at $PARSER" >&2
  echo "  build it with: (cd ../swift-appflow-parse && swift build -c release)" >&2
  exit 1
fi
mkdir -p Generated
"$PARSER" Sources | python3 -I Tools/generate-registry.py - -o Generated/ScreenRegistry.generated.swift

rm -rf "$OUT"; mkdir -p "$OUT"

cat > "$OUT/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>MinimumOSVersion</key><string>$DEPLOY</string>
  <key>UILaunchScreen</key><dict/>
  <key>UISupportedInterfaceOrientations</key>
  <array><string>UIInterfaceOrientationPortrait</string></array>
  <key>CFBundleURLTypes</key><array><dict>
    <key>CFBundleURLName</key><string>$BUNDLE_ID</string>
    <key>CFBundleURLSchemes</key><array><string>appflow</string></array>
  </dict></array>
  <!-- RemoteAvatarView fetches over plain HTTP from the host's loopback
       (Tools/serve-assets.py). Debug harness only. -->
  <key>NSAppTransportSecurity</key><dict>
    <key>NSAllowsArbitraryLoads</key><true/>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
</dict></plist>
PLIST

xcrun swiftc \
  -sdk "$SDK" \
  -target arm64-apple-ios$DEPLOY-simulator \
  -parse-as-library \
  -O -g \
  -framework SwiftUI -framework UIKit \
  -o "$OUT/$APP_NAME" \
  Sources/*.swift Generated/*.swift

plutil -convert binary1 "$OUT/Info.plist"
echo "built $OUT"
