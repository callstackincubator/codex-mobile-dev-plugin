# Mobile Dev for Codex

An iOS and Android simulator panel for Codex desktop. The plugin includes Baguette 0.2.1 for streaming and agent-device 0.20.9 for agent control. serve-emu 0.0.6 and scrcpy 4.0 provide Android streaming. All three runtimes ship in the plugin and start on demand. Android needs Bun 1.3.13 or later and an installed Android SDK.

The first version supports:

- A native sidebar entry and a panel beside a chat.
- A centered simulator with one toolbar for device selection, Start/Pause, Home, App Switcher, Lock, and refresh.
- A screenshot button that adds an iOS PNG to the chat input and copies the same image to the macOS clipboard.
- Live MJPEG for iOS and H.264 for Android, with a target of 30 fps and a small frame counter. The host's MCP bridge sets the delivered frame rate.
- An iOS/Android picker, Android AVD boot and shutdown, and connected Android devices.
- Pointer taps and drags and printable US-ASCII typing directly on the focused screen.
- A Repair input button when Xcode 27 Device Hub blocks interaction.
- Automatic reconnect after a stream or backend failure, with Pause to stop retries.
- A collapsible log drawer below the simulator with JS/Native and level filters, search, repeat counts, and log attachments for the agent.
- iOS unified logs, Android logcat from connected devices, and JS console messages and exceptions from a selected Metro app.
- MCP tools for device lists, boot and shutdown, input, screenshots, and accessibility reads.
- agent-device's 55 official MCP tools, including app launch, snapshot refs, element presses, text entry, scrolling, waits, and debugging.
- A bundled agent-device skill and a workflow guide from the pinned CLI version.

## Requirements

The plugin needs Node.js 22.18 or later. iOS needs an Apple Silicon Mac with Xcode 26 or later and an installed simulator runtime. Baguette uses Apple's simulator frameworks. agent-device builds its bundled XCTest runner with Xcode on its first interaction and caches it under `~/.agent-device/apple-runner`. The plugin carries all three runtimes, their npm dependencies, and the Apple runner source. It does not download code at runtime.

The native panel targets Codex desktop, iOS simulators, and Android emulators or attached devices. Both MCP servers also work through stdio in a local MCP client. agent-device defaults to iOS. Set `platform: "android"` and `serial` to the selected Android device ID for Android control. This plugin does not build the user's app. Codex's permission and confirmation rules still apply to tool calls.

