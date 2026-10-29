import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { errorMessage } from "@mobile-dev/shared/protocol.ts";
import { captureServerError } from "./telemetry.ts";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** The largest screenshot a tool returns to the chat. */
export const MAX_SCREENSHOT_BYTES = 16 * 1024 * 1024;

export function isPng(bytes: Buffer) { return bytes.subarray(0, 8).equals(PNG_SIGNATURE); }

/** Returns `bytes` when they are a PNG of at most `maxBytes`; otherwise blames `source`. */
export function assertPng(bytes: Buffer, maxBytes: number, source: string) {
  if (bytes.length > maxBytes || isPng(bytes) === false) throw new Error(`${source} returned an invalid or oversized PNG screenshot.`);
  return bytes;
}

export type ScreenshotCopy = {
  copy: (bytes: Buffer) => Promise<void>;
  /** Names clipboard failures in server error telemetry. */
  operation: string;
  /** The image as the caller sent it, when it arrived as base64. */
  data?: string;
};

/**
 * The image for the panel to attach to the chat, with whether it also reached the clipboard.
 * A clipboard failure is reported and returned beside the image rather than failing the call.
 */
export async function screenshotResult(bytes: Buffer, details: Record<string, unknown>, { copy, operation, data = bytes.toString("base64") }: ScreenshotCopy): Promise<CallToolResult> {
  let copied = false;
  let clipboardError: string | undefined;
  try { await copy(bytes); copied = true; }
  catch (error) {
    captureServerError(error, operation);
    clipboardError = errorMessage(error);
  }
  return {
    content: [{ type: "image", mimeType: "image/png", data }],
    structuredContent: { ...details, copied, ...(clipboardError ? { clipboardError } : {}) },
  };
}
