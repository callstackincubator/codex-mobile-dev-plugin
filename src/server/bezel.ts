import type { Baguette } from "./baguette.ts";
import { compositeBezelGeometry } from "../shared/bezel.ts";
import type { Bezel } from "../shared/bezel.ts";

async function png(baguette: Baguette, udid: string, path: string): Promise<string> {
  const url = new URL(path, baguette.baseUrl);
  if (url.origin !== baguette.baseUrl.origin || !url.pathname.startsWith(`/simulators/${udid}/`)) throw new Error("Invalid bezel image path");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok || !response.body) throw new Error("Bezel image unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8 * 1024 * 1024) throw new Error("Bezel image too large");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = Buffer.concat(chunks);
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Invalid bezel PNG");
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

export async function readBezel(baguette: Baguette, udid: string, screen: unknown): Promise<Bezel | undefined> {
  const geometry = compositeBezelGeometry(screen);
  const assets = screen as { bezelImage?: { rest?: string }; maskImage?: string };
  if (!geometry || !assets?.bezelImage?.rest) return;
  try {
    const image = await png(baguette, udid, assets.bezelImage.rest);
    const mask = assets.maskImage ? await png(baguette, udid, assets.maskImage).catch(() => undefined) : undefined;
    return { ...geometry, image, ...(mask ? { mask } : {}) };
  } catch { return; }
}
