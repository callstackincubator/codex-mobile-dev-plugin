# Stream performance profiling

Measured on 2026-09-30 with plugin 0.1.19, Baguette commit
`db17446e25059247879dba7941e4de641c2f31e2`, and the already booted iPhone 18 Pro
running iOS 27. The visible app was Maps. Aggregate measurements are preserved in
[stream-timings.json](profiling/stream-timings.json).


## Integration with upstream main in 0.1.33

The user confirmed the performance of 0.1.24 and requested landing the work on
main while incorporating the intervening upstream changes. Integration starts
from upstream commit `8ffc5c1` (0.1.32), retaining Android streams, the React UI,
Legend List log virtualization, screenshots/clipboard support, ordered simulator
lifecycle calls, capture recovery, Device Hub automatic repair policy, and MCP
live UI development.

The user explicitly requested following upstream UI completely. All upstream
React components, theme, stylesheet, HTML template, and log model are preserved.
The temporary simulator timing widgets and rendering-disabled flag are removed;
logs render through upstream's virtual list. The earlier full-DOM log renderer
is not retained. Its profiling data remains historical evidence, not a
performance claim about the new virtual list. Console diagnostics remain.

The iOS controller now uses the bounded read/decode/paint pipeline, requesting
60 FPS. Capture retains raw JPEG bytes and base64-encodes the latest frame only
when requested. Resource reads carry arrival/timing metadata and support
cancellation. The upstream server still recovers a dropped socket within its
session, preserving monotonic sequences, refusing input before fresh capture,
and retaining reset cooldowns and first-frame timeouts. Browser recovery clears
pending paints and discards late decoding results from the previous capture.
Decode errors keep upstream's capture reset and three-failure reconnect policy.
Android video remains on upstream's H.264 implementation; ordered/coalesced
input is shared by both panels.

Connections use a fresh Device Hub query, while gesture checks refresh in the
background and use the last completed result. Newly blocked input is published
when the refresh completes; main's existing reconnect/automatic repair policy
then applies. Explicit repair still invalidates cached checks and joins
concurrent requests. No direct WSS or certificate transport is retained.
The previous simulator/workspace resource addresses are aliases for the same
current UI, including the investigation build's 0.1.24 addresses.

The native/stdio improvements measured in 0.1.24 are not browser measurements
of the integrated React UI. The integrated production stdio probe acknowledged 472 drag requests in
0.54 ms on average, 0.97 ms p95, and 7.98 ms maximum, with zero requests over
100 ms. It delivered 453 JPEGs over eight seconds (56.56 packets/s), with zero
skipped sequences and 0.64 ms average transfer overhead. This workload uses the
current Maps view, not a pixel-identical replay of the previous probe. Idle
capture produced only one packet over four seconds; that is expected for an
unchanged surface and does not trigger reconnect after a valid first frame.
Results are preserved in [main-integration-0.1.33.json](profiling/main-integration-0.1.33.json).

Validation: the integrated suite passes 118 tests, including upstream Android,
React log controls and attachment behavior, simulator lifecycle calls, recovery,
and the input/frame tests. The combined build and package complete. The copied
package smoke confirms all 30 tools, bundled Android dependencies, independent
MCP discovery/runtime agreement, existing UI address aliases, native backend
startup, and shutdown without changing a simulator. Upstream components, theme,
stylesheet, HTML template, and log model have no changes relative to `8ffc5c1`.
The suite also passes all 118 tests in an isolated checkout of the integrated
commit, after the shared checkout's input source had been overwritten during
integration. The committed input source and installed server contain the
background refresh. The native reconnect smoke terminates only its own copied
Baguette, then confirms recovery on the same session with increasing sequence;
it does not boot, repair, or send input. Installed 0.1.33 server, HTML, native
binary, Android scrcpy server, skill, README, and manifest hashes match the
validated release output.



## Confirmed findings

The native and stdio MCP pipelines have no fixed 20 FPS limit. During an
eight-second continuous map drag, the bundled native backend and MCP resource
reader delivered 519 JPEGs (64.80 packets/s), with no skipped sequences. Transfer
overhead averaged 0.72 ms, with p95 1.14 ms. This is encoded-frame delivery, not
proof of 65 distinct screen updates or 65 browser paints per second.

