import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppIntelSnapshot } from "@mobile-dev/shared/app-intelligence.ts";

export const APP_INTEL_DIRECTORY = join(homedir(), "Library/Application Support/mobile-dev/app-intelligence");
const preferencePath = join(APP_INTEL_DIRECTORY, "preferences.json");
const projectKey = (path: string) => createHash("sha256").update(path).digest("hex");

export async function validateProjectPath(path: string): Promise<string> {
  if (!path || path.length > 4096) throw new Error("Choose a valid project folder.");
  const resolved = await realpath(path);
  if (!(await stat(resolved)).isDirectory()) throw new Error("The selected project path is not a directory.");
  return resolved;
}

async function atomicWrite(path: string, content: string) {
  await mkdir(APP_INTEL_DIRECTORY, { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, path);
}

export async function readRememberedProject(): Promise<string | null> {
  try { const value = JSON.parse(await readFile(preferencePath, "utf8")); return typeof value.projectPath === "string" ? value.projectPath : null; }
  catch { return null; }
}

export async function rememberProject(projectPath: string) { await atomicWrite(preferencePath, JSON.stringify({ projectPath })); }
export const snapshotPath = (projectPath: string) => join(APP_INTEL_DIRECTORY, `${projectKey(projectPath)}.json`);

export async function readAppIntel(projectPath: string): Promise<AppIntelSnapshot | null> {
  try {
    const value = JSON.parse(await readFile(snapshotPath(projectPath), "utf8")) as AppIntelSnapshot;
    if (value.formatVersion !== 1 || !value.meta || !value.screens || !value.indexes) throw new Error("Unsupported App Intelligence snapshot. Generate it again.");
    return value;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function writeAppIntel(projectPath: string, snapshot: AppIntelSnapshot) {
  await atomicWrite(snapshotPath(projectPath), JSON.stringify(snapshot));
}

