import type { HostBridge } from "./host-bridge.ts";

// Standard hosts get a self-contained user message; Codex can also route it to the active composer.
export function chatMessage(app: Pick<HostBridge, "getHostCapabilities">, text: string): Parameters<HostBridge["sendMessage"]>[0] {
  const routed = app.getHostCapabilities()?.experimental?.["openai/message"] != null;
  return {
    role: "user", content: [{ type: "text", text }],
    ...(routed ? { _meta: { "openai/message": { target: "active", send: true } } } : {}),
  };
}
