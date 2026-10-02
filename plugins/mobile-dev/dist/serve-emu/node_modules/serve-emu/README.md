<!-- Generated from ../../README.md by scripts/sync-readme.ts. Do not edit directly. -->

# serve-emu

Host your Android emulator or attached Android device for agent workflows like Codex, Cursor, Claude Desktop, and browser-based QA. `serve-emu` streams the screen locally, over your LAN, or through your tunnel of choice, then accepts low-latency input and device-control commands over HTTP and WebSocket.



https://github.com/user-attachments/assets/5646d44c-7fd1-4e97-8705-b44b47c7fdc6



```sh
bunx serve-emu@latest
# or: npx serve-emu@latest
# -> Preview at http://localhost:3300
```

Use `@latest` for one-off runs so Bun/npm fetches the newest published version instead of reusing a cached or locally installed copy.

`serve-emu` starts the vendored scrcpy server on the device, opens an adb forward tunnel, forwards H.264 frames over WebSockets, and decodes them in the browser with WebCodecs. Input events are written directly to scrcpy's control socket instead of shelling out to `adb shell input`, keeping taps, swipes, text, and key events responsive enough for agents.

## Status

Current package version: see [`package.json`](package.json) and [`CHANGELOG.md`](CHANGELOG.md).

Working:

- Live H.264 video stream from device to WebCodecs canvas
- Tap, swipe, text, keyevent, Back, Home, Recents, and Power input
- Keyboard passthrough in the browser UI: editing/navigation keys, Ctrl/Cmd shortcuts (select all, copy, paste, cut, undo, redo), and IME composition for CJK text
- Multi-client streaming, so multiple browser tabs can share one device
- SPS/PPS replay and metadata headers for clients joining mid-stream
- Device discovery, current-device switching, and AVD start/stop controls
- Screenshot, foreground app, accessibility tree, and logcat APIs for agent inspection
- Orientation, dark/light mode, font scale, and network on/off controls
- Emulator GPS location control and route playback from GPX, GeoJSON, KML, or waypoint JSON
- Session recording and replay for REST, WebSocket, and location events
- APK install, app launch, clear data, force stop, permission grant, and media/file import helpers

Planned:

- Multi-device routing
- Embeddable Connect-style middleware (`serve-emu/middleware`)
- Compiled single binary

## Requirements

- Bun 1.1+
- `adb` on PATH from Android platform-tools
- A booted device/emulator from `adb devices`, or an AVD name passed with `--avd`
- Chrome, Edge, or Safari 16.4+ for the bundled WebCodecs UI

Node.js 18+ can invoke the published package through `npx`, but local development and server runtime use Bun.

## Package API

As of 0.0.5, `serve-emu` is intentionally a CLI-only package. The only
supported package surface is the installed `serve-emu` executable. There are
no supported JavaScript or TypeScript import paths: both `import "serve-emu"`
and deep imports such as `import "serve-emu/src/adb.ts"` are blocked by the
package export map. Files shipped for the CLI are implementation details and
carry no import-path stability guarantee.

The documented HTTP and WebSocket endpoints remain supported runtime APIs once
the CLI is running; they are not package imports. The planned
`serve-emu/middleware` entry point is not available yet and must not be
imported until it is explicitly exported and documented in a future release.

## Quick Start

One-off run from npm:

```sh
bunx serve-emu@latest
# or
npx serve-emu@latest
```

Local development from this repository:

```sh
bun install
bun run --filter serve-emu setup
bun run packages/serve-emu/src/cli.ts
# -> http://localhost:3300
```

`setup` downloads the pinned `scrcpy-server-v4.0` into `vendor/` and builds the browser UI. The CLI also runs the scrcpy setup lazily on first start, so you can skip the setup step for a quick local run.

## CLI

```text
serve-emu [-p <port>] [--host <addr>] [--token <secret>] [-s <serial>] [--max-fps N] [--bit-rate N] [--max-size N] [--key-frame-interval sec] [--repeat-frame-ms ms] [--max-apk-upload-bytes N] [--max-media-upload-bytes N]
serve-emu --avd <name> [--gpu <mode>] [--restart-avd]
serve-emu --avd-list
serve-emu --running-avds
```

