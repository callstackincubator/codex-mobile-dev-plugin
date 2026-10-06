# Sentry observability

[Back to README](../README.md) · [Contributing](../CONTRIBUTING.md)

Since 0.1.107, MCP discovery and runtime use Node discovered in the user’s
configured login shell. The existing centralized Sentry initialization,
anonymous attribution, build environment, opt-out, runtime metrics, and MCP
traces remain on the same server
path, with telemetry opt-out explicitly forwarded by the MCP manifest. Launcher
failures occur before the server SDK starts and are available in desktop startup
logs; the Mobile Dev and setup skills check for missing tools and report a setup
problem. No host logs, paths, or tool inventories are sent to Sentry by that check.

Since 0.1.101, `logs.ios.parse` measures Node-side iOS record parsing, default system-noise filtering, and conversion in milliseconds before buffering. Bounded 30-second windows report sample count, mean, P95, and maximum; shutdown flushes the remaining window and stops its timer. Measurements use the `logs` surface and iOS simulator/physical kind, with no log content, subsystem names, sender paths, device IDs, or filter text. Existing UI query/filter timings, Node runtime coverage, and physical helper `native.logs.process` timings retain their boundaries. The rebuilt physical helper emits sender image paths locally for framework filtering and retains matching native symbols.

Since 0.1.94, shared selected-device discovery retains the frequent-tool trace
exclusion and handled server-error coverage, now under `device_apps.discover`.
`ui.device_apps.discovery` measures the discovery round trip in milliseconds with
bounded aggregate windows; `ui.device_apps.discovery_failure` counts current-query
failures. Queries cancelled by selection or visibility changes do not report
measurements. Results crossing a surface or telemetry-context change are excluded
so their duration is not attributed to the next surface or device. No bundle IDs,
PIDs, device IDs, app lists, or query output are sent. Existing CPU batch-processing
coverage and native Baguette crash/resource telemetry are preserved.

Saved chart cards use the `recording` surface and view. Existing readiness,
interaction and frame-pacing coverage is preserved. `ui.recording.process` and
`ui.recording.derive` measure result validation and chart/summary processing;
`ui.recording.change_density` measures highlight calculation on sample updates
and is cached across range selection changes;
`ui.recording.reveal` measures completed entrance drawing in milliseconds,
using the existing bounded timing windows. Since 0.1.84, the line traces its
measured curve with the fill following it. Since 0.1.85, the entrance pause is
550 ms and change highlights fade in after drawing finishes. The intentional
pause and highlight fade are excluded from the reveal timing;
`ui.recording.message_ack` ends when the host acknowledges a button's message. Since 0.1.98, `ui.recording.context_attach` measures the preceding context attachment round trip in milliseconds, including failed writes. Both use the active recording surface. Recording IDs, titles, ranges and context text remain local. Handled action errors use a fixed telemetry message.
`ui.recording.samples` counts samples held by the visible card, and bounded event
counts record range selections and Ask/Open actions. `storage.bytes` with
`kind: recordings` measures local saved-file storage. Recording polling is excluded
from trace sampling, and hidden cards stop polling. None of these measurements
contains device CPU/memory values, recording IDs, titles or selected intervals.

Comparison cards use the `comparison` surface and view, preserving shared
readiness, interaction, browser frame pacing and teardown coverage. Bounded
`ui.comparison.process` measures result validation, `ui.comparison.derive` covers
overlay series and whole-run summaries, and `ui.comparison.summary` covers shared
selection summaries. `ui.comparison.commit` measures the card render through its
DOM commit in milliseconds; it does not measure paint or device rendering.
`ui.comparison.message_ack` ends at host acknowledgement. Numeric gauges count
runs, CPU/memory samples, FPS samples, retained display frames and overlay rows.
Counters record range selection, run toggles and Ask actions. No recording IDs,
titles, selections or device measurements enter this telemetry. The comparison
MCP operation retains the existing sampled server trace and handled-error path.

`ui.annotations.tree_processing` measures local element processing in milliseconds, including React Native nodes when available. Since 0.1.66, normal inspection validates flat records here; server-side tree flattening falls within `ui.annotations.inspection`, which measures the MCP inspection round trip, including native accessibility and optional Metro work. `ui.annotations.runtime_available` counts snapshots with runtime elements. `ui.annotations.inspection_fallback` counts native-tool retries. `ui.annotations.inspection_truncated` counts snapshots that reach the collector's work or measurement limits. Inspection timing includes failed calls and retries. It uses the current simulator surface and the same bounded timing windows as other UI measurements. Tree contents and selected regions are not sent to Sentry.

Since 0.1.69, inspection timing also includes the bounded Metro source-map lookup. `ui.annotations.source_available` counts snapshots with at least one resolved source location; `ui.annotations.message_build` measures text construction for Send to chat. Source-map transport failures use the existing server error handler with a fixed message. Source paths, component names, creation stacks, note text and images are never sent to Sentry.

`ui.annotations.selection_context` measures the bounded hierarchy and instance lookup for a selection. `ui.annotations.context_build` measures annotation text construction for composer attachments. Both use milliseconds and the active simulator surface. These timings contain no selected nodes, React keys, labels, bounds or source paths.

Since 0.1.92, Android inspection timing also includes the full-resolution display-size read and bounds scaling. Existing inspection, fallback and tree-processing coverage stays on the active selection path. Display sizes and element bounds remain local.

Since 0.1.93, `ui.video.paint` and the platform frame counters also cover frames drawn to the local buffer while Select freezes the visible screen. These remain bounded plugin processing measurements, not device FPS. Recovery uses the same surface attribution and timing units; screenshots and element details remain local.

`ui.annotations.send` measures the host send round trip, including composer retries. Outcome counters distinguish success, a missing composer, timeout and other failures. Unexpected send failures use a fixed error message. No message content goes to Sentry. A timeout keeps notes for a manual retry; it never triggers an automatic resend, since delivery may have succeeded without acknowledgement.