There was a separate, confirmed input bottleneck before version 0.1.24: the Xcode Device Hub status
check blocked gesture delivery for approximately 150–200 ms once per second.
`SimulatorInputService.status` caches a result for one second. When that cache
expires, the next `mobile_stream_input` request waits for
`xcrun simctl spawn <udid> notifyutil -g com.apple.coredevice.dtuhidd.active`
before passing gestures to the native socket.

An instrumented repeat made 389 input requests during an eight-second drag.
Eight requests took more than 100 ms. All eight coincided with the status check:

| Request | Full input round trip | Device Hub status check | Remaining time |
| --- | ---: | ---: | ---: |
| 1 | 186.14 ms | 183.33 ms | 2.81 ms |
| 2 | 157.72 ms | 157.12 ms | 0.61 ms |
| 3 | 177.00 ms | 176.30 ms | 0.69 ms |
| 4 | 155.90 ms | 155.44 ms | 0.46 ms |
| 5 | 154.78 ms | 154.43 ms | 0.36 ms |
| 6 | 158.77 ms | 158.16 ms | 0.61 ms |
| 7 | 165.78 ms | 165.25 ms | 0.52 ms |
| 8 | 157.38 ms | 156.80 ms | 0.58 ms |

Every check returned `ready`. This is an input-status query, unrelated to the
browser's Local Network Access gate from the earlier WSS experiment. Neither
permissions nor simulator input were repaired or changed during profiling.

The ordinary input requests are fast: p95 was 1.18 ms in the instrumented run.
The long requests represent only about 2% of samples, so p95 alone hides the
periodic freezes. The panel's ordered input queue waits for each acknowledgment;
pending moves are coalesced while a check is outstanding. Source locations:
`src/server/simulator-input.ts` (`status`/`check`), `src/server/plugin.ts`
(`blockedInput`/`mobile_stream_input`), and `src/ui/stream-input.ts` (`drain`).

This establishes a plugin-side cause of periodic interaction lag. It does not
establish the cause of any additional frame-rate limit in the embedded panel.

## Native capture and encoding

A separate checkout of the pinned native source was instrumented and compiled
in release mode. The installed native executable was left unchanged. Counters
and elapsed durations covered SimulatorKit callbacks, idle capture, framebuffer
retrieval, surface-seed filtering, encoder queue wait, scaling, JPEG encoding,
multipart parsing/enqueue, and socket writing. A Swift Testing test for the
recorder was observed failing before implementation and passed afterward.

Each idle configuration warmed for 1.5 seconds and measured for ten seconds.
Stage averages use complete one-second report windows inside that interval.

| Idle Maps measurement | Scale 2 | Scale 4 |
| --- | ---: | ---: |
| Received JPEG packets/s | 19.90 | 20.00 |
| SimulatorKit frame callbacks/s | 20.00 | 20.00 |
| Idle capture timer ticks/s | 5.00 | 5.00 |
| Framebuffer retrieval, average | 1.67 ms | 1.68 ms |
| Encoder queue wait, average | 0.016 ms | 0.019 ms |
| Scaling, average | 1.27 ms | 1.92 ms |
| JPEG encoding, average | 3.85 ms | 1.57 ms |
| Multipart parsing/enqueue, average | 1.82 ms | 0.76 ms |
| Scaling through enqueue, average | 6.94 ms | 4.25 ms |
| Socket write, average | 0.027 ms | 0.032 ms |

The 20 FPS idle observation originates at the source callbacks, rather than a
full encoder queue. The extra five idle captures per second normally hit the
unchanged-surface filter. Only 16 distinct JPEG byte sequences were observed in
each ten-second idle run; a new IOSurface seed is not proof of changed pixels.

For motion, six alternating map swipes were sent per configuration, each with a
0.9-second requested duration followed by a 0.7-second pause. Screen dimensions
were read from the native definition and the screen was read before input.
The mean packet rate including pauses was 40.53 FPS at scale 2 and 46.36 FPS at
scale 4. Individual one-second windows delivered approximately 60 JPEGs or
more during movement. Scaling through enqueue averaged 8.47 ms and 3.39 ms,
respectively. Encoder queue wait averaged 0.55 ms and 0.036 ms.

