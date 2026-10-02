import { _ as SessionRuntimeHints, a as DaemonRequest, o as DaemonResponse } from "./sdk-contracts.js";
//#region packages/contracts/src/batch-step.d.ts
/**
 * One step of a daemon batch, as submitted.
 *
 * Declared here rather than in `core/batch.ts` because the public API vocabulary
 * (`contracts/client-replay.ts`) is stated in terms of it, and `core/` sits above contracts. The
 * `runtime` field used to be written as `DaemonRequest['runtime']`, which pulled the whole daemon
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
//#region src/core/batch.d.ts
type BatchFlags = Record<string, unknown> & {
  batchOnError?: 'stop';
  batchMaxSteps?: number;
  batchSteps?: DaemonBatchStep[];
};
type BatchRequest = Omit<DaemonRequest, 'flags'> & {
  flags?: BatchFlags | Record<string, unknown>;
};
type BatchInvoke = (req: BatchRequest) => Promise<DaemonResponse>;
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