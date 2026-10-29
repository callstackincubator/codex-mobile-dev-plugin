import type { ServerFeature } from "@mobile-dev/core/server-feature.ts";
import { registerPluginUpdateTools } from "./plugin-update-tools.ts";
import { PluginUpdates } from "./plugin-updates.ts";

/** Checks store releases and finishes migration from GitHub installations through the panel banner. */
export const codexUpdates: ServerFeature = server => {
  const updates = new PluginUpdates();
  registerPluginUpdateTools(server, updates);
  return () => updates.close();
};
