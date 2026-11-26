export interface TestingRuntimeProgress {
  phase: "idle" | "checking" | "downloading" | "installing" | "ready" | "failed";
  received: number;
  total: number;
  message?: string;
}
