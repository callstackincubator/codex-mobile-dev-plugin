type ScreenshotOptions = {
  url(): URL;
  signal: AbortSignal;
  recover?(): Promise<unknown>;
  request?: typeof fetch;
};

const disconnected = (error: unknown) => {
  const code = (error as {cause?: {code?: string}})?.cause?.code;
  return code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'UND_ERR_SOCKET';
};

async function recoverWithinCapture(recover: () => Promise<unknown>, signal: AbortSignal) {
  signal.throwIfAborted();
  // Backend startup is shared with the panel. A cancelled capture must release
  // its listener and return without cancelling another panel's startup.
  await new Promise<void>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, {once: true});
    Promise.resolve().then(() => {signal.throwIfAborted(); return recover();}).then(
      () => { signal.removeEventListener('abort', abort); resolve(); },
      error => { signal.removeEventListener('abort', abort); reject(error); },
    );
    if (signal.aborted) abort();
  });
}

/** Retry a disconnected native backend once without reopening the app view. */
export async function readFlowScreenshot({url, signal, recover, request = fetch}: ScreenshotOptions) {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const response = await request(url(), {redirect: 'error', signal});
      if (!response.ok) throw new Error(`Screenshot failed with HTTP ${response.status}.`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 16 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Device returned an invalid screenshot.');
      return bytes;
    } catch (error) {
      if (attempt || !recover || signal.aborted || !disconnected(error)) throw error;
      await recoverWithinCapture(recover, signal);
    }
  }
}
