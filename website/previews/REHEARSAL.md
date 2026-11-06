# Native feature previews

The hero is frameless native HTML/SVG. Performance and Storage are native HTML/SVG
inside macOS app windows, with no extra outer border or video controls. The same
feature components render on the homepage and in their docs guides.

Source attribution and current choreography are documented in
`../src/components/site/previews/README.md` and
`../src/components/home/annotation/README.md`.

The old dark video renderer, videos, and posters were removed when these scenes
moved to native elements. Historical exports remain in Git at `c30546d3`.

Validate the complete loops at 1440px, 768px, and 390px, both docs routes, hidden
and offscreen pausing, resize progress, reduced motion, and navigation cleanup.
Run `pnpm --dir website check` and `pnpm --dir website build`. The required Linux
visual-snapshot command is `npm run test:visual:docker -- --update-snapshots`;
Docker is unavailable on this workstation, so never update those on macOS.

## Validation, 2026-11-05

- Website check: 46 files, no errors, warnings, or hints. Production build passed.
- Browser: homepage at 1440px and 390px, both docs guides at 768px, Performance
  docs at 390px. No horizontal overflow or video elements. Storage's Like target
  remains fully visible on phones; desktop shows the complete phone.
- Observed the selected chart range and Storage's likes diff in real playback.
  Offscreen chart state stayed unchanged. The docs' global square-corner rule
  excludes the product previews, preserving the macOS and phone geometry.
- Isolated lifecycle rehearsal passed valid keyframes, autoplay, offscreen and
  hidden-page pausing, resize progress, reduced-motion posters, back/forward
  cache restoration, and animation/observer cleanup for both feature scenes.
- Docker snapshots blocked by `spawnSync docker ENOENT`; none updated on macOS.
- Plugin telemetry is unchanged; the marketing site sends no remote telemetry.
