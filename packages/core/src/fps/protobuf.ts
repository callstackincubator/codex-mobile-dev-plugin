export type ProtoField = { id: number; integer?: bigint; bytes?: Buffer };

export function varint(bytes: Buffer, offset: number): { value: bigint; next: number } | undefined {
  let value = 0n;
  for (let index = 0; index < 10; index++) {
    const byte = bytes[offset + index];
    if (byte === undefined) return;
    if (index === 9 && byte > 1) throw new Error("Invalid Perfetto varint.");
    const part = BigInt(byte & 127);
    const shift = BigInt(index * 7);
    value |= part << shift;
    if (byte < 128) return { value, next: offset + index + 1 };
  }
  throw new Error("Invalid Perfetto varint.");
}

export function* fields(bytes: Buffer): Generator<ProtoField> {
  let offset = 0;
  while (offset < bytes.length) {
    const tag = varint(bytes, offset);
    if (tag === undefined || tag.value === 0n) throw new Error("Invalid Perfetto field.");
    const id = Number(tag.value >> 3n);
    const wire = Number(tag.value & 7n);
    offset = tag.next;
    if (wire === 0) {
      const integer = varint(bytes, offset);
      if (integer === undefined) throw new Error("Truncated Perfetto integer.");
      offset = integer.next;
      yield { id, integer: integer.value };
    } else if (wire === 2) {
      const length = varint(bytes, offset);
      if (length === undefined) throw new Error("Truncated Perfetto length.");
      const size = Number(length.value);
      const end = length.next + size;
      if (end > bytes.length) throw new Error("Truncated Perfetto message.");
      const data = bytes.subarray(length.next, end);
      offset = end;
      yield { id, bytes: data };
    } else if (wire === 1 || wire === 5) {
      offset += wire === 1 ? 8 : 4;
      if (offset > bytes.length) throw new Error("Truncated Perfetto field.");
    } else throw new Error("Unsupported Perfetto field encoding.");
  }
}

export class TraceStream {
  private pending = Buffer.alloc(0);
  private packet: (packet: Buffer) => void;
  constructor(packet: (packet: Buffer) => void) { this.packet = packet; }
  push(chunk: Buffer) {
    const bytes = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    let offset = 0;
    while (offset < bytes.length) {
      if (bytes[offset] !== 10) throw new Error("Invalid Perfetto trace stream.");
      const length = varint(bytes, offset + 1);
      if (length === undefined) break;
      const size = Number(length.value);
      if (size > 1024 * 1024) throw new Error("Perfetto packet exceeds the streaming limit.");
      const end = length.next + size;
      if (end > bytes.length) break;
      const packet = bytes.subarray(length.next, end);
      this.packet(packet);
      offset = end;
    }
    const remainder = bytes.subarray(offset);
    this.pending = Buffer.from(remainder);
  }
}
