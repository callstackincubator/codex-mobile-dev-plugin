import { annotateDeviceCommand } from "@mobile-dev/shared/device-command-diagnostics.ts";

/** A binary backend response's size limit, with the messages its failures show when they need their own. */
export type ByteRequest = { maxBytes: number; timeout?: number; httpError?: (status: number) => string; tooLarge?: string };

/** A response body of at most `limit` bytes, or undefined for a longer one, which stops downloading. */
export async function readLimitedBody(response: Response, limit: number): Promise<Buffer | undefined> {
  const reader = response.body?.getReader();
  if (reader === undefined) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return Buffer.concat(chunks);
      size += chunk.value.byteLength;
      if (size > limit) return;
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** The bytes of a backend's response to `path`; failures name `command` and blame `source`. */
export async function responseBytes(response: Response, command: string, source: string, path: string, request: ByteRequest): Promise<Buffer> {
  const { maxBytes, httpError, tooLarge } = request;
  if (response.ok === false) {
    await response.body?.cancel().catch(() => {});
    const message = httpError?.(response.status) ?? `${source} returned HTTP ${response.status} for ${path}.`;
    throw annotateDeviceCommand(new Error(message), command, { failure: "http_status", status: response.status });
  }
  const bytes = await readLimitedBody(response, maxBytes).catch(error => { throw annotateDeviceCommand(error, command); });
  if (bytes === undefined) throw annotateDeviceCommand(new Error(tooLarge ?? `${source} returned more than ${maxBytes} bytes for ${path}.`), command, { failure: "output_limit" });
  return bytes;
}
