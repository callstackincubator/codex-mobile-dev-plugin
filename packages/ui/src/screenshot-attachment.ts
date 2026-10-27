import { getUiTelemetryAttributes, recordUiTiming } from "./telemetry.ts";

// Large base64 images overflow Codex's data-URL validator. Bound each chat image.
export const SCREENSHOT_ATTACHMENT_MAX_BYTES = 1024 * 1024;
export type EncodedScreenshotAttachment = { data: string; mimeType: "image/jpeg" };

export async function encodeScreenshotAttachment(png: string): Promise<EncodedScreenshotAttachment> {
  const started = performance.now();
  const telemetryContext = getUiTelemetryAttributes();
  let bitmap: ImageBitmap | undefined;
  let canvas: OffscreenCanvas | undefined;
  try {
    const binary = atob(png);
    const source = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) source[index] = binary.charCodeAt(index);
    const image = new Blob([source], { type: "image/png" });
    bitmap = await createImageBitmap(image);
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Screenshot encoding is unavailable.");
    let quality = 0.9;
    let jpeg: Blob;
    for (;;) {
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality });
      if (jpeg.type !== "image/jpeg" || jpeg.size === 0) throw new Error("Screenshot JPEG encoding failed.");
      if (jpeg.size <= SCREENSHOT_ATTACHMENT_MAX_BYTES) break;
      if (quality === 0.9) {
        quality = 0.75;
        continue;
      }
      if (canvas.width === 1 && canvas.height === 1) throw new Error("Screenshot exceeds the chat image budget.");
      const sizeRatio = SCREENSHOT_ATTACHMENT_MAX_BYTES / jpeg.size;
      const estimatedScale = Math.sqrt(sizeRatio) * 0.9;
      const scale = Math.min(0.8, estimatedScale);
      const width = Math.floor(canvas.width * scale);
      const height = Math.floor(canvas.height * scale);
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
    }
    const buffer = await jpeg.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let encoded = "";
    for (let offset = 0; offset < bytes.length; offset += 16_384) {
      const chunk = bytes.subarray(offset, offset + 16_384);
      encoded += String.fromCharCode(...chunk);
    }
    const data = btoa(encoded);
    return { data, mimeType: "image/jpeg" };
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    const elapsed = performance.now() - started;
    const currentContext = getUiTelemetryAttributes();
    if (currentContext === telemetryContext) recordUiTiming("ui.screenshot.encode", elapsed);
  }
}
