# Instrumented App Flow capture

Normal mapping and prepared selections use one capture queue and presentation
executor. They differ in how they choose jobs. We are validating that executor
against a fixed set of routes, guarded forms and nested sheets before widening
coverage. The target is 260 reviewed views in 260 seconds. Source matches and
unit tests do not establish that result.

The latest development check after 0.1.191 attempted the same 20 selected views
in 49.7 seconds, including 0.35 seconds of preparation. Inspection of every saved
image accepted 13 distinct views. One report image had an invalid subject; two
report steps timed out; two signup steps, hosting-provider selection and discard
confirmation lacked usable state or an opening binding. No reconnect or runtime
failure occurred, and the app returned to its logged-in Home without a sheet.
This has not passed the 20-view gate. An earlier run accepted 13 unobscured views
in 38.4 seconds, so the current result does not establish a speed improvement.

Cold previews now use the focused route's provider context and keep their target
handle until React commits. Prepared previews contain app effects and app-owned
subscriptions while allowing framework queries to load real data. Nested form
copies retain their native parent layout and safe area. If a query commit replaces
the original body's hidden style, capture conceals that same body again and waits
for its layout; cleanup preserves the app's newer props. A different native body
still fails. Copied forms do not autofocus explicitly marked inputs, so system
autofill does not cover their fields. Live form behavior stays unchanged.

Opening bindings ignore inactive retained pager pages. A saved finite-state
opener may use another independently reachable source entry only when both name
the same destination and exact state update and resolve to one live setter. This
never runs an event handler.

Prepared JSX markers now bind exact committed source entries directly. They
check the build hash, owner, source location and current instance, and retain
stack-based binding for unprepared entries. This reduced collection time from
3.05 to 2.49 seconds in the fixed check, but total capture time did not improve.
Resolved route data now updates a sheet's base route as well as its map node;
this server change has behavior coverage but still needs a live check.

A focused dialog check exposed a false capture: opening a control inside a
copied login form removed its target, and readiness then accepted the surrounding
account-selection page. Readiness now keeps the requested target identity until
restoration. The same focused check rejected the wrong image. The alternative
opening change that exposed this failure is held back.

The next gate is still all 20 correct images. First keep copied forms mounted
through provider updates and prove their nested dialogs. Then supply proven
local state from real query data for signup and valid subjects and choices for
report steps. Changing a step number alone is not enough. Repeat only the
failing subset after a relevant change, then the fixed gate. Do not run another
full-map sweep while this gate fails; keep all readiness checks.

When changing Babel instrumentation, restart the existing Metro once with its
transform cache cleared, then reload the app. In this test a JavaScript reload
picked up the runtime but left old transforms in use; clearing Metro's cache
activated the autofocus fix. Do not start a second server.

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

## Earlier checks

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


A default 0.1.184 run saved 131 images in 562.2 seconds before Stop, with no
automatic reconnect. Its app footprint reached 2.8 GB during the run. Some
copied form steps still used the wrong native window, so this count does not
prove 131 correct views or completion of the speed goal.

Version 0.1.185 renders copied steps inside their existing native sheet when
an exact content slot is available. The original owner stays mounted and its
body stays hidden until cleanup. Ambiguous slots fail instead of opening a
second window with sheet-local coordinates. Nested native sheets keep their
own container. A source-proven return along the same finite state selector
links to its captured ancestor rather than adding another capture. Changed
fields, controls, route data and parents still require their own view.
The default queue starts with the current route, then keeps the existing
coverage and retry rules.

Live checks of the inline runtime placed the password form inside its sheet,
but one saved image clipped its bottom buttons during resizing. Native sheet
previews now compare consecutive screenshot frames within the existing capture
deadline. This last gate and server-side return deduplication still need a live
check. A moving backdrop may keep full-frame comparison from settling; this
is an open limitation, not evidence of correct capture. Prepared capture queues
still require a capture host inside a native sheet and do not yet share this
inline path. Do not use that smaller queue as proof of default-run coverage.

## Screen catalog

Every finished run updates a screen catalog for its project and platform, stored
under `catalogs/` in Mobile Dev's local App Flow folder. One entry per screen
holds the best known opening recipe: its route path, real params, opening chain
and natural parent. It also holds the latest attempt and the latest accepted
capture. A later failure records the attempt but keeps the last working recipe
and image. Recorded flow steps and the no-navigator entry fallback stay out.

