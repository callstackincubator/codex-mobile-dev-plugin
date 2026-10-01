import { randomBytes } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isAnonymousUserId } from "../shared/telemetry-identity.ts";
import type { TelemetryIdentity } from "../shared/telemetry-identity.ts";

const home = homedir();
export const TELEMETRY_IDENTITY_DIRECTORY = join(home, "Library/Application Support/mobile-dev/telemetry");
let identity: TelemetryIdentity | undefined;

function generatedId(prefix: string): string {
  const bytes = randomBytes(16);
  const hex = bytes.toString("hex");
  return `${prefix}_${hex}`;
}

function readUserId(path: string): string {
  const contents = readFileSync(path, "utf8");
  const id = contents.trim();
  if (isAnonymousUserId(id)) return id;
  throw new Error("The stored Sentry anonymous user ID is invalid.");
}

export function loadTelemetryIdentity(directory = TELEMETRY_IDENTITY_DIRECTORY): TelemetryIdentity {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "anonymous-user-id");
  const sessionId = generatedId("run");
  try { return { userId: readUserId(path), sessionId }; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      const userId = generatedId("anon");
      const temporary = join(directory, `${sessionId}.tmp`);
      writeFileSync(temporary, `${userId}\n`, { flag: "wx", mode: 0o600 });
      try {
        // Publish complete contents atomically when several MCP processes start together.
        linkSync(temporary, path);
      } catch (publishError) {
        const publishedElsewhere = publishError instanceof Error && "code" in publishError && publishError.code === "EEXIST";
        if (publishedElsewhere === false) throw publishError;
      } finally { unlinkSync(temporary); }
      return { userId: readUserId(path), sessionId };
    }
    throw error;
  }
}

export function getTelemetryIdentity(): TelemetryIdentity | undefined {
  if (process.env.MOBILE_DEV_TELEMETRY === "off") return;
  if (identity === undefined) identity = loadTelemetryIdentity();
  return identity;
}