Since 0.1.99, `ui.logs.foreground_change` counts automatic app-filter changes applied while Logs is active, including selected-device and process-lifetime changes. From 0.1.103, these changes update the visible query and local process identity mapping instead of restarting a scoped collector. `ui.logs.app_identity` measures batch insertion with native PID-to-app joins and discovery updates in milliseconds, using bounded aggregate windows. Hidden or closed log views defer row processing until reopened. Shared `ui.device_apps.discovery` timing and handled discovery-error coverage remain in place, including Android's foreground PID lookup; native session operations retain MCP tracing, Node runtime coverage, and `logs.ios.parse` timings. No app IDs, PIDs, package names, device IDs, or query text are attached to these measurements. Native helper telemetry and symbols are unchanged.

Since 0.1.99, `ui.logs.query_parse` measures query compilation in milliseconds once per edit, including automatic app-clause edits from 0.1.103. Existing `ui.logs.filter`, buffered/filtered row gauges, and search counts cover keyword filtering and visible age refreshes; filtering time still covers snapshot derivation and grouping. Query text, field values, regex patterns, and validation messages remain local. Age refresh timers stop when Logs closes, unmounts, or the document becomes hidden.

`ui.logs.send` measures log attachment and chat delivery in milliseconds, including queued context writes and composer retries. The existing log send counter and error coverage remain in place. No log text, stack traces or device IDs go to Sentry.

`ui.logs.session_expired` counts expired sessions that trigger automatic recovery. It uses the active Logs context without sending session IDs, error text or log content.

`ui.logs.retention` measures bounded buffer updates in milliseconds. `ui.logs.evicted` counts rows removed locally to meet the shared row and text limits; `ui.logs.dropped` still counts only rows lost from the server buffer. Existing filter timing and row gauges cover the resulting list. These measurements contain no log text or source metadata.

The React UI reports to `codex-mobile-dev-ui` (project `4512181027471440`). The main Node MCP server and the agent-device launcher report to `codex-mobile-dev-server`, distinguished by the `component` attribute. Native helpers report to `codex-mobile-dev-native`: Baguette, physical iOS mirroring, iOS FPS and logs, and Android CPU and FPS collectors. All three projects use release `mobile-dev@<plugin version>`.

The environments are `development` and `release`. `npm run build` and `npm run package` default to `development`, including local installed packages. For a public release, run `npm run build:release` followed by `npm run package:release`. Packaging rejects a build from the other environment. The package stores its environment in `dist/telemetry-environment.json`; Node telemetry, native helpers and the served UI use that setting. Live reload does not determine the environment. Set `MOBILE_DEV_ENVIRONMENT=development` or `MOBILE_DEV_ENVIRONMENT=release` in the MCP launch environment to override explicitly, then restart the MCP processes and reopen the panel.

Unhandled JavaScript errors and rejected promises, React render errors, and handled MCP tool failures produce issues. Expected stopped-device errors and cancelled operations are excluded. Sentry traces 10% of ordinary tool actions, continuing the UI trace through the MCP bridge. Frame reads, polling, discovery and pointer input are excluded from trace sampling. The SDK does not record MCP arguments or results.

Native device requests retain the ordinary sampled MCP trace. `device_picker.prepare`
measures candidate discovery/validation in milliseconds, excluding time spent waiting
for the user. `device_picker.result` counts accept, cancel, decline, unsupported and
failed outcomes; `device_picker.selected` records only the number of selected devices.
Attributes contain only the selection mode and outcome. Unexpected handled failures
use fixed messages. Device IDs/names, app labels, questions, operation details and
thumbnails are never sent to Sentry. The form is rendered by the host, so plugin UI
readiness/render timing cannot measure that surface.

Physical iOS display rejections, including an active phone or VoIP call, appear in the panel's Screen unavailable state while it retries. These expected device responses preserve native connection timing, sampled MCP traces and `ui.action.result` outcomes on the simulator surface. Their localized descriptions remain local and do not produce separate Sentry issues.

Agent Device telemetry is inactive while its MCP entry is disabled; the active Mobile Dev server and recording UI retain their existing coverage. When enabled, the Agent Device adapter measures ordinary `tools/call <command>` operations with sampled traces and continues incoming trace metadata through to the native MCP request. Discovery and session lookup are excluded from sampling. `agent_device.catalog.ready` measures catalog loading and validator compilation in milliseconds at startup. Handled native failures use static error messages so app content and tool payloads cannot enter telemetry. Node runtime and owned-storage measurements retain the `agent-device-wrapper` component. Unexpected backend disconnects replace the raw launcher's exit-code/signal report, since the SDK owns the child process lifecycle.

| Measurement | Collection and interpretation |
| --- | --- |
| Node CPU and memory | Sentry runtime metrics every 30 seconds: process CPU utilization, RSS, heap, external memory and array buffers. Each Node launcher is measured separately; the agent-device daemon is outside this coverage. |
| Native resources | `native.cpu.utilization`, `native.memory.rss` and `native.process.uptime`, sampled every 30 seconds and at startup/shutdown. CPU is a ratio where 1 is one fully occupied core. The iOS mirroring addon shares the Node process, so its resource measurements overlap Node's rather than representing another process. |
| Native operations | Bounded timing windows for connection, physical iOS input acknowledgement and video packet processing, iOS log processing, Android CPU sampling, and FPS read/processing. Filter by `component`, `runtime_platform` and `surface` to identify the responsible helper. Baguette currently records resources and crashes. |
| Node responsiveness | Automatic event-loop delay, utilization and process uptime. |
| UI responsiveness | Browser tracing captures available web vitals. Custom metrics record visible animation-frame intervals, intervals over 50 ms, Event Timing interaction durations, long tasks and long animation frames where supported. |
| Product surfaces | Metrics carry `surface=simulator`, `logs`, `performance`, `recording` or `comparison`, plus view, visible device layout and monitoring state. Log filter time, buffered/filtered rows, performance batch processing, canvas draw time and time to first video frame help explain slow surfaces. |
| Frame capture | `ui.screenshot.capture` measures synchronous canvas PNG encoding and base64 extraction in milliseconds for Select captures and physical iOS screenshots. Screenshot tools retain sampled MCP traces and report handled capture, attachment, and clipboard failures without image content. |
| Storage | Every five minutes, the agent-device launcher measures its own session state directory and the shared Apple runner cache in bytes. It skips symlinks and sends only the storage kind and size. |
| Usage | Surface views and visible time, tool action outcomes, log searches, attachments and send-to-chat actions are counted without their content. |

