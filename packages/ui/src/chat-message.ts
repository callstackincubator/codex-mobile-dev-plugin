import type { HostBridge } from "./host-bridge.ts";
import { errorCategory, errorMessage, setErrorCategory } from "@mobile-dev/shared/error-reporting.ts";

/** Whether the host takes chat messages from views. Hosts without a chat, such as the Mac app, do not. */
export function canMessage(app: Pick<HostBridge, "getHostCapabilities">): boolean {
  return Boolean(app.getHostCapabilities()?.message?.text);
}

// Standard hosts get a self-contained user message; Codex can also route it to the active composer.
export function chatMessage(app: Pick<HostBridge, "getHostCapabilities">, text: string): Parameters<HostBridge["sendMessage"]>[0] {
  const routed = app.getHostCapabilities()?.experimental?.["openai/message"] != null;
  return {
    role: "user", content: [{ type: "text", text }],
    ...(routed ? { _meta: { "openai/message": { target: "active", send: true } } } : {}),
  };
}

/** The host has no composer for this view, as when a cached panel shows before its chat registers again. */
export function composerUnavailable(error: unknown) {
  return /(?:no (?:active |available )?composer|composer.*(?:unavailable|not available|not active)|requires? an (?:active|available) composer|MCP app messages are disabled for this view)/i.test(errorMessage(error));
}

/** The host did not answer in time. The request may still have landed. */
export function requestTimedOut(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === -32001;
}

/** Retries a request while the host has no composer yet. */
export async function withComposer<T>(request: () => Promise<T>): Promise<T> {
  const delays = [100, 250, 500, 1000];
  for (let attempt = 0; ; attempt++) {
    try { return await request(); }
    catch (error) {
      if (!composerUnavailable(error) || attempt >= delays.length) throw error;
      await new Promise(resolve => setTimeout(resolve, delays[attempt]));
    }
  }
}

/**
 * Why the host did not take a message. `unconfirmed`: it did not acknowledge in time, so the
 * message may have been delivered and must not be resent automatically. `no-composer`: the
 * chat's input never registered. `rejected`: the host refused it.
 */
export type ChatDeliveryFailure = "unconfirmed" | "no-composer" | "rejected";

/** A message the host did not take. Except for `rejected`, the message is the host's own error. */
export class ChatDeliveryError extends Error {
  readonly reason: ChatDeliveryFailure;
  constructor(reason: ChatDeliveryFailure, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.reason = reason;
    // Reports keep the host error's category, such as a timeout.
    if (cause !== undefined) setErrorCategory(this, errorCategory(cause));
  }
}

/** How an error from sending, or from the context writes before it, failed to reach the chat. */
export function deliveryFailure(error: unknown): ChatDeliveryFailure | undefined {
  if (error instanceof ChatDeliveryError) return error.reason;
  if (composerUnavailable(error)) return "no-composer";
  if (requestTimedOut(error)) return "unconfirmed";
}

/**
 * Sends `text` as the user's chat message, waiting for the composer, and throws
 * ChatDeliveryError when the host does not take it. `check` runs before each attempt and
 * may throw to stop sending, such as when what the message describes changed meanwhile.
 */
export async function sendChat(app: Pick<HostBridge, "getHostCapabilities" | "sendMessage">, text: string, { check }: { check?: () => void } = {}) {
  let result: Awaited<ReturnType<HostBridge["sendMessage"]>>;
  try {
    result = await withComposer(() => {
      check?.();
      return app.sendMessage(chatMessage(app, text), { timeout: 5000, maxTotalTimeout: 5000 });
    });
  } catch (error) {
    const failure = deliveryFailure(error);
    if (failure) throw new ChatDeliveryError(failure, errorMessage(error), error);
    throw error;
  }
  if (result.isError) throw new ChatDeliveryError("rejected", "The host did not accept the message.");
}
