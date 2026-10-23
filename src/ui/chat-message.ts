import type { App } from "@modelcontextprotocol/ext-apps";

export function preparesChatMessages() {
  return typeof document !== "undefined" && document.documentElement?.dataset.host === "vscode";
}

export function canMessage(app: Pick<App, "getHostCapabilities">) {
  const capabilities = app.getHostCapabilities();
  // VS Code implements ui/message but some versions omit message.text in the
  // handshake. Limit this adapter to the explicitly configured distribution.
  return !!capabilities?.message?.text || !!(preparesChatMessages() && capabilities?.serverTools && capabilities?.serverResources);
}

export function canUpdateTextContext(app: Pick<App, "getHostCapabilities">) {
  const context = app.getHostCapabilities()?.updateModelContext;
  return !!context?.text || !!(preparesChatMessages() && context);
}

// Standard hosts receive a self-contained user message. Codex can additionally
// route it to the active composer when it advertises that extension.
export function chatMessage(app: Pick<App, "getHostCapabilities">, text: string): Parameters<App["sendMessage"]>[0] {
  const routed = !preparesChatMessages() && app.getHostCapabilities()?.experimental?.["openai/message"] != null;
  return {
    role: "user", content: [{ type: "text", text }],
    ...(routed ? { _meta: { "openai/message": { target: "active", send: true } } } : {}),
  };
}
