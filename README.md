# Mobile Dev for Codex

An iOS and Android simulator panel for Codex desktop. Baguette 0.2.1 provides iOS streaming; serve-emu 0.0.6 and scrcpy 4.0 provide Android streaming. Android needs Bun 1.3.13 or later and an installed Android SDK.

Agent Device is temporarily disabled in 0.1.83 while iterating on inline performance charts. The package registers only the `mobile-dev` MCP server and omits the Agent Device skill. Its implementation and bundled runtime are retained for later reactivation.

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
- Saved CPU and memory runs with interactive charts in chat, linked range selection, thread summaries, and actions to ask about a range or open it in Mobile Dev.
- MCP tools for device lists, boot and shutdown, input, screenshots, and accessibility reads.

## Requirements

The plugin needs Node.js 22.18 or later. iOS needs an Apple Silicon Mac with Xcode 26 or later and an installed simulator runtime. Baguette uses Apple's simulator frameworks. agent-device builds its bundled XCTest runner with Xcode on its first interaction and caches it under `~/.agent-device/apple-runner`. The plugin carries all three runtimes, their npm dependencies, and the Apple runner source. It does not download code at runtime.

Physical iOS discovery requires Xcode 27 or later. It uses the selected Xcode installation's `xcrun devicectl` JSON output and needs no additional native library. Pair the phone with Xcode and enable wireless connectivity there to discover it over Wi-Fi.

The native panel targets Codex desktop, iOS simulators, and Android emulators or attached devices. The active Mobile Dev MCP server also works through stdio in a local MCP client. Use the selected UDID for iOS tools and the selected running serial for Android tools. This plugin does not build the user's app. Codex's permission and confirmation rules still apply to tool calls.

