# Performance

[Back to README](../README.md) · [Contributing](../CONTRIBUTING.md)

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

## Saved recordings in chat

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
