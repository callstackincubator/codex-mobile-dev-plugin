import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sourcePatch } from "./baguette-source-patch.mjs";

const replaceOnce = sourcePatch("subprocess pipe");

// Closing a read handle that still has a readability source can close its descriptor number
// again later, after another file reused it. Stop reading and let releasing the pipe close it.
export function stopReadingWithoutClosing(adapter) {
  adapter = replaceOnce(adapter,
    `        if let process, process.isRunning { process.terminate() }
        try? pipe?.fileHandleForReading.close()`,
    `        if let process, process.isRunning { process.terminate() }
        pipe?.fileHandleForReading.readabilityHandler = nil`);
  return replaceOnce(adapter,
    `        pipe?.fileHandleForReading.readabilityHandler = nil
        try? pipe?.fileHandleForReading.close()
        try? pipe?.fileHandleForWriting.close()`,
    `        pipe?.fileHandleForReading.readabilityHandler = nil
        try? pipe?.fileHandleForWriting.close()`);
}

export async function addSubprocessPipes(source) {
  const adapterPath = join(source, "Sources/Baguette/Infrastructure/Logs/HostSubprocess.swift");
  const adapter = await readFile(adapterPath, "utf8");
  const testPath = join(source, "Tests/BaguetteTests/Logs/MobileDevSubprocessPipeTests.swift");
  await copyFile("packages/native/baguette/SubprocessPipeTests.swift", testPath);
  await writeFile(adapterPath, stopReadingWithoutClosing(adapter));
}
