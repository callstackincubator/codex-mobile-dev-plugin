import { crc32 } from "node:zlib";
import type { EntryType } from "../../shared/app-storage.ts";
import { jsonType, readVarint, utf8Text } from "./encoding.ts";

// MMKV's on-disk format, from Tencent/MMKV Core (MMKV_IO.cpp, MiniPBCoder.cpp, MMKVMetaInfo.hpp):
// - `<id>` holds a 4-byte header, then a placeholder varint and appended records of
//   varint key length, key, varint value length, value. Later records win; an empty value removes the key.
// - `<id>.crc` holds the CRC, version, write sequence, AES IV, and since version 3 the data size.
//   Version 4 adds flags at byte 104; flag 1 appends a 4-byte expiry time to every value.
// Values carry no type, so callers guess one from the bytes.

export type MmkvRecord = { key: string; value: Buffer };
export type MmkvFile =
  | { status: "ok"; records: MmkvRecord[]; crcValid: boolean | undefined }
  | { status: "encrypted" }
  | { status: "unreadable"; reason: string };

const versionRandomIv = 2;
const versionActualSize = 3;
const versionFlag = 4;
const flagKeyExpire = 1n;

function lengthDelimited(buffer: Buffer, offset: number) {
  const length = readVarint(buffer, offset, 5);
  if (length === undefined) throw new Error("truncated length");
  const end = length.next + Number(length.value);
  if (end > buffer.length) throw new Error("record runs past the data size");
  return { bytes: buffer.subarray(length.next, end), next: end };
}

export function decodeMmkv(data: Buffer, meta?: Buffer): MmkvFile {
  const version = meta && meta.length >= 8 ? meta.readUInt32LE(4) : 0;
  if (meta && meta.length >= 28 && version >= versionRandomIv && meta.subarray(12, 28).some(byte => byte !== 0)) return { status: "encrypted" };
  if (data.length < 4) return { status: "ok", records: [], crcValid: undefined };
  const size = meta && meta.length >= 32 && version >= versionActualSize ? meta.readUInt32LE(28) : data.readUInt32LE(0);
  if (size + 4 > data.length) return { status: "unreadable", reason: "The file is shorter than its recorded size." };
  const body = data.subarray(4, 4 + size);
  const crcValid = meta && meta.length >= 4 ? crc32(body) === meta.readUInt32LE(0) : undefined;
  const expiring = meta !== undefined && meta.length >= 112 && version >= versionFlag && (meta.readBigUInt64LE(104) & flagKeyExpire) !== 0n;
  const now = Math.floor(Date.now() / 1000);
  const records = new Map<string, Buffer>();
  try {
    let offset = 0;
    if (body.length > 0) {
      const placeholder = readVarint(body, 0, 5);
      if (placeholder === undefined) throw new Error("missing header");
      offset = placeholder.next;
    }
    while (offset < body.length) {
      const key = lengthDelimited(body, offset);
      offset = key.next;
      // MMKV skips records with an empty key without reading a value.
      if (key.bytes.length === 0) continue;
      const value = lengthDelimited(body, offset);
      offset = value.next;
      const name = key.bytes.toString("utf8");
      let bytes = value.bytes;
      if (expiring && bytes.length >= 4) {
        const expiresAt = bytes.readUInt32LE(bytes.length - 4);
        bytes = bytes.subarray(0, bytes.length - 4);
        if (expiresAt !== 0 && expiresAt <= now) { records.delete(name); continue; }
      }
      if (value.bytes.length === 0) records.delete(name);
      else records.set(name, bytes);
    }
  } catch (error) {
    return { status: "unreadable", reason: `The data does not decode as MMKV (${error instanceof Error ? error.message : "invalid"}).` };
  }
  return { status: "ok", records: [...records].map(([key, value]) => ({ key, value })), crcValid };
}

// Same tie-breaking order as Rozenite's MMKV adapter: strings, then byte buffers, then numbers, then booleans.
// A single 0x00 byte is either false or an empty string; it reads as false.
export function guessMmkvValue(bytes: Buffer): { type: EntryType; value: string } {
  const prefix = readVarint(bytes, 0, 5);
  if (bytes.length > 1 && prefix && prefix.next + Number(prefix.value) === bytes.length) {
    const payload = bytes.subarray(prefix.next);
    const string = utf8Text(payload);
    if (string !== undefined) return { type: jsonType(string) ?? "string", value: string };
    return { type: "data", value: payload.toString("hex") };
  }
  if (bytes.length === 1 && bytes[0] <= 1) return { type: "boolean", value: bytes[0] === 1 ? "true" : "false" };
  if (bytes.length === 8) {
    const number = bytes.readDoubleLE(0);
    if (Number.isFinite(number)) return { type: "number", value: String(number) };
  }
  const varint = readVarint(bytes, 0);
  if (varint && varint.next === bytes.length) return { type: "integer", value: BigInt.asIntN(64, varint.value).toString() };
  if (bytes.length === 4) {
    const number = bytes.readFloatLE(0);
    if (Number.isFinite(number)) return { type: "number", value: String(number) };
  }
  return { type: "data", value: bytes.toString("hex") };
}
