// SEMU frame-meta wire format, shared by the server writer (server.ts) and
// the browser worker reader (ui/lib/stream-worker.ts) so the header layout
// can never drift between the two. This module must stay runtime-neutral:
// no Bun/Node APIs (the UI tsconfig compiles it with DOM lib only).
// Canonical wire spec and golden examples: ../../docs/protocol.md
//
// Header layout (big-endian):
//   [0..3]   u32 magic "SEMU"
//   [4]      u8  version
//   [5]      u8  flags (bit 0 = keyframe)
//   [6..7]   u16 reserved, 0
//   [8..15]  u64 pts from scrcpy (µs)
//   [16..23] u64 server send time as epoch µs (v2 only), so a same-host
//            client can measure transit and glass-to-glass latency against
//            its own clock.

export const FRAME_META_MAGIC = 0x53454d55; // "SEMU"
const FRAME_META_VERSION = 2;
export const FRAME_META_V1_HEADER_BYTES = 16;
export const FRAME_META_HEADER_BYTES = 24;
export const FRAME_FLAG_KEY = 1 << 0;

export type ParsedFramePacket = {
  data: Uint8Array;
  /** null when the packet has no SEMU header (raw Annex-B passthrough). */
  isKey: boolean | null;
  /** pts in µs; null without a header or when the pts exceeds Number range. */
  timestamp: number | null;
  /** Server send time in epoch ms; null for v1 headers or raw packets. */
  serverTsMs: number | null;
};

export const epochNowMs = () => performance.timeOrigin + performance.now();

/** Write a v2 frame-meta header into the first FRAME_META_HEADER_BYTES of `target`. */
export function writeFrameMetaHeader(
  target: Uint8Array,
  meta: { isKey: boolean; pts: bigint; serverTsMs: number },
): void {
  const view = new DataView(target.buffer, target.byteOffset, FRAME_META_HEADER_BYTES);
  view.setUint32(0, FRAME_META_MAGIC, false);
  view.setUint8(4, FRAME_META_VERSION);
  view.setUint8(5, meta.isKey ? FRAME_FLAG_KEY : 0);
  view.setUint16(6, 0, false);
  view.setBigUint64(8, meta.pts, false);
  view.setBigUint64(16, BigInt(Math.round(meta.serverTsMs * 1000)), false);
}

/**
 * Split a WebSocket video message into header fields and H.264 payload.
 * Understands v2 and v1 headers; anything else is treated as raw Annex-B.
 */
export function parseFramePacket(raw: ArrayBuffer | Uint8Array): ParsedFramePacket {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  if (bytes.byteLength > FRAME_META_V1_HEADER_BYTES) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, false) === FRAME_META_MAGIC) {
      const version = view.getUint8(4);
      const isKey = (view.getUint8(5) & FRAME_FLAG_KEY) !== 0;
      const pts = view.getBigUint64(8, false);
      const timestamp = pts <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(pts) : null;
      if (version === FRAME_META_VERSION && bytes.byteLength > FRAME_META_HEADER_BYTES) {
        return {
          data: bytes.subarray(FRAME_META_HEADER_BYTES),
          isKey,
          timestamp,
          serverTsMs: Number(view.getBigUint64(16, false)) / 1000,
        };
      }
      if (version === 1) {
        return { data: bytes.subarray(FRAME_META_V1_HEADER_BYTES), isKey, timestamp, serverTsMs: null };
      }
    }
  }
  return { data: bytes, isKey: null, timestamp: null, serverTsMs: null };
}
