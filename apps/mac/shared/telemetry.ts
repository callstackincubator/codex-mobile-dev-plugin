import type { TelemetryEnvironment } from "@mobile-dev/shared/telemetry.ts";

/** The resource the Mac page reads over its own MCP connection before its telemetry starts. */
export const MAC_TELEMETRY_URI = "ui://mobile-dev/mac-telemetry.json";

/** The server-owned telemetry metadata the MCP Apps panel receives in its HTML's meta tags. */
export type MacTelemetryMetadata = {
  environment: TelemetryEnvironment;
  telemetry: "on" | "off";
  userId?: string;
  sessionId?: string;
};
