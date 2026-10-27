# Architecture

[Back to README](../README.md) · [Contributing](../CONTRIBUTING.md)

Claude's server serves agent-device's commands as `device_*` tools. The separate Agent Device MCP entry and its skill stay disabled in the other hosts; their implementation and bundled runtime are retained for later reactivation.

## Hosts

The server (`packages/core`), the shared UI (`packages/ui`) and the MCP Apps panel
(`packages/mcp-app`) run in every host. Codex, Claude and Cursor load the panel as an
MCP App: the `App` from ext-apps carries tool calls and resource reads through the
host, and the panel adapts to the capabilities each host advertises. The Mac app
(`apps/mac`) starts the server over stdio and relays its JSON-RPC lines to a web view,
whose page calls the server with an MCP client.

A host adds to the shared pieces without changing them:

- **Server:** each host's entry calls `runStdioServer` with its `ServerFeature`s.
  Codex adds the self-updater, which installs through Codex's marketplace; the Mac
  app adds its page resource; Cursor runs the shared server unchanged. Claude shows
  simulators itself, so its entry (`apps/claude/server`) passes `panels: false`,
  which leaves out the panel and workspace and the tools only they use (see
  `registerPanels`), and adds agent-device's commands. Its chat cards stay, and
  simctl finds simulators in place of Baguette.
- **Runtime:** a host's `plugin-host.json` can list the parts of `dist/` it ships
  and a server build of its own. Claude ships neither Baguette, serve-emu nor the
  iOS mirror, and its server splits into chunks, keeping every file under the
  Claude plugin directory's 5 MiB limit.
- **Panel:** a host's page entry calls `startMcpApp` with its chrome. Codex adds the
  update banner; Claude uses the shared entry, for its cards.
- **Views:** shared views depend only on `HostBridge`, the subset of `App` they use,
  plus optional host context attachments. `DeviceWorkspace` keeps the iOS and Android
  panels, their selection and layout identical in every host.

## Shared app discovery

