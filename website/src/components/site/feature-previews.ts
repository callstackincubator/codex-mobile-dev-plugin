// Native choreography adapted from Stageshow; see previews/README.md.
type Point = { x: number; y: number };
type Step = [number, Point, number?];

function initialize(root: HTMLElement) {
  const performance = root.dataset.featurePreview === 'performance';
  const duration = performance ? 15_000 : 17_000;
  const posterTime = performance ? 10_000 : 7500;
  const scene = root.querySelector<HTMLElement>('.fp-scene')!;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const controller = new AbortController();
  const { signal } = controller;
  let animations: Animation[] = [];
  let visible = false;
  let suspended = false;

  function syncPlayback() {
    const playing = visible && document.hidden === false && motion.matches === false && suspended === false;
    const time = animations[0]?.currentTime;
    const elapsed = typeof time === 'number' ? time : 0;
    const now = document.timeline.currentTime;
    for (const animation of animations) {
      if (playing && typeof now === 'number') {
        animation.play();
        animation.startTime = now - elapsed;
      } else animation.pause();
    }
  }

  function animate(element: Element, steps: [number, Keyframe][]) {
    const frames = steps.map(([at, frame]) => ({ ...frame, offset: at / duration }));
    const animation = element.animate(frames, { duration, iterations: Infinity, fill: 'both' });
    animation.pause();
    animations.push(animation);
  }

  function animateAll(selector: string, steps: [number, Keyframe][]) {
    const elements = root.querySelectorAll(selector);
    for (const element of elements) animate(element, steps);
  }

  function target(name: string, x = .5, y = .5): Point {
    const element = root.querySelector<HTMLElement>(`[data-feature-target="${name}"]`)!;
    const bounds = element.getBoundingClientRect();
    const origin = scene.getBoundingClientRect();
    return { x: bounds.left - origin.left + bounds.width * x, y: bounds.top - origin.top + bounds.height * y };
  }

  function cursor(steps: Step[]) {
    const element = root.querySelector('.fp-cursor')!;
    const frames: [number, Keyframe][] = steps.map(([at, point, scale = 1]) => [at, {
      transform: `translate(${point.x}px, ${point.y}px) scale(${scale})`,
      easing: 'cubic-bezier(.4,0,.2,1)',
    }]);
    animate(element, frames);
    animate(element, [[0, { opacity: 0 }], [200, { opacity: 1 }], [duration - 600, { opacity: 1 }], [duration - 300, { opacity: 0 }], [duration, { opacity: 0 }]]);
  }

  function layout() {
    const previousTime = animations[0]?.currentTime;
    const elapsed = typeof previousTime === 'number' ? previousTime : 0;
    for (const animation of animations) animation.cancel();
    animations = [];

    const actors = root.querySelectorAll<HTMLElement>('[data-show]');
    for (const element of actors) {
      const intervals = element.dataset.show!.split(';');
      const steps: [number, Keyframe][] = [[0, { opacity: 0 }]];
      for (const interval of intervals) {
        const values = interval.split(':');
        const from = Number(values[0]);
        const end = Number(values[1]);
        const to = performance ? Math.min(end, 14_400) : end;
        steps.push([from, { opacity: 0 }], [from + 100, { opacity: 1 }], [to - 100, { opacity: 1 }], [to, { opacity: 0 }]);
        if (performance && from === 0) steps.push([14_400, { opacity: 0 }], [14_500, { opacity: 1 }], [duration, { opacity: 1 }]);
      }
      steps.push([duration, { opacity: performance && intervals[0].startsWith('0:') ? 1 : 0 }]);
      steps.sort((a, b) => a[0] - b[0]);
      animate(element, steps);
    }

    if (performance) {
      const rest = target('plot', .95, -.45);
      const from = target('plot', 13.4 / 30, .42);
      const to = target('plot', 17.8 / 30, .42);
      const ask = target('ask', .86, .6);
      cursor([[0, rest], [6450, rest], [7250, from], [7450, from, .88], [8150, to, .88], [8250, to], [9300, to], [10_050, ask], [11_950, ask], [12_550, rest], [duration, rest]]);
      animateAll('.fp-chart-line', [[0, { clipPath: 'inset(0 100% 0 0)' }], [400, { clipPath: 'inset(0 100% 0 0)' }], [5000, { clipPath: 'inset(0 0% 0 0)' }], [14_200, { clipPath: 'inset(0 0% 0 0)' }], [14_400, { clipPath: 'inset(0 100% 0 0)' }], [duration, { clipPath: 'inset(0 100% 0 0)' }]]);
      animateAll('.fp-range', [[0, { transform: 'scaleX(0)', opacity: 0 }], [7450, { transform: 'scaleX(0)', opacity: 1 }], [8150, { transform: 'scaleX(1)', opacity: 1 }], [14_200, { transform: 'scaleX(1)', opacity: 1 }], [14_400, { transform: 'scaleX(0)', opacity: 0 }], [duration, { transform: 'scaleX(0)', opacity: 0 }]]);
      animateAll('.fp-recording-card', [[0, { opacity: 1, transform: 'translateY(0)' }], [13_800, { opacity: 1, transform: 'translateY(0)' }], [14_200, { opacity: 0, transform: 'translateY(12px)' }], [14_400, { opacity: 0, transform: 'translateY(-8px)' }], [14_850, { opacity: 1, transform: 'translateY(0)' }], [duration, { opacity: 1, transform: 'translateY(0)' }]]);
    } else {
      const rest = target('changes', .8, 3);
      const like = target('like', .64, .68);
      const refresh = target('refresh');
      const changes = target('changes', .75, .7);
      const reset = target('reset');
      const confirm = target('confirm');
      const launch = target('launch');
      const browse = target('browse');
      cursor([[0, rest], [500, rest], [1050, like], [1150, like, .85], [1250, like], [1850, like], [2250, refresh], [2350, refresh, .85], [2450, refresh], [4500, refresh], [5200, changes], [5300, changes, .85], [5400, changes], [6200, rest], [8500, rest], [9300, reset], [9400, reset, .85], [9500, reset], [10_650, confirm], [10_800, confirm, .85], [10_900, confirm], [12_750, launch], [13_400, launch, .85], [13_500, launch], [14_600, browse], [14_700, browse, .85], [14_800, browse], [15_600, rest], [duration, rest]]);
      animateAll('[data-feature-target="refresh"] svg', [[0, { transform: 'rotate(0deg)' }], [2400, { transform: 'rotate(0deg)' }], [3200, { transform: 'rotate(360deg)' }], [duration, { transform: 'rotate(360deg)' }]]);
      animateAll('[data-feature-target="profile"]', [[0, { transform: 'translateX(0) rotate(0)', opacity: 1 }], [1250, { transform: 'translateX(0) rotate(0)', opacity: 1 }], [1700, { transform: 'translateX(135%) rotate(18deg)', opacity: 0 }], [11_000, { transform: 'translateX(135%) rotate(18deg)', opacity: 0 }], [11_100, { transform: 'translateX(0) rotate(0)', opacity: 1 }], [duration, { transform: 'translateX(0) rotate(0)', opacity: 1 }]]);
      animateAll('.demo-phone', [[0, { transform: 'scale(1)', opacity: 1 }], [10_900, { transform: 'scale(1)', opacity: 1 }], [11_200, { transform: 'scale(.15)', opacity: 0 }], [13_400, { transform: 'scale(.15)', opacity: 0 }], [13_800, { transform: 'scale(1)', opacity: 1 }], [duration, { transform: 'scale(1)', opacity: 1 }]]);
    }
    const time = motion.matches ? posterTime : elapsed;
    for (const animation of animations) animation.currentTime = time;
    syncPlayback();
  }

  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && entry.intersectionRatio >= .25;
    syncPlayback();
  }, { threshold: .25 });
  const resize = new ResizeObserver(layout);
  intersection.observe(root);
  resize.observe(scene);
  motion.addEventListener('change', () => {
    const time = motion.matches ? posterTime : 0;
    for (const animation of animations) animation.currentTime = time;
    syncPlayback();
  }, { signal });
  document.addEventListener('visibilitychange', syncPlayback, { signal });

  function cleanup() {
    intersection.disconnect();
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

const previews = document.querySelectorAll<HTMLElement>('[data-feature-preview]');
for (const preview of previews) initialize(preview);

export {};
