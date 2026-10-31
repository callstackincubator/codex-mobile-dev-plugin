import type { ServerFeature } from "@mobile-dev/core/server-feature.ts";
import { resolveTelemetryEnvironment } from "@mobile-dev/core/telemetry-environment.ts";
import { getTelemetryIdentity } from "@mobile-dev/core/telemetry-identity.ts";
import { MAC_TELEMETRY_URI, type MacTelemetryMetadata } from "../shared/telemetry.ts";

/**
 * Serves the Mac page the telemetry metadata the MCP Apps panel gets in its HTML: this
 * server's environment, opt-out and anonymous identity. The app loads the page from its
 * bundle, and the page reads this over its own MCP connection.
 */
export const macTelemetry: ServerFeature = {
  register(server) {
    server.registerResource("mobile-dev-mac-telemetry", MAC_TELEMETRY_URI, { mimeType: "application/json" }, uri => {
      const identity = getTelemetryIdentity();
      const metadata: MacTelemetryMetadata = { environment: resolveTelemetryEnvironment(), telemetry: identity ? "on" : "off", ...identity };
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(metadata) }] };
    });
  },
};
