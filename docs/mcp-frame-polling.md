# MCP latest-frame polling

Recorded on 2026-09-30 for plugin 0.1.19, following the WSS checkpoint at `9313bbb`.

The viewer now uses the MCP host bridge for video and input. The direct WSS service, TLS/certificate tools, browser CSP origin checks, and WebCodecs transport have been removed. The prior [WSS investigation](local-streaming-investigation.md) remains historical evidence. No transport fallback is retained. Existing Keychain certificates are neither required nor modified by this version.

## Pipeline

```text
Simulator → Baguette MJPEG WebSocket → MCP worker's latest JPEG buffer
                                              ↑
                              resources/read with sequence cursor
                                              ↑
                                  Codex MCP host bridge
                                              ↑
Panel: request next frame → newest pending JPEG → one decoder → newest bitmap → animation tick
```

The worker requests 60 FPS and scale 2 from Baguette. Incoming frames replace its latest buffer; base64 encoding happens only on a read and is reused for that sequence. A read returns a newer frame immediately or waits up to one second for one. Responses include sequence, byte size, worker receipt time, and server wait time. Sessions expire after five minutes without reads/input. Closing or repairing a session stops its native capture.

The browser has one read and one decoder in flight. Reading continues while decoding and rendering proceed. Each pending stage retains only its newest frame. `requestAnimationFrame` paints the latest decoded bitmap, and replaced/painted bitmaps are closed. A decode finishing after cancellation is also closed. An unchanged screen can return waiting responses indefinitely; absence of new pixels alone is not a connection failure. Socket close/error and request timeout trigger recovery through a new session. Reconnect never boots or repairs a simulator.

Gestures use separate app-only MCP calls. Pending pointer moves are coalesced without crossing down/up or button boundaries. A failed request discards queued gestures. Explicit Pause releases the pointer and drains accepted input before closing; failed connections discard input instead. Device Hub checks still precede input. No gestures are replayed after reconnection.

UI resource addresses are versioned and identical across discovery/runtime processes. Neither view needs a browser network destination in its CSP. Session resources belong to their originating MCP connection; restarting that connection requires a fresh session.

## Measurements

The test device was the already booted iPhone 18 Pro running iOS 27. It was left in its existing scene. No simulator was booted, repaired, or sent input. These are short local measurements, not a sustained interactive benchmark.

The five-second stdio MCP benchmark requested 60 FPS and scale 2:

| Measurement | Result |
| --- | ---: |
| Delivered frames | 97 |
| Delivered FPS | 19.32 |
| Skipped source sequences | 0 |
| JPEG payload throughput | 2.05 MB/s |
| Read round trip, average / p95 | 51.75 / 52.61 ms |
| Server wait, average / p95 | 50.57 / 51.57 ms |
| Round trip minus server wait, average / p95 | 1.17 / 1.57 ms |

This result locates the dominant wait before the MCP response: the worker was waiting for another native JPEG. It does not establish a 20 FPS MCP ceiling. The benchmark excludes Codex's iframe bridge, browser decoding/rendering, and input latency.

For comparison, a separate probe counted packets directly from the same bundled Baguette WebSocket, without moving frame payloads through MCP. Each configuration warmed for 0.5 seconds and sampled for three seconds:

| Format | Requested FPS | Scale | Direct packet FPS | Average bytes/frame |
| --- | ---: | ---: | ---: | ---: |
| MJPEG | 60 | 2 | 20.66 | 105,950 |
| MJPEG | 60 | 4 | 19.99 | 34,195 |
| MJPEG | 1 | 2 | 19.99 | 105,954 |
| AVCC H.264 | 60 | 2 | 61.00 | 1,658 |

The pinned native source explains an important distinction:

