# App Flow

Open **Tools → App Flow** in Mobile Dev. Setup reads the current project from the
host's MCP roots, finds running local Metro servers, and selects a matching app on
the selected device. Choose **Map app** when the fields are ready. Open the app and
choose the app state you want to map. Mapping includes source-proven local forms
and sheets. Use **Record a flow** for steps that need real input or unsupported controls. No source edits or app-specific adapter is needed.

Discovery checks listening Node processes on any port and confirms Metro through
its status endpoint. It uses the server process's working folder to match the
project. When the host supplies no project, a single Metro server supplies its
folder. Multiple matches require a choice. You can edit the folder or Metro URL
and choose **Find apps** to refresh. If Metro is not running, the tab explains how
to connect; it does not launch another server.

Runs have no total time limit. Mapping finishes after all queued screens have
been attempted and the background AI batch has returned. Choose **Stop** to end a
run early. Build and launch the app before starting.
Route mapping supports React Navigation and Expo Router. Flow recording also
works without a navigator. Automatic mapping can capture the current standalone
view and its supported presentation branches without a navigator. Both need a development build with a React Native
DevTools hook and a Metro target that allows multiple debugger connections. Capture supports iOS simulators and Android devices;
physical iOS screenshot capture is not available.

## Discovery and capture

The source scanner parses JavaScript and TypeScript without executing project
code. It supports JSX screen declarations, shared screen helpers, imported
screen components, nested navigators, static navigator configurations, and Expo
Router layouts and route files. It reads param types and literal defaults.
Runtime discovery adds registered routes and observed params. Conditional routes,
custom wrappers and computed names may remain unresolved by route discovery.
A second source pass finds finite `useState` and `useReducer` values that select
rendered views, including shared hooks, context providers and callback helpers. It also finds reversible
`control.open()` and ref-based `present()`/`show()`/`expand()` calls paired with
mounted sheet or dialog components. No app names or adapters enter this pass.

The canvas follows confirmed navigation links. It shows one arrow per pair of
screens, with both endpoints mounted. Repeated route definitions share a preview;
recorded flow steps keep their own previews. **Map more screens** adds routes from
the current app state while keeping earlier screenshots. **Reset**, beside Setup,
clears the current view and keeps the project, Metro server, and app selection.
Choose **Map app** to start a separate map. Stop an active run before resetting;
earlier maps remain saved locally. Pinch to zoom; preview frames use a 9:16 aspect ratio.

One persistent Metro debugger connection drives the run. The server requests
screenshots directly from the existing device backend; it does not launch a
screenshot process or make a model call per screen. The first readiness attempt
lasts up to 1 second. Two deferred retries allow 2 and 4 seconds. Visible loaders
extend these waits to 6, 10, and 20 seconds, with capture as soon as content settles.
The runtime checks focused content, pending initial queries, native transitions,
and paint frames. Inactive pager pages do not delay capture, even when the native
pager reports their bounds at the same position as the selected page. The selected
page still waits for visible loaders. Blank or stale screenshots and screen changes
during capture invalidate the image. These waits are estimates of readiness, not
proof that every image or request has finished.

Readiness also samples visible Reanimated opacity inputs. Changes restart the
quiet period even when React content stays the same. If a fade starts during the
screenshot, capture repeats in place until the inputs agree before and after the
image. This uses the existing capture timeout and does not replay navigation.
Settled screens keep the same wait. Unsupported custom animations may still need
app instrumentation.

Route mapping restores the starting navigation state on completion or stop. Its runtime
watchdog renews while the debugger stays connected and attempts restoration if
heartbeats stop for 10 seconds. Navigation can still trigger ordinary app effects,
such as marking content read. It cannot undo
those effects or arbitrary application state changes.

Presentation discovery shares one React tree lookup per check and reads fresh
hook values on the next check. A second discovery failure after reconnection
keeps saved screenshots and lets the route queue continue. Runtime timeout
messages name the inspector step that failed. Saved maps include the plugin
version that started the run.

## Automatic local forms and sheets

The runner binds hook calls and JSX entries to exact source locations through Metro symbolication.
React hook exports stay wrapped for one bounded render pass, then return to their
original functions. It previews only presentation fields with finite source values.
Injected wrappers keep separate function scopes so Hermes preserves each hook
primitive and native completion handler.
It does not change auth/session fields, create accounts, sign out, type fake input,
or invoke submit/save/delete handlers. A whole-object presentation starts only
when that state is empty, so mapping does not replace a user's open draft.
These are UI previews, including branches that a UI-only guard would otherwise
hide. They do not create the backend state needed to use or submit a form.

