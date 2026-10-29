const BAYER = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5].map(value => (value + 0.5) / 16);
type Scene = { frame: (time: number) => Float32Array };
type SceneBuilder = (cols: number, rows: number, focus: number, mark: readonly string[]) => Scene;
function workspaceScene(cols: number, rows: number, focus: number, hollow = false, intensity = 1): Scene {
  const length = cols * rows;
  const base = new Float32Array(length);
  const phase = new Float32Array(length);
  const out = new Float32Array(length);
  const size = Math.min(rows, cols * 0.75);
  const left = cols * 0.05;
  const right = cols * 0.95;
  const top = rows * 0.10;
  const bottom = rows * 0.91;
  const divider = cols * 0.60;
  const phoneX = focus * cols;
  const phoneY = rows * 0.55;
  const phoneH = size * 0.63;
  const phoneW = phoneH * 0.48;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const index = y * cols + x;
      const inBox = x > left && x < right && y > top && y < bottom;
      let tone = 0;
      if (inBox) {
        tone = 0.035;
        const dx = Math.min(x - left, right - x);
        const dy = Math.min(y - top, bottom - y);
        if (dx < 1.5 || dy < 1.5) tone = 0.72;
        const title = Math.abs(y - top - size * 0.10);
        const split = Math.abs(x - divider);
        if (title < 1 || split < 1) tone = 0.35;
        if (x < divider && y > top + size * 0.18 && y < bottom - size * 0.12) {
          const row = Math.floor((y - top) / (size * 0.10));
          const line = (y - top) % (size * 0.10);
          const width = (row % 3 === 0 ? 0.34 : 0.27) * cols;
          if (x > left + size * 0.10 && x < left + width && line < 1.7) tone = 0.42;
        }
      }
      const px = Math.abs(x - phoneX);
      const py = Math.abs(y - phoneY);
      const inPhone = px < phoneW / 2 && py < phoneH / 2 && px + py < (phoneW + phoneH) / 2 - 2;
      if (inPhone) {
        const edgeX = phoneW / 2 - px;
        const edgeY = phoneH / 2 - py;
        const edge = edgeX < 1.6 || edgeY < 1.6;
        if (hollow) {
          const dash = Math.floor((x + y) / 4);
          tone = edge && dash % 2 === 0 ? 0.50 : 0;
        } else {
          tone = edge ? 0.88 : 0.10;
          const notch = py > phoneH * 0.40 && y < phoneY && px < phoneW * 0.18;
          if (notch) tone = 0;
          const item = (y - phoneY + phoneH * 0.25) % (phoneH * 0.14);
          if (px < phoneW * 0.30 && y > phoneY - phoneH * 0.25 && item < 1.5) tone = 0.56;
        }
      }
      base[index] = tone * intensity;
      phase[index] = x / cols * 0.7 + y / rows * 0.3;
    }
  }
  return { frame(time) {
    const sweep = (time * 0.075) % 1.5 - 0.2;
    for (let index = 0; index < length; index++) {
      const distance = Math.abs(phase[index]! - sweep);
      const glint = Math.max(0, 1 - distance * 12);
      const tone = base[index]!;
      out[index] = tone > 0.2 ? tone + glint * 0.12 * intensity : tone;
    }
    return out;
  } };
}
const scenes = {
  workspace: (cols,rows,focus) => workspaceScene(cols,rows,focus),
  hollow: (cols,rows,focus) => workspaceScene(cols,rows,focus,true),
  flow: (cols,rows,focus) => workspaceScene(cols,rows,focus,false,0.28),
} satisfies Record<string,SceneBuilder>;
export type SceneName = keyof typeof scenes;

/** A canvas on the page, or one handed to the dither worker (dither.worker.ts). */
type Surface = HTMLCanvasElement | OffscreenCanvas;
type Painted = { key: string; scene: Scene; image: ImageData; px: Uint32Array; palette: number[] };
const cache = new WeakMap<Surface, Painted>();