UI timings are aggregated into bounded 30-second windows with `.samples`, `.mean`, `.p95` and `.max`; windows also close on a surface or context change. The p95 uses a reservoir of up to 256 observations and describes that window, rather than the percentile of all measurements across users. Filter by environment, release, surface and layout to compare like workloads. `ui.frame_interval` measures browser callback pacing, not actual rendered FPS. Event Timing measures interaction duration through the next paint; `ui.device_input.round_trip` measures the device input request through its MCP acknowledgement. Neither measures device touch-to-photon latency. `ui.interaction.supported` identifies whether the browser supports that API. Codex's embedded UI does not expose reliable renderer CPU, total memory or disk measurements. Since 0.1.80, recording processing, derivation, change-density, and reveal timings include the FPS track when present. `ui.recording.fps_samples` gauges the count of saved FPS intervals, never their measured values. Since 0.1.86, `ui.recording.process` also covers parsing retained Android display frames, and `ui.recording.display_frames` gauges their count on the recording surface. Since 0.1.87, `ui.recording.derive` also includes jank classification and presentation-interval statistics. Whole-run derivation runs when recording data changes; selected-range recomputation is measured separately under the same timing name, without repeating full-run processing during a drag. Device CPU/memory/FPS and frame timestamps, tokens, jank metadata, and derived device jank/pacing values remain local and are not forwarded to Sentry. No per-frame telemetry is emitted.

Native helpers use the pinned Sentry Native 0.17.1 in-process crash backend. It captures fatal signals with stack addresses and module debug IDs; the Rust wrapper also reports task panics with a static message and source location. Crash reports are retained in a private cache and sent on the helper's next start. Host caches live under `~/Library/Caches/mobile-dev/sentry`; Android caches live under `/data/local/tmp/mobile-dev-sentry`. Android collectors relay envelopes through ADB stderr to the Node transport, preserving their stdout data protocol. Native timings use the same bounded 30-second `.samples`, `.mean`, `.p95` and `.max` windows as UI timings. iOS FPS timing covers received-counter processing; Android FPS timing includes Perfetto flush/readback. Video timing covers packet assembly and queue work, not decoding or device rendering.

Error and crash events carry only a generated anonymous `user.id` and a `telemetry_session` tag. The Node server creates one random installation ID per local OS account, stored with owner-only permissions in `~/Library/Application Support/mobile-dev/telemetry/anonymous-user-id`. It survives plugin updates, project changes, and app restarts, and is shared with the served UI and native helpers. Each MCP process creates a new random session ID; its UI panels and child helpers share that session. These are plugin server sessions, not chat or device sessions. Sentry's affected-user count therefore approximates affected installations: one person on two machines counts twice, while people sharing an OS account count once. No OpenAI account ID, email, name, IP address, device ID, or host identifier is used. IDs are excluded from performance metrics and span attributes. Stop the MCP processes and delete the identity file to reset it; telemetry opt-out creates no ID.

Session Replay, minidumps, screenshots and profiling are disabled. Requests, account details, app log content, tool payloads, automatic console breadcrumbs and exception source context are excluded. JavaScript error text redacts common tokens, identifiers, URLs, email addresses and local home paths. Native reports retain source basenames and debug IDs, omit absolute module paths, and never send Rust panic payloads. Safe product attributes and source locations remain available for diagnosis. `MOBILE_DEV_TELEMETRY=off` disables reporting across JavaScript and native helpers.

Builds generate debug IDs and source maps under the ignored `.sentry/` directory. Native rebuilds retain macOS dSYMs and unstripped Android ELF files in `.sentry/native` before stripping the bundled binaries. Symbols, source maps and the upload credential are excluded from the plugin package. Native builds require CMake and Ninja, with an Android NDK for Android collectors. The SDK source archive is pinned and checked by SHA-256. Store the organization build token in the ignored `.env.sentry-build-plugin` file at the repository root:

```dotenv
SENTRY_AUTH_TOKEN=your_org_token
SENTRY_ORG=your_organization_slug
```

That file is also listed in `.worktreeinclude` for local worktrees. Use the organization slug, rather than a team slug, for `SENTRY_ORG`. `npm run sentry:upload` reads the file in preference to shell settings, creates the shared release in all three projects, uploads JavaScript maps and native debug files, and finalizes the release. Rebuild native helpers and run `npm run build` before uploading so symbols and maps match the packaged code. Runtime reporting needs only the public DSNs; it does not need this token. Build and upload are separate commands. `npm run test:native-telemetry` verifies a real isolated crash, Rust panic privacy, metrics, opt-out and the Android relay transport against a local receiver.

### App Flow

App Flow uses the `app-flow` surface in UI and server context. The UI records
`ui.app_flow.layout`, `ui.app_flow.viewport`, `ui.app_flow.update`, and `ui.app_flow.discovery` through bounded timing windows.
`app_flow.discovery` measures server setup discovery in milliseconds. It includes
reading host roots and probing local Metro servers, with no paths, ports, process
IDs, or app identifiers in its attributes. Cancelled or hidden UI discovery does
not add a UI timing.
Since 0.1.119, `ui.app_flow.zoom` measures milliseconds from the first queued
pinch input in a frame to applying the canvas scale and scroll position. It uses
the same bounded timing windows, without an event or span per frame. It measures
plugin input handling, not device rendering or touch-to-photon latency. Existing
layout and viewport timing boundaries stay unchanged.
Since 0.1.120, flow recording reports `app_flow.recording` in milliseconds and
`app_flow.recorded_screens` as a count. `app_flow.record_frame.mean`, `.p95`, and
`.max` measure screenshot capture, verification, and saving after a view settles.
They include failed attempts. These bounded metrics and existing checkpoint
metrics use the `app-flow` surface and device platform. Flow names, headings,
component identities, view signatures, input values, and screenshots remain local.
Recording does not add a trace or event per observation. Existing route capture
metrics keep their prior boundaries; route counts exclude recorded local forms.
`ui.app_flow.visible_nodes` records the number of cards mounted near the viewport.
Hidden tabs stop polling, and responses from an earlier surface do not add timings
to the current one. `mobile_read_app_flow` is excluded from frequent-tool traces.

