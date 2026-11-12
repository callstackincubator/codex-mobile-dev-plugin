import type { HostBridge } from "./host-bridge.ts";

// Standard hosts get a self-contained user message; Codex can also route it to the active composer.
export function chatMessage(app: Pick<HostBridge, "getHostCapabilities">, text: string): Parameters<HostBridge["sendMessage"]>[0] {
  const routed = app.getHostCapabilities()?.experimental?.["openai/message"] != null;
  if (!routed) {
    const invisible = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u200b\u2060\ufeff]/;
    if (!text.replace(/[\p{Default_Ignorable_Code_Point}\p{Control}]/gu, "").trim()) throw new Error("Add some text before sending this request to chat.");
    if (text.length > 8000) throw new Error("This request exceeds the host's 8,000-character message limit. Select fewer items or copy the text into chat.");
    // Never rewrite an exact path, note or JSON argument to fit the host's rules.
    if (invisible.test(text) || /\n{4,}|[ \t]{65,}/.test(text.replace(/\r\n?/g, "\n"))) {
      throw new Error("This request contains characters or whitespace the host cannot accept. Copy it into chat to preserve the exact text.");
    }
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

export function composerUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:no (?:active |available )?composer|composer.*(?:unavailable|not available|not active)|requires? an (?:active|available) composer|MCP app messages are disabled for this view)/i.test(message);
}

/** A rejected host request can still have reached the conversation. */
export class ChatDeliveryUnconfirmed extends Error {
  readonly timedOut: boolean;

  constructor(error: unknown) {
    super("The host did not confirm delivery. Check the chat before retrying to avoid sending the request twice.");
    this.name = "ChatDeliveryUnconfirmed";
    this.timedOut = typeof error === "object" && error !== null && "code" in error && error.code === -32001;
  }
}

export async function sendChatMessage(app: Pick<HostBridge, "getHostCapabilities" | "sendMessage">, text: string) {
  const message = chatMessage(app, text);
  try { return await app.sendMessage(message, { timeout: 5000, maxTotalTimeout: 5000 }); }
  catch (error) {
    // Only the routed composer explicitly reports that no delivery took place.
    if (retriesComposer(app) && composerUnavailable(error)) throw error;
    throw new ChatDeliveryUnconfirmed(error);
  }
}
