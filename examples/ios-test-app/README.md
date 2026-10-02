# Mobile Dev SwiftUI test app

A dependency-free native iOS app for manual plugin testing. Requires Xcode 26+
and iOS 18+. Open `MobileDevTestApp.xcodeproj` to run on an iPhone or iPad.

## Run in a simulator

Open the Mobile Dev panel, choose and boot an iOS simulator, then pass its UDID
from `mobile_list_simulators` to the script from the repository root:

```sh
./examples/ios-test-app/run.sh <booted-simulator-UDID>
```

The script builds Debug, installs, and launches on that exact simulator without
attaching a debugger. Build output stays in the ignored `.build/` directory.
It requires no npm install or project generator.

- Bundle ID: `dev.mobile.testapp`
- Executable / native log process filter: `MobileDevTestApp`
- Unified log subsystem: `dev.mobile.testapp`, category: `TestApp`

## Manual checks

| Tab | Checks |
| --- | --- |
| Interact | Increment/reset, type a name, toggle a switch, drag a slider, present/dismiss a sheet. Inspect accessibility labels and stable identifiers, capture screenshots, and annotate controls. |
| Scroll | Scroll 200 rows, open a detail, and navigate back with the button or edge swipe. |
| Diagnostics | Toggle a continuous animation, emit intentional info/warning/error logs, run five seconds of background CPU work, allocate/release 32 MiB, and stop work. |

Open the plugin's Logs drawer and select `MobileDevTestApp`, then tap **Emit test
logs**. Messages use `Logger` so they appear in unified logs without Xcode stdout.
No typed text is logged. State resets on app relaunch. CPU work is bounded to five
seconds; **Stop and release** or backgrounding the app cancels work and releases
test memory. Memory charts may retain allocator overhead after release.

For performance checks, select this app in the plugin and record CPU, memory, and
Display FPS together. iOS simulators support CPU/memory but do not support Display
FPS; use a physical iOS 18+ device with this app for that metric. Animation and scrolling are
manual workloads, not an FPS measurement inside the app.

## Physical device

Select your signing team under the app target's **Signing & Capabilities**, choose
your paired device, and run from Xcode. Stop Xcode's debugger and launch the app
again from the device before CPU/memory collection. Keep the Debug development
signature (`get-task-allow`) and follow the plugin's device prerequisites.

This app is a local test fixture, excluded from plugin packaging. Existing plugin
telemetry measures its streaming, input, logs, and performance tools; the fixture
does not add a Sentry SDK or send app diagnostics to Sentry.
