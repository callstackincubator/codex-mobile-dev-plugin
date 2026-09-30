export type AndroidVideoBatch = { generation: number; sequence: number; packets: { sequence: number; data: string }[] };

export function videoPacket(bytes: Uint8Array) {
  let timestamp: number | undefined;
  if (bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) === 0x53454d55) {
    if (bytes.length < 16) throw new Error("Invalid Android video header.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint8(4);
    const length = version === 2 ? 24 : version === 1 ? 16 : 0;
    if (!length || bytes.length <= length) throw new Error("Invalid Android video header.");
    const pts = view.getBigUint64(8);
    if (pts <= BigInt(Number.MAX_SAFE_INTEGER)) timestamp = Number(pts);
    bytes = bytes.subarray(length);
  }
  let key = false;
  let codec: string | undefined;
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] || bytes[i + 1]) continue;
    const start = bytes[i + 2] === 1 ? i + 3 : bytes[i + 2] === 0 && bytes[i + 3] === 1 ? i + 4 : -1;
    if (start < 0 || start >= bytes.length) continue;
    const type = bytes[start] & 31;
    if (type === 5) key = true;
    if (type === 7 && start + 3 < bytes.length) codec = `avc1.${[bytes[start + 1], bytes[start + 2], bytes[start + 3]].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
    i = start;
  }
  return { bytes, timestamp, key, codec };
}
