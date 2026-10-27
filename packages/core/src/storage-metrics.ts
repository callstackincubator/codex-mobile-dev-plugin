import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import * as Sentry from "@sentry/node";

export async function directoryBytes(directory: string): Promise<number> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }
  let bytes = 0;
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) bytes += await directoryBytes(path);
    else if (entry.isFile()) {
      try {
        const metadata = await stat(path);
        bytes += metadata.size;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
        throw error;
      }
    }
  }
  return bytes;
}

export function startStorageMetrics(directories: Record<string, string>): () => void {
  let collecting = false;
  let stopped = false;
  async function collect() {
    if (collecting || stopped) return;
    collecting = true;
    try {
      for (const [kind, directory] of Object.entries(directories)) {
        const bytes = await directoryBytes(directory);
        if (stopped) return;
        Sentry.metrics.gauge("storage.bytes", bytes, { unit: "byte", attributes: { kind } });
      }
    } catch (error) { Sentry.captureException(error, { tags: { operation: "storage.measure" } }); }
    finally { collecting = false; }
  }
  void collect();
  const timer = setInterval(() => { void collect(); }, 300_000);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
