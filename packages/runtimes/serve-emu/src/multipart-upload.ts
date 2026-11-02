import Busboy, { type BusboyFileStream } from "@fastify/busboy";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  HttpBodyError,
  MAX_REQUEST_BODY_CHUNKS,
  REQUEST_BODY_YIELD_INTERVAL,
  yieldToMacrotask,
} from "./request-body.ts";

const DEFAULT_HEADER_PAIRS = 32;
const DEFAULT_HEADER_BYTES = 16 * 1024;
const MAX_CONTENT_TYPE_BYTES = 1024;
const DEFAULT_STREAM_HIGH_WATER_MARK = 64 * 1024;
const PARSER_FEED_BYTES = 64 * 1024;
// Busboy must see the final boundary and optional CRLF in the same write. Its
// Dicer backend stops accepting callbacks after recognizing the closing `--`,
// so retain a small, fixed tail instead of risking a split immediately after
// the boundary. Multipart boundaries are limited to 70 characters by RFC 2046.
const PARSER_TRAILER_BYTES = 8 * 1024;

type ParserWrite = (buffer: Buffer) => Promise<void>;

/**
 * A fixed-size ring that batches hostile tiny chunks while retaining the final
 * multipart trailer. Flushed segments are copied into owned buffers because
 * Busboy's write callback does not guarantee that downstream file streams have
 * released the parser input's backing memory before the ring is reused.
 */