Android logs need `adb` from an installed Android SDK. The reader checks `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `~/Library/Android/sdk`, then PATH. Metro logs need an existing local Metro server and an app with an inspector target. The log tools connect to that server without starting it.

## Install the local build

From this project directory, after packaging:

```sh
codex plugin marketplace add ./release/marketplace
codex plugin add mobile-dev@mobile-dev-local
```

Open a new chat after installing. Open Mobile Dev in the sidebar or call `mobile_open_workspace` for the fullscreen view. Call `mobile_open_simulator` for the panel beside a chat. iOS and Android appear side by side, each with a device dropdown and Start button. Pick a device and press Start in each panel. Use the platform menu to show one platform on its own. Start boots the device if needed, then connects its screen. A selected running device connects automatically. The panel uses Apple’s device bezel and screen mask from the installed DeviceKit assets, with a simple frame as a fallback when assets are unavailable. Click the screen to type or drag. Pause closes the stream and keeps the last frame.

The local ZIP at `release/mobile-dev-0.1.20-darwin-arm64.zip` holds the same plugin. Install through the local marketplace above. The New Plugin archive dialog uploads to the workspace plugin service; it is a separate install route. This package has not gone through public directory review or publication.

Ask the agent to inspect or control the app on the selected device. The panel shares both visible device IDs and platforms with the chat. Click a device panel to make it the active device for logs. The agent uses the bundled agent-device tools with the chosen device ID, opens a named session, reads accessibility refs, then presses elements or fills fields. Baguette streams iOS and serve-emu streams Android in the panel. The tools take the same session name on later calls so refs and app state stay together.

## Android

Install Bun 1.3.13 or later and Android SDK platform-tools and emulator. Create an AVD in Android Studio or connect an Android device and authorize adb access. The Android panel lists devices without booting one. Start boots the selected AVD if needed, then starts the bundled serve-emu CLI on a private loopback port. Home, Back, Recents, Lock, pointer gestures, and typing use scrcpy's control socket. Pause closes the panel stream and leaves the emulator running. AVDs start without a separate emulator window. A failed emulator process reports its exit right away instead of waiting for the boot timeout.

Android H.264 packets travel through MCP resource reads. The panel decodes them with WebCodecs, so the host must support H.264 `VideoDecoder`. Each device gets its own backend and each panel gets its own stream session. Decoder errors and video backlog request a fresh keyframe on the same connection. The panel drops delta frames until it can decode that keyframe. Requests have a cooldown, and stale decoder callbacks cannot repaint a closed stream. The plugin reuses a matching serve-emu server at port 3300. Set `SERVE_EMU_URL` to reuse another loopback HTTP server; it must already stream the selected serial. Closing MCP stops only backends the plugin started.

For tool use, call `mobile_list_android_devices`. It returns serials for connected devices and `avd:<name>` IDs for stopped AVDs. Boot a selected AVD with `mobile_boot_android_emulator` and use its returned running serial for later calls. `mobile_shutdown_android_emulator` stops an emulator. `mobile_android_screenshot`, `mobile_android_describe_ui`, and `mobile_android_send_input` inspect and control running devices. Gesture coordinates use screen pixels and matching screen width and height. For agent-device, pass `platform: "android"`, `serial`, and a named session.

`vendor:serve-emu` installs the pinned npm runtime with package scripts disabled and checks the bundled scrcpy 4.0 server's SHA-256. `build` copies the full runtime and records package integrity, lockfile hash, and scrcpy hash in `dist/serve-emu/release.json`. Starting Android requires no npm install or runtime download.

Click the camera button in the iOS simulator toolbar to add a fresh PNG to the chat input and copy it to the macOS clipboard. Each click adds another screenshot and keeps any attached log. Remove screenshots from the chat input to clear them. The button works while the selected iOS simulator runs, including when the stream is paused. It does not send a message.

## App logs

The fullscreen plugin view has a full-width tool bar above the logs and device panels. Each panel has its own controls. Logs sit on the left and both simulators on the right above 800px; smaller views place both simulators above logs. The Logs tab reopens the logs panel. Click Logs to collapse the left panel to a tab, then click it again to reopen. The panel beside a chat keeps the collapsible drawer below the simulator. Each view has its own UI resource, so the layout does not depend on the host's display-mode flag. A booted simulator streams its unified logs. Click Sources to enter the app's executable name and press Connect to filter the native stream. Leave the app filter empty to include all device processes.

For Metro, enter its local URL and click Find sources. Select the app and device in Metro app. For Android, choose a connected device in Native source and enter its package name to follow the app across restarts. Native source follows the device selected in the panel. You can also choose another connected Android device for logs. You can read native and Metro logs together.

JS and Native toggle each source. Info, Warn, Error, and Debug toggle each level. Search matches log text, stack traces, and process details. Stack groups exact repeats by source, level, device, and process and shows the count on the right. Follow keeps the latest rows in view. Pause stops log readers; Resume opens a new session. Closing the drawer also stops its readers. Clear removes the buffered rows while the stream runs.

Click a row to read its full text and stack trace. Attach to chat adds that log, its source, and its repeat count to the agent's next prompt, along with the selected simulator. Ask the agent to fix the error in your next message. Remove attachment clears the log. Each new attachment replaces the prior log. Removing the attachment in Codex also clears the panel's attachment state.

iOS reads `xcrun simctl spawn <UDID> log stream --style ndjson --level debug`, the simulator's unified logs used for native debugging. It cannot recover past output that an Xcode debugger captured only through stdout or stderr. Metro reads console events and exceptions through the inspector. Each log reader retries dropped connections. Metro keeps the chosen target ID; refresh its targets if an app restart assigns a new ID. Buffers hold at most 2,000 records and cap their byte size. Legend List renders the visible rows and lets you scroll through all buffered matches.

`npm run test:logs` reads logs from an already booted simulator through the built MCP server. It prints counts, closes the log reader, and leaves the device and app running.

## Develop and package

The panel uses React and shadcn/ui with preset `b1D0f1JA`, Mira controls, neutral colors, and Inter. Google Material Symbols replace the preset's icons. The build bundles the SVGs and font files into the HTML; the panel needs no external asset requests. Use the preset components in `src/ui/components/ui` for controls, forms, notices, and empty states. Compose the views with Tailwind utilities. `src/ui/style.css` only covers device frames, Codex layout, and base rules; preset tokens live in `src/ui/theme.css`. The log list uses the [Legend List React DOM entrypoint](https://www.legendapp.com/open-source/list/v3/react/getting-started/).

```sh
npm ci
npm run vendor:baguette
npm run vendor:agent-device
npm run vendor:serve-emu
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

