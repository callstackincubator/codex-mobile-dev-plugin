# Mobile Dev for Codex

An iOS and Android simulator panel for Codex desktop. The plugin includes Baguette 0.2.1 for streaming and agent-device 0.20.9 for agent control. serve-emu 0.0.6 and scrcpy 4.0 provide Android streaming. All three runtimes ship in the plugin and start on demand. Android needs Bun 1.3.13 or later and an installed Android SDK.

The first version supports:

- A native sidebar entry and a panel beside a chat.
- A centered simulator with one toolbar for device selection, Home, App Switcher, and Screenshot.
- A screenshot button that adds an iOS or Android PNG to the chat input and copies the same image to the macOS clipboard.
- Live MJPEG for iOS with a 60 fps capture target, and H.264 for Android. Actual frame rates depend on native capture and the host bridge.
- An iOS/Android picker, Android AVD boot and shutdown, and connected Android devices.
- Physical iPhones and iPads discovered over USB or Wi-Fi, grouped above iOS simulators in the same picker.
- Pointer taps and drags and printable US-ASCII typing directly on the focused screen.
- A notice when Xcode 27 Device Hub blocks interaction. Repair remains available through the `mobile_repair_input` tool.
- Automatic reconnect after a stream or backend failure.
- A resizable log panel with search, repeat counts, log attachments, source settings in a popover, and a compact level filter.
- iOS simulator and physical-device unified logs, Android logcat from connected devices, and JS console messages and exceptions from a selected Metro app.
- A Performance tab with live iOS and Android CPU and memory usage, expandable thread charts, and a rolling 150-second timeline.
- MCP tools for device lists, boot and shutdown, input, screenshots, and accessibility reads.
- agent-device's 55 official MCP tools, including app launch, snapshot refs, element presses, text entry, scrolling, waits, and debugging.
- A bundled agent-device skill and a workflow guide from the pinned CLI version.

## Requirements

The plugin needs Node.js 22.18 or later. iOS needs an Apple Silicon Mac with Xcode 26 or later and an installed simulator runtime. Baguette uses Apple's simulator frameworks. agent-device builds its bundled XCTest runner with Xcode on its first interaction and caches it under `~/.agent-device/apple-runner`. The plugin carries all three runtimes, their npm dependencies, and the Apple runner source. It does not download code at runtime.

Physical iOS discovery requires Xcode 27 or later. It uses the selected Xcode installation's `xcrun devicectl` JSON output and needs no additional native library. Pair the phone with Xcode and enable wireless connectivity there to discover it over Wi-Fi.

The native panel targets Codex desktop, iOS simulators, and Android emulators or attached devices. Both MCP servers also work through stdio in a local MCP client. agent-device defaults to iOS. Set `platform: "android"` and `serial` to the selected Android device ID for Android control. This plugin does not build the user's app. Codex's permission and confirmation rules still apply to tool calls.

