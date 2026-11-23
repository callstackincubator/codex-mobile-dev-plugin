import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppFlowPromptResolution } from "@mobile-dev/shared/app-flow.ts";
import type { AppFlowRunSnapshot } from "./app-flow-host.ts";

export interface SharedAppFlowRun extends AppFlowRunSnapshot {
  runId: string;
  ownerPid: number;
  updatedAt: string;
  /**
   * A persisted, strictly increasing revision — not `updatedAt` millisecond-precision wall-clock
   * time. Two writes landing in the same millisecond would otherwise stamp the same cursor value;
   * once `readEvent` had returned the first to a poller, `seq > since` would drop the second (which
   * can be the terminal event) forever, since the file holds only the latest snapshot and nothing
   * is left to supersede it with a later timestamp.
   */
  seq: number;
}

interface SharedPromptResolution {
  runId: string;
  promptId: string;
  resolution: AppFlowPromptResolution;
}

function projectId(projectPath: string): string {
  return createHash("sha256").update(projectPath).digest("hex").slice(0, 16);
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), "utf8");
  await rename(temporary, path);
}

/**
 * Bridges the App Flow panel and the Codex-owned sweep when the host gives them separate MCP
 * processes. The files contain only local control state and live beside the already-persisted
 * graph; they are never included in telemetry or model context.
 */
export class AppFlowRunStore {
  private readonly dataDir: string;

  constructor(dataDir: string) { this.dataDir = dataDir; }

  private directory(projectPath: string): string {
    return join(this.dataDir, "app-flows", projectId(projectPath));
  }

  private runPath(projectPath: string): string {
    return join(this.directory(projectPath), "active-run.json");
  }

  private resolutionPath(projectPath: string): string {
    return join(this.directory(projectPath), "prompt-resolution.json");
  }

  async writeRun(run: Omit<SharedAppFlowRun, "updatedAt" | "seq">): Promise<void> {
    const previous = await readJson(this.runPath(run.projectPath));
    const previousSeq = typeof previous?.seq === "number" && Number.isFinite(previous.seq) ? previous.seq : 0;
    await writeJson(this.runPath(run.projectPath), {
      ...run,
      updatedAt: new Date().toISOString(),
      seq: previousSeq + 1,
    });
  }

  async readRun(projectPath: string): Promise<SharedAppFlowRun | null> {
    const value = await readJson(this.runPath(projectPath));
    if (!value || typeof value.runId !== "string" || value.projectPath !== projectPath ||
      typeof value.state !== "string" || typeof value.ownerPid !== "number" || typeof value.updatedAt !== "string") return null;
    return value as unknown as SharedAppFlowRun;
  }

  /**
   * Replays the latest durable event through the panel's ordinary event-poll contract. This is
   * the compatibility channel for a panel document whose JavaScript predates status-event
   * hydration: it may discover a remote run from status, then continue polling by run ID.
   */
  async readEvent(projectPath: string, runId: string, since: number): Promise<{ seq: number; runId: string; event: unknown } | null> {
    const run = await this.readRun(projectPath);
    if (!run || run.runId !== runId || !run.event) return null;
    const seq = typeof run.seq === "number" && Number.isFinite(run.seq) ? run.seq : 1;
    return seq > since ? { seq, runId, event: run.event } : null;
  }

  async requestResolution(projectPath: string, resolution: SharedPromptResolution): Promise<void> {
    await writeJson(this.resolutionPath(projectPath), resolution);
  }

  async takeResolution(projectPath: string, runId: string, promptId: string): Promise<AppFlowPromptResolution | null> {
    const path = this.resolutionPath(projectPath);
    const value = await readJson(path);
    if (!value || value.runId !== runId || value.promptId !== promptId ||
      (value.resolution !== "continue" && value.resolution !== "stop" && value.resolution !== "override")) return null;
    await unlink(path).catch(() => undefined);
    return value.resolution;
  }
}
