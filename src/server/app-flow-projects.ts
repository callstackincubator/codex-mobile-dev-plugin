import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import type { AppFlowProjectEntry } from "../shared/app-flow.ts";
import { chooseProjectFolder } from "./project-folder-dialog.ts";
import { recordProjectDialog } from "./telemetry.ts";

/**
 * The projects App Flow can offer in its selector, so the panel's project field is a picker
 * instead of a path to type. It is a navigation aid only: the engine still reads structure and
 * screenshots from `app-flows/<projectId>/`, and a project this list loses is one dialog away.
 *
 * Two sources are merged. The engine's own registry names every project a map was built for, even
 * one started from chat, and this module's file adds the folder the user last picked before any run
 * exists. The list lives on the server rather than in the panel's browser storage because the panel
 * document is rebuilt for each host session, and only the server can also hand a folder to the
 * system picker.
 */
const REGISTRY_FILE = "projects.json";
const MAX_PROJECTS = 12;

export interface AppFlowProjectChoice {
  path: string;
  name: string;
  lastPickedAt: string;
}

/** A folder as one of the two registries holds it, before the display name is derived. */
interface Choice {
  path: string;
  lastPickedAt: string;
}

interface Registry {
  version: 1;
  projects: Choice[];
}

/** Drops the trailing slash macOS gives the home folder and folds Unicode spellings together. */
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

async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, "utf-8")); }
  catch { return null; }
}

/** An unparseable date sorts last rather than throwing away an otherwise useful folder. */
function timestamp(value: unknown): string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : "";
}

export class AppFlowProjectChoices {
  readonly directory: string;
  /** The system folder picker, injectable so a test never opens a dialog. */
  private readonly pick: () => Promise<string | undefined>;
  // The panel opens its selector, chooses a project and starts a build in quick succession, and the
  // model's process writes the engine registry into the same folder. Reads therefore have to see
  // this process's own writes, and every write starts from the newest list rather than a snapshot.
  private updates: Promise<unknown> = Promise.resolve();

  constructor(directory: string, pick: () => Promise<string | undefined> = chooseProjectFolder) {
    this.directory = directory;
    this.pick = pick;
  }

  private get path(): string { return join(this.directory, REGISTRY_FILE); }

  private get enginePath(): string { return join(this.directory, "app-flows", REGISTRY_FILE); }

  /** Folders this picker recorded, newest first. */
  private async read(): Promise<Choice[]> {
    const saved = await readJson(this.path) as Partial<Registry> | null;
    const entries = Array.isArray(saved?.projects) ? saved.projects : [];
    return entries
      .filter((entry): entry is Choice => typeof entry?.path === "string")
      .map(entry => ({ path: entry.path, lastPickedAt: timestamp(entry.lastPickedAt) }));
  }

  /** Folders a map was built for, which the engine records even for a run started from chat. */
  private async readEngine(): Promise<Choice[]> {
    const saved = await readJson(this.enginePath);
    const entries = Array.isArray(saved) ? saved as Array<Partial<AppFlowProjectEntry>> : [];
    return entries
      .filter((entry): entry is { path: string; lastOpenedAt?: string } => typeof entry?.path === "string")
      .map(entry => ({ path: entry.path, lastPickedAt: timestamp(entry.lastOpenedAt) }));
  }

  /** Newest first, once per folder, and short enough that the selector stays scannable. */
  private static clean(projects: readonly Choice[]): AppFlowProjectChoice[] {
    const seen = new Set<string>();
    const unique: AppFlowProjectChoice[] = [];
    for (const entry of [...projects].sort((left, right) => right.lastPickedAt.localeCompare(left.lastPickedAt))) {
      if (!isAbsolute(entry.path)) continue;
      const path = normalize(entry.path);
      if (seen.has(path)) continue;
      seen.add(path);
      unique.push({ path, name: basename(path) || path, lastPickedAt: entry.lastPickedAt });
    }
    return unique.slice(0, MAX_PROJECTS);
  }

  /** Only this picker's own folders are stored; the engine registry is re-read every time. */
  private async write(projects: readonly Choice[]): Promise<void> {
    const registry: Registry = { version: 1, projects: projects.map(entry => ({ path: normalize(entry.path), lastPickedAt: entry.lastPickedAt })) };
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(registry, null, 2), "utf-8");
      await rename(temporary, this.path);
    } finally {
      // A failed rename leaves its temporary file behind; a successful one has already moved it.
      await unlink(temporary).catch(() => undefined);
    }
  }

  private async change(changed: (known: Choice[]) => Choice[]): Promise<AppFlowProjectChoice[]> {
    const next = this.updates.catch(() => undefined).then(async () => {
      const known = AppFlowProjectChoices.clean(changed(await this.read())).map(entry => ({ path: entry.path, lastPickedAt: entry.lastPickedAt }));
      await this.write(known);
      return AppFlowProjectChoices.clean([...known, ...(await this.readEngine())]);
    });
    this.updates = next;
    return await next;
  }

  /** Available project folders, newest first, with folders that no longer exist left out. */
  async list(): Promise<AppFlowProjectChoice[]> {
    const projects = AppFlowProjectChoices.clean([...(await this.read()), ...(await this.readEngine())]);
    const available = await Promise.all(projects.map(async entry => ((await isDirectory(entry.path)) ? entry : null)));
    return available.filter((entry): entry is AppFlowProjectChoice => entry !== null);
  }

  /**
   * Records the folder the user picked. The panel offers no way to type a path, so one App Flow
   * could not open is refused here rather than reaching a run and failing there.
   */
  async record(projectPath: string): Promise<AppFlowProjectChoice> {
    const path = normalize(projectPath.trim());
    if (!isAbsolute(path)) throw new Error("Choose the app's project folder.");
    if (!(await isDirectory(path))) throw new Error("That project folder no longer exists.");
    const stamp = new Date().toISOString();
    const projects = await this.change(known => [{ path, lastPickedAt: stamp }, ...known.filter(entry => !same(entry.path, path))]);
    const recorded = projects.find(entry => same(entry.path, path));
    if (!recorded) throw new Error("That project folder no longer exists.");
    return recorded;
  }

  /** Opens the system folder picker and records what it returns. Undefined means the user cancelled. */
  async choose(): Promise<AppFlowProjectChoice | undefined> {
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
