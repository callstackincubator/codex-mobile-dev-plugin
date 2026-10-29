import EventEmitter, { EventMap } from 'bare-events'
import Buffer, { BufferEncoding } from 'bare-buffer'
import URL from 'bare-url'
import { Readable, Writable } from 'bare-stream'
import promises from './promises'
import constants from './lib/constants'

export { promises, constants }

export type Path = string | Buffer | URL

export type Flag =
  | 'a'
  | 'a+'
  | 'as'
  | 'as+'
  | 'ax'
  | 'ax+'
  | 'r'
  | 'r+'
  | 'rs'
  | 'rs+'
  | 'sa'
  | 'sa+'
  | 'sr'
  | 'sr+'
  | 'w'
  | 'w+'
  | 'wx'
  | 'wx+'
  | 'xa'
  | 'xa+'
  | 'xw'
  | 'xw+'

interface Callback<A extends unknown[] = []> {
  (err: Error | null, ...args: A): void
}

export interface Dir<T extends string | Buffer = string | Buffer>
  extends Iterable<Dirent>, AsyncIterable<Dirent> {
  /** The path of the directory. */
  readonly path: string

  /**
   * Read the next entry from the directory.
   * @returns The next `Dirent` for the directory, or `null` once every entry has been read.
   */
  read(): Promise<Dirent<T> | null>
  read(cb: Callback<[dirent: Dirent<T> | null]>): void
  /**
   * Read the next entry from the directory.
   * @returns The next `Dirent` for the directory, or `null` once every entry has been read.
   */
  readSync(): Dirent<T> | null

  /** Close the directory handle opened by `fs.opendir()`. */
  close(): Promise<void>
  close(cb: Callback): void
  /** Close the directory handle opened by `fs.opendirSync()`. */
  closeSync(): void
}

export class Dir {
  private constructor(path: string, handle: ArrayBuffer, opts?: OpendirOptions)
}

export interface Dirent<T extends string | Buffer = string | Buffer> {
  /** The path of the parent directory. */
  readonly parentPath: string
  /** The name of the directory entry, as a string or `Buffer` depending on the encoding. */
  readonly name: T
  /** The numeric type of the directory entry. */
  readonly type: number

  /** Returns `true` if the file is a regular file. */
  isFile(): boolean
  /** Returns `true` if the file is a directory. */
  isDirectory(): boolean
  /** Returns `true` if the file is a symbolic link. Only meaningful when using `fs.lstat()`. */
  isSymbolicLink(): boolean
  /** Returns `true` if the file is a FIFO (named pipe). */
  isFIFO(): boolean
  /** Returns `true` if the file is a socket. */
  isSocket(): boolean
  /** Returns `true` if the file is a character device. */
  isCharacterDevice(): boolean
  /** Returns `true` if the file is a block device. */
  isBlockDevice(): boolean
}

export class Dirent<T extends string | Buffer = string | Buffer> {
  private constructor(parentPath: string, name: T, type: number)
}

export interface Stats {
  /** The device identifier. */
  readonly dev: number
  /** The file mode (type and permissions). */
  readonly mode: number
  /** The number of hard links. */
  readonly nlink: number
  /** The user identifier of the file owner. */
  readonly uid: number
  /** The group identifier of the file owner. */
  readonly gid: number
  /** The device identifier for special files. */
  readonly rdev: number
  /** The file system block size for I/O operations. */
  readonly blksize: number
  /** The inode number. */
  readonly ino: number
  /** The size of the file in bytes. */
  readonly size: number
  /** The number of 512-byte blocks allocated. */
  readonly blocks: number
  /** The access time in milliseconds since the epoch. */
  readonly atimeMs: number
  /** The modification time in milliseconds since the epoch. */
  readonly mtimeMs: number
  /** The change time in milliseconds since the epoch. */
  readonly ctimeMs: number
  /** The creation time in milliseconds since the epoch. */
  readonly birthtimeMs: number
  /** The access time as a `Date` object. */
  readonly atime: Date
  /** The modification time as a `Date` object. */
  readonly mtime: Date
  /** The change time as a `Date` object. */
  readonly ctime: Date
  /** The creation time as a `Date` object. */
  readonly birthtime: Date

  isDirectory(): boolean
  isFile(): boolean
  isBlockDevice(): boolean
  isCharacterDevice(): boolean
  isFIFO(): boolean
  isSymbolicLink(): boolean
  isSocket(): boolean
}

export class Stats {
  private constructor(
    dev: number,
    mode: number,
    nlink: number,
    uid: number,
    gid: number,
    rdev: number,
    blksize: number,
    ino: number,
    size: number,
    blocks: number,
    atimeMs: number,
    mtimeMs: number,
    ctimeMs: number,
    birthtimeMs: number
  )
}

export interface StatFs {
  readonly type: number
  readonly bsize: number
  readonly blocks: number
  readonly bfree: number
  readonly bavail: number
  readonly files: number
  readonly ffree: number
  readonly frsize: number
}

export class StatFs {
  private constructor(
    type: number,
    bsize: number,
    blocks: number,
    bfree: number,
    bavail: number,
    files: number,
    ffree: number,
    frsize: number
  )
}

/**
 * Options for `fs.createReadStream()`. `fd`, if given, is used instead of opening `path`. `flags`
 * defaults to `'r'` and `mode` to `0o666`. `start` (default `0`) is the first byte read; `end`, if
 * given, is the last byte read (inclusive).
 */
export interface ReadStreamOptions {
  /** The underlying file descriptor. */
  fd?: number
  /** The flags the file was opened with. */
  flags?: Flag
  mode?: number
  start?: number
  end?: number
}

export interface ReadStream extends Readable {
  readonly path: string | null
  readonly fd: number
  readonly flags: Flag
  readonly mode: number
}

