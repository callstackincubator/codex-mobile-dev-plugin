import { readFileSync } from "node:fs";
import { validateTelemetryEnvironment } from "../shared/telemetry.ts";
import type { TelemetryEnvironment } from "../shared/telemetry.ts";

const configUrl = new URL("./telemetry-environment.json", import.meta.url);
const configText = readFileSync(configUrl, "utf8");
const config = JSON.parse(configText);
const buildEnvironment = validateTelemetryEnvironment(config?.environment);

export function resolveTelemetryEnvironment(): TelemetryEnvironment {
  const override = process.env.MOBILE_DEV_ENVIRONMENT;
  if (override !== undefined) return validateTelemetryEnvironment(override);
  return buildEnvironment;
}

export const TELEMETRY_ENVIRONMENT = resolveTelemetryEnvironment();