Android logs need `adb` from an installed Android SDK. The reader checks `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `~/Library/Android/sdk`, then PATH. Metro logs need an existing local Metro server and an app with an inspector target. The log tools connect to that server without starting it.

## Install the local build

From this project directory, after packaging:

```sh
codex plugin marketplace add ./release/marketplace
codex plugin add mobile-dev@mobile-dev-local
```

Open a new chat after installing. Open Mobile Dev in the sidebar or call `mobile_open_workspace` for the fullscreen view. Call `mobile_open_simulator` for the panel beside a chat. iOS opens by default. Enable Android from the toolbar to show both panels side by side. Each panel has a device dropdown, Home, App Switcher, and Screenshot. Pick a device in each panel. Use the iOS and Android toggles to show either, both, or neither simulator. Selecting a device boots it if needed, then connects its screen. A selected running device connects automatically. The panel uses Apple’s device bezel and screen mask from the installed DeviceKit assets, with a simple frame as a fallback when assets are unavailable. Use the settings button at the bottom right for appearance, text size, location, and the device frame. iOS also offers contrast; Android offers rotation. The menu shows only settings supported by the bundled backend. Click the screen to type or drag. Closing the panel closes its stream.

Use Select in the simulator toolbar to pause the screen. Hover to outline a component, then click to add a note. React Native development apps can supply runtime elements when accessibility omits a view. Drag to mark a region when neither source exposes it. Saved notes leave numbered blue bubbles. Notes attach text and available element details to your next chat message. The captured screen stays local for editing; annotations never attach screenshots. Click a bubble to edit or remove a note, or use Send to chat to send all notes for that device. If chat is unavailable, the panel keeps the notes and retries when you return. A sent or cleared batch starts again at 1.

`npm run package` writes the local ZIP to `release/mobile-dev-0.1.100-darwin-arm64.zip`. Install through the local marketplace above. The New Plugin archive dialog uploads to the workspace plugin service; it is a separate install route. This package has not gone through public directory review or publication.

The iOS dropdown shows **Connected devices** first, with USB or Wi-Fi labels, then **Simulators**. It refreshes every three seconds while the iOS panel is visible, and when opening the dropdown. Selecting a physical device opens interactive screen mirroring through its paired developer connection. The phone sends HEVC video; a bundled native Node-API addon assembles compressed frames and transfers them into Node without copying the frame payload, then the panel decodes them through WebCodecs. MCP serializes the compressed bytes as base64, so the full path is not zero copy. The capture queue is limited to eight frames or 4 MiB and requests a keyframe after overflow. Physical iOS supports pointer taps, long presses, and drags through CoreDevice UniversalHID on the same developer tunnel. Input starts after a fresh video frame, uses normalized touchscreen coordinates, and releases held touches when the stream closes or resets. Screenshot captures the displayed mirrored frame as a PNG, attaches it to chat, and copies the same image to the macOS clipboard. Select annotates screen regions using the mirrored frame's pixel coordinates; native accessibility component names are unavailable. Both controls require a connected device and a ready video frame. Keyboard and hardware-button controls remain disabled. CPU and memory monitoring can attach to an already running development app on a paired iOS 17.4+ device. Mirroring requires Developer Mode and a host with HEVC WebCodecs support. `mobile_list_ios_devices` also returns remembered disconnected devices with their connection state; the picker shows connected devices only. Discovery errors remain visible while available simulators continue to work.

Physical iOS mirroring uses the same Apple DeviceKit bezel and framebuffer mask as the matching simulator model. Discovery preserves the hardware product type, which selects the installed Xcode device profile. The bundled Baguette CLI renders its bezel without starting a simulator, and macOS rasterizes its mask. These assets are cached per model outside the video path. A missing device profile or failed render reports an error before capture starts.

Ask the agent to inspect or control the app on the selected device. The panel shares both visible device IDs and platforms with the chat. Click a device panel to make it the active device for logs. Hiding a simulator keeps the current log source and buffered logs. Use Mobile Dev's screenshot, accessibility and input tools for the selected platform. Baguette streams iOS and serve-emu streams Android in the panel.

For mobile app development, the bundled skill tells the agent to open the panel beside the chat before the first device launch, or reuse an open panel. It covers iOS, Android, Expo, React Native, and SwiftUI work. The agent follows your device choice, reuses a suitable running device, or chooses and boots an installed simulator or AVD. It asks only when the choice changes what the task needs. The app project's own tools build, install, and launch the app on that device; the agent reuses an existing app dev server.

You can request fullscreen or a tool-only workflow. Planning, docs, code review, and compilation-only requests do not need a panel. Skill matching depends on the prompt and project context; [the workflow cases](docs/agent-workflow.md) cover the expected behavior in fresh chats.

## Android

Install Bun 1.3.13 or later and Android SDK platform-tools and emulator. Create an AVD in Android Studio or connect an Android device and authorize adb access. The Android panel lists devices without booting one. Selecting an AVD boots it if needed, then starts the bundled serve-emu CLI on a private loopback port. Home, Back, Recents, Lock, pointer gestures, and typing use scrcpy's control socket. Closing the panel leaves the emulator running. AVDs start without a separate emulator window. A failed emulator process reports its exit right away instead of waiting for the boot timeout.

The Android dropdown shows **Connected devices** first, with USB or Wi-Fi labels, then **Emulators**. It refreshes every three seconds while the Android panel is visible, and when opening the dropdown. Physical devices use ADB discovery: enable USB debugging and authorize the computer, or pair the device for wireless debugging. Offline and unauthorized devices remain visible with their state. Selecting an authorized phone connects its screen and shares its serial and transport with the chat. Bundled scrcpy mirrors and controls the phone without installing a companion app. Physical Android devices support the existing screen, input, screenshot, native log, and performance tools; emulator boot and stop controls do not apply to them.

Android H.264 packets travel through MCP resource reads. The panel decodes them with WebCodecs, so the host must support H.264 `VideoDecoder`. Each device gets its own backend and each panel gets its own stream session. Decoder errors and video backlog request a fresh keyframe on the same connection. The panel drops delta frames until it can decode that keyframe. Requests have a cooldown, and stale decoder callbacks cannot repaint a closed stream. The plugin reuses a matching serve-emu server at port 3300. Set `SERVE_EMU_URL` to reuse another loopback HTTP server; it must already stream the selected serial. Closing MCP stops only backends the plugin started.

For tool use, call `mobile_list_android_devices`. It returns serials for connected devices and `avd:<name>` IDs for stopped AVDs. Boot a selected AVD with `mobile_boot_android_emulator` and use its returned running serial for later calls. `mobile_shutdown_android_emulator` stops an emulator. `mobile_android_screenshot`, `mobile_android_describe_ui`, and `mobile_android_send_input` inspect and control running devices. Gesture coordinates use screen pixels and matching screen width and height. Use the selected running serial with the Mobile Dev Android tools.

`vendor:serve-emu` installs the pinned npm runtime with package scripts disabled and checks the bundled scrcpy 4.0 server's SHA-256. `build` copies the full runtime and records package integrity, lockfile hash, and scrcpy hash in `dist/serve-emu/release.json`. Starting Android requires no npm install or runtime download.

Click the camera button in either simulator toolbar to add a PNG to the chat input and copy it to the macOS clipboard. Each click adds another screenshot and keeps any attached log. Remove screenshots from the chat input to clear them. The button works while the selected simulator runs, including when the stream is paused. Physical iOS captures the displayed mirrored frame and requires a ready stream. It does not send a message.

## App logs

The fullscreen plugin view has a full-width tool bar above the logs and device panels. Each panel has its own controls. Logs sit on the left and both simulators on the right above 800px; smaller views place both simulators above logs. The Logs tab reopens the logs panel. Click Logs to collapse the left panel to a tab, then click it again to reopen. The panel beside a chat keeps the collapsible drawer below the simulator. Each view has its own UI resource, so the layout does not depend on the host's display-mode flag. Native logs follow the foreground app on the selected device by default. The shared device-app store checks every three seconds and changes the filter when the foreground app or its PID changes. iOS simulator and physical-device logs use the detected PID; Android uses the foreground package. No app launch, restart, or debugger attachment is needed. If discovery fails or reports no foreground app, automatic collection waits instead of opening an all-app stream. In Log sources, disable Follow foreground app to enter an executable name or Android package and press Connect; an empty manual filter includes all device processes. Choosing another Android log device also selects manual filtering.

For Metro, enter its local URL and click Find sources. Select the app and device in Metro app. For Android, choose a connected device in Native source and enter its package name to follow the app across restarts. Native source follows the device selected in the panel. You can also choose another connected Android device for logs. You can read native and Metro logs together. With Follow foreground app enabled, an explicitly chosen Metro target joins the stream only while its app ID matches the foreground app; other targets stay excluded. Metro target selection remains explicit.

JS and Native toggle each source. Info, Warn, Error, and Debug toggle each level.

The search field supports DevSuite-style keyword filters. Plain keywords match log text, stack traces, and metadata; spaces mean AND and quotes keep phrases together. Use `level:error message:network`, `level:error level:warn` (repeated fields mean OR without explicit operators or groups), `age:5m`, `-message:noise`, or `network & (timeout | failed)`. Regex uses `message~:"error.*timeout"`; quote patterns containing spaces or parentheses. Supported fields are `level`, `message`, `age`, `source`, `origin`, `process`, `tag`, `subsystem`, `category`, `stack`, and `timestamp`. Level aliases include `warning`, `err`, and `verbose`; age accepts seconds, minutes, hours, and days (`s`, `m`, `h`, `d`). Age filters refresh once per second while Logs is visible, including when collection is paused. Filtering runs before repeat grouping so counts reflect matching occurrences. Open the help button beside the field for examples. Invalid syntax shows an inline error until corrected.

Stack groups exact repeats by source, level, device, and process and shows the count on the right. Follow keeps the latest rows in view. Scrolling away from the bottom turns Follow off; scrolling back to the bottom turns it on. Pause stops log readers; Resume opens a new session. Closing the drawer also stops its readers. Clear removes the buffered rows while the stream runs.

While Performance is visible, the log view is unmounted and the browser stops
reading, filtering, and rendering log batches. Collection continues in the
plugin's separate Node process, bounded to 2,000 records and 4 MiB per session.
Returning to Logs immediately restores cached rows, filters, selection, and
scroll position, then catches up from the same cursor when the app is unchanged.
If the foreground app changed while Logs was hidden, reopening applies the latest
app filter and clears the previous app's rows before starting its scoped session. A small keep-alive once
per minute retains the session without transferring logs. Closing the tools
panel still stops collection.

Click a row to read its full text and stack trace. Attach to chat adds that log, its source, and its repeat count to the agent's next prompt, along with the selected simulator. Ask the agent to fix the error in your next message. Remove attachment clears the log. Each new attachment replaces the prior log. Removing the attachment in Codex also clears the panel's attachment state.

Right-click a log and choose Fix in chat or Ask in chat to attach the full log and stack trace as a context pill and send a short request. These actions wait for the attachment before sending and keep the log available if delivery fails. Hosts without context pills receive the full log in the message.

iOS simulators use `xcrun simctl spawn <UDID> log stream --style ndjson --level debug`. Physical iPhones use the bundled libimobiledevice OS trace relay reader over the existing paired USB or Wi-Fi connection. Select the phone in the device picker; no app launch, restart, debugger attachment, or app SDK is required. An executable-name filter continues across app PID changes. Unified logs exclude ordinary `print`/`printf` stdout/stderr output and may redact private values. Metro reads console events and exceptions through the inspector. Each log reader retries dropped connections. Metro keeps the chosen target ID; refresh its targets if an app restart assigns a new ID. Buffers hold at most 2,000 records and cap their byte size. Legend List renders the visible rows and lets you scroll through all buffered matches.

`npm run test:logs` reads logs from an already booted simulator through the built MCP server. `npm run test:ios-logs -- --device <hardware-UDID>` reads a connected physical iPhone, with optional `--process <executable-name>`. Both print counts, close the log reader, and leave the device and app running. For tool-only physical logs, pass `{ platform: "ios", kind: "physical", deviceId: "<hardware-UDID>" }` to `mobile_logs_session`; use the `udid` returned by `mobile_list_ios_devices`, rather than its `coreDeviceId`.

## Shared app discovery

`src/ui/device-apps.ts` owns one `DeviceAppsStore` per workspace. Device selection
feeds this store; it polls every three seconds while the panel is visible and the
selected device is connected, including before Performance opens. Consumers share
`subscribe` and `getSnapshot` (also usable with React's `useSyncExternalStore`).
Snapshots contain the selected device, eligible running `apps`, `foregroundApp`,
and `ready`, `discovering`, and `error`. `refresh` coalesces concurrent requests.
Device changes, hidden panels, disconnection, and disposal cancel pending work,
clear foreground state, and ignore late results. A failed query is not a confirmed
absence: consumers should check `ready` before interpreting `foregroundApp: null`.

`src/server/device-apps/` contains platform discovery, exposed through the existing
`mobile_performance_sources` tool. Android reads the top resumed activity from ADB;
iOS simulators read the frontmost accessibility translation's PID without walking
the UI tree; paired iPhones retain their accessibility-audit PID query. Foreground
identity is separate from the eligible monitoring list: an iOS PID outside that
list has `bundleId: null`; an Android package outside it has `pid: null`. No sole
background process is guessed to be foreground. Performance consumes this store
and preserves its chosen recording target across foreground changes.

## Performance

Open Performance beside Logs. CPU and memory monitoring start automatically for
the foreground app when it is eligible for monitoring. Choose another running app
in Performance settings to monitor it explicitly.
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

On iOS simulators, collection uses debugserver from the selected full Xcode installation.
Physical iOS 17.4+ devices use the device debugproxy through the same paired developer
tunnel as Display FPS. The app needs a development signature with `get-task-allow`,
with Xcode/LLDB detached. Physical devices also require pairing, Developer Mode and
a mounted developer disk image. App discovery lists running development apps and
attaches by PID without launching or restarting them. Attach and detach briefly pause
the app; ending monitoring leaves it running.

On physical iOS, the picker automatically selects the currently open development
app when there is no selection yet, even when several development apps are running.
The paired accessibility service identifies the main process owning the current
screen. System apps, extensions and missing screen elements do not select a
background development app. Manual selections and active recordings keep their
chosen target when the foreground app changes. Discovery does not launch an app,
move accessibility focus or attach a debugger.
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

The green **Display FPS** track shares the CPU and memory timeline, cursor, zoom and 150-second history. It records independently of the selected app, with current, average, maximum and minimum FPS. It includes other apps and system UI; a quiet or locked screen can report zero. This measures display updates rather than the panel's refresh rate, and does not identify which app caused a drop. Missing measurements remain gaps.

Android 12+ uses only Perfetto FrameTimeline's presented actual display frames, excluding dropped frames and individual app/layer frames. A bundled external native consumer reads a bounded 4 MiB trace buffer once per second over ADB without creating a trace file, attaching a debugger, requiring root or installing an app SDK. Readback adds roughly three seconds of delay. SurfaceFlinger can report a frame later; the chart updates that frame's original interval. Devices without FrameTimeline and Android versions below 12 report an explicit limitation.

Android FPS intervals also retain `frameTimeline`: its `clock` is `boottime`,
`intervalEndNs` identifies the device interval endpoint, and `frames` contains
each actual display frame's `token`, `startTimeNs`, `endTimeNs`, `presentType`,
and available `onTimeFinish`, `gpuComposition`, `jankType`, `predictionType`, and
`jankSeverityType` metadata. Timestamps are normalized to Android `CLOCK_BOOTTIME`
using Perfetto clock snapshots; timestamps and tokens use decimal strings to
preserve every nanosecond and the full integer identity through JSON.
Presented frames have `presentType` 1 (on-time), 2 (late), or 3 (early).
Dropped (4) and unknown/unspecified frames remain in the detailed data, while
FPS counts only presented frames. Late revisions replace the complete interval
and its frame list. Retention stays bounded to the live history, with an explicit
error above 4096 frames per interval. iOS supplies an aggregate counter and has no
per-frame data.

Physical iOS 17.4+ devices use the global Instruments `CoreAnimationFramesPerSecond` counter through a bundled native helper and the paired developer connection over USB or Wi-Fi. Developer Mode is required. There is no Instruments GUI, Python installation, app SDK or LLDB attachment. iOS simulators do not support this FPS collector. CPU and memory are available on iOS simulators, paired iOS 17.4+ devices with a running development app, and connected Android devices.

Text agents can call `mobile_display_fps_session` with `platform` and `deviceId`, read `mobile_read_display_fps` or the returned `fpsUri`, then finish with `mobile_display_fps_close`. FPS sample times use the server's monotonic clock in seconds; the session returns `timeOrigin`. CPU batches expose their own `timeOrigin` so consumers can align app-relative CPU times with device FPS. FPS sessions expire after five minutes without reads and release their tracing connection on shutdown or device switching.

JavaScript profiling, detailed allocation debugging and DevSuite's network track are deferred.

Text agents can monitor CPU and memory without opening the panel. Call
`mobile_performance_sources` with `platform` and `deviceId`, then
`mobile_cpu_session` with a target containing those fields and the chosen
`bundleId`. For physical iOS, include `kind: "physical"` in both requests and use
the hardware `udid` from `mobile_list_ios_devices`. The result includes `sessionId` and `cpuUri` in both JSON text and
`structuredContent`. Call `mobile_read_cpu` with that `sessionId`; subsequent
reads should pass the last `cursor` as `after` to receive only new samples.
Wait for a full one-second interval before interpreting the initial null
baseline. Each reading includes connection status, total CPU, individual thread usage and `memoryBytes`. The batch’s `memoryMetric` is `rss` on Android or `physical-footprint` on iOS. Finish with `mobile_cpu_close`. The panel uses the same session
result and collector.

`npm run test:ios-cpu -- --device <hardware-UDID> --bundle <bundle-id>` checks an
already running development app through the built MCP server, then detaches and
verifies its PID stayed unchanged. Add `--with-fps` to check concurrent Display FPS.
It does not launch or restart the app.

## GitHub releases

The `Release plugin` workflow in `.github/workflows/release.yml` runs when you push
an existing commit with a `v<version>` tag. The tag must match `plugin.json`,
`package.json`, both root versions in `package-lock.json`, and
`src/shared/version.ts`. After committing your changes, run from the repository root:

```sh
npm run public-release
```

This command checks that the working tree is clean and the release versions agree,
creates `v<version>` at the current commit, and pushes that tag to `origin`. It
uses the current plugin version (for example, `v0.1.100`) without bumping it.
Existing tags are preserved. If the push fails after tag creation, the command
prints the exact Git command to retry the push.

You can also run the workflow from GitHub Actions with an existing version tag.
The workflow checks out that tag, uses the Apple Silicon `xcode-27` runner and
Xcode 27 / Swift 6.4, installs the locked JavaScript runtimes, and rebuilds every
native helper with Android NDK 27.2.12479018 and Rust 1.98.1. It runs the tests,
builds and packages with the explicit `release` environment, then smoke-tests a
fresh extraction of the actual ZIP.

Configure the repository's Actions secrets `SENTRY_AUTH_TOKEN` and `SENTRY_ORG`.
Both are required. The workflow uploads matching UI/server source maps and native
symbols to the existing three Sentry projects before saving the artifact and
creating a draft GitHub release. Upload failures stop the release. Credentials
and debug artifacts stay outside the plugin ZIP.

Download `mobile-dev-<version>-darwin-arm64.zip` directly from the draft release's
assets for manual store upload. The same ZIP is also retained as an Actions
artifact for 30 days; extract the Actions artifact wrapper before uploading the
plugin ZIP. Creating a draft release does not submit or publish it to the OpenAI
plugin directory. A tag that already has a GitHub release will fail release
creation rather than replace existing assets; download the ZIP from the completed
build job or use a new version for a new release.

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
npm run check:mcp-budget
```