Each entry has a category for what the screen needs: `no-inputs`, `real-inputs`
for routes with required params or openers that take real data, and `app-state`
for UI previews of guarded state. Params resolved by AI or the resolve action
reach the catalog through the run that used them, so later runs reuse them.

`options.capture.catalog` runs the prepared queue from the catalog instead of a
saved `planRunId`: `all` replays every current screen, `missing` only screens
whose latest attempt didn't capture. `include` still narrows the selection. An
entry whose opening action or base route no longer exists in the current scan is
stale and stays out. The `catalog` action reads the list with counts by category
and latest status. The catalog holds real identifiers and image links, so it
stays local and out of the app repository.

## Readiness and preview placement fixes, 7 October 2026

Fabric creates a host's public instance lazily, so many native views had no
`getBoundingClientRect`. Readiness then measured a screen by whichever small
host happened to have one, such as a back button, and treated loaders outside
that box as offscreen. Readiness, preview visibility, inline sizing and motion
now fall back to the Fabric UI manager's rectangle for the same shadow node.
Loaders and pending queries in the visible screen block capture again.

Query results shown as React Query placeholder data count as loading while the
query fetches. A disabled query that keeps its placeholders does not block. A
loading timeout names the component that was still loading, for example
`loading (data in StepProfiles)`; the name stays in the local map.

A preview mounted in a temporary Modal keeps its original body's window frame,
so a screen body below the status bar stays below it. Previews in an existing
native content slot keep their slot.

Capture hides LogBox notifications while it runs and restores LogBox afterwards.
Development toasts can no longer cover screenshots. Logs keep being recorded;
a new fatal or syntax error still fails the capture, and an inspector already
open at the start still blocks.

Debugger expressions carry every UTF-16 surrogate as a `\uXXXX` escape, and
command strings are made well formed. The debugger path re-encoded a raw emoji
as separate surrogates, which Hermes could not compile; one emoji in a screen
title or param could fail a whole run.

A prepared or catalog run gives a view that timed out waiting for query data one
more attempt after the rest of the queue. The request keeps warming the cache in
the meantime. Other timeouts are not retried. A failed run keeps the bounded
runtime error detail in its local error message.

Catalog runs seed screens that no run has reached yet. The scan records, for
each opening action, the registered screens whose render tree contains the
opener's owner. A seeded opener gets a one-step recipe: open such a screen, or
the entry screen for openers outside every route, then bind the opener. A parent
that needs params uses real params from a catalog entry that captured it. Routes
are seeded only when app UI links to them. Refs on primitives and React Native
refresh controls are not views, and a live opener and a preview of the same
controlled element share one recipe. Live binding still decides whether a seeded
recipe works; a failure records its named reason.

The `catalog` action also records review verdicts for one run's images. A
rejected image stops being the screen's accepted capture, so `missing` attempts
that screen again; a new attempt clears the old verdict.

The native ownership guard counts only native records that reported a lifecycle
event. A modal host can mount with `visible` set and unmount before it ever
shows; without an event there is no native window to orphan. Sheets that
reported opening still stop capture when their owner detaches before closing.

## Capture identity for shared shells

A generic shell, such as a prompt or dialog wrapper, has one source site but is
rendered by many callers. Discovery used to give it one node per source
destination, so captures under different callers collapsed into one node. That
node also collected every caller's controller views, which let the comparator
credit a profile discard prompt as the new-account chat prompt.

The capture build now marks every controller site the scan found, not only
opener targets. On Bluesky this adds 31 markers to components that were already
instrumented, with no new hooks. When a presentation's image is saved, the app
walks up from the opened element and records the marked sites whose element
passes the same controller: the shell's own sites, then each caller up to the
component that created the controller. An enclosing sheet passes a different
controller and is not recorded. The node keeps these sites as `capturedSites`,
and the comparator credits controller views only from them. Older captures
without sites keep the previous behavior.

Discovery names each listed controller by the outermost recorded site. When an
alias previews that caller's own site, it becomes the canonical step and keeps
its existing node ID. Otherwise the caller site becomes part of the node ID, so
each caller of a shell is its own view. The recipe stores the caller per step,
and replay opens only that caller's copy. This also opens a shell that was
ambiguous because two callers were mounted in one scope. The catalog replaces
an older entry with the same recipe that lacks a caller.

