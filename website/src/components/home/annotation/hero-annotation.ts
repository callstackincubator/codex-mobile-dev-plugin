// Adapted from Stageshow's MIT-licensed md-annotate choreography; see README.md.
const duration = 12_000;

type Box = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

function initialize(root: HTMLElement) {
  const scene = root.querySelector<HTMLElement>('.hero-scene')!;
  const button = root.querySelector<HTMLButtonElement>('.hero-playback')!;
  const cursor = root.querySelector<SVGElement>('.hero-cursor')!;
  const highlight = root.querySelector<HTMLElement>('.hero-highlight')!;
  const pin = root.querySelector<HTMLElement>('.hero-pin')!;
  const note = root.querySelector<HTMLElement>('.hero-note')!;
  const text = root.querySelector<HTMLElement>('.hero-note-text')!;
  const flyer = root.querySelector<HTMLElement>('.hero-flying-chip')!;
  const room = root.querySelector<HTMLElement>('.hero-context-row')!;
  const chip = root.querySelector<HTMLElement>('[data-annotation-target="context"]')!;
  const select = root.querySelector<HTMLElement>('[data-annotation-target="select"]')!;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const controller = new AbortController();
  const { signal } = controller;
  let animations: Animation[] = [];
  let visible = false;
  let userPaused = false;
  let suspended = false;

  function syncPlayback() {
    const playing = visible && document.hidden === false && motion.matches === false && userPaused === false && suspended === false;
    for (const animation of animations) {
      if (playing) animation.play();
      else animation.pause();
    }
    const label = userPaused ? 'Play animation' : 'Pause animation';
    button.setAttribute('aria-label', label);
    const pressed = String(userPaused);
    button.setAttribute('aria-pressed', pressed);
    button.hidden = motion.matches;
  }

  function box(target: string, origin: DOMRect): Box {
    const element = root.querySelector<HTMLElement>(`[data-annotation-target="${target}"]`)!;
    const bounds = element.getBoundingClientRect();
    return { x: bounds.left - origin.left, y: bounds.top - origin.top, width: bounds.width, height: bounds.height };
  }

  function center(bounds: Box): Point {
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }

  function transform(point: Point, scale = 1) {
    return `translate(${point.x}px, ${point.y}px) scale(${scale})`;
  }

  function animate(element: Element, frames: Keyframe[]) {
    const animation = element.animate(frames, { duration, iterations: Infinity, fill: 'both' });
    animation.pause();
    animations.push(animation);
  }

  function visibility(element: Element, from: number, to: number) {
    animate(element, [
      { opacity: 0, offset: 0 },
      { opacity: 0, offset: from / duration },
      { opacity: 1, offset: (from + 120) / duration },
      { opacity: 1, offset: to / duration },
      { opacity: 0, offset: (to + 120) / duration },
      { opacity: 0, offset: 1 },
    ]);
  }

  function layout() {
    const previousTime = animations[0]?.currentTime;
    const time = typeof previousTime === 'number' ? previousTime : 0;
    for (const animation of animations) animation.cancel();
    animations = [];

    const origin = scene.getBoundingClientRect();
    const panel = box('panel', origin);
    const card = box('card', origin);
    const carrot = box('carrot', origin);
    const pointer = box('select', origin);
    const context = box('context', origin);
    const pointerPoint = center(pointer);
    const carrotPoint = center(carrot);
    const cardTop = Math.max(card.y, panel.y);
    const cardBottom = Math.min(card.y + card.height, panel.y + panel.height);
    const cardPoint = { x: card.x + card.width * .7, y: cardTop + (cardBottom - cardTop) * .42 };
    const rest = { x: panel.x + panel.width - 34, y: panel.y + 100 };
    const fieldWidth = Math.min(160, panel.width - 16);
    const fieldX = Math.min(carrot.x + carrot.width + 4, panel.x + panel.width - fieldWidth - 8);
    const fieldY = carrotPoint.y - 16;
    note.style.left = `${fieldX}px`;
    note.style.top = `${fieldY}px`;
    note.style.width = `${fieldWidth}px`;
    const send = box('send', origin);
    const sendPoint = center(send);

    const cursorSteps: [number, Point, number?][] = [
      [0, rest], [150, rest], [500, pointerPoint], [560, pointerPoint, .85], [650, pointerPoint],
      [1100, cardPoint], [2000, cardPoint], [2600, carrotPoint], [3050, carrotPoint],
      [3110, carrotPoint, .85], [3200, carrotPoint], [5100, carrotPoint],
      [5500, sendPoint], [5560, sendPoint, .85], [5650, sendPoint],
      [7100, sendPoint], [7500, rest], [9500, rest], [10_000, pointerPoint],
      [10_060, pointerPoint, .85], [10_150, pointerPoint], [10_700, rest], [duration, rest],
    ];
    const cursorFrames = cursorSteps.map(([at, point, scale]) => {
      const position = transform(point, scale);
      return { transform: position, offset: at / duration, easing: 'cubic-bezier(.4,0,.2,1)' };
    });
    animate(cursor, cursorFrames);
    visibility(cursor, 0, 11_800);

    const cardPosition = transform({ x: card.x, y: cardTop });
    const carrotPosition = transform(carrot);
    animate(highlight, [
      { transform: cardPosition, width: `${card.width}px`, height: `${cardBottom - cardTop}px`, offset: 0 },
      { transform: cardPosition, width: `${card.width}px`, height: `${cardBottom - cardTop}px`, offset: 2000 / duration, easing: 'cubic-bezier(.2,.8,.2,1)' },
      { transform: carrotPosition, width: `${carrot.width}px`, height: `${carrot.height}px`, offset: 2600 / duration },
      { transform: carrotPosition, width: `${carrot.width}px`, height: `${carrot.height}px`, offset: 1 },
    ]);
    visibility(highlight, 1050, 5650);
    visibility(note, 3170, 5650);
    visibility(pin, 5650, 10_150);
    visibility(chip, 6700, 10_150);
    visibility(flyer, 5850, 6850);

    animate(select, [
      { color: '#a3a3a3', backgroundColor: 'transparent', offset: 0 },
      { color: '#a3a3a3', backgroundColor: 'transparent', offset: 650 / duration },
      { color: '#6f9dff', backgroundColor: 'rgb(111 157 255 / .15)', offset: 800 / duration },
      { color: '#6f9dff', backgroundColor: 'rgb(111 157 255 / .15)', offset: 10_150 / duration },
      { color: '#a3a3a3', backgroundColor: 'transparent', offset: 10_300 / duration },
      { color: '#a3a3a3', backgroundColor: 'transparent', offset: 1 },
    ]);
    animate(text, [
      { clipPath: 'inset(0 100% 0 0)', offset: 0 },
      { clipPath: 'inset(0 100% 0 0)', offset: 3650 / duration, easing: 'steps(18, end)' },
      { clipPath: 'inset(0 0% 0 0)', offset: 4750 / duration },
      { clipPath: 'inset(0 0% 0 0)', offset: 1 },
    ]);
    animate(room, [
      { height: '0px', offset: 0 },
      { height: '0px', offset: 5900 / duration, easing: 'cubic-bezier(.2,.8,.2,1)' },
      { height: '32px', offset: 6300 / duration },
      { height: '32px', offset: 10_300 / duration, easing: 'cubic-bezier(.4,0,.2,1)' },
      { height: '0px', offset: 10_650 / duration },
      { height: '0px', offset: 1 },
    ]);
    const takeoff = transform({ x: fieldX + 6, y: fieldY + 4 }, .94);
    const landing = transform(context);
    animate(flyer, [
      { transform: takeoff, offset: 0 },
      { transform: takeoff, offset: 5900 / duration, easing: 'cubic-bezier(.4,0,.2,1)' },
      { transform: landing, offset: 6660 / duration },
      { transform: landing, offset: 1 },
    ]);

    const position = motion.matches ? 8800 : time;
    for (const animation of animations) animation.currentTime = position;
    syncPlayback();
  }

  button.addEventListener('click', () => {
    userPaused = userPaused === false;
    syncPlayback();
  }, { signal });
  motion.addEventListener('change', () => {
    for (const animation of animations) animation.currentTime = motion.matches ? 8800 : 0;
    syncPlayback();
  }, { signal });
  document.addEventListener('visibilitychange', syncPlayback, { signal });

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && entry.intersectionRatio >= .25;
    syncPlayback();
  }, { threshold: .25 });
  const resize = new ResizeObserver(layout);
  observer.observe(scene);
  resize.observe(scene);

  function cleanup() {
    observer.disconnect();
    resize.disconnect();
    for (const animation of animations) animation.cancel();
    controller.abort();
  }

  window.addEventListener('pagehide', event => {
    suspended = true;
    syncPlayback();
    if (event.persisted === false) cleanup();
  }, { signal });
  window.addEventListener('pageshow', () => {
    suspended = false;
    syncPlayback();
  }, { signal });
  document.addEventListener('astro:before-swap', cleanup, { signal });
}

const previews = document.querySelectorAll<HTMLElement>('[data-annotation-demo]');
for (const preview of previews) initialize(preview);
