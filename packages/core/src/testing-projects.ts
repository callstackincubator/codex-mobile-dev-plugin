import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { lstat, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { chooseProjectFolder } from "./project-folder-dialog.ts";
import { recordProjectDialog } from "./telemetry.ts";

/**
 * The projects the Testing panel can record against: folders holding an `e2e.config.ts`. The user
 * always picks one explicitly — the server's own cwd is never assumed to be a project, because the
 * host launches the server from wherever it likes and a wrong guess would write a test file into a
 * folder the user never chose.
 *
 * The list lives on the server, like App Flow's, because the panel document is rebuilt for each
 * host session and only the server can open the system folder picker.
 */
export const TESTING_DIRECTORY = join(homedir(), "Library/Application Support/mobile-dev/testing");

const REGISTRY_FILE = "projects.json";
const MAX_PROJECTS = 12;
const CONFIG_FILES = ["e2e.config.ts", "e2e.config.mts", "e2e.config.js", "e2e.config.mjs"] as const;

export interface TestingProjectChoice {
  path: string;
  name: string;
  lastPickedAt: string;
}

/** One target read out of the project's e2e config, as far as a static read can see it. */
export interface TestingTarget {
  name: string;
  platform?: string;
  bundleId?: string;
}

export interface TestingProjectConfig {
  path: string;
  name: string;
  /** Absolute path of the config file that was read. */
  configPath: string;
  targets: TestingTarget[];
}

interface Choice { path: string; lastPickedAt: string }
interface Registry { version: 1; projects: Choice[] }

function normalize(projectPath: string): string {
  const trimmed = projectPath.length > 1 ? projectPath.replace(/\/+$/, "") : projectPath;
  return trimmed.normalize("NFC");
}

function same(left: string, right: string): boolean {
  return normalize(left).localeCompare(normalize(right), "en", { sensitivity: "base" }) === 0;
}

async function isDirectory(path: string): Promise<boolean> {
  return await stat(path).then(entry => entry.isDirectory(), () => false);
}

async function isFile(path: string): Promise<boolean> {
  return await stat(path).then(entry => entry.isFile(), () => false);
}

async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, "utf-8")); }
  catch { return null; }
}

function timestamp(value: unknown): string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : "";
}

