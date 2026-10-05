# Sentry observability

[Back to README](../README.md) · [Contributing](../CONTRIBUTING.md)

Since 0.1.132, `plugin.update.operations` counts release checks and installations
by fixed operation and outcome, and `plugin.update.duration` measures their
duration in milliseconds. Cache hits emit no extra measurement. These measure
plugin work and do not attach device context, version strings, GitHub responses,
CLI output, paths, or profile details. Offline checks count as unavailable;
installation failures report a fixed error message. The existing MCP wrapper
preserves sampled UI/server tracing and action outcomes on the active workspace
surface. UI counters record successful updates and dismissed banners without
release details. All collection honors telemetry opt-out.

Since 0.1.129, discovery command failures retain bounded `discovery_command`, `discovery_cause`,
`discovery_termination`, and optional `discovery_signal` tags. Failed exception
contexts contain only numeric `elapsed_ms`, `deadline_ms`, and an optional exit
status from 0 to 255. Command identifiers are fixed product enums. Foreground
helpers emit a versioned, strictly validated error-code record on stderr;
connection, service opening, query, response, and cleanup failures stay distinct.
Helper-owned timeouts count as timeouts even when the helper exits with status 1.
Parent deadlines, explicit cancellation, native signals, missing executables, and
output limits retain separate classifications. Known simctl/ADB lifecycle text
is classified locally into fixed causes; text never enters these diagnostics.

The existing discovery stage/failure tags, exception-text and Node system-error
scrubbing, anonymous error attribution, telemetry opt-out, UI discovery metrics,
and trace exclusions remain. Server episode signatures and error fingerprints
also distinguish command/cause; numeric timing and exit status do not become
metric attributes, episode keys, or grouping dimensions. This diagnostic change
preserves command deadlines, retry intervals, and discovery concurrency. Native
Baguette and iOS FPS helpers are rebuilt with matching debug symbols; their
shared Sentry initialization and aggregate measurements remain unchanged.

Since 0.1.128, MCP resource failures retain one original handler exception. Resource
callbacks normalize thrown values and classify aborted reads before the Sentry
SDK observes them. A request-scoped reporting flag excludes the generated
JSON-RPC exception only after that same request's failure has been accounted
for. Unowned protocol failures and transport failures remain reportable. Guarded
tools retain their original server capture and `isError` response semantics.

Expected outcomes are classified at their source with bounded typed reasons:
session expiry/explicit closure, unavailable or unauthorized devices, explicit
unsupported platform checks, and invalid user/resource input. The shared
`beforeSend` also applies this classification to automatic SDK captures. Existing
AbortError exclusions remain. Backend response validation, startup failures,
missing bundled dependencies, active-operation timeouts, and collector crashes
are not suppressed by these classifications. UI stream opening now carries the
reconnect abort signal; cancellation without an aborted operation and host
“thread not found” failures remain reportable.
Cancelled stream requests close sessions that finish opening after cancellation
or before a discarded response. Unexpected cleanup failures retain their own
`stream.cancel_cleanup` capture. Response delivery releases cancellation ownership;
failed response delivery closes its undelivered session. Physical iOS mirror startup now also captures
unexpected server errors before returning the existing visible failure.

Server discovery failures no longer create a second generic UI exception. The
UI retains its visible error, `ui.device_apps.discovery_failure` counts, and
`ui.device_apps.discovery` timing, and reports its own transport/response defects
with bounded classification and a fixed message. Server discovery and UI-only
discovery failures report once per continuous failure signature. Each local
failure table holds at most 64 entries and starts a new episode after success,
a signature change, or five minutes without a failure. UI selection/visibility
changes also reset their discovery episode. Stream-opening transport retries
share an episode only within the same reconnect abort signal. Device/session
keys and signature strings stay local and never enter Sentry payloads.

`server.error.outcome` counts expected and unexpected outcomes; its operation,
outcome and optional discovery attributes are bounded product classifications.
`server.error.repeated`, `ui.device_apps.discovery_repeated`, and
`ui.stream.open_repeated` count failures omitted from exception reporting.
`ui.operation.expected.<reason>` counts UI lifecycle outcomes. These counters use
the existing SDK/UI aggregate collection. `ui.action.result` now also counts
rejected calls and explicit cancellation, using the request's starting context.
Error fingerprints extend default stack grouping with operation, bounded error
category, resource kind, and available discovery stage/failure. Anonymous IDs
are excluded from grouping and metrics. UI SDK consecutive-event deduplication
is replaced by explicit episode ownership so recovery and separate operations
can report the same exception shape again. Existing scrubbing, installation
attribution, opt-out, release/environment metadata, trace propagation, frequent
trace exclusions, and performance measurement boundaries are unchanged. No
native telemetry or symbols change in this reporting work.

Since 0.1.113, failed screenshot attachments display a panel notice instead of
failing silently. Existing `screenshot.attach` error capture retains the original
exception and operation, and screenshot-capture measurements keep their current
boundaries. Image data and host error details are not added to telemetry. This
changes failure feedback; it does not resolve the host image-validator overflow.