Capture attempts use a bounded timing window and report
`app_flow.capture.mean`, `.p95`, and `.max` in milliseconds. Each run reports `app_flow.scan` and `app_flow.run` in milliseconds and gauges for
`app_flow.routes` and `app_flow.captured`. Run duration measures elapsed time through
capture, navigation restoration, and pending image writes, with no total time cap.
Since 0.1.113, route and capture counts describe unique reachable screens; repeated
navigator registrations no longer inflate either count. Capture timing includes
route readiness, one native preview, and route verification. Unchanged native frames
may require another read. Failed attempts include recovery time. Empty native bodies
are rejected before saving; frame validation adds no image data to telemetry.
These measure plugin work and coverage, not device rendering performance.
Attributes contain only the surface and device platform.
Since 0.1.115, `app_flow.scan` also covers symbolic URL reads, re-export and lazy
import resolution, and parameter alternatives within the same scan boundary.
Source evidence stays in the local graph and audit files; it adds no telemetry
attributes. Repeated navigation edges collapse before runtime reachability checks.
Since 0.1.134, `app_flow.scan` also includes the source catalog for reducer steps,
shared hook/context state and guarded render bodies. `app_flow.source_catalog`
measures that part in milliseconds; `app_flow.source_candidates` counts render
facts, including inline UI, and does not measure reachable or captured screens.
Both retain the app-flow surface and platform attributes. The catalog saves once
in a separate local file and stays out of canvas polling and runtime injection.
Existing checkpoint timings still cover active map writes. Source, guards, state
values, paths and controller identities remain local and never become metric
attributes.
Since 0.1.135, `app_flow.source_catalog` also includes compiling finite UI preview
plans. `app_flow.preview_plans` counts those plans before live binding; it does not
measure successful screenshots. `app_flow.previews_captured` and
`app_flow.previews_blocked` count temporary preview nodes at the end of a run.
Existing presentation counts include those nodes. Binding, discovery, capture and
readiness timings cover the new reducer/shared-state path with their prior units
and boundaries. The full source catalog still stays out of runtime injection;
only compact plans enter the runtime. All new metrics use the app-flow surface and
platform attributes. Source hashes, fact IDs, state fields and copied app data stay
local and never enter telemetry.
Since 0.1.136, `app_flow.runtime.mean`, `.p95`, and `.max` measure inspector
command round trips in milliseconds, from send to reply or failure.
`app_flow.runtime.timeouts` counts commands that reached their timeout. Bounded
windows flush and clear when each connection closes. The fixed
`runtime_operation` attribute separates binding, discovery, readiness and
restoration; unknown commands use `other`. Metrics retain the app-flow surface
and device platform. Commands, source, app data, paths and identities stay local.
Presentation discovery builds one tree and hook-value lookup per synchronous
check. Existing discovery and capture metrics still cover the same work.
Since 0.1.137, injected hook, effect and native event wrappers bind their original
functions in separate function scopes for Hermes compatibility. Existing binding,
discovery, readiness, runtime and capture measurements retain their boundaries
and cleanup. This fix adds no telemetry fields or per-hook events.
Since 0.1.139, runtime timing also records Metro source resolution under the fixed
`presentation-symbolicate` operation. Existing command, binding, discovery,
capture and readiness measurements keep their units and boundaries through
catalog reuse and discovery retries. Saved discovery errors and bounded exception
details stay local; telemetry reports only fixed errors and operation names.
Collection cancellation releases its wait and restores hook exports. No app data,
source, view IDs or failure details enter metrics or error events.
Since 0.1.143, saved maps also keep numeric command totals across reconnects for
local diagnosis. These totals do not change Sentry's per-connection bounded
timing windows or flushes. The fixed `diagnostics` operation measures a requested
inspector count read; its result stays local. Readiness and presentation timings
still include the full check after plain-host and unrelated-owner layout reads
are skipped. Host/content counts now describe the readiness sample, rather than
all visible hosts. Those counts are not telemetry measurements.
Since 0.1.144, local diagnostics also separate the latest readiness check's tree
count, native layout reads/time and opacity reads. They include unique JSX source
and live-instance counts, plus the last hook render count. These fixed numeric
results stay local. Existing runtime, binding, discovery and readiness metrics
still measure the active paths after source deduplication and exact owner lookup.
Names, units, surface attribution and cleanup stay unchanged.

Since 0.1.145, `screenshot` is a fixed runtime timing operation. It measures
fetching and validating a device PNG, including failed attempts. It excludes
React readiness and screenshot comparison. The existing bounded runtime windows,
units and flushes apply. Screenshot errors keep bounded local evidence in the map;
telemetry receives only operation names, timings and timeout counts.
Local presentation diagnostics show stage durations and readiness flags, with a
fixed reason such as loading, transition or paint. They contain no app content.
Shared presentation indexes and detached observer cleanup preserve the existing
binding, discovery and readiness measurement boundaries. No per-frame events
or new user dimensions enter telemetry.

Since 0.1.146, committed-tree caching and controller opener checks retain the
existing runtime, binding, discovery and readiness timing boundaries. Native
bounds, hook values and animation inputs remain fresh per check. Missing commit
observers fall back to tree walks. The initialized RN LogBox observer forwards
no log data and unsubscribes on cleanup. Existing fixed capture-failure reporting
covers visible error overlays; no per-commit telemetry events are added.