/** The e2e config file of a project folder, or undefined when it holds none. */
export async function findConfig(projectPath: string): Promise<string | undefined> {
  for (const file of CONFIG_FILES) {
    const candidate = join(projectPath, file);
    if (await isFile(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Reads the targets out of an e2e config without executing it.
 *
 * The config is TypeScript that imports the project's own engines, so evaluating it properly would
 * mean running the user's code in the server process. A static read is enough for what the panel
 * needs — a target name, its platform, and the bundle id to launch — and anything it cannot see is
 * left undefined for the panel to ask about once.
 */
export function parseTargets(source: string): TestingTarget[] {
  const targets: TestingTarget[] = [];
  const block = source.match(/targets\s*:\s*\[([\s\S]*?)\n\s*\]/);
  const body = block?.[1];
  if (!body) return targets;
  // Each entry starts at a `name:` and runs to the next one, so a bundleId is attributed to the
  // target it sits in rather than to the first target in the list.
  const names = [...body.matchAll(/name\s*:\s*["'`]([^"'`]+)["'`]/g)];
  for (const [index, match] of names.entries()) {
    const start = match.index ?? 0;
    const end = index + 1 < names.length ? names[index + 1].index ?? body.length : body.length;
    const entry = body.slice(start, end);
    const platform = entry.match(/platform\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    const bundleId = entry.match(/bundleId\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    targets.push({ name: match[1], ...(platform ? { platform } : {}), ...(bundleId ? { bundleId } : {}) });
  }
  return targets;
}

/** Reads one project's e2e config. Throws when the folder is not an e2e project. */
export async function inspectProject(projectPath: string): Promise<TestingProjectConfig> {
  const path = normalize(projectPath.trim());
  if (!isAbsolute(path)) throw new ExpectedOperationError("invalid_input", "Choose the project folder.");
  if (!(await isDirectory(path))) throw new ExpectedOperationError("invalid_input", "That project folder no longer exists.");
  const configPath = await findConfig(path);
  if (!configPath) throw new ExpectedOperationError("invalid_input", "That folder has no e2e.config.ts. Run `npx e2e init` in it first.");
  const source = await readFile(configPath, "utf-8").catch(() => "");
  return { path, name: basename(path) || path, configPath, targets: parseTargets(source) };
}

export class TestingProjectChoices {
  readonly directory: string;
  /** The system folder picker, injectable so a test never opens a dialog. */
  private readonly pick: () => Promise<string | undefined>;
  private updates: Promise<unknown> = Promise.resolve();

  constructor(directory: string, pick: () => Promise<string | undefined> = chooseProjectFolder) {
    this.directory = directory;
    this.pick = pick;
  }

  private get path(): string { return join(this.directory, REGISTRY_FILE); }

  private async read(): Promise<Choice[]> {
    const saved = await readJson(this.path) as Partial<Registry> | null;
    const entries = Array.isArray(saved?.projects) ? saved.projects : [];
    return entries
      .filter((entry): entry is Choice => typeof entry?.path === "string")
      .map(entry => ({ path: entry.path, lastPickedAt: timestamp(entry.lastPickedAt) }));
  }

  private static clean(projects: readonly Choice[]): TestingProjectChoice[] {
    const seen = new Set<string>();
    const unique: TestingProjectChoice[] = [];
    for (const entry of [...projects].sort((left, right) => right.lastPickedAt.localeCompare(left.lastPickedAt))) {
      if (!isAbsolute(entry.path)) continue;
      const path = normalize(entry.path);
      if (seen.has(path)) continue;
      seen.add(path);
      unique.push({ path, name: basename(path) || path, lastPickedAt: entry.lastPickedAt });
    }
    return unique.slice(0, MAX_PROJECTS);
  }

  private async write(projects: readonly Choice[]): Promise<void> {
    const registry: Registry = { version: 1, projects: projects.map(entry => ({ path: normalize(entry.path), lastPickedAt: entry.lastPickedAt })) };
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(registry, null, 2), "utf-8");
      await rename(temporary, this.path);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private async change(changed: (known: Choice[]) => Choice[]): Promise<TestingProjectChoice[]> {
    const next = this.updates.catch(() => undefined).then(async () => {
      const known = TestingProjectChoices.clean(changed(await this.read())).map(entry => ({ path: entry.path, lastPickedAt: entry.lastPickedAt }));
      await this.write(known);
      return TestingProjectChoices.clean(known);
    });
    this.updates = next;
    return await next;
  }

  /** Recorded folders that still exist and still hold an e2e config, newest first. */
  async list(): Promise<TestingProjectChoice[]> {
    const projects = TestingProjectChoices.clean(await this.read());
    const available = await Promise.all(projects.map(async entry => ((await findConfig(entry.path)) ? entry : null)));
    return available.filter((entry): entry is TestingProjectChoice => entry !== null);
  }

  /**
   * Records a chosen folder. A folder with no e2e config is refused here rather than at the first
   * recording, so the panel's own list never offers one the recorder cannot write a test for.
   */
  async record(projectPath: string): Promise<TestingProjectChoice> {
    const { path } = await inspectProject(projectPath);
    const stamp = new Date().toISOString();
    const projects = await this.change(known => [{ path, lastPickedAt: stamp }, ...known.filter(entry => !same(entry.path, path))]);
    const recorded = projects.find(entry => same(entry.path, path));
    if (!recorded) throw new ExpectedOperationError("invalid_input", "That project folder no longer exists.");
    return recorded;
  }

  /** Opens the system folder picker and records what it returns. Undefined means the user cancelled. */
  async choose(): Promise<TestingProjectChoice | undefined> {
    const startedAt = Date.now();
    try {
      const path = await this.pick();
      if (!path) {
        recordProjectDialog("cancelled", Date.now() - startedAt);
        return undefined;
      }
      const project = await this.record(path);
      recordProjectDialog("chosen", Date.now() - startedAt);
      return project;
    } catch (error) {
      recordProjectDialog("failed", Date.now() - startedAt);
      throw error;
    }
  }
}

/** Where a recorded test may be written: the project's own `tests/` folder, nothing else. */
const TESTS_DIRECTORY = "tests";
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_TEST_BYTES = 256 * 1024;

export interface WrittenTest { path: string; written: boolean; existed: boolean }

/**
 * Resolves the absolute path a recorded test may be written to.
 *
 * The panel can ask the server to write a file, so this is the boundary that decides where. A
 * path is accepted only when it is inside the chosen project's `tests/` folder after resolution,
 * which is what rejects `..`, an absolute path, and a name that climbs out through a symlinked
 * directory. The caller has already been told the file must be a `.e2e.ts`.
 */
export async function resolveTestPath(projectPath: string, relativePath: string): Promise<string> {
  const root = normalize(projectPath.trim());
  if (!isAbsolute(root)) throw new ExpectedOperationError("invalid_input", "Choose the project folder.");
  const requested = relativePath.trim().replace(/\\/g, "/");
  const segments = requested.split("/").filter(Boolean);
  if (segments[0] !== TESTS_DIRECTORY) throw new ExpectedOperationError("invalid_input", "A recorded test is written inside the project's tests/ folder.");
  if (segments.length < 2) throw new ExpectedOperationError("invalid_input", "Name the test file.");
  if (!segments.every(segment => SEGMENT.test(segment))) throw new ExpectedOperationError("invalid_input", "Use letters, digits, dots, dashes and underscores in the file name.");
  if (!segments.at(-1)!.endsWith(".e2e.ts")) throw new ExpectedOperationError("invalid_input", "A recorded test file ends in .e2e.ts.");

  const testsRoot = resolve(root, TESTS_DIRECTORY);
  const target = resolve(root, ...segments);
  const inside = relative(testsRoot, target);
  if (inside.startsWith("..") || isAbsolute(inside)) throw new ExpectedOperationError("invalid_input", "A recorded test is written inside the project's tests/ folder.");

  // A symlinked directory on the way down would land the write outside the project however the
  // path reads, so each level from tests/ downwards is checked rather than trusting the resolved
  // string. Levels that do not exist yet are created by the write and cannot be links.
  let directory = testsRoot;
  for (const segment of [undefined, ...segments.slice(1, -1)]) {
    if (segment !== undefined) directory = join(directory, segment);
    const info = await lstat(directory).catch(() => undefined);
    if (info?.isSymbolicLink()) throw new ExpectedOperationError("invalid_input", "That tests folder is a symbolic link.");
  }
  const existing = await lstat(target).catch(() => undefined);
  if (existing?.isSymbolicLink()) throw new ExpectedOperationError("invalid_input", "That test file is a symbolic link.");
  if (existing && !existing.isFile()) throw new ExpectedOperationError("invalid_input", "That path is not a file.");
  return target;
}

/**
 * Writes one recorded test into the project. Without `overwrite` an existing file is reported
 * rather than replaced, so the panel can ask before it destroys someone's test.
 */
export async function writeTestFile(projectPath: string, relativePath: string, contents: string, overwrite = false): Promise<WrittenTest> {
  const { path: root } = await inspectProject(projectPath);
  if (Buffer.byteLength(contents, "utf-8") > MAX_TEST_BYTES) throw new ExpectedOperationError("invalid_input", "That test is too large to write.");
  const target = await resolveTestPath(root, relativePath);
  const existed = await isFile(target);
  if (existed && !overwrite) return { path: target, written: false, existed };
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, "utf-8");
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return { path: target, written: true, existed };
}
