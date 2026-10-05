import type { z } from "zod";
import { ExpectedOperationError } from "../shared/error-reporting.ts";

class InvalidResourceInputError extends ExpectedOperationError {
  readonly code = -32602;

  constructor(message: string) {
    super("invalid_input", message);
  }
}

export function parseResourceInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new InvalidResourceInputError(parsed.error.message);
}
