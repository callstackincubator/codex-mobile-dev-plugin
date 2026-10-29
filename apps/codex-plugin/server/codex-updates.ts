import type { ServerFeature } from "@mobile-dev/core/server-feature.ts";
import { PluginUpdates, registerPluginUpdateTools } from "./plugin-updates.ts";

/** Checks store releases and finishes migration from GitHub installations through the panel banner. */
export const codexUpdates: ServerFeature = {
  register(server) {
    const updates = new PluginUpdates();
    registerPluginUpdateTools(server, updates);
    return () => updates.close();
  },
};
