import type { App } from "@modelcontextprotocol/ext-apps";

// Standard hosts receive a self-contained user message. Codex can additionally
// route it to the active composer when it advertises that extension.
export function chatMessage(app: Pick<App, "getHostCapabilities">, text: string): Parameters<App["sendMessage"]>[0] {
  const routed = app.getHostCapabilities()?.experimental?.["openai/message"] != null;
  return {
    role: "user", content: [{ type: "text", text }],
    ...(routed ? { _meta: { "openai/message": { target: "active", send: true } } } : {}),
  };
}
