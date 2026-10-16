# Phase 0 spike findings — Explore payload transport + CSS fold

Machine: Apple Silicon, Node v24.3.0 (`--expose-gc`). Single run per cell;
variance is a few ms. Raw JSON: `spike/out/bridge-results.json`,
`spike/css/out/report.json`.

## How to run

```sh
# Spike A: full matrix (~1 min, peaks ~500 MB RSS)
node --expose-gc spike/bridge.mjs            # full: 1/5/10/25 MB × depth 50/500 + flat 60k
node --expose-gc spike/bridge.mjs --quick    # 1/5 MB, depth 50 only

# Spike B: CSS fold (needs spike/node_modules installed: cd spike && npm install)
node spike/css/build-spike.mjs --rozenite --mb 2   # output in spike/css/out/

# Standalone fixture dump
node spike/gen.mjs --mb 5 --depth 50
node spike/gen.mjs --kind flat        # 60k-node flat ReactExplore-like
```

## Spike A — bridge transport

Harness (`spike/bridge.mjs`) models the real chain, not a bare InMemory pair:
ext-apps `App` (iframe view) → `JsonTransport` (JSON.stringify+parse per
message, emulating the double serialization the real bridge performs —
InMemoryTransport passes objects by reference, which would hide the dominant
cost) → ext-apps `AppBridge` (host) → SDK `Client` → `McpServer` +
`registerAppTool`. V1 uses a `registerAppTool` outputSchema like the plugin's
existing tracesift tools (so server-side structuredContent validation runs);
V2/V3 are text-only tools without outputSchema; V4 is `registerResource` +
`readServerResource` with a base64 blob (the live-frame resource pattern).
All four variants succeeded everywhere in this harness.

Variants: V1 structuredContent object · V2 `content[].text` = JSON string ·
V3 text = gzip→base64 (server `node:zlib`, view `DecompressionStream`) ·
V4 `resources/read` base64 blob.

### TaskCard-like (nested tree depth 50, tree≈40% + timeline≈60%)

| size | V1 wall / decode | V2 wall / decode | V3 wall / decode | V4 wall / decode |
|---|---|---|---|---|
| 1 MB | 14 ms / 0 ms | 6 ms / 3 ms | **0.6 ms / 27 ms** | 4 ms / 3 ms |
| 5 MB | 63 ms / 0 ms | 26 ms / 13 ms | **2 ms / 25 ms** | 15 ms / 15 ms |
| 10 MB | 128 ms / 0 ms | 51 ms / 28 ms | **4 ms / 47 ms** | 28 ms / 29 ms |
| 25 MB | 328 ms / 0 ms | 120 ms / 64 ms | **8 ms / 133 ms** | 67 ms / 68 ms |

(`wall` = `callServerTool`/`readServerResource` round trip in-process;
`decode` = iframe-side JSON/base64/gunzip of the received result.)

### Depth 500 tree, flat 60k-node array, wire size, memory

| fixture | V1 wall | V2 wall | V3 wall | V4 wall | wire V1 / V2 / V3 / V4 | heap delta V1 / V2 / V3 / V4 |
|---|---|---|---|---|---|---|
| 5 MB d500 | 62 ms | 25 ms | 2 ms | 14 ms | 5.0 / 5.9 / 1.1 / 6.7 MB | 16 / 19 / 15 / 27 MB |
| 25 MB d500 | 335 ms | 121 ms | 9 ms | 64 ms | 25.0 / 29 / 5.6 / 33.3 MB | 80 / 91 / 71 / 133 MB |
| flat60k 11.4 MB (ReactExplore caps 60k/5k) | 102 ms | 50 ms | 4 ms | 32 ms | 11.4 / 12.8 / 2.2 / 15.2 MB | 33 / 39 / 30 / 58 MB |

Depth 50 vs 500 changes nothing measurable in the Node-side pipeline. JSON
payload data compresses ~5–7× (25 MB → ~5.3 MB base64); base64 inflates text
variants ~1.15× (V2) and base64-blob variants ~1.33× (V4).

### Server-side gzip cost (blocks the plugin's event loop)

