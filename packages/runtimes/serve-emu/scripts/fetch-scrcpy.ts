#!/usr/bin/env node
// Modified for Mobile Dev: Node.js runtime port and bundled scrcpy launch support.
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Canonical wire spec and scrcpy version upgrade checklist: ../docs/protocol.md
export const SCRCPY_VERSION = "4.0";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VENDOR_DIR = join(__dirname, "..", "vendor");
export const SCRCPY_SERVER_PATH = join(VENDOR_DIR, `scrcpy-server-v${SCRCPY_VERSION}`);

export async function ensureScrcpyServer(): Promise<string> {
  await access(SCRCPY_SERVER_PATH);
  return SCRCPY_SERVER_PATH;
}
