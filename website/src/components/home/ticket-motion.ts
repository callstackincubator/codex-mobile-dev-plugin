import { mountTicketPreview } from './ticket-preview';

export function startTicketDemo(root: HTMLElement) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let time = 0;
  let previous = performance.now();
  let visible = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const ramp = (start: number, duration: number) => {
    const value = (time - start) / duration;
    const bounded = Math.min(1, value);
    return Math.max(0, bounded);
  };
  const render = () => {
    const growth = ramp(1.5, 1.4);
    const stepped = Math.floor(growth * 16) / 16;
    const values = {
      '--grow': stepped,
      '--opening': time >= 0.6 ? 1 : 0,
      '--connection': time >= 1.2 ? 1 : 0,
      '--panel': time >= 3.1 ? 1 : 0,
      '--request': time >= 4.5 ? 1 : 0,
      '--input-call': time >= 5.3 ? 1 : 0,
      '--updated': time >= 5.8 ? 1 : 0,
      '--reply': time >= 6.9 ? 1 : 0,
    };
    const entries = Object.entries(values);
    for (const [name, value] of entries) {
      const text = String(value);
      root.style.setProperty(name, text);
    }
    root.dataset.step = time >= 5.8 ? 'updated' : 'opening';
  };
  const stop = () => { clearTimeout(timer); timer = undefined; };
  const tick = () => {
    timer = undefined;
    if (visible === false || document.hidden || motion.matches || preview.isOpen()) return;
    const now = performance.now();
    const elapsed = (now - previous) / 1000;
    previous = now;
    time = (time + elapsed) % 12;
    render();
    timer = setTimeout(tick, 1000 / 12);
  };
  const start = () => {
    stop();
    if (motion.matches) { time = 9; render(); return; }
    if (preview.isOpen()) return;
    previous = performance.now();
    tick();
  };
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting === true;
    if (visible) start();
    else { preview.hide(); stop(); }
  });
  const preview = mountTicketPreview(root, (open) => {
    if (open) {
      time = Math.max(0.6, time);
      render();
      stop();
    } else if (visible) start();
  });
  const handleVisibility = () => { if (document.hidden) stop(); else if (visible) start(); };
  const cleanup = () => {
    stop();
    preview.dispose();
    observer.disconnect();
    motion.removeEventListener('change', start);
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener('pageshow', handlePageShow);
  };
  const handlePageHide = (event: PageTransitionEvent) => {
    if (event.persisted) { preview.hide(); stop(); }
    else cleanup();
  };
  const handlePageShow = () => { if (visible) start(); };
  motion.addEventListener('change', start);
  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('pageshow', handlePageShow);
  observer.observe(root);
  if (motion.matches) { time = 9; render(); }
}