On the live app the profile and list editors' discard prompts recorded
`EditProfileDialog.tsx:74` and `CreateOrEditListDialog.tsx:97` beside the
shared prompt sites. The comparator credited each to its own row and no longer
credits the chat prompt.

## Relaunch recovery

Some app states cannot be restored in place: a native sheet that never confirms
dismissal, a fatal JavaScript error, or an app too busy to answer the inspector.
A run now relaunches the mapped app through its device (`simctl` on the iOS
simulator, `adb` on Android), reconnects and resumes the remaining queue.
Accepted images stay. The view that was opening when the failure surfaced gets
one more attempt, because the cause can be the view before it; a second failure
while opening it blocks only that view. Inspector acknowledgements that time out
count as interruptions, and the third interruption in a row relaunches instead
of failing the run. A run relaunches three times freely, then again whenever a
view settled since the last relaunch, up to twelve times, and records a warning.
If the device cannot relaunch the app, the run ends with the original failure.

In the default run that motivated this, the app climbed from 1.3 to 3.7 GB and
ended at about 200% CPU. After 264 seconds and 50 captures, a 2-second
acknowledgement timed out and the whole run failed. Afterwards the app idled at
83% CPU in native networking, animation and audio threads while its JavaScript
thread was idle. A relaunch clears that state.

## Replay, rows and missing data, 8 October 2026

**Replay.** A catalog replay of the 181 accepted screens first captured only 78:
every presentation after a find-contacts step preview failed. Rollback had
restored a focus saved for the preview's first form step, so later openings
searched a detached copy. A route opening with no presentation open now starts
a new base and clears that focus, and a form's first level keeps the focus from
before it opened. The same replay then captured 176 and 177 of 181.

**Pace relaunch.** On a long replay the app reached 100% CPU and kept growing.
Nothing failed, but every capture slowed: tree walks took 225 ms instead of
26 ms. A run now compares the median of the last eight captures with the
median of its first eight, separately for routes and presentations. When recent
captures are more than twice as slow and above 2.5 seconds, the run stops after
the current job, relaunches the app and resumes. Another pace relaunch waits
for a healthy window, so content that is simply slow does not relaunch again.
Pace relaunches share the relaunch budget.

**Menus in rows.** A menu or sheet opener repeated in the rows of one vertical
list opens on the first visible row that meets the opener's source condition,
in reading order. Pager pages, horizontal lists, separate owners elsewhere on
screen and openers that pass data or route parameters still need one owner.

**Links inside sheets.** A captured presentation reveals routes linked from its
own body, with the link's real params. The screen beneath it keeps its own link
evidence.

**Forms behind a mount.** Discovery lists a mount preview whose module has not
loaded yet; only its own opening loads the module, in a prepared build. Catalog
seeds and never-captured entries open a step of such a form after the mount
preview of its owner. Onboarding now opens all its steps with real data.

**Portals inside a copy.** Onboarding's step buttons reach its footer through a
nested portal. A preview contains the portal's registration effect, so the
relocated copy used to render the buttons at the top of the screen. The portal
source proof now names the provider's attach and detach methods. When the
portal's nearest provider is inside the temporary copy, the runtime calls that
provider's proven attach method and the buttons render in their own outlet. It
follows later children with detach and attach, as the app's effect does.
Portals whose provider is in the live app keep the relocated copy. All six
onboarding steps were captured with their footers in place.

**Missing app data.** When nothing on the parent screen renders an opener's
owner, the reason names that owner and suggests adding the data in the app. A
selected screen that is not captured has a Retry screen action, and
`mobile_app_flow` `retry` accepts `nodeIds` to repeat only those screens.

**Diagnostics.** Each attempt keeps local per-view timing: in-app milliseconds
per phase and how long readiness waited per reason. Unavailable openings keep
the scope they searched, and a step without a content slot records which slot
check failed. None of this enters telemetry.

**Commit work.** React commits no longer walk the whole tree. They visit only
subtrees the commit rendered, where new and updated image and native hosts
are; readiness scans and openings still release removed hosts.

## Faster runs and views not found, 8 October 2026

