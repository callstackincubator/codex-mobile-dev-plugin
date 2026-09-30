# Mobile Dev for Codex

An iOS simulator panel for Codex desktop. The plugin includes Baguette 0.2.1 for streaming and agent-device 0.20.9 for agent control. Both runtimes ship in the plugin and start on demand. No separate install or server command is needed.

**Streaming experiment status (2026-09-30):** embedded video is blocked in Codex Desktop 26.928.21956, build 12404, by `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`. The local H.264 server and TLS checks pass, but certificate setup and CSP do not grant the panel's browser permission. Ordinary MCP tools and logs use the host bridge. Read the [streaming investigation](docs/local-streaming-investigation.md) for the implementation, resolved failures, remaining limitation, test evidence, and [upstream report](https://github.com/openai/codex/issues/49679). This branch is an investigation checkpoint.

The first version supports:

- A native sidebar entry and a panel beside a chat.
- A centered simulator with one toolbar for device selection, Start/Pause, Home, App Switcher, Lock, and refresh.
- Experimental H.264 with a target of 60 fps over a direct local secure WebSocket, with a frame counter; currently blocked by the host permission described above.
- Pointer taps and drags and printable US-ASCII typing directly on the focused screen.
- A Repair input button when Xcode 27 Device Hub blocks interaction.
- Automatic reconnect after a stream or backend failure, with Pause to stop retries.
- A collapsible log drawer below the simulator with JS/Native and level filters, search, repeat counts, and log attachments for the agent.
- iOS unified logs, Android logcat from connected devices, and JS console messages and exceptions from a selected Metro app.
- MCP tools for device lists, boot and shutdown, input, screenshots, and accessibility reads.
- agent-device's 55 official MCP tools, including app launch, snapshot refs, element presses, text entry, scrolling, waits, and debugging.
- A bundled agent-device skill and a workflow guide from the pinned CLI version.

## Requirements

Use an Apple Silicon Mac with Xcode 26 or later, an installed iOS simulator runtime, and Node.js 22.18 or later. Baguette uses Apple's simulator frameworks. agent-device builds its bundled XCTest runner with Xcode on its first interaction and caches it under `~/.agent-device/apple-runner`. The plugin carries both runtimes, all npm dependencies, and the Apple runner source. It does not download code at runtime.

The native panel targets Codex desktop and iOS simulators. Both MCP servers also work through stdio in a local MCP client. agent-device includes commands for other platforms, but this plugin defaults to iOS and requires the same UDID as the panel. This version does not build the user's app or stream an Android screen. Codex's permission and confirmation rules still apply to tool calls.

