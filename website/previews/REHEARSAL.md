# Dark feature previews

The gold scenes are the existing `md-recording` and `md-storage` previews from
`feat/feature-previews` at `5796aecb574fa2ab005854ec6a7ff1dc75cdd5d7`.
This pass changes their palette to match the plugin. Their layout, story,
component geometry, and virtual-clock choreography remain authored by the source.

## Palette

The renderer reads the dark declarations from `packages/ui/src/theme.css`,
the Codex host tokens from `tooling/hosts/profiles.ts`, and the same Tailwind
semantic tokens used by the storage components. The main plugin surface resolves
to `rgb(24, 24, 24)` and its foreground to `rgb(245, 245, 245)` in both scenes.
The surrounding ground comes from the website's `--bg` token.

Checked the opening, chart drawing, selected range, storage value change,
Changes list, reset confirmation, and app relaunch. Text, dividers, controls,
chart selections, and old/new storage values remain readable on dark surfaces.
The app on the phone retains its own palette.

## Exports and host checks

- Performance: 844 frames, 14.067 seconds, 1920 × 1080 H.264 at 60 fps.
- Storage: 929 frames, 15.483 seconds, 1920 × 1080 H.264 at 60 fps.
- Posters: performance at 9 seconds, storage at 7 seconds, encoded as WebP
  directly from the dark source frames.
- Inspected source frames at 0, 3.5, 7, 9, 11, and 13 seconds for both scenes.
- Decoded and inspected the storage MP4's first and last frames: both return to
  the same dark Browse view and Monty profile, with no light-frame seam.
- A separate fresh-eye review of those 12 frames found no actionable color or
  contrast issue against the plugin's dark screenshots and original gold stills.
- Confirmed the encoded performance video plays in the Performance guide and the
  encoded storage video plays on the homepage and in the Storage guide.
- Checked the host pages at 1440, 768, and 390 pixels: no horizontal overflow,
  native playback controls available, video playback active, no browser errors.
- The shared player's pause, offscreen visibility, and reduced-motion behavior
  are unchanged. Its earlier playback and lifecycle checks still apply.

## Automated motion scans

Ran the source's `film.mjs --dark --gate` for each wide scene, including a repeat
after the full export finished. Both reported `rehearsal passed` for their hard
gate conditions, but returned exit code 2 because native frame sampling had gaps.
They are inconclusive and are not counted as a full motion-verification pass.
The recording scan also reported the source's existing Roll settle and Swap
handoff candidates, already described in its original `REHEARSAL.md`.
Storage's native scan also flagged phone-content clipping during the app layer's
transition and icon movement; this palette pass does not alter those animations.

The exported MP4s use the source's virtual clock and capture every encoded frame;
they do not depend on the native sampling cadence of the motion scanner.
This pass does not change the source scene's timing or handoffs.

## Limits

Storage and performance keep the wide video composition and offer native
fullscreen viewing. No source compact redesign or touch-device testing was done
in that color pass. Docker-based host screenshot updates remain unavailable on
this machine.

## Native annotation hero

The annotation hero now adapts `md-annotate` into Astro HTML, CSS, inline SVG,
and a shared 12-second Web Animations timeline. Its implementation and source
attribution live in `website/src/components/home/annotation/`. The annotation
MP4s, posters, and their renderer configuration have been removed.

The inner chat and device UI sit directly in the page. Verified that the hero
wrapper has a transparent background, zero border, zero padding, and no video
elements. Desktop and tablet show the chat beside the device; the phone layout
keeps the selected button clear of the composer. The note's full text fits its
field. Checked desktop at 1440px, tablet near 768px, and phone at 390px without
horizontal overflow.

Verified the visible Pause control in the browser and stable pointer placement
while paused. An isolated lifecycle check covers offscreen pausing, preserving
a manual pause across visibility changes, hidden tabs, resize progress, reduced
motion's finished state, back/forward restoration, and observer/listener/animation
cleanup. Website diagnostics and the production build pass. Docker screenshot
updates remain unavailable because the Docker executable is missing.

The marketing site still sends no remote telemetry. Plugin Sentry initialization,
instrumentation, and data boundaries are unaffected.
