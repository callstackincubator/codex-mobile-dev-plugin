# Architecture

[Back to README](../README.md) · [Contributing](../CONTRIBUTING.md)

The Agent Device MCP entry and skill are currently disabled; their implementation and bundled runtime are retained for later reactivation.

## Shared app discovery

`src/ui/device-apps.ts` owns one `DeviceAppsStore` per workspace. Device selection
feeds this store; it polls every three seconds while the panel is visible and the
selected device is connected, including before Performance opens. Consumers share
`subscribe` and `getSnapshot` (also usable with React's `useSyncExternalStore`).
Snapshots contain the selected device, eligible running `apps`, `foregroundApp`,
and `ready`, `discovering`, and `error`. `refresh` coalesces concurrent requests.
Device changes, hidden panels, disconnection, and disposal cancel pending work,
clear foreground state, and ignore late results. A failed query is not a confirmed
absence: consumers should check `ready` before interpreting `foregroundApp: null`.

`src/server/device-apps/` contains platform discovery, exposed through the existing
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

`npm run check:mcp-budget` reads the packaged servers' catalogs and estimates their model-visible specifications, including repeated namespace instructions and plugin attribution, before the host applies lossy schema compaction. With Agent Device deactivated, the current estimate is 45,315 bytes for 38 model-visible tools, below [Codex's shared 64,000-byte plugin budget](https://github.com/openai/codex/blob/main/codex-rs/core/src/mcp_tool_exposure.rs). The schema cleanup in 0.1.68 reduced the combined catalog from 238,784 to 99,568 bytes; temporarily removing its Agent Device entry makes room for the recording tools. Other enabled plugins also consume the shared budget. Splitting the same tools into more enabled MCP servers does not avoid it.

Use the panel's UDID and a named agent-device session for agent work. Refs belong to the latest snapshot or settled diff in that session. `press` and `fill` take a target such as `{ "kind": "ref", "ref": "@e12" }` or `{ "kind": "selector", "selector": "label=\"Search\"" }`. Use actual refs from the current result. Closing a session can close its app; leave `shutdown` unset to keep the simulator running. Another live agent-device daemon can own a runner lease. End that owner's work or choose another simulator instead of releasing its live claim.

The app gets a random stream session through an app-only MCP tool. The MCP server opens a WebSocket to its bundled Baguette, keeps the latest JPEG, and returns it through `resources/read`. The iOS viewer requests 60 FPS, overlaps reads with JPEG decoding, and paints only the newest decoded frame. Frame and decode queues stay bounded; older pending frames are discarded. JPEG bytes are base64-encoded only when a reader requests the latest frame. The app sends input through an app-only tool that checks each message. Frames and input stay inside the host's MCP bridge. The UI sends telemetry to Sentry's configured ingestion origin.

The UI resource's CSP permits connections only to `https://o4512180958068736.ingest.de.sentry.io`; its resource allowlist is empty. Codex desktop 0.159.0 filters plain HTTP and WebSocket origins out of widget CSP, including loopback addresses. The MCP transport avoids those browser connections. A session expires after five minutes without reads or input. Closing or pausing a viewer closes its upstream capture. Ending the MCP process stops its Baguette child and streams. Simulator devices remain under CoreSimulator's control.

When a socket drops, the server reopens it for the same device and preserves the frame sequence. It clears the old frame and waits for fresh capture before allowing input. If Baguette exits, the next read starts a new bundled process. Heartbeats detect sockets that stop responding. If an open socket produces no first frame within ten seconds, capture retries with a delay. Baguette's MJPEG capture sends only changed pixels, so a quiet screen after the first frame stays connected. Failed attempts wait between 0.5 and 10 seconds. The panel also reconnects after MCP errors or an expired session. Pending paints and late decode results from a reset capture are discarded. It keeps the last frame, shows Reconnecting, and discards input from the failed connection. Closing the panel or selecting another device cancels retries. Capture retries never boot a stopped simulator; the separate confirmed Device Hub repair policy is described below.

An iOS JPEG decode error restarts capture through `mobile_stream_reset` with the same panel session. Reset requests have a one-second cooldown. Three failed frames in a row reopen the panel stream with a delay. Late decode results release their bitmap and cannot draw on a closed panel.

iOS boot and shutdown calls run in order for each device and wait up to two minutes for the reported state. Boot skips the backend route if the device already runs or is booting. This avoids a second boot and Baguette's input repair on a running device. Shutdown closes that device's panel streams after the device stops.

On macOS 27 with Xcode 27, the bundled Baguette can list simulators and capture frames. Device Hub can stop taps, buttons, and keys from reaching an iOS 27 device. Connections await a fresh status check. Gestures use the last completed result while one expired check refreshes in the background, so the approximately 150–200 ms command no longer delays every second of input. A new block becomes visible when that refresh completes. When blocked, it shows a notice. Ask Codex to repair input with `mobile_repair_input`. The tool runs the bundled Baguette's `heal` command. Reconnect capture afterward to use new input handles. It restarts backboardd and SpringBoard without rebooting the device. Relaunching Device Hub can block input again. The panel automatically repairs a confirmed Device Hub block when connecting and reconnects if input becomes blocked later. Repair closes running apps. It limits automatic attempts to once per device per minute; a repeated block or failed repair remains visible in the bottom bar. Model input alone does not trigger automatic repair. Baguette's boot route also repairs input after boot. Do not run the repair to diagnose video. See [Baguette's Device Hub notes](https://github.com/tddworks/baguette/blob/main/docs/features/device-hub/README.md).

UI resource addresses include the release version so Codex can load new HTML after an update. The original simulator and workspace addresses and the old v1 through v6 simulator addresses still return the current UI. After updating, restart Codex once if it still uses an older MCP process.

Performance findings and historical measurements are documented in [the profiling report](stream-profiling.md). Diagnostic timing reports remain available in Console; the simulator uses the upstream UI without temporary timing widgets.

## Screen annotations

Android selection maps full-resolution accessibility bounds to the captured video size. It uses the active display size and video orientation, including Android display-size overrides. Native fallback follows the same mapping. React Native device matching uses the SDK-resolved ADB path, so ADB does not need to be on the plugin process's PATH.

Select keeps its frozen screen, selected element and note during decoder or keyframe recovery within the current stream. Recovered frames update a local buffer; leaving Select displays the latest frame. Closing the stream, changing devices or losing attachment support still ends selection.

Send to chat shows only "Apply these annotations." Edit guidance stays in assistant-only context once per batch. Notes carry the full instruction, selected node, bounds, click point, screen units, creation site when available, React key and up to four nearby React owners. They distinguish a selected element's source from an enclosing owner's source, which serves only as a search hint. Up to four real ancestors, siblings and direct children describe the selection's boundary; parent and sibling records stay outside it. Repeated elements include the selected instance's position among visible matches. Notes never infer parents or siblings from overlapping bounds. The guidance limits edits to the selected instance and tells the agent to preserve its container and siblings when removing a child. Nearby text is deduplicated and limited to three entries of 160 characters. The model receives each note once; full capture records stay local.

Screen annotations use the device's accessibility tree for native and React Native apps. Click an exposed element to add a note. Clicks and manual regions work while inspection loads; an open point note adopts the real element when its bounds arrive. If runtime inspection fails, the panel retries the native accessibility tool. The note popup can select an enclosing element when the tree includes one; flat Android snapshots offer elements whose reported bounds contain the selection. Drag to mark a region when the app does not expose a view. Region annotations carry user-selected bounds, not inferred component names. React Native development apps can also supply runtime component names and measured native bounds through the MCP server. The panel makes no browser connection to Metro. The server uses an existing Metro server at `http://127.0.0.1:8081`, requires a unique device/app match and support for multiple debuggers, and closes its connection after each snapshot. It does not start Metro or take over another debugger. The `mobile_inspect_ui` tool accepts `metroUrl` and `targetId` for explicit targets.

The React Native adapter reads the DevTools hook to locate mounted components, then uses the documented native element `getBoundingClientRect()` API. Native screen containers with empty DOM bounds fall back to `measureInWindow()` callbacks through a temporary CDP binding. The server removes that binding and its global function before closing the connection. Logical component bounds cover their measured native children.

Traversal uses a work queue so deeply nested navigator wrappers do not cut off visible rows. Native-stack screens marked inactive through `activityState` and `aria-hidden` are excluded, along with disconnected native elements. Decorative elements marked only `aria-hidden` remain selectable. Text labels use string children when available, and text outlines follow the component's layout bounds.

The hook is a version-sensitive interface; unsupported renderers, missing targets, timeouts and reloads fall back to accessibility selection and manual regions. Older renderers without the native element APIs cannot provide runtime selection. Snapshots stop at 3,000 named components, 10,000 visited fibers and 1,000 native measurements. A truncated snapshot reports remaining work or missed measurements. The debugger and MCP responses both use flat records with parent links. The plugin does not derive elements from screenshot colors.

The MCP server returns a flat element list with `nodeId`, `parentId` and `depth` fields. Parent links preserve enclosing-element selection without nesting the response through every React wrapper. This keeps JSON depth below host decoder limits; sending a deep runtime tree as structured content can cause a host to discard the response and wait until timeout. Native accessibility results use the same flat format.

Annotations send text only. Each note includes the user request, element label, test ID when present, React component and owner names when available, and nearby text. React debug creation stacks resolve through one bounded request to the matching Metro server's `/symbolicate` endpoint. Source maps supply an app file, line, column and function so the agent can open the element's JSX directly. This is the element creation site, not necessarily the component definition. Library frames and unresolved bundle locations never become edit locations. Missing source maps leave selection working and mark the source location unavailable. Coordinates remain a fallback. The paused image stays local for editing; use Screenshot separately to attach an image.

## Native device requests

When a mobile task has ambiguous targets, `mobile_choose_devices` asks the user
through Codex's native inline request form. The agent discovers suitable devices
first, then supplies their IDs, platform and kind, a task-specific question, and
optional operation details. The form shows canonical device names, platform/type,
runtime, optional verified app labels, and platform phone illustrations. Use
`selectionMode: "multiple"` to let the user choose several devices. No device is
preselected.

The tool waits for an answer and returns `action` and selected `devices`, checking
their availability both before opening the form and after acceptance. Cancellation
or decline returns no selection. Device selection does not boot devices, launch
apps, open streams or start recordings. Stopped simulators/AVDs can be offered for
build tasks; profiling candidates should already be running. Physical iOS uses
the hardware UDID and requires a connected paired device.

This local MCP connection uses the OpenAI Extensions SDK's native form elicitation.
The host must advertise `extensions["openai/elicitation"].form`; unsupported hosts
return an explicit error. Codex owns layout and button labels, so the native form
does not reproduce custom footer buttons from a design mockup. Thumbnails are
illustrations, not captured app screens.

## Sources

The implementation follows [Baguette's HTTP and WebSocket routes](https://github.com/tddworks/baguette/blob/v0.2.1/docs/serve.md) and [gesture protocol](https://github.com/tddworks/baguette/blob/v0.2.1/docs/wire.md). The bundled automation server follows [agent-device's official MCP setup](https://github.com/callstack/agent-device#add-mcp-tools-to-your-agent). Native panel metadata follows [OpenAI's plugin extensions](https://developers.openai.com/plugins/build/extensions). The package uses the [portable plugin format](https://developers.openai.com/plugins/build/plugins).
