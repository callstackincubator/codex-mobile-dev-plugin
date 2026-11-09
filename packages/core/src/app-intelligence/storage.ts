import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
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

/** How many projects the picker offers. Enough to switch between apps, short enough to scan. */
const RECENT_LIMIT = 8;
export type AppIntelPreferences = { projectPath: string | null; recents: string[] };

export async function readPreferences(): Promise<AppIntelPreferences> {
  try {
    const value = JSON.parse(await readFile(preferencePath, "utf8"));
    const projectPath = typeof value.projectPath === "string" ? value.projectPath : null;
    const stored = Array.isArray(value.recents) ? value.recents.filter((entry: unknown): entry is string => typeof entry === "string") : [];
    // An older preferences file holds one path and no list, so the chosen project seeds the list.
    const recents = [...new Set([...(projectPath ? [projectPath] : []), ...stored])].slice(0, RECENT_LIMIT);
    return { projectPath, recents };
  } catch { return { projectPath: null, recents: [] }; }
}

export async function readRememberedProject(): Promise<string | null> {
  return (await readPreferences()).projectPath;
}

export async function readRecentProjects(): Promise<string[]> {
  return (await readPreferences()).recents;
}

/** Most recent first, deduplicated, so the picker reflects the order projects were last opened. */
export async function rememberProject(projectPath: string) {
  const { recents } = await readPreferences();
  const next = [projectPath, ...recents.filter(entry => entry !== projectPath)].slice(0, RECENT_LIMIT);
  await atomicWrite(preferencePath, JSON.stringify({ projectPath, recents: next }));
}
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

/** Drops one project's saved graph. The project stays remembered, so it can be generated again. */
export async function clearAppIntel(projectPath: string) {
  await rm(snapshotPath(projectPath), { force: true });
}