Since 0.1.140, presentation lookup rejects absent source-bound entries before
checking native layout and shares native bounds within one synchronous lookup.
The existing `presentations` runtime round trip and presentation discovery
timings still cover that work. Measurement names, units, surface attribution
and cleanup stay unchanged; no new app data or per-view events are collected.
Since 0.1.116, discovery reuses route matches and complete helper/component walks
within each scan. PNG validation selects its filter once per row, and runtime
lookups stop once they find the focused screen or first native bounds. Existing
scan, capture, and readiness timings still cover these paths with the same units
and boundaries. Loading checks, image sampling, and retries are unchanged.
Since 0.1.117, `app_flow.reconnect.mean`, `.p95`, and `.max` report elapsed
reconnection time in milliseconds, including retry backoff and recovery.
`app_flow.reconnects` counts reconnect episodes per run. Both use the existing
surface/platform attributes and omit target identities and connection errors.
Capture timing includes reconnection when an attempt loses its connection.
The canvas renders one edge per screen pair, with both cards mounted. Layout
and viewport timings retain their boundaries. Progress lists captured, queued,
and discovered screens separately because live discovery can add work.
Since 0.1.118, `app_flow.retries` counts additional capture attempts per capture
session. `app_flow.checkpoint.mean`, `.p95`, and `.max` measure atomic local
snapshot writes in milliseconds. They use the same surface/platform attributes;
saved route data and resolutions never enter telemetry. Capture and readiness
metrics include each retry with unchanged boundaries. A continued saved map
reports a new capture session. The UI adds capture time across sessions and
excludes the idle time between them.
Saved maps, setup, and bounded AI context now use private local files so panel
and model MCP processes share the same run. AI replies use a durable queue;
a device lease prevents concurrent capture. Idle open panels check for updates
every two seconds; hidden panels still stop polling.
Since 0.1.114, `app_flow.readiness.mean`, `.p95`, and `.max` measure the time from
navigation dispatch to a ready or timed-out screen. `app_flow.loading.mean`,
`.p95`, and `.max` measure the portion spent observing visible loading signals.
Both use bounded windows, milliseconds, and the same attributes as capture timing.
Readiness considers visible skeletons, busy states, Suspense fallbacks, initial
query loads, transitions, a short quiet period, and two animation frames.
Cached background fetches and inactive pager pages do not hold up capture.
Since 0.1.122, page-level active flags also exclude hidden native pager content
from readiness and loading checks. Both metrics retain their existing boundaries
and units. No component names or new per-observation events are collected.
Since 0.1.123, readiness includes visible animated opacity changes. Capture timing
includes any in-place screenshots needed when a fade starts during capture. Both
keep their existing boundaries and units. Bounded animation samples stay in the
local runtime; their values and source identities do not enter telemetry.
Detected loading gets up to six seconds on the first attempt and ten on retry;
ready screens finish as soon as the checks pass. These are per-screen limits.
Custom loaders without recognizable signals may still need app instrumentation.
Route names, params, source paths, app data, and screenshots stay out of telemetry.
Errors use fixed descriptions. Existing initialization, identity, sampling,
scrubbing, release metadata, and opt-out remain in use.

Since 0.1.125, `app_flow.scan` includes the generic presentation source pass.
Route counts still describe routes; automatic local forms and sheets use
`app_flow.presentations` and `app_flow.presentations_captured`.
`app_flow.presentation.mean`, `.p95`, and `.max` measure a presentation branch in
milliseconds, including nested capture and restoration. `app_flow.presentation_binding`
uses the same statistics and units for hook collection and Metro symbolication.
Both use bounded windows and the existing surface/platform attributes. Source
locations, UI state values, event arguments, controller identities, and previews
stay local. Native lifecycle observers and temporary React hook wrappers restore
on cleanup; no event or span is sent per poll or animation sample.
Readiness signatures exclude native content outside the captured viewport, so
offscreen list batches do not extend the wait. Native motion bounds clip to that
viewport. Existing readiness and capture timings retain their units and boundaries;
these checks still wait for visible loaders and motion.

Since 0.1.126, `app_flow.presentation_binding` also covers JSX entry collection
and source checks that distinguish components with the same name. It keeps the
same bounded windows, millisecond units and surface/platform attributes. The
runtime caches checked entries and clears their records on cleanup. Creation
stacks, paths and source locations stay local.

Since 0.1.127, presentations share the route queue. Each
`app_flow.presentation` sample measures one attempt, including entry-chain
replay, readiness, capture, child discovery and restoration. It no longer
includes nested captures or several retries in one sample. The units and
surface/platform attributes stay unchanged. `app_flow.presentation_discovery`
uses bounded `.mean`, `.p95` and `.max` windows in milliseconds for source binding,
live entry checks and queue updates. Existing binding measurements still cover
source checks. Route capture and readiness boundaries stay unchanged; retries
now count additional presentation attempts too. No app data enters telemetry.

Since 0.1.128, runtime inspection refreshes detached navigators after local
forms remount them. Capture timing includes that lookup. Readiness still starts
at navigation dispatch; units, attributes and boundaries stay unchanged.

Since 0.1.129, temporary previews retain the full live provider chain and catch
render errors before they can unmount the app. Handled preview failures send a
fixed error with operation `app_flow.presentation`, without the app's error
message or component data. Existing capture and discovery timings cover preview
creation and cleanup with the same units and attributes.

Since 0.1.130, preview insertion preserves single and array root children so
the app's existing navigator stays mounted. Existing presentation timings still
include insertion and restoration; their meaning and attributes stay unchanged.

Since 0.1.131, source binding recollects hooks when a returning owner has lost
its mounted binding records. `app_flow.presentation_binding` and discovery
timings cover that work with unchanged boundaries, units and attributes.

Since 0.1.132, preview root lookup uses the target's mounted ancestor tree so
unrelated React roots cannot receive a preview. Existing presentation timings
cover the lookup with unchanged units, attributes and boundaries.

Since 0.1.133, hook-owner lookup uses one mounted-tree pass, binding pages share
one collection snapshot, and Metro resolves each distinct source frame once per
setup. `app_flow.presentation_binding` and discovery timings still include the
full source check with the same bounded windows, units and attributes. Source
matches retain each entry's stack order. No source data enters telemetry.