`packages/ui/src/device-apps.ts` owns one `DeviceAppsStore` per workspace. Device selection
feeds this store; it polls every three seconds while the panel is visible and the
selected device is connected, including before Performance opens. Consumers share
`subscribe` and `getSnapshot` (also usable with React's `useSyncExternalStore`).
Snapshots contain the selected device, eligible running `apps`, `foregroundApp`,
and `ready`, `discovering`, and `error`. `refresh` coalesces concurrent requests.
Device changes, hidden panels, disconnection, and disposal cancel pending work,
clear foreground state, and ignore late results. A failed query is not a confirmed
absence: consumers should check `ready` before interpreting `foregroundApp: null`.

`packages/core/src/device-apps/` contains platform discovery, exposed through the existing
`mobile_performance_sources` tool. Android reads the top resumed activity from ADB;
iOS simulators read the frontmost accessibility translation's PID without walking
the UI tree; paired iPhones retain their accessibility-audit PID query. Foreground
identity is separate from the eligible monitoring list: an iOS PID outside that
list has `bundleId: null`; Android resolves the resumed package's main PID with ADB
`pidof`, including packages outside the monitoring list. No sole
background process is guessed to be foreground. Performance consumes this store
and preserves its chosen recording target across foreground changes.

## Runtime

Each MCP process owns one bundled Baguette child process. It selects a free loopback port, launches `dist/baguette/Baguette serve --host 127.0.0.1 --port <port> --no-plugins`, and shares that child across its tool calls and panel sessions. It does not use a separate Baguette server on port 8421. An opening failure returns an error the panel can show.

The retained, currently inactive Agent Device entry point is `dist/agent-device-server.mjs`, which launches the official bundled `agent-device mcp` with Node through an SDK adapter. The adapter publishes all 55 operations, preserves their typed command arguments and output contracts, and validates inputs before forwarding them. State paths, remote daemon credentials, runner configuration and output-format settings belong to the plugin and are absent from tool inputs. Batch steps use the same compact contracts. Device selectors remain on setup, discovery, installation and script tools; interactions require a named session and reuse the upstream runtime's device binding. There is no global platform override. File operations retain `cwd` where it is relevant.

The wrapper uses an explicit empty package config and a private temporary state directory. Default platform and form selectors would bypass the native session's device binding, so those are set only through device setup commands. It clears inherited agent-device settings so a global or cloud daemon cannot take over this connection. Commands start its local daemon as needed. On MCP shutdown, the wrapper runs the bundled `daemon stop --state-dir <own-directory> --clean` command, which checks the daemon's PID identity and releases its runner leases. It keeps logs and artifacts in that state directory for later reads. Call agent-device `session` with `action: "state-dir"` to find it.

`npm run check:mcp-budget` reads the packaged servers' catalogs, estimates their model-visible specifications, and checks them against [Codex's tool limits](https://github.com/openai/codex/blob/main/codex-rs/core/src/mcp_tool_exposure.rs). Codex compacts any MCP tool input schema over 5,000 bytes, dropping descriptions, so the check fails when one exceeds it. Codex's 8,000-byte per-tool and 64,000-byte combined limits apply only to Agent Plugins, whose manifest is `plugin.json` at the plugin root; tools past them are hidden from the model. This plugin uses `.codex-plugin/plugin.json`, the legacy format, so those limits do not apply. Moving to the Agent Plugin format would hide part of the catalog, which is about 64 KB. On models that support tool search, Codex defers MCP tools from every plugin: they leave the initial tool list but stay discoverable and callable.

Use the panel's UDID and a named agent-device session for agent work. Refs belong to the latest snapshot or settled diff in that session. `press` and `fill` take a target such as `{ "kind": "ref", "ref": "@e12" }` or `{ "kind": "selector", "selector": "label=\"Search\"" }`. Use actual refs from the current result. Closing a session can close its app; leave `shutdown` unset to keep the simulator running. Another live agent-device daemon can own a runner lease. End that owner's work or choose another simulator instead of releasing its live claim.

The app gets a random stream session through an app-only MCP tool. The MCP server opens a WebSocket to its bundled Baguette, keeps the latest JPEG, and returns it through `resources/read`. The iOS viewer requests 60 FPS, overlaps reads with JPEG decoding, and paints only the newest decoded frame. Frame and decode queues stay bounded; older pending frames are discarded. JPEG bytes are base64-encoded only when a reader requests the latest frame. The app sends input through an app-only tool that checks each message. Frames and input stay inside the host's MCP bridge. The UI sends telemetry to Sentry's configured ingestion origin.

The UI resource's CSP permits connections only to `https://o4512180958068736.ingest.de.sentry.io`; its resource allowlist is empty. Codex desktop 0.159.0 filters plain HTTP and WebSocket origins out of widget CSP, including loopback addresses. The MCP transport avoids those browser connections. A session expires after five minutes without reads or input. Closing or pausing a viewer closes its upstream capture. Ending the MCP process stops its Baguette child and streams. Simulator devices remain under CoreSimulator's control.

When a socket drops, the server reopens it for the same device and preserves the frame sequence. It clears the old frame and waits for fresh capture before allowing input. If Baguette exits, the next read starts a new bundled process. Heartbeats detect sockets that stop responding. If an open socket produces no first frame within ten seconds, capture retries with a delay. Baguette's MJPEG capture sends only changed pixels, so a quiet screen after the first frame stays connected. Failed attempts wait between 0.5 and 10 seconds. The panel also reconnects after MCP errors or an expired session. Pending paints and late decode results from a reset capture are discarded. It keeps the last frame, shows Reconnecting, and discards input from the failed connection. Closing the panel or selecting another device cancels retries. Capture retries never boot a stopped simulator; the separate confirmed Device Hub repair policy is described below.

An iOS JPEG decode error restarts capture through `mobile_stream_reset` with the same panel session. Reset requests have a one-second cooldown. Three failed frames in a row reopen the panel stream with a delay. Late decode results release their bitmap and cannot draw on a closed panel.

iOS boot and shutdown calls run in order for each device and wait up to two minutes for the reported state. Boot skips the backend route if the device already runs or is booting. This avoids a second boot and Baguette's input repair on a running device. Shutdown closes that device's panel streams after the device stops.

On macOS 27 with Xcode 27, the bundled Baguette can list simulators and capture frames. Device Hub can stop taps, buttons, and keys from reaching an iOS 27 device. Connections await a fresh status check. Gestures use the last completed result while one expired check refreshes in the background, so the approximately 150–200 ms command no longer delays every second of input. A new block becomes visible when that refresh completes. When blocked, it shows a notice. Ask Codex to repair input with `mobile_repair_input`. The tool runs the bundled Baguette's `heal` command. Reconnect capture afterward to use new input handles. It restarts backboardd and SpringBoard without rebooting the device. CoreSimulatorBridge can afterwards report no accessibility data for every foreground app until it restarts. UI reads that report no accessibility data restart the bridge and retry once, at most every 10 seconds per device. Relaunching Device Hub can block input again. The panel automatically repairs a confirmed Device Hub block when connecting and reconnects if input becomes blocked later. Repair closes running apps. It limits automatic attempts to once per device per minute; a repeated block or failed repair remains visible in the bottom bar. Model input alone does not trigger automatic repair. Baguette's boot route also repairs input after boot. Do not run the repair to diagnose video. See [Baguette's Device Hub notes](https://github.com/tddworks/baguette/blob/main/docs/features/device-hub/README.md).

UI resource addresses include the release version so Codex can load new HTML after an update. The original simulator and workspace addresses and the old v1 through v6 simulator addresses still return the current UI. After updating, restart Codex once if it still uses an older MCP process.

Performance findings and historical measurements are documented in [the profiling report](stream-profiling.md). Diagnostic timing reports remain available in Console; the simulator uses the upstream UI without temporary timing widgets.

## Screen annotations

Android selection maps full-resolution accessibility bounds to the captured video size. It uses the active display size and video orientation, including Android display-size overrides. Native fallback follows the same mapping. React Native device matching uses the SDK-resolved ADB path, so ADB does not need to be on the plugin process's PATH.

Select keeps its frozen screen, selected element and note during decoder or keyframe recovery within the current stream. Recovered frames update a local buffer; leaving Select displays the latest frame. Closing the stream, changing devices or losing attachment support still ends selection.

Send to chat shows only "Apply these annotations." Edit guidance stays in assistant-only context once per batch. Notes carry the full instruction, selected node, bounds, click point, screen units, creation site when available, React key and up to four nearby React owners. They distinguish a selected element's source from an enclosing owner's source, which serves only as a search hint. Up to four real ancestors, siblings and direct children describe the selection's boundary; parent and sibling records stay outside it. Repeated elements include the selected instance's position among visible matches. Notes never infer parents or siblings from overlapping bounds. The guidance limits edits to the selected instance and tells the agent to preserve its container and siblings when removing a child. Nearby text is deduplicated and limited to three entries of 160 characters. The model receives each note once; full capture records stay local.

Screen annotations use the device's accessibility tree for native and React Native apps. Click an exposed element to add a note. Clicks and manual regions work while inspection loads; an open point note adopts the real element when its bounds arrive. If runtime inspection fails, the panel retries the native accessibility tool. The note popup can select an enclosing element when the tree includes one; flat Android snapshots offer elements whose reported bounds contain the selection. Drag to mark a region when the app does not expose a view. Region annotations carry user-selected bounds, not inferred component names. React Native development apps can also supply runtime component names and measured native bounds through the MCP server. The panel makes no browser connection to Metro. The server uses an existing Metro server at `http://127.0.0.1:8081`, requires a unique device/app match and support for multiple debuggers, and closes its connection after each snapshot. It does not start Metro or take over another debugger. The `mobile_inspect_ui` tool accepts `metroUrl` and `targetId` for explicit targets.

The React Native adapter reads the DevTools hook to locate mounted components, then uses the documented native element `getBoundingClientRect()` API. Native screen containers with empty DOM bounds fall back to `measureInWindow()` callbacks through a temporary CDP binding. The server removes that binding and its global function before closing the connection. Logical component bounds cover their measured native children. Hit testing follows paint order: image, text or SVG content rendered later in another branch hides earlier React Native elements at that point, so a card stack's next card stays unselectable under the top card. A later plain container does not hide content, because the snapshot has no background information. iOS bezel definitions can describe a screen cutout slightly smaller than the device, such as 400×872 points for a 402×874 iPhone. Inspection returns the accessibility root's screen size, and the panel maps element bounds and annotation points with it instead. Automatic inspection picks the Metro target on the selected device whose bundle ID ends with the accessibility app name. When that finds none, such as Expo Go (`host.exp.Exponent`), iOS simulators look up the foreground app's bundle ID and match it exactly. A backgrounded React Native app never stands in for another foreground app.

Traversal uses a work queue so deeply nested navigator wrappers do not cut off visible rows. Native-stack screens marked inactive through `activityState` and `aria-hidden` are excluded, along with disconnected native elements. Decorative elements marked only `aria-hidden` remain selectable. Text labels use string children when available, and text outlines follow the component's layout bounds.

The hook is a version-sensitive interface; unsupported renderers, missing targets, timeouts and reloads fall back to accessibility selection and manual regions. Older renderers without the native element APIs cannot provide runtime selection. Snapshots stop at 3,000 named components, 10,000 visited fibers and 1,000 native measurements. A truncated snapshot reports remaining work or missed measurements. The debugger and MCP responses both use flat records with parent links. The plugin does not derive elements from screenshot colors.

The MCP server returns a flat element list with `nodeId`, `parentId` and `depth` fields. Parent links preserve enclosing-element selection without nesting the response through every React wrapper. This keeps JSON depth below host decoder limits; sending a deep runtime tree as structured content can cause a host to discard the response and wait until timeout. Native accessibility results use the same flat format.

Annotations send text only. Each note includes the user request, element label, test ID when present, React component and owner names when available, and nearby text. React debug creation stacks resolve through one bounded request to the matching Metro server's `/symbolicate` endpoint. Source maps supply an app file, line, column and function so the agent can open the element's JSX directly. This is the element creation site, not necessarily the component definition. Library frames and unresolved bundle locations never become edit locations. Missing source maps leave selection working and mark the source location unavailable. Coordinates remain a fallback. The paused image stays local for editing; use Screenshot separately to attach an image.

## Devices card and device requests

`mobile_show_devices` is the one user-facing device tool. Without `selectionMode`
it lists every discovered simulator, emulator and physical device in an inline
card, grouped as running, physical, then stopped by runtime. The user can boot or
stop simulators and emulators from the card and send selected devices to chat. A
backend that cannot list devices (no Android SDK, older Xcode) leaves the others
listed with a note. The tool's text result is a short summary so the model does
not repeat the list; hosts without app cards receive the list as text instead.

When a mobile task has ambiguous targets, the agent sets `selectionMode` with a
task-specific `message`. Hosts that advertise the `openai/elicitation` form
extension (Codex) get the native inline request form described below, and the card
then shows only the outcome. Hosts that render MCP app cards get the same card with
only selectable candidates and a Use button that sends the choice to chat; this
call returns immediately and tells the model to wait for that reply. Hosts with
neither return an error so the agent asks in chat. Candidate `devices` are
optional: omitted, the tool discovers them itself, and the form offers at most 20,
running devices first. The agent may instead supply discovered IDs, platform and
kind, plus optional operation details. The form shows canonical device names, platform/type,
runtime, optional verified app labels, and platform phone illustrations. Use
`selectionMode: "multiple"` to let the user choose several devices. No device is
preselected.

The tool waits for an answer and returns `action` and selected `devices`, checking
their availability both before opening the form and after acceptance. Cancellation
or decline returns no selection. Device selection does not boot devices, launch
apps, open streams or start recordings. Stopped simulators/AVDs can be offered for
build tasks; profiling candidates should already be running. Physical iOS uses
the hardware UDID and requires a connected paired device.

The form uses the OpenAI Extensions SDK's native form elicitation and requires
`extensions["openai/elicitation"].form`. Codex owns layout and button labels, so the native form
does not reproduce custom footer buttons from a design mockup. Thumbnails are
illustrations, not captured app screens.

## Embedded TraceSift explorer

Pressing **Explore** on a card opens TraceSift's full explorer in the card's own
frame rather than a browser window. The renderer is not a copy: both TraceSift's
web page and this plugin import the same components from
`@callstack/tracesift-explore`, so a drill-down cannot drift from the app that
produced the numbers.

The card's frame cannot reach the TraceSift service — Codex strips plain HTTP
origins from widget CSP — so its data rides MCP like everything else here.
`mobile_tracesift_explore_payload` fetches `/api/integration/v1/task` or
`/api/integration/v1/react-explore` with the service bearer token and returns the
payload as one text item plus a small `structuredContent` envelope
(`apiVersion`, `kind`, `encoding`, `payloadBytes`). A full task card carries its
whole call tree and timeline, which runs to megabytes, so past 64 KiB the text is
gzip-compressed base64; a measured 25 MB tree crosses in about 8 ms at a fifth
of its JSON size. Below that threshold it stays plain JSON. Keeping the tree out
of structured content avoids the deep-structured-payload failure documented
above: the SDK and host validate only the envelope, and the iframe inflates and
parses the payload once into the shapes the explorer draws. Payloads above
24 MiB are refused before decoding and point at the browser window; the service
already caps its trees at 60k nodes and 5k commits. Payload size is reported as
`tracesift.explore.payload_bytes`, which is where an oversized tree shows up
before a reader reports a spinner.

The same rule applies to the payload's age: it is fetched from the live service,
so an expired analysis answers with the existing "run it again" error instead of
a half-drawn tree. **Open in browser** keeps the previous path, which hands the
selection to `tracesift explore`.

Version skew favours the reader's installed service: payloads are additive-only
within integration API v1, the explorers ignore fields they do not know, and an
older service that cannot answer the endpoint fails with an update message. The
plugin folds the package's one compiled stylesheet into its single HTML bundle,
after the plugin's own Tailwind layer, so neither build compiles the other's
sources. That sheet opens by writing its theme tokens to `:root` and `.dark`,
which would recolor the plugin's cards behind the explorer, so the fold scopes
both token blocks to `.tracesift-explorer` — descendants inherit the custom
properties, and a block that no longer has the shape the fold expects fails the
build rather than leaking globally. The package is an ordinary npm dependency,
so its React and `@rozenite/ui` peers resolve to this project's own copies and
the bundle never carries a second React.

### Picking frames to investigate

**Select frames** in the explorer's bar switches its four task views from
navigating to collecting: a click adds a frame to a set instead of refocusing the
timeline, call tree and culprits or zooming the flame graph, and a second click
takes it back out. One set is shared by all four views because all four already
address a frame the same way — a `TaskTreeNode.id`, the dotted sibling path over
the merged call tree, which a timeline box carries as `nodeId`, a culprit row as
`nodeId`, and a flame box as its graph key. The package owns the drawing
(`FrameSelection`, in `frame-selection.tsx`) and the plugin owns the state
(`explorer.selected`, in `TraceSiftController`), so the web app and the panel
still render one explorer and only the panel offers the question.

Selection is deliberately not a second focus. Focus says where a view is standing
and stays exactly one frame; a selection is a set the reader is assembling and
survives moving the focus, which is what lets someone pick four frames on the
timeline and still see all four ringed after opening one in the call tree.

A pick rings the *frame*, not one drawing of it. The timeline draws one box per
call and the merged tree one node per call site, so a function that ran eight
times is eight boxes against the clock and one row elsewhere; the package rings
every box of the picked function wherever it appears, and clicking any of those is
the second click on the pick that exists rather than a new one. Turning **Select
frames** back off empties the set — the bar that explains picking goes with the
mode, so the picks go with it, and a send never carries a set whose count the
reader can no longer see.

**Investigate selected** writes its own hand-off, in `packages/shared/src/tracesift-selection.ts`
rather than through `mobile_get_tracesift_handoff`. The picks exist only in this
frame and the whole call tree is already in it, so a round trip could not have
answered the question anyway — and an older installed service is never asked
something it has never heard. It keeps the conventions of the service's prompts:
measured evidence and no conclusion, each figure labelled with what it counts, the
overlap named where one pick contains another (inclusive times are not additive;
self times are, so the set's own time and the honest remainder are the only
sums), and the caveats that decide how a number is read. Frames folded by the
focused views are folded in its tree too, so it describes the stack the reader was
looking at.

### Picking components out of a React recording

The same switch, over a recording. **Select components** turns the render tree
and the component table from navigating to collecting, and **Investigate
selected components** writes its own hand-off from
`packages/shared/src/tracesift-react-selection.ts`. The state is the one field the task
side uses, because it is the same shape; what differs is the id, the arithmetic
and the words.

A pick is a `reactNodeKey` — `<rootId>.<commitIndex>.<fiberId>` — rather than a
bare fiber id, because a fiber id is unique inside its root and nowhere else.
Naming the commit is what lets a selection outlive the commit picker: a reader
works a cascade by stepping through commits, and a per-commit set would empty
itself under exactly the navigation the reading is made of. Choosing a commit
stays navigation, the way moving the task focus is.

One pick rings one fiber, which is the opposite of the task side and
deliberately so. A task's merged tree has one node per call site, so one pick has
to ring every box drawn of that function; React's tree merges nothing, and two
renders of a component are two fibers with their own causes, their own changed
props and their own time. Ringing both because they share a name would claim a
sameness React did not record. The render tree says so when a pick of the open
commit is not drawn — collapsed as a pass-through, or below one that was.

The hand-off keeps the same conventions and almost none of the same caveats,
because the measurement is different. React's profiler is not sampled:
`selfDuration` and `actualDuration` are recorded per fiber per commit, so the
figures are exact for the render phase and say nothing about the commit phase,
the effects, or the time between two commits — which the prompt states rather
than leaving a reader to assume a recording covers an interaction. Own time is a
true partition of a commit, so the picks' own times add and the remainder is the
other components plus the reconciler's own walk; inclusive times overlap every
ancestor and are never summed. Picks are grouped by the commit that measured
them, and the same component picked in two commits is named as the repeated
render it is rather than as one finding listed twice.

## Sources

The implementation follows [Baguette's HTTP and WebSocket routes](https://github.com/tddworks/baguette/blob/v0.2.1/docs/serve.md) and [gesture protocol](https://github.com/tddworks/baguette/blob/v0.2.1/docs/wire.md). The bundled automation server follows [agent-device's official MCP setup](https://github.com/callstack/agent-device#add-mcp-tools-to-your-agent). Native panel metadata follows [OpenAI's plugin extensions](https://developers.openai.com/plugins/build/extensions). The package uses the [portable plugin format](https://developers.openai.com/plugins/build/plugins).
