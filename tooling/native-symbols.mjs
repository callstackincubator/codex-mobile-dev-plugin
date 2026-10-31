import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

// Keeps a dSYM bundle the compiler already produced (Cargo's packed debug info or
// clang's single-step link) for the Sentry upload. `saveNativeSymbols` instead runs
// dsymutil on a binary whose object files still exist.
export async function saveDarwinSymbols(dsym, name, { move = false } = {}) {
  const directory = resolve(".sentry/native/darwin-arm64");
  const destination = `${directory}/${name}.dSYM`;
  await mkdir(directory, { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await cp(dsym, destination, { recursive: true, dereference: true });
  if (move) await rm(dsym, { recursive: true, force: true });
}