Since 0.1.147, related presentation attempts reuse a verified open parent. Existing
`app_flow.presentation` samples still measure each attempt's actual replay or
reuse, readiness, capture, discovery and immediate cleanup in milliseconds.
Restoration deferred until route work or the end of a branch now has its own
bounded `app_flow.presentation_restoration.mean`, `.p95` and `.max` window; it is
not added as a separate short sample to the attempt window. Runtime command
metrics still include each checkpoint read and rollback. Surface and platform
attributes stay unchanged. Caught temporary preview failures report a fixed
`app_flow.presentation` error without app messages, inputs or component data.
Root handlers forward all other errors and detach preview records on cleanup.

Since 0.1.148, source catalog timing includes optional-prop owner mount plans.
Presentation timing includes exact initialized export lookup, temporary mounting
and the same readiness and screenshot checks. Route command timing includes
rebinding the current mounted navigator before dispatch. Existing metric names,
units, surface attributes and bounded windows stay unchanged. Export identities,
provider values, app data and source paths stay local.


Since 0.1.149, presentation rollback waits for the native close event before it
releases a child checkpoint or unmounts a parent. Existing presentation and
`app_flow.presentation_restoration` windows include that wait in milliseconds.
Runtime rollback failures identify the same fixed operation name. Reconnect
closes presentations before route recovery. No event payload, app state or source
path enters telemetry; native observer and preview cleanup remain bounded.

Since 0.1.150, native lifecycle observation prefers the Fabric host when a class
adapter holds cached event props. Local diagnostics count host observers, pending
host events and dismissal waiters, and use the new inspector while reconnect
cleanup is pending. These bounded counts contain no app content. Existing runtime,
presentation, reconnect and restoration measurements keep their names, units and
boundaries; no new per-event telemetry is sent.

Since 0.1.151, runtime and manifest versions must match before a build starts.
Controller aliases share one open/close checkpoint; their source bindings stay
local and refer to the same captured body. Temporary iOS modals hide while mounted,
wait for onDismiss, then unmount. Existing presentation, restoration and runtime
measurements cover these active paths with the same names, units and privacy rules.

Since 0.1.152, native observation releases detached idle records and gives dispatch
hosts priority within its existing bound. Dismissal waits exclude unopened child
sheets. Finite UI selectors no longer depend on field spelling. Existing
presentation, restoration, discovery and runtime timings cover these paths with
the same names, milliseconds and privacy rules; no app content enters telemetry.

Since 0.1.153, source-verified temporary portal children render inside the existing
preview modal. The new fixed `presentation-portals` operation measures its
inspector acknowledgement in milliseconds. `presentation-symbolicate` also
covers portal source verification; it keeps the same unit and local-source
boundary. Overall presentation capture still includes source verification, native
readiness and screenshot work. Existing command timings keep their boundaries.
Portal binding stacks, source, copied context and child content stay local and
never enter metrics or Sentry attributes. Cleanup releases portal bindings and
previews with their parent projection.

Since 0.1.154, restoration releases previews and native waiters that leave the
committed React tree. It keeps waits for live portal bodies and preserves the
app's new children after an external unmount. Existing presentation, command and
resource measurement boundaries remain unchanged. Local diagnostics add bounded
counts for detached, closing, shown and dismissed projections. Rollback failures
retain their cause only in local diagnostics; Sentry still receives fixed error
messages and operation names, with no app data or source.

Since 0.1.155, controller capture follows the exact forwarded control reference
to one child body. Independent sibling sheets no longer share native readiness
or dismissal waits. Explicitly hidden, unopened modals do not start those waits.
Existing presentation capture, restoration and command timings measure the active
path with unchanged names, units and boundaries. Resource sampling still measures
the app process. Controller references, props, native events and source evidence
stay local and never enter metrics or Sentry. Observer cleanup and native
dismissal regression tests cover the narrower scope.

Since 0.1.156, nested temporary form steps share one shown preview modal. Back
restores the prior copied body and finite hook state before the outer modal
closes. Existing presentation, restoration and runtime timing windows cover
this path with unchanged names, milliseconds and boundaries. App memory
sampling still measures the app process. Copied state, props, source evidence
and native lifecycle events stay local. No per-step telemetry was added.

Since 0.1.157, every temporary projection contains effects and imperative handles.
Only refs created by the preview's own `useRef` may receive its imperative handles;
shared app refs and callback refs remain untouched. Existing presentation,
restoration and runtime timing windows keep their names, milliseconds and
boundaries. The local diagnostic count `containedImperativeHandles` records
suppressed handle registrations and resets on cleanup. Ref values, callbacks,
props and source evidence never enter telemetry. Real React tests cover local
controls, shared refs, nested projections and hook cleanup in normal and shared
loop execution.

Since 0.1.158, the existing App Flow command timing windows also cover the fixed
`context-data` operation. It reads a bounded snapshot of already cached app data
only when AI context is requested. Timing units and boundaries stay the same;
query records, route params and cache keys remain local and are never telemetry
attributes. Presentation cancellation uses the existing restoration timing and
timeout coverage.


Since 0.1.159, native observation and readiness share committed tree metadata.
Native bounds and lifecycle events still update on each read or event. Existing
presentation, restoration and command timing windows keep their names, units
and boundaries. They also cover a single close retry after a late native open
that has no closing acknowledgement. Close request, retry and acknowledgement
counts remain local diagnostics; no event payload or controller data enters
telemetry. Source catalog timing includes ranking preview bodies by unresolved
guards, with the same capture destinations and source evidence.

Source catalog timing also covers choosing among render sites for a finite UI
selector. The catalog keeps list callbacks separate from form owners. Existing
scan and preview-plan measurements keep their units and boundaries; source
locations, state values and component data remain local.

Controller ownership checks and callback owner selection stay inside the source
catalog timing. Local diagnostics add bounded route and stack counts to compare
navigation retention with mounted React tree growth. They return no route names,
params or app content and do not add telemetry fields.

Presentation binding passes also reuse the committed tree structure when React
has not committed a change. Hook and entry matches still update for each source
binding pass, and native bounds remain live. Existing binding and discovery
measurements include this work with the same boundaries and units.

Initialized Metro export lookup accepts relative paths and absolute paths under
the selected project root. Binding and preview-open timings still include this
lookup with the same units and boundaries. Module paths and exports stay local.

