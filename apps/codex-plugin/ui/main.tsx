import { startMcpApp } from "@mobile-dev/mcp-app/app.tsx";
import { codexUpdateBanner } from "./codex-update-banner.tsx";

// Codex's panel: the shared MCP Apps panel plus the update banner for Codex plugin
// installs. Codex has its own fullscreen and sidebar controls, so the panel adds none.
startMcpApp({ workspace: { extension: codexUpdateBanner, displayModeControl: false } });
