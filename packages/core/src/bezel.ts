import type { Baguette, SimulatorDefinition } from "./baguette.ts";
import { compositeBezelGeometry } from "@mobile-dev/shared/bezel.ts";
import type { Bezel } from "@mobile-dev/shared/bezel.ts";
import { isPng } from "./png.ts";

async function png(baguette: Baguette, udid: string, path: string): Promise<string> {
  const url = new URL(path, baguette.baseUrl);
  if (url.origin !== baguette.baseUrl.origin || !url.pathname.startsWith(`/simulators/${udid}/`)) throw new Error("Invalid bezel image path");
  const bytes = await baguette.fetchBytes(`${url.pathname}${url.search}`, { maxBytes: 8 * 1024 * 1024, timeout: 5000, tooLarge: "Bezel image too large" });
  if (!isPng(bytes)) throw new Error("Invalid bezel PNG");
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

export async function readBezel(baguette: Baguette, udid: string, screen: SimulatorDefinition["screen"]): Promise<Bezel | undefined> {
  const geometry = compositeBezelGeometry(screen);
  const rest = screen.bezelImage?.rest;
  if (!geometry || !rest) return;
  try {
    // The mask is optional; the frame is not.
    const [image, mask] = await Promise.all([
      png(baguette, udid, rest),
      screen.maskImage ? png(baguette, udid, screen.maskImage).catch(() => undefined) : undefined,
    ]);
    return { ...geometry, image, ...(mask ? { mask } : {}) };
  } catch { return; }
}
