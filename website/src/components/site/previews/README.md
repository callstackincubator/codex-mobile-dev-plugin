# Native feature previews

Performance and Storage adapt the authored `md-recording` and `md-storage`
scenes from [Stageshow at `5796aecb574fa2ab005854ec6a7ff1dc75cdd5d7`](https://github.com/callstackincubator/codex-mobile-dev-plugin/tree/5796aecb574fa2ab005854ec6a7ff1dc75cdd5d7/design/stageshow).
Its MIT notice is preserved in `website/public/previews/LICENSE`.

Astro renders HTML and inline SVG, with no React runtime, video, iframe, poster,
or external assets. `DemoPhone.astro`, `demo-phone.css`, and `PreviewIcon.astro`
are shared with the annotation hero. The feature windows retain macOS chrome,
without a second outer container, border, padding, or background.

The local tokens mirror the plugin's dark background (#181818), card (#212121),
foreground (#f5f5f5), muted foreground (#a3a3a3), and border (#333333).
Charts and storage values retain the product's metric and semantic colors;
the phone keeps HorseTinder's pink palette.

`../feature-previews.ts` builds native Web Animations timelines. It measures
pointer targets after layout and on resize, preserving elapsed time. All actors
share a clock. Observers pause playback offscreen or while hidden; reduced motion
shows the completed state. Listeners, observers, and animations are cleaned up
on departure, with suspension/resume for the browser's back/forward cache.
There is no per-frame JavaScript loop or remote telemetry.

## Performance: 15 seconds

- 0.4–5.0: CPU and memory lines draw, and metrics step at the three swipes.
- 5.15–6.45: Finished and the purple change markers appear.
- 7.45–8.15: pointer drags the second swipe's range on both charts and minimap.
- 8.2–12.55: selected-range labels and thread shares appear; pointer visits Ask.
- 13.8–14.85: the card leaves, resets while hidden, and the next card enters.

The request stays visible throughout. Both CPU and Memory remain readable on
narrow screens, with the summary beneath them. Reduced motion shows the finished
recording and selected range at 10 seconds.

## Storage: 17 seconds

- 1.15–1.7: Like sends Monty's card away and reveals Juniper.
- 2.35–3.2: Refresh reads the store; likes changes from two to three items.
- 5.3–8.5: Changes opens, showing `[21,34]` → `[21,34,7]`.
- 9.4–10.9: Reset opens its confirmation, then closes the app to its home screen.
- 13.4–14.8: Launch app opens Monty again; Browse returns to the initial store.

The reset follows the source demo's authored loop: relaunch restores the initial
store. This compresses actual reset/read behavior; it is not a live device session.
On narrow screens the device sits above Storage inside the same window. Reduced
motion shows Juniper and the change history at 7.5 seconds.
