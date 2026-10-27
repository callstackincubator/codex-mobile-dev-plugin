import { z } from "zod";

export const bezelGeometrySchema = z.object({
  rect: z.object({ x: z.number().nonnegative(), y: z.number().nonnegative(), width: z.number().positive(), height: z.number().positive() }),
  viewport: z.object({ width: z.number().positive(), height: z.number().positive() }),
  clipRadius: z.number().nonnegative().default(0),
}).refine(({ rect, viewport }) => rect.x + rect.width <= viewport.width && rect.y + rect.height <= viewport.height, "Screen must fit within the bezel");
export type Bezel = z.infer<typeof bezelGeometrySchema> & { image: string; mask?: string };

export const buttonMarginsSchema = z.object({
  top: z.number().nonnegative().default(0),
  right: z.number().nonnegative().default(0),
  bottom: z.number().nonnegative().default(0),
  left: z.number().nonnegative().default(0),
});

// Baguette's screen bounds use the bare body; the full PNG includes buttons.
export function compositeBezelGeometry(screen: unknown) {
  const geometry = bezelGeometrySchema.safeParse(screen);
  const margins = buttonMarginsSchema.safeParse((screen as { buttonMargins?: unknown } | null)?.buttonMargins ?? {});
  if (!geometry.success || !margins.success) return;
  const { rect, viewport, clipRadius } = geometry.data;
  const { top, right, bottom, left } = margins.data;
  return {
    rect: { ...rect, x: rect.x + left, y: rect.y + top },
    viewport: { width: viewport.width + left + right, height: viewport.height + top + bottom },
    clipRadius,
  };
}
