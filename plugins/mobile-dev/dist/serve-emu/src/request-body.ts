export const HTTP_BODY_ERROR_STATUS = {
  "payload-too-large": 413,
  "too-many-body-chunks": 413,
  "invalid-content-length": 400,
  "request-aborted": 499,
  "body-read-failed": 400,
  "invalid-json": 400,
} as const;

export const MAX_REQUEST_BODY_CHUNKS = 262_144;
export const REQUEST_BODY_YIELD_INTERVAL = 256;

export type HttpBodyErrorCode = keyof typeof HTTP_BODY_ERROR_STATUS;
export type HttpBodyErrorStatus =
  (typeof HTTP_BODY_ERROR_STATUS)[HttpBodyErrorCode];

type HttpBodyErrorOptions = {
  cause?: unknown;
  limit?: number;
  received?: number;
};

export class HttpBodyError extends Error {
  readonly code: HttpBodyErrorCode;
  readonly status: HttpBodyErrorStatus;
  readonly limit?: number;
  readonly received?: number;

  constructor(
    code: HttpBodyErrorCode,
    message: string,
    options: HttpBodyErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "HttpBodyError";
    this.code = code;
    this.status = HTTP_BODY_ERROR_STATUS[code];
    this.limit = options.limit;
    this.received = options.received;
  }
}

function assertMaxBytes(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative safe integer");
  }
}

function abortedError(signal: AbortSignal): HttpBodyError {
  return new HttpBodyError("request-aborted", "request body read aborted", {
    cause: signal.reason,
  });
}

function bodyTooLargeError(
  maxBytes: number,
  received?: number,
): HttpBodyError {
  return new HttpBodyError(
    "payload-too-large",
    `request body exceeds ${maxBytes} bytes`,
    { limit: maxBytes, received },
  );
}

function tooManyBodyChunksError(received: number): HttpBodyError {
  return new HttpBodyError(
    "too-many-body-chunks",
    `request body exceeds ${MAX_REQUEST_BODY_CHUNKS} chunks`,
    { limit: MAX_REQUEST_BODY_CHUNKS, received },
  );
}

export function yieldToMacrotask(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function parseContentLength(request: Request, maxBytes: number): number | null {
  const header = request.headers.get("content-length");
  if (header === null) return null;

  const value = header.trim();
  if (!/^\d+$/.test(value)) {
    throw new HttpBodyError(
      "invalid-content-length",
      "content-length must be a non-negative integer",
    );
  }

  const declared = BigInt(value);
  if (declared > BigInt(maxBytes)) {
    throw bodyTooLargeError(
      maxBytes,
      declared <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(declared)
        : undefined,
    );
  }
  return Number(declared);
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

/**
 * Materialize a small request body while enforcing the bytes actually read.
 * Content-Length is only an early rejection optimization; streamed bytes are
 * always counted, so a missing or understated header cannot bypass the limit.
 */
export async function readBodyLimited(
  request: Request,
  maxBytes: number,
  externalSignal?: AbortSignal,
): Promise<Uint8Array> {
  assertMaxBytes(maxBytes);

  try {
    parseContentLength(request, maxBytes);
  } catch (error) {
    await cancelUnlockedBody(request.body, error);
    throw error;
  }

  const signals = Array.from(
    new Set(
      [request.signal, externalSignal].filter(
        (signal): signal is AbortSignal => signal !== undefined,
      ),
    ),
  );
  const alreadyAborted = signals.find((signal) => signal.aborted);
  if (alreadyAborted) {
    const error = abortedError(alreadyAborted);
    await cancelUnlockedBody(request.body, error);
    throw error;
  }

  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  let abortFailure: HttpBodyError | null = null;
  let cancelPromise: Promise<void> | null = null;

  const cancel = (reason: unknown): Promise<void> => {
    if (!cancelPromise) {
      cancelPromise = reader.cancel(reason).then(
        () => {},
        () => {},
      );
    }
    return cancelPromise;
  };

  const listeners = signals.map((signal) => {
    const onAbort = () => {
      abortFailure ??= abortedError(signal);
      void cancel(abortFailure);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    return { signal, onAbort };
  });

  // Cover an abort that raced with listener registration.
  for (const { signal, onAbort } of listeners) {
    if (signal.aborted) onAbort();
  }

  let body = new Uint8Array(Math.min(maxBytes, 16 * 1024));
  let received = 0;
  let chunksRead = 0;

  try {
    while (true) {
      const next = await reader.read();
      if (abortFailure) throw abortFailure;
      if (next.done) break;

      chunksRead += 1;
      if (chunksRead > MAX_REQUEST_BODY_CHUNKS) {
        const error = tooManyBodyChunksError(chunksRead);
        await cancel(error);
        throw error;
      }

      const nextReceived = received + next.value.byteLength;
      if (nextReceived > maxBytes) {
        const error = bodyTooLargeError(maxBytes, nextReceived);
        await cancel(error);
        throw error;
      }
      if (nextReceived > body.byteLength) {
        const capacity = Math.min(
          maxBytes,
          Math.max(nextReceived, Math.max(1024, body.byteLength * 2)),
        );
        const grown = new Uint8Array(capacity);
        grown.set(body.subarray(0, received));
        body = grown;
      }
      body.set(next.value, received);
      received = nextReceived;

      if (chunksRead % REQUEST_BODY_YIELD_INTERVAL === 0) {
        await yieldToMacrotask();
        if (abortFailure) throw abortFailure;
      }
    }

    if (abortFailure) throw abortFailure;
    return received === body.byteLength ? body : body.slice(0, received);
  } catch (cause) {
    const error =
      cause instanceof HttpBodyError
        ? cause
        : abortFailure ??
          new HttpBodyError(
            "body-read-failed",
            "failed to read request body",
            { cause },
          );
    await cancel(error);
    throw error;
  } finally {
    for (const { signal, onAbort } of listeners) {
      signal.removeEventListener("abort", onAbort);
    }
    reader.releaseLock();
  }
}

export async function readJsonLimited(
  request: Request,
  maxBytes: number,
  externalSignal?: AbortSignal,
): Promise<unknown> {
  const body = await readBodyLimited(request, maxBytes, externalSignal);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new HttpBodyError("invalid-json", "request body is not valid JSON", {
      cause,
    });
  }
}
