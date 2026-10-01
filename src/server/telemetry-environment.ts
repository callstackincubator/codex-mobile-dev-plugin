import { existsSync, readFileSync, statSync } from "node:fs";
import type { TelemetryEnvironment } from "../shared/telemetry.ts";

function resolveEnvironment(): TelemetryEnvironment {
  const override = process.env.MOBILE_DEV_ENVIRONMENT;
  if (override !== undefined && override !== "development" && override !== "release") {
    throw new Error("MOBILE_DEV_ENVIRONMENT must be development or release.");
  }
  if (override !== undefined) return override;
  const configUrl = new URL("../ui-dev.json", import.meta.url);
  if (existsSync(configUrl)) {
    const configText = readFileSync(configUrl, "utf8");
    const config = JSON.parse(configText);
    if (config.mode === "mcp-live" && typeof config.projectRoot === "string") {
      const heartbeatPath = `${config.projectRoot}/.local-dev/ui-watch.json`;
      if (existsSync(heartbeatPath)) {
        const heartbeat = statSync(heartbeatPath);
        if (Date.now() - heartbeat.mtimeMs < 10_000) return "development";
      }
    }
  }
  return "release";
}

export const TELEMETRY_ENVIRONMENT = resolveEnvironment();
