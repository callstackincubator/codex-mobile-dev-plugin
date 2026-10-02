# Mobile Dev for Codex

Keep iOS and Android devices beside your Codex desktop chat while building,
running, and debugging mobile apps. Mobile Dev works with Expo, React Native,
SwiftUI, and other native mobile projects.

## Install

Install the prebuilt plugin from the release marketplace:

```sh
codex plugin marketplace add https://github.com/callstackincubator/codex-mobile-dev-plugin.git --ref release/latest
codex plugin add mobile-dev@mobile-dev
```

Open a new chat after installing. The package includes the built plugin and
bundled runtimes; no plugin build or `npm install` is needed. While the repository
is private, installation requires GitHub read access and working Git authentication.

To update an existing installation:

```sh
codex plugin marketplace upgrade mobile-dev
```

Open a new chat after updating.

## Features

### Live devices beside your chat
Stream iOS simulators, Android emulators, and connected iPhones, iPads, and Android devices. Show iOS and Android together or use the fullscreen workspace.

![](/img/screenshot_side_by_side.png)

### Device control, inspection and annotations
Select and boot simulators or emulators, interact with taps and drags, type on supported devices, and let Codex inspect accessibility elements and control your app through MCP tools. Select an element or screen region and leave instructions for Codex, with React Native component and source details when available.

![](/img/screenshot_annotations.png)

### Native and JavaScript logs
Read iOS unified logs, Android logcat, and Metro console messages together. Follow the foreground app, search and filter logs, and send an error and its stack trace to chat.

![](/img/screenshot_logs.png)

### Live performance monitoring and improvements
Track app CPU and memory, expand individual thread charts, and view device-wide Display FPS on supported devices. Ask Codex to record an interaction, inspect interactive charts in chat, compare runs, and analyze selected ranges. Android recordings include display frame pacing and jank statistics.

![](/img/screenshot_performance.png)


## Requirements

The prebuilt plugin targets Codex desktop on an Apple Silicon Mac and uses
Codex's bundled Node runtime from its workspace dependency cache. Install the
tools for the platforms you use:

| Platform or feature | Requirements |
| --- | --- |
| iOS simulators | Xcode 26 or later with an installed simulator runtime. |
| Physical iPhones and iPads | Xcode 27 or later, a paired device with Developer Mode enabled, and USB or Wi-Fi connectivity. Screen mirroring requires HEVC WebCodecs support in the host. |
| Android | Android SDK platform-tools and emulator, and an AVD or a physical device with authorized USB or wireless debugging. Screen streaming requires H.264 WebCodecs support in the host. |
| Metro logs and React Native inspection | An existing local Metro server with a compatible app inspector target. |
| Physical iOS CPU and memory | iOS 17.4 or later, a running development-signed app with `get-task-allow`, a mounted developer disk image, and Xcode/LLDB detached. |
| Display FPS | Android 12 or later with FrameTimeline support, or a physical iOS device running iOS 17.4 or later. iOS simulators do not support Display FPS. |

The app project's own tools build, install, and launch your app. Mobile Dev supplies
its device panel, inspection, logs, and performance tools.

## Get started

Open Mobile Dev from the Codex sidebar, or ask Codex to open the simulator beside
this chat. Pick a device from the toolbar; selecting a stopped simulator or AVD
boots it. Use the iOS and Android toggles to show either platform or both.

Ask Codex to work with your app, for example:

- “Build and run my Expo app in the simulator beside this chat.”
- “Read the app logs and help me fix this error.”
- “Record CPU and memory for 30 seconds while I scroll checkout.”
- “Compare these two performance recordings.”

Open Logs or Performance to inspect the selected device. Use Screenshot to attach
an image to your next message, or Select to annotate an element or region with an
instruction. Physical iOS supports taps and drags; keyboard and hardware-button
controls are unavailable.

## Documentation and contributing

Detailed guides are available for
[devices](https://github.com/callstackincubator/codex-mobile-dev-plugin/blob/main/docs/devices.md),
[logs](https://github.com/callstackincubator/codex-mobile-dev-plugin/blob/main/docs/logs.md),
[performance](https://github.com/callstackincubator/codex-mobile-dev-plugin/blob/main/docs/performance.md),
and [MCP tools](https://github.com/callstackincubator/codex-mobile-dev-plugin/blob/main/docs/mcp-tools.md).

To build the plugin, install a local package, or contribute changes, see
[CONTRIBUTING.md](https://github.com/callstackincubator/codex-mobile-dev-plugin/blob/main/CONTRIBUTING.md).
Implementation and release details live in the linked contributor documentation.

## Privacy

Mobile Dev reports plugin errors, crashes, and aggregate performance measurements
to Sentry. App logs, screenshots, input content, tool payloads, and device
performance recordings are excluded. Errors and crashes use a generated anonymous
installation ID. Set `MOBILE_DEV_TELEMETRY=off` in the MCP launch environment to
disable reporting. See
[Sentry observability](https://github.com/callstackincubator/codex-mobile-dev-plugin/blob/main/docs/telemetry.md)
for collection, privacy, and configuration details.