export class ReadStream {
  private constructor(path: Path | null, opts?: ReadStreamOptions)
}

/**
 * Create a readable stream for a file. Returns a `ReadStream`.
 * @param path - May be `null` if `opts.fd` specifies an already-open file descriptor to read from
 * instead of opening `path`.
 * @param opts - `flags` defaults to `'r'`, `mode` to `0o666`, `start` (byte offset) to `0`; `end`
 * (inclusive byte offset), if given, stops the stream early.
 */
export function createReadStream(path: Path | null, opts?: ReadStreamOptions): ReadStream

/**
 * Options for `fs.createWriteStream()`. `fd`, if given, is used instead of opening `path`. `flags`
 * defaults to `'w'` and `mode` to `0o666`.
 */
export interface WriteStreamOptions {
  fd?: number
  flags?: Flag
  mode?: number
}

export interface WriteStream extends Writable {
  readonly path: string | null
  readonly fd: number
  readonly flags: Flag
  readonly mode: number
}

export class WriteStream {
  private constructor(path: Path | null, opts?: WriteStreamOptions)
}

/**
 * Create a writable stream for a file. Returns a `WriteStream`.
 * @param path - May be `null` if `opts.fd` specifies an already-open file descriptor to write to
 * instead of opening `path`.
 * @param opts - `flags` defaults to `'w'`, `mode` to `0o666`.
 */
export function createWriteStream(path: Path | null, opts?: WriteStreamOptions): WriteStream

/**
 * Options for `fs.watch()`. `persistent` defaults to `true` (if `false`, the watcher is `unref()`'d
 * immediately so it does not keep the process alive). `recursive` defaults to `false` and also
 * watches subdirectories. `encoding` defaults to `'utf8'`.
 */
export interface WatcherOptions {
  persistent?: boolean
  recursive?: boolean
  encoding?: BufferEncoding | 'buffer'
}

export type WatcherEventType = 'rename' | 'change'

export interface WatcherEvents<T extends string | Buffer = string | Buffer> extends EventMap {
  error: [err: Error]
  change: [eventType: WatcherEventType, filename: T | null]
  /** Emitted once the watcher has stopped watching. */
  close: []
}

export interface Watcher<T extends string | Buffer = string | Buffer>
  extends
    EventEmitter<WatcherEvents<T>>,
    AsyncIterable<{ eventType: WatcherEventType; filename: T | null }> {
  /** Stop watching for further changes. Once closed, a `close` event is emitted. */
  close(): void
  /** Prevent the event loop from exiting while the watcher is active. */
  ref(): void
  /** Allow the event loop to exit even if the watcher is still active. */
  unref(): void
}

export class Watcher {
  private constructor(path: Path, opts: WatcherOptions)
}

/**
 * Check whether the file at `filepath` is accessible. `mode` defaults to `fs.constants.F_OK`.
 * @param mode - Defaults to `fs.constants.F_OK` (existence only); may also combine `R_OK`, `W_OK`,
 * and/or `X_OK`.
 */
export function access(filepath: Path, mode?: number): Promise<void>

export function access(filepath: Path, mode: number, cb: Callback): void

export function access(filepath: Path, cb: Callback): void

export function accessSync(filepath: Path, mode?: number): void

export interface AppendFileOptions {
  encoding?: BufferEncoding
  flag?: string
  mode?: number
}

/**
 * Append `data` to a file, creating it if it does not exist. Accepts the same options as
 * `fs.writeFile()` but defaults to the `'a'` flag.
 */
export function appendFile(
  filepath: Path,
  data: string | Buffer | ArrayBufferView,
  opts?: AppendFileOptions
): Promise<void>

export function appendFile(
  filepath: Path,
  data: string | Buffer | ArrayBufferView,
  encoding: BufferEncoding
): Promise<void>

export function appendFile(
  filepath: Path,
  data: string | Buffer | ArrayBufferView,
  opts: AppendFileOptions,
  cb: Callback
): void

export function appendFile(
  filepath: Path,
  data: string | Buffer | ArrayBufferView,
  encoding: BufferEncoding,
  cb: Callback
): void

export function appendFile(
  filepath: Path,
  data: string | Buffer | ArrayBufferView,
  cb: Callback
): void

export function appendFileSync(
  filepath: Path,
  data: string | Buffer | ArrayBufferView,
  opts?: AppendFileOptions
): void

export function appendFileSync(
  filepath: Path,
  data: string | Buffer | ArrayBufferView,
  encoding: BufferEncoding
): void

/**
 * Change the permissions of a file. `mode` may be a numeric mode or a string that will be parsed as
 * octal.
 */
export function chmod(filepath: Path, mode: string | number): Promise<void>

export function chmod(filepath: Path, mode: string | number, cb: Callback): void

export function chmodSync(filepath: Path, mode: string | number): void

/** Change the owner and group of a file. */
export function chown(filepath: Path, uid: number, gid: number): Promise<void>

export function chown(filepath: Path, uid: number, gid: number, cb: Callback): void

export function chownSync(filepath: Path, uid: number, gid: number): void

/**
 * Close a file descriptor.
 * @param fd - The file descriptor to close, as returned by `fs.open()`.
 */
export function close(fd: number): Promise<void>

export function close(fd: number, cb: Callback): void

/** Close the directory handle opened by `fs.opendirSync()`. */
export function closeSync(fd: number): void

/**
 * Copy a file from `src` to `dst`. `mode` is an optional bitmask created from
 * `fs.constants.COPYFILE_EXCL`, `fs.constants.COPYFILE_FICLONE`, or
 * `fs.constants.COPYFILE_FICLONE_FORCE`.
 * @param mode - Defaults to `0`. A bitmask of `fs.constants.COPYFILE_EXCL` (fail if `dst` exists),
 * `COPYFILE_FICLONE`, or `COPYFILE_FICLONE_FORCE`.
 * @throws {EEXIST} `dst` already exists and `mode` includes `fs.constants.COPYFILE_EXCL`.
 */
