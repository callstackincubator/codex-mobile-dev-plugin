# Project instructions

## Sentry observability

Sentry coverage is part of feature implementation and maintenance. When adding a
feature, changing an adjacent feature, or refactoring performance-sensitive code,
review the affected path's existing instrumentation and add measurements where
they help locate slow product surfaces or operations. Trivial changes do not need
new telemetry when existing coverage already answers the relevant questions.

- Preserve coverage through rewrites. When rendering, filtering, data processing,
  streaming, input handling, or MCP operations move to a new implementation, move
  or update the instrumentation so it measures the active path. Keep measurement
  boundaries, units, and names comparable across releases; document deliberate
  changes to their meaning in the README's Sentry section.
- Measure useful boundaries: surface readiness, processing/rendering duration,
  input acknowledgement, expensive tool operations, and resource consumption when
  a reliable measurement is available. Distinguish plugin performance from the
  monitored device/app's data. Browser frame intervals are callback pacing, and
  device input round trips end at acknowledgement; neither is device rendered FPS
  or touch-to-photon latency.
- Reuse `src/ui/telemetry.ts`: `recordUiTiming`, `setUiGauge`, `countUiEvent`,
  `setUiSurface`, `setUiTelemetryContext`, and `markUiSurfaceReady`. Use
  `captureUiError` and `src/server/telemetry.ts`'s `captureServerError` for relevant
  handled failures. Keep SDK initialization centralized in the existing UI and
  server telemetry modules, with shared sampling and scrubbing in
  `src/shared/telemetry.ts`.
- Native helpers share `native/telemetry/telemetry.c` and its Rust wrapper. Reuse
  their bounded timing windows and resource sampler. Rebuild affected helpers
  after changing shared telemetry, retain matching symbols in `.sentry/native`,
  and upload them to `codex-mobile-dev-native` with the same plugin release.
- Use sampled traces for meaningful operations spanning UI and server work. The
  existing MCP wrapper propagates trace context; preserve it when changing the
  bridge. Use bounded aggregate metrics for frequent frame, polling, processing,
  and input measurements. Avoid a span or network event per frame/sample and
  preserve frequent-tool sampling exclusions and hidden-panel collection limits.
- Attribute UI measurements to the correct surface and context. For a new
  surface, update the shared `Surface` type, surface transitions, and any server
  metadata validation that needs the new value. Flush/reset measurements across
  context changes so one surface's work is not attributed to another.
- Keep names and attributes stable and low cardinality. Send only approved
  product metadata and numeric measurements. Do not send app logs, tool arguments
  or results, screenshots, input content, device identifiers, local paths, or
  credentials. Preserve the existing scrubbing and expected-error exclusions.
- Preserve `development` and `release` environments, the shared plugin release,
  and matching source maps/debug IDs when changing initialization or builds.
  Local builds/packages default to development; public builds require the explicit
  release flag. Use the packaged environment for UI, Node and native helpers; do
  not infer it from watcher state.
  Native SDK integration requires separately scoped work; do not expand a UI or
  Node feature change into native Sentry setup incidentally.
- Verify instrumentation on the changed execution path, including surface
  attribution and observer/timer cleanup where relevant. Use the existing
  `tests/telemetry.test.ts` and `tests/ui-telemetry.test.ts` for meaningful telemetry
  behavior checks. In the completion summary, state what coverage was added or
  preserved, or why existing coverage is sufficient.

See the README's Sentry section for current collection, privacy, and build details.
