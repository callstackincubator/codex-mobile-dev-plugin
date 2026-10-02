# Streaming and control protocol reference

<!-- scrcpy-server-version: 4.0 -->

This document is the source of truth for the binary protocols implemented by
`serve-emu`. The vendored device server is scrcpy **4.0**, pinned by
`scripts/fetch-scrcpy.ts`. The host parser remains compatible with the scrcpy v3
and v4 stream layouts so that protocol changes fail explicitly instead of being
mistaken for video data.

The scrcpy socket protocol is an upstream implementation detail and may change
between scrcpy releases. `SEMU` is the separate `serve-emu` WebSocket metadata
format. Unless a field says otherwise, every multi-byte integer below is
big-endian.

## scrcpy transport

The host creates an adb forward from `tcp:<port>` to
`localabstract:scrcpy_<scid>`, starts the device server with audio disabled and
video and control enabled, then opens two TCP connections through that forward:

1. the video socket, carrying the device/codec preamble and framed Annex-B video;
2. the control socket, carrying input and video-reset messages.

The device waits for every enabled socket before streaming. With
`send_dummy_byte=true`, current upstream scrcpy writes one `0x00` dummy byte to
the first enabled socket, rather than one byte to every socket. The host must not
blindly discard the first byte: `parseVideoPreamble()` accepts the video preamble
at offset 0 or 1 and validates its codec and dimensions. The control socket is
drained for any device-to-host events that this package does not consume.

## Video preamble

Both supported layouts begin with a 64-byte UTF-8 device name, padded with NUL
bytes. An optional dummy byte may precede it.

| Protocol | Bytes after the device name |
| --- | --- |
| v3 | `u32 codec_id`, `u32 width`, `u32 height` (12 bytes) |
| v4 | `u32 codec_id`, followed by a normal 12-byte session packet: `u32 session_flags`, `u32 width`, `u32 height` (16 bytes total) |

The v4 fields are not a new monolithic codec-metadata structure: the codec id is
immediately followed by the same session record that may appear later in the
packet stream. Its `session_flags` field has bit 31 set; bit 0 is the
`client_resized` flag. Dimensions must be between 1 and 16,384 inclusive.

Recognized FourCC values are:

| Hex | Codec |
| --- | --- |
| `0x68323634` | H.264 (`h264`) |
| `0x68323635` | H.265 (`h265`) |
| `0x00617631` | AV1 (`av1`) |

The bundled browser UI currently supports H.264 only. A valid H.265 or AV1
preamble is therefore reported as an unsupported-codec error rather than passed
to WebCodecs.

## Video packets

Every packet begins with a 12-byte header. Video-frame payloads are Annex-B NAL
units and must be from 1 byte through 16 MiB. The host caps the total buffered
reader data at 32 MiB. EOF is clean only at a packet boundary; partial headers or
payloads are protocol errors.

### scrcpy v3 frame header

| Bits/bytes | Meaning |
| --- | --- |
| PTS bit 63 | codec configuration packet |
| PTS bit 62 | key frame |
| PTS bits 0-61 | presentation timestamp in microseconds |
| bytes 8-11 | `u32` payload size |

The first eight bytes are a single `u64` containing the flags and PTS. Both flag
bits are cleared before the PTS is exposed to callers.

### scrcpy v4 packet header

For a video frame, the 12 bytes are:

| Bits/bytes | Meaning |
| --- | --- |
| PTS bit 63 | session packet (not a video frame) |
| PTS bit 62 | codec configuration packet |
| PTS bit 61 | key frame |
| PTS bits 0-60 | presentation timestamp in microseconds |
| bytes 8-11 | `u32` payload size |

When bit 63 is set, the same 12 bytes are a session packet instead:

| Bytes | Meaning |
| --- | --- |
| 0-3 | `u32 flags`: bit 31 = session, bit 0 = client resized |
| 4-7 | `u32 width` |
| 8-11 | `u32 height` |

A session packet has no following video payload. It updates the active stream
dimensions; in particular, a packet with bit 0 set reports a client resize.
Codec-configuration packets set bit 62 and carry no meaningful PTS (the lower
PTS bits are zero in the upstream v4 stream).

Codec-configuration packets contain SPS/PPS data. `serve-emu` caches the latest
configuration and prepends it to key frames so that a browser joining or
refreshing mid-stream can initialize its decoder. Slow clients drop frames until
the next key frame and may request a video reset.

## Control socket packets

The current scrcpy 4.0 server accepts the following messages written by
`src/input.ts`. Message type and action fields are unsigned bytes; actions are
`0` down, `1` up, and `2` move.

| Operation | Type | Wire layout | Size |
| --- | --- | --- | --- |
| Inject keycode | `0` | `u8 type`, `u8 action`, `i32 keycode`, `i32 repeat`, `i32 meta_state` | 14 bytes |
| Inject text | `1` | `u8 type`, `u32 utf8_length`, UTF-8 bytes | 5 + N bytes |
| Inject touch | `2` | `u8 type`, `u8 action`, `u64 pointer_id`, `i32 x`, `i32 y`, `u16 screen_width`, `u16 screen_height`, `u16 pressure`, `u32 action_button`, `u32 buttons` | 32 bytes |
| Back or screen-on | `4` | `u8 type`, `u8 action` | 2 bytes |
| Reset video | `17` | `u8 type` | 1 byte |