export function copyFile(src: Path, dst: Path, mode?: number): Promise<void>

export function copyFile(src: Path, dst: Path, mode: number, cb: Callback): void

export function copyFile(src: Path, dst: Path, cb: Callback): void

export function copyFileSync(src: Path, dst: Path, mode?: number): void

/**
 * Options for `fs.cp()`. `recursive` must be `true` to copy a directory; without it, copying a
 * directory throws `EISDIR`.
 */
export interface CpOptions {
  recursive?: boolean
}

/**
 * Copy a file or directory from `src` to `dst`.
 * @param opts - `recursive` must be `true` to copy a directory; copying a directory without it
 * throws `EISDIR`.
 * @throws {EISDIR} `src` is a directory and `opts.recursive` is not set.
 */
export function cp(src: Path, dst: Path, opts?: CpOptions): Promise<void>

export function cp(src: Path, dst: Path, opts: CpOptions, cb: Callback): void

export function cp(src: Path, dst: Path, cb: Callback): void

export function cpSync(src: Path, dst: Path, opts?: CpOptions): void

/**
 * Check whether a file exists at `filepath`. Returns `true` if the file is accessible, `false`
 * otherwise.
 */
export function exists(filepath: Path): Promise<boolean>

export function exists(filepath: Path, cb: (exists: boolean) => void): void

export function existsSync(filepath: Path): boolean

/** Change the permissions of a file by its file descriptor. */
export function fchmod(fd: number, mode: string | number): Promise<void>

export function fchmod(fd: number, mode: string | number, cb: Callback): void

export function fchmodSync(fd: number, mode: string | number): void

/** Change the owner and group of a file by its file descriptor. */
export function fchown(fd: number, uid: number, gid: number): Promise<void>

export function fchown(fd: number, uid: number, gid: number, cb: Callback): void

export function fchownSync(fd: number, uid: number, gid: number): void

/** Similar to `fsync`, but does not flush modified metadata unless necessary. */
export function fdatasync(fd: number): Promise<void>

export function fdatasync(fd: number, cb: Callback): void

export function fdatasyncSync(fd: number): void

/** Get the status of a file by its file descriptor. Returns a `Stats` object. */
export function fstat(fd: number): Promise<Stats>

export function fstat(fd: number, cb: Callback<[stats: Stats | null]>): void

export function fstatSync(fd: number): Stats

/**
 * Flush all modified in-core data of the file referred by its file descriptor to the disk device.
 */
export function fsync(fd: number): Promise<void>

export function fsync(fd: number, cb: Callback): void

export function fsyncSync(fd: number): void

/** Truncate a file to `len` bytes. `len` defaults to `0`. */
export function ftruncate(fd: number, len?: number): Promise<void>

export function ftruncate(fd: number, len: number, cb: Callback): void

export function ftruncate(fd: number, cb: Callback): void

export function ftruncateSync(fd: number, len?: number): void

/**
 * Change the owner and group of a file, but if `filepath` is a symbolic link, the changes are
 * applied only to the link, not the file it refers to.
 */
export function lchown(filepath: Path, uid: number, gid: number): Promise<void>

export function lchown(filepath: Path, uid: number, gid: number, cb: Callback): void

export function lchownSync(filepath: Path, uid: number, gid: number): void

/**
 * Like `fs.stat()`, but if `filepath` is a symbolic link, the link itself is statted, not the file
 * it refers to.
 */
export function lstat(filepath: Path): Promise<Stats>

export function lstat(filepath: Path, cb: Callback<[stats: Stats | null]>): void

export function lstatSync(filepath: Path): Stats

/**
 * Change the access and modification times of a file. Times may be numbers (seconds since epoch) or
 * `Date` objects.
 */
export function utimes(filepath: Path, atime: number | Date, mtime: number | Date): Promise<void>

export function utimes(
  filepath: Path,
  atime: number | Date,
  mtime: number | Date,
  cb: Callback
): void

export function utimesSync(filepath: Path, atime: number | Date, mtime: number | Date): void

/**
 * Like `fs.utimes()`, but if `filepath` is a symbolic link, the timestamps of the link is changed,
 * not the file it refers to.
 */
export function lutimes(filepath: Path, atime: number | Date, mtime: number | Date): Promise<void>

export function lutimes(
  filepath: Path,
  atime: number | Date,
  mtime: number | Date,
  cb: Callback
): void

export function lutimesSync(filepath: Path, atime: number | Date, mtime: number | Date): void

/**
 * Change the access and modification times of a file by its file descriptor. Times may be numbers
 * (seconds since epoch) or `Date` objects.
 */
export function futimes(fd: number, atime: number | Date, mtime: number | Date): Promise<void>

export function futimes(fd: number, atime: number | Date, mtime: number | Date, cb: Callback): void

export function futimesSync(fd: number, atime: number | Date, mtime: number | Date): void

/** Creates a new link (also known as a hard link) to an existing file. */
export function link(src: Path, dst: Path): Promise<void>

export function link(src: Path, dst: Path, cb: Callback): void

export function linkSync(src: Path, dst: Path): void

/**
 * Options for `fs.mkdir()`. `mode` defaults to `0o777`. `recursive`, if `true`, creates any missing
 * parent directories and does not error if `filepath` already exists as a directory.
 */
export interface MkdirOptions {
  mode?: number
  recursive?: boolean
}

