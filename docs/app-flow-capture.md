# Instrumented App Flow capture

The instrumented path is opt-in while we test it against a small, fixed set of
routes, guarded forms and nested sheets. The target is 260 reviewed views in
260 seconds. Source matches and unit tests do not establish that result.

`mobile_app_flow` with `prepare-build` and the usual project/device options adds
a reversible wrapper to a CommonJS `babel.config.js`. Restart the existing Metro
process once and reload the app. The wrapper preserves the original plugin order
and applies instrumentation only in development. `restore-build` restores the
exact original config and refuses to overwrite later user edits. Generated files
live in `.mobile-dev-flow`; tracked app component files stay unchanged.

Start with `options.capture: {planRunId, include, recipes}`. A saved plan supplies real
route params and opening chains already found in that project. `include` contains
node or source-view IDs. Optional recipes join scanner-proven action IDs, with an
optional base node from the saved map. They cannot introduce executable code,
new component names, control methods or invented state values. A planner still
needs to choose these opening chains; this does not yet replace all initial
discovery. The run checks the source hash, freezes the
selected jobs before capture, and reports preparation time separately. Missing
data and unsupported contexts remain explicit failures in that fixed selection.

The Babel transform registers committed state, controls and JSX entries under
exact source locations. It adds hooks at fixed build-time positions. It does not
replace React's dispatcher or rewrite Fiber hook cells. Repeated instances need
an unambiguous owner; the runtime will not pick the first matching row.

Guarded render bodies can mount through a source-registered loader beneath the
live provider tree. Local preview state uses a separate component instance and
real props. Shared controls cannot open from a copied live reference. App effects
are contained in previews; source-proven local Reanimated timing/spring effects
keep running. Framework query hooks keep their real cache and requests. Shared
consumer contexts and other effects still need further source-proven support.
These previews are not proof that every guarded state can render faithfully.

The app runs the opening queue and retains common parent steps. It emits a frame
request only after readiness checks pass, waits for the native screenshot, then
verifies the view again. A changed frame is discarded without reopening the view.
The server saves only accepted frames. Source commits wake readiness checks;
local motion probes remain because native animation can move without a React
commit. Loading, native lifecycle, geometry, opacity, paint and blank-frame checks
remain active. Proven menu dismissal handoffs wait for the close callback before
opening a sibling sheet. Disconnect recovery resumes unfinished jobs.

`node scripts/build-flow-runtime.mjs` rebuilds the injected runtime separately.
New inspector connections read `dist/app-flow/runtime.json` afresh. Once the new
server is loaded, runtime edits do not require restarting the host. Changes to
the Babel transform or hook layout still require rebuilding/reloading the app.

Validate the small representative selection before attempting another full map.
Report correct captures, failures, preparation time and capture time. Do not use
CPU/memory recordings as a substitute for this check.

The first live 20-view check did not pass. It exposed Hermes evaluator closure
failures, anonymous compiled component names, and native sheets left over after
JavaScript restoration. The runtime now precompiles async closures and follows
registered source owners and portal bodies. State previews beneath an open
controller remain blocked until a capture host can preserve that native parent.
Do not count source readiness or a saved PNG as proof of a correct capture when
native presentation restoration failed. A JavaScript reload can leave an orphaned
native sheet visible; the live test required an app relaunch to clear it.

Capture readiness now measures the resolved view and its native ancestors instead
of its whole state provider. Repeated source entries for one controller reuse the
open sheet. Cleanup callbacks keep their owner references outside loop scopes,
and source commits in one burst schedule one readiness check. The existing
capture, screenshot and runtime timings keep the same boundaries and units.

The next fixed 20-view test finished in 43.2 seconds, including 4.7 seconds of
preparation, without a run error. Manual inspection accepted 12 captures. Three
saved images showed incomplete or invalid app data, two views timed out, and three
needed context. This still falls short of the coverage and speed target. The
mapper must not equate a settled image with a complete, correctly populated view.

