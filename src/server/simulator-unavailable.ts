import { ExpectedOperationError } from "../shared/error-reporting.ts";

export class SimulatorUnavailableError extends ExpectedOperationError {
  constructor(message: string) {
    super("device_unavailable", message);
  }
}