Text is capped at 300 UTF-8 bytes and truncated only at a Unicode character
boundary. HTTP/WebSocket gesture coordinates are normalized from 0 through 1,
then converted to screen pixels before the touch packet is encoded. Home,
Recents, and Power use inject-keycode packets; Back uses type 4. Input must stay
on this socket rather than falling back to `adb shell input`, which adds
significant latency.

## `SEMU` WebSocket frame metadata

Plain `/ws` clients receive the raw Annex-B access unit in each binary WebSocket
message. Clients connecting to `/ws?frame-meta=1` receive one `SEMU` header
followed by the Annex-B access unit. There is no payload-length field because the
WebSocket message boundary supplies it.

### v1 (16 bytes)

| Bytes | Meaning |
| --- | --- |
| 0-3 | magic `SEMU` (`0x53454d55`) |
| 4 | version `1` |
| 5 | flags; bit 0 = key frame |
| 6-7 | reserved, zero |
| 8-15 | `u64` scrcpy PTS in microseconds |

### v2 (24 bytes)

v2 keeps all v1 fields and appends:

| Bytes | Meaning |
| --- | --- |
| 16-23 | `u64` server send time as Unix-epoch microseconds |

The server writer always emits v2. The shared browser/server parser accepts v1,
v2, and raw Annex-B messages. Unknown magic or version values are treated as raw
payloads. A PTS larger than JavaScript's safe integer range is exposed as
`null`; v1 and raw messages have no server send time.

## WebSocket JSON control and timing

Gesture messages accept an optional `requestId` (1–128 characters); success and
failure acknowledgements echo it. `ack: false` suppresses gesture acknowledgements.
The bundled UI requests acknowledgements for touch down/up and keyboard input,
while coalesced pointer moves use `ack: false`. A disconnected client's remaining
touches are released on the same device session, with distinct wire pointer IDs
for each client.

A timing request `{ "type": "clock-sync", "clientTsMs": 1000 }` receives
`{ "type": "clock-sync", "clientTsMs": 1000, "serverTsMs": 1005 }`.
Both timestamps are epoch milliseconds; the response is a timing sample, not a
control acknowledgement, and does not dispatch or record device input. The UI
uses the lowest-RTT sample from the last minute to estimate clock offset. Transit
and server-to-canvas values are estimates with an RTT/2 uncertainty; they remain
unavailable until synchronization succeeds. They exclude device capture/encoding
and compositor scanout. Decode and presentation-wait p95 use only the browser's
local clock and need no synchronization.

The worker sheds queued decode work by waiting for a keyframe when pending decode
age exceeds 250 ms (with a hard cap of 48 queued operations). An idle hardware
pipeline with no queued decode work does not trigger recovery.

## Golden byte sequences

These examples use H.264, dimensions 1080 (`0x0438`) by 1920 (`0x0780`), and
PTS 42 (`0x2a`). They are mirrored by the parser fixtures and must change
together with this document.

```text
v3-preamble-tail: 683236340000043800000780
v4-preamble-tail: 68323634800000000000043800000780
v3-key-header:    400000000000002a00000004
v4-key-header:    200000000000002a00000004
v4-resize:        800000010000043800000780
semu-v1:          53454d5501010000000000000000002a
semu-v2:          53454d5502010000000000000000002a00000000000f4240
```

The `SEMU` examples set the key-frame flag. The v2 send timestamp is 1,000,000
microseconds (1,000 milliseconds after the Unix epoch). A video payload follows
each `SEMU` header in an actual WebSocket message.

## scrcpy upgrade checklist

Treat a scrcpy server bump as a protocol change, even when upstream release
notes do not call one out.

1. Change `SCRCPY_VERSION` in `scripts/fetch-scrcpy.ts` and fetch the new server.
2. Compare upstream `DesktopConnection`, `Streamer`, `ControlMessage`,
   `ControlMessageReader`, and server-option parsing with the pinned version.
3. Revalidate socket order and dummy-byte behavior; the device-name and stream
   preambles; v3/v4 session, configuration, and key-frame flags; PTS masking;
   payload bounds; and every encoder in `src/input.ts`.
4. Update the fixture version and golden bytes used by the scrcpy frame and
   `SEMU` tests. Update the version marker at the top of this file and any
   README version references in the same change.
5. Run the focused parser, frame-metadata, protocol-document, and README-sync
   tests, then run `bun run check` from the repository root.
6. With a booted emulator or device, verify the first video frame, browser
   refresh recovery, orientation/size changes, reset-video recovery, tap,
   swipe, text, key, Back, and multiple simultaneous clients.
7. Pack the npm workspace and confirm that its generated `README.md` and this
   `docs/protocol.md` are present and that every local link resolves inside the
   packed package.