Since 0.1.112, discovery errors carry bounded `discovery_stage` and
`discovery_failure` tags alongside device platform and kind. Stages distinguish
device validation, running-app enumeration, foreground lookup, generic discovery,
UI transport, and response validation. Failures distinguish missing executables,
timeouts, command failures, invalid responses, cancellation, and unknown errors.
The server annotates the original error without copying its command or output;
strict enum metadata carries the classification to the UI. Existing exception
scrubbing, cancellation exclusions, discovery timing windows, failure counts,
and frequent-tool trace exclusions remain. No app lists, device IDs, command
arguments, output, or error payloads are added to telemetry. Historical command
failures are not considered resolved by this diagnostic change.

Since 0.1.111, physical iOS log-session shutdown cancels pending device discovery
and its subprocess. Existing MCP operation timing and bounded iOS parsing
measurements keep their boundaries; cancelled discovery produces no reconnect
error and starts no reader. The UI cleanup deadline remains five seconds.

Since 0.1.110, JavaScript error scrubbing removes the automatic Node system-error
context. This prevents child-process command arguments, device identifiers, local
paths, and command output from bypassing exception-text scrubbing. Error messages,
source locations, anonymous attribution, and existing performance measurements
retain their collection boundaries.

Version 0.1.108 corrects the compatibility manifest's working directory so the
launcher and existing server telemetry can start. It changes no telemetry
boundaries or collection. The Codex installation smoke check verifies the
resolved launch configuration and telemetry opt-out in the sidebar resource.

Since 0.1.121, MCP discovery and runtime directly use Codex's bundled Node from
its workspace dependency cache. The existing centralized Sentry initialization,
anonymous attribution, build environment, opt-out, runtime metrics, and MCP
traces remain on the same server path, with telemetry opt-out explicitly
forwarded by the MCP manifest. Launcher failures occur before the server SDK
starts and are available in desktop startup logs. The Mobile Dev and setup
skills inspect startup failures when tools are missing; those diagnostics stay
local and do not send host logs, paths, or tool inventories to Sentry.

Since 0.1.101, `logs.ios.parse` measures Node-side iOS record parsing, default system-noise filtering, and conversion in milliseconds before buffering. Bounded 30-second windows report sample count, mean, P95, and maximum; shutdown flushes the remaining window and stops its timer. Measurements use the `logs` surface and iOS simulator/physical kind, with no log content, subsystem names, sender paths, device IDs, or filter text. Existing UI query/filter timings, Node runtime coverage, and physical helper `native.logs.process` timings retain their boundaries. The rebuilt physical helper emits sender image paths locally for framework filtering and retains matching native symbols. The expanded subsystem families and dot-separated child matching in 0.1.114 remain inside this same measurement boundary; metric names, units, attribution, and cleanup are unchanged.

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

Baguette startup, input repair, simulator foreground detection and physical iOS
bezel rendering discover required Swift compatibility libraries
from the host's selected full Xcode installation before launching the native
helper. Existing sampled MCP traces and UI app-discovery timings include discovery;
handled failures retain their tool error paths. Setup failures use fixed messages without
developer directories or scanner output. Native telemetry initialization and
matching dSYMs are preserved; rebuilds remove build-toolchain rpaths and re-sign
the executable before retaining symbols. No additional telemetry fields or
measurement boundaries are introduced.

Since 0.1.117, Android's bundled serve-emu backend runs under Node.js. Existing MCP error capture, sampled tool traces, UI readiness, and input acknowledgement measurements remain on the active paths. `android.backend.startup.samples` and `android.backend.startup.duration` measure owned backend launches from process spawn through matching device health readiness or startup failure, in milliseconds, with a fixed `outcome` of `ready` or `failed`. These measure plugin backend startup, excluding emulator boot. They carry only product attributes, never device IDs, process diagnostics, paths, or input content, and honor telemetry opt-out. The child backend retains its local frame, queue, and recovery diagnostics without emitting per-frame Sentry events.

Since 0.1.128, owned Android launches also send bounded startup diagnostics to
the parent over Node IPC. The child sends at most one progress message per fixed
stage, one first-failure message, and one aggregate completion message. No SDK is
initialized in the child. Summaries are strictly validated before telemetry;
arguments, output, paths, device names, serials, socket/session identifiers and
credentials are never included. Collection stops after initial scrcpy readiness
or startup rollback, and telemetry opt-out disables child collection and the
post-failure device check. Existing overall startup metrics and sampled MCP
trace boundaries remain unchanged; timeout values and retry behavior are unchanged.

`android.backend.startup.stage.samples`, `.stage.mean`, `.stage.max` and
`.stage.outcomes` distinguish server lookup/hash, cache probe, push/cache
publication/copy, forwarding, socket readiness/polling, socket connections,
video preamble and rollback. Socket readiness measures the whole wait; socket
polling measures individual commands aggregated into one summary. Stage durations
include cancellation settling. `.queue.mean` and `.execution.mean` distinguish
executor admission wait from local ADB process lifetime through pipe closure;
`.execution.spawned` counts measured commands that actually spawned. These are
monotonic plugin timings in milliseconds, not device-only execution latency.
Measurements are aggregated per stage per launch, never sent per poll or frame.

