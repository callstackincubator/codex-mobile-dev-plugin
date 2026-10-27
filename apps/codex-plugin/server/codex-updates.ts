import type { ServerFeature } from "@mobile-dev/core/server-feature.ts";
import { PluginUpdates, registerPluginUpdateTools } from "./plugin-updates.ts";

/** Checks for and installs releases through Codex's plugin marketplace; the panel's banner calls these tools. */
export const codexUpdates: ServerFeature = server => {
  const updates = new PluginUpdates();
  registerPluginUpdateTools(server, updates);
  return () => updates.close();
};