/**
 * Create a directory at `filepath`.
 * @param opts - `mode` defaults to `0o777`. `recursive`, if `true`, creates missing parent
 * directories and does not error if `filepath` already exists as a directory.
 * @throws {ENOENT} a parent directory in `filepath` does not exist and `opts.recursive` is not set.
 * @throws {EEXIST} `filepath` already exists; when `opts.recursive` is set this is only thrown if
 * the existing path is not itself a directory.
 */
export function mkdir(filepath: Path, opts?: MkdirOptions): Promise<void>

export function mkdir(filepath: Path, mode: number): Promise<void>

export function mkdir(filepath: Path, opts: MkdirOptions, cb: Callback): void

export function mkdir(filepath: Path, mode: number, cb: Callback): void

export function mkdir(filepath: Path, cb: Callback): void

export function mkdirSync(filepath: Path, opts?: MkdirOptions): void

export function mkdirSync(filepath: Path, mode: number): void

/**
 * Create a unique temporary directory.
 * @param prefix - The literal suffix `'XXXXXX'` is appended to `prefix` and replaced with random
 * characters to form the directory name.
 * @returns The path of the newly created directory, including its randomly generated suffix.
 */
export function mkdtemp(prefix: Path): Promise<string>

export function mkdtemp(prefix: Path, cb: Callback<[path: string | null]>): void

export function mkdtempSync(prefix: Path): string

/**
 * Open a file, returning a file descriptor. `flags` defaults to `'r'` and `mode` defaults to
 * `0o666`. `flags` may be a string such as `'r'`, `'w'`, `'a'`, `'r+'`, etc., or a numeric
 * combination of `fs.constants` flags.
 * @param flags - Defaults to `'r'`. Selects read/write mode and whether the file is created,
 * truncated, or appended.
 * @param mode - Defaults to `0o666`. Applied only when `flags` creates a new file.
 * @returns The file descriptor for the newly opened file.
 * @throws {ENOENT} `filepath` does not exist and `flags` does not include a creating variant (for
 * example the default `'r'`).
 * @throws {EEXIST} `flags` is an exclusive variant (`'wx'`, `'ax'`, `'xw'`, `'xa'`, etc.) and
 * `filepath` already exists.
 */
export function open(filepath: Path, flags?: Flag | number, mode?: string | number): Promise<number>

export function open(
  filepath: Path,
  flags: Flag | number,
  mode: string | number,
  cb: Callback<[fd: number]>
): void

export function open(filepath: Path, flags: Flag | number, cb: Callback<[fd: number]>): void

export function open(filepath: Path, cb: Callback<[fd: number]>): void

export function openSync(filepath: Path, flags?: Flag | number, mode?: string | number): number

/**
 * Options for `fs.opendir()`. `bufferSize` defaults to `32` and sets how many directory entries are
 * buffered internally per read.
 */
export interface OpendirOptions {
  encoding?: BufferEncoding | 'buffer'
  bufferSize?: number
}

/** Open a directory for iteration. Returns a `Dir` object. */
export function opendir(
  filepath: Path,
  opts: OpendirOptions & { encoding?: BufferEncoding }
): Promise<Dir<string>>

export function opendir(
  filepath: Path,
  opts: OpendirOptions & { encoding: 'buffer' }
): Promise<Dir<Buffer>>

export function opendir(filepath: Path, opts: OpendirOptions): Promise<Dir>

export function opendir(filepath: Path, encoding: BufferEncoding): Promise<Dir<string>>

export function opendir(filepath: Path, encoding: 'buffer'): Promise<Dir<Buffer>>

export function opendir(filepath: Path, encoding: BufferEncoding | 'buffer'): Promise<Dir>

export function opendir(filepath: Path): Promise<Dir<string>>

export function opendir(
  filepath: Path,
  opts: OpendirOptions & { encoding?: BufferEncoding },
  cb: Callback<[dir: Dir<string> | null]>
): void

export function opendir(
  filepath: Path,
  opts: OpendirOptions & { encoding: 'buffer' },
  cb: Callback<[dir: Dir<Buffer> | null]>
): void

export function opendir(filepath: Path, opts: OpendirOptions, cb: Callback<[dir: Dir | null]>): void

export function opendir(
  filepath: Path,
  encoding: BufferEncoding,
  cb: Callback<[dir: Dir<string> | null]>
): void

export function opendir(
  filepath: Path,
  encoding: 'buffer',
  cb: Callback<[dir: Dir<Buffer> | null]>
): void

export function opendir(
  filepath: Path,
  encoding: BufferEncoding | 'buffer',
  cb: Callback<[dir: Dir | null]>
): void

export function opendir(filepath: Path, cb: Callback<[dir: Dir<string> | null]>): void

export function opendirSync(
  filepath: Path,
  opts: OpendirOptions & { encoding?: BufferEncoding }
): Dir<string>

export function opendirSync(
  filepath: Path,
  opts: OpendirOptions & { encoding: 'buffer' }
): Dir<Buffer>

export function opendirSync(filepath: Path, opts: OpendirOptions): Dir

export function opendirSync(filepath: Path, encoding: BufferEncoding): Dir<string>

export function opendirSync(filepath: Path, encoding: 'buffer'): Dir<Buffer>

export function opendirSync(filepath: Path, encoding: BufferEncoding | 'buffer'): Dir

export function opendirSync(filepath: Path): Dir<string>

/**
 * Read from a file descriptor into `buffer`. `offset` defaults to `0`, `len` defaults to
 * `buffer.byteLength - offset`, and `pos` defaults to `-1` (current position). Returns the number
 * of bytes read.
 * @param fd - The file descriptor to read from, as returned by `fs.open()`.
 * @param offset - The offset within `buffer` to start writing to. Defaults to `0`.
 * @param len - The number of bytes to read. Defaults to `buffer.byteLength - offset`.
 * @param pos - The position in the file to read from. Defaults to `-1`, which reads from the
 * current file position and advances it.
 * @returns The number of bytes actually read, which may be less than `len` (`0` at end of file).
 */