`test` checks MCP contracts, frame reads, input validation, and capture cleanup against a local fixture. `test:package` copies the release package into a temporary directory, starts its bundled Baguette, reads the real device list, and checks shutdown. It does not boot or change a simulator. Run it on an Apple Silicon Mac with Xcode.

`test:agent-device` starts the agent-device MCP server from a copied package with no global CLI on its PATH. It checks the control tools, pinned runtime, isolated state directory, real iOS device list, and daemon cleanup. It does not open an app, take screenshots, or send input.

`npm run test:reconnect -- <UDID>` tests an already booted simulator with a copied package. It terminates only that test package's own Baguette process and checks that the same stream resumes with a new bundled process. It never boots a simulator, repairs input, or sends gestures.

The host installs a cache copy. After changing source, rebuild and package, then run `codex plugin add mobile-dev@mobile-dev-local` to update it. Reopen Mobile Dev from a new chat to load the new copy.

## Runtime

Each MCP process owns one bundled Baguette child process. It selects a free loopback port, launches `dist/baguette/Baguette serve --host 127.0.0.1 --port <port> --no-plugins`, and shares that child across its tool calls and panel sessions. It does not use a separate Baguette server on port 8421. An opening failure returns an error the panel can show.

The second MCP entry runs `dist/agent-device-server.mjs`, which launches the official bundled `agent-device mcp` with Node. The wrapper uses the package's iOS config and a private temporary state directory. It clears inherited agent-device settings so a global or cloud daemon cannot take over this connection. Commands start its local daemon as needed. On MCP shutdown, the wrapper runs the bundled `daemon stop --state-dir <own-directory> --clean` command, which checks the daemon's PID identity and releases its runner leases. It keeps logs and artifacts in that state directory for later reads. Call agent-device `session` with `action: "state-dir"` to find it.

Use the panel's UDID and a named agent-device session for agent work. Refs belong to the latest snapshot or settled diff in that session. `press` and `fill` take a target such as `{ "kind": "ref", "ref": "@e12" }` or `{ "kind": "selector", "selector": "label=\"Search\"" }`. Use actual refs from the current result. Closing a session can close its app; leave `shutdown` unset to keep the simulator running. Another live agent-device daemon can own a runner lease. End that owner's work or choose another simulator instead of releasing its live claim.

The app gets a random stream session through an app-only MCP tool. The MCP server opens a WebSocket to its bundled Baguette, keeps the latest JPEG, and returns it through `resources/read`. The app sends input through an app-only tool that checks each message. Frames and input stay inside the host's MCP bridge. The app makes no direct network requests.