25 MB JSON → gzip level 6 ≈ 223 ms + 1 ms base64; 10 MB ≈ 92 ms; 5 MB ≈ 46 ms.
One-off per Explore open — acceptable; consider `gzip` on a worker or
`zlib.gzip` async form in production to avoid the stall.

### Decode-side support

`DecompressionStream('gzip')`: Chrome ≥ 116 (plugin build targets
`chrome120` — safe), Node ≥ 18 as a global. No polyfill needed.

### Depth limits (host-independent part)

| depth | JSON.stringify | JSON.parse | SDK `CallToolResultSchema.parse` (z.unknown) | recursive z.lazy object .parse |
|---|---|---|---|---|
| 50 / 500 / 2000 | ok | ok | ok | 500 ok (0.6 ms); **2000 RangeError** |
| 5000 | ok (5 ms) | ok | ok | RangeError |
| ≥ 10000 | **RangeError (stack)** | ok | ok | RangeError |
| 50000 / 100000 (synthetic `{"a":{…}}`) | (not reached) | **ok** (iterative Blink parser) | **ok** | (not reached) |

Verdict on depth: **depth 500 is safe through every Node-side stage we
control** — V8 JSON (stringify breaks only near depth ~10k, parse is
iterative-safe much further), the SDK's Zod `CallToolResultSchema`
(`z.record(z.string(), z.unknown())` does not recurse into values), and Ajv
validation of `structuredContent` against a `z.unknown()`-typed outputSchema.
The only Node-side depth hazard is writing a **concrete recursive outputSchema**
(a real `TaskTreeNode` schema recurses like z.lazy): that blows the stack
around depth ~2000, and would also make `tools/list` outputSchema→JSON-Schema
conversion risky. Real TaskCard trees measured from perf-ai shapes sit far
below that, but the guard below makes it moot. Chrome's own `JSON.parse` is
iterative for objects since Blink's parser rewrite; the plugin's own
`JSON.parse` in the iframe shares V8's stringify limit only if it re-serializes.

### What this does NOT model (read before trusting the table)

- The real Codex host sits between stdio JSON and postMessage. Its
  structuredContent decoder reportedly has depth/size limits
  (docs/architecture.md ~line 73: a deep runtime tree as structured content
  "can cause a host to discard the response and wait until timeout"). This
  harness cannot replicate that; only V3 sidesteps it **by construction**
  (the host sees a flat string, never a deep object).
- InMemory-style transport ≠ the host's process boundary: the real path adds
  at least one more serialize/copy per hop, so absolute wall times here are
  lower bounds. Relative ordering between variants should hold.
- Real postMessage uses structured clone (keeps numbers exact, usually faster
  than JSON.parse); ext-apps' `PostMessageTransport` also safeParses each
  message with `JSONRPCMessageSchema` (result is `z.unknown()`, shallow — fine
  at depth; verified not to recurse).
- Peak RSS with all fixtures live hit ~500 MB in this single process; the real
  app/server are separate processes, one payload at a time.

## RECOMMENDATION — transport

**Ship V3: `content:[{type:'text', text: base64(gzip(json))}]` on an
app-only tool with no outputSchema**, decoded in the iframe with
`DecompressionStream('gzip')` → `JSON.parse`.

Why V3 over the rest:
- It is the **only variant immune to host structuredContent depth/size
  decoders**: the bridge carries a string. That is the phase-0 risk that
  motivated the spike; V1/V2 leave it open, V4 only shrinks it to
  "base64 string inside a resource" (same string-safety, but 33% bigger and
  the resource lifecycle/URI-revision machinery buys nothing for a
  one-shot payload).
- Smallest wire by far (5.3 MB vs 25–33 MB at the 25 MB fixture) — least
  exposure to any per-message cap anywhere in the host, and fastest wall time
  (~8 ms vs 335 ms in-process).
- Total user-perceived cost at 25 MB ≈ server gzip 223 ms + bridge + iframe
  decode 133 ms ≈ well under a second — acceptable for an explicit Explore
  click, and no variant gets the iframe decode below ~64 ms anyway at 25 MB.