`vendor:baguette` downloads the pinned official release and checks its SHA-256. It keeps the full resource bundle and rebuilds the same v0.2.1 source with Swift 6.4 or later because the official binary crashes in Swift task allocation on macOS 27. Preparing Baguette requires Xcode 27, Git, and network access to fetch its pinned source and Swift dependencies. `rebuild:baguette` repeats the source build. `vendor/baguette/release.json` records the source commit, compiler version, and rebuilt binary SHA-256.

`vendor:agent-device` installs the exact npm packages in `runtimes/agent-device/package-lock.json` with package scripts disabled. `build` copies this full runtime into `dist/agent-device`, records its integrity and lockfile hash in `release.json`, and saves its version-matched help in the control skill. The installed plugin needs no npm install or runtime download. Xcode compiles the shipped Apple runner source on its first use.

`build` also bundles JavaScript and CSS with esbuild and copies Baguette into `dist/baguette`. It does not run TypeScript, lint, Biome, visual checks, or React Doctor.

`package` copies built files into `release/marketplace/plugins/mobile-dev` and creates the ZIP. It includes agent-device's runtime `node_modules`, licenses, and Apple runner source. It does not need this development checkout or a global agent-device install to run. The source repo's existing build-codex-native-plugins skill stays outside that release package.

`test` checks MCP contracts, frame reads, input validation, and capture cleanup against a local fixture. `test:package` copies the release package into a temporary directory, starts its bundled Baguette, reads the real device list, and checks shutdown. It does not boot or change a simulator. Run it on an Apple Silicon Mac with Xcode.