`.active_backends`, `.in_flight` and `.stopping_backends` count owned active,
starting and stopping backends in this MCP process. `android.backend.process_shutdown.duration`
measures SIGTERM to local child exit; it does not establish remote scrcpy exit.
`.device_state.samples` and `.device_state.duration` record a bounded, asynchronous
ADB device-list check after failure, with only online/offline/unauthorized/missing/
unknown state. The before-state comes from the existing online-device preflight.
An unavailable or failed check records unknown, never inferred device state.
The check does not delay the failed tool response and is cancelled on disposal.

All diagnostics explicitly use the simulator surface and Android device platform,
with emulator/physical kind and emulator/wired/localNetwork/unknown transport.
Errors retain their original message and stack plus fixed `android_startup_stage`,
`android_startup_outcome`, `android_device_state_before`, `android_transport` and
`android_cleanup_overlap` tags. Existing anonymous error attribution, environment,
release, scrubbing and opt-out remain in the parent. Installation and process-session
IDs never enter performance measurements. These diagnostics distinguish failure
mechanisms; they do not by themselves identify the cause of an ADB stall.

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

Builds generate debug IDs and source maps under the ignored `.sentry/` directory. Native rebuilds retain macOS dSYMs and unstripped Android ELF files in `.sentry/native` before stripping the bundled binaries. Release runs can reuse each helper's exact build artifact, restoring the vendor files and matching symbols together after SHA-256 verification. Reused symbols are still uploaded by the current release's Sentry step. Native helpers receive the current release and environment at runtime, so reuse preserves release attribution, measurement boundaries and debug IDs. Symbols, source maps and the upload credential are excluded from the plugin package. Native builds require CMake and Ninja, with an Android NDK for Android collectors. The SDK source archive is pinned and checked by SHA-256. Store the organization build token in the ignored `.env.sentry-build-plugin` file at the repository root:

```dotenv
SENTRY_AUTH_TOKEN=your_org_token
SENTRY_ORG=your_organization_slug
```

That file is also listed in `.worktreeinclude` for local worktrees. Use the organization slug, rather than a team slug, for `SENTRY_ORG`. `npm run sentry:upload` reads the file in preference to shell settings, creates the shared release in all three projects, uploads JavaScript maps and native debug files, and finalizes the release. Rebuild native helpers and run `npm run build` before uploading so symbols and maps match the packaged code. Runtime reporting needs only the public DSNs; it does not need this token. Build and upload are separate commands. `npm run test:native-telemetry` verifies a real isolated crash, Rust panic privacy, metrics, opt-out and the Android relay transport against a local receiver.

Since 0.1.130, simulator definition HTTP 404 errors retain their existing message,
`simulator.tool` operation, UI surface context, anonymous installation/session
attribution, trace propagation and retry behavior. Baguette adds a versioned local
`definition_diagnostic` object at the actual failure boundary. Server error tags
`definition_stage` and `definition_failure` distinguish simulator lookup, profile
read/parsing/missing chrome identifier, panel lookup, chrome read/parsing,
composite read/layout/rasterization, missing screen geometry, slice
read/rasterization, and final assembly. Read failures distinguish missing files,
permission denial and other unreadable files. `definition_cached_failure` marks
negative-cache hits, which retain the original asset failure stage/category even
when another bezel route populated the cache. No raw filesystem errors are sent.

`definition_model` accepts only a fixed allowlist of public Apple device-type
names (never renamed simulator names); unknown models become `unknown`.
`definition_runtime` and `definition_xcode_version` accept only bounded numeric
version strings. The Xcode version comes from the Xcode selected by Baguette's
existing developer-directory resolver, rather than the plugin build toolchain.
`definition_panel` and `definition_device_state` describe the backend's request
snapshot. `definition_backend_version` accepts the pinned Baguette version;
`definition_backend_source=pinned` verifies the diagnostic's source commit against
the plugin's pin, and `definition_backend_mode` distinguishes embedded and external
backends. These are error tags only, not performance attributes or identifiers.

`definition_device_before` records the successful booted-device validation.
After a definition 404, the server performs one bounded device-list read (up to
two seconds) and adds `definition_device_after`: a lifecycle state, `missing`,
`unreachable`, or `unknown`. This is later evidence, not proof of the exact state
when the definition failed. It performs no boot, repair or definition retry.
Existing connection timings include this failure-only diagnostic read. A missing,
unrecognized, malformed, oversized (over 4 KiB) or interrupted diagnostic response
is tagged `response/unclassified`; the original HTTP error remains intact. The
body is never attached to Sentry. Device IDs, local paths, raw response bodies,
logs, arbitrary names and credentials remain excluded. Collection uses the
existing centralized Sentry initialization, environment and telemetry opt-out.
Native rebuilds retain matching Baguette dSYMs, and release uploads continue to
upload those symbols with the plugin release.
