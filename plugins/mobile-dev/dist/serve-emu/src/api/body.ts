import { ApiError } from "./api-error.ts";

export const DEFAULT_MAX_JSON_BODY_BYTES = 8 * 1024;

function assertByteLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative safe integer");
  }
}

function rejectOversizedContentLength(
  request: Request,
  maxBytes: number,
): void {
  const header = request.headers.get("content-length");
  if (header === null) return;
  if (!/^\d+$/.test(header)) {
    throw new ApiError(400, "invalid_request", "Invalid Content-Length header");
  }
  if (BigInt(header) > BigInt(maxBytes)) {
    throw new ApiError(413, "payload_too_large", "Request body is too large");
  }
}

/**
 * Read a request body while enforcing the limit against bytes actually read.
 * Content-Length is only an early rejection hint and is never trusted as the
 * body's real size.
 */
export async function readBodyBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  assertByteLimit(maxBytes);
  rejectOversizedContentLength(request, maxBytes);

  if (!request.body) return new Uint8Array();

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch (cause) {
    throw new ApiError(400, "invalid_request", "Unable to read request body", {
      cause,
    });
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        void reader.cancel("request body too large").catch(() => {});
        throw new ApiError(
          413,
          "payload_too_large",
          "Request body is too large",
        );
      }
      chunks.push(value);
    }
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;
    throw new ApiError(400, "invalid_request", "Unable to read request body", {
      cause,
    });
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readJsonBody(
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  const bytes = await readBodyBytes(request, maxBytes);
  if (bytes.byteLength === 0) {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON", {
      cause,
    });
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON", {
      cause,
    });
  }
}