- [MJPEGStream.swift](https://github.com/tddworks/baguette/blob/db17446e25059247879dba7941e4de641c2f31e2/Sources/Baguette/Infrastructure/Stream/MJPEGStream.swift) encodes callback-driven surfaces accepted by `SeedFilter`. Its `apply` stores `fps`, but the encoding path does not use it to schedule or throttle frames. Asking for 60 FPS does not force 60 JPEGs/s.
- [SeedFilter.swift](https://github.com/tddworks/baguette/blob/db17446e25059247879dba7941e4de641c2f31e2/Sources/Baguette/Infrastructure/Stream/SeedFilter.swift) suppresses unchanged surface/seed pairs.
- [SimulatorKitScreen.swift](https://github.com/tddworks/baguette/blob/db17446e25059247879dba7941e4de641c2f31e2/Sources/Baguette/Infrastructure/Screen/SimulatorKitScreen.swift) captures on SimulatorKit callbacks, with a separate 200 ms idle capture floor. Neither that floor nor MJPEG's source establishes a hard 20 FPS limit for an animating simulator.
- [AVCCStream.swift](https://github.com/tddworks/baguette/blob/db17446e25059247879dba7941e4de641c2f31e2/Sources/Baguette/Infrastructure/Stream/AVCCStream.swift) additionally pumps the last surface at the requested cadence when callbacks pause. Its 61 packets/s therefore includes possible repeated images and does not prove 61 distinct simulator updates.

Changing JPEG scale did not raise the rate in this initial scene. Subsequent
[performance profiling](stream-profiling.md) measured native stages and an
animated workload: idle source callbacks were approximately 20/s, while
continuous dragging delivered approximately 65 JPEGs/s through stdio MCP.
It also isolated periodic 150–200 ms input stalls to the Device Hub status
query. These results still do not establish 60 FPS in the embedded panel;
the subsequent [embedded panel measurements](stream-profiling.md#embedded-panel-measurements)
show variable delivery overhead and 27–63 painted FPS during high activity.
The largest measured overhead is before decoding, while its internal host and
browser contributions still need isolation.

## Panel diagnostics

The panel's frame counter counts paints, not requests or repeated cursor reads. The timing line shows average transfer overhead, decode time, and frame age; its tooltip includes read/server wait, transfer p95, paint, and input timings. Console entries prefixed `[mobile-dev] Stream timings` report once per second:

- Painted FPS and source sequence rate observed through reads.
- Payload bytes and skipped images before reading, decoding, and painting.
- Average/p95 read round trip, server wait, transfer overhead, JPEG decode, paint, worker-receipt-to-paint age, and input request round trip.

Transfer overhead is `read round trip − server wait`; it includes serialization and host routing, not just network movement. Server wait is measured before base64 encoding. Decode timing includes base64 conversion, Blob creation, and JPEG decoding. Paint includes the canvas draw and associated UI update. Frame age uses the worker's encoded-frame receipt timestamp; it excludes simulator capture/encoding and assumes the local worker/browser wall clocks agree. Input timing measures tool acknowledgment, not the simulator's resulting visual response. Source sequence rate is an observed estimate over the reporting window, not an independent native capture timer.

For diagnosis, compare the panel's transfer/decode timings with the stdio benchmark. A low source rate with little transfer overhead needs native capture investigation; a higher source rate with dropped reads or slow transfer points to the host path; skipped decode/paint frames locate pressure later in the pipeline. Measure an animated workload before interpreting idle FPS as a responsiveness limit.

## Validation

The source suite passes 36 tests, including overlapping read/decode, newest-only pending stages, cancellation during decode, decoder failure, stale sequence rejection, resource timing/error parsing, quiet-screen reads, input ordering/coalescing, no replay, expiration, upstream recovery, Device Hub checks, and existing logs/context/reconnect workflows.

The build and release package complete. The copied-package smoke test checks stable UI resources through separate MCP processes, no certificate tools/direct browser CSP destinations, native backend startup, 78 devices, and shutdown. The native reconnect smoke test terminates only its own copied package's Baguette process and verifies fresh JPEG capture through MCP after restart. No input repair or device boot is involved.

Run the checks with Node.js 22.18 or later:

```sh
npm test
npm run build
npm run package
npm run test:package
npm run test:stream -- <already-booted-UDID> [seconds]
npm run test:reconnect -- <already-booted-UDID>
```

Version 0.1.22 adds browser scheduling observations and separates synchronous JPEG preparation from asynchronous bitmap decoding. Reports include delivery phases, timer lateness, long-task/animation observations, and overlaps for slow response/decode intervals. Timing reports are info-level JSON entries. Restart Codex and reopen Mobile Dev to load its new UI address. The embedded measurements and diagnostic limits are recorded in the [profiling report](stream-profiling.md#embedded-panel-measurements); sustained 60 FPS and complete input-to-display latency remain unverified. A different codec or native capture change should be an explicit next experiment, not an implicit fallback.

Version 0.1.23 temporarily disables log-list rendering for the user-requested performance comparison. Collection and buffering continue. Reports include `logRenderingEnabled: false`; new embedded measurements are needed to determine its effect on video performance.

Version 0.1.24 keeps the rendering experiment and refreshes expired Device Hub
status in the background while gestures use the last completed result. Stream
connection and explicit repair still await fresh checks. Input reports add count
and maximum to expose rare stalls. Two native/stdio repeats reduced maximum
gesture acknowledgement from the earlier 186 ms to under 4 ms while status
queries still took 151–170 ms. This excludes browser/host dispatch and app
response latency; see the [input comparison](stream-profiling.md#background-input-status-refresh-in-0124).
