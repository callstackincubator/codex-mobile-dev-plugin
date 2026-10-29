import "@fontsource-variable/inter";
import "@mobile-dev/ui/theme.css";
import "@mobile-dev/ui/style.css";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import { traceSiftProfileInputSchema } from "@mobile-dev/shared/tracesift.ts";
import { ComparisonController } from "@mobile-dev/ui/comparison-controller.ts";
import { ComparisonCard } from "@mobile-dev/ui/components/comparison-card.tsx";
import { RecordingCard } from "@mobile-dev/ui/components/recording-card.tsx";
import { TraceSiftCards } from "@mobile-dev/ui/components/tracesift-cards.tsx";
import { readPageView } from "@mobile-dev/ui/page-view.ts";
import { RecordingController } from "@mobile-dev/ui/recording-controller.ts";
import { TraceSiftController } from "@mobile-dev/ui/tracesift-controller.ts";
import { startCardApp, startRetiredCard } from "./card-app.tsx";
import { startWorkspaceApp } from "./workspace-app.tsx";
import type { WorkspaceOptions } from "./workspace-extension.ts";

/** Starts the view the served page asks for; a host's page entry passes the chrome it adds. */
export function startMcpApp(options: { workspace?: WorkspaceOptions } = {}) {
  const view = readPageView();
  // Servers with Mobile Dev's workspace say so on their cards, which can then open recordings there.
  const workspace = document.documentElement.dataset.workspace !== undefined;
  if (view === "recording") startCardApp({
    name: "mobile-dev-recording", surface: "recording", fallback: "This recording could not render. Reopen it to try again.",
    create: app => {
      const extensions = new OpenAIExtensions(app);
      return new RecordingController(app, { attachments: () => extensions.modelContext, workspace });
    },
    render: controller => <RecordingCard controller={controller} />,
  });
  else if (view === "comparison") startCardApp({
    name: "mobile-dev-comparison", surface: "comparison", fallback: "This comparison could not render. Reopen it to try again.",
    create: app => new ComparisonController(app, { workspace }),
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
  // Chats keep devices cards from releases before device choice moved to the host's own form.
  else if (view === "devices") startRetiredCard("This device list came from an earlier version of Mobile Dev. Ask again to choose a device.");
  // `workspace` fills the host; `panel` sits beside the chat.
  else startWorkspaceApp(options.workspace, { fullscreen: view === "workspace" });
}
