# Plan: Embed the TraceSift Explore view inside the mobile-dev plugin UI

Goal: clicking **Explore** on an in-chat TraceSift card opens the full Explore
experience inside the plugin UI (same iframe surface), with feature parity with
the browser window. No browser window, no `tracesift explore` spawn for this path.

Approach: publish the Explore UI from the TraceSift repo (`perf-ai`) as npm
packages and consume them in the plugin. This guarantees parity by construction:
the TraceSift web app itself re-renders the same components.

## Current state (verified)

### Plugin (this repo, tracesift worktree)
- Card = React MCP-Apps view (`src/ui/tracesift-app.tsx`, `src/ui/components/tracesift-cards.tsx`),
  served as one esbuild single-HTML bundle via `ui://mobile-dev/<ver>/tracesift.html`.
- Explore click → `TraceSiftController.openExplore` → app-only tool
  `mobile_open_tracesift_explore` → `TraceSiftClient.launchExplore` spawns
  `tracesift explore <file> --task n [--focus id]` / `--commit r.c`; the CLI opens
  the service's loopback URL in the system browser (`src/server/tracesift-client.ts:261-305`).
- The card iframe's CSP allows only the Sentry origin; `resourceDomains: []`;
  Codex filters plain HTTP/WS origins from widget CSP. **The iframe can never fetch
  the TraceSift service directly.** All data must arrive through the MCP bridge.
- Compact analysis persisted at `~/.tracesift/integrations/mobile-dev/<hash>.json`
  carries summary cards only — `tree` and `timeline` are stripped
  (`DRILL_DOWN_ONLY` in perf-ai `src/lib/integration-api.ts`). Not sufficient for explore.

### TraceSift (perf-ai repo, github.com/callstackincubator/tracesift, MIT, changesets, npm scope @callstack)
- npm-workspaces repo: private Next.js 16 app + published `@callstack/tracesift` CLI.
- `tracesift explore` only builds a URL `…/explore?a=&task=[&focus=]` against the
  running service and opens a browser (`packages/cli/src/explore.js`).
- Explore view: `src/app/explore/page.tsx` (~1.6k lines, "use client") +
  `chart-notes.tsx`, `stretch-zoom.tsx`. Inner components `TaskExplorer`,
  `ReactExplorer`, `CardExplorer` already take plain JSON handoffs as props.
- Fetch layer: `src/lib/card-handoff.ts` — `fetchTaskHandoff` →
  `GET /api/task-card`, `fetchReactExplore` → `GET /api/react-commit` (same-origin, no auth).
- Integration API v1 (bearer token from `~/.tracesift/service.json`, the plane the
  plugin already uses) has: `health`, `analyze`, `handoff`, and
  **`GET /api/integration/v1/task?analysisId=&taskIndex=` returning the full TaskCard
  incl. tree + timeline**. Missing: an integration endpoint for `reactExplore`.
- UI stack: React 19, `@rozenite/ui` 2.4.0 (Base UI based; requires a local patch
  adding `minLabelWidth` to `FlameGraph` — `patches/@rozenite+ui+2.4.0.patch`),
  Tailwind v4 only for the @rozenite/ui foundation, ~1k lines of plain global CSS
  for explore itself, custom div-based timeline/bars, no chart libraries, no state libs,
  zero `next/*` or `node:` imports in the explore component tree.

## Architecture of the target state

```
Card UI (iframe)                Plugin Node (MCP server)             TraceSift service
────────────────                ────────────────────────             ─────────────────
[Explore] ──callServerTool──▶  mobile_tracesift_explore_data
                               ├─ GET /api/integration/v1/task ────▶  full TaskCard (JSON)
                               │  or /api/integration/v1/react-explore (NEW)
        ◀── payload (JSON) ────┘
Embedded <TaskExplorer card={…}/> renders in-place, fullscreen display mode.
"Open in browser" link kept as fallback (still via CLI/URL).
```