Android logs need `adb` from an installed Android SDK. The reader checks `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `~/Library/Android/sdk`, then PATH. Metro logs need an existing local Metro server and an app with an inspector target. The log tools connect to that server without starting it.

## Install the local build

From this project directory, after packaging:

```sh
codex plugin marketplace add ./release/marketplace
codex plugin add mobile-dev@mobile-dev-local
```

Open a new chat after installing. Open Mobile Dev in the sidebar or call `mobile_open_workspace` for the fullscreen view. Call `mobile_open_simulator` for the panel beside a chat. Choose a simulator from its panel dropdown and press Start. Start boots the device if needed, then connects its screen. A selected running device connects automatically. The panel uses Apple’s device bezel and screen mask from the installed DeviceKit assets, with a simple frame as a fallback when assets are unavailable. Click the screen to type or drag. Pause closes the stream and keeps the last frame.

The local ZIP at `release/mobile-dev-0.1.18-darwin-arm64.zip` holds the same plugin. Install through the local marketplace above. The New Plugin archive dialog uploads to the workspace plugin service; it is a separate install route. This package has not gone through public directory review or publication.

Ask the agent to inspect or control the app on the selected simulator. The panel shares the selected UDID with the chat's model context. The agent uses the bundled agent-device tools with that UDID, opens a named session, reads accessibility refs, then presses elements or fills fields. Baguette keeps the live stream in the panel. The tools take the same session name on later calls so refs and app state stay together.

## App logs

The fullscreen plugin view has a full-width tool bar above both panels. Each panel has its own controls. Logs sit on the left and the simulator on the right above 800px; smaller views place the simulator above logs. The Logs tab reopens the logs panel. Click Logs to collapse the left panel to a tab, then click it again to reopen. The panel beside a chat keeps the collapsible drawer below the simulator. Each view has its own UI resource, so the layout does not depend on the host's display-mode flag. A booted simulator streams its unified logs. Click Sources to enter the app's executable name and press Connect to filter the native stream. Leave the app filter empty to include all device processes.

For Metro, enter its local URL and click Find sources. Select the app and device in Metro app. For Android, choose a connected device in Native source and enter its package name to follow the app across restarts. The simulator screen stays on iOS when you choose Android logs. You can read native and Metro logs together.

JS and Native toggle each source. Info, Warn, Error, and Debug toggle each level. Search matches log text, stack traces, and process details. Stack groups exact repeats by source, level, device, and process and shows the count on the right. Follow keeps the latest rows in view. Pause stops log readers; Resume opens a new session. Closing the drawer also stops its readers. Clear removes the buffered rows while the stream runs.

Click a row to read its full text and stack trace. Attach to chat adds that log, its source, and its repeat count to the agent's next prompt, along with the selected simulator. Ask the agent to fix the error in your next message. Remove attachment clears the log. Each new attachment replaces the prior log. Removing the attachment in Codex also clears the panel's attachment state.

iOS reads `xcrun simctl spawn <UDID> log stream --style ndjson --level debug`, the simulator's unified logs used for native debugging. It cannot recover past output that an Xcode debugger captured only through stdout or stderr. Metro reads console events and exceptions through the inspector. Each log reader retries dropped connections. Metro keeps the chosen target ID; refresh its targets if an app restart assigns a new ID. Buffers hold at most 2,000 records and cap their byte size. The drawer shows the latest 500 matching rows or groups.

`npm run test:logs` reads logs from an already booted simulator through the built MCP server. It prints counts, closes the log reader, and leaves the device and app running.

## Develop and package

```sh
npm ci
npm run vendor:baguette
npm run vendor:agent-device
npm run build
npm test
npm run package
npm run test:package
npm run test:agent-device
```

`vendor:baguette` downloads the pinned official release and checks its SHA-256. It keeps the full resource bundle and rebuilds the same v0.2.1 source with Swift 6.4 or later because the official binary crashes in Swift task allocation on macOS 27. Preparing Baguette requires Xcode 27, Git, and network access to fetch its pinned source and Swift dependencies. `rebuild:baguette` repeats the source build. `vendor/baguette/release.json` records the source commit, compiler version, and rebuilt binary SHA-256.

`vendor:agent-device` installs the exact npm packages in `runtimes/agent-device/package-lock.json` with package scripts disabled. `build` copies this full runtime into `dist/agent-device`, records its integrity and lockfile hash in `release.json`, and saves its version-matched help in the control skill. The installed plugin needs no npm install or runtime download. Xcode compiles the shipped Apple runner source on its first use.

`build` also bundles JavaScript and CSS with esbuild and copies Baguette into `dist/baguette`. It does not run TypeScript, lint, Biome, visual checks, or React Doctor.

`package` copies built files into `release/marketplace/plugins/mobile-dev` and creates the ZIP. It includes agent-device's runtime `node_modules`, licenses, and Apple runner source. It does not need this development checkout or a global agent-device install to run. The source repo's existing build-codex-native-plugins skill stays outside that release package.

`test` checks MCP contracts, secure binary streaming, input validation, and capture cleanup against a local fixture. `test:package` copies the release package into a temporary directory, starts its bundled Baguette, reads the real device list, and checks shutdown. It does not boot or change a simulator. Run it on an Apple Silicon Mac with Xcode.

`test:agent-device` starts the agent-device MCP server from a copied package with no global CLI on its PATH. It checks the control tools, pinned runtime, isolated state directory, real iOS device list, and daemon cleanup. It does not open an app, take screenshots, or send input.

`npm run test:reconnect -- <UDID>` tests an already booted simulator with a copied package. It terminates only that test package's own Baguette process and checks that the same stream resumes with a new bundled process. It never boots a simulator, repairs input, or sends gestures.

The host installs a cache copy. After changing source, rebuild and package, then run `codex plugin add mobile-dev@mobile-dev-local` to update it. Reopen Mobile Dev from a new chat to load the new copy.

## Runtime

Each MCP process owns one bundled Baguette child process. It selects a free loopback port, launches `dist/baguette/Baguette serve --host 127.0.0.1 --port <port> --no-plugins`, and shares that child across its tool calls and panel sessions. It does not use a separate Baguette server on port 8421. An opening failure returns an error the panel can show.

The second MCP entry runs `dist/agent-device-server.mjs`, which launches the official bundled `agent-device mcp` with Node. The wrapper uses the package's iOS config and a private temporary state directory. It clears inherited agent-device settings so a global or cloud daemon cannot take over this connection. Commands start its local daemon as needed. On MCP shutdown, the wrapper runs the bundled `daemon stop --state-dir <own-directory> --clean` command, which checks the daemon's PID identity and releases its runner leases. It keeps logs and artifacts in that state directory for later reads. Call agent-device `session` with `action: "state-dir"` to find it.

Use the panel's UDID and a named agent-device session for agent work. Refs belong to the latest snapshot or settled diff in that session. `press` and `fill` take a target such as `{ "kind": "ref", "ref": "@e12" }` or `{ "kind": "selector", "selector": "label=\"Search\"" }`. Use actual refs from the current result. Closing a session can close its app; leave `shutdown` unset to keep the simulator running. Another live agent-device daemon can own a runner lease. End that owner's work or choose another simulator instead of releasing its live claim.

On first use, the panel explains local streaming and offers **Create certificate & enable streaming**. Clicking it creates a certificate unique to the Mac and requests macOS Keychain trust for SSL. The certificate itself is valid only for `127.0.0.1` and cannot issue other certificates. Approve the Keychain request to continue. Opening the panel only checks setup; it does not create or trust certificates. Setup lasts one year and is reused across plugin updates. If an earlier setup used hostname-scoped Keychain trust, the panel offers **Update certificate trust & enable streaming** to repair it. Chromium ignores hostname-scoped trust entries, even when macOS certificate verification succeeds. Keys and certificates live in `~/Library/Application Support/Mobile Dev/tls` with private permissions. To revoke trust, delete **Mobile Dev local streaming** from the login keychain in Keychain Access. Delete the TLS directory to remove its files.

The app gets a random stream token through an app-only MCP tool and attempts to connect to the plugin's loopback WSS endpoint. The implemented path relays Baguette's binary H.264 packets to WebCodecs. The panel paints the newest decoded frame on each animation tick and closes superseded frames. Gestures use the same socket with schema validation and Device Hub checks. MCP carries setup and session lifecycle calls, rather than individual video frames or gestures. The current host blocks the browser connection before this video path can run; the target FPS has not been verified in the embedded panel.

The UI resource's CSP permits the exact local WSS origin. The observed desktop host filters plain HTTP and WebSocket origins out of widget CSP; TLS makes the origin eligible for that allowlist. Chromium's Local Network Access permission is a separate check, which the observed host denies for this panel. Repeating certificate setup or changing macOS Local Network settings alone does not override that host denial. A token can connect once and expires after one minute if unused. Heartbeats detect stalled connections. Closing or pausing a viewer closes its upstream capture. Ending the MCP process stops its Baguette child and streams. Simulator devices remain under CoreSimulator's control.

When a socket drops, the panel creates a new session for the same device. If Baguette exits, opening the next session starts a new bundled process. Failed attempts wait between 0.5 and 10 seconds. The panel keeps the last frame, shows Reconnecting, and discards input from the failed connection. Pause, closing the panel, or selecting another device cancels retries. Reconnect never boots a stopped simulator or runs an input repair. Certificate or unsupported decoder errors require user action.

On macOS 27 with Xcode 27, the bundled Baguette can list simulators and capture frames. Device Hub can stop taps, buttons, and keys from reaching an iOS 27 device. The panel checks this state when connecting and sending input. When blocked, it shows Repair input and explains that the repair closes running apps. The button runs the bundled Baguette's `heal` command, then reconnects capture with new input handles. It restarts backboardd and SpringBoard without rebooting the device. Relaunching Device Hub can block input again. The panel never repairs a running device without the user clicking Repair input or asking to fix input. Baguette's boot route also repairs input after boot. Do not run the repair to diagnose video. See [Baguette's Device Hub notes](https://github.com/tddworks/baguette/blob/main/docs/features/device-hub/README.md).

UI resource addresses are stable for each release. All MCP processes use one shared local streaming service at `wss://127.0.0.1:49321`, so discovery metadata, cached HTML, CSP, and stream sessions agree even when Codex routes them through different processes. The service starts on demand and exits 30 seconds after its last MCP client disconnects. Each MCP client registers its own capture routes over a private Unix socket; disconnecting a client closes only its streams. Frames and gestures travel through local sockets without MCP frame requests. If the fixed port is occupied, streaming reports an error instead of selecting a different port. The panel checks the host-approved CSP before connecting. After updating the installed plugin, restart Codex once and reopen Mobile Dev to load the new resource address.

