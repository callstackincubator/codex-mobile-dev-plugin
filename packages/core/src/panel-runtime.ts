import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, constants, lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { ExpectedOperationError, errorMessage } from "@mobile-dev/shared/error-reporting.ts";
import { bundledFile } from "./bundled-runtime.ts";
import { captureServerError, recordPanelRuntime } from "./telemetry.ts";

/** The panel's native parts, as the runtime archive and dist/ lay them out (tooling's PANEL_PARTS). */
export const PANEL_RUNTIME_PARTS = ["baguette", "serve-emu", "ios-mirror", "ios-mirror-service.mjs"] as const;
export type PanelRuntimeFile = "baguette/Baguette" | "serve-emu/src/cli.mjs" | "ios-mirror-service.mjs";

let locate: (() => Promise<string>) | undefined;

/** Where a panel part lives: beside the server by default (see bundledFile), or where usePanelRuntime puts it. */
export async function panelRuntimePath(file: PanelRuntimeFile): Promise<string> {
  return locate ? join(await locate(), file) : bundledFile(file);
}

/** Lets a host that ships without the panel's parts provide them, such as from a download. */
export function usePanelRuntime(root: () => Promise<string>) {
  locate = root;
}

export const panelRuntimeReleaseSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/),
  url: z.string().url().refine(url => /^(?:https|file):/.test(url), "The runtime must come from https or a local file."),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
});
/** The archive a package pins: written at packaging time beside the server as panel-runtime.json. */
export type PanelRuntimeRelease = z.infer<typeof panelRuntimeReleaseSchema>;

export class PanelRuntimeUnavailableError extends ExpectedOperationError {
  constructor(detail: string) {
    super("download_failed", `Mobile Dev could not download its device runtime: ${detail} Check the internet connection, then open Mobile Dev again.`);
  }
}

type Failure = "network" | "http" | "checksum" | "archive" | "filesystem";
class RuntimeFailure extends Error {
  readonly reason: Failure;
  constructor(reason: Failure, message: string) { super(message); this.reason = reason; }
}

const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const STALE_MS = 60 * 60_000;
const installed = /^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?-[0-9a-f]{12}$/;
const run = promisify(execFile);

/** The persistent folder for downloaded runtimes: the plugin's data folder in Claude Code, else the user's cache. */
export function panelRuntimeDirectory(env: NodeJS.ProcessEnv = process.env) {
  return env.CLAUDE_PLUGIN_DATA ? join(env.CLAUDE_PLUGIN_DATA, "panel-runtime") : join(homedir(), "Library", "Caches", "mobile-dev", "panel-runtime");
}

/**
 * Provides the panel's parts from the pinned archive, downloading and verifying it on first
 * use. Each version extracts into its own folder, which appears only once complete, so
 * servers of other sessions and releases can share the directory.
 */
export function downloadedPanelRuntime(release: PanelRuntimeRelease, directory = panelRuntimeDirectory()): () => Promise<string> {
  const target = join(directory, `${release.version}-${release.sha256.slice(0, 12)}`);
  let ready: Promise<string> | undefined;
  return () => {
    ready ??= prepare(release, directory, target).catch(error => {
      ready = undefined;
      throw error;
    });
    return ready;
  };
}

async function prepare(release: PanelRuntimeRelease, directory: string, target: string): Promise<string> {
  const startedAt = performance.now();
  if (await complete(target, release)) {
    recordPanelRuntime("cached", performance.now() - startedAt);
    return target;
  }
  try { await install(release, directory, target); }
  catch (error) {
    const failure = error instanceof RuntimeFailure ? error : new RuntimeFailure("filesystem", errorMessage(error));
    recordPanelRuntime("failed", performance.now() - startedAt, undefined, failure.reason);
    // Offline machines and unreachable releases are expected; a mismatch or a broken archive is not.
    if (failure.reason !== "network" && failure.reason !== "http") captureServerError(failure, "panel_runtime.prepare", { tags: { panel_runtime_failure: failure.reason } });
    throw new PanelRuntimeUnavailableError(failure.message);
  }
  recordPanelRuntime("downloaded", performance.now() - startedAt, release.bytes);
  void removeOtherVersions(directory, target).catch(() => {});
  return target;
}

async function install(release: PanelRuntimeRelease, directory: string, target: string) {
  const suffix = randomBytes(6).toString("hex");
  const archive = join(directory, `.download-${suffix}.tar.gz`);
  const staging = join(directory, `.staging-${suffix}`);
  try {
    await mkdir(directory, { recursive: true });
    await download(new URL(release.url), archive, release);
    await extract(archive, staging);
    await writeFile(join(staging, "panel-runtime.json"), JSON.stringify(release) + "\n");
    try { await rename(staging, target); }
    catch (error) {
      // Another server finished the same version first.
      if (await complete(target, release) === false) throw error;
    }
  } finally {
    await rm(archive, { force: true });
    await rm(staging, { recursive: true, force: true });
  }
}