Native outliers also exist: scale-2 motion included a 92 ms framebuffer query
and a 156 ms scaling-through-enqueue sample. Their internal causes were not
isolated. These can produce occasional video hitches, but do not explain a
steady 20 FPS ceiling. The scale comparisons used separate runs and changed
map contents; they are not a controlled quality-versus-performance comparison.

The initial stack sample located framebuffer XPC retrieval, ImageIO JPEG
encoding, and multipart parsing. A build was active during that sample, so
sample counts were not used as uncontended performance measurements. Release
timing runs started after the build completed.

## Stdio MCP during continuous motion

The production bundled server was measured through the MCP SDK over stdio.
One resource read remained in flight while ordered pointer gestures followed
an oscillating path across the map. Each move waited for its acknowledgment,
then waited 16 ms before the next move. This differs from browser pointer
events, which can arrive while the preceding acknowledgment is pending.

| Measurement | Idle, 4 seconds | Drag, 8 seconds | Settling, 4 seconds |
| --- | ---: | ---: | ---: |
| JPEG packet FPS | 19.25 | 64.80 | 21.99 |
| Skipped sequences | 0 | 0 | 0 |
| JPEG throughput | 2.18 MB/s | 7.54 MB/s | 2.58 MB/s |
| Read round trip, average | 51.77 ms | 15.44 ms | 45.22 ms |
| Server wait, average | 50.53 ms | 14.72 ms | 44.23 ms |
| Transfer overhead, average / p95 | 1.23 / 1.53 ms | 0.72 / 1.14 ms | 0.99 / 1.61 ms |

The instrumented repeat delivered 66.81 JPEG packets/s during dragging, again
with zero skipped sequences and 0.80 ms average transfer overhead. The only
additional server instrumentation timed the real Device Hub status query;
it did not remove, cache differently, or bypass the check.

Input acknowledgment measures delivery to the native WebSocket, not the time
until a resulting image appears. The native one-shot swipe timings include
their requested gesture duration and must not be compared to pointer-message
acknowledgments.

## Embedded panel measurements

The user subsequently supplied 16 console reports from plugin 0.1.20. The
capture included both interaction and idle windows and had no timestamps or
explicit interaction markers. The complete parsed reports are preserved in
[panel-timings-0.1.20.json](profiling/panel-timings-0.1.20.json).

Samples 7–11 were selected as high-activity windows: each had at least 30 reads
and nonzero input timings. Sample 6 mixes the start of interaction with a
one-second idle wait and was excluded from the steady comparison.

| Sample | Painted FPS | Observed source sequence FPS | Transfer average / p95 | Decode average / p95 | Canvas paint average |
| --- | ---: | ---: | ---: | ---: | ---: |
| 7 | 26.8 | 37.1 | 17.0 / 66.0 ms | 3.8 / 3.4 ms | 0.027 ms |
| 8 | 33.9 | 46.9 | 15.5 / 50.0 ms | 5.8 / 43.1 ms | 0.041 ms |
| 9 | 44.1 | 61.1 | 13.6 / 39.3 ms | 5.4 / 26.1 ms | 0.032 ms |
| 10 | 49.9 | 53.9 | 9.4 / 29.2 ms | 3.1 / 5.0 ms | 0.032 ms |
| 11 | 63.1 | 77.1 | 10.0 / 25.3 ms | 4.3 / 10.9 ms | 0.046 ms |

Those five windows contain 233 resource reads, 42 skipped source sequences
before reading, zero skipped images before decoding, and 16 decoded bitmaps
replaced before painting. Read-weighted averages are 21.46 ms for round trip,
9.08 ms for server wait, and **12.38 ms for the remaining delivery overhead**.
Per-window average encoded-frame receipt-to-paint age is 13.2–26.4 ms, with
per-window p95 values of 30–70 ms.

This locates the largest measured overhead and frame loss before JPEG decoding,
in the browser resource-read delivery path. The earlier stdio test's approximately
0.7 ms transfer overhead under continuous motion was materially lower. Decode
also has occasional long samples, but there is no pending encoded-image backlog
in this capture. Canvas draw-call CPU time is small; this does not measure full
GPU/compositor presentation. The decoded bitmaps replaced before paint can
reflect display scheduling as well as temporary stalls.