| flag | default | meaning |
| --- | --- | --- |
| `-p, --port` | `3300` | HTTP port for the preview server |
| `--host` | `127.0.0.1` | Address to bind. Defaults to loopback so the device is not exposed. Set `0.0.0.0` to serve over the LAN — see [Access control](#access-control) |
| `--token` | none | Shared secret required on every request. Auto-generated for non-loopback binds if omitted |
| `--unsafe-no-auth` | false | Allow a non-loopback bind with **no** authentication (dangerous) |
| `-s, --serial` | auto | adb device serial; required when multiple devices are online |
| `--max-fps` | `60` | Cap source frame rate |
| `--bit-rate` | `8000000` | H.264 bit rate in bps |
| `--max-size` | `1280` | Downscale the longest edge to N pixels; `0` keeps native size. The emulator's software H.264 encoder sustains 60fps only below ~1 megapixel, hence the 1280 default |
| `--key-frame-interval` | `10` | Ask the encoder for regular keyframes; `0` disables this codec option. Late joiners get keyframes on demand, so a long interval avoids periodic keyframe bursts |
| `--repeat-frame-ms` | `0` | Re-encode the previous frame after N ms without screen changes (`16` ≈ steady 60fps on static screens, at extra CPU/bandwidth cost); `0` keeps the encoder default of one repeat per 100ms |
| `--max-apk-upload-bytes` | `536870912` | Maximum APK file bytes accepted by the streaming multipart endpoint |
| `--max-media-upload-bytes` | `1073741824` | Maximum media/file bytes accepted by the streaming multipart endpoint |
| `--max-active-uploads` | `2` | Maximum upload operations reading, staging, or running through ADB concurrently |
| `--max-queued-uploads` | `4` | Maximum uploads waiting for an active slot; further requests receive `429` |
| `--upload-queue-timeout-ms` | `5000` | Maximum time an upload may wait for a slot before receiving `503` |
| `--avd` | none | Launch this Android Virtual Device before streaming |
| `--gpu` | `host` | Emulator GPU mode for `--avd` launches. `host` renders on the real GPU for smooth ~60fps; see [Smooth Emulator Playback](#smooth-emulator-playback) |
| `--restart-avd` | false | Stop a running matching AVD before launching it |
| `--avd-list` | false | List available Android Virtual Device names |
| `--running-avds` | false | List currently running emulator serials and AVD names |
| `--emulator` | auto | Android Emulator binary path; defaults to PATH or Android SDK env vars |
| `--emulator-port` | auto | Emulator console port for `--avd`; must be an even port from 5554 through 5682 |

By default, `serve-emu` attaches to the only online device. If more than one device is online, pass `-s <serial>` or select another running device later through the HTTP API/UI.

## Access control

`serve-emu` grants full control of the connected device — input, screenshots, APK installation, file import, app-data clearing, logcat, and session controls. Treat access to the port as access to the device.

**Default (loopback).** With no flags the server binds to `127.0.0.1`, so only processes on the same machine can reach it. No authentication is required, and local CLI/agent workflows keep working with no setup. Cross-origin browser requests and WebSocket upgrades are still rejected (the Origin must match the host), so a random web page cannot drive your device through the local port.

**Exposing over the LAN or a tunnel.** Pass `--host 0.0.0.0` (or a specific interface address). A non-loopback bind **requires authentication**:

- If you pass `--token <secret>`, that secret is required on every request.
- If you omit `--token`, a random token is generated and printed once at startup.

The startup line prints a ready-to-use URL with the token, for example:

```text
serve-emu → http://localhost:3300/?token=qNEvGN1TSgqRc3NHeZiXOfX2tkQUnv68  (device: emulator-5554)
```

How clients authenticate:

- **Browser (bundled UI):** open the printed `?token=` URL once. The server exchanges the token for a `HttpOnly; SameSite=Strict` session cookie and redirects to a clean URL, so the secret is not kept in local storage or the address bar. Same-origin API, SSE, and WebSocket calls then carry the cookie automatically.
- **Agents / CLI (`curl`, HTTP clients):** send `Authorization: Bearer <token>`, or append `?token=<token>` to the URL.

Requests without a valid token get `401`; WebSocket upgrades and state-changing requests from a mismatched `Origin` get `403` before any work is done.

**Unauthenticated LAN exposure.** `--host 0.0.0.0 --unsafe-no-auth` binds to all interfaces with no authentication. Anyone who can reach the port can control the device. Only use this on a trusted, isolated network; the CLI prints a warning at startup.

**Token handling.** The token is never included in `/health`, `/api` responses, error payloads, or reconnect URLs — only in the one-time startup line. Rotate it by restarting with a new `--token` (or letting a fresh one be generated); existing cookies stop working immediately. When exposing beyond your machine, prefer an SSH tunnel or an authenticating reverse proxy over a raw `0.0.0.0` bind.

## Smooth Emulator Playback

The single biggest factor for stutter-free emulator streaming is the **emulator GPU mode**, not the bit rate or the transport. Many AVDs default to `auto`, which on some hosts (notably Apple Silicon) falls back to a **software Vulkan compositor** (`llvmpipe`/`lavapipe`). That caps the guest at a janky ~20fps with dropped frames, so the stream stutters no matter how high you set `--max-fps` or `--bit-rate`.

`serve-emu` launches `--avd` emulators with **`-gpu host`** by default, which renders on the real GPU (Metal/Vulkan) for smooth ~60fps playback (measured: guest jank dropped from 10–19% to 0%). Override with `--gpu <mode>` when needed:

```sh
# default — real GPU, smooth
serve-emu --avd Pixel_8

# headless host without a usable GPU
serve-emu --avd Pixel_8 --gpu swiftshader_indirect
```

If you start the emulator yourself (or attach to a pre-booted one with `-s`), `serve-emu` can't set its GPU mode — launch it with `-gpu host` directly:

```sh
emulator @Pixel_8 -gpu host
```

You can confirm the mode in the emulator log (`vulkan_mode_selected:host` = good; `lavapipe`/`llvmpipe` = software fallback) or via `adb shell dumpsys gfxinfo <pkg>` (look for a low "Janky frames" percentage while scrolling). For an extra fps margin, lower `--max-size` to stream at a smaller resolution.

## Browser UI

Open `http://localhost:3300` after starting the CLI. The UI streams the device into a canvas and exposes controls for:

- Pointer input, keyboard passthrough (typing, navigation keys, shortcuts, IME composition), hardware buttons, and screenshots
- Device selection plus AVD start/stop
- Orientation, night mode, font scale, network, GPS location, and route playback
- Logcat filtering, pause/copy controls, app management, file import, and session replay

The browser decoder treats every WebSocket reconnect, device video session, and
hard decoder recovery as a new stream generation. Codec, latency, frame counts,
and rendered state are cleared at each boundary; the UI reports `streaming`
only after a frame from the current generation reaches the canvas. A connected
session with no frame becomes `waiting for video`, while fresh packets that do
not produce frames become `stream stalled`. Late events from older generations
are ignored. Input sent while the video WebSocket is disconnected is dropped
instead of being replayed against a later device session.

## HTTP API

All examples assume the default port:

```sh
BASE=http://localhost:3300
```

### Health And Discovery

```sh
curl "$BASE/health"
curl "$BASE/api"
curl "$BASE/api/devices"
curl "$BASE/api/device-grid"
curl -X POST "$BASE/api/devices/select" \
  -H 'Content-Type: application/json' \
  -d '{"serial":"emulator-5554"}'
```

`/health` includes bounded subprocess executor activity, queue depth, lane
counts, deadlines, overload rejections, and output-limit totals. Device-grid
refreshes reuse one `adb devices` snapshot while resolving running AVD names.
Long install/import work uses a background lane; the default executor reserves
one active slot and eight queue positions for interactive work such as GPS.

AVD lifecycle helpers:

```sh
curl -X POST "$BASE/api/avds/start" \
  -H 'Content-Type: application/json' \
  -d '{"avd":"Pixel_8","select":true}'

curl -X POST "$BASE/api/avds/stop" \
  -H 'Content-Type: application/json' \
  -d '{"serial":"emulator-5554"}'
```

### Input

Coordinates are normalized from `0` to `1` and converted to screen pixels by the server.

```sh
curl -X POST "$BASE/api/tap" \
  -H 'Content-Type: application/json' \
  -d '{"x":0.5,"y":0.5}'

curl -X POST "$BASE/api/swipe" \
  -H 'Content-Type: application/json' \
  -d '{"x1":0.5,"y1":0.8,"x2":0.5,"y2":0.2,"durationMs":350}'

curl -X POST "$BASE/api/text" \
  -H 'Content-Type: application/json' \
  -d '{"text":"hello"}'

curl -X POST "$BASE/api/key" \
  -H 'Content-Type: application/json' \
  -d '{"key":"back"}'
```

Arbitrary keycodes accept an optional `action` (`"down"` or `"up"`; omit for an immediate press) and an optional `metaState` bitmask using Android's `AMETA_*` values (`0x1` shift, `0x2` alt, `0x1000` ctrl):

```sh
# Ctrl+A (select all)
curl -X POST "$BASE/api/key" \
  -H 'Content-Type: application/json' \
  -d '{"keycode":29,"metaState":4096}'

# Hold DPAD_DOWN down, then release it later
curl -X POST "$BASE/api/key" -H 'Content-Type: application/json' -d '{"keycode":20,"action":"down"}'
curl -X POST "$BASE/api/key" -H 'Content-Type: application/json' -d '{"keycode":20,"action":"up"}'
```

### Inspection

```sh
curl "$BASE/api/screenshot" --output screen.png
curl "$BASE/api/screenshot?format=base64"
curl "$BASE/api/foreground"
curl "$BASE/api/accessibility"
curl -X POST "$BASE/api/accessibility/tap" \
  -H 'Content-Type: application/json' \
  -d '{"selector":{"resourceId":"com.example:id/login"}}'
curl -X POST "$BASE/api/accessibility/tap" \
  -H 'Content-Type: application/json' \
  -d '{"selector":{"textContains":"Continue","clickable":true}}'
curl -N "$BASE/api/logcat?package=com.example.app&search=error"
```

Logcat subscriptions share one `adb logcat` child for the active device.
New children start at the live tail instead of replaying the device's buffered
history. Matching lines are delivered in short `logs` SSE batches; each
subscriber has bounded line and byte queues, and batch payloads report
queue/source drop counts. `/health` exposes the active child, subscriber count,
queued bytes, limits, and cumulative delivery/drop totals under `logcat`.
Pausing Logcat in the browser closes its SSE connection, so paused panels do
not keep receiving and discarding device output.

### Device Settings

```sh
curl "$BASE/api/orientation"
curl -X POST "$BASE/api/orientation" \
  -H 'Content-Type: application/json' \
  -d '{"orientation":"landscape"}'

curl "$BASE/api/night-mode"
curl -X POST "$BASE/api/night-mode" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"dark"}'

curl "$BASE/api/font-scale"
curl -X POST "$BASE/api/font-scale" \
  -H 'Content-Type: application/json' \
  -d '{"scale":1.2}'

curl "$BASE/api/network"
curl -X POST "$BASE/api/network" \
  -H 'Content-Type: application/json' \
  -d '{"enabled":false}'
```

### Location And Routes

Location control uses the Android Emulator `geo fix` command and is currently emulator-only.

```sh
curl "$BASE/api/location"
curl -X POST "$BASE/api/location" \
  -H 'Content-Type: application/json' \
  -d '{"latitude":37.5665,"longitude":126.978}'
```

Start route playback from waypoints:

```sh
curl -X POST "$BASE/api/route" \
  -H 'Content-Type: application/json' \
  -d '{"speedKph":30,"multiplier":1,"loop":false,"waypoints":[{"latitude":37.5665,"longitude":126.978},{"latitude":37.5651,"longitude":126.98955}]}'
```

Read, pause, resume, or stop playback:

```sh
curl "$BASE/api/route"
curl -X POST "$BASE/api/route/control" \
  -H 'Content-Type: application/json' \
  -d '{"action":"pause"}'
curl -X DELETE "$BASE/api/route"
```

The browser route importer accepts GPX, KML, GeoJSON, and waypoint JSON files
up to 2 MiB. It rejects oversized files before reading them, parses in a
cancellable Web Worker, and enforces the 10,000-waypoint, nesting, and
complexity limits during traversal. Playback receives the complete validated
waypoint sequence. Map display is separate: it caches projection by route and
zoom, simplifies the line to at most 1,024 screen-space points, and pans it with
one CSS transform per animation frame. The interaction target is one 16.7 ms
frame at 60 Hz. Follow route is explicit; manually panning turns it off so the
one-second status poll does not force the map center back onto the route.

### Sessions

REST and WebSocket input events are recorded by default. Add `"record":false`
to supported input payloads when an event should not be saved. History uses a
2,000-event, 1 MiB circular retention budget; `/health` contains only its
compact count/byte/replay summary. Text is normalized to scrcpy's 300-byte
UTF-8 control limit before both dispatch and recording.

```sh
curl "$BASE/api/session?limit=6"
curl "$BASE/api/session?limit=50&before=1200"
curl "$BASE/api/session/export"
curl -X POST "$BASE/api/session/replay" \
  -H 'Content-Type: application/json' \
  -d '{"multiplier":2}'
curl -X POST "$BASE/api/session/replay/stop"
curl -X DELETE "$BASE/api/session"
```

Session pages are returned in chronological order with an exclusive
`nextBefore` cursor and `hasMore` flag. The bounded full history is serialized
only by the explicit export endpoint (and by the UI's Copy action), rather than
on every poll. The UI requests only its six visible recent events and pauses
polling while the Session panel or browser tab is hidden. `/health` exposes the
last/max UTF-8 response bytes and JSON serialization time for health, session
page, and export responses under `responseMetrics`. The health entry describes
the previous completed `/health` response because the current body is measured
after it is serialized.

### Apps And Files

```sh
curl -X POST "$BASE/api/apps/install" \
  -F apk=@/path/to/app.apk

curl -X POST "$BASE/api/apps/launch" \
  -H 'Content-Type: application/json' \
  -d '{"packageName":"com.example.app","activity":".MainActivity"}'

curl -X POST "$BASE/api/apps/clear" \
  -H 'Content-Type: application/json' \
  -d '{"packageName":"com.example.app"}'

curl -X POST "$BASE/api/apps/force-stop" \
  -H 'Content-Type: application/json' \
  -d '{"packageName":"com.example.app"}'

curl -X POST "$BASE/api/apps/grant" \
  -H 'Content-Type: application/json' \
  -d '{"packageName":"com.example.app","permission":"android.permission.POST_NOTIFICATIONS"}'

curl -X POST "$BASE/api/files/import" \
  -F file=@/path/to/image.png
```

Uploads stream to private asynchronous temporary files and are removed after
ADB completes. Actual bytes are enforced even without `Content-Length`; a
device switch or server shutdown cancels work against the captured old device.
Oversized requests receive `413`, and upload capacity errors are structured
JSON responses. `/health` includes current upload queue metrics.

## WebSocket API

Connect to `/ws` for the raw Annex-B H.264 stream. Send JSON control messages over the same socket:

```json
{"type":"tap","x":0.5,"y":0.5}
{"type":"swipe","x1":0.5,"y1":0.8,"x2":0.5,"y2":0.2,"durationMs":350}
{"type":"text","text":"hello"}
{"type":"key","keycode":66}
{"type":"key","keycode":29,"metaState":4096}
{"type":"key","keycode":20,"action":"down"}
{"type":"back"}
{"type":"reset-video"}
```

Use `/ws?frame-meta=1` to receive a 24-byte `SEMU` v2 frame metadata header before each H.264 access unit: magic `SEMU` (4B), version=2 (1B), flags (1B, bit 0 = keyframe), reserved (2B), PTS (8B BE, µs), and the server send time (8B BE, epoch µs). Same-host clients can compare the send time against their own clock to measure transit and glass-to-glass latency. The bundled UI uses this mode to avoid per-frame NAL scans and to track PTS/keyframe/latency state.

See the [protocol reference](docs/protocol.md) for the complete scrcpy v3/v4 framing, control packet, and `SEMU` v1/v2 wire formats.

## How It Works

```text
+------------------+ adb forward  +-------------+  H.264 / WS   +---------+
| scrcpy-server.jar| <----------> | serve-emu   | ------------> | Browser |
| on device        | TCP tunnel   |   (Bun)     |  WebCodecs    | <canvas>|
|  - video socket  |              |             | <------------ |         |
|  - control socket|              |             |  input JSON   |         |
+------------------+              +-------------+               +---------+
```

1. The CLI pushes `scrcpy-server-v4.0` to `/data/local/tmp/scrcpy-server.jar`.
2. It opens `adb forward tcp:<localPort> localabstract:scrcpy_<scid>`.
3. It spawns `app_process` with the scrcpy server class on the device, then connects video and control sockets through the tunnel.
4. The Bun server reads scrcpy's framed H.264 stream and forwards each access unit as a binary WebSocket message. Raw `/ws` clients receive Annex-B payloads unchanged; the built-in browser UI opts into the 24-byte frame metadata header.
5. The browser configures a `VideoDecoder` from SPS/PPS data and draws decoded frames to a `<canvas>`. Pointer events are normalized to unit coordinates and encoded as scrcpy control socket packets.

## Development

`bun run check` enforces executed-line coverage floors, type checks, build, and package validation. Browser streaming tests separately exercise the built UI and production WebSocket handlers in Chromium, including real H.264 decoding, refresh, multi-tab device switching, input failure delivery, and slow-decoder recovery. See [the browser test guide](https://github.com/jiunshinn/serve-emu/blob/main/packages/serve-emu/tests/browser/README.md).

```sh
bun install
bun run --filter serve-emu setup
bun run --filter serve-emu dev
bun run --filter serve-emu typecheck
bun run --filter serve-emu typecheck:ui
bun run --filter serve-emu build
bun run check
(cd packages/serve-emu && bunx playwright install chromium)
bun run --filter serve-emu test:browser
```

`dev:ui` proxies `/api`, `/health`, and `/ws` to
`http://localhost:3300` by default. To run the backend on another port while
keeping the Vite UI on its normal development origin, start the two processes
like this:

```sh
# terminal 1: backend on a non-default port
bun run packages/serve-emu/src/cli.ts --port 4319

# terminal 2: UI with API, health, and WebSocket proxying to that backend
SERVE_EMU_BACKEND_ORIGIN=http://localhost:4319 bun run --filter serve-emu dev:ui
```

`SERVE_EMU_BACKEND_ORIGIN` only selects the Vite development proxy target. It
does not disable the backend's token or same-origin protections; use the normal
CLI access-control flags when exposing the backend beyond loopback.

The repository-root `README.md` is the authoritative product documentation.
After editing it, regenerate and verify the package copy:

```sh
bun run docs:sync
bun run docs:check
```

For runtime or protocol changes, test with a booted emulator or device:

```sh
adb devices
bun run packages/serve-emu/src/cli.ts
```

Useful manual checks include first video frame, browser refresh recovery, multiple tabs, tap/swipe/text/key input, screenshots, logcat SSE, app management, location, route playback, and session replay.

## Package Rename

The project and npm package are named `serve-emu` again, starting with version
0.0.6. If you installed the temporary `serve-emul` package, switch to:

```sh
bunx serve-emu@latest
# or: npx serve-emu@latest
```

For global installations, run `npm uninstall -g serve-emul` followed by
`npm install -g serve-emu@latest`. The executable is now `serve-emu`.
Development scripts use `packages/serve-emu` and `--filter serve-emu`.
Environment variables use the `SERVE_EMU_` prefix.

## Contributing

See [`CONTRIBUTING.md`](https://github.com/jiunshinn/serve-emu/blob/main/CONTRIBUTING.md) for development setup, validation steps, scrcpy protocol notes, and pull request guidelines.

## License

Apache-2.0. Bundles the upstream [scrcpy](https://github.com/Genymobile/scrcpy) server binary (Apache-2.0) at runtime.
