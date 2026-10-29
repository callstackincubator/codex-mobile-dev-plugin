declare class FileError extends Error {
  private constructor(msg: string)

  readonly code: string
  readonly operation?: string
  /** The path of the directory. */
  readonly path?: string
  readonly destination?: string
  /** The underlying file descriptor. */
  readonly fd?: number
}

export = FileError