export function read(
  fd: number,
  buffer: Buffer | ArrayBufferView,
  offset?: number,
  len?: number,
  pos?: number
): Promise<number>

export function read(
  fd: number,
  buffer: Buffer | ArrayBufferView,
  offset: number,
  len: number,
  pos: number,
  cb: Callback<[len: number]>
): void

export function read(
  fd: number,
  buffer: Buffer | ArrayBufferView,
  offset: number,
  len: number,
  cb: Callback<[len: number]>
): void

export function read(
  fd: number,
  buffer: Buffer | ArrayBufferView,
  offset: number,
  cb: Callback<[len: number]>
): void

export function read(
  fd: number,
  buffer: Buffer | ArrayBufferView,
  cb: Callback<[len: number]>
): void

/**
 * Read the next entry from the directory.
 * @returns The next `Dirent` for the directory, or `null` once every entry has been read.
 */
export function readSync(
  fd: number,
  buffer: Buffer | ArrayBufferView,
  offset?: number,
  len?: number,
  pos?: number
): number

export interface ReadFileOptions {
  encoding?: BufferEncoding | 'buffer'
  flag?: Flag
}

/**
 * Read the entire contents of a file. Returns a `Buffer` by default, or a string if an `encoding`
 * is specified.
 * @param opts - `encoding` defaults to `'buffer'` (returning a `Buffer` rather than a string);
 * `flag` defaults to `'r'`.
 */
export function readFile(
  filepath: Path,
  opts: ReadFileOptions & { encoding: BufferEncoding }
): Promise<string>

export function readFile(
  filepath: Path,
  opts: ReadFileOptions & { encoding?: 'buffer' }
): Promise<Buffer>

export function readFile(filepath: Path, opts: ReadFileOptions): Promise<string | Buffer>

export function readFile(filepath: Path, encoding: BufferEncoding): Promise<string>

export function readFile(filepath: Path, encoding: 'buffer'): Promise<Buffer>

export function readFile(
  filepath: Path,
  encoding?: BufferEncoding | 'buffer'
): Promise<string | Buffer>

export function readFile(filepath: Path): Promise<Buffer>

export function readFile(
  filepath: Path,
  opts: ReadFileOptions & { encoding: BufferEncoding },
  cb: Callback<[buffer?: string]>
): void

export function readFile(
  filepath: Path,
  opts: ReadFileOptions & { encoding?: 'buffer' },
  cb: Callback<[buffer?: Buffer]>
): void

export function readFile(
  filepath: Path,
  opts: ReadFileOptions,
  cb: Callback<[buffer?: string | Buffer]>
): void

export function readFile(
  filepath: Path,
  encoding: BufferEncoding,
  cb: Callback<[buffer?: string]>
): void

export function readFile(filepath: Path, encoding: 'buffer', cb: Callback<[buffer?: Buffer]>): void

export function readFile(
  filepath: Path,
  encoding: BufferEncoding | 'buffer',
  cb: Callback<[buffer?: string | Buffer]>
): void

export function readFile(filepath: Path, cb: Callback<[buffer?: Buffer]>): void

export function readFileSync(
  filepath: Path,
  opts: ReadFileOptions & { encoding: BufferEncoding }
): string

export function readFileSync(
  filepath: Path,
  opts: ReadFileOptions & { encoding?: 'buffer' }
): Buffer

export function readFileSync(filepath: Path, opts: ReadFileOptions): string | Buffer

export function readFileSync(filepath: Path, encoding: BufferEncoding): string

export function readFileSync(filepath: Path, encoding: 'buffer'): Buffer

export function readFileSync(filepath: Path, encoding?: BufferEncoding | 'buffer'): string | Buffer

export function readFileSync(filepath: Path): Buffer

export interface ReaddirOptions extends OpendirOptions {
  withFileTypes?: boolean
}
/**
 * Read the contents of a directory. Returns an array of filenames or, if `withFileTypes` is `true`,
 * an array of `Dirent` objects.
 * @param opts - `withFileTypes`, if `true`, returns `Dirent` objects instead of plain filename
 * strings.
 */
export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { encoding?: BufferEncoding }
): Promise<Dirent<string>[] | string[]>

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { encoding?: BufferEncoding; withFileTypes: true }
): Promise<Dirent<string>[]>

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { encoding?: BufferEncoding; withFileTypes?: false }
): Promise<string[]>

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { encoding: 'buffer' }
): Promise<Dirent<Buffer>[] | Buffer[]>

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { encoding: 'buffer'; withFileTypes: true }
): Promise<Dirent<Buffer>[]>

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { encoding: 'buffer'; withFileTypes?: false }
): Promise<Buffer[]>

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { withFileTypes: true }
): Promise<Dirent<string | Buffer>[]>

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { withFileTypes?: false }
): Promise<string[] | Buffer[]>

export function readdir(
  filepath: Path,
  opts: ReaddirOptions
): Promise<Dirent[] | string[] | Buffer[]>

export function readdir(filepath: Path, encoding: BufferEncoding): Promise<string[]>

export function readdir(filepath: Path, encoding: 'buffer'): Promise<Buffer[]>

export function readdir(
  filepath: Path,
  encoding: BufferEncoding | 'buffer'
): Promise<string[] | Buffer[]>

