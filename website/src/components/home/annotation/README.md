# Native annotation hero

The hero adapts the authored `md-annotate` and shared HorseTinder scenes from
[`feat/feature-previews` at `5796aecb574fa2ab005854ec6a7ff1dc75cdd5d7`](https://github.com/callstackincubator/codex-mobile-dev-plugin/tree/5796aecb574fa2ab005854ec6a7ff1dc75cdd5d7/design/stageshow).
Stageshow's MIT notice is preserved in `website/public/previews/LICENSE`.

Astro renders the scene as HTML with inline SVG icons. CSS lays out the chat and
phone directly in the page, without an outer window, border, padding, or canvas
fill. The phone keeps the app's own palette; the agent UI uses the plugin's dark
neutrals. Below 600px the device view fills the scene and the composer sits at
its foot.

`hero-annotation.ts` measures the real element positions after layout and creates
one shared 12-second timeline with the Web Animations API. Resizing updates the
positions while preserving playback progress. Playback pauses offscreen, while
the tab is hidden, or when the visitor presses Pause. Reduced motion and the
HTML before script initialization show the finished annotation and context chip.
Observers, animations, and listeners are cleaned up when leaving the page.

No React runtime, video, video poster, external assets, or remote telemetry is
needed for the hero. The separate storage and performance previews retain their
video player.