The UI resource's CSP has empty connection and resource allowlists. Codex desktop 0.159.0 filters plain HTTP and WebSocket origins out of widget CSP, including loopback addresses. The MCP transport avoids those browser connections. A session expires after five minutes without reads or input. Closing or pausing a viewer closes its upstream capture. Ending the MCP process stops its Baguette child and streams. Simulator devices remain under CoreSimulator's control.

When a socket drops, the server reopens it for the same device and preserves the frame sequence. It clears the old frame and waits for fresh capture before allowing input. If Baguette exits, the next read starts a new bundled process. Heartbeats detect sockets that stop responding. If an open socket produces no first frame within ten seconds, capture retries with a delay. Baguette's MJPEG capture sends only changed pixels, so a quiet screen after the first frame stays connected. Failed attempts wait between 0.5 and 10 seconds. The panel also reconnects after MCP errors or an expired session. It keeps the last frame, shows Reconnecting, and discards input from the failed connection. Pause, closing the panel, or selecting another device cancels retries. Reconnect never boots a stopped simulator or runs an input repair.

An iOS JPEG decode error restarts capture through `mobile_stream_reset` with the same panel session. Reset requests have a one-second cooldown. Three failed frames in a row reopen the panel stream with a delay. Late decode results release their bitmap and cannot draw on a closed panel.

iOS boot and shutdown calls run in order for each device and wait up to two minutes for the reported state. Boot skips the backend route if the device already runs or is booting. This avoids a second boot and Baguette's input repair on a running device. Shutdown closes that device's panel streams after the device stops.

On macOS 27 with Xcode 27, the bundled Baguette can list simulators and capture frames. Device Hub can stop taps, buttons, and keys from reaching an iOS 27 device. The panel checks this state when connecting and sending input. When blocked, it shows Repair input and explains that the repair closes running apps. The button runs the bundled Baguette's `heal` command, then reconnects capture with new input handles. It restarts backboardd and SpringBoard without rebooting the device. Relaunching Device Hub can block input again. The panel never repairs a running device without the user clicking Repair input or asking to fix input. Baguette's boot route also repairs input after boot. Do not run the repair to diagnose video. See [Baguette's Device Hub notes](https://github.com/tddworks/baguette/blob/main/docs/features/device-hub/README.md).

UI resource addresses include the release version so Codex can load new HTML after an update. The original simulator and workspace addresses and the old v1 through v6 simulator addresses still return the current UI. After updating, restart Codex once if it still uses an older MCP process.

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
| `mobile_stream_input` | Send a batch of panel input, app-only |
| `mobile_stream_reset` | Recover one iOS panel's MJPEG capture, app-only |
| `mobile_stream_close` | Close a panel stream, app-only |
| `mobile_log_sources` | List connected Android devices and local Metro targets |
| `mobile_logs_session` | Start native and/or Metro log readers |
| `mobile_read_logs` | Read a log batch and source status |
| `mobile_logs_close` | Stop a session's log readers |

The `agent-device` MCP server exposes the pinned runtime's official tools directly, including `open`, `snapshot`, `press`, `fill`, `type`, `scroll`, `wait`, `find`, `get`, `is`, `close`, and debugging tools. Their input schemas describe each command. The bundled [control skill](skills/agent-device/SKILL.md) explains session ordering and links to the version-matched guide.

## Sources

The implementation follows [Baguette's HTTP and WebSocket routes](https://github.com/tddworks/baguette/blob/v0.2.1/docs/serve.md) and [gesture protocol](https://github.com/tddworks/baguette/blob/v0.2.1/docs/wire.md). The bundled automation server follows [agent-device's official MCP setup](https://github.com/callstack/agent-device#add-mcp-tools-to-your-agent). Native panel metadata follows [OpenAI's plugin extensions](https://developers.openai.com/plugins/build/extensions). The package uses the [portable plugin format](https://developers.openai.com/plugins/build/plugins).
