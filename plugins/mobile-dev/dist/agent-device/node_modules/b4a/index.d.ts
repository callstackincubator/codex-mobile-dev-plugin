import { BufferEncoding } from './runtime'

export function isBuffer(value: unknown): value is Uint8Array

export function isEncoding(encoding: unknown): encoding is BufferEncoding

export function alloc(size: number, fill: string, encoding?: BufferEncoding): Uint8Array
export function alloc(size: number, fill?: Uint8Array | number | boolean): Uint8Array

export function allocUnsafe(size: number): Uint8Array

export function allocUnsafeSlow(size: number): Uint8Array

export function byteLength(
  string: ArrayBufferView | ArrayBufferLike | string,
  encoding?: BufferEncoding
): number

export function compare(a: Uint8Array, b: Uint8Array): number

export function concat<T extends Uint8Array>(buffers: T[], totalLength?: number): Uint8Array

export function copy(
  source: Uint8Array,
  target: Uint8Array,
  targetStart?: number,
  start?: number,
  end?: number
): number

export function equals(a: Uint8Array, b: Uint8Array): boolean

export function fill<T extends Uint8Array>(buffer: T, value: string, encoding?: BufferEncoding): T
export function fill<T extends Uint8Array>(
  buffer: T,
  value: string,
  offset?: number,
  encoding?: BufferEncoding
): T
export function fill<T extends Uint8Array>(
  buffer: T,
  value: string,
  offset?: number,
  end?: number,
  encoding?: BufferEncoding
): T
export function fill<T extends Uint8Array>(
  buffer: T,
  value: Uint8Array | number | boolean,
  offset?: number,
  end?: number
): T

export function from(value: Iterable<number>): Uint8Array
export function from(value: ArrayLike<number>): Uint8Array
export function from(value: string, encodingOrOffset?: BufferEncoding): Uint8Array
export function from(value: ArrayBufferLike, encodingOrOffset?: number, length?: number): Uint8Array

export function includes(buffer: Uint8Array, value: string, encoding?: BufferEncoding): boolean
export function includes(
  buffer: Uint8Array,
  value: string,
  offset?: number,
  encoding?: BufferEncoding
): boolean
export function includes(
  buffer: Uint8Array,
  value: Uint8Array | number | boolean,
  offset?: number
): boolean

export function indexOf(buffer: Uint8Array, value: string, encoding?: BufferEncoding): number
export function indexOf(
  buffer: Uint8Array,
  value: string,
  byfeOffset?: number,
  encoding?: BufferEncoding
): number
export function indexOf(
  buffer: Uint8Array,
  value: Uint8Array | number | boolean,
  byfeOffset?: number
): number

export function lastIndexOf(buffer: Uint8Array, value: string, encoding?: BufferEncoding): number
export function lastIndexOf(
  buffer: Uint8Array,
  value: string,
  offset?: number,
  encoding?: BufferEncoding
): number
export function lastIndexOf(
  buffer: Uint8Array,
  value: Uint8Array | number | boolean,
  offset?: number
): number

export function swap16<T extends Uint8Array>(buffer: T): T
export function swap32<T extends Uint8Array>(buffer: T): T
export function swap64<T extends Uint8Array>(buffer: T): T

export function toBuffer(buffer: Uint8Array): Uint8Array

export function toString(
  buffer: Uint8Array,
  encoding?: BufferEncoding,
  start?: number,
  end?: number
): string

export function toHex(buffer: Uint8Array, start?: number, end?: number): string

export function write(buffer: Uint8Array, string: string, encoding?: BufferEncoding): number
export function write(
  buffer: Uint8Array,
  string: string,
  offset?: number,
  encoding?: BufferEncoding
): number
export function write(
  buffer: Uint8Array,
  string: string,
  offset?: number,
  length?: number,
  encoding?: BufferEncoding
): number

export function readDoubleBE(buffer: Uint8Array, offset?: number): number
export function readDoubleLE(buffer: Uint8Array, offset?: number): number
export function readFloatBE(buffer: Uint8Array, offset?: number): number
export function readFloatLE(buffer: Uint8Array, offset?: number): number
export function readInt32BE(buffer: Uint8Array, offset?: number): number
export function readInt32LE(buffer: Uint8Array, offset?: number): number
export function readUInt32BE(buffer: Uint8Array, offset?: number): number
export function readUInt32LE(buffer: Uint8Array, offset?: number): number

export function writeDoubleBE(buffer: Uint8Array, value: number, offset?: number): number
export function writeDoubleLE(buffer: Uint8Array, value: number, offset?: number): number
export function writeFloatBE(buffer: Uint8Array, value: number, offset?: number): number
export function writeFloatLE(buffer: Uint8Array, value: number, offset?: number): number
export function writeInt32BE(buffer: Uint8Array, value: number, offset?: number): number
export function writeInt32LE(buffer: Uint8Array, value: number, offset?: number): number
export function writeUInt32BE(buffer: Uint8Array, value: number, offset?: number): number
export function writeUInt32LE(buffer: Uint8Array, value: number, offset?: number): number
