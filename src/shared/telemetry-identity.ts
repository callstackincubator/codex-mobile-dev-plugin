export type TelemetryIdentity = { userId: string; sessionId: string };

export function isAnonymousUserId(value: unknown): value is string {
  return typeof value === "string" && /^anon_[a-f0-9]{32}$/.test(value);
}

export function isTelemetrySessionId(value: unknown): value is string {
  return typeof value === "string" && /^run_[a-f0-9]{32}$/.test(value);
}

export function validateTelemetryIdentity(userId: unknown, sessionId: unknown): TelemetryIdentity {
  if (isAnonymousUserId(userId) && isTelemetrySessionId(sessionId)) return { userId, sessionId };
  throw new Error("Sentry identity must contain generated anonymous user and session IDs.");
}