Source catalog timing also covers rejecting progress-only preview branches.
Their source evidence stays available. The existing scan and preview-plan
measurements keep their names, units and boundaries; conditions stay local.

Custom hook consumer matching keeps the consumer module separate from the hook
module. Existing binding timings include this lookup. Local diagnostics separate
exact and fallback scheduled updates; source paths remain local.

Cached native class lifecycle callbacks now share completion state with hosts
that forward those same callbacks. Tracking keeps each callback stable through
props commits and restores its original descriptor during cleanup. Native open
and dismissal checks still wait for real events. The existing App Flow
restoration and binding timings keep their names, milliseconds and boundaries.
The local callback count helps distinguish missing listeners from a slow native
transition; no callback, event, class identity or app props enter Sentry.

Source-bound controller lookup now starts from the matched source instances. It
keeps the existing ambiguity and visibility checks. Sibling sheet captures can
reuse a route only after native restoration and a fresh matching base view.
Existing presentation, binding, discovery and restoration timings include these
paths with the same names, units and boundaries. View signatures and source
entries remain local; this change adds no telemetry attributes.

Temporary previews contain useSyncExternalStore subscriptions as well as public
effects. They still read the real store snapshot, and original app subscriptions
keep running. The bounded local diagnostics include the contained subscription
count. Existing preview-open, binding and restoration timings cover setup and
cleanup; snapshot data, callbacks and stores never enter telemetry.

Private hook owners can now bind their JSX creation source before runtime forces
a render. Presentation setup includes up to two source-binding passes, first
for owner identity and then for its hook sites. Existing setup and command
timings include both passes. Their names, units and enclosing boundaries stay
the same; per-command counts can rise because setup now verifies private owners
first. Source locations and component identities remain local.

Since 0.1.164, temporary forms can reuse a real settled TanStack Query result
when its exact cache entry, current cache state, selection, placeholder, enabled
condition and remaining data/status fields still agree. The mapper keeps at most
200 entries with four representations each, releases them on runtime cleanup,
and restores the original framework method. It does not fetch, subscribe, write
the cache or invent a request result. Existing presentation setup, readiness,
capture and restoration timing windows include this work with the same names
and units. Snapshot count and reuse count are local diagnostics only. Query
keys, values, methods, IDs and source paths remain inside the app runtime and
never enter telemetry.

Since 0.1.165, query tracking also reads the initialized TanStack CommonJS
observer export. The existing setup and command timing boundaries include this
read. Observer patch count joins snapshot and reuse counts in local diagnostics
only; no module names, exports or query data enter telemetry. Cleanup retains the
same method ownership checks and releases the observer patches.

Since 0.1.166, presentation setup can read existing TanStack Query observers
from a mounted client's cache. This includes results loaded before mapping and
works without a Metro observer export. Known library prototype read methods
supply the actual result; the mapper adds no fetch, subscription, callback or
cache write. Existing setup, readiness, capture and restoration timings include
this path with the same names and units. Bounds and owned-method cleanup remain
in place. Client/cache/observer counts and bounded constructor names stay in
local diagnostics only, clear on cleanup, and never enter telemetry.

Since 0.1.167, a contained temporary form can reuse the actual settled observer
result when only TanStack's unstarted mount-fetch prediction differs. The
current query must remain successful and idle, its observer must still be
attached, and its current result, selection, placeholder, enabled condition,
staleness and mount options must match. The mapper returns the library's real
result object and adds no request, subscription, cache write or invented flag.
Existing setup, readiness, capture and restoration windows retain their names,
units and boundaries. Preview query reads and rejection counts stay local, clear
on cleanup, and never enter telemetry. Query values and observer references
remain inside the app runtime.

Since 0.1.168, temporary preview insertion preserves React's child level when
the app root uses an unkeyed Fragment. Existing presentation setup, readiness,
capture and restoration timings keep their names, units and boundaries. The
local diagnostic count `preservedRootFragments` counts preview insertions that
keep this child level and clears on cleanup. It contains no app data and does
not enter telemetry. Source catalog timing also covers exported guard-page
preview plans above navigators; these plans never change account conditions.


App Flow shares native bounds between content and motion inspection within one
synchronous readiness check. Each later check reads fresh native bounds. Existing
readiness, capture and restoration timing names, units and boundaries remain
unchanged. Local visual-probe layout-read counts still count actual native reads
in content inspection; motion inspection can reuse those reads. No native host
references or app content enter telemetry or tool results.

Presentation metadata skips branches marked inactive by the existing navigation
visibility predicate. A focus commit rebuilds the metadata before inspecting that
branch. Collection and readiness timings keep their existing boundaries and units.
Mount availability counts are bounded local diagnostics only; they contain no
source paths, component names, app data or telemetry fields.

App Flow keeps the existing readiness, capture and restoration timings for
source-bound UI opening effects. `app_flow.runtime` also measures
`presentation-effects`, including the real opening callback and its render
wait. Local diagnostics count approved UI openings, live query reuse with
recreated selectors, and registered but unloaded form modules. These counts,
source locations, callback bodies and app data do not enter telemetry. Timer
cleanup runs when a preview closes or the inspector shuts down.

Readiness polls also bind source-proven portals that mount after the opening
reply. Existing presentation, symbolication, readiness and restoration timing
windows cover this work with the same names, units and boundaries. Native
dismissal diagnostics list at most eight pending hosts or adapters. These names
and lifecycle counts stay local and never enter telemetry.

Since 0.1.172, related-view traversal also follows portals inside a temporary
React copy. The existing presentation, readiness, native motion and restoration
timings measure this path with the same names, units and boundaries. No new
per-frame events or app data enter telemetry.

Since 0.1.173, idle class sheet adapters do not predict native opening events.
New dispatch hosts connected to an opening control still wait for their real
lifecycle events. Existing readiness, native motion and restoration timings
cover these waits with unchanged names, units and boundaries. No app callback
names or data enter telemetry.

Since 0.1.174, preview readiness and child discovery use the exact temporary
component and its connected portal bodies. The original component remains part
of native ownership and restoration. Existing discovery, readiness, capture and
restoration timings retain their names, units and boundaries; this change sends
no new app data.