## Tools

| Tool | Action |
| --- | --- |
| `mobile_open_simulator` | Open the native panel and start the bundled backend |
| `mobile_open_workspace` | Open fullscreen with logs on the left and the simulator on the right |
| `mobile_list_simulators` | Start the bundled backend if needed and list devices |
| `mobile_start_baguette` | Retry or reconnect the bundled backend |
| `mobile_boot_simulator` | Boot one listed device |
| `mobile_shutdown_simulator` | Shut down one listed device |
| `mobile_describe_ui` | Read a booted device's accessibility tree |
| `mobile_screenshot` | Return a booted device's PNG screenshot |
| `mobile_send_input` | Send validated input in device points |
| `mobile_repair_input` | Reclaim input from Device Hub, closing running apps |
| `mobile_stream_session` | Create a panel stream, app-only |
| `mobile_certificate_status` | Check local streaming setup, app-only |
| `mobile_setup_certificate` | Create and request trust for the local certificate after a setup button click, app-only |
| `mobile_stream_close` | Close a panel stream, app-only |
| `mobile_log_sources` | List connected Android devices and local Metro targets |
| `mobile_logs_session` | Start native and/or Metro log readers |
| `mobile_read_logs` | Read a log batch and source status |
| `mobile_logs_close` | Stop a session's log readers |

The `agent-device` MCP server exposes the pinned runtime's official tools directly, including `open`, `snapshot`, `press`, `fill`, `type`, `scroll`, `wait`, `find`, `get`, `is`, `close`, and debugging tools. Their input schemas describe each command. The bundled [control skill](skills/agent-device/SKILL.md) explains session ordering and links to the version-matched guide.

## Sources

The implementation follows [Baguette's HTTP and WebSocket routes](https://github.com/tddworks/baguette/blob/v0.2.1/docs/serve.md) and [gesture protocol](https://github.com/tddworks/baguette/blob/v0.2.1/docs/wire.md). The bundled automation server follows [agent-device's official MCP setup](https://github.com/callstack/agent-device#add-mcp-tools-to-your-agent). Native panel metadata follows [OpenAI's plugin extensions](https://developers.openai.com/plugins/build/extensions). The package uses the [portable plugin format](https://developers.openai.com/plugins/build/plugins).