`test:agent-device` requires reactivating the Agent Device MCP entry first. It starts the retained MCP server from a copied package with no global CLI on its PATH. It checks the control tools, pinned runtime, isolated state directory, real iOS device list, and daemon cleanup. It does not open an app, take screenshots, or send input.

`npm run test:reconnect -- <UDID>` tests an already booted simulator with a copied package. It terminates only that test package's own Baguette process and checks that the same stream resumes with a new bundled process. It never boots a simulator, repairs input, or sends gestures.

The host installs a cache copy. After changing source, rebuild and package, then run `codex plugin add mobile-dev@mobile-dev-local` to update it. Reopen Mobile Dev from a new chat to load the new copy.

## Runtime

Each MCP process owns one bundled Baguette child process. It selects a free loopback port, launches `dist/baguette/Baguette serve --host 127.0.0.1 --port <port> --no-plugins`, and shares that child across its tool calls and panel sessions. It does not use a separate Baguette server on port 8421. An opening failure returns an error the panel can show.

The retained, currently inactive Agent Device entry point is `dist/agent-device-server.mjs`, which launches the official bundled `agent-device mcp` with Node through an SDK adapter. The adapter publishes all 55 operations, preserves their typed command arguments and output contracts, and validates inputs before forwarding them. State paths, remote daemon credentials, runner configuration and output-format settings belong to the plugin and are absent from tool inputs. Batch steps use the same compact contracts. Device selectors remain on setup, discovery, installation and script tools; interactions require a named session and reuse the upstream runtime's device binding. There is no global platform override. File operations retain `cwd` where it is relevant.

The wrapper uses an explicit empty package config and a private temporary state directory. Default platform and form selectors would bypass the native session's device binding, so those are set only through device setup commands. It clears inherited agent-device settings so a global or cloud daemon cannot take over this connection. Commands start its local daemon as needed. On MCP shutdown, the wrapper runs the bundled `daemon stop --state-dir <own-directory> --clean` command, which checks the daemon's PID identity and releases its runner leases. It keeps logs and artifacts in that state directory for later reads. Call agent-device `session` with `action: "state-dir"` to find it.