**Fail fast.** The last full run before this change took 23.8 minutes. Its
final 12 minutes saved no new image: every timed-out view got three attempts,
with 6, 10 and 20 second readiness deadlines, and retries ran after the rest of
the queue. Retries had rescued 3 of 172 captures. A timed-out view now gets
one more attempt only when its failure can end differently: loading, native
motion, paint or settling waits, and slow runtime replies. A presentation whose
target never mounted, stayed empty or has no content slot fails the same way
again and is not retried. No view gets a third attempt. The next full run took
11.3 minutes and saved 166 images. With the changes below, run 7 took 12.3
minutes and saved 179 images, 9 more than before and 2 fewer: a picker
inside the add-account preview was blocked after leaving its native sheet open
twice, and one dialog had no live owner in that run.

**Run timeline.** Each map keeps its wall time per fixed phase, locally: first
attempts, retries, discovery reopenings of captured views, planning, connection,
reconnects and relaunches. Each relaunch records its cause and the open view.

**Relaunch budget.** Two views that each left a native sheet open twice used
four relaunches and ended a run while it was still making progress. A run now
relaunches three times freely, then again whenever a view settled since the
last relaunch: a capture, or a view blocked after its second failure. Twelve
relaunches end the run.

**Pace from app health.** The pace check compared capture times with the
run's first captures, so heavy views, such as a report dialog's steps, and
failed attempts that waited for their deadline triggered relaunches: four in
one run. Before each job the app now reports two health values. One is a fixed
loop of JavaScript, about 0.6 ms in a healthy app; the degraded state seen
before ran JavaScript about nine times slower. The other is the size of the
tree its last structure walk visited. Bottom tabs keep every visited tab
mounted: a fresh app had 12,500 fibers, the same app after a run 31,000, and
per-capture structure work grew from 148 to 496 ms. Without a relaunch,
captures slowed from 1.9 to 3.1 seconds within 60 views. The run relaunches
when the median of eight jobs exceeds three times its first probe median and
4 ms, or when the tree exceeds twice its first size and 8,000 more fibers.

**Views not found.** A discovery map used to show nothing for an opener that
never appeared on the screens it explored. After discovery, every source-proven
dialog, sheet, prompt or menu opener whose owner renders under an explored
screen, and that no node covers, becomes a needs-data node under that screen.
Its reason quotes the source conditions around the opener and around its
owner's single render site, with file and line: `&&` and ternary branches,
`.map` and list `renderItem` rows, `if` and `case` branches and earlier guard
returns. A handler guard is quoted too. For example: "Not found on Settings in
this app state. It renders when `accounts.length > 1` (Settings.tsx:123),
`showAccounts` (Settings.tsx:151) and `accounts.filter(…)` has items
(Settings.tsx:154)." Nothing is evaluated or opened, and no model writes the
text. Openers that pass one controller value from one owner, and a dialog's own
body with the opener passing it the controller, become one node; two different
dialogs given one controller in alternative branches stay two. A body whose
dialog the map already opened through any caller is not repeated, and marking
twice adds nothing. Run 8 kept 65 such nodes. Retry screen
on such a node tries the real opening; if the opener is still absent, the node
keeps its conditions. A resumed run, such as a single-screen retry, no longer
reopens every screen it already explored; mapping more screens still does.

**Steps deeper than their container.** A step preview inside a native sheet is
appended to the nearest View above it, and must be that View's exact last
child. Steps inside a dialog's scroll view, such as the delete-account and
email dialog steps, failed this check. Such a step is now copied by the
component that received its own element as a child, right after it, when every
later sibling renders no native view. A step whose original rendered nothing,
such as an email dialog opened without a screen, takes the copy without
anything to conceal. Such a nested copy also needs no one-to-one sizing proxy,
because the sheet sizes itself from its own first content view. Run 7 captured
the email dialog's Update, Verify, Verify reminder, security-code and
enter-code steps, and a focused run captured both delete-account steps.

**Run results from tools.** `start`, `extend`, `retry`, `resolve`, `stop` and
`capture-step` return the same compact run as `mobile_read_app_flow`: the graph
and progress without the source analysis. A retry on a real map returned 23.7
MB before, which closed a strict MCP client's connection; the analysis stays
available through `context` and `diagnostics`. Retrying one not-found node now
takes about 10 seconds and keeps its source conditions when the opener is
still absent.