Android logs need `adb` from an installed Android SDK. The reader checks `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `~/Library/Android/sdk`, then PATH. Metro logs need an existing local Metro server and an app with an inspector target. The log tools connect to that server without starting it.

## Install the local build

From this project directory, after packaging:

```sh
codex plugin marketplace add ./release/marketplace
codex plugin add mobile-dev@mobile-dev-local
```

Open a new chat after installing. Open Mobile Dev in the sidebar or call `mobile_open_workspace` for the fullscreen view. Call `mobile_open_simulator` for the panel beside a chat. iOS opens by default. Enable Android from the toolbar to show both panels side by side. Each panel has a device dropdown, Home, App Switcher, and Screenshot. Pick a device in each panel. Use the iOS and Android toggles to show either, both, or neither simulator. Selecting a device boots it if needed, then connects its screen. A selected running device connects automatically. The panel uses Apple’s device bezel and screen mask from the installed DeviceKit assets, with a simple frame as a fallback when assets are unavailable. Use the settings button at the bottom right for appearance, text size, location, and the device frame. iOS also offers contrast; Android offers rotation. The menu shows only settings supported by the bundled backend. Click the screen to type or drag. Closing the panel closes its stream.

The local ZIP at `release/mobile-dev-0.1.50-darwin-arm64.zip` holds the same plugin. Install through the local marketplace above. The New Plugin archive dialog uploads to the workspace plugin service; it is a separate install route. This package has not gone through public directory review or publication.

The iOS dropdown shows **Connected devices** first, with USB or Wi-Fi labels, then **Simulators**. It refreshes every three seconds while the iOS panel is visible, and when opening the dropdown. Selecting a physical device opens view-only screen mirroring through its paired developer connection. The phone sends HEVC video; a bundled native Node-API addon assembles compressed frames and transfers them into Node without copying the frame payload, then the panel decodes them through WebCodecs. MCP serializes the compressed bytes as base64, so the full path is not zero copy. The capture queue is limited to eight frames or 4 MiB and requests a keyframe after overflow. Physical iOS input, screenshots, and CPU/memory collection are not implemented yet; those controls remain disabled. Mirroring requires Developer Mode and a host with HEVC WebCodecs support. `mobile_list_ios_devices` also returns remembered disconnected devices with their connection state; the picker shows connected devices only. Discovery errors remain visible while available simulators continue to work.

Ask the agent to inspect or control the app on the selected device. The panel shares both visible device IDs and platforms with the chat. Click a device panel to make it the active device for logs. Hiding a simulator keeps the current log source and buffered logs. The agent uses the bundled agent-device tools with the chosen device ID, opens a named session, reads accessibility refs, then presses elements or fills fields. Baguette streams iOS and serve-emu streams Android in the panel. The tools take the same session name on later calls so refs and app state stay together.

## Android

Install Bun 1.3.13 or later and Android SDK platform-tools and emulator. Create an AVD in Android Studio or connect an Android device and authorize adb access. The Android panel lists devices without booting one. Selecting an AVD boots it if needed, then starts the bundled serve-emu CLI on a private loopback port. Home, Back, Recents, Lock, pointer gestures, and typing use scrcpy's control socket. Closing the panel leaves the emulator running. AVDs start without a separate emulator window. A failed emulator process reports its exit right away instead of waiting for the boot timeout.

The Android dropdown shows **Connected devices** first, with USB or Wi-Fi labels, then **Emulators**. It refreshes every three seconds while the Android panel is visible, and when opening the dropdown. Physical devices use ADB discovery: enable USB debugging and authorize the computer, or pair the device for wireless debugging. Offline and unauthorized devices remain visible with their state. Selecting an authorized phone connects its screen and shares its serial and transport with the chat. Bundled scrcpy mirrors and controls the phone without installing a companion app. Physical Android devices support the existing screen, input, screenshot, native log, and performance tools; emulator boot and stop controls do not apply to them.

Android H.264 packets travel through MCP resource reads. The panel decodes them with WebCodecs, so the host must support H.264 `VideoDecoder`. Each device gets its own backend and each panel gets its own stream session. Decoder errors and video backlog request a fresh keyframe on the same connection. The panel drops delta frames until it can decode that keyframe. Requests have a cooldown, and stale decoder callbacks cannot repaint a closed stream. The plugin reuses a matching serve-emu server at port 3300. Set `SERVE_EMU_URL` to reuse another loopback HTTP server; it must already stream the selected serial. Closing MCP stops only backends the plugin started.

For tool use, call `mobile_list_android_devices`. It returns serials for connected devices and `avd:<name>` IDs for stopped AVDs. Boot a selected AVD with `mobile_boot_android_emulator` and use its returned running serial for later calls. `mobile_shutdown_android_emulator` stops an emulator. `mobile_android_screenshot`, `mobile_android_describe_ui`, and `mobile_android_send_input` inspect and control running devices. Gesture coordinates use screen pixels and matching screen width and height. For agent-device, pass `platform: "android"`, `serial`, and a named session.

`vendor:serve-emu` installs the pinned npm runtime with package scripts disabled and checks the bundled scrcpy 4.0 server's SHA-256. `build` copies the full runtime and records package integrity, lockfile hash, and scrcpy hash in `dist/serve-emu/release.json`. Starting Android requires no npm install or runtime download.

Click the camera button in either simulator toolbar to add a fresh PNG to the chat input and copy it to the macOS clipboard. Each click adds another screenshot and keeps any attached log. Remove screenshots from the chat input to clear them. The button works while the selected simulator runs, including when the stream is paused. It does not send a message.

## App logs

The fullscreen plugin view has a full-width tool bar above the logs and device panels. Each panel has its own controls. Logs sit on the left and both simulators on the right above 800px; smaller views place both simulators above logs. The Logs tab reopens the logs panel. Click Logs to collapse the left panel to a tab, then click it again to reopen. The panel beside a chat keeps the collapsible drawer below the simulator. Each view has its own UI resource, so the layout does not depend on the host's display-mode flag. A booted simulator or connected physical iPhone streams its unified logs. Click Sources to enter the app's executable name and press Connect to filter the native stream. Leave the app filter empty to include all device processes.

For Metro, enter its local URL and click Find sources. Select the app and device in Metro app. For Android, choose a connected device in Native source and enter its package name to follow the app across restarts. Native source follows the device selected in the panel. You can also choose another connected Android device for logs. You can read native and Metro logs together.

JS and Native toggle each source. Info, Warn, Error, and Debug toggle each level. Search matches log text, stack traces, and process details. Stack groups exact repeats by source, level, device, and process and shows the count on the right. Follow keeps the latest rows in view. Pause stops log readers; Resume opens a new session. Closing the drawer also stops its readers. Clear removes the buffered rows while the stream runs.

While Performance is visible, the log view is unmounted and the browser stops
reading, filtering, and rendering log batches. Collection continues in the
plugin's separate Node process, bounded to 2,000 records and 4 MiB per session.
Returning to Logs immediately restores cached rows, filters, selection, and
scroll position, then catches up from the same cursor. A small keep-alive once
per minute retains the session without transferring logs. Closing the tools
panel still stops collection.

Click a row to read its full text and stack trace. Attach to chat adds that log, its source, and its repeat count to the agent's next prompt, along with the selected simulator. Ask the agent to fix the error in your next message. Remove attachment clears the log. Each new attachment replaces the prior log. Removing the attachment in Codex also clears the panel's attachment state.

iOS simulators use `xcrun simctl spawn <UDID> log stream --style ndjson --level debug`. Physical iPhones use the bundled libimobiledevice OS trace relay reader over the existing paired USB or Wi-Fi connection. Select the phone in the device picker; no app launch, restart, debugger attachment, or app SDK is required. An executable-name filter continues across app PID changes. Unified logs exclude ordinary `print`/`printf` stdout/stderr output and may redact private values. Metro reads console events and exceptions through the inspector. Each log reader retries dropped connections. Metro keeps the chosen target ID; refresh its targets if an app restart assigns a new ID. Buffers hold at most 2,000 records and cap their byte size. Legend List renders the visible rows and lets you scroll through all buffered matches.

`npm run test:logs` reads logs from an already booted simulator through the built MCP server. `npm run test:ios-logs -- --device <hardware-UDID>` reads a connected physical iPhone, with optional `--process <executable-name>`. Both print counts, close the log reader, and leave the device and app running. For tool-only physical logs, pass `{ platform: "ios", kind: "physical", deviceId: "<hardware-UDID>" }` to `mobile_logs_session`; use the `udid` returned by `mobile_list_ios_devices`, rather than its `coreDeviceId`.

## Performance

Open Performance beside Logs. When one app is running, CPU and memory monitoring start
automatically. When several apps are running, choose one in Performance settings.
Performance follows the device the user clicks or focuses, and switches to the
remaining device when the iOS/Android visibility toggles hide the active one.
The tab shows the device's name and remembers each device's chosen app. Switching
between iOS and Android stops the previous monitor and starts collection on
the active device. Hiding both device panels
keeps the current source. CPU and memory collection continue while viewing Logs. Closing
the tools panel, pressing Stop, selecting another device, or ending the MCP
session stops the monitor and leaves the app running.
An app restart starts a fresh history when its new process appears.

The tab ports DevSuite's iOS process and thread CPU collector and chart UI, including its orange memory track.
It samples once per second and retains 150 seconds. Expand CPU for individual
thread charts, drag a chart to select a range, and use Follow live to resume the
rolling viewport. Missing readings remain gaps. 100% means one occupied device
CPU core; a process can exceed 100%.

iOS thread labels translate verified native names into readable roles, including
Hermes GC (`hades`) and Network loader (`com.apple.NSURLConnectionLoader`).
Unnamed threads receive stable numbers for the recording; their roles are unknown.
Hover a thread label for its original native name, ID and active/exited state.
Long names wrap onto two lines. The collector and agent readings retain raw names
and IDs; labeling does not add debugger queries or app instrumentation.

The expanded thread list defaults to Activity order: highest current CPU usage
first, with threads that have ever shown activity during the recording above
those with none. Equal readings keep their first-seen order. Choose First seen
in the Sort dropdown to keep rows in their original recording order. The choice
persists when switching tabs or devices, and sorting only affects the UI.

Thread charts use LegendList with stable thread IDs and fixed row heights. Only
rows near the viewport render, using the existing performance scrollbar.
Cursor movement updates the shared cursor position and time label without
rendering charts. Chart bounds update with each sample in the same render.

On iOS, collection uses debugserver from the selected full Xcode installation. The app
needs a development signature with `get-task-allow`, with Xcode/LLDB detached.
On Android, a bundled CPU and memory C helper reads kernel process and thread counters
over one persistent ADB connection. It adapts BAM's MIT-licensed
[Flashlight collector](https://github.com/bamlab/flashlight/tree/5ef203ae184547a3b2984fa4f9b76d672895f861/packages/platforms/android/cpp-profiler).
There are no app hooks, debugger attachment, atrace sessions or root requirements.
The device must allow ADB shell to read app `/proc` counters; a blocked device
reports the access error. Release builds work too. The app picker lists running
user-installed packages and monitors their main process. The helper exits when
the session, ADB connection or target process closes. Binaries for arm64, ARM,
x86 and x86_64 ship with the plugin; users need no compiler or app SDK.
Kernel clock ticks limit Android's CPU resolution, usually to 10 ms of CPU time.
The server verifies and retains all collector binaries in memory at startup.
New CPU sessions deploy from that retained copy, so reconnecting still works if
a plugin update removes the old installed cache. Host staging files are removed
after each deployment. The app-side collector and sampling rate are unchanged.
`node scripts/smoke-cpu-cache.mjs` checks packaged CPU reconnection after deleting
a temporary copy of the plugin cache, using fake ADB without touching a device.

On an arm64 Android emulator with 23 app threads, 20 CPU and memory samples over 19.0 seconds
used 0.046% of one core in the helper (0.460 ms of CPU per sample). This measures
the collector itself, excluding ADB and video streaming; overhead varies with
thread count and device. Reproduce with
`node scripts/smoke-android-cpu.mjs DEVICE_SERIAL RUNNING_PID`.

The Memory track shows the main process's current usage, sampled average, maximum and minimum in MiB. Android reads RSS from `/proc/<pid>/statm` using the device's runtime page size; shared resident pages are counted in full. iOS requests `phys_footprint` in the same debugserver profiling stream, including compressed memory. These are different platform metrics, identified in the track tooltip; their values are not directly comparable across platforms. Memory is available from the first sample, shares CPU's timeline and session, and resets with the app's PID.

JavaScript profiling, detailed allocation debugging, DevSuite's network track and an FPS collector are deferred.

Text agents can monitor CPU and memory without opening the panel. Call
`mobile_performance_sources` with `platform` and `deviceId`, then
`mobile_cpu_session` with a target containing those fields and the chosen
`bundleId`. The result includes `sessionId` and `cpuUri` in both JSON text and
`structuredContent`. Call `mobile_read_cpu` with that `sessionId`; subsequent
reads should pass the last `cursor` as `after` to receive only new samples.
Wait for a full one-second interval before interpreting the initial null
baseline. Each reading includes connection status, total CPU, individual thread usage and `memoryBytes`. The batch’s `memoryMetric` is `rss` on Android or `physical-footprint` on iOS. Finish with `mobile_cpu_close`. The panel uses the same session
result and collector.

## Develop and package

The panel uses React and shadcn/ui with preset `b0`, Nova controls, neutral colors, Inter, and Lucide icons. The build bundles the SVGs and font files into the HTML; the panel needs no external asset requests. Use the preset components in `src/ui/components/ui` for controls, forms, notices, and empty states. Compose the views with Tailwind utilities. `src/ui/style.css` only covers device frames, Codex layout, and base rules; preset tokens live in `src/ui/theme.css`. The log list uses the [Legend List React DOM entrypoint](https://www.legendapp.com/open-source/list/v3/react/getting-started/).

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

The app gets a random stream session through an app-only MCP tool. The MCP server opens a WebSocket to its bundled Baguette, keeps the latest JPEG, and returns it through `resources/read`. The iOS viewer requests 60 FPS, overlaps reads with JPEG decoding, and paints only the newest decoded frame. Frame and decode queues stay bounded; older pending frames are discarded. JPEG bytes are base64-encoded only when a reader requests the latest frame. The app sends input through an app-only tool that checks each message. Frames and input stay inside the host's MCP bridge. The app makes no direct network requests.

The UI resource's CSP has empty connection and resource allowlists. Codex desktop 0.159.0 filters plain HTTP and WebSocket origins out of widget CSP, including loopback addresses. The MCP transport avoids those browser connections. A session expires after five minutes without reads or input. Closing or pausing a viewer closes its upstream capture. Ending the MCP process stops its Baguette child and streams. Simulator devices remain under CoreSimulator's control.

When a socket drops, the server reopens it for the same device and preserves the frame sequence. It clears the old frame and waits for fresh capture before allowing input. If Baguette exits, the next read starts a new bundled process. Heartbeats detect sockets that stop responding. If an open socket produces no first frame within ten seconds, capture retries with a delay. Baguette's MJPEG capture sends only changed pixels, so a quiet screen after the first frame stays connected. Failed attempts wait between 0.5 and 10 seconds. The panel also reconnects after MCP errors or an expired session. Pending paints and late decode results from a reset capture are discarded. It keeps the last frame, shows Reconnecting, and discards input from the failed connection. Closing the panel or selecting another device cancels retries. Capture retries never boot a stopped simulator; the separate confirmed Device Hub repair policy is described below.

An iOS JPEG decode error restarts capture through `mobile_stream_reset` with the same panel session. Reset requests have a one-second cooldown. Three failed frames in a row reopen the panel stream with a delay. Late decode results release their bitmap and cannot draw on a closed panel.

iOS boot and shutdown calls run in order for each device and wait up to two minutes for the reported state. Boot skips the backend route if the device already runs or is booting. This avoids a second boot and Baguette's input repair on a running device. Shutdown closes that device's panel streams after the device stops.

On macOS 27 with Xcode 27, the bundled Baguette can list simulators and capture frames. Device Hub can stop taps, buttons, and keys from reaching an iOS 27 device. Connections await a fresh status check. Gestures use the last completed result while one expired check refreshes in the background, so the approximately 150–200 ms command no longer delays every second of input. A new block becomes visible when that refresh completes. When blocked, it shows a notice. Ask Codex to repair input with `mobile_repair_input`. The tool runs the bundled Baguette's `heal` command. Reconnect capture afterward to use new input handles. It restarts backboardd and SpringBoard without rebooting the device. Relaunching Device Hub can block input again. The panel automatically repairs a confirmed Device Hub block when connecting and reconnects if input becomes blocked later. Repair closes running apps. It limits automatic attempts to once per device per minute; a repeated block or failed repair remains visible in the bottom bar. Model input alone does not trigger automatic repair. Baguette's boot route also repairs input after boot. Do not run the repair to diagnose video. See [Baguette's Device Hub notes](https://github.com/tddworks/baguette/blob/main/docs/features/device-hub/README.md).

UI resource addresses include the release version so Codex can load new HTML after an update. The original simulator and workspace addresses and the old v1 through v6 simulator addresses still return the current UI. After updating, restart Codex once if it still uses an older MCP process.

Performance findings and historical measurements are documented in [the profiling report](docs/stream-profiling.md). Diagnostic timing reports remain available in Console; the simulator uses the upstream UI without temporary timing widgets.

## Tools

| Tool | Action |
| --- | --- |
| `mobile_open_simulator` | Open the native panel and start the bundled backend |
| `mobile_open_workspace` | Open fullscreen with logs on the left and the simulator on the right |
| `mobile_list_simulators` | Start the bundled backend if needed and list devices |
| `mobile_list_ios_devices` | Discover physical iPhones and iPads with USB/Wi-Fi, pairing state, UDID, and CoreDevice ID |
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
| `mobile_logs_keep_alive` | Keep background collection alive without sending logs (app only) |
| `mobile_logs_close` | Stop a session's log readers |
| `mobile_performance_sources` | List running user apps in a booted iOS simulator |
| `mobile_cpu_session` | Connect a native process and thread CPU plus memory monitor |
| `mobile_read_cpu` | Read live CPU and memory samples and connection status |
| `mobile_cpu_close` | Stop one CPU and memory monitor while leaving its app running |

The `agent-device` MCP server exposes the pinned runtime's official tools directly, including `open`, `snapshot`, `press`, `fill`, `type`, `scroll`, `wait`, `find`, `get`, `is`, `close`, and debugging tools. Their input schemas describe each command. The bundled [control skill](skills/agent-device/SKILL.md) explains session ordering and links to the version-matched guide.

## Sources

The implementation follows [Baguette's HTTP and WebSocket routes](https://github.com/tddworks/baguette/blob/v0.2.1/docs/serve.md) and [gesture protocol](https://github.com/tddworks/baguette/blob/v0.2.1/docs/wire.md). The bundled automation server follows [agent-device's official MCP setup](https://github.com/callstack/agent-device#add-mcp-tools-to-your-agent). Native panel metadata follows [OpenAI's plugin extensions](https://developers.openai.com/plugins/build/extensions). The package uses the [portable plugin format](https://developers.openai.com/plugins/build/plugins).

Panels, toolbars, settings areas, and footers use transparent backgrounds so they blend with the host. Add a panel background only when the user asks to highlight that area.

### Live React UI development

Run `npm run dev` after installing the plugin. It watches the UI sources and
rebuilds a self-contained HTML bundle. Open panels read updates through MCP,
then reload and reconnect their streams. Edits reset UI state.

Codex denies browser access to localhost, including trusted HTTPS. Live reload
uses the existing MCP connection and needs no dev server or certificates.
`npm run dev` reuses a watcher already running from this repo.

Restart Codex after installing a new plugin version, then reopen Mobile Dev.
UI and CSS edits reload without another restart. MCP server changes still need
a rebuild and a server restart.

Run `npm run dev:off` and reopen the panel to use the release bundle. A stopped
watcher also makes newly opened panels use that bundle. Build errors keep the
last working UI. Set `MOBILE_DEV_PLUGIN_ROOT` for a nonstandard plugin install.
