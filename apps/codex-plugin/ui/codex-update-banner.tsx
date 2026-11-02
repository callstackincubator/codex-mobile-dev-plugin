import type { App } from "@modelcontextprotocol/ext-apps";
import type { WorkspaceExtension } from "@mobile-dev/mcp-app/workspace-extension.ts";
import { PluginUpdateBanner } from "./plugin-update-banner.tsx";
import { PluginUpdateController } from "./plugin-updates.ts";

export function codexUpdateBanner(app: App): WorkspaceExtension {
  const controller = new PluginUpdateController(app);
  return {
    banner: <PluginUpdateBanner controller={controller} />,
    setAvailable: available => controller.setAvailable(available),
    dispose: () => controller.dispose(),
  };
}
