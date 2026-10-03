# App Flow

Open **Tools → App Flow** in Mobile Dev. Setup reads the current project from the
host's MCP roots, finds running local Metro servers, and selects a matching app on
the selected device. Choose **Map app** when the fields are ready. Open the app and
choose the app state you want to map. Use **Record a flow** for login or other
screens outside navigation. No source edits or app-specific adapter is needed.

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
works without a navigator. Both need a development build with a React Native
DevTools hook and a Metro target that allows multiple debugger connections. Capture supports iOS simulators and Android devices;
physical iOS screenshot capture is not available.

## Discovery and capture

The source scanner parses JavaScript and TypeScript without executing project
code. It supports JSX screen declarations, shared screen helpers, imported
screen components, nested navigators, static navigator configurations, and Expo
Router layouts and route files. It reads param types and literal defaults.
Runtime discovery adds registered routes and observed params. Conditional routes,
custom wrappers, computed names, and screens controlled entirely by local state
may remain unresolved by route discovery. Use flow recording for local forms
and modals outside the routing system.

The canvas follows confirmed navigation links. It shows one arrow per pair of
screens, with both endpoints mounted. Repeated route definitions share a preview;
recorded flow steps keep their own previews. **Map more screens** adds routes from
the current app state while keeping earlier screenshots. **New map**, in Setup,
starts over. Pinch to zoom; preview frames use a 9:16 aspect ratio.

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

Route mapping restores the starting navigation state on completion or stop. Its runtime
watchdog renews while the debugger stays connected and attempts restoration if
heartbeats stop for 10 seconds. Navigation can still trigger ordinary app effects,
such as marking content read. It cannot undo
those effects or arbitrary application state changes.

## Login, onboarding, and local forms

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
