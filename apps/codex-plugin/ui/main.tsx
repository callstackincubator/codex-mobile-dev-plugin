import { startMcpApp } from "@mobile-dev/mcp-app/app.tsx";
import { codexWorkspace } from "./codex-workspace.tsx";

startMcpApp({ workspace: { extension: codexWorkspace, displayModeControl: false } });