export function readdir(filepath: Path): Promise<string[]>

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { encoding?: BufferEncoding },
  cb: Callback<[entries: Dirent<string>[] | string[] | null]>
): void

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { encoding?: BufferEncoding; withFileTypes: true },
  cb: Callback<[entries: Dirent<string>[] | null]>
): void

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { encoding?: BufferEncoding; withFileTypes?: false },
  cb: Callback<[entries: string[] | null]>
): void

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { encoding: 'buffer' },
  cb: Callback<[entries: Dirent<Buffer>[] | Buffer[] | null]>
): void

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { encoding: 'buffer'; withFileTypes: true },
  cb: Callback<[entries: Dirent<Buffer>[] | null]>
): void

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { encoding: 'buffer'; withFileTypes?: false },
  cb: Callback<[entries: Buffer[] | null]>
): void

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { withFileTypes: true },
  cb: Callback<[entries: Dirent<string | Buffer>[] | null]>
): void

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { withFileTypes?: false },
  cb: Callback<[entries: string[] | Buffer[] | null]>
): void

export function readdir(
  filepath: Path,
  opts: ReaddirOptions,
  cb: Callback<[entries: Dirent[] | string[] | Buffer[] | null]>
): void

export function readdir(
  filepath: Path,
  encoding: BufferEncoding,
  cb: Callback<[entries: string[] | null]>
): void

export function readdir(
  filepath: Path,
  encoding: 'buffer',
  cb: Callback<[entries: Buffer[] | null]>
): void

export function readdir(
  filepath: Path,
  encoding: BufferEncoding | 'buffer',
  cb: Callback<[entries: string[] | Buffer[] | null]>
): void

export function readdir(filepath: Path, cb: Callback<[entries: string[] | null]>): void

export function readdirSync(
  filepath: Path,
  opts: ReaddirOptions & { encoding?: BufferEncoding }
): Dirent<string>[] | string[]

export function readdirSync(
  filepath: Path,
  opts: ReaddirOptions & { encoding?: BufferEncoding; withFileTypes: true }
): Dirent<string>[]

export function readdirSync(
  filepath: Path,
  opts: ReaddirOptions & { encoding?: BufferEncoding; withFileTypes?: false }
): string[]

export function readdirSync(
  filepath: Path,
  opts: ReaddirOptions & { encoding: 'buffer' }
): Dirent<Buffer>[] | Buffer[]

export function readdirSync(
  filepath: Path,
  opts: ReaddirOptions & { encoding: 'buffer'; withFileTypes: true }
): Dirent<Buffer>[]

export function readdirSync(
  filepath: Path,
  opts: ReaddirOptions & { encoding: 'buffer'; withFileTypes?: false }
): Buffer[]

export function readdirSync(
  filepath: Path,
  opts: ReaddirOptions & { withFileTypes: true }
): Dirent<string | Buffer>[]

export function readdirSync(
  filepath: Path,
  opts: ReaddirOptions & { withFileTypes?: false }
): string[] | Buffer[]

export function readdirSync(filepath: Path, opts: ReaddirOptions): Dirent[] | string[] | Buffer[]

export function readdirSync(filepath: Path, encoding: BufferEncoding): string[]

export function readdirSync(filepath: Path, encoding: 'buffer'): Buffer[]

export function readdirSync(
  filepath: Path,
  encoding: BufferEncoding | 'buffer'
): string[] | Buffer[]

export function readdirSync(filepath: Path): string[]

export interface ReadlinkOptions {
  encoding?: BufferEncoding | 'buffer'
}

/** Read the target of a symbolic link. */
export function readlink(
  filepath: Path,
  opts: ReadlinkOptions & { encoding?: BufferEncoding }
): Promise<string>

export function readlink(
  filepath: Path,
  opts: ReadlinkOptions & { encoding: 'buffer' }
): Promise<Buffer>

export function readlink(filepath: Path, opts: ReadlinkOptions): Promise<string | Buffer>

export function readlink(filepath: Path, encoding: BufferEncoding): Promise<string>

export function readlink(filepath: Path, encoding: 'buffer'): Promise<Buffer>

export function readlink(
  filepath: Path,
  encoding: BufferEncoding | 'buffer'
): Promise<string | Buffer>

export function readlink(filepath: Path): Promise<string>

export function readlink(
  filepath: Path,
  opts: ReadlinkOptions & { encoding?: BufferEncoding },
  cb: Callback<[link: string | null]>
): void

export function readlink(
  filepath: Path,
  opts: ReadlinkOptions & { encoding: 'buffer' },
  cb: Callback<[link: Buffer | null]>
): void

export function readlink(
  filepath: Path,
  opts: ReadlinkOptions,
  cb: Callback<[link: string | Buffer | null]>
): void

export function readlink(
  filepath: Path,
  encoding: BufferEncoding,
  cb: Callback<[link: string | null]>
): void

export function readlink(
  filepath: Path,
  encoding: 'buffer',
  cb: Callback<[link: Buffer | null]>
): void

export function readlink(
  filepath: Path,
  encoding: BufferEncoding | 'buffer',
  cb: Callback<[link: string | Buffer | null]>
): void

export function readlink(filepath: Path, cb: Callback<[link: string | null]>): void

export function readlinkSync(
  filepath: Path,
  opts: ReadlinkOptions & { encoding?: BufferEncoding }
): string

export function readlinkSync(filepath: Path, opts: ReadlinkOptions & { encoding: 'buffer' }): Buffer

export function readlinkSync(filepath: Path, opts: ReadlinkOptions): string | Buffer

export function readlinkSync(filepath: Path, encoding: BufferEncoding): string

export function readlinkSync(filepath: Path, encoding: 'buffer'): Buffer

export function readlinkSync(filepath: Path, encoding: BufferEncoding | 'buffer'): string | Buffer

export function readlinkSync(filepath: Path): string

/**
 * Read from a file descriptor into an array of `buffers`. `pos` defaults to `-1`.
 * @returns The number of bytes actually read across all buffers.
 */
