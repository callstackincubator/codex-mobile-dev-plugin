import type { App } from "@modelcontextprotocol/ext-apps";
import { telemetryHost } from "@mobile-dev/shared/telemetry.ts";
import { setUiTelemetryHost } from "@mobile-dev/ui/telemetry.ts";

/** Labels telemetry with the host once connected. Telemetry only; behavior follows capabilities. */
export function attributeHost(app: App) {
  const experimental = app.getHostCapabilities()?.experimental ?? {};
  const openAI = Object.keys(experimental).some(key => key.startsWith("openai/"));
  setUiTelemetryHost(openAI ? "codex" : telemetryHost(app.getHostVersion()?.name));
}
