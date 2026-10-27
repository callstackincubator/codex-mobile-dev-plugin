// Byte-level helpers shared by the MMKV, protobuf, and file decoders.

export function readVarint(buffer: Buffer, offset: number, limit = 10): { value: bigint; next: number } | undefined {
  let value = 0n;
  let shift = 0n;
  for (let index = 0; index < limit; index++) {
    if (offset + index >= buffer.length) return undefined;
    const byte = buffer[offset + index];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, next: offset + index + 1 };
    shift += 7n;
  }
  return undefined;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });
// Bytes as text, or undefined when they are not valid UTF-8 or hold control characters other than whitespace,
// which means binary data that happens to decode.
export function utf8Text(bytes: Buffer): string | undefined {
  try {
    const value = utf8.decode(bytes);
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? undefined : value;
  } catch { return undefined; }
}

export function jsonType(value: string): "json" | undefined {
  const trimmed = value.trim();
  if (!/^[[{]/.test(trimmed)) return undefined;
  try { JSON.parse(trimmed); return "json"; } catch { return undefined; }
}
