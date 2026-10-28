import { runStdioServer } from "@mobile-dev/core/stdio-server.ts";
import { agentDeviceTools, readAgentDeviceCatalog } from "@mobile-dev/core/agent-device-tools.ts";

// Claude's server: the shared server without Mobile Dev's panel, since Claude Code shows
// devices in its own simulator views, plus agent-device's commands to control devices.
await runStdioServer({ features: [agentDeviceTools(readAgentDeviceCatalog())] });
