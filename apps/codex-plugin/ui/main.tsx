import { startMcpApp } from "@mobile-dev/mcp-app/app.tsx";
import { codexUpdateBanner } from "./codex-update-banner.tsx";

// Codex's panel: the shared MCP Apps panel plus the update banner for Codex plugin installs.
startMcpApp({ workspace: { extension: codexUpdateBanner } });