/** The background shared by the website and social images. */
export const DARK_BG = [10, 10, 10];

/**
 * Packs the three tones (the background, the ink mixed into it, the ink) as RGBA words. The
 * midtone takes 30% of the ink on the near-black background.
 */
function palette(rgb: number[], bg: number[]) {
  const pack = (cr: number, cg: number, cb: number) => {
    const red = Math.round(cr);
    const green = Math.round(cg);
    const blue = Math.round(cb);
    return (255 << 24) | (blue << 16) | (green << 8) | red;
  };
  const share = 0.3;
  const mid = bg.map((c, i) => c + (rgb[i]! - c) * share) as [number, number, number];
  const background = pack(bg[0]!, bg[1]!, bg[2]!);
  const midtone = pack(...mid);
  const foreground = pack(rgb[0]!, rgb[1]!, rgb[2]!);
  return [background, midtone, foreground];
}

/**
 * Draws frame t of a scene onto a canvas sized one pixel per cell; CSS scales it up with
 * `image-rendering: pixelated`. The scene and the pixel buffer are kept per canvas and rebuilt
 * only when its size changes. Tones are ordered-dithered between neighbouring colours.
 */
export function drawDither(
  canvas: Surface,
  name: string,
  t: number,
  rgb: number[],
  cols: number,
  rows: number,
  focus: number,
  mark: readonly string[] = [],
  bg: readonly number[] = DARK_BG,
) {
  // Only the scene table's own keys: a name like `constructor` must not reach Object.prototype.
  const build: SceneBuilder | undefined = Object.hasOwn(scenes, name)
    ? scenes[name as SceneName]
    : undefined;
  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!build || !ctx || cols < 2 || rows < 2) return;
  const key = `${name}:${cols}x${rows}:${focus}:${rgb}:${bg}`;
  let entry = cache.get(canvas);
  if (!entry || entry.key !== key) {
    canvas.width = cols;
    canvas.height = rows;
    const image = ctx.createImageData(cols, rows);
    entry = {
      key,
      scene: build(cols, rows, focus, mark),
      image,
      px: new Uint32Array(image.data.buffer),
      palette: palette(rgb, [...bg]),
    };
    cache.set(canvas, entry);
  }
  const tones = entry.scene.frame(t);
  const { px, palette: colours } = entry;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const scaled = tones[i]! * 2;
      const wholeTone = Math.floor(scaled);
      const low = Math.min(1, wholeTone);
      const step = scaled - low > BAYER[(y & 3) * 4 + (x & 3)]! ? 1 : 0;
      px[i] = colours[low + step]!;
    }
  }
  ctx.putImageData(entry.image, 0, 0);
}


export type DitherOptions = { scene: string; focus: number; cell: number; rgb: number[]; bg: number[]; still: boolean; mark: string[] };
export function animate(canvas: Surface, options: DitherOptions) {
  const start = performance.now();
  let width = 0;
  let height = 0;
  let visible = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { clearTimeout(timer); timer = undefined; };
  const draw = () => {
    const cols = Math.ceil(width / options.cell);
    const rows = Math.ceil(height / options.cell);
    const elapsed = (performance.now() - start) / 1000;
    const time = options.still ? 9 : elapsed;
    drawDither(canvas,options.scene,time,options.rgb,cols,rows,options.focus,options.mark,options.bg);
  };
  const loop = () => {
    timer = undefined;
    if (disposed || visible === false || width === 0) return;
    draw();
    if (options.still === false) timer = setTimeout(loop,1000 / 12);
  };
  return {
    setSize(w: number,h: number) { width=w; height=h; if (visible && timer === undefined) loop(); },
    setVisible(on: boolean) { visible=on; stop(); if (on) loop(); },
    setStill(still: boolean) { options.still=still; stop(); if (visible) loop(); },
    dispose() { disposed=true; visible=false; stop(); cache.delete(canvas); },
  };
}
