import type { HostBridge } from "./host-bridge.ts";

// Standard hosts get a self-contained user message; Codex can also route it to the active composer.
export function chatMessage(app: Pick<HostBridge, "getHostCapabilities">, text: string): Parameters<HostBridge["sendMessage"]>[0] {
  const routed = app.getHostCapabilities()?.experimental?.["openai/message"] != null;
  if (!routed) {
    // Keep joiners used by writing systems and emoji. Never cut a request mid-JSON.
    text = text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u200b\u2060\ufeff]/g, "")
      .replace(/\n{4,}/g, "\n\n\n").replace(/[ \t]{65,}/g, " ".repeat(64));
    if (!text.trim()) throw new Error("Add some text before sending this request to chat.");
    if (text.length > 8000) throw new Error("This request exceeds the host's 8,000-character message limit. Select fewer items or copy the text into chat.");
  }
  return {
    role: "user", content: [{ type: "text", text }],
    ...(routed ? { _meta: { "openai/message": { target: "active", send: true } } } : {}),
  };
}

/** Only the routed composer reports a missing draft as safe to retry. */
export function retriesComposer(app: Pick<HostBridge, "getHostCapabilities">) {
  return app.getHostCapabilities()?.experimental?.["openai/message"] != null;
}