export function readv(fd: number, buffers: ArrayBufferView[], position?: number): Promise<number>

export function readv(
  fd: number,
  buffers: ArrayBufferView[],
  position: number,
  cb: Callback<[len: number]>
): void

export function readv(fd: number, buffers: ArrayBufferView[], cb: Callback<[len: number]>): void

export function readvSync(fd: number, buffers: ArrayBufferView[], position?: number): number

export interface RealpathOptions {
  encoding?: BufferEncoding | 'buffer'
}

/** Resolve the real path of `filepath`, expanding all symbolic links. */
export function realpath(
  filepath: Path,
  opts: RealpathOptions & { encoding?: BufferEncoding }
): Promise<string>

export function realpath(
  filepath: Path,
  opts: RealpathOptions & { encoding: 'buffer' }
): Promise<Buffer>

export function realpath(filepath: Path, opts: RealpathOptions): Promise<string | Buffer>

export function realpath(filepath: Path, encoding: BufferEncoding): Promise<string>

export function realpath(filepath: Path, encoding: 'buffer'): Promise<Buffer>

export function realpath(
  filepath: Path,
  encoding: BufferEncoding | 'buffer'
): Promise<string | Buffer>

export function realpath(filepath: Path): Promise<string>

export function realpath(
  filepath: Path,
  opts: RealpathOptions & { encoding?: BufferEncoding },
  cb: Callback<[path: string | null]>
): void

export function realpath(
  filepath: Path,
  opts: RealpathOptions & { encoding: 'buffer' },
  cb: Callback<[path: Buffer | null]>
): void

export function realpath(
  filepath: Path,
  opts: RealpathOptions,
  cb: Callback<[path: string | Buffer | null]>
): void

export function realpath(
  filepath: Path,
  encoding: BufferEncoding,
  cb: Callback<[path: string | null]>
): void

export function realpath(
  filepath: Path,
  encoding: 'buffer',
  cb: Callback<[path: Buffer | null]>
): void

export function realpath(
  filepath: Path,
  encoding: BufferEncoding | 'buffer',
  cb: Callback<[path: string | Buffer | null]>
): void

export function realpath(filepath: Path, cb: Callback<[path: string | null]>): void

export function realpathSync(
  filepath: Path,
  opts: RealpathOptions & { encoding?: BufferEncoding }
): string

export function realpathSync(filepath: Path, opts: RealpathOptions & { encoding: 'buffer' }): Buffer

export function realpathSync(filepath: Path, opts: RealpathOptions): string | Buffer

export function realpathSync(filepath: Path, encoding: BufferEncoding): string

export function realpathSync(filepath: Path, encoding: 'buffer'): Buffer

export function realpathSync(filepath: Path, encoding: BufferEncoding | 'buffer'): string | Buffer

export function realpathSync(filepath: Path): string

/** Rename a file from `src` to `dst`. */
export function rename(src: Path, dst: Path): Promise<void>

export function rename(src: Path, dst: Path, cb: Callback): void

export function renameSync(src: Path, dst: Path): void

/**
 * Options for `fs.rm()`. `recursive`, if `true`, removes directories and their contents. `force`,
 * if `true`, suppresses the error when `filepath` does not exist.
 */
export interface RmOptions {
  force?: boolean
  recursive?: boolean
}

/**
 * Remove a file or directory at `filepath`.
 * @param opts - `recursive`, if `true`, removes directories and their contents; `force`, if `true`,
 * suppresses the error when `filepath` does not exist.
 * @throws {EISDIR} `filepath` is a directory and `opts.recursive` is not set.
 */
export function rm(filepath: Path, opts?: RmOptions): Promise<void>

export function rm(filepath: Path, opts: RmOptions, cb: Callback): void

export function rm(filepath: Path, cb: Callback): void

export function rmSync(filepath: Path, opts?: RmOptions): void

/**
 * Remove an empty directory.
 * @throws {ENOTEMPTY} the directory is not empty.
 */
export function rmdir(filepath: Path): Promise<void>

export function rmdir(filepath: Path, cb: Callback): void

export function rmdirSync(filepath: Path): void

/** Get the status of a file. Returns a `Stats` object. */
export function stat(filepath: Path): Promise<Stats>

export function stat(filepath: Path, cb: Callback<[stats: Stats | null]>): void

export function statSync(filepath: Path): Stats

/** Get filesystem statistics. Returns a `StatFs` object. */
export function statfs(filepath: Path): Promise<StatFs>

export function statfs(filepath: Path, cb: Callback<[stats: StatFs | null]>): void

export function statfsSync(filepath: Path): StatFs

/**
 * Create a symbolic link at `filepath` pointing to `target`. `type` may be `'file'`, `'dir'`, or
 * `'junction'` (Windows only) or a numeric flag. On Windows, if `type` is not provided, it is
 * inferred from the target.
 */
export function symlink(target: Path, filepath: Path, type?: string | number): Promise<void>

export function symlink(target: Path, filepath: Path, type: string | number, cb: Callback): void

export function symlink(target: Path, filepath: Path, cb: Callback): void

export function symlinkSync(target: Path, filepath: Path, type?: string | number): void

/** Truncate the file at `filename` to `len` bytes. `len` defaults to `0`. */
export function truncate(filepath: Path, len?: number): Promise<void>

export function truncate(filepath: Path, len: number, cb: Callback): void

export function truncate(filepath: Path, cb: Callback): void

export function truncateSync(filepath: Path, len?: number): void

/**
 * Remove a file.
 * @param filepath - The path of the file to remove.
 */
export function unlink(filepath: Path): Promise<void>

export function unlink(filepath: Path, cb: Callback): void

export function unlinkSync(filepath: Path): void

