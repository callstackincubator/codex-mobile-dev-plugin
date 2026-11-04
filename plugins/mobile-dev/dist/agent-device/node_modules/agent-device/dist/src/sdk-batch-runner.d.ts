import { a as DaemonRequest, o as DaemonResponse, v as SessionRuntimeHints } from "./sdk-contracts.js";
//#region packages/contracts/src/batch-step.d.ts
/**
 * One step of a daemon batch, as submitted.
 *
 * Declared here rather than in `@agent-device/command-registry/batch` because the public API
 * vocabulary (`contracts/client-replay.ts`) is stated in terms of it, and contracts sits below
 * command-registry.
 *
 * The `runtime` field used to be written as `DaemonRequest['runtime']`, which pulled the whole daemon
 * request type in to say `SessionRuntimeHints` — the same type, one zone lower.
 */
type DaemonBatchStep = {
  command: string;
  positionals?: string[];
  input?: Record<string, unknown>;
  flags?: Record<string, unknown>;
  runtime?: SessionRuntimeHints;
};
//#endregion
//#region packages/command-registry/src/batch.d.ts
type BatchFlags = Record<string, unknown> & {
  batchOnError?: 'stop';
  batchMaxSteps?: number;
  batchSteps?: DaemonBatchStep[];
};
type BatchRequest = Omit<DaemonRequest, 'flags'> & {
  flags?: BatchFlags | Record<string, unknown>;
};
/**
 * What the batch runner knows about a step's place in its plan. The daemon uses the remaining
 * commands to derive platform readiness policy; it never reaches the wire.
 */
type BatchStepContext = Readonly<{
  stepNumber: number;
  totalSteps: number;
  /** The steps still ahead, in the shape their handlers will read. */
  remainingSteps: readonly Readonly<{
    command: string;
    positionals: readonly string[];
    flags: Readonly<Record<string, unknown>>;
    input?: Readonly<Record<string, unknown>>;
  }>[];
}>;
type BatchInvoke = (req: BatchRequest, context: BatchStepContext) => Promise<DaemonResponse>;
type BatchStepResult = {
  step: number;
  command: string;
  ok: true;
  data: Record<string, unknown>;
  durationMs: number;
};
type BatchRunResult = Record<string, unknown> & {
  total: number;
  executed: number;
  totalDurationMs: number;
  results: BatchStepResult[];
};
type BatchRunResponse = {
  ok: true;
  data: BatchRunResult;
} | Extract<DaemonResponse, {
  ok: false;
}>;
declare function runBatch(req: BatchRequest, sessionName: string, invoke: BatchInvoke): Promise<BatchRunResponse>;
//#endregion
export { runBatch as n, BatchRunResult as t };