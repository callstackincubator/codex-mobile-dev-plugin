import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { AppIntelSnapshot, AppIntelStatus } from "@mobile-dev/shared/app-intelligence.ts";
import { clearAppIntel, readAppIntel, readRecentProjects, readRememberedProject, rememberProject, validateProjectPath, writeAppIntel } from "./storage.ts";

type Run = NonNullable<AppIntelStatus["run"]> & { controller: AbortController; worker?: Worker };

type WorkerMessage =
  | { type: "progress"; message: string }
  | { type: "result"; snapshot: AppIntelSnapshot }
  | { type: "error"; name: string; message: string };

function workerUrl() {
  return new URL(import.meta.url.endsWith(".ts") ? "./worker.ts" : "./app-intelligence-worker.mjs", import.meta.url);
}

export class AppIntelligenceService {
  private runs = new Map<string, Run>();

  async project(path?: string, remember = false) {
    const candidate = path ?? await readRememberedProject();
    if (!candidate) throw new Error("No project selected. Choose a project folder in App Intelligence or pass projectPath.");
    const projectPath = await validateProjectPath(candidate);
    if (remember) await rememberProject(projectPath);
    return projectPath;
  }

  async status(path?: string): Promise<AppIntelStatus> {
    const projectPath = await this.project(path);
    const snapshot = await readAppIntel(projectPath);
    const run = this.runs.get(projectPath);
    return { projectPath, run: run ? { runId: run.runId, phase: run.phase, message: run.message } : null, snapshot: snapshot ? { analyzedAt: snapshot.meta.analyzedAt, generation: snapshot.meta.generation } : null };
  }

  async snapshot(path?: string, remember = false): Promise<{ projectPath: string; snapshot: AppIntelSnapshot | null; recents: string[] }> {
    const projectPath = await this.project(path, remember);
    return { projectPath, snapshot: await readAppIntel(projectPath), recents: await readRecentProjects() };
  }

  /** The projects offered when nothing is selected yet, so the picker is never empty on a cold start. */
  async recents(): Promise<string[]> { return await readRecentProjects(); }

  async generate(path?: string, signal?: AbortSignal): Promise<{ projectPath: string; snapshot: AppIntelSnapshot }> {
    const projectPath = await this.project(path, true);
    if (this.runs.has(projectPath)) throw new Error("App Intelligence generation is already running for this project.");
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const run: Run = { runId: randomUUID(), phase: "discovering", message: "Discovering project", controller };
    this.runs.set(projectPath, run);
    try {
      const snapshot = await new Promise<AppIntelSnapshot>((resolve, reject) => {
        const worker = new Worker(workerUrl(), { workerData: { projectPath } });
        run.worker = worker;
        let settled = false;
        const finish = (operation: () => void) => {
          if (settled) return;
          settled = true;
          controller.signal.removeEventListener("abort", cancel);
          operation();
        };
        const cancel = () => {
          void worker.terminate();
          finish(() => reject(controller.signal.reason ?? new Error("Generation cancelled.")));
        };
        controller.signal.addEventListener("abort", cancel, { once: true });
        worker.on("message", (message: WorkerMessage) => {
          if (message.type === "progress") {
            run.phase = "analyzing";
            run.message = message.message;
          } else if (message.type === "result") finish(() => resolve(message.snapshot));
          else {
            const error = new Error(message.message);
            error.name = message.name;
            finish(() => reject(error));
          }
        });
        worker.on("error", error => finish(() => reject(error)));
        worker.on("exit", code => {
          if (code !== 0 && !controller.signal.aborted) finish(() => reject(new Error(`App Intelligence worker exited with code ${code}.`)));
        });
        if (controller.signal.aborted) cancel();
      });
      controller.signal.throwIfAborted(); run.phase = "saving"; run.message = "Saving snapshot";
      await writeAppIntel(projectPath, snapshot);
      return { projectPath, snapshot };
    } finally { signal?.removeEventListener("abort", abort); this.runs.delete(projectPath); }
  }

  async clear(path?: string): Promise<{ projectPath: string; snapshot: null; recents: string[] }> {
    const projectPath = await this.project(path);
    if (this.runs.has(projectPath)) throw new Error("App Intelligence is still generating for this project. Cancel it first.");
    await clearAppIntel(projectPath);
    return { projectPath, snapshot: null, recents: await readRecentProjects() };
  }

  async cancel(path?: string) {
    const projectPath = await this.project(path);
    const run = this.runs.get(projectPath);
    run?.controller.abort(new Error("Generation cancelled."));
  }
}

