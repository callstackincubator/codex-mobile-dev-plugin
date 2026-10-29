import EventEmitter, { EventMap } from 'bare-events'
import Buffer, { BufferEncoding } from 'bare-buffer'
import {
  constants,
  AppendFileOptions,
  CpOptions,
  Dir,
  Dirent,
  Flag,
  MkdirOptions,
  OpendirOptions,
  Path,
  ReadFileOptions,
  ReadStream,
  ReadStreamOptions,
  ReaddirOptions,
  ReadlinkOptions,
  RealpathOptions,
  RmOptions,
  StatFs,
  Stats,
  Watcher,
  WatcherOptions,
  WriteFileOptions,
  WriteStream,
  WriteStreamOptions
} from '.'

export { constants }

interface FileHandleEvents extends EventMap {
  /** Emitted once the file handle has closed. */
  close: []
}

interface FileHandle extends EventEmitter<FileHandleEvents>, AsyncDisposable {
  /** The underlying file descriptor. */
  readonly fd: number

  /** Close the underlying file descriptor. */
  close(): Promise<void>

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
  read(
    buffer: Buffer | ArrayBufferView,
    offset?: number,
    len?: number,
    pos?: number
  ): Promise<number>

  /**
   * Read from a file descriptor into an array of `buffers`. `pos` defaults to `-1`.
   * @returns The number of bytes actually read across all buffers.
   */
  readv(buffers: ArrayBufferView[], position?: number): Promise<number>

  /**
   * Write `data` to a file descriptor. When `data` is a string, the signature is
   * `fs.write(fd, data[, pos[, encoding]])` where `encoding` defaults to `'utf8'`. Returns the
   * number of bytes written.
   * @param fd - The file descriptor to write to, as returned by `fs.open()`.
   * @param data - The bytes to write. May also be a string, in which case the signature becomes
   * `fs.write(fd, data[, pos[, encoding]])`.
   * @param offset - The offset within `data` to start writing from. Defaults to `0`.
   * @param len - The number of bytes to write. Defaults to `data.byteLength - offset`.
   * @param pos - The position in the file to write to. Defaults to `-1`, which writes at the
   * current file position and advances it.
   * @returns The number of bytes actually written, which may be less than `data`'s length.
   */
  write(
    data: Buffer | ArrayBufferView,
    offset?: number,
    len?: number,
    pos?: number
  ): Promise<number>

  write(data: string, pos?: number, encoding?: BufferEncoding): Promise<number>

  /** Get the status of a file. Returns a `Stats` object. */
  stat(): Promise<Stats>

  /**
   * Change the permissions of a file. `mode` may be a numeric mode or a string that will be parsed
   * as octal.
   */
  chmod(mode: string | number): Promise<void>

  /** Change the owner and group of a file. */
  chown(uid: number, gid: number): Promise<void>

  datasync(): Promise<void>

  sync(): Promise<void>

  /** Truncate the file at `filename` to `len` bytes. `len` defaults to `0`. */
  truncate(len?: number): Promise<void>

  /**
   * Change the access and modification times of a file. Times may be numbers (seconds since epoch)
   * or `Date` objects.
   */
  utimes(atime: number | Date, mtime: number | Date): Promise<void>

  /**
   * Create a readable stream for a file. Returns a `ReadStream`.
   * @param path - May be `null` if `opts.fd` specifies an already-open file descriptor to read from
   * instead of opening `path`.
   * @param opts - `flags` defaults to `'r'`, `mode` to `0o666`, `start` (byte offset) to `0`; `end`
   * (inclusive byte offset), if given, stops the stream early.
   */
  createReadStream(opts?: ReadStreamOptions): ReadStream

  /**
   * Create a writable stream for a file. Returns a `WriteStream`.
   * @param path - May be `null` if `opts.fd` specifies an already-open file descriptor to write to
   * instead of opening `path`.
   * @param opts - `flags` defaults to `'w'`, `mode` to `0o666`.
   */
  createWriteStream(opts?: WriteStreamOptions): WriteStream
}

declare class FileHandle {
  private constructor(fd: number)
}

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
export function open(
  filepath: Path,
  flags?: Flag | number,
  mode?: string | number
): Promise<FileHandle>

/**
 * Check whether the file at `filepath` is accessible. `mode` defaults to `fs.constants.F_OK`.
 * @param mode - Defaults to `fs.constants.F_OK` (existence only); may also combine `R_OK`, `W_OK`,
 * and/or `X_OK`.
 */
export function access(filepath: Path, mode?: number): Promise<void>

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

export function chmod(filepath: Path, mode: string | number): Promise<void>

export function chown(filepath: Path, uid: number, gid: number): Promise<void>

/**
 * Copy a file from `src` to `dst`. `mode` is an optional bitmask created from
 * `fs.constants.COPYFILE_EXCL`, `fs.constants.COPYFILE_FICLONE`, or
 * `fs.constants.COPYFILE_FICLONE_FORCE`.
 * @param mode - Defaults to `0`. A bitmask of `fs.constants.COPYFILE_EXCL` (fail if `dst` exists),
 * `COPYFILE_FICLONE`, or `COPYFILE_FICLONE_FORCE`.
 * @throws {EEXIST} `dst` already exists and `mode` includes `fs.constants.COPYFILE_EXCL`.
 */
export function copyFile(src: Path, dst: Path, mode?: number): Promise<void>