/**
 * Watch a file or directory for changes. Returns a `Watcher` object. The `callback`, if provided,
 * is called with `(eventType, filename)` on each change. `filename` is `null` when the platform
 * could not report which file changed, such as when events were dropped, in which case the watched
 * path should be rescanned.
 * @param opts - `persistent` defaults to `true`; `recursive` (default `false`) also watches
 * subdirectories; `encoding` defaults to `'utf8'`.
 * @param cb - Called with `(eventType, filename)` on each change; equivalent to listening for the
 * `Watcher`'s `'change'` event.
 */
export function watch(
  filepath: Path,
  opts: WatcherOptions & { encoding?: BufferEncoding },
  cb: (eventType: WatcherEventType, filename: string | null) => void
): Watcher<string>

export function watch(
  filepath: Path,
  opts: WatcherOptions & { encoding: 'buffer' },
  cb: (eventType: WatcherEventType, filename: Buffer | null) => void
): Watcher<Buffer>

export function watch(
  filepath: Path,
  opts: WatcherOptions,
  cb: (eventType: WatcherEventType, filename: string | Buffer | null) => void
): Watcher

export function watch(
  filepath: Path,
  encoding: BufferEncoding,
  cb: (eventType: WatcherEventType, filename: string | null) => void
): Watcher<string>

export function watch(
  filepath: Path,
  encoding: 'buffer',
  cb: (eventType: WatcherEventType, filename: Buffer | null) => void
): Watcher<Buffer>

export function watch(
  filepath: Path,
  encoding: BufferEncoding | 'buffer',
  cb: (eventType: WatcherEventType, filename: string | Buffer | null) => void
): Watcher

export function watch(
  filepath: Path,
  cb: (eventType: WatcherEventType, filename: string | null) => void
): Watcher<string>

/**
 * Write `data` to a file descriptor. When `data` is a string, the signature is
 * `fs.write(fd, data[, pos[, encoding]])` where `encoding` defaults to `'utf8'`. Returns the number
 * of bytes written.
 * @param fd - The file descriptor to write to, as returned by `fs.open()`.
 * @param data - The bytes to write. May also be a string, in which case the signature becomes
 * `fs.write(fd, data[, pos[, encoding]])`.
 * @param offset - The offset within `data` to start writing from. Defaults to `0`.
 * @param len - The number of bytes to write. Defaults to `data.byteLength - offset`.
 * @param pos - The position in the file to write to. Defaults to `-1`, which writes at the current
 * file position and advances it.
 * @returns The number of bytes actually written, which may be less than `data`'s length.
 */
export function write(
  fd: number,
  data: Buffer | ArrayBufferView,
  offset?: number,
  len?: number,
  pos?: number
): Promise<number>

export function write(
  fd: number,
  data: string,
  pos?: number,
  encoding?: BufferEncoding
): Promise<number>

export function write(
  fd: number,
  data: Buffer | ArrayBufferView,
  offset: number,
  len: number,
  pos: number,
  cb: Callback<[len: number]>
): void

export function write(
  fd: number,
  data: Buffer | ArrayBufferView,
  offset: number,
  len: number,
  cb: Callback<[len: number]>
): void

export function write(
  fd: number,
  data: string,
  pos: number,
  encoding: BufferEncoding,
  cb: Callback<[len: number]>
): void

export function write(
  fd: number,
  data: Buffer | ArrayBufferView,
  offset: number,
  cb: Callback<[len: number]>
): void

export function write(fd: number, data: string, pos: number, cb: Callback<[len: number]>): void

export function write(fd: number, data: Buffer | ArrayBufferView, cb: Callback<[len: number]>): void

export function write(fd: number, data: string, cb: Callback<[len: number]>): void

export function writeSync(
  fd: number,
  data: Buffer | ArrayBufferView,
  offset?: number,
  len?: number,
  pos?: number
): number

export function writeSync(fd: number, data: string, pos?: number, encoding?: BufferEncoding): number

export interface WriteFileOptions {
  encoding?: BufferEncoding
  flag?: Flag
  mode?: number
}

/**
 * Write `data` to a file, replacing it if it already exists.
 * @param opts - `flag` defaults to `'w'` (truncating any existing file); `mode` defaults to
 * `0o666`.
 */
export function writeFile(
  filepath: Path,
  data: string | Buffer | ArrayBufferView,
  opts?: WriteFileOptions
): Promise<void>

export function writeFile(
  filepath: Path,
  data: string | Buffer | ArrayBufferView,
  encoding: BufferEncoding
): Promise<void>

export function writeFile(
  filepath: Path,
  data: string | Buffer | ArrayBufferView,
  opts: WriteFileOptions,
  cb: Callback
): void

export function writeFile(
  filepath: Path,
  data: string | Buffer | ArrayBufferView,
  encoding: BufferEncoding,
  cb: Callback
): void

export function writeFile(
  filepath: Path,
  data: string | Buffer | ArrayBufferView,
  cb: Callback
): void

export function writeFileSync(
  filepath: Path,
  data: string | Buffer | ArrayBufferView,
  opts?: WriteFileOptions
): void

export function writeFileSync(
  filepath: Path,
  data: string | Buffer | ArrayBufferView,
  encoding: BufferEncoding
): void

/**
 * Write an array of `buffers` to a file descriptor. `pos` defaults to `-1`.
 * @returns The number of bytes actually written across all buffers.
 */
export function writev(fd: number, buffers: ArrayBufferView[], pos?: number): Promise<number>

export function writev(
  fd: number,
  buffers: ArrayBufferView[],
  pos: number,
  cb: Callback<[len: number]>
): void

export function writev(fd: number, buffers: ArrayBufferView[], cb: Callback<[len: number]>): void

export function writevSync(fd: number, buffers: ArrayBufferView[], pos?: number): number