Native image load events now delay capture while visible images load, without
waiting for offscreen images. A focused four-view check after that fix captured
composer, drafts, the populated GIF picker and interaction settings in 13.6
seconds, including 4.7 seconds of preparation. All four images passed manual
inspection and the app returned to Home. The full 20-view set has not been rerun
with the image-load fix. Native image observers detach during cleanup; image
content and URLs never enter telemetry.

Repeat scans reuse an immutable source catalog when current file contents,
file membership, aliases and platform match. Each request still reads and hashes
source files, so preserving a file's timestamp does not hide an edit. The cache
holds one project result, capped at 24 MB, and returns a fresh copy to each run.
This cuts repeated source work without changing capture readiness or coverage.

If final sheet dismissal fails, the capture queue retains its driver until cleanup
succeeds. Stop retries that cleanup and reports a failure while native dismissal
is pending; the runtime must not reset parent navigation or replace the queue in
that state. A retry keeps the original native close observer instead of issuing
a second close. Normal captures add no delay. Existing capture-stop and restore
operation timings and handled-error reporting cover this path.

Version 0.1.182 bundles the capture and discovery runtime through Metro when the
prepared build matches its source fingerprint. Unprepared or older builds retain
the injected path. The fingerprint covers runtime factories and the preview
client. Ready route captures reuse the navigation readiness proof only when fresh
content and motion probes still match. Hidden tabs retain completed image events;
returning to a loaded tab does not start a false wait for another load event.

Prepared previews copy the committed owner's actual React provider values,
including providers below the capture host. The values stay inside the app.
Temporary render errors belong to that exact preview boundary and fail its view;
the app root keeps reporting unrelated errors. Unmount restores the root handler
and releases provider references. A component whose owner unmounts while a cold
module loads cannot start a preview.

The 0.1.182 runtime on the 0.1.181 server captured the fixed 20-view selection in
25.6 seconds with no reconnects or runtime timeouts. A prior injected-runtime run
took 76.5 seconds and captured 17. Reloading changed the mounted tree between some
tests, so this is an observed result, not an isolated measure of compilation. A
controlled fallback test on the same warmed app captured 18 in 38.8 seconds, with
two false image waits. The image fix removes those waits while preserving checks
for real new loads. The full coverage and one-second-per-view goals remain open.

Version 0.1.183 retries slow sheet cleanup on the same inspector after a successful
heartbeat. Reconnecting remains the fallback if cleanup still fails or the
connection is gone. Rollback cancels old readiness timers before dismissing the
native sheet. No navigation starts beneath an unfinished dismissal.

Sibling sheets can reuse a parent whose content changed if a fresh probe proves
that its route and real parameters still match. The native checkpoint, loaded
content and motion checks still apply. Reuse never supplies an old screenshot;
the next view still needs its own capture and verification. Older runtimes that
cannot supply route proof keep the stricter content comparison.

A fresh default run on the installed 0.1.182 server saved 116 captures in 500.5
seconds before we stopped it. It reconnected once after delayed sheet cleanup,
so the earlier prepared-batch result does not establish default-path reliability.
Four isolated Starter Pack dialogs took 23.5 seconds on that build. One captured;
three kept showing loaders because their opening recipes lacked prepared data.
A fresh 0.1.183 default run saved 120 captures in 676.7 seconds before Stop,
with repeated runtime timeouts. These saved images have not all been checked.
Its app footprint grew from 805 MB to about 2.6 GB; the old process had reached
41.9 GB across earlier runs. The fresh run shows memory use alone does not explain
the stalls. Full coverage, duplicate removal and one-second captures remain open.

Version 0.1.184 prepared state discovery checks the build's source hash, state site, setter, and
committed hook value before reusing a binding. It needs no forced app render or
stack lookup for those sites. Unprepared or mismatched sites keep source-based
collection. A partial form branch still needs its exact JSX entry, but loading
and motion checks cover the whole temporary form, including sibling fields.
Debugger requests carry a deadline calibrated to the app's clock. An expired
request cannot open a view later while the mapper recovers another view.