`npm run check:mcp-budget` reads the packaged servers' catalogs and estimates their model-visible specifications, including repeated namespace instructions and plugin attribution, before the host applies lossy schema compaction. With Agent Device deactivated, the current estimate is 45,315 bytes for 38 model-visible tools, below [Codex's shared 64,000-byte plugin budget](https://github.com/openai/codex/blob/main/codex-rs/core/src/mcp_tool_exposure.rs). The schema cleanup in 0.1.68 reduced the combined catalog from 238,784 to 99,568 bytes; temporarily removing its Agent Device entry makes room for the recording tools. Other enabled plugins also consume the shared budget. Splitting the same tools into more enabled MCP servers does not avoid it.

Use the panel's UDID and a named agent-device session for agent work. Refs belong to the latest snapshot or settled diff in that session. `press` and `fill` take a target such as `{ "kind": "ref", "ref": "@e12" }` or `{ "kind": "selector", "selector": "label=\"Search\"" }`. Use actual refs from the current result. Closing a session can close its app; leave `shutdown` unset to keep the simulator running. Another live agent-device daemon can own a runner lease. End that owner's work or choose another simulator instead of releasing its live claim.

The app gets a random stream session through an app-only MCP tool. The MCP server opens a WebSocket to its bundled Baguette, keeps the latest JPEG, and returns it through `resources/read`. The iOS viewer requests 60 FPS, overlaps reads with JPEG decoding, and paints only the newest decoded frame. Frame and decode queues stay bounded; older pending frames are discarded. JPEG bytes are base64-encoded only when a reader requests the latest frame. The app sends input through an app-only tool that checks each message. Frames and input stay inside the host's MCP bridge. The UI sends telemetry to Sentry's configured ingestion origin.

The UI resource's CSP permits connections only to `https://o4512180958068736.ingest.de.sentry.io`; its resource allowlist is empty. Codex desktop 0.159.0 filters plain HTTP and WebSocket origins out of widget CSP, including loopback addresses. The MCP transport avoids those browser connections. A session expires after five minutes without reads or input. Closing or pausing a viewer closes its upstream capture. Ending the MCP process stops its Baguette child and streams. Simulator devices remain under CoreSimulator's control.

When a socket drops, the server reopens it for the same device and preserves the frame sequence. It clears the old frame and waits for fresh capture before allowing input. If Baguette exits, the next read starts a new bundled process. Heartbeats detect sockets that stop responding. If an open socket produces no first frame within ten seconds, capture retries with a delay. Baguette's MJPEG capture sends only changed pixels, so a quiet screen after the first frame stays connected. Failed attempts wait between 0.5 and 10 seconds. The panel also reconnects after MCP errors or an expired session. Pending paints and late decode results from a reset capture are discarded. It keeps the last frame, shows Reconnecting, and discards input from the failed connection. Closing the panel or selecting another device cancels retries. Capture retries never boot a stopped simulator; the separate confirmed Device Hub repair policy is described below.

An iOS JPEG decode error restarts capture through `mobile_stream_reset` with the same panel session. Reset requests have a one-second cooldown. Three failed frames in a row reopen the panel stream with a delay. Late decode results release their bitmap and cannot draw on a closed panel.

iOS boot and shutdown calls run in order for each device and wait up to two minutes for the reported state. Boot skips the backend route if the device already runs or is booting. This avoids a second boot and Baguette's input repair on a running device. Shutdown closes that device's panel streams after the device stops.

On macOS 27 with Xcode 27, the bundled Baguette can list simulators and capture frames. Device Hub can stop taps, buttons, and keys from reaching an iOS 27 device. Connections await a fresh status check. Gestures use the last completed result while one expired check refreshes in the background, so the approximately 150–200 ms command no longer delays every second of input. A new block becomes visible when that refresh completes. When blocked, it shows a notice. Ask Codex to repair input with `mobile_repair_input`. The tool runs the bundled Baguette's `heal` command. Reconnect capture afterward to use new input handles. It restarts backboardd and SpringBoard without rebooting the device. Relaunching Device Hub can block input again. The panel automatically repairs a confirmed Device Hub block when connecting and reconnects if input becomes blocked later. Repair closes running apps. It limits automatic attempts to once per device per minute; a repeated block or failed repair remains visible in the bottom bar. Model input alone does not trigger automatic repair. Baguette's boot route also repairs input after boot. Do not run the repair to diagnose video. See [Baguette's Device Hub notes](https://github.com/tddworks/baguette/blob/main/docs/features/device-hub/README.md).

UI resource addresses include the release version so Codex can load new HTML after an update. The original simulator and workspace addresses and the old v1 through v6 simulator addresses still return the current UI. After updating, restart Codex once if it still uses an older MCP process.

Performance findings and historical measurements are documented in [the profiling report](docs/stream-profiling.md). Diagnostic timing reports remain available in Console; the simulator uses the upstream UI without temporary timing widgets.

### Saved recordings in chat

For a request such as “Record CPU and memory for 30 seconds while I scroll checkout”,
call `mobile_record_performance` with the running app's `target`, a descriptive
`title`, and `durationSeconds` (default 30, maximum 300). This returns immediately.
Read `mobile_read_performance_recording` with `recording.id` until its status is
`recording` before asking the user to perform the interaction. Collection starts
its duration clock when the collectors are ready, continues without an open panel,
stops automatically, and detaches the CPU and FPS collectors. Every timed run
attempts CPU, memory, and device-wide Display FPS together, even for a request
about only one metric. Stop existing CPU and FPS monitors before recording a run.
FPS requires Android 12+ or physical iOS 17.4+; iOS simulators cannot collect it.
Unsupported or failed FPS does not discard the CPU/memory recording. Only metrics
with recorded readings appear in the charts and summaries. A `finishing` phase
waits up to five seconds on Android or 1.5 seconds on iOS for delayed FPS readback,
including revisions to earlier intervals, before saving. All samples share the
CPU collector's monotonic timeline origin.

Call `mobile_render_performance_recording` with that recording ID to display a
compact MCP Apps chart card. Its UI resource prefers inline presentation; final
placement depends on the host's MCP Apps support. Charts wait 550 ms when first
shown, then draw along the measured curve over 700 ms with the fill following,
honoring reduced motion preferences. Purple change highlights wait another 250 ms
after drawing finishes, then fade in over 150 ms. Selecting a
range ends the reveal; later updates do not replay it. Active cards refresh once
per second while visible. Purple shading marks the regions with the most rapid
changes in each chart independently, without selecting or zooming the recording. Density
is absolute variation per second in a rolling window of 10% of the recording
duration (1–10 seconds); changing intervals within 80% of the highest density are
highlighted. Flat or uniformly changing series have no distinct highlights, and
missing readings and large delivery gaps are excluded. These regions describe
changes, not their cause or absolute CPU/memory/FPS levels.
Drag across any chart to select the same interval on CPU, memory, and FPS; click
a chart to clear the selection. The selected thread list shows average
CPU weighted by measured interval overlap. CPU and FPS chart readings span their measured
intervals, so the first complete interval begins at zero; missing readings remain
gaps. Memory labels, tooltips and changes use whole MiB, while saved samples retain
their original byte precision.
CPU can exceed 100%, because 100% represents one occupied core. Memory is RSS on
Android and physical footprint on iOS, so cross-platform values are not equivalent.
Display FPS measures the whole device and cannot attribute a slowdown to one app.
FPS range averages weight measured interval overlap; zero is valid, and missing
readings remain gaps.

Android recordings save the exact display frames in each FPS interval's
`frameTimeline`, retaining only frames ending within the recorded run. The
one-second chart remains an overview. After a run finishes or fails, use
`mobile_read_performance_frames` with `recordingId`, an optional `range`, and
`limit` (default 200, maximum 1000) for a detailed page; pass `nextCursor` as
`after` with the same range to continue. Ranges include their start and exclude
their end. `available=false` identifies iOS and older recordings without frame
data; an idle captured interval has an empty frame list and `available=true`.
Failed runs can expose their captured partial frames.

Android reports expose the same `frameStats` calculation in
`mobile_read_performance_recording`'s summary, every frame-read page, and the existing
interactive chart card. Statistics cover the whole requested range, independent of
the current frame page. The card shows jank rate, P95 frame interval and dropped
frames beside CPU/memory/FPS, with classification coverage and P50/P95/P99 in the
range breakdown. Profiling instructions require rendering the card when reporting
scrolling FPS/jank, including comparisons with the original implementation.

`jankRatePercent` is janky presented frames divided by classified presented frames,
times 100. On-time, late and early presentations (`presentType` 1/2/3) are eligible;
a known non-`NONE` FrameTimeline jank bit counts once, including buffer stuffing.
Missing, unspecified (0), `UNKNOWN` (256) or future bits are unclassified, including
when mixed with known reasons. `classificationCoveragePercent` reports classified
frames divided by all presented frames. Dropped frames (`presentType` 4) have a
separate count and rate over presented plus dropped frames; unknown presentation
has its own count. Rates are null without an eligible denominator. `frameStats` is
null without per-frame capture, including iOS and older recordings. A low reported
rate with incomplete classification coverage cannot establish a smooth run.
These statistics describe compositor classifications, including states that may
increase latency without an obvious hitch; they are not Android Vitals app metrics.

For presented frames, differences between successive `endTimeNs` values give
exact display pacing, and `endTimeNs - startTimeNs` measures SurfaceFlinger's
work through display presentation. Pacing percentiles use nearest rank over positive
intervals between presented frames within the selected range, in milliseconds.
Dropped frames are skipped while retaining the gap between presentations; unknown
presentation and missing capture intervals break continuity. Captured idle
intervals preserve continuity. `jankType` retains the
[FrameTimeline bitmask](https://android.googlesource.com/platform/external/perfetto/+/refs/heads/main/protos/perfetto/trace/android/frame_timeline_event.proto).
Each frame page also includes `time` in seconds from recording start, aligned
through the collector's host readback anchor. Device timestamps and their
differences retain nanosecond precision; alignment to the CPU timeline includes
host/device transport uncertainty. These are device-wide compositor frames;
the recording does not capture individual app/layer FrameTimeline tracks.

**Ask about this range** sends a user message containing the recording ID and exact
interval. The agent retrieves the original samples to answer. **Open in Mobile Dev**
sends a request to call `mobile_open_performance_recording`, which opens the saved
run and selection in the workspace's Performance panel. Both buttons require the
host's text-message capability. Opening a saved run does not start a collector.
`mobile_finish_performance_recording` stops and saves a run early;
`mobile_list_performance_recordings` finds recent saved or active runs.

Use `mobile_compare_performance_recordings` with `recordingIds` containing 2–6
distinct finished or failed runs to show an inline comparison card. An optional
`title` names the comparison and `range` selects a shared interval in seconds.
Runs align at recording start without stretching their timelines. CPU, memory,
and device-wide FPS overlay with a consistent color per run; toggle run labels
to hide curves. Hover values use the same elapsed time across sampling cadences.
Missing readings remain gaps and shorter runs stop at their own duration.
Android RSS and iOS physical footprint use separate memory tracks.

Drag any comparison chart to select the same time range across all tracks. The
table shows per-run CPU, memory change, FPS, jank and frame pacing summaries,
clipped to each run's duration; selections beyond a run show **Outside run**.
Whole-run averages may cover different durations. **Ask about this comparison**
or **Ask about this range** sends all original recording IDs and the shared
selection to chat. Finish active recordings before comparing; failed runs retain
their available samples and are labeled as partial. For meaningful before/after
results, repeat the same interaction on the same device and app configuration.

Completed and failed runs retain their original process, memory, FPS, Android display frames, and thread samples
in private JSON files under `~/Library/Application Support/mobile-dev/recordings`.
They survive plugin restarts and live-session expiry. Graceful server shutdown saves
an interrupted run as failed; a forcibly killed process can lose an unfinished run.
Saved runs are not automatically deleted. Recording samples, device IDs, app IDs,
titles, display frame timestamps/tokens/jank data, and selected ranges are not sent to Sentry.

## Screen annotations

Send to chat shows only "Apply these annotations." Edit guidance stays in assistant-only context once per batch. Notes carry the full instruction, selected node, bounds, click point, screen units, creation site when available, React key and up to four nearby React owners. They distinguish a selected element's source from an enclosing owner's source, which serves only as a search hint. Up to four real ancestors, siblings and direct children describe the selection's boundary; parent and sibling records stay outside it. Repeated elements include the selected instance's position among visible matches. Notes never infer parents or siblings from overlapping bounds. The guidance limits edits to the selected instance and tells the agent to preserve its container and siblings when removing a child. Nearby text is deduplicated and limited to three entries of 160 characters. The model receives each note once; full capture records stay local.

Screen annotations use the device's accessibility tree for native and React Native apps. Click an exposed element to add a note. Clicks and manual regions work while inspection loads; an open point note adopts the real element when its bounds arrive. If runtime inspection fails, the panel retries the native accessibility tool. The note popup can select an enclosing element when the tree includes one; flat Android snapshots offer elements whose reported bounds contain the selection. Drag to mark a region when the app does not expose a view. Region annotations carry user-selected bounds, not inferred component names. React Native development apps can also supply runtime component names and measured native bounds through the MCP server. The panel makes no browser connection to Metro. The server uses an existing Metro server at `http://127.0.0.1:8081`, requires a unique device/app match and support for multiple debuggers, and closes its connection after each snapshot. It does not start Metro or take over another debugger. The `mobile_inspect_ui` tool accepts `metroUrl` and `targetId` for explicit targets.

The React Native adapter reads the DevTools hook to locate mounted components, then uses the documented native element `getBoundingClientRect()` API. Native screen containers with empty DOM bounds fall back to `measureInWindow()` callbacks through a temporary CDP binding. The server removes that binding and its global function before closing the connection. Logical component bounds cover their measured native children.

Traversal uses a work queue so deeply nested navigator wrappers do not cut off visible rows. Native-stack screens marked inactive through `activityState` and `aria-hidden` are excluded, along with disconnected native elements. Decorative elements marked only `aria-hidden` remain selectable. Text labels use string children when available, and text outlines follow the component's layout bounds.

The hook is a version-sensitive interface; unsupported renderers, missing targets, timeouts and reloads fall back to accessibility selection and manual regions. Older renderers without the native element APIs cannot provide runtime selection. Snapshots stop at 3,000 named components, 10,000 visited fibers and 1,000 native measurements. A truncated snapshot reports remaining work or missed measurements. The debugger and MCP responses both use flat records with parent links. The plugin does not derive elements from screenshot colors.

The MCP server returns a flat element list with `nodeId`, `parentId` and `depth` fields. Parent links preserve enclosing-element selection without nesting the response through every React wrapper. This keeps JSON depth below host decoder limits; sending a deep runtime tree as structured content can cause a host to discard the response and wait until timeout. Native accessibility results use the same flat format.

Annotations send text only. Each note includes the user request, element label, test ID when present, React component and owner names when available, and nearby text. React debug creation stacks resolve through one bounded request to the matching Metro server's `/symbolicate` endpoint. Source maps supply an app file, line, column and function so the agent can open the element's JSX directly. This is the element creation site, not necessarily the component definition. Library frames and unresolved bundle locations never become edit locations. Missing source maps leave selection working and mark the source location unavailable. Coordinates remain a fallback. The paused image stays local for editing; use Screenshot separately to attach an image.

## Native device requests

When a mobile task has ambiguous targets, `mobile_choose_devices` asks the user
through Codex's native inline request form. The agent discovers suitable devices
first, then supplies their IDs, platform and kind, a task-specific question, and
optional operation details. The form shows canonical device names, platform/type,
runtime, optional verified app labels, and platform phone illustrations. Use
`selectionMode: "multiple"` to let the user choose several devices. No device is
preselected.

The tool waits for an answer and returns `action` and selected `devices`, checking
their availability both before opening the form and after acceptance. Cancellation
or decline returns no selection. Device selection does not boot devices, launch
apps, open streams or start recordings. Stopped simulators/AVDs can be offered for
build tasks; profiling candidates should already be running. Physical iOS uses
the hardware UDID and requires a connected paired device.

This local MCP connection uses the OpenAI Extensions SDK's native form elicitation.
The host must advertise `extensions["openai/elicitation"].form`; unsupported hosts
return an explicit error. Codex owns layout and button labels, so the native form
does not reproduce custom footer buttons from a design mockup. Thumbnails are
illustrations, not captured app screens.

## Sentry

Since 0.1.94, shared selected-device discovery retains the frequent-tool trace
exclusion and handled server-error coverage, now under `device_apps.discover`.
`ui.device_apps.discovery` measures the discovery round trip in milliseconds with
bounded aggregate windows; `ui.device_apps.discovery_failure` counts current-query
failures. Queries cancelled by selection or visibility changes do not report
measurements. Results crossing a surface or telemetry-context change are excluded
so their duration is not attributed to the next surface or device. No bundle IDs,
PIDs, device IDs, app lists, or query output are sent. Existing CPU batch-processing
coverage and native Baguette crash/resource telemetry are preserved.

Saved chart cards use the `recording` surface and view. Existing readiness,
interaction and frame-pacing coverage is preserved. `ui.recording.process` and
`ui.recording.derive` measure result validation and chart/summary processing;
`ui.recording.change_density` measures highlight calculation on sample updates
and is cached across range selection changes;
`ui.recording.reveal` measures completed entrance drawing in milliseconds,
using the existing bounded timing windows. Since 0.1.84, the line traces its
measured curve with the fill following it. Since 0.1.85, the entrance pause is
550 ms and change highlights fade in after drawing finishes. The intentional
pause and highlight fade are excluded from the reveal timing;
`ui.recording.message_ack` ends when the host acknowledges a button's message.
`ui.recording.samples` counts samples held by the visible card, and bounded event
counts record range selections and Ask/Open actions. `storage.bytes` with
`kind: recordings` measures local saved-file storage. Recording polling is excluded
from trace sampling, and hidden cards stop polling. None of these measurements
contains device CPU/memory values, recording IDs, titles or selected intervals.

Comparison cards use the `comparison` surface and view, preserving shared
readiness, interaction, browser frame pacing and teardown coverage. Bounded
`ui.comparison.process` measures result validation, `ui.comparison.derive` covers
overlay series and whole-run summaries, and `ui.comparison.summary` covers shared
selection summaries. `ui.comparison.commit` measures the card render through its
DOM commit in milliseconds; it does not measure paint or device rendering.
`ui.comparison.message_ack` ends at host acknowledgement. Numeric gauges count
runs, CPU/memory samples, FPS samples, retained display frames and overlay rows.
Counters record range selection, run toggles and Ask actions. No recording IDs,
titles, selections or device measurements enter this telemetry. The comparison
MCP operation retains the existing sampled server trace and handled-error path.

`ui.annotations.tree_processing` measures local element processing in milliseconds, including React Native nodes when available. Since 0.1.66, normal inspection validates flat records here; server-side tree flattening falls within `ui.annotations.inspection`, which measures the MCP inspection round trip, including native accessibility and optional Metro work. `ui.annotations.runtime_available` counts snapshots with runtime elements. `ui.annotations.inspection_fallback` counts native-tool retries. `ui.annotations.inspection_truncated` counts snapshots that reach the collector's work or measurement limits. Inspection timing includes failed calls and retries. It uses the current simulator surface and the same bounded timing windows as other UI measurements. Tree contents and selected regions are not sent to Sentry.

Since 0.1.69, inspection timing also includes the bounded Metro source-map lookup. `ui.annotations.source_available` counts snapshots with at least one resolved source location; `ui.annotations.message_build` measures text construction for Send to chat. Source-map transport failures use the existing server error handler with a fixed message. Source paths, component names, creation stacks, note text and images are never sent to Sentry.

`ui.annotations.selection_context` measures the bounded hierarchy and instance lookup for a selection. `ui.annotations.context_build` measures annotation text construction for composer attachments. Both use milliseconds and the active simulator surface. These timings contain no selected nodes, React keys, labels, bounds or source paths.

`ui.annotations.send` measures the host send round trip, including composer retries. Outcome counters distinguish success, a missing composer, timeout and other failures. Unexpected send failures use a fixed error message. No message content goes to Sentry. A timeout keeps notes for a manual retry; it never triggers an automatic resend, since delivery may have succeeded without acknowledgement.

Since 0.1.99, `ui.logs.foreground_change` counts automatic app-filter changes applied while Logs is active, including selected-device and process-lifetime changes. Hidden or closed log views defer row processing until reopened. Shared `ui.device_apps.discovery` timing and handled discovery-error coverage remain in place; native session operations retain MCP tracing and runtime coverage. No app IDs, PIDs, package names, or device IDs are attached to these measurements. Physical iOS PID filtering happens in Node before buffering, so native helper telemetry and symbols are unchanged.

Since 0.1.98, `ui.logs.query_parse` measures query compilation in milliseconds once per edit. Existing `ui.logs.filter`, buffered/filtered row gauges, and search counts cover keyword filtering and visible age refreshes; filtering time still covers snapshot derivation and grouping. Query text, field values, regex patterns, and validation messages remain local. Age refresh timers stop when Logs closes, unmounts, or the document becomes hidden.

`ui.logs.send` measures log attachment and chat delivery in milliseconds, including queued context writes and composer retries. The existing log send counter and error coverage remain in place. No log text, stack traces or device IDs go to Sentry.

The React UI reports to `codex-mobile-dev-ui` (project `4512181027471440`). The main Node MCP server and the agent-device launcher report to `codex-mobile-dev-server`, distinguished by the `component` attribute. Native helpers report to `codex-mobile-dev-native`: Baguette, physical iOS mirroring, iOS FPS and logs, and Android CPU and FPS collectors. All three projects use release `mobile-dev@<plugin version>`.

The environments are `development` and `release`. `npm run build` and `npm run package` default to `development`, including local installed packages. For a public release, run `npm run build:release` followed by `npm run package:release`. Packaging rejects a build from the other environment. The package stores its environment in `dist/telemetry-environment.json`; Node telemetry, native helpers and the served UI use that setting. Live reload does not determine the environment. Set `MOBILE_DEV_ENVIRONMENT=development` or `MOBILE_DEV_ENVIRONMENT=release` in the MCP launch environment to override explicitly, then restart the MCP processes and reopen the panel.

Unhandled JavaScript errors and rejected promises, React render errors, and handled MCP tool failures produce issues. Expected stopped-device errors and cancelled operations are excluded. Sentry traces 10% of ordinary tool actions, continuing the UI trace through the MCP bridge. Frame reads, polling, discovery and pointer input are excluded from trace sampling. The SDK does not record MCP arguments or results.

Native device requests retain the ordinary sampled MCP trace. `device_picker.prepare`
measures candidate discovery/validation in milliseconds, excluding time spent waiting
for the user. `device_picker.result` counts accept, cancel, decline, unsupported and
failed outcomes; `device_picker.selected` records only the number of selected devices.
Attributes contain only the selection mode and outcome. Unexpected handled failures
use fixed messages. Device IDs/names, app labels, questions, operation details and
thumbnails are never sent to Sentry. The form is rendered by the host, so plugin UI
readiness/render timing cannot measure that surface.

Physical iOS display rejections, including an active phone or VoIP call, appear in the panel's Screen unavailable state while it retries. These expected device responses preserve native connection timing, sampled MCP traces and `ui.action.result` outcomes on the simulator surface. Their localized descriptions remain local and do not produce separate Sentry issues.

Agent Device telemetry is inactive while its MCP entry is disabled; the active Mobile Dev server and recording UI retain their existing coverage. When enabled, the Agent Device adapter measures ordinary `tools/call <command>` operations with sampled traces and continues incoming trace metadata through to the native MCP request. Discovery and session lookup are excluded from sampling. `agent_device.catalog.ready` measures catalog loading and validator compilation in milliseconds at startup. Handled native failures use static error messages so app content and tool payloads cannot enter telemetry. Node runtime and owned-storage measurements retain the `agent-device-wrapper` component. Unexpected backend disconnects replace the raw launcher's exit-code/signal report, since the SDK owns the child process lifecycle.

| Measurement | Collection and interpretation |
| --- | --- |
| Node CPU and memory | Sentry runtime metrics every 30 seconds: process CPU utilization, RSS, heap, external memory and array buffers. Each Node launcher is measured separately; the agent-device daemon is outside this coverage. |
| Native resources | `native.cpu.utilization`, `native.memory.rss` and `native.process.uptime`, sampled every 30 seconds and at startup/shutdown. CPU is a ratio where 1 is one fully occupied core. The iOS mirroring addon shares the Node process, so its resource measurements overlap Node's rather than representing another process. |
| Native operations | Bounded timing windows for connection, physical iOS input acknowledgement and video packet processing, iOS log processing, Android CPU sampling, and FPS read/processing. Filter by `component`, `runtime_platform` and `surface` to identify the responsible helper. Baguette currently records resources and crashes. |
| Node responsiveness | Automatic event-loop delay, utilization and process uptime. |
| UI responsiveness | Browser tracing captures available web vitals. Custom metrics record visible animation-frame intervals, intervals over 50 ms, Event Timing interaction durations, long tasks and long animation frames where supported. |
| Product surfaces | Metrics carry `surface=simulator`, `logs`, `performance`, `recording` or `comparison`, plus view, visible device layout and monitoring state. Log filter time, buffered/filtered rows, performance batch processing, canvas draw time and time to first video frame help explain slow surfaces. |
| Frame capture | `ui.screenshot.capture` measures synchronous canvas PNG encoding and base64 extraction in milliseconds for Select captures and physical iOS screenshots. Screenshot tools retain sampled MCP traces and report handled capture, attachment, and clipboard failures without image content. |
| Storage | Every five minutes, the agent-device launcher measures its own session state directory and the shared Apple runner cache in bytes. It skips symlinks and sends only the storage kind and size. |
| Usage | Surface views and visible time, tool action outcomes, log searches, attachments and send-to-chat actions are counted without their content. |

UI timings are aggregated into bounded 30-second windows with `.samples`, `.mean`, `.p95` and `.max`; windows also close on a surface or context change. The p95 uses a reservoir of up to 256 observations and describes that window, rather than the percentile of all measurements across users. Filter by environment, release, surface and layout to compare like workloads. `ui.frame_interval` measures browser callback pacing, not actual rendered FPS. Event Timing measures interaction duration through the next paint; `ui.device_input.round_trip` measures the device input request through its MCP acknowledgement. Neither measures device touch-to-photon latency. `ui.interaction.supported` identifies whether the browser supports that API. Codex's embedded UI does not expose reliable renderer CPU, total memory or disk measurements. Since 0.1.80, recording processing, derivation, change-density, and reveal timings include the FPS track when present. `ui.recording.fps_samples` gauges the count of saved FPS intervals, never their measured values. Since 0.1.86, `ui.recording.process` also covers parsing retained Android display frames, and `ui.recording.display_frames` gauges their count on the recording surface. Since 0.1.87, `ui.recording.derive` also includes jank classification and presentation-interval statistics. Whole-run derivation runs when recording data changes; selected-range recomputation is measured separately under the same timing name, without repeating full-run processing during a drag. Device CPU/memory/FPS and frame timestamps, tokens, jank metadata, and derived device jank/pacing values remain local and are not forwarded to Sentry. No per-frame telemetry is emitted.

Native helpers use the pinned Sentry Native 0.17.1 in-process crash backend. It captures fatal signals with stack addresses and module debug IDs; the Rust wrapper also reports task panics with a static message and source location. Crash reports are retained in a private cache and sent on the helper's next start. Host caches live under `~/Library/Caches/mobile-dev/sentry`; Android caches live under `/data/local/tmp/mobile-dev-sentry`. Android collectors relay envelopes through ADB stderr to the Node transport, preserving their stdout data protocol. Native timings use the same bounded 30-second `.samples`, `.mean`, `.p95` and `.max` windows as UI timings. iOS FPS timing covers received-counter processing; Android FPS timing includes Perfetto flush/readback. Video timing covers packet assembly and queue work, not decoding or device rendering.

Error and crash events carry only a generated anonymous `user.id` and a `telemetry_session` tag. The Node server creates one random installation ID per local OS account, stored with owner-only permissions in `~/Library/Application Support/mobile-dev/telemetry/anonymous-user-id`. It survives plugin updates, project changes, and app restarts, and is shared with the served UI and native helpers. Each MCP process creates a new random session ID; its UI panels and child helpers share that session. These are plugin server sessions, not chat or device sessions. Sentry's affected-user count therefore approximates affected installations: one person on two machines counts twice, while people sharing an OS account count once. No OpenAI account ID, email, name, IP address, device ID, or host identifier is used. IDs are excluded from performance metrics and span attributes. Stop the MCP processes and delete the identity file to reset it; telemetry opt-out creates no ID.

Session Replay, minidumps, screenshots and profiling are disabled. Requests, account details, app log content, tool payloads, automatic console breadcrumbs and exception source context are excluded. JavaScript error text redacts common tokens, identifiers, URLs, email addresses and local home paths. Native reports retain source basenames and debug IDs, omit absolute module paths, and never send Rust panic payloads. Safe product attributes and source locations remain available for diagnosis. `MOBILE_DEV_TELEMETRY=off` disables reporting across JavaScript and native helpers.

Builds generate debug IDs and source maps under the ignored `.sentry/` directory. Native rebuilds retain macOS dSYMs and unstripped Android ELF files in `.sentry/native` before stripping the bundled binaries. Symbols, source maps and the upload credential are excluded from the plugin package. Native builds require CMake and Ninja, with an Android NDK for Android collectors. The SDK source archive is pinned and checked by SHA-256. Store the organization build token in the ignored `.env.sentry-build-plugin` file at the repository root:

```dotenv
SENTRY_AUTH_TOKEN=your_org_token
SENTRY_ORG=your_organization_slug
```

That file is also listed in `.worktreeinclude` for local worktrees. Use the organization slug, rather than a team slug, for `SENTRY_ORG`. `npm run sentry:upload` reads the file in preference to shell settings, creates the shared release in all three projects, uploads JavaScript maps and native debug files, and finalizes the release. Rebuild native helpers and run `npm run build` before uploading so symbols and maps match the packaged code. Runtime reporting needs only the public DSNs; it does not need this token. Build and upload are separate commands. `npm run test:native-telemetry` verifies a real isolated crash, Rust panic privacy, metrics, opt-out and the Android relay transport against a local receiver.

## Tools

| Tool | Action |
| --- | --- |
| `mobile_open_simulator` | Open the native panel and start the bundled backend |
| `mobile_open_workspace` | Open fullscreen with logs on the left and the simulator on the right |
| `mobile_list_simulators` | Start the bundled backend if needed and list devices |
| `mobile_choose_devices` | Ask through the native inline form for one or several verified task targets |
| `mobile_list_ios_devices` | Discover physical iPhones and iPads with USB/Wi-Fi, pairing state, UDID, and CoreDevice ID |
| `mobile_start_baguette` | Retry or reconnect the bundled backend |
| `mobile_boot_simulator` | Boot one listed device |
| `mobile_shutdown_simulator` | Shut down one listed device |
| `mobile_describe_ui` | Read a booted device's accessibility tree |
| `mobile_screenshot` | Return a booted device's PNG screenshot |
| `mobile_send_input` | Send validated input in device points |
| `mobile_repair_input` | Reclaim input from Device Hub, closing running apps |
| `mobile_stream_session` | Create a panel stream, app-only |
| `mobile_ios_mirror_input` | Send physical iOS panel touches for the current video generation, app-only |
| `mobile_stream_input` | Send a batch of panel input, app-only |
| `mobile_stream_reset` | Recover one iOS panel's MJPEG capture, app-only |
| `mobile_stream_close` | Close a panel stream, app-only |
| `mobile_log_sources` | List connected Android devices and local Metro targets |
| `mobile_logs_session` | Start native and/or Metro log readers |
| `mobile_read_logs` | Read a log batch and source status |
| `mobile_logs_keep_alive` | Keep background collection alive without sending logs (app only) |
| `mobile_logs_close` | Stop a session's log readers |
| `mobile_performance_sources` | Read running apps and foreground identity on the selected iOS or Android device |
| `mobile_cpu_session` | Connect a native process and thread CPU plus memory monitor |
| `mobile_read_cpu` | Read live CPU and memory samples and connection status |
| `mobile_cpu_close` | Stop one CPU and memory monitor while leaving its app running |
| `mobile_record_performance` | Start a timed CPU and memory recording that saves automatically |
| `mobile_read_performance_recording` | Read original samples and a selected interval's summary |
| `mobile_render_performance_recording` | Show an interactive chart card in chat |
| `mobile_compare_performance_recordings` | Overlay 2–6 completed runs in an interactive comparison card |
| `mobile_open_performance_recording` | Open a saved run and selection in the workspace |
| `mobile_finish_performance_recording` | Stop and save a recording early |
| `mobile_list_performance_recordings` | Find recent saved and active runs |
| `mobile_display_fps_session` | Start device-wide Display FPS on Android 12+ or physical iOS 17.4+ |
| `mobile_read_display_fps` | Read FPS intervals and connection status |
| `mobile_read_performance_frames` | Read Android jank/pacing statistics and page through exact display frames |
| `mobile_display_fps_close` | Stop FPS collection and release the tracing connection |

When reactivated, the `agent-device` MCP server exposes the pinned runtime's official operations through compact, validated schemas, including `open`, `snapshot`, `press`, `fill`, `type`, `scroll`, `wait`, `find`, `get`, `is`, `close`, and debugging tools. Their input schemas describe each command. The source [control skill](skills/agent-device/SKILL.md), currently excluded from the package, explains session ordering and links to the version-matched guide.

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