Parity model: both the TraceSift web page and the plugin import the same
`@callstack/tracesift-explore` components. New explore features land in the
package; the web app and plugin each bump a version.

## Work breakdown

### Phase 0 — Spike (in this worktree, throwaway): de-risk the bridge (0.5–1 day)
The one genuinely unknown risk is **payload size through the MCP bridge**: a
long-task card carries its whole call tree + timeline, several MB; the architecture
docs already warn about host decoder limits on deep/large structuredContent.
- Hand-copy one `TaskExplorer` render path into the tracesift view with a
  hard-coded/fixture TaskCard (~5–10 MB JSON) returned from an app-only tool.
- Measure: does Codex deliver it? Latency? Does deep nesting break the host?
- Fallbacks if needed (choose by result, not upfront):
  - Flatten `TaskTreeNode`/`ReactExploreNode` to a flat array with `parentId`
    (same pattern the plugin already uses for UI inspection, docs/architecture.md:73).
  - Deliver via `resources/read` (chunked/revisioned, like the live-UI resource)
    instead of tool structuredContent.
  - Gzip + base64 through the bridge, decompress with `DecompressionStream` in the iframe.
- Also spike folding `@rozenite/ui/styles.css` (compiled Tailwind v4 output) +
  explore CSS into the single-HTML esbuild build and dark-theme scoping.

### Phase 1 — perf-ai: extract publishable packages (1–2 weeks, the bulk)
Add packages to the existing npm workspace + changesets pipeline:

1. `@callstack/tracesift-core` (pure TS, no deps): types + transforms needed by
   explore: `TaskCard`/`TaskTreeNode`/`TaskCardSet`, `TaskTimeline`/`TimelineBox`,
   `ReactExplore`/`ReactExploreCommit`/`ReactExploreNode`, `FrameClass`,
   `focusedTree`, `focusedReactTree`, `isShownFrame`, formatters, source/frame-location
   helpers. (~500–1500 lines; all verified free of `node:` imports.)
2. `@callstack/tracesift-explore` (React 19 peer): `TaskExplorer`, `ReactExplorer`,
   `CardExplorer` (legacy `?c=` mode behind a flag), plus a small `ExploreView`
   entry. Changes vs. perf-ai's page:
   - props-in data (no `fetch`, no `window.location.search`; deep-link state becomes
     props/callbacks),
   - drop `ThemeGate` / `window.close` footer (host chrome concerns),
   - ship a precompiled stylesheet (`@rozenite/ui` theme vars + explore CSS) so
     consumers don't need Tailwind v4 with `@source` scanning.
   - Decide the `@rozenite/ui` `minLabelWidth` patch: upstream it first (preferred),
     else vendor the FlameGraph change into the package.
   - Consider shipping one combined package (core re-exported) to reduce moving parts;
     split `core` only if the plugin needs types without UI.
3. perf-ai refactor: `src/app/explore/page.tsx` becomes a thin route that fetches
   (existing same-origin APIs) and renders the package components. Parity is now
   structural: same source tree, one renderer.
4. New integration endpoint: `GET /api/integration/v1/react-explore?analysisId=`
   returning the full `ReactExplore` payload (+ `reactCards` list for commit switching),
   bearer-authed, versioned with `apiVersion`, tests in `tests/*.test.mjs`.
   Also document in `packages/cli/CLI.md` / docs.
5. Version-skew contract: add the service API version to health (if not present) and
   make payloads additive-only; plugin tolerates missing optional fields and shows a
   "update TraceSift" error on version mismatch (plugin already models
   `TraceSiftError kind: version`).

### Phase 2 — Plugin: consume the package (3–5 days)
1. Deps: `@callstack/tracesift-core` + `@callstack/tracesift-explore` + `@rozenite/ui`.
   `scripts/build.mjs`: fold the shipped stylesheet(s) into `app.html`; verify the
   Tailwind-compiled CSS doesn't collide with the plugin's own Tailwind layer
   (explore CSS is BEM-namespaced, low risk; wrap in a scoped class if needed).
