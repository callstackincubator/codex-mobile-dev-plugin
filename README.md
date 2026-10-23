# Mobile Dev for Codex and Claude Desktop

Keep iOS and Android devices beside your Codex desktop chat while building,
running, and debugging mobile apps, or open the app in a Claude Desktop
conversation. Mobile Dev works with Expo, React Native, SwiftUI, and other native
mobile projects. Claude Desktop support is a development preview.

## Install

### Codex

Install the prebuilt plugin from the release marketplace:

```sh
codex plugin marketplace add https://github.com/callstackincubator/codex-mobile-dev-plugin.git --ref release/latest
codex plugin add mobile-dev@mobile-dev
```

Open a new chat after installing. The package includes the built plugin and
bundled runtimes; no plugin build or `npm install` is needed.

Mobile Dev shows a banner when a newer release is ready to install. Click
**Update**, then fully quit and reopen Codex after it finishes.

You can also update an existing installation from the terminal:

```sh
codex plugin marketplace upgrade mobile-dev
```

Fully quit and reopen Codex after updating.

### Claude Desktop: manual installation

On an Apple Silicon Mac, obtain a `mobile-dev-<version>-claude-desktop-darwin-arm64.mcpb`
bundle from the person sharing the preview, or [build one locally](CONTRIBUTING.md#claude-desktop-local-development).
The Claude bundle is not yet published through this repository's release workflow.

1. Open Claude Desktop **Settings > Extensions > Advanced settings**.
2. Under **Extension Developer**, click **Install Extension…**, select the `.mcpb`
   file, and confirm installation. You can also open the file with Claude Desktop.
3. Fully quit and reopen Claude, then start a new conversation and ask **“Open Mobile Dev.”**
4. Approve the connector when prompted. Click **Expand** to use the larger view
   when available; Mobile Dev does not add a permanent Claude sidebar entry.

The bundle includes the plugin and native helpers; Claude supplies Node, so no
`npm install` is needed. Install a newer `.mcpb` manually to update. Use either
the bundle or the [local development connection](CONTRIBUTING.md#claude-desktop-local-development)
to avoid duplicate Mobile Dev servers. See [Claude's installation guide](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).

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

### App storage
See what an app has saved without adding code to it: MMKV, AsyncStorage, UserDefaults, SharedPreferences, DataStore, SQLite databases, and the largest files in its data directory. Open SQLite tables as a paged grid, search across every store at once, and open the Changes tab to watch keys being added, changed, and removed while you use the app, with only the changed part of JSON values highlighted. SDK data from Firebase, Google Analytics and similar libraries is grouped separately. Clear one store or reset all app data. Works on iOS simulators and debuggable Android builds; MMKV value types are guessed from the stored bytes, and encrypted MMKV instances show as locked.


Storage results are filtered before reaching the host or panel. Recognized sensitive
fields and credential-like values show `[REDACTED]`; binary values are withheld.
Ask for a specific store/key or table/columns to narrow inspection. This filtering
cannot identify all personal or confidential data; use synthetic development data.
See [storage privacy and review checks](docs/storage-privacy.md).

## Requirements

The prebuilt plugin targets Codex desktop on an Apple Silicon Mac and uses
Codex's bundled Node runtime from its workspace dependency cache. The Claude
Desktop preview also targets Apple Silicon and uses Claude's Node runtime when
installed as a bundle. Install the tools for the platforms you use:

| Platform or feature | Requirements |
| --- | --- |
| iOS simulators | Xcode 26 or later with an installed simulator runtime. |
| Physical iPhones and iPads | Xcode 27 or later, a paired device with Developer Mode enabled, and USB or Wi-Fi connectivity. Screen mirroring requires HEVC WebCodecs support in the host. |
| Android | Android SDK platform-tools and emulator, and an AVD or a physical device with authorized USB or wireless debugging. Screen streaming requires H.264 WebCodecs support in the host. |
| Metro logs and React Native inspection | An existing local Metro server with a compatible app inspector target. |
| Physical iOS CPU and memory | iOS 17.4 or later, a running development-signed app with `get-task-allow`, a mounted developer disk image, and Xcode/LLDB detached. |
| Display FPS | Android 12 or later with FrameTimeline support, or a physical iOS device running iOS 17.4 or later. iOS simulators do not support Display FPS. |

Simulator tools use the full Xcode installation selected by `xcode-select` (or
`DEVELOPER_DIR`), including its Swift compatibility libraries. Custom Xcode names
and locations are supported. If Command Line Tools or an older Xcode is selected,
choose Xcode 26 or later in Xcode Settings > Locations > Command Line Tools.

The app project's own tools build, install, and launch your app. Mobile Dev supplies
its device panel, inspection, logs, and performance tools.

## Get started

In Codex, open Mobile Dev from the sidebar or ask to open the simulator beside
this chat. In Claude Desktop, ask **“Open Mobile Dev”** in a conversation with the
connector enabled, then use **Expand** when available.

Pick a device from the toolbar; selecting a stopped simulator or AVD
boots it. Use the iOS and Android toggles to show either platform or both.

Click an iOS simulator or Android screen to focus it, then press **Command-V** to
paste text into the device. Paste accepts up to 4,096 printable US-ASCII characters;
line breaks and other characters show a notice without sending partial text.

Ask your assistant to work with your app, for example:

- “Build and run my Expo app in the simulator beside this chat.”
- “Read the app logs and help me fix this error.”
- “Record CPU and memory for 30 seconds while I scroll checkout.”
- “Compare these two performance recordings.”

Open Logs, Performance, or Storage to inspect the selected device. Use Screenshot to attach
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

## Privacy and support

Mobile Dev reports plugin errors, crashes, usage counters, sampled traces, and
aggregate plugin performance measurements to Sentry by default. App logs,
screenshots, input content, tool payloads, app storage contents, profiles, and
device performance recordings are excluded from that telemetry. Errors and
crashes use a randomly generated persistent installation ID. Set
`MOBILE_DEV_TELEMETRY=off` in the MCP launch environment and restart the plugin
processes to disable reporting. Tool results and content sent to chat are handled
by the host separately. Read the [Privacy Policy](PRIVACY.md) and
[Terms of Service](TERMS.md), or see
[Sentry observability](https://github.com/callstackincubator/codex-mobile-dev-plugin/blob/main/docs/telemetry.md)
for implementation details.

For help, email [hello@callstack.com](mailto:hello@callstack.com).
See [Support](SUPPORT.md) for reporting bugs, security issues, and privacy requests.