class ParserTrailerBuffer {
  readonly #buffer = Buffer.allocUnsafe(
    PARSER_FEED_BYTES + PARSER_TRAILER_BYTES,
  );
  #start = 0;
  #length = 0;

  async append(chunk: Buffer, write: ParserWrite): Promise<void> {
    let offset = 0;
    while (offset < chunk.byteLength) {
      if (this.#length === this.#buffer.byteLength) {
        await this.#flushPrefix(PARSER_FEED_BYTES, write);
      }

      const writable = Math.min(
        this.#buffer.byteLength - this.#length,
        chunk.byteLength - offset,
      );
      const end = (this.#start + this.#length) % this.#buffer.byteLength;
      const first = Math.min(writable, this.#buffer.byteLength - end);
      chunk.copy(this.#buffer, end, offset, offset + first);
      if (first < writable) {
        chunk.copy(
          this.#buffer,
          0,
          offset + first,
          offset + writable,
        );
      }
      this.#length += writable;
      offset += writable;
    }
  }

  async finish(write: ParserWrite): Promise<void> {
    if (this.#length > PARSER_TRAILER_BYTES) {
      await this.#flushPrefix(this.#length - PARSER_TRAILER_BYTES, write);
    }
    if (this.#length === 0) return;

    const trailer = Buffer.allocUnsafe(this.#length);
    const first = Math.min(
      this.#length,
      this.#buffer.byteLength - this.#start,
    );
    this.#buffer.copy(trailer, 0, this.#start, this.#start + first);
    if (first < this.#length) {
      this.#buffer.copy(trailer, first, 0, this.#length - first);
    }
    this.#start = 0;
    this.#length = 0;
    await write(trailer);
  }

  async #flushPrefix(bytes: number, write: ParserWrite): Promise<void> {
    let remaining = bytes;
    while (remaining > 0) {
      const contiguous = Math.min(
        remaining,
        this.#buffer.byteLength - this.#start,
      );
      // Busboy can retain a slice after its write callback. Copy before this
      // ring region is reused, otherwise later trailer bytes corrupt the file.
      const owned = Buffer.from(
        this.#buffer.subarray(this.#start, this.#start + contiguous),
      );
      await write(owned);
      this.#start =
        (this.#start + contiguous) % this.#buffer.byteLength;
      this.#length -= contiguous;
      remaining -= contiguous;
    }
  }
}

export const MULTIPART_UPLOAD_ERROR_STATUS = {
  "invalid-multipart": 400,
  "unexpected-multipart-part": 400,
  "upload-write-failed": 500,
  "upload-cleanup-failed": 500,
} as const;

export type MultipartUploadErrorCode =
  keyof typeof MULTIPART_UPLOAD_ERROR_STATUS;

type MultipartUploadErrorOptions = {
  cause?: unknown;
};

export class MultipartUploadError extends Error {
  readonly code: MultipartUploadErrorCode;
  readonly status: (typeof MULTIPART_UPLOAD_ERROR_STATUS)[MultipartUploadErrorCode];

  constructor(
    code: MultipartUploadErrorCode,
    message: string,
    options: MultipartUploadErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "MultipartUploadError";
    this.code = code;
    this.status = MULTIPART_UPLOAD_ERROR_STATUS[code];
  }
}

export type StagedMultipartFile = {
  path: string;
  filename: string;
  mediaType: string;
  size: number;
  cleanup: () => Promise<void>;
};

export type StageMultipartUploadOptions = {
  fieldName: string;
  maxBodyBytes: number;
  maxFileBytes: number;
  signal?: AbortSignal;
  tempRoot?: string;
  maxHeaderPairs?: number;
  maxHeaderBytes?: number;
  highWaterMark?: number;
  fileHighWaterMark?: number;
  writerFactory?: (path: string) => Writable;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  readonly settled: boolean;
};

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  let settled = false;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value) {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
    reject(error) {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    },
    get settled() {
      return settled;
    },
  };
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function bodyTooLarge(
  limit: number,
  received?: number,
  message = `request body exceeds ${limit} bytes`,
): HttpBodyError {
  return new HttpBodyError("payload-too-large", message, { limit, received });
}

function tooManyBodyChunks(received: number): HttpBodyError {
  return new HttpBodyError(
    "too-many-body-chunks",
    `request body exceeds ${MAX_REQUEST_BODY_CHUNKS} chunks`,
    { limit: MAX_REQUEST_BODY_CHUNKS, received },
  );
}

function aborted(signal: AbortSignal): HttpBodyError {
  return new HttpBodyError("request-aborted", "multipart upload aborted", {
    cause: signal.reason,
  });
}

function parseDeclaredLength(request: Request, maxBodyBytes: number): void {
  const header = request.headers.get("content-length");
  if (header === null) return;
  const value = header.trim();
  if (!/^\d+$/.test(value)) {
    throw new HttpBodyError(
      "invalid-content-length",
      "content-length must be a non-negative integer",
    );
  }
  const declared = BigInt(value);
  if (declared > BigInt(maxBodyBytes)) {
    throw bodyTooLarge(
      maxBodyBytes,
      declared <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(declared)
        : undefined,
    );
  }
}

async function cancelUnlockedBody(
  body: ReadableStream<Uint8Array> | null,
  reason: unknown,
): Promise<void> {
  if (!body || body.locked) return;
  try {
    await body.cancel(reason);
  } catch {}
}

function normalizeFailure(error: unknown): Error {
  if (error instanceof Error) return error;
  return new MultipartUploadError(
    "invalid-multipart",
    "multipart upload failed",
    { cause: error },
  );
}

function parserFailure(error: unknown): MultipartUploadError {
  return new MultipartUploadError(
    "invalid-multipart",
    "request body is not valid multipart/form-data",
    { cause: error },
  );
}

async function writeParserChunk(
  parser: Busboy,
  chunk: Buffer,
  signal: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let callbackDone = false;
    let drainDone = false;
    let settled = false;

    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      parser.off("close", onClose);
      parser.off("drain", onDrain);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const finish = () => {
      if (settled || !callbackDone || !drainDone) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onAbort = () => fail(signal.reason);
    const onClose = () => fail(signal.reason ?? parserFailure("parser closed"));
    const onDrain = () => {
      drainDone = true;
      finish();
    };

    signal.addEventListener("abort", onAbort, { once: true });
    parser.once("close", onClose);
    try {
      const accepted = parser.write(chunk, (error?: Error | null) => {
        if (error) {
          fail(error);
          return;
        }
        callbackDone = true;
        finish();
      });
      drainDone = accepted;
      if (!accepted) parser.once("drain", onDrain);
      finish();
    } catch (error) {
      fail(error);
    }
  });
}

/**
 * Stream exactly one multipart file field into a uniquely-created temporary
 * directory. The caller owns the returned file until it calls `cleanup()`.
 */
export async function stageMultipartUpload(
  request: Request,
  options: StageMultipartUploadOptions,
): Promise<StagedMultipartFile> {
  if (!options.fieldName) throw new TypeError("fieldName must not be empty");
  assertNonNegativeSafeInteger(options.maxBodyBytes, "maxBodyBytes");
  assertNonNegativeSafeInteger(options.maxFileBytes, "maxFileBytes");
  const maxHeaderPairs = options.maxHeaderPairs ?? DEFAULT_HEADER_PAIRS;
  const maxHeaderBytes = options.maxHeaderBytes ?? DEFAULT_HEADER_BYTES;
  const highWaterMark =
    options.highWaterMark ?? DEFAULT_STREAM_HIGH_WATER_MARK;
  const fileHighWaterMark =
    options.fileHighWaterMark ?? DEFAULT_STREAM_HIGH_WATER_MARK;
  assertPositiveSafeInteger(maxHeaderPairs, "maxHeaderPairs");
  assertPositiveSafeInteger(maxHeaderBytes, "maxHeaderBytes");
  assertPositiveSafeInteger(highWaterMark, "highWaterMark");
  assertPositiveSafeInteger(fileHighWaterMark, "fileHighWaterMark");

  const signals = Array.from(
    new Set(
      [request.signal, options.signal].filter(
        (signal): signal is AbortSignal => signal !== undefined,
      ),
    ),
  );
  const alreadyAborted = signals.find((signal) => signal.aborted);
  if (alreadyAborted) {
    const error = aborted(alreadyAborted);
    await cancelUnlockedBody(request.body, error);
    throw error;
  }
  try {
    parseDeclaredLength(request, options.maxBodyBytes);
  } catch (error) {
    await cancelUnlockedBody(request.body, error);
    throw error;
  }

  let directory: string | null = null;
  let cleanupPromise: Promise<void> | null = null;
  const cleanup = (): Promise<void> => {
    if (!directory) return Promise.resolve();
    cleanupPromise ??= rm(directory, { recursive: true, force: true });
    return cleanupPromise;
  };

  let parser: Busboy | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let activeFile: BusboyFileStream | null = null;
  let activeWriter: Writable | null = null;
  let ingestion: Promise<void> | null = null;
  let filePipeline: Promise<void> | null = null;
  let primaryFailure: Error | null = null;
  const processing = new AbortController();
  const parserDone = deferred<void>();
  const fileDone = deferred<void>();
  void parserDone.promise.catch(() => {});
  void fileDone.promise.catch(() => {});

  const recordFailure = (error: Error): Error => {
    primaryFailure ??= error;
    return primaryFailure;
  };
  const stop = (error: Error) => {
    const failure = recordFailure(error);
    parserDone.reject(failure);
    fileDone.reject(failure);
    if (!processing.signal.aborted) processing.abort(failure);
    if (reader) void reader.cancel(failure).catch(() => {});
    activeFile?.destroy();
    activeWriter?.destroy();
    parser?.destroy();
  };

  const abortListeners = signals.map((signal) => {
    const onAbort = () => stop(aborted(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    return { signal, onAbort };
  });

  try {
    try {
      directory = await mkdtemp(
        join(options.tempRoot ?? tmpdir(), "serve-emu-upload-"),
      );
    } catch (cause) {
      throw new MultipartUploadError(
        "upload-write-failed",
        "failed to create multipart upload directory",
        { cause },
      );
    }
    const racedAbort = signals.find((signal) => signal.aborted);
    if (racedAbort) throw aborted(racedAbort);

    const contentType = request.headers.get("content-type");
    if (!contentType) {
      throw parserFailure("missing content-type header");
    }
    if (Buffer.byteLength(contentType, "utf8") > MAX_CONTENT_TYPE_BYTES) {
      throw parserFailure("content-type header is too large");
    }

    let stagedPath = join(directory, "upload");
    let filename: string | null = null;
    let mediaType: string | null = null;
    let size = 0;
    let fileSeen = false;
    let parserFinished = false;

    try {
      parser = new Busboy({
        headers: { "content-type": contentType },
        highWaterMark,
        fileHwm: fileHighWaterMark,
        preservePath: false,
        limits: {
          fieldNameSize: Buffer.byteLength(options.fieldName, "utf8"),
          fieldSize: 0,
          fields: 0,
          fileSize: options.maxFileBytes,
          files: 1,
          parts: 1,
          headerPairs: maxHeaderPairs,
          headerSize: maxHeaderBytes,
        },
      });
    } catch (error) {
      throw parserFailure(error);
    }

    parser.once("error", (error) => {
      const failure = recordFailure(parserFailure(error));
      parserDone.reject(failure);
    });
    parser.once("close", () => {
      if (!parserFinished) {
        parserDone.reject(
          primaryFailure ?? parserFailure("multipart parser closed early"),
        );
      }
    });
    parser.once("finish", () => {
      parserFinished = true;
      if (!fileSeen) {
        fileDone.reject(
          recordFailure(
            new MultipartUploadError(
              "unexpected-multipart-part",
              `multipart field ${options.fieldName} must be a file`,
            ),
          ),
        );
      }
      parserDone.resolve();
    });
    parser.once("partsLimit", () => {
      fileDone.reject(
        recordFailure(
          new MultipartUploadError(
            "unexpected-multipart-part",
            "multipart upload must contain exactly one part",
          ),
        ),
      );
    });
    parser.once("filesLimit", () => {
      fileDone.reject(
        recordFailure(
          new MultipartUploadError(
            "unexpected-multipart-part",
            "multipart upload must contain exactly one file",
          ),
        ),
      );
    });
    parser.once("fieldsLimit", () => {
      fileDone.reject(
        recordFailure(
          new MultipartUploadError(
            "unexpected-multipart-part",
            `multipart field ${options.fieldName} must be a file`,
          ),
        ),
      );
    });
    parser.on(
      "file",
      (
        fieldName,
        stream,
        uploadedFilename,
        _transferEncoding,
        mimeType,
      ) => {
        if (fileSeen || fieldName !== options.fieldName) {
          stream.resume();
          fileDone.reject(
            recordFailure(
              new MultipartUploadError(
                "unexpected-multipart-part",
                `unexpected multipart file field ${fieldName}`,
              ),
            ),
          );
          return;
        }
        if (typeof uploadedFilename !== "string") {
          stream.resume();
          fileDone.reject(
            recordFailure(
              new MultipartUploadError(
                "unexpected-multipart-part",
                `multipart field ${options.fieldName} must include a filename`,
              ),
            ),
          );
          return;
        }

        fileSeen = true;
        filename = uploadedFilename;
        mediaType = mimeType;
        if (uploadedFilename.toLowerCase().endsWith(".apk")) {
          // Recent adb versions reject local install paths without an APK
          // suffix, even when the uploaded filename itself is valid.
          stagedPath = join(directory!, "upload.apk");
        }
        activeFile = stream;
        stream.once("limit", () => {
          fileDone.reject(
            recordFailure(
              bodyTooLarge(
                options.maxFileBytes,
                options.maxFileBytes + 1,
                `multipart file exceeds ${options.maxFileBytes} bytes`,
              ),
            ),
          );
        });

        try {
          activeWriter = options.writerFactory
            ? options.writerFactory(stagedPath)
            : createWriteStream(stagedPath, { flags: "wx", mode: 0o600 });
          filePipeline = pipeline(stream, activeWriter, {
            signal: processing.signal,
          }).then(
            () => {
              if (stream.truncated) {
                fileDone.reject(
                  recordFailure(
                    bodyTooLarge(
                      options.maxFileBytes,
                      stream.bytesRead + 1,
                      `multipart file exceeds ${options.maxFileBytes} bytes`,
                    ),
                  ),
                );
                return;
              }
              size = stream.bytesRead;
              activeFile = null;
              activeWriter = null;
              fileDone.resolve();
            },
            (error) => {
              const failure =
                primaryFailure ??
                new MultipartUploadError(
                  "upload-write-failed",
                  "failed to write multipart upload",
                  { cause: error },
                );
              fileDone.reject(recordFailure(failure));
            },
          );
        } catch (error) {
          stream.resume();
          fileDone.reject(
            recordFailure(
              new MultipartUploadError(
                "upload-write-failed",
                "failed to create multipart upload file",
                { cause: error },
              ),
            ),
          );
        }
      },
    );

    if (!request.body) {
      throw parserFailure("multipart request body is missing");
    }
    reader = request.body.getReader();
    ingestion = (async () => {
      let received = 0;
      let chunksRead = 0;
      const trailer = new ParserTrailerBuffer();
      const write: ParserWrite = (buffer) =>
        writeParserChunk(parser!, buffer, processing.signal);
      while (true) {
        const next = await reader!.read();
        if (processing.signal.aborted) throw processing.signal.reason;
        if (next.done) break;
        chunksRead++;
        if (chunksRead > MAX_REQUEST_BODY_CHUNKS) {
          throw tooManyBodyChunks(chunksRead);
        }
        if (next.value.byteLength > options.maxBodyBytes - received) {
          throw bodyTooLarge(
            options.maxBodyBytes,
            received + next.value.byteLength,
          );
        }
        received += next.value.byteLength;
        const chunk = Buffer.from(
          next.value.buffer,
          next.value.byteOffset,
          next.value.byteLength,
        );
        await trailer.append(chunk, write);
        if (chunksRead % REQUEST_BODY_YIELD_INTERVAL === 0) {
          await yieldToMacrotask();
          if (processing.signal.aborted) throw processing.signal.reason;
        }
      }
      await trailer.finish(write);
      parser!.end();
    })();

    await Promise.all([ingestion, parserDone.promise, fileDone.promise]);
    if (processing.signal.aborted) throw processing.signal.reason;
    if (primaryFailure) throw primaryFailure;
    if (filename === null || mediaType === null) {
      throw parserFailure("multipart file metadata is missing");
    }
    reader.releaseLock();
    reader = null;
    return { path: stagedPath, filename, mediaType, size, cleanup };
  } catch (error) {
    const failure = recordFailure(normalizeFailure(error));
    stop(failure);
    await Promise.allSettled(
      [ingestion, filePipeline].filter(
        (promise): promise is Promise<void> => promise !== null,
      ),
    );
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new MultipartUploadError(
        "upload-cleanup-failed",
        "failed to clean up multipart upload",
        { cause: new AggregateError([failure, cleanupError]) },
      );
    }
    throw failure;
  } finally {
    for (const { signal, onAbort } of abortListeners) {
      signal.removeEventListener("abort", onAbort);
    }
    if (reader) {
      try {
        reader.releaseLock();
      } catch {}
    }
  }
}
