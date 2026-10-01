import * as Sentry from "@sentry/node";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { TELEMETRY_META_KEY } from "../shared/telemetry.ts";
import { SimulatorUnavailableError } from "./simulator-unavailable.ts";
import { closeNativeTelemetry } from "./native-telemetry.ts";

export function captureServerError(error: unknown, operation: string) {
  if (error instanceof SimulatorUnavailableError) return;
  if (error instanceof Error && error.name === "AbortError") return;
  Sentry.captureException(error, { tags: { operation } });
}

export function installTracePropagation(transport: Transport) {
  const start = transport.start.bind(transport);
  transport.start = async () => {
    const receive = transport.onmessage;
    transport.onmessage = (message, extra) => {
      if ("method" in message && message.params?._meta) {
        const meta = message.params._meta;
        const sentryTrace = typeof meta["sentry-trace"] === "string" ? meta["sentry-trace"] : undefined;
        const baggage = typeof meta.baggage === "string" ? meta.baggage : undefined;
        Sentry.continueTrace({ sentryTrace, baggage }, () => {
          Sentry.withIsolationScope(scope => {
            const context = meta[TELEMETRY_META_KEY];
            const attributes: Record<string, string> = {};
            if (context !== null && typeof context === "object") {
              const allowed: Record<string, readonly string[]> = {
                surface: ["logs", "performance", "simulator", "recording"], view: ["panel", "workspace", "recording"], layout: ["ios", "android", "both", "none"],
                device_platform: ["ios", "android"], device_kind: ["physical", "simulator", "emulator"],
              };
              for (const [key, value] of Object.entries(context)) {
                if (typeof value === "string" && allowed[key]?.includes(value)) attributes[key] = value;
              }
            }
            scope.setAttributes(attributes);
            scope.setTags(attributes);
            receive?.(message, extra);
          });
        });
        return;
      }
      receive?.(message, extra);
    };
    await start();
  };
}

export async function closeServerTelemetry() {
  await closeNativeTelemetry();
  await Sentry.close(2000);
}
