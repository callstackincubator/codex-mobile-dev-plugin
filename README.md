# Mobile Dev

Build, run, and debug iOS and Android apps without leaving your AI coding tool.
Mobile Dev keeps devices beside your agent's chat and works with Expo, React
Native, SwiftUI, and other native mobile projects.

- [Live devices beside your chat](#live-devices-beside-your-chat): stream iOS and
  Android simulators, emulators, and physical devices.
- [Device control, inspection and annotations](#device-control-inspection-and-annotations):
  let your agent tap, type, and inspect your app, and annotate elements for it.
- [App control](#app-control): install, launch, and stop apps, open deep links,
  send pushes, and set permissions and languages.
- [Device settings and network conditions](#device-settings-and-network-conditions):
  appearance, text size, rotation, location, status bar, and slow networks.
- [Native and JavaScript logs](#native-and-javascript-logs): iOS, Android, and
  Metro logs in one filterable view.
- [Live performance monitoring and improvements](#live-performance-monitoring-and-improvements):
  CPU, memory, and FPS charts, with recordings your agent can analyze.
- [Profile analysis with TraceSift](#profile-analysis-with-tracesift): measured
  findings from CPU and React profiles, with an explorer.
- [App storage](#app-storage): browse and watch what your app saves, without
  adding code to it.

## Install

### Codex

**[Add Mobile Dev to Codex](https://chatgpt.com/plugins/plugins_6ac4c117f76881918d3676e851fa4005)**
from the plugin directory, then open a new chat.

To install the prebuilt plugin from this repository instead, see
[Install from the GitHub marketplace](CONTRIBUTING.md#install-from-the-github-marketplace).

### Claude Code and Claude Desktop

Claude shows simulators itself, so the Claude version of Mobile Dev has no device
panel: in Claude Code, ask to see a device and Claude opens its own iOS Simulator or
Android Emulator pane. Mobile Dev adds device control through the bundled
[agent-device](https://agent-device.dev/) runtime, native
and Metro logs, app control and storage, interactive CPU, memory and FPS charts in
chat, and TraceSift findings.

On an Apple Silicon Mac with Node.js 22.19 or later on `PATH`, install the Claude
Code plugin from this repository's `release/claude` branch:

```sh
claude plugin marketplace add https://github.com/callstackincubator/mobile-dev.git#release/claude
claude plugin install mobile-dev@mobile-dev
```

Or in a session, `/plugin install mobile-dev --marketplace https://github.com/callstackincubator/mobile-dev.git#release/claude`.
Run `claude plugin marketplace update mobile-dev` to update.

For Claude Desktop chats, download `mobile-dev-<version>-claude-desktop-darwin-arm64.mcpb`
from the [latest release](https://github.com/callstackincubator/mobile-dev/releases/latest),
open **Settings > Extensions > Advanced settings**, and under **Extension Developer**
click **Install Extension…** and select the file, or open it with Claude Desktop.
Claude supplies Node for the bundle. Install a newer `.mcpb` to update. Use either
the plugin or bundle, or the [local development connection](CONTRIBUTING.md#claude-desktop-local-development),
to avoid duplicate Mobile Dev servers.

What the Claude version runs on your Mac, besides its Node.js server:

- **agent-device**, its bundled Node.js runtime, for device control. On first iOS
  use it builds its XCTest runner from the included source with your Xcode and
  caches it in `~/.agent-device/apple-runner`; it keeps session state and logs in
  a temporary directory.
- **Native helpers** for logs and measurements: a physical iPhone log reader built
  on libimobiledevice, an iOS FPS and foreground-app reader, and Android CPU and
  FPS collectors that it copies to a connected Android device with `adb` and runs
  there.
- **Developer tools** already on your Mac: `xcrun simctl`, `devicectl`, `adb`, and
  the Android emulator, and TraceSift when you analyze a profile.

It sends plugin errors and aggregate measurements to Sentry, as described under
[Privacy and support](#privacy-and-support), and nothing else to Callstack;
profiles go only to the TraceSift service on your Mac.

### Cursor: manual installation

On an Apple Silicon Mac with Node.js 22.19 or later on `PATH`, obtain the
`mobile-dev` Cursor plugin folder from the person sharing the preview, or
[build one locally](CONTRIBUTING.md#cursor-local-development). The Cursor plugin is
not yet published to the Cursor Marketplace.

1. Copy the `mobile-dev` folder to `~/.cursor/plugins/local/mobile-dev`.
2. Run **Developer: Reload Window**, or restart Cursor, and confirm Mobile Dev
   appears under **Customize**.
3. Start a new agent chat and ask **"Open Mobile Dev."** Approve the tool calls
   when prompted.

Cursor renders the Mobile Dev views where MCP Apps are available. Otherwise tools
return text, and the agent asks you to choose devices in chat. Copy a newer folder
and reload to update. Use either the plugin or the [local development connection](CONTRIBUTING.md#cursor-local-development)
to avoid duplicate Mobile Dev servers. See [Cursor's plugin guide](https://cursor.com/docs/plugins).

### Mac app

The Mac app shows the devices and tools in their own window, without a chat. Pick
a tool and the visible platforms in the sidebar. It runs the same server as the
plugins, so the device panels, logs, performance, storage, and TraceSift work the
same way. Chat actions such as Send to chat and annotations are hidden because
there is no chat to send to.

There is no download yet. Build it from a checkout on an Apple Silicon Mac with
Xcode 27, following [the Mac app guide](CONTRIBUTING.md#mac-app):

```sh
npm ci
npm run build
npm run build:mac
open "release/mac/Mobile Dev.app"
```

## Features

### Live devices beside your chat
Stream iOS simulators, Android emulators, and connected iPhones, iPads, and Android devices. Show iOS and Android together or use the fullscreen workspace.

![](/img/screenshot_side_by_side.png)

### Device control, inspection and annotations
Select and boot simulators or emulators, interact with taps and drags, type on supported devices, and let your agent inspect accessibility elements and control your app through MCP tools. Select an element or screen region and leave instructions for your agent, with React Native component and source details when available.

![](/img/screenshot_annotations.png)

### App control
Install a built app, launch or stop it, and open a deep link or URL to jump to a screen. Send a test push notification to an iOS simulator app. Allow, deny, or reset an app permission without the system prompt, and run an app in another language than the device. The app tools in each device panel launch and stop apps, open URLs, send pushes, and set permissions and language; the agent can also call every action as an MCP tool. Mobile Dev does not build your app; your project's own tools do.

### Device settings and network conditions
Change the running device's appearance, text size, rotation, location, and status bar without restarting its stream. Switch the network to LTE, 3G, Edge, or Offline to see how the app behaves on a slow or missing connection, then back to Normal. Available settings depend on the platform and device kind.

### Native and JavaScript logs
Read iOS unified logs, Android logcat, and Metro console messages together. Follow the foreground app, search and filter logs, and send an error and its stack trace to chat.

![](/img/screenshot_logs.png)

### Live performance monitoring and improvements
Track app CPU and memory, expand individual thread charts, and view device-wide Display FPS on supported devices. Ask your agent to record an interaction, inspect interactive charts in chat, compare runs, and analyze selected ranges. Android recordings include display frame pacing and jank statistics.

![](/img/screenshot_performance.png)

### Profile analysis with TraceSift
Analyze a local CPU profile or a React DevTools profiling export with TraceSift. The findings appear as cards in chat, each splitting a measured task between the features it entered. Explore opens the full call tree, timeline, and flame graph in the card. Select frames or components there and ask the agent to investigate them, with the measured evidence attached. The TraceSift tool in the device panel uploads a profile and keeps the source folder an investigation should land in.

### App storage
See what an app has saved without adding code to it, whether it is built with React Native or natively: UserDefaults and App Group containers, Core Data and SwiftData, SharedPreferences, DataStore, MMKV, AsyncStorage, SQLite databases, and the largest files in its data directory. Open SQLite tables as a paged grid, open any file to see JSON, property lists, and archives decoded, search across every store at once, and open the Changes tab to watch keys being added, changed, and removed while you use the app, with only the changed part of JSON values highlighted. SDK data from Firebase, Google Analytics and similar libraries is grouped separately. Clear one store or reset all app data. Works on iOS simulators and debuggable Android builds; MMKV value types are guessed from the stored bytes, and encrypted MMKV instances show as locked.


Storage results are filtered before reaching the host or panel. Recognized sensitive
fields and credential-like values show `[REDACTED]`; binary values are withheld.
Ask for a specific store/key or table/columns to narrow inspection. This filtering
cannot identify all personal or confidential data; use synthetic development data.
See [storage privacy and review checks](docs/storage-privacy.md).

## Requirements

Mobile Dev runs on an Apple Silicon Mac. In Codex desktop, the prebuilt plugin
uses Codex's bundled Node runtime from its workspace dependency cache; the Claude
Desktop bundle uses Claude's Node runtime, the Cursor plugin uses Node.js from
`PATH`, and the Mac app bundles its own. Install the tools for the platforms you use:

| Platform or feature | Requirements |
| --- | --- |
| iOS simulators | Xcode 26 or later with an installed simulator runtime. |
| Physical iPhones and iPads | Xcode 27 or later, a paired device with Developer Mode enabled, and USB or Wi-Fi connectivity. Screen mirroring requires HEVC WebCodecs support in the host. |
| Android | Android SDK platform-tools and emulator, and an AVD or a physical device with authorized USB or wireless debugging. Screen streaming requires H.264 WebCodecs support in the host. |
| Metro logs and React Native inspection | An existing local Metro server with a compatible app inspector target. |
| Physical iOS CPU and memory | iOS 17.4 or later, a running development-signed app with `get-task-allow`, a mounted developer disk image, and Xcode/LLDB detached. |
| Display FPS | Android 12 or later with FrameTimeline support, or a physical iOS device running iOS 17.4 or later. iOS simulators do not support Display FPS. |
| Profile analysis | A local TraceSift installation, found on `PATH` or through `TRACE_SIFT_COMMAND`. |

Simulator tools use the full Xcode installation selected by `xcode-select` (or
`DEVELOPER_DIR`), including its Swift compatibility libraries. Custom Xcode names
and locations are supported. If Command Line Tools or an older Xcode is selected,
choose Xcode 26 or later in Xcode Settings > Locations > Command Line Tools.

The app project's own tools build, install, and launch your app. Mobile Dev supplies
its device panel, inspection, logs, and performance tools.

## Get started

Ask your agent to open the simulator beside this chat. In Codex, you can also
open Mobile Dev from the sidebar; in Cursor, ask **"Open Mobile Dev"** in an agent chat.
Pick a device from the toolbar; selecting a stopped simulator or AVD
boots it. Use the iOS and Android toggles to show either platform or both.

Click an iOS simulator or Android screen to focus it, then press **Command-V** to
paste text into the device. Paste accepts up to 4,096 printable US-ASCII characters;
line breaks and other characters show a notice without sending partial text.

Ask your agent to work with your app, for example:

- “Build and run my Expo app in the simulator beside this chat.”
- “Read the app logs and help me fix this error.”
- “Record CPU and memory for 30 seconds while I scroll checkout.”
- “Compare these two performance recordings.”

Open Logs, Performance, Storage, or TraceSift to inspect the selected device. Use Screenshot to attach
an image to your next message, or Select to annotate an element or region with an
instruction. Physical iOS supports taps and drags; keyboard and hardware-button
controls are unavailable.

## Documentation and contributing

Detailed guides are available for
[devices](https://github.com/callstackincubator/mobile-dev/blob/main/docs/devices.md),
[logs](https://github.com/callstackincubator/mobile-dev/blob/main/docs/logs.md),
[performance](https://github.com/callstackincubator/mobile-dev/blob/main/docs/performance.md),
and [MCP tools](https://github.com/callstackincubator/mobile-dev/blob/main/docs/mcp-tools.md).
[Architecture](https://github.com/callstackincubator/mobile-dev/blob/main/docs/architecture.md) explains how the hosts share the server
and panel.

The repository is an npm workspace. Shared code lives in `packages/`, and each
product in `apps/`:

| Path | Contents |
| --- | --- |
| `packages/core` | The MCP server, device runtimes, and tool handlers |
| `packages/ui` | The device panels and tools every host shows |
| `packages/mcp-app` | The MCP Apps panel that Codex and Claude Desktop load |
| `packages/shared` | Types and logic the server and UI both use |
| `packages/skills` | Agent skills for the shared tools |
| `packages/native`, `packages/runtimes` | Native helpers and bundled Node runtimes |
| `apps/codex-plugin` | The Codex plugin: manifest, updater, and update banner |
| `apps/claude` | Claude: its server without the panel, skill, and the Claude Desktop extension and Claude Code plugin manifests |
| `apps/cursor` | Cursor: the Cursor plugin manifest |
| `apps/mac` | The Mac app: SwiftUI window and its page |

To build a host, install a local package, or contribute changes, see
[CONTRIBUTING.md](https://github.com/callstackincubator/mobile-dev/blob/main/CONTRIBUTING.md).
Implementation and release details live in the linked contributor documentation.

## Privacy and support

Mobile Dev reports plugin errors, crashes, usage counters, sampled traces, and
aggregate plugin performance measurements to Sentry by default. App logs,
screenshots, input content, tool payloads, app storage contents, profiles, and
device performance recordings are excluded from that telemetry. Errors and
crashes use a randomly generated persistent installation ID. Set
`MOBILE_DEV_TELEMETRY=off` in the MCP launch environment and restart the plugin
processes to disable reporting. For the Mac app, start it with
`open --env MOBILE_DEV_TELEMETRY=off "Mobile Dev.app"`. Tool results and content sent to chat are handled
by the host separately. Read the [Privacy Policy](PRIVACY.md) and
[Terms of Service](TERMS.md), or see
[Sentry observability](https://github.com/callstackincubator/mobile-dev/blob/main/docs/telemetry.md)
for implementation details.

For help, email [hello@callstack.com](mailto:hello@callstack.com).
See [Support](SUPPORT.md) for reporting bugs, security issues, and privacy requests.

## License

Mobile Dev is available under the [MIT License](LICENSE). Bundled third-party
components keep their own licenses; see [Third-party notices](THIRD_PARTY_NOTICES.md).
