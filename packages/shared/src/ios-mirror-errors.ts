import { ExpectedOperationError } from "./error-reporting.ts";

export class IosMirrorInputBusyError extends ExpectedOperationError {
  constructor() { super("invalid_input", "Another panel is currently touching this iPhone."); }
}