2. Server (`src/server/tracesift-client.ts`, `tracesift-tools.ts`):
   - New app-only tool, e.g. `mobile_tracesift_explore_payload`
     `{ analysisId, taskIndex | rootId+commitIndex }` → fetch
     `/api/integration/v1/task` or `/api/integration/v1/react-explore` with the
     service bearer token → return payload per Phase 0's chosen transport.
   - Handle expired analyses (`findAnalysis` 404) with the existing "run it again" error.
   - Keep the CLI browser path as `openInBrowser` fallback button (unchanged code).
3. UI (`src/ui/tracesift-*`):
   - `TraceSiftController`: `openExplore` becomes in-surface navigation
     (cards list ⇄ explorer), payload fetched via the new tool; back button;
     focus node / commit selection mapped to the package's props (replaces
     `?focus=`/`?commit=` deep links).
   - Use the existing fullscreen display mode for the tracesift resource
     (`preferredDisplayMode` is currently `inline`; explorer opens fullscreen —
     check if runtime display-mode switching is needed, else register
     `availableDisplayModes` appropriately).
   - Update chart-band clicks (`TaskContribution.onFocus`, `ReactContribution.onExplore`)
     to drill into the embedded explorer instead of the browser.
4. Surface/telemetry per AGENTS.md:
   - Keep `Surface = "tracesift"` (same product surface; no new shared type needed)
     but add context so explorer work isn't attributed to the card:
     `setUiTelemetryContext` for explore vs cards, `ui.tracesift.explorer.ready`
     timing via `markUiSurfaceReady`/`recordUiTiming`, payload fetch measured with
     existing `tracesift.operation.*` aggregates on the server side,
     `ui.tracesift.explore` counter repurposed to the embedded path (document the
     meaning change in docs/telemetry.md). Flush/reset on nav back.

### Phase 3 — Verification & rollout (2–3 days)
- perf-ai: package build/type tests, `node --test` for the new endpoint, visual check
  the web `/explore` page is unchanged after refactor.
- Plugin: extend `tests/tracesift-*.test.ts` (payload tool, controller nav, expired
  analysis); `scripts/smoke-*` style manual smoke in Codex for the big-profile case;
  confirm CSP needs no changes (no new network origins — data rides MCP, which is
  the plugin's established pattern).
- Release order: ship packages first (changesets minor), then the plugin consuming a
  minimum package/service version with clear upgrade errors. Keep the browser-window
  fallback for at least one release.
- Docs: plugin `skills/mobile-dev/SKILL.md` (Explore now opens in-panel),
  `docs/telemetry.md`, perf-ai README/CLI docs; add a plugin `docs/architecture.md`
  section for the embedded explorer + version-skew contract.

## Risks & mitigations
1. **Bridge payload size (highest risk)** → spike first; flatten/`resources.read`/gzip fallbacks defined above.
2. **Version skew** (installed CLI/service older than plugin's package expectations)
   → additive payloads, `apiVersion` checks, explicit "update TraceSift" error; browser fallback.
3. **`@rozenite/ui` patch drift** → upstream `minLabelWidth`, else vendor; pin exact versions in perf-ai.
4. **CSS integration into the single-HTML build** → scoped class + smoke check against light/dark.
5. **Parity erosion over time** → structurally solved: perf-ai's own web page renders
   the same package; CI in perf-ai can type-check both consumers' usage.

## Effort summary
- Spike: ~1 day
- perf-ai packages + endpoint + refactor: ~1.5–2 weeks
- Plugin integration: ~3–5 days
- Verification/docs/release: ~2–3 days

## Decision requested
- Confirm npm-package route (recommended, matches the parity concern). The alternative
  — copying explore sources into the plugin as vendored code — is ~a week faster but
  forks the UI and re-creates the parity problem on the second feature.
- Confirm Phase 0 spike outcome decides transport (tool result vs resource read vs compressed).