Since 0.1.175, reopening a focused stack route with unchanged data parameters
keeps the mounted route. Loading, native transition, paint and screenshot checks
still run. Existing open, readiness, capture and restoration timings retain their
names, units and boundaries. Bounded native lifecycle evidence stays in local
App Flow diagnostics; component names, events and app data do not go to Sentry.

Since 0.1.176, temporary previews attach to the nearest native View, so a sheet
can present its child window. Nested preview steps reuse the shown window.
Existing presentation, readiness, capture and restoration timings cover this
path with unchanged names, units and boundaries. Native waits still require
real lifecycle events. No new app content or callback data enters Sentry.

Since 0.1.177, finite preview readiness uses the target's exact JSX source when
available, including entries created after the preview mounts. Existing binding,
readiness, capture and restoration timings cover this path with the same names
and units. Capture still checks loading, native lifecycle, paint and motion.
Native screenshot transport failures get one backend recovery and an in-place
retry within the original capture deadline. The existing screenshot timing now
includes recovery when needed. `app_flow.screenshot.recoveries` counts those
attempts by app-flow surface and device platform. Neither this counter nor the
existing timings send paths, source locations, app content or device identities.

### Instrumented App Flow capture

The opt-in in-app queue preserves `app_flow.capture` attempt durations and the
native `screenshot` operation timing, including screenshot connection recovery.
`app_flow.runtime` adds fixed operation labels `capture-inventory`,
`capture-start`, `capture-ack`, `capture-stop`, and `capture-prepare`. These measure
binding inventory, batch dispatch, frame acknowledgement, restoration and saved
plan preparation in milliseconds. `app_flow.build_prepare` measures scanning and
writing the reversible development build setup. Attributes remain surface and
platform only. No job IDs, source paths, props, params, image bytes or app errors
enter these metrics. Existing server error scrubbing still applies.

The instrumented path replaces per-view inspector polling and symbolication with
in-app readiness probes and frame events. Those removed operations emit no fake
zero samples. Native lifecycle and motion checks remain active. Local run data
records `preparationMs`, `manifestTotal`, and the capture mode; these are not app
memory or FPS measurements. The client registry releases committed owners on
unmount, and the queue releases timers, listeners and pending frame replies on
completion or cancellation.

Capture compatibility fixes preserve these timing boundaries. Readiness failures
now name the local blocker, and packaged runtime tests exercise compiled async
closures. These diagnostic messages stay in local run results; they add no metric
attributes or app-content telemetry.

App Flow can reuse one source catalog after re-reading and hashing the current
source files and TypeScript aliases. `app_flow.scan` still measures the whole
scan request, including file validation and cloning a cached result.
`app_flow.source_catalog` is zero on reuse because that request builds no catalog.
The cache holds at most 24 MB of serialized source facts, never live app state,
and sends no paths, hashes or source text to telemetry.

The default discovery capture path also waits for presentation readiness inside
the app. `app_flow.runtime` samples for `presentation-view` now include that wait
when requested, instead of measuring each probe as a separate debugger round
trip. Presentation and capture timings still include the full wait. Native
lifecycle, loading, motion and paint checks remain active.

`ui.app_flow.image_cache_bytes` estimates retained canvas image memory: thumbnail
pixels at four bytes per pixel plus data URL strings at two bytes per character.
It excludes temporary decode buffers, the browser's other memory, and the mobile
app. The cache has a 64 MiB ceiling and only keeps images near the viewport. This
gauge uses the active `app-flow` surface, never screenshot identifiers or content.

`ui.bridge.pending_signals` counts request cancellation listeners still attached
to stream/session signals. Completed, failed and cancelled requests remove them.
The gauge tracks plugin bridge work, not device memory. Existing stream timing
and error coverage remains on the same calls; hidden simulator panels close
their streams and resume when shown.

App Flow still measures full capture, discovery, binding and restoration time
when it reuses a settled route or parent sheet. It checks the live view and native
checkpoint before reuse. Runtime heartbeat counts now exclude checks made
redundant by recent command replies. Local diagnostics report `transitionModules`
and `transitionOptions` for temporary React Navigation animation overrides.
These counters contain no app data. Loading and native dismissal checks remain
active, and stopping or the runtime watchdog restores the framework exports.

Since 0.1.181, `recover` settles the current navigator without reopening and
measuring the starting screen. The next capture still checks its target's
content, motion and native paint. Runtime and reconnect timing boundaries and
units stay unchanged. `app_flow.recovery_continuations` counts slow recovery
commands after which the same inspector answers a heartbeat and continues;
these no longer count as reconnects. The count flushes once per run with the
existing surface and platform attributes. It contains no app data.

Prepared development builds can now run the same capture runtime from Metro's
compiled app bundle. Runtime command, capture, readiness, binding, recovery and
restoration timings keep their existing boundaries and units. A content
fingerprint selects only the matching runtime; older builds use the debugger
fallback. Local diagnostics report `execution` as `compiled` or `debugger`. The
fingerprint stays local and adds no metric attributes. This change starts no
extra observer or timer; both paths use the same lease and cleanup.

Image observers now retain load events while a native tab stays mounted but
hidden, and release them on unmount or cleanup. Local `imageObservers` and
`pendingImages` counts help check retention; they contain no image sources.
A capture can reuse navigation's paint proof after a fresh matching content and
motion probe. Capture durations still include all work that actually ran.

Prepared previews retain provider values locally and contain render failures only
from their exact temporary boundary. Existing capture duration and
`app_flow.previews_blocked` counts cover failures on this path. App root errors
still reach the original handler. Preview cleanup restores that handler and
releases its context references; no provider values or error text enter telemetry.

Since 0.1.183, `app_flow.recovery_continuations` also counts native sheet cleanup
that succeeds on the existing inspector after a failed cleanup command. These
retries do not increment reconnect counts. Runtime rollback and readiness
measurements retain their names, units and boundaries. Reusing changed parent
content still measures fresh route checks and screenshot verification. Route
parameters and the matching proof remain local; no new telemetry attributes or
per-frame events were added.