Eight zero-paint windows have zero bytes and a roughly one-second server wait.
These indicate an unchanged source with a long-poll timeout, not failed frame
delivery. The observed panel reaches 63 painted FPS in one window, so these
reports do not support a fixed 20 FPS panel ceiling. Source FPS is an estimate
from sequence increments over each reporting interval, not a timer measuring
distinct visual updates.

### Further isolation

The current `bridge` metric includes server base64/serialization, host routing,
iframe message delivery, SDK validation, and browser scheduling before the
read promise resumes. It does not distinguish those individual contributions.
The supplied samples therefore do not prove which host component causes the
additional delay.

The compiled UI's MCP Apps SDK `PostMessageTransport` calls
`console.debug("Parsed message", parsed.data)` before dispatching every valid
incoming RPC message, including a resource response containing the full base64
JPEG. It also logs outgoing requests. Hiding debug-level messages does not
remove these calls. Whether inspector logging materially contributes to the
observed timings remains a hypothesis. A follow-up capture was requested with
DevTools closed. Its only sample with input activity still showed 13.93 ms
average transfer overhead (p95 51.45 ms), 4.37 ms average decode time, and
37.86 painted FPS against 58.32 observed source sequence FPS. Most subsequent
samples had no input, a source rate near 20/s, and 13–22 ms average transfer
overhead. The comparison does not isolate a logging-specific cause. No logging
removal or transport change has been made.

### Diagnostic release 0.1.21

The next diagnostic build adds these fields without changing the number of
reads, capture cadence, codec, input handling, or SDK logging:

- `requestTravel`: from beginning the browser read to entering the worker's
  frame-read method. Includes browser request setup, host routing, and server
  dispatch before that method.
- `serverPrepare`: time in the worker after subtracting its reported wait for
  a frame. Includes lazy base64 preparation; excludes MCP serialization after
  returning from the worker.
- `responseTravel`: from the worker preparing its response to the first
  message listener running in the iframe. Includes serialization, host routing,
  and browser scheduling until that listener can run.
- `sdkDispatch`: from that first listener to resuming the browser read loop.
  Includes the SDK's message parsing/logging/result validation and the app's
  own response validation.
- `paintWait`: from a bitmap being ready to its paint callback running.

The first message listener is registered before `app.connect()` registers the
SDK transport. It accepts only messages from `window.parent` and observes
Mobile Dev frame resources. A bounded map retains only URI/timestamp keys and
arrival times, never JPEG payloads. Keys include both URI and server completion
timestamp to keep overlapping/cancelled sessions independent. Both image and
idle-wait responses carry server timestamps. The map is not cleared when an
older session finishes, which prevents its cleanup interfering with a new
session.

Cross-process timestamps use `performance.timeOrigin + performance.now()` and
assume the worker and browser run on this same Mac. Signed phase durations are
retained so an inconsistent clock basis remains visible; request and response
clock offsets cancel in their sum. These measurements are not suitable for a
remote worker with an unsynchronized clock. The four delivery phases sum to
read round trip minus server wait; paint waiting is measured separately.
No raw GPU/compositor presentation timestamp is measured.

### Phase results from 0.1.21

The user supplied four consecutive reports, preserved in
[panel-timings-0.1.21.json](profiling/panel-timings-0.1.21.json). The first two
contain input activity and show 42.0–42.3 painted FPS against 63.0–66.9 observed
source sequence FPS. Together they contain 96 reads, 35 skipped sequences before
read, zero replacements before decode, and 11 bitmap replacements before paint.

Read-weighted delivery phase averages in those two windows are:

| Phase | Average |
| --- | ---: |
| Request travel | 4.57 ms |
| Server preparation | 0.063 ms |
| Response travel | 10.13 ms |
| SDK dispatch | 0.247 ms |
| Total overhead excluding source wait | 15.01 ms |

Each report's four phase averages reproduce its bridge average to within
0.00003 ms. This validates accounting, but does not independently validate the
cross-process clock basis. With the same-Mac clock assumption, the largest
delivery component lies between server preparation and the iframe's first
message listener. That interval combines response serialization, host routing,
browser message delivery, and scheduling before the listener runs; it does not
isolate one of those as the absolute root cause.