Belt-and-braces, keep anyway:
- **Flatten server-side: no.** With V3 the tree depth is invisible to the
  bridge and both Node and Chrome handle depth 500 (and ≥2000 for parse)
  comfortably; flattening would force the perf-ai components (`TaskExplorer`
  expects nested `TaskTreeNode`) to fork on shape, breaking parity-by-
  construction — the plan's core property. Instead **cap depth server-side**
  (see guard) and keep the plugin's flat-array pattern only where it already
  exists (UI inspection).
- **Do not define a recursive outputSchema** for the payload tool (stack risk
  at ~2000 depth + tools/list conversion cost). Use no outputSchema or
  `{ payloadRef: z.string(), bytes: z.number(), encoding: z.string() }`-style
  flat metadata beside the text block.

Proposed max-payload guard (plugin server, `mobile_tracesift_explore_payload`):
1. Reject before fetching if the request would exceed perf-ai's own caps
   (60,000 nodes / 5,000 commits) — mirror them server-side.
2. After fetching: raw JSON > **24 MiB** → return `isError` with a
   "payload too large, open in browser" result (keep the CLI fallback link).
3. Walk the tree iteratively to measure depth; depth > **1500** → flatten
   that response to a parentId array *or* fall back to browser (cheap O(n),
   and turns the depth question into a policy instead of a crash class).
4. Always gzip (any payload > ~64 KiB pays ~5 ms/MB, buys 5–7× wire).
   Use the async `zlib.gzip` callback form so a 200 ms compression doesn't
   stall the MCP server's event loop (it also serves frame streams).
5. Keep the existing `callServerTool` timeout pattern from the other panels
   (they pass `{ timeout: 45000 }`) on the view-side call.
6. Preserve the existing `recordTraceSiftOperation` telemetry and add a
   server timing for the fetch→gzip→respond op and a view-side decode
   timing via the existing `recordUiTiming` helpers.

## Spike B — folding a precompiled explore stylesheet into app.html

Built by `spike/css/build-spike.mjs` (replicates `scripts/build.mjs`'s CSS
path exactly: same repo-installed `@tailwindcss/node` 4.3.3 + oxide Scanner on
the real `src/ui/theme.css`, then the two `<style>` blocks injected into the
real `src/ui/index.html` markers, `</script` escaping as build.mjs does).
Stand-in explore sheet = real `@rozenite/ui@2.4.0/styles.css` compiled with
the repo's compiler (47 KB after utility generation — the package ships only
source CSS with `@source "./src/**"`, so a consumer compiling it would emit
utilities from **its own** scanned classes, not the library's) plus synthetic
`.ts-*` BEM rules + a `.dark` token block up to ~2 MB.

### Measured

| metric | value |
|---|---|
| plugin CSS today | 103 KB |
| @rozenite compiled (repo tailwind, lib src scanned) | 47 KB |
| stand-in explore.css | 2,058 KB (≈ 2 MB target) |
| app.html CSS-only today | 103 KB |
| app.html with folded explore.css | 2,162 KB (**+2,059 KB**) |
| selector collisions between sheets | 210, all Tailwind preflight element selectors (`html`, `hr`, `a`, …) |
| class-selector collisions (rozenite vs plugin utilities) | 162/283 identical utility names, identical definitions |
| custom-property overlap | 91/111 (`--font-sans`, `--spacing`, `--text-xs`, …) |
| `</style` / `</script` inside CSS | none in either sheet |

### Findings

a) **Coexistence works.** Two `<style>` tags in document order; each sheet is
   its own complete Tailwind output with its own `@layer theme, base,
   components, utilities;` statement (layers merge across sheets in order).
   The 210 "collisions" are preflight element selectors with identical rule
   bodies — harmless (later sheet wins with equal content). Same for the
   91 overlapping custom properties: both Tailwind 4.x outputs define the
   same `@theme` defaults identically. The plugin's `[data-theme="dark"]`
   variant and `--color-background-primary` host-token wiring are untouched
   by the second sheet.

