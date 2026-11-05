import { parentPort, workerData } from "node:worker_threads";
import type { AppIntelSnapshot } from "@mobile-dev/shared/app-intelligence.ts";
import { analyzeApp } from "./analyzer.ts";

type WorkerInput = { projectPath: string };
type WorkerOutput =
  | { type: "progress"; message: string }
  | { type: "result"; snapshot: AppIntelSnapshot }
  | { type: "error"; name: string; message: string };

if (!parentPort) throw new Error("App Intelligence worker requires a parent port.");

const port = parentPort;
const { projectPath } = workerData as WorkerInput;

try {
  const snapshot = await analyzeApp(projectPath, {
    onProgress: message => port.postMessage({ type: "progress", message } satisfies WorkerOutput),
  });
  port.postMessage({ type: "result", snapshot } satisfies WorkerOutput);
} catch (error) {
  port.postMessage({
    type: "error",
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  } satisfies WorkerOutput);
}
