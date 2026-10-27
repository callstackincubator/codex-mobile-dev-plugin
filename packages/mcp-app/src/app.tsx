import "@fontsource-variable/inter";
import "@mobile-dev/ui/theme.css";
import "@mobile-dev/ui/style.css";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import { traceSiftProfileInputSchema } from "@mobile-dev/shared/tracesift.ts";
import { ComparisonController } from "@mobile-dev/ui/comparison-controller.ts";
import { ComparisonCard } from "@mobile-dev/ui/components/comparison-card.tsx";
import { DevicesCard } from "@mobile-dev/ui/components/devices-card.tsx";
import { RecordingCard } from "@mobile-dev/ui/components/recording-card.tsx";
import { TraceSiftCards } from "@mobile-dev/ui/components/tracesift-cards.tsx";
import { DevicesController } from "@mobile-dev/ui/devices-controller.ts";
import { RecordingController } from "@mobile-dev/ui/recording-controller.ts";
import { TraceSiftController } from "@mobile-dev/ui/tracesift-controller.ts";
import { startCardApp } from "./card-app.tsx";
import { startWorkspaceApp } from "./workspace-app.tsx";
import type { WorkspaceOptions } from "./workspace-extension.ts";

/**
 * Starts the view the served page asks for. A host's page entry calls this, passing
 * any chrome it adds to the workspace.
 */
export function startMcpApp(options: { workspace?: WorkspaceOptions } = {}) {
  const view = document.documentElement.dataset.view;
  if (view === "recording") startCardApp({
    name: "mobile-dev-recording", surface: "recording", fallback: "This recording could not render. Reopen it to try again.",
    create: app => {
      const extensions = new OpenAIExtensions(app);
      return new RecordingController(app, () => extensions.modelContext);
    },
    render: controller => <RecordingCard controller={controller} />,
  });
  else if (view === "comparison") startCardApp({
    name: "mobile-dev-comparison", surface: "comparison", fallback: "This comparison could not render. Reopen it to try again.",
    create: app => new ComparisonController(app),
    render: controller => <ComparisonCard controller={controller} />,
  });
  else if (view === "tracesift") startCardApp({
    name: "mobile-dev-tracesift", surface: "tracesift", fallback: "This TraceSift analysis could not render. Reopen it to try again.",
    create: app => new TraceSiftController(app),
    render: controller => <TraceSiftCards controller={controller} />,
    hostChanged: (controller, host) => {
      const viewId = host?.toolInfo?.id;
      if (typeof viewId === "string" || typeof viewId === "number") controller.setViewId(viewId);
    },
    toolInput: (controller, input) => {
      const parsed = traceSiftProfileInputSchema.safeParse(input);
      if (parsed.success) controller.setProfileInput(parsed.data.path, parsed.data.profileType);
    },
    // The inline card investigates too, so it needs the same project the panel saved.
    connected: controller => void controller.loadProject(),
  });
  else if (view === "devices") startCardApp({
    name: "mobile-dev-devices", surface: "devices", fallback: "These devices could not render. Ask again to list them.",
    create: app => new DevicesController(app),
    render: controller => <DevicesCard controller={controller} />,
  });
  else startWorkspaceApp(options.workspace);
}
