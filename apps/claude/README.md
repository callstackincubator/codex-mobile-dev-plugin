# Mobile Dev for Claude

Build, run, and debug iOS and Android apps without leaving Claude. Mobile Dev streams
your simulators, emulators, and devices into a native MCP Apps panel inside Claude,
and gives Claude the tools to control them, read their logs, inspect your app,
and measure its performance. It works with Expo, React Native,
SwiftUI, and other native mobile projects.

- **Device panel:** a live, interactive iOS simulator, Android emulator, or connected
  device, with logs and performance tools beside it. Claude reads the devices you
  select there and the logs, screenshots, and notes you add to chat.

- **Device control and inspection:** Claude taps, types, scrolls, reads the
  accessibility tree, and takes screenshots through the bundled
  [agent-device](https://agent-device.dev/) runtime.
- **App control:** install, launch, and stop apps, open deep links, send test pushes,
  and set permissions and languages.
- **App Flow:** a visual map of your app's screens and the navigation between them,
  read from your Expo Router or React Navigation source and optionally captured by
  walking the app on an iOS simulator.
- **Logs:** iOS unified logs, Android logcat, physical iPhone logs, and Metro console
  messages.
- **Performance:** CPU, memory, and FPS recordings shown as interactive charts in
  chat, which Claude can analyze and compare.
- **App storage:** read what your app saved, such as UserDefaults, SharedPreferences,
  AsyncStorage, MMKV, and SQLite, without adding code to it.
- **Profile analysis:** TraceSift findings and the full explorer for local CPU and React
  profiles, with investigation actions that send their evidence to Claude.
- **App Intelligence:** an app map of Expo Router and React Navigation screens and
  their source dependencies.
- **Device resource saving:** saved resource limits for simulators and emulators.

## Install

In Claude Code:

```sh
claude plugin marketplace add https://github.com/callstackincubator/mobile-dev.git#release/claude
claude plugin install mobile-dev@mobile-dev
```

Start a new session in Claude Desktop and ask Claude to open your app on a simulator.
Approve the tool calls when prompted. Mobile Dev requests Claude's side panel and
uses the same device workspace, tools, recordings, storage views, and TraceSift
explorer as the Codex plugin. Claude controls whether the view opens beside the
conversation, inline, or full screen; side-panel access is still rolling out. Use
Claude's expand control when needed.

In a terminal, the device, log, storage, and performance tools work without a panel.
The plugin does not open a browser. Run
`claude plugin marketplace update mobile-dev` to update.

For the Claude Desktop extension, install the `.mcpb` asset from the
[latest release](https://github.com/callstackincubator/mobile-dev/releases/latest),
then restart Claude. The local plugin needs Claude Desktop on the Mac with your
devices. Claude's web connector and Artifacts entry-point features require a remote
server and do not turn this local plugin into a web service.

See the [Claude MCP Apps audit](../../docs/claude-mcp-apps.md) for each supported
feature and the features Claude limits to remote connectors.

## Requirements

- An Apple Silicon Mac.
- **Node.js 22.19 or later.** Mobile Dev looks for it on `PATH` and in the usual
  Homebrew, nvm, fnm, Nix, Volta, mise, and asdf locations. If none is found, Claude tells
  you at the start of a session; install it with `brew install node` or from
  [nodejs.org](https://nodejs.org), then restart Claude.
- **iOS:** Xcode 26 or later with an installed simulator runtime. Physical iPhone
  logs need Xcode 27 or later.
- **Android:** Android SDK platform-tools and emulator, and an AVD or a device with
  USB or wireless debugging authorized.

## What it runs on your Mac

The plugin bundles most of its runtimes and native helpers, so no `npm install`,
account, or hosted service is needed. Your project's own tools build the app. Besides
its Node.js server, it runs:

- **The device panel's runtime, downloaded once.** The first time you open the panel,
  Mobile Dev downloads one archive from this project's GitHub release for the
  installed version (`mobile-dev-<version>-panel-runtime-darwin-arm64.tar.gz`, from
  `github.com/callstackincubator/codex-mobile-dev-plugin/releases`). The plugin pins
  the archive's size and SHA-256 checksum and refuses any other file. It holds
  [Baguette](https://github.com/tddworks/baguette), which streams and controls iOS
  simulators, serve-emu with scrcpy for Android streaming, the physical iPhone
  mirroring addon and its service, and device resource-saving helpers. The archive
  uses the source and versions this repository pins. It is unpacked into Claude Code's data folder for the plugin
  (`~/.claude/plugins/data/`), or `~/Library/Caches/mobile-dev` elsewhere, and kept
  across sessions; an update downloads its own version and removes older ones.
  The server downloads these helpers when a tool first needs them. The other tools
  work without them.
- **A Node.js launcher and a session check:** `scripts/launch-node.sh` finds Node.js
  in the locations above and starts the server; at the start of each session it
  checks that one is available.
- **agent-device**, its bundled Node.js runtime, for device control. On first iOS use
  it builds its XCTest runner from the included source with your Xcode and caches it
  in `~/.agent-device/apple-runner`; it keeps session state and logs in a temporary
  directory.
- **Native helpers** for logs and measurements: a physical iPhone log reader built on
  libimobiledevice, an iOS FPS and foreground-app reader, and Android CPU and FPS
  collectors that it copies to a connected Android device with `adb` and runs there.
- **Developer tools** already on your Mac: `xcrun simctl`, `devicectl`, `adb`, and the
  Android emulator, and TraceSift when you analyze a profile.

## Privacy and support

Mobile Dev reports plugin errors, crashes, usage counters, sampled traces, and
aggregate plugin performance measurements to Sentry by default. App logs,
screenshots, input content, tool payloads, app storage contents, profiles, and device
performance recordings are excluded from that telemetry. Errors and crashes use a
randomly generated persistent installation ID. Nothing else goes to Callstack, and
profiles go only to the TraceSift service on your Mac. Set `MOBILE_DEV_TELEMETRY=off`
in the environment Claude starts from, then restart Claude, to turn reporting off.
Read the [Privacy Policy](PRIVACY.md) and [Terms of Service](TERMS.md).

For help, email [hello@callstack.com](mailto:hello@callstack.com) or see
[Support](SUPPORT.md).

## License

MIT. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).