Mounted entries, disabled props, and simple prop conditions limit which transitions
run. A controller must have one matching live instance and a matching close method.
Ambiguous instances and opening arguments that require unknown data stay out.
The runner follows nested views in place, captures each once, and connects it to
its parent. It checks visible loading, opacity, native bounds, and available native
show/state-change events. JavaScript portals match through React element props
identity. Each branch restores its presentation fields and closes its sheets before
continuing. Failed previews get two automatic retries; saved plans let **Retry**
reopen the same entry route and presentation chain later.

If a native navigator keeps showing its old frame after a local guard changes,
the runner can preview the proven component in a temporary framework modal. It
uses the component's live props and context, preserves the enclosing modal's
presentation style, and removes the preview before restoring the parent. Saved
retry plans retain this step. This previews the form; it does not sign in or
alter account state.

Source previews can open a finite reducer or local-state branch without a visible
button. The runner mounts a temporary copy with the original props, data and
provider values, then seeds only the proven UI selector during hook initialization.
It never dispatches the original reducer. For shared state, it copies one exact
state reference into the proven consumer's props or context. Ambiguous references
stay out. The original form, draft and provider state remain intact.

App effects inside these temporary copies do not run. This prevents mount effects
from submitting a form or changing account data. Views that need those effects to
load data or build their UI may remain blocked. Each preview must mount its proven
body and pass the existing readiness and screenshot checks. The canvas labels
these captures **UI preview**. Controllers can also open without a visible trigger
when their exact mounted source has a known open/close pair and the opening method
takes no arguments.

This covers common React patterns, not every custom state store or native UI.
Unmounted state owners, arbitrary global stores, native system pickers, and opaque
presentation APIs can need recording. Backend result bodies still need real data.
Existing in-place UI actions can run normal render effects, and controller
open/close methods can run their own effects. App Flow cannot undo those effects.
Unsupported loaders and native animations can still need app instrumentation.
It does not claim a complete map of every app.

Source discovery also keeps a separate catalog of reducer steps, shared hook/context
state, guarded render branches, and exact sheet targets. It records these views even
when their data or account state is unavailable. Only finite UI selectors and exact
controller targets become preview plans; a plan still needs a live binding and real
data. The full catalog stays out of canvas polling and runtime injection, and saves
once alongside the map. The runtime receives only compact executable plans.

## Record steps that need input

Choose **Record a flow**, give it a name, and open its first screen in the app.
Choose **Start recording**, then move through the flow yourself. App Flow saves
settled screens and draws arrows between the steps you visit. Returning to a step
reuses its preview. It waits through visible loading and checks the view again
after each screenshot. A visible modal takes priority over the content behind it.

Recording observes the running UI. It does not press buttons, fill forms, change
session state, or submit requests on your behalf. Cleanup and reconnection do not
reset navigation, so completing sign-in leaves you signed in. Choose **Finish
recording** when done, then **Map more screens** to add the routes now available.
Existing screenshots stay in the same saved map. Use **Show** to view one recorded
flow, the route map, or all screens.

Automatic step detection uses the active route, rendered components, and a visible
heading. Screens that reuse the same structure may need **Capture step**. Enter an
optional name before capturing to distinguish those states. This also works for
form variants or validation states. Recording discovers the steps you visit; it
does not infer hidden branches or bypass login, verification, or account creation.

## Missing params

With **Use AI for missing params** enabled, hosts that support MCP sampling can
resolve one batch while capture continues. The request contains unresolved routes,
bounded source excerpts, observed route params, and bounded loaded query data.
Credential keys are stripped. Related values must come from real records.

If background sampling is unavailable, **Resolve with AI** sends a request to the
current chat. The agent reads `mobile_app_flow` with action `context`, then supplies
one `resolve` batch. Results continue the same saved map, including across MCP
processes, while keeping successful screenshots. Finish flow recording before
resolving route data. Resolution does not invent records, create fixtures, or
bypass authentication. Params requiring callbacks or missing
application state may remain unresolved.

## Results

Maps and PNG screenshots are saved under
`~/Library/Application Support/mobile-dev/app-flow/<run-id>/`. They contain local
app data and are not telemetry. The panel retains the current map while open;
saved context lets other MCP processes read and continue a map. Screenshots and
flow names remain local. Error and timeout cards remain in the map with their reasons.

The [Bluesky source audit](app-flow-bluesky-audit.md) compares an independently
reviewed list of routes, guarded forms, sheets and prompts with source extraction.
It includes the full inventory, capture limits and a strict command to repeat the comparison.
Source matches do not confirm screenshot capture or availability in one session.
The audit command accepts `--capture-map /path/to/<run-id>/map.json` to count saved
automatic PNGs. It separates live captures from temporary UI previews, excludes
recorded steps, and requires the scan and each image to have the same local source
hash. A child screenshot never counts as a screenshot of its parent. Source hashes
and view identities stay local.
