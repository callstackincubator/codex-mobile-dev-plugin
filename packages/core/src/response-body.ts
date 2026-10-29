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
