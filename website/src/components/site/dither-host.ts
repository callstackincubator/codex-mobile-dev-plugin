import type { DitherOptions } from './dither';
import DitherWorker from './dither.worker?worker';

type Colours = { rgb: number[]; bg: number[] };
type HostedCanvas = {
  id: number;
  channel: Worker;
  resize: ResizeObserver;
  intersection: IntersectionObserver;
  inViewport: boolean;
};

const hosted = new Map<HTMLCanvasElement, HostedCanvas>();
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let worker: Worker | undefined;
let next = 0;
let watching = false;

function rgbValue(style: CSSStyleDeclaration, name: string): number[] {
  const value = style.getPropertyValue(name);
  const trimmed = value.trim();
  const parts = trimmed.split(/\s+/);
  return parts.map(Number);
}

function colours(): Colours {
  const style = getComputedStyle(document.documentElement);
  const rgb = rgbValue(style, '--scene-ink');
  const bg = rgbValue(style, '--scene-bg');
  return { rgb, bg };
}

function syncVisibility(run: HostedCanvas) {
  const on = run.inViewport && document.visibilityState === 'visible';
  run.channel.postMessage({ type: 'visible', id: run.id, on });
}

function visibilityChanged() {
  for (const run of hosted.values()) syncVisibility(run);
}

function motionChanged() {
  for (const run of hosted.values()) {
    run.channel.postMessage({ type: 'motion', id: run.id, still: motion.matches });
  }
}

function watch() {
  if (watching) return;
  watching = true;
  motion.addEventListener('change', motionChanged);
  document.addEventListener('visibilitychange', visibilityChanged);
}

export function host(canvas: HTMLCanvasElement) {
  if (hosted.has(canvas)) return;
  if (worker === undefined) {
    worker = new DitherWorker();
  }
  const channel = worker;
  const id = next++;
  const focus = Number(canvas.dataset.focus ?? 0.72);
  const cell = Number(canvas.dataset.cell ?? 2);
  const mark = canvas.dataset.mark ? canvas.dataset.mark.split('/') : [];
  const palette = colours();
  const options: DitherOptions = {
    scene: canvas.dataset.scene ?? 'workspace',
    focus,
    cell,
    ...palette,
    still: motion.matches,
    mark,
  };
  const offscreen = canvas.transferControlToOffscreen();
  channel.postMessage({ type: 'init', id, canvas: offscreen, ...options }, [offscreen]);

  const resize = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      channel.postMessage({ type: 'size', id, width, height });
    }
  });
  const intersection = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      run.inViewport = entry.isIntersecting;
      syncVisibility(run);
    }
  });
  const run: HostedCanvas = { id, channel, resize, intersection, inViewport: false };
  hosted.set(canvas, run);
  resize.observe(canvas);
  intersection.observe(canvas);
  watch();
}

export function disposeAll() {
  motion.removeEventListener('change', motionChanged);
  document.removeEventListener('visibilitychange', visibilityChanged);
  watching = false;
  for (const run of hosted.values()) {
    run.resize.disconnect();
    run.intersection.disconnect();
    run.channel.postMessage({ type: 'dispose', id: run.id });
  }
  hosted.clear();
  worker?.terminate();
  worker = undefined;
}