SDK dispatch p95 is at most 0.4 ms across these four reports, providing no
evidence that SDK parsing or its incoming debug logging is the dominant delay
in this capture. Server preparation is also small. Decoder averages during the
first two windows are 6.35–9.31 ms, with p95 39.9–43.2 ms. A duration spanning an
asynchronous decode includes time waiting for its continuation to run, so these
tails alone do not prove slow JPEG codec execution. Paint wait averages
3.80–4.55 ms and canvas draw-call averages stay below 0.06 ms.

The final window's source sequence rate falls to 21.05/s, while delivery overhead
rises to 27.66 ms and response travel p95 reaches 107.42 ms. It should not be
treated as a continuous-motion FPS comparison. Further profiling must separate
browser main-thread scheduling from the remaining response delivery interval;
no transport or decoder performance change has been selected.

### Browser scheduling diagnostics in 0.1.22

The user authorized profiling the browser main thread next. Version 0.1.22 adds
observations without changing capture cadence, read concurrency, JPEG quality,
input checks, or SDK logging. Reports retain the existing prefix and add:

- `jpegPrepare`: synchronous base64 decoding, byte copying, and Blob creation.
- `bitmapDecode`: `createImageBitmap` invocation through its promise resuming.
  This includes asynchronous decoding and scheduling of the continuation.
- `browser.timerLag`: lateness of a recursive 16 ms timer, with count,
  average, p95, and maximum. Samples spanning a document visibility change or
  firing while hidden are excluded and counted in `hiddenTimerSamples`.
  Timer lateness signals scheduling delay; it is not a CPU utilization counter.
- `browser.longTasks` and `longestTasks`: observed long-task duration summaries
  and the three longest entries, retaining their scope (`self`, ancestor, etc.).
- `browser.longAnimationFrames` and `longestAnimations`: delayed animation
  summaries, blocking durations, and the three longest script contributions
  per retained animation, when the browser provides them. Script attribution
  includes invoker, function name, character position, window attribution, and
  forced layout duration. No source URL or frame payload is retained.
- `browser.slowestResponses` and `slowestDecodes`: the three longest intervals
  per report, including overlaps with long tasks, long animation frames, and
  observed late-timer intervals. Each overlap is clipped to the interval and
  merged to avoid double counting. Overlaps from different categories must not
  be added together.

The APIs are feature-detected. Unsupported observers are reported explicitly;
an observation failure is reported as `observerError` without stopping the
stream. No alternative measurement transport is introduced. Observers and the
timer stop with the stream. All histories are capped at 128 samples; response
and decode overflow are counted. Correlation work is limited to the three
slowest responses and decodes. Long-task and animation summaries describe entries
delivered since the preceding report, while their histories remain available
for late response/decode correlations. Observer notifications can arrive after
the event or after an earlier report, so adjacent reports should be collected.

