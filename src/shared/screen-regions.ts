import type { ScreenBounds, ScreenComponent } from "./screen-annotations.ts";

// Screens can omit their views from accessibility. These bounds come from pixels,
// so they must remain screen regions rather than claim native component names.
export function screenRegions(data: Uint8ClampedArray, width: number, height: number, screen: { width: number; height: number }): ScreenComponent[] {
  if (width < 1 || height < 1 || screen.width <= 0 || screen.height <= 0 || data.length !== width * height * 4) return [];
  const colors = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const color = (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4);
    colors.set(color, (colors.get(color) ?? 0) + 1);
  }
  const background = [...colors].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (background === undefined) return [];
  const rgb = [(background >> 8) * 16 + 8, ((background >> 4) & 15) * 16 + 8, (background & 15) * 16 + 8];
  const mask = new Uint8Array(width * height);
  const padX = Math.max(1, Math.round(width / screen.width * 2));
  const padY = Math.max(1, Math.round(height / screen.height));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 128 || Math.abs(data[i] - rgb[0]) + Math.abs(data[i + 1] - rgb[1]) + Math.abs(data[i + 2] - rgb[2]) < 70) continue;
    // Join glyph strokes without joining adjacent rows or nearby controls.
    for (let row = Math.max(0, y - padY); row <= Math.min(height - 1, y + padY); row++)
      mask.fill(1, row * width + Math.max(0, x - padX), row * width + Math.min(width, x + padX + 1));
  }
  const queue = new Int32Array(width * height);
  const boxes: ScreenBounds[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start]) continue;
    let head = 0, tail = 1, minX = width, minY = height, maxX = 0, maxY = 0;
    queue[0] = start; mask[start] = 0;
    const add = (index: number) => { if (mask[index]) { mask[index] = 0; queue[tail++] = index; } };
    while (head < tail) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (x > 0) add(index - 1); if (x < width - 1) add(index + 1);
      if (y > 0) add(index - width); if (y < height - 1) add(index + width);
    }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    if (tail < 12 || w < 4 || h < 4 || (w > width * .9 && h > height * .75)) continue;
    boxes.push({ x: Math.max(0, minX + padX), y: Math.max(0, minY + padY), width: Math.max(1, w - padX * 2), height: Math.max(1, h - padY * 2) });
  }
  // Join words on the same line. Keep large filled regions separate.
  const lines: ScreenBounds[] = [];
  for (const box of boxes.sort((a, b) => a.x - b.x)) {
    const line = box.height < height / screen.height * 28 && lines.find(other =>
      other.height < height / screen.height * 28 && Math.min(other.y + other.height, box.y + box.height) - Math.max(other.y, box.y) > Math.min(other.height, box.height) * .6
      && box.x >= other.x && box.x - (other.x + other.width) < width / screen.width * 12);
    if (line) {
      const right = Math.max(line.x + line.width, box.x + box.width), bottom = Math.max(line.y + line.height, box.y + box.height);
      line.y = Math.min(line.y, box.y); line.width = right - line.x; line.height = bottom - line.y;
    } else lines.push({ ...box });
  }
  return lines.slice(0, 500).map((box, index) => ({
    name: "Screen region", source: "screen", role: "screen-region", identifier: `screen-region-${index + 1}`, depth: 0,
    bounds: { x: box.x / width * screen.width, y: box.y / height * screen.height, width: box.width / width * screen.width, height: box.height / height * screen.height },
  }));
}
