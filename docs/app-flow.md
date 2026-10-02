# App Flow

Open **Tools → App Flow** in Mobile Dev. Select the device running the app, enter
its source folder and Metro URL, then choose **Find apps**. Select the matching
Metro app and choose **Map app**. Open the app and log in first if it requires an
account. No source injection or app-specific adapter is needed.

The run budget is 30 seconds, including source discovery, connection setup, AI
resolution, navigation, and capture. Build and launch the app before starting.
App Flow currently supports development builds with React Navigation or Expo
Router, a React Native DevTools hook, and a Metro target that allows multiple
debugger connections. Capture supports iOS simulators and Android devices;
physical iOS screenshot capture is not available.

## Discovery and capture

The source scanner parses JavaScript and TypeScript without executing project
code. It supports JSX screen declarations, shared screen helpers, imported
screen components, nested navigators, static navigator configurations, and Expo
Router layouts and route files. It reads param types and literal defaults.
Runtime discovery adds registered routes and observed params. Conditional routes,
custom wrappers, computed names, and screens controlled entirely by local state
may remain unresolved. Modals outside the routing system are not enumerated.

The canvas shows navigator containment with solid lines and source-inferred
navigation links with dashed lines. These links are not proof that the associated
button works. Repeated screen definitions share a preview, labelled with the
original capture path. Tab-specific visual differences need separate captures.

One persistent Metro debugger connection drives the run. The server requests
screenshots directly from the existing device backend; it does not launch a
screenshot process or make a model call per screen. The first readiness attempt
lasts up to 350 ms, followed by one deferred attempt up to 1 second. Two matching device captures confirm that pixels have settled; up to four
comparisons fit within a 1.2-second capture limit. Screen changes during capture
invalidate the image. Capture uses route identity and stable host
layout across samples; a stable frame is not proof that all content has loaded.
There is no guarantee that every screen fits within the budget.

App Flow restores the starting navigation state on completion or stop. Its runtime
watchdog also attempts restoration if the debugger disconnects. Navigation can
still trigger ordinary app effects, such as marking content read. It cannot undo
those effects or arbitrary application state changes.

## Missing params

With **Use AI for missing params** enabled, hosts that support MCP sampling can
resolve one batch while capture continues. The request contains unresolved routes,
bounded source excerpts, observed route params, and bounded loaded query data.
Credential keys are stripped. Related values must come from real records.

If background sampling is unavailable, **Resolve with AI** sends a request to the
current chat. The agent reads `mobile_app_flow` with action `context`, then supplies
one `resolve` batch. Results arriving after the deadline are cached in server
memory for **Map again** with the same source, device, and Metro target. The tool
never extends the capture budget to wait for AI. It does not invent records,
create fixtures, or bypass authentication. Params requiring callbacks or missing
application state may remain unresolved.

## Results

Maps and PNG screenshots are saved under
`~/Library/Application Support/mobile-dev/app-flow/<run-id>/`. They contain local
app data and are not telemetry. The panel retains the current map while open;
a server restart clears in-memory runs and resolved-param caches. Saved files
remain on disk. Error and timeout cards remain in the map with their reasons.
