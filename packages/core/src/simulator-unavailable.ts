import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { MissingRuntimeError } from "./install-integrity.ts";

export class SimulatorUnavailableError extends ExpectedOperationError {
  constructor(message: string) {
    super("device_unavailable", message);
  }
}

/** Whether the panel should retry after this failure. An unavailable device or a missing runtime stays that way until the user acts. */
export function retryableFailure(error: unknown): boolean {
  return error instanceof SimulatorUnavailableError === false && error instanceof MissingRuntimeError === false;
}
