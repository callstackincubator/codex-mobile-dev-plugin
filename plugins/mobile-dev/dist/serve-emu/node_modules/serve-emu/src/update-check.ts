import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_CHECK_CACHE = join(homedir(), ".cache", "serve-emu", "update-check.json");

export type UpdateCache = {
  checkedAt?: number;
  latestVersion?: string;
};

export type UpdateCheckOptions = {
  packageName: string;
  currentVersion: string;
  cachePath?: string;
  now?: () => number;
  fetchLatest?: (packageName: string) => Promise<string | null>;
  readCache?: (cachePath: string) => Promise<UpdateCache | null>;
  writeCache?: (cachePath: string, cache: UpdateCache) => Promise<void>;
};

function parseVersion(version: string): number[] {
  return version
    .replace(/^v/, "")
    .split("-")[0]
    .split(".")
    .map((part) => Number(part))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

export function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = parseVersion(latest);
  const currentParts = parseVersion(current);
  const length = Math.max(latestParts.length, currentParts.length);

  for (let i = 0; i < length; i++) {
    const latestPart = latestParts[i] ?? 0;
    const currentPart = currentParts[i] ?? 0;
    if (latestPart > currentPart) return true;
    if (latestPart < currentPart) return false;
  }

  return false;
}

async function readUpdateCache(cachePath = UPDATE_CHECK_CACHE): Promise<UpdateCache | null> {
  try {
    return JSON.parse(await readFile(cachePath, "utf8")) as UpdateCache;
  } catch {
    return null;
  }
}

async function writeUpdateCache(cachePath: string, cache: UpdateCache) {
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(cache)}\n`);
}

async function fetchLatestVersion(packageName: string): Promise<string | null> {
  const res = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
    signal: AbortSignal.timeout(1500),
  });
  if (!res.ok) return null;

  const latest = (await res.json()) as { version?: unknown };
  return typeof latest.version === "string" ? latest.version : null;
}

export async function getUpdateNotice(options: UpdateCheckOptions): Promise<string | null> {
  const cachePath = options.cachePath ?? UPDATE_CHECK_CACHE;
  const now = options.now ?? Date.now;
  const readCacheFn = options.readCache ?? readUpdateCache;
  const writeCacheFn = options.writeCache ?? writeUpdateCache;
  const fetchLatestFn = options.fetchLatest ?? fetchLatestVersion;

  const cached = await readCacheFn(cachePath);
  let latestVersion = cached?.latestVersion;

  if (!cached?.checkedAt || !latestVersion || now() - cached.checkedAt >= UPDATE_CHECK_INTERVAL_MS) {
    const fetchedVersion = await fetchLatestFn(options.packageName);
    if (!fetchedVersion) return null;
    latestVersion = fetchedVersion;
    await writeCacheFn(cachePath, { checkedAt: now(), latestVersion });
  }

  if (!isNewerVersion(latestVersion, options.currentVersion)) return null;

  return (
    `Update available: ${options.packageName} ${options.currentVersion} -> ${latestVersion}\n` +
    `Run: bunx ${options.packageName}@latest`
  );
}
