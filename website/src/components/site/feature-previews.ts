for (const video of document.querySelectorAll<HTMLVideoElement>('[data-feature-preview]')) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const controller = new AbortController();
  const { signal } = controller;
  let visible = false;
  let userPaused = false;
  let suspended = false;

  const canAutoplay = () => {
    return visible && document.hidden === false && motion.matches === false && suspended === false;
  };

  const syncPlayback = () => {
    if (canAutoplay() && userPaused === false) {
      const playback = video.play();
      playback.catch((error: DOMException) => {
        if (error.name === 'AbortError') return;
        userPaused = true;
      });
    } else {
      video.pause();
    }
  };

  video.addEventListener('pause', () => {
    if (canAutoplay()) userPaused = true;
  }, { signal });
  video.addEventListener('play', () => {
    userPaused = false;
  }, { signal });

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
    syncPlayback();
  }, { threshold: 0.25 });

  motion.addEventListener('change', syncPlayback, { signal });
  document.addEventListener('visibilitychange', syncPlayback, { signal });
  window.addEventListener('pagehide', event => {
    suspended = true;
    syncPlayback();
    if (event.persisted === false) {
      observer.disconnect();
      controller.abort();
    }
  }, { signal });
  window.addEventListener('pageshow', () => {
    suspended = false;
    syncPlayback();
  }, { signal });

  observer.observe(video);
}

export {};