b) **Size impact is linear and paid once**: +1× explore.css per HTML. The
   plugin already inlines a 103 KB CSS + multi-MB JS bundle + woff2 dataurls,
   so a ~2 MB compiled explore sheet is in line with existing size, at the
   cost of one-time host HTML load. Worth a build-time size assertion
   (the repo already has budget scripts like `check:mcp-budget`).

c) **Dark scoping: a `.dark` class on a container works for @rozenite/ui.**
   Its source declares `@custom-variant dark (&:where(.dark, .dark *))`, so
   dark *variants* compile to `&:is(:where(.dark, .dark *))` — any ancestor,
   not `html`. Its token block is a bare `.dark { … }` custom-property block
   (verified in the compiled output), which cascades from a container div to
   its subtree. **But note the plugin's own convention differs:** the plugin
   uses `@custom-variant dark (&:is([data-theme="dark"] *))` +
   `html[data-theme="dark"]` (theme.css line 8/88), and ext-apps'
   `applyDocumentTheme` sets `data-theme` on `<html>`. So the embedded
   explore root must get **both**: `class="dark"` (for @rozenite tokens) when
   the plugin is in dark mode — or the future package should switch its block
   to `[data-theme="dark"]` / support a `darkMode` prop so one signal drives
   both sheets. Do not add a `.dark` to `<html>` (the plugin's variants would
   not see it and host chrome would react).
   Verified statically (selector inspection); browser tool was unavailable in
   this session for a computed-style probe, but the cascade here is
   deterministic (`:where(.dark, .dark *)` and `.dark` custom properties
   both scope to any ancestor).

d) **Compiling `@import '@rozenite/ui/styles.css'` without the package fails
   as expected** (import resolution error; the error message is cryptic —
   "h is not iterable" from Tailwind's resolver). So the choice is:
   - **Ship compiled CSS in the future package (recommended, matches the
     plan).** Plugin never needs `@rozenite/ui` in node_modules, never needs
     Tailwind to see the explore sources, and CSS output is frozen/parity-
     owned by the package. Least fragile: no version-skew between plugin's
     Tailwind 4.3.3 and @rozenite's pinned 4.2.2, no `@source` scanning of
     `node_modules` (which is how the "162 colliding utilities" above would
     silently change as the plugin adds classes).
   - Plugin compiles it itself: needs `@rozenite/ui@2.4.0` as a plugin dep
     (pulls its own tailwindcss 4.2.2), `@source` pointing into
     `node_modules/@rozenite/ui/src` for component utilities, and every
     @rozenite bump re-risks the compiled output. Also cannot pick up the
     patched `minLabelWidth` FlameGraph without the patch present. More
     moving parts, no upside.
   One caveat for the shipped-compiled route: the package's own preflight and
   `@theme` defaults duplicate the plugin's (~45 KB). Acceptable; or the
   package can compile with `@import "tailwindcss" theme(static)` / preflight
   off since the plugin's sheet already provides both — worth an issue in
   perf-ai, not a blocker.

e) **esbuild/CSP gotchas**: none new. CSS is injected between the
   `APP_STYLE` markers as a plain `<style>` string (not an esbuild import),
   so no dataurl/font loader is involved for the explore sheet (keep fonts
   out of the shipped CSS or accept the woff2→dataurl growth the plugin
   already pays for Inter). `</style>` appearing inside CSS text would break
   the inline block — measured zero occurrences; a build-time
   `assert(!css.includes('</style'))` is cheap insurance, matching build.mjs's
   existing `</script` escaping for JS. CSP unaffected (inline styles already
   allowed; no network resources added).

## Net answers

- Transport: **V3 (gzip+base64 text content)** + server-side size/depth
  guards (≤24 MiB raw, depth ≤1500, perf-ai caps mirrored), no recursive
  outputSchema, no forced flattening. Re-spike against the real Codex host
  during Phase 2 — this table proves the Node-side chain, the host remains
  the one unmeasured hop (which is precisely what V3 insulates).
- CSS: ship precompiled `dist/explore.css` from the package and fold it into
  `app.html` as a second `<style>` block via the existing marker pipeline.
  Budget +~2 MB HTML. Sync the plugin's `data-theme="dark"` with a `.dark`
  class on the explore container (or unify on one signal in the package).
