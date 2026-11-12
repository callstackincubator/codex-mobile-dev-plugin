import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { draftSummary, testDraftIdSchema, testDraftSchema } from "@mobile-dev/shared/test-drafts.ts";
import type { TestDraft, TestDraftSummary } from "@mobile-dev/shared/test-drafts.ts";
import { TESTING_DIRECTORY } from "./testing-projects.ts";

export const DRAFTS_DIRECTORY = join(TESTING_DIRECTORY, "drafts");

/**
 * How many unsaved recordings are kept. Past this the oldest goes: a draft is a safety net for the
 * flow the user is working on, not an archive, and an unbounded folder of them would be a list
 * nobody can read and a prompt nobody answers.
 */
const MAX_DRAFTS = 30;

function normalizeProject(projectPath: string): string {
  const trimmed = projectPath.length > 1 ? projectPath.replace(/\/+$/, "") : projectPath;
  return trimmed.normalize("NFC");
}

function sameProject(left: string, right: string): boolean {
  return normalizeProject(left).localeCompare(normalizeProject(right), "en", { sensitivity: "base" }) === 0;
}

/**
 * The recordings the Testing panel has not written into a project yet.
 *
 * One file per draft, named by its id, the same shape `RecordingStore` uses for performance
 * recordings: a draft is read and replaced whole, and a file per draft means a delete is an
 * `unlink` rather than a rewrite of everyone else's work. The steps are stored as data rather than
 * as the emitted source, so reopening one puts the flow back in the step list where it can still
 * be edited — the generated file is an output, not a format to read back.
 */
export class TestDraftStore {
  readonly directory: string;
  /** Serializes writes, so two autosaves racing cannot interleave a prune with a save. */
  private updates: Promise<unknown> = Promise.resolve();

  constructor(directory = DRAFTS_DIRECTORY) { this.directory = directory; }

  private path(id: string): string { return join(this.directory, `${id}.json`); }

  private async writeFileAtomic(id: string, draft: TestDraft): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.path(id);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(draft), { mode: 0o600 });
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private async ids(): Promise<string[]> {
    let entries;
    try { entries = await readdir(this.directory, { withFileTypes: true }); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
      .map(entry => entry.name.slice(0, -5))
      .filter(id => testDraftIdSchema.safeParse(id).success);
  }

  /** Reads one draft, or undefined when it is gone or no longer parses. */
  async read(id: string): Promise<TestDraft | undefined> {
    const parsedId = testDraftIdSchema.safeParse(id);
    if (!parsedId.success) return undefined;
    const text = await readFile(this.path(parsedId.data), "utf8").catch(() => undefined);
    if (text === undefined) return undefined;
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return undefined; }
    const draft = testDraftSchema.safeParse(parsed);
    // A draft written by a newer plugin, or one that was truncated, is skipped rather than thrown:
    // it must not take the rest of the list down with it.
    if (!draft.success || draft.data.id !== parsedId.data) return undefined;
    return draft.data as TestDraft;
  }

  /**
   * The drafts of one project, newest first. Unreadable files are dropped from the list; a project
   * path of "" lists every draft, which is what the panel shows before a project is chosen.
   */
  async list(projectPath = ""): Promise<TestDraftSummary[]> {
    const drafts = await Promise.all((await this.ids()).map(id => this.read(id)));
    return drafts
      .filter((draft): draft is TestDraft => draft !== undefined)
      .filter(draft => !projectPath || sameProject(draft.projectPath, projectPath))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(draftSummary);
  }

  /**
   * Writes one draft, creating it when `id` names nothing. Returns what was stored, so the caller
   * learns the id the panel then autosaves under.
   */
  async save(input: {
    id?: string; projectPath: string; title: string; fileName?: string;
    origin?: "user" | "agent"; steps: TestDraft["steps"];
  }): Promise<TestDraft> {
    const projectPath = normalizeProject(input.projectPath.trim());
    if (!projectPath) throw new ExpectedOperationError("invalid_input", "Choose the project folder.");
    if (input.steps.length === 0) throw new ExpectedOperationError("invalid_input", "Record a step before saving a draft.");
    const next = this.updates.catch(() => undefined).then(async () => {
      const existing = input.id ? await this.read(input.id) : undefined;
      const now = new Date().toISOString();
      const draft: TestDraft = {
        schemaVersion: 1,
        id: existing?.id ?? (testDraftIdSchema.safeParse(input.id).success ? input.id! : randomUUID()),
        projectPath,
        title: input.title.slice(0, 160),
        fileName: (input.fileName ?? existing?.fileName ?? "").slice(0, 256),
        origin: input.origin ?? existing?.origin ?? "user",
        steps: input.steps,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const validated = testDraftSchema.parse(draft) as TestDraft;
      await this.writeFileAtomic(validated.id, validated);
      await this.prune(validated.id);
      return validated;
    });
    this.updates = next;
    return await next;
  }

  /** Forgets one draft. Deleting one that is already gone is not an error. */
  async remove(id: string): Promise<boolean> {
    const parsed = testDraftIdSchema.safeParse(id);
    if (!parsed.success) return false;
    const next = this.updates.catch(() => undefined).then(async () => {
      const path = this.path(parsed.data);
      const existed = await stat(path).then(entry => entry.isFile(), () => false);
      await rm(path, { force: true });
      return existed;
    });
    this.updates = next;
    return await next;
  }

  /** Drops the oldest drafts past `MAX_DRAFTS`, never the one just written. */
  private async prune(keep: string): Promise<void> {
    const drafts = await this.list();
    for (const draft of drafts.slice(MAX_DRAFTS)) {
      if (draft.id === keep) continue;
      await rm(this.path(draft.id), { force: true }).catch(() => undefined);
    }
  }
}