/**
 * Copy a file or directory from `src` to `dst`.
 * @param opts - `recursive` must be `true` to copy a directory; copying a directory without it
 * throws `EISDIR`.
 * @throws {EISDIR} `src` is a directory and `opts.recursive` is not set.
 */
export function cp(src: Path, dst: Path, opts?: CpOptions): Promise<void>

/**
 * Change the owner and group of a file, but if `filepath` is a symbolic link, the changes are
 * applied only to the link, not the file it refers to.
 */
export function lchown(filepath: Path, uid: number, gid: number): Promise<void>

/**
 * Like `fs.utimes()`, but if `filepath` is a symbolic link, the timestamps of the link is changed,
 * not the file it refers to.
 */
export function lutimes(filepath: Path, atime: number | Date, mtime: number | Date): Promise<void>

/** Creates a new link (also known as a hard link) to an existing file. */
export function link(src: Path, dst: Path): Promise<void>

/**
 * Like `fs.stat()`, but if `filepath` is a symbolic link, the link itself is statted, not the file
 * it refers to.
 */
export function lstat(filepath: Path): Promise<Stats>

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

/**
 * Create a unique temporary directory.
 * @param prefix - The literal suffix `'XXXXXX'` is appended to `prefix` and replaced with random
 * characters to form the directory name.
 * @returns The path of the newly created directory, including its randomly generated suffix.
 */
export function mkdtemp(prefix: Path): Promise<string>

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

/**
 * Read the contents of a directory. Returns an array of filenames or, if `withFileTypes` is `true`,
 * an array of `Dirent` objects.
 * @param opts - `withFileTypes`, if `true`, returns `Dirent` objects instead of plain filename
 * strings.
 */
export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { encoding?: BufferEncoding }
): Promise<Dir<string>[] | string[]>

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { encoding?: BufferEncoding; withFileTypes: true }
): Promise<Dir<string>[]>

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { encoding?: BufferEncoding; withFileTypes?: false }
): Promise<string[]>

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { encoding: 'buffer' }
): Promise<Dir<Buffer>[] | Buffer[]>

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { encoding: 'buffer'; withFileTypes: true }
): Promise<Dir<Buffer>[]>

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { encoding: 'buffer'; withFileTypes?: false }
): Promise<Buffer[]>

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { withFileTypes: true }
): Promise<Dir<string | Buffer>[]>

export function readdir(
  filepath: Path,
  opts: ReaddirOptions & { withFileTypes?: false }
): Promise<string[] | Buffer[]>

export function readdir(filepath: Path, opts: ReaddirOptions): Promise<Dir[] | string[] | Buffer[]>

export function readdir(filepath: Path, encoding: BufferEncoding): Promise<string[]>

export function readdir(filepath: Path, encoding: 'buffer'): Promise<Buffer[]>

export function readdir(
  filepath: Path,
  encoding: BufferEncoding | 'buffer'
): Promise<string[] | Buffer[]>

export function readdir(filepath: Path): Promise<string[]>

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

/** Rename a file from `src` to `dst`. */
export function rename(src: Path, dst: Path): Promise<void>

/**
 * Remove a file or directory at `filepath`.
 * @param opts - `recursive`, if `true`, removes directories and their contents; `force`, if `true`,
 * suppresses the error when `filepath` does not exist.
 * @throws {EISDIR} `filepath` is a directory and `opts.recursive` is not set.
 */
export function rm(filepath: Path, opts?: RmOptions): Promise<void>

/**
 * Remove an empty directory.
 * @throws {ENOTEMPTY} the directory is not empty.
 */
export function rmdir(filepath: Path): Promise<void>

export function stat(filepath: Path): Promise<Stats>

/** Get filesystem statistics. Returns a `StatFs` object. */
export function statfs(filepath: Path): Promise<StatFs>

export function truncate(filepath: Path, len?: number): Promise<void>

/**
 * Create a symbolic link at `filepath` pointing to `target`. `type` may be `'file'`, `'dir'`, or
 * `'junction'` (Windows only) or a numeric flag. On Windows, if `type` is not provided, it is
 * inferred from the target.
 */
export function symlink(target: Path, filepath: Path, type?: string | number): Promise<void>

/**
 * Remove a file.
 * @param filepath - The path of the file to remove.
 */
export function unlink(filepath: Path): Promise<void>

export function utimes(filepath: Path, atime: number | Date, mtime: number | Date): Promise<void>

/**
 * Watch a file or directory for changes. Returns a `Watcher` object. The `callback`, if provided,
 * is called with `(eventType, filename)` on each change.
 * @param opts - `persistent` defaults to `true`; `recursive` (default `false`) also watches
 * subdirectories; `encoding` defaults to `'utf8'`.
 * @param cb - Called with `(eventType, filename)` on each change; equivalent to listening for the
 * `Watcher`'s `'change'` event.
 */
export function watch(
  filepath: Path,
  opts: WatcherOptions & { encoding?: BufferEncoding }
): Watcher<string>

export function watch(
  filepath: Path,
  opts: WatcherOptions & { encoding: 'buffer' }
): Watcher<Buffer>

export function watch(filepath: Path, opts: WatcherOptions): Watcher

export function watch(filepath: Path, encoding: BufferEncoding): Watcher<string>

export function watch(filepath: Path, encoding: 'buffer'): Watcher<Buffer>

export function watch(filepath: Path, encoding: BufferEncoding | 'buffer'): Watcher

export function watch(filepath: Path): Watcher<string>

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