According to [Chrome's primary API documentation](https://developer.chrome.com/docs/web-platform/long-animation-frames),
these observer APIs use a 50 ms threshold, and script attribution does not expose
cross-origin iframe, worker, or isolated extension internals. Absence of long
entries therefore does not rule out shorter scheduling stalls. The timer probe
adds evidence for those stalls but cannot identify their executing function.

Response overlaps retain the same-Mac clock assumption from 0.1.21. Decode and
timer durations use only the iframe's clock. Overlap establishes coincidence,
not that every overlapping millisecond was caused by iframe JavaScript. Host
serialization and routing remain outside this observer's direct view. The
reporting and observer work themselves can also contribute to observed browser
activity; this diagnostic build is not a browser CPU trace.

Validation: 46 source tests passed, including clipped/merged overlap accounting,
cross-report history, explicit unsupported observers, hidden timer exclusion,
bounded response retention, observer shutdown, and asynchronous decode timing.
The copied-package smoke test verified separate discovery/runtime resource
agreement and clean native backend shutdown. Version 0.1.22 was built, packaged,
and installed with `codex plugin add mobile-dev@mobile-dev-local --json`.
Installed server, HTML, native executable, skill, and manifest hashes match the
workspace output; the new resource address and diagnostic fields are present.
Actual embedded browser observations still require the user's next capture.

A synthetic Node 26 accounting probe ran 100 reporting passes with 60 response
samples, 120 decode samples, and full 128-entry task/timer histories. Median
report computation was 0.032 ms, p95 0.152 ms, maximum 1.093 ms. This measures
only JavaScript accounting on synthetic data, not browser observer, rendering,
or console costs.

### Browser results from 0.1.22

The user supplied `logs.web-san`, containing 17 consecutive console reports.
Parsed reports and aggregates are preserved in
[panel-timings-0.1.22.json](profiling/panel-timings-0.1.22.json). All reports show
visible document state, both observer types supported, no observer error, no
excluded hidden timer samples, and no response/decode history overflow.

Samples 1 and 2 have high source sequence rates and input activity:

| Sample | Painted FPS | Source sequence FPS | Delivery overhead | JPEG preparation | Async bitmap duration | Timer lag p95 / max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 46.27 | 69.40 | 16.12 ms | 0.57 ms | 5.33 ms | 44.9 / 59.9 ms |
| 2 | 43.93 | 73.88 | 14.72 ms | 0.55 ms | 7.91 ms | 27.6 / 42.9 ms |

Those two windows contain 101 reads, 42 skipped source sequences, no encoded
image replacements before decode, and 11 bitmap replacements before paint.
Read-weighted phase averages are 5.08 ms request travel, 0.060 ms server
preparation, 10.01 ms response travel, and 0.223 ms SDK dispatch: 15.37 ms total
delivery overhead. Sample 3 still has input activity but its source sequence
rate falls to 38.14/s and input acknowledgment averages 185 ms. Including it
yields 137 reads and 13.91 ms average delivery overhead. It is recorded as a
separate activity selection rather than silently discarded or assumed idle.

Across all 17 reports, JPEG preparation averages 0.47–0.57 ms and its highest
per-report p95 is 0.70 ms. Neither observer reports any long task or long
animation frame. This provides no evidence for a sustained expensive synchronous
JPEG preparation step or an observed long script task in this capture; it does
not exclude shorter tasks, native work, or scheduling delays.

For the six slowest response intervals selected from samples 1 and 2,
244.69 ms of their combined 295.82 ms overlaps late timer intervals (82.7%).
For their six selected asynchronous decode intervals, overlap is 162.90 ms out
of 240.70 ms (67.7%). These are selected slow intervals, not a percentage of all
delivery or codec work. Coincident delays in independent timers, responses,
and decode continuations support browser scheduling as a contributor; overlap
does not prove CPU blocking or establish the scheduler's internal cause.

A distinct outlier occurs in sample 15: frame sequence 1669 takes 514.06 ms
from server preparation to the iframe message listener. Only 29.20 ms of that
interval overlaps late timers (5.7%). The report contains 51 timer callbacks,
with average lateness 3.69 ms and maximum 45.30 ms. There is no long-task or
long-animation notification. This is inconsistent with the iframe's event loop
being continuously stalled for the entire 514 ms. It points to a
response-specific delivery delay or message scheduling issue, while leaving
server serialization, host routing, IPC, and browser message queuing unresolved.
The server preparation duration excludes serialization after the handler
returns, so that component has not been measured separately.

The next discriminating evidence is a DevTools Performance trace during panel
interaction, including task execution, rendering, and idle gaps. No rebuild is
required for recording. Chrome documents
[runtime recording](https://developer.chrome.com/docs/devtools/performance/overview)
and [trace export](https://developer.chrome.com/docs/devtools/performance/save-trace).
No transport, decoder, or input fix has been selected from these observations.

### DevTools trace: log-list rendering blocks streaming

The user supplied `Trace-20260930T212153.json.gz`, a 6.495-second DevTools
recording with 226,997 events. Aggregate evidence and reproducibility notes are
preserved in [browser-trace-0.1.22.json](profiling/browser-trace-0.1.22.json).
The raw trace remains in Downloads; screenshots and full script sources are not
copied into the repository. Source material in the trace was read, not executed.

The trace identifies a confirmed plugin-side browser bottleneck:
`LogsPanel.receive` calls `LogList.append`, which invokes `LogList.render` for
each incoming batch. `render` rebuilds all matching displayed rows (up to 500),
including new elements, time formatting, and event listeners; it then replaces
the entire list. Reading `scrollHeight` immediately afterward to follow the
latest logs forces synchronous style/layout. The embedded script's actual
source positions confirm these functions and the scroll-height read, matching
`src/ui/log-list.ts:68`, `:83`, and `:87`; the call originates at
`src/ui/logs-panel.ts:136`.

| Trace measurement | Value |
| --- | ---: |
| Log-update tasks containing forced layout | 49 |
| Mean / p95 / maximum log-update task | 33.58 / 40.86 / 45.21 ms |
| Time occupied by those tasks | 1,645.34 ms |
| Share of trace wall time | 25.33% |
| Share of recorded renderer task time | 46.19% |
| Forced log layouts, total / average | 446.72 / 9.12 ms |
| Dirty layout objects per update | 2,412–4,725 |
| JPEG worker decode, average / p95 | 2.39 / 3.19 ms |

Forced layout is included in log-task duration and must not be added again.
All 49 identified log updates exceed a 16.67 ms frame budget. Their longest
durations stay below the long-task API's 50 ms threshold, explaining how the
earlier observer could report zero long tasks while these updates still disrupt
60 FPS. The exact scope is this capture; recording/profiling overhead also
exists, including approximately 32 ms CPU-profiler startup in the initial task.

Post-message trace IDs provide direct evidence that this work delays stream
requests on the shared renderer event loop. A frame-read request spends
46.002 ms between `SchedulePostMessage` and `HandlePostMessage`; 39.293 ms of
that interval overlaps an identified log-update task. Another frame request
waits 38.767 ms with 33.643 ms of log-update overlap, and another waits
30.599 ms with 30.014 ms overlap. An input request also waits 45.526 ms with
39.293 ms overlap. These pairs cover local plugin-to-sandbox request delivery,
not the whole MCP round trip or server-to-browser response interval.

This establishes full-list rebuilding and forced layout as a cause of recurring
video/input scheduling stalls. It does not isolate the earlier 514 ms response
outlier, nor prove that all host routing overhead comes from log rendering.
The finding was presented to the user before choosing a fix, as required by
their debugging instructions. The next section records the requested temporary
rendering-disabled experiment.

### Temporary rendering-disabled comparison in 0.1.23

The user requested disabling the identified log-viewer work temporarily and
measuring again. Version 0.1.23 sets `LOG_RENDERING_ENABLED` to false and returns
from `LogList.render` before stacking, filtering, creating/replacing rows, or
reading scroll geometry. Source rendering code remains available for this
explicitly temporary experiment. The freshly opened list explains that display
is paused. Log collection, MCP requests, response parsing, and the original
bounded buffer continue; the entire log reader is not disabled. Native capture,
frame reads, decoding, diagnostics, and input checks retain their behavior.

Every timing entry adds `logRenderingEnabled: false` to identify this comparison.
The source flag is a compile-time experiment, not a user-selectable alternate
renderer or a fallback transport. No permanent rendering fix has been chosen.
The user must restart Codex and reopen the same panel/layout to measure the
installed version; browser paint rate cannot be measured by the stdio probe.
Compare several interaction windows with 0.1.22, including FPS, source sequence
rate, bridge/request/response tails, timer lag, and skipped frames. A new trace
can confirm the log-render/layout tasks are absent if further isolation is needed.

Validation: all 46 existing source tests passed and the copied-package smoke
passed. Version 0.1.23 was rebuilt, packaged, and installed through the local
marketplace CLI. Installed server, HTML, native executable, skill, and manifest
hashes match workspace output. The installed bundle has a false comparison
flag and an early return before row/layout work; the original renderer remains
in the source and bundle for this temporary experiment. The new resource URI
and log-display notice were verified. No performance improvement is claimed
until the updated embedded panel is measured.

### Background input status refresh in 0.1.24

The user reported a substantial improvement with log rendering disabled and
requested tackling the once-per-second input stall next, suggesting moving the
check off thread. The command was already asynchronous in a child process; the
blocking dependency was awaiting it before sending a gesture after cache expiry.

Version 0.1.24 retains one status-query implementation. After a completed check,
gesture requests return that completed promise while an expired check refreshes
in the background. Refreshes are deduplicated per device, including commands
that take longer than the one-second cache period. There is no recurring timer
or check when the service is unused. Cold status calls and stream connection
requests await a fresh result. Repair checks bypass the cache and still verify
before and after the explicit repair. Repair invalidates prior cached entries;
an old refresh cannot populate a newer entry, and status calls during repair
join that operation.

The tradeoff is an older result during refresh: a newly opened Device Hub can
block input before the next query completes. Once the completed result says
blocked, subsequent gestures are rejected by the existing guard. Failed queries
still report unknown under the original policy. Native input ordering and
automatic repair behavior are not changed. Log rendering stays disabled for
this comparison.

Focused tests cover first-query waiting, duplicate suppression, input during a
slow refresh, newly blocked state publication, explicit fresh checks, query
failure, device isolation, and refresh/repair races. Browser reports add input
sample count and maximum so rare pauses remain visible even below p95's sample
threshold. The user’s log-rendering improvement is qualitative; no new frame
timing capture was supplied for that comparison.

Two fresh stdio probes used the already booted simulator and the same Maps drag
workload: four seconds idle, eight seconds continuous input, four seconds settle.
The production build acknowledged 475 drag inputs in 0.44 ms on average,
0.72 ms p95, and 3.75 ms maximum. An independently bundled instrumented repeat
acknowledged 476 inputs in 0.39 ms on average, 0.65 ms p95, and 3.22 ms maximum.
Neither run had an input request over 100 ms, compared with eight such requests
and a 186.14 ms maximum in the earlier instrumented baseline.

The repeat still executed nine status queries: one initial check and eight
refreshes approximately one second apart during the drag. Their durations were
151.48–170.23 ms. This confirms that the expensive checks still run while
gestures proceed. The probes delivered 65.95 and 67.81 JPEG packets/s during
dragging with no skipped sequences. These measurements exclude Codex's host
and browser queues, browser paint rate, and the app's response to a gesture;
they establish removal of the server-side periodic wait, not full end-to-end
input latency. Aggregate results are preserved in
[input-refresh-0.1.24.json](profiling/input-refresh-0.1.24.json).

Validation: all 54 source tests pass, including an MCP-to-native-socket test
that delivers input while the query is unresolved and then rejects input after
a blocked result is published. The production build and release package
complete, and the copied-package smoke confirms discovery/runtime UI agreement,
bundled backend startup, and shutdown without booting or changing a device.
Version 0.1.24 is installed through the local marketplace; installed server,
HTML, native executable, skill, and manifest hashes match workspace output.
The versioned UI URI, disabled log-rendering flag, and input count/maximum
diagnostics are present in the installed bundle. Restart Codex and reopen the
panel to measure the complete input path with this version.

## Remaining measurements and next decision

The embedded capture now measures resource delivery phases, synchronous JPEG
preparation, asynchronous bitmap duration, browser scheduling observations,
canvas draw-call time, and frame age. Further isolation is needed within the
delivery overhead and browser scheduling. The supplied trace now identifies
log-list rebuilding and forced layout as a confirmed cause of repeated
browser stalls. Sustained visual
presentation is not established by either stdio response counts or a single
63 FPS panel window.

The user authorized background input status refresh after the root cause was
established. Version 0.1.24 implements it and the native/stdio comparison above
confirms the periodic awaited pause is removed. Embedded panel input timings
are still needed to measure the remaining host/browser contribution. The historical rendering-disabled comparison has ended for the upstream
integration described above; the current UI uses its virtual log list.
The native profiling build and the temporary status-instrumented server ran
separately from the installed plugin. The phase diagnostics are installed as
plugin 0.1.21; the user has supplied reports containing all phase fields.
Browser scheduling diagnostics are installed as 0.1.22; the user has supplied
17 reports containing the new browser and decode fields.

Temporary repro sources and raw reports are in
`/tmp/mobile-dev-native-profile.0vRbPT`: `source` contains the pinned native
checkout, `stage-probe.mjs` measures native idle/pan stages, and
`mcp-motion-probe.mjs` measures stdio reads and pointer inputs. These temporary
files are not guaranteed to survive system cleanup; the aggregate evidence is
preserved in this repository.