async function complete(target: string, release: PanelRuntimeRelease) {
  try {
    const marker: unknown = JSON.parse(await readFile(join(target, "panel-runtime.json"), "utf8"));
    if (typeof marker !== "object" || marker === null || ("sha256" in marker && marker.sha256 === release.sha256) === false) return false;
    await access(join(target, "baguette/Baguette"), constants.X_OK);
    return true;
  } catch { return false; }
}

async function download(url: URL, destination: string, release: PanelRuntimeRelease) {
  let body: Readable;
  if (url.protocol === "file:") body = createReadStream(fileURLToPath(url));
  else {
    let response: Response;
    try { response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) }); }
    catch (error) { throw new RuntimeFailure("network", `the download did not complete (${errorMessage(error)}).`); }
    if (response.ok === false || response.body === null) throw new RuntimeFailure("http", `the release returned HTTP ${response.status}.`);
    body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
  }
  const hash = createHash("sha256");
  let size = 0;
  const measure = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength;
      if (size > release.bytes) return callback(new RuntimeFailure("checksum", "the archive is larger than the release it pins."));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try { await pipeline(body, measure, createWriteStream(destination, { flags: "wx", mode: 0o600 })); }
  catch (error) {
    if (error instanceof RuntimeFailure) throw error;
    throw new RuntimeFailure(url.protocol === "file:" ? "filesystem" : "network", `the download did not complete (${errorMessage(error)}).`);
  }
  if (size !== release.bytes || hash.digest("hex") !== release.sha256) throw new RuntimeFailure("checksum", "the archive does not match the release it pins.");
}

async function extract(archive: string, staging: string) {
  const { stdout } = await run("/usr/bin/tar", ["-tzf", archive], { maxBuffer: 16 * 1024 * 1024 }).catch(error => {
    throw new RuntimeFailure("archive", `the archive could not be read (${errorMessage(error)}).`);
  });
  for (const member of stdout.split("\n").filter(Boolean)) {
    const segments = member.replace(/^\.\//, "").split("/");
    if (member.startsWith("/") || segments.includes("..") || (PANEL_RUNTIME_PARTS as readonly string[]).includes(segments[0]) === false) {
      throw new RuntimeFailure("archive", "the archive holds files outside the device runtime.");
    }
  }
  await mkdir(staging);
  // Without -P, bsdtar refuses absolute paths, .. and writes through symlinks.
  await run("/usr/bin/tar", ["-xzf", archive, "-C", staging, "--no-same-owner"]).catch(error => {
    throw new RuntimeFailure("archive", `the archive could not be extracted (${errorMessage(error)}).`);
  });
  await assertPlainFiles(staging);
  for (const part of PANEL_RUNTIME_PARTS) {
    await access(join(staging, part)).catch(() => { throw new RuntimeFailure("archive", `the archive is missing ${part}.`); });
  }
  await access(join(staging, "baguette/Baguette"), constants.X_OK).catch(() => {
    throw new RuntimeFailure("archive", "the simulator backend in the archive is not executable.");
  });
}

// The parts have no links; anything but files and folders did not come from a release.
async function assertPlainFiles(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const stats = await lstat(path);
    if (stats.isDirectory()) await assertPlainFiles(path);
    else if (stats.isFile() === false) throw new RuntimeFailure("archive", "the archive holds links or special files.");
  }
}

// Keeps the newest other version for servers still running it, and drops abandoned downloads.
async function removeOtherVersions(directory: string, keep: string) {
  const entries = await readdir(directory);
  const versions: { path: string; modified: number }[] = [];
  for (const name of entries) {
    const path = join(directory, name);
    // Another server's download can finish and clean up while this one looks.
    const mtimeMs = await stat(path).then(stats => stats.mtimeMs, () => undefined);
    if (mtimeMs === undefined) continue;
    if (name.startsWith(".download-") || name.startsWith(".staging-")) {
      if (Date.now() - mtimeMs > STALE_MS) await rm(path, { recursive: true, force: true });
    } else if (installed.test(name) && path !== keep) versions.push({ path, modified: mtimeMs });
  }
  versions.sort((a, b) => b.modified - a.modified);
  for (const { path } of versions.slice(1)) await rm(path, { recursive: true, force: true });
}
