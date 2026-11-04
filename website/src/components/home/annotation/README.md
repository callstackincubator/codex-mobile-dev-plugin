# Native annotation hero

The hero adapts the authored `md-annotate` and shared HorseTinder scenes from
[`feat/feature-previews` at `5796aecb574fa2ab005854ec6a7ff1dc75cdd5d7`](https://github.com/callstackincubator/codex-mobile-dev-plugin/tree/5796aecb574fa2ab005854ec6a7ff1dc75cdd5d7/design/stageshow).
Stageshow's MIT notice is preserved in `website/public/previews/LICENSE`.

Astro renders the scene as HTML with inline SVG icons. The macOS window retains
its title bar, traffic lights, outline, and dark plugin surface. It sits directly
in the page without an extra surrounding box, border, padding, or canvas fill.
The phone keeps the app's own palette. Below 600px the chat sits beneath the
device view inside the same window.

`hero-annotation.ts` measures the real element positions after layout and creates
one shared 16-second timeline with the Web Animations API. Resizing updates the
positions while preserving playback progress. Playback pauses offscreen, while
the tab is hidden, or when the visitor presses Pause. Reduced motion and the
HTML before script initialization show the finished edit: the request is in the
chat, the agent has changed `<Carrot />` to `<Apple />`, and the phone shows the
apple. During playback, the request first arrives in the composer, the cursor
presses Send, and the agent's code change precedes the app update. The result
holds before the loop resets.
Observers, animations, and listeners are cleaned up when leaving the page.

No React runtime, video, video poster, external assets, or remote telemetry is
needed for the hero. The separate storage and performance previews retain their
video player.

The earlier frameless version is preserved at commit `799fc619` and
https://mobile-d8orj01fp-margelo.vercel.app.
