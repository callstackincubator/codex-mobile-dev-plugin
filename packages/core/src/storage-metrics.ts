import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { captureServerError, gauge, telemetryEnabled } from "./telemetry.ts";

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

/** Gauges each directory's size every five minutes, from now; nothing runs while telemetry is off. */
export function startStorageMetrics(directories: Record<string, string>): () => void {
  if (!telemetryEnabled()) return () => {};
  let collecting = false;
  let stopped = false;
  async function collect() {
    if (collecting || stopped) return;
    collecting = true;
    try {
      for (const [kind, directory] of Object.entries(directories)) {
        const bytes = await directoryBytes(directory);
        if (stopped) return;
        gauge("storage.bytes", bytes, { kind }, "byte");
      }
    } catch (error) { captureServerError(error, "storage.measure"); }
    finally { collecting = false; }
  }
  void collect();
  const timer = setInterval(() => { void collect(); }, 300_000);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
