import "@fontsource-variable/inter";
import "@mobile-dev/ui/theme.css";
import "@mobile-dev/ui/style.css";
import { startRecordingApp } from "./recording-app.tsx";
import { startComparisonApp } from "./comparison-app.tsx";
import { startTraceSiftApp } from "./tracesift-app.tsx";
import { startWorkspaceApp } from "./workspace-app.tsx";
import type { WorkspaceOptions } from "./workspace-extension.ts";

/**
 * Starts the view the served page asks for. A host's page entry calls this, passing
 * any chrome it adds to the workspace.
 */
export function startMcpApp(options: { workspace?: WorkspaceOptions } = {}) {
  const view = document.documentElement.dataset.view;
  if (view === "recording") startRecordingApp();
  else if (view === "comparison") startComparisonApp();
  else if (view === "tracesift") startTraceSiftApp();
  else startWorkspaceApp(options.workspace);
}
