# App Flow coverage plan, 7 October 2026

The current step order is in the
[full coverage plan](app-flow-full-coverage-plan.md). The counting rules,
constraints and review decisions below still apply.

Keep the shared executor. Change how it gets work, validates opening inputs,
and owns native presentations. More full-app runs and longer retries will not
close the present gap.

This plan follows a source audit and two completed Claude Opus 5.5 reviews using
extra-high effort. The second review considered the fresh counts and challenged
the first review's estimates. No new app run, benchmark or production change
was made for this review. The plugin source was at `fceb294`; the test app was at
`2d8e349afd92d2be3ff31f298bc27ab0d82c61cc`.

## What the evidence says

The latest full attempt saved 108 images in 650.205 seconds. Manual review
accepted 84 images, which the comparison attributed to 68 distinct reference
views: 42 live openings and 26 isolated previews. The run stopped with an empty
native sheet covering later pages. These are incomplete-run results, not a
throughput benchmark. See [the checkpoint](app-flow-coverage-checkpoint.md).

A fresh scan of 2,371 source files took 4.221 seconds. It matched all 260
reference entries, with 164 route/action plans, 83 preview plans and 13 entries
with source evidence only. A source plan is not proof that its inputs, owner or
native presentation are available. Comparing this fresh catalog with the saved,
manually reviewed run still returns 68 captures.

| Reference result | Views |
| --- | ---: |
| Verified capture | 68 |
| Saved image rejected in review | 19 |
| Run stopped before capture | 22 |
| Attempt failed | 21 |
| Explicitly needed data | 3 |
| No matching attempted capture | 127 |
| Total | 260 |

These count reference views, not image files. The 127 unmatched entries include
12 route plans, 55 action plans, 47 preview plans and 13 source-only entries.
Thus 114 already have an abstract plan. Some may have identity mismatches or
unavailable prerequisites; this audit does not classify them all as missing
extraction. Even perfect results for the currently matched attempts would cover
only 133 of the 260 entries.

The retained fixes improved source acknowledgements, portal traversal, provider
handling and some cleanup paths. They did not establish a large speed gain.
The fixed 20-view control took 42.665 seconds with 18 correct captures. Final
code took 51.080 and 49.273 seconds with 16 correct captures, then 38.926 seconds
with 18 after an isolated warm-up. The two extra loading failures remain
intermittent. The original two failures remain visible.

## The 260 reference needs revision

Keep the existing reference as v1 so old results remain comparable. Create a
reviewed v2 with a change ledger. Do not silently change the denominator or
declare a new total from this targeted audit.

Concrete findings in the test app:

- `sheet:channel` violates the reference's exclusion of internal UI.
  `src/components/OTAChannelNotice.tsx:56` requires `IS_INTERNAL && IS_NATIVE`,
  and line 149 guards the channel dialog with that condition. It is not merely
  unavailable in a development session.
- `guard:age-return` needs a counting decision. Its body defaults to verifying
  with a loader, then error or success in
  `src/ageAssurance/components/RedirectOverlay.tsx:235,280`. Success already has
  its own row, while the reference excludes ordinary loading/error variants.
- Notification dialogs share a component but differ in source-defined purpose
  and some controls. For example, the miscellaneous dialog passes
  `allowDisableInApp={false}`. Do not collapse all of them just because they
  share a component, or count every new record ID as a new screen.
- The valid AfterReportDialog capture does not join its reference row. The
  exported component wraps `BlockOrDeleteDialogInner`; its inner `Outer` body
  has a different source identity from the exported-name selector. This is a
  confirmed comparison miss, not a newly captured screen.
- A signup-handle image also matches the ancestor signup-info row among its
  candidate attempts. The current report chooses 68 distinct image IDs, so this
  has not inflated the reported 68. The comparator still needs a regression
  test that prevents a child's image from proving its parent.
- Review excluded link/server-entry routes and unclassified source destinations
  for omissions. This check can increase the total as well as reduce it.

Use two levels of identity in v2. A body identifies a distinct app-owned route,
form, sheet or prompt. A view variant adds a source-defined step, purpose,
control set or native presentation that changes the UI. Different users,
posts, list items and opening paths do not create new view variants. A shared
container does not count in addition to its displayed body. Keep menus that
only expose actions as opening dependencies, following the existing scope.

Report body and variant counts separately. Review every v1 row and group the
unclassified candidates by source pattern before freezing v2. This task checked
specific problems; it did not complete that entire independent inventory audit.

For each included view, record availability before testing: usable with the
current session, needs a real record, needs a different session/build/feature,
requires an external effect, or not yet understood. An unexpected timeout must
not move a view out of the eligible set.

Keep total-inventory coverage visible beside current-setup coverage. Separate
live captures from isolated previews. At the old denominator, 80% means 208
views and 90% means 234. We have not proved that either is reachable with one
account under the current constraints.

## Why the present approach misses views

`capture-planner.ts` schedules nodes already admitted to the run.
`presentations.ts` adds presentation nodes when a rendered parent exposes a live
action. A failed parent can prevent child discovery. Lazy menus can hide the
controls needed to open their dialogs. Existing destination nodes keep their
first opening recipe; later parents add edges and aliases but do not preserve
alternative recipes.

`opening-data-source.ts` already extracts some real setter inputs without
executing the event handler. The scanner does not yet compose all required
data-setting operations with the subsequent control opening. Finding an
`open()` method is insufficient if its body needs a subject, parent, selection
or a true opener guard.

The native leak can invalidate later screenshots. The test app's
`modules/bottom-sheet/ios/SheetView.swift:100` removes child content on React
unmount. Its `dismiss()` method closes the controller separately at line 200.
This supports an owner-lifetime failure mechanism. It does not establish that
all 19 invalid views or all 22 stopped views share that cause.

The runtime also only finds initialized module exports for some previews.
Cold modules, unmounted providers and data-dependent steps therefore need
explicit prerequisite handling. Repeated polling cannot satisfy those needs.

## Implementation order and acceptance gates

The first implementation checkpoint reproduced and fixed the native owner
failure in step 2. The account chooser and subsequent Settings now capture
cleanly. The fixed benchmark preserves 18 correct views in 43.015 seconds,
with both known failures still visible. See the
[native lifecycle checkpoint](app-flow-native-lifecycle-checkpoint.md) for
the measured limits and delivery state. Steps 1, 3 and 4 remain open; the
260-view inventory and full-app coverage total have not changed in this test.
The [identity checkpoint](app-flow-identity-checkpoint.md) corrects capture
credit (69 of the frozen 260 for the reviewed run), fixes scroll-reachable
control openers and records the benchmark's environmental slowdowns.

### 1. Make coverage and capture identity trustworthy

Update the reference/comparison tooling and the capture record. Keep the final
active body, selected variant, owner generation, data provenance and native
presentation identity together when screenshot pixels become fixed. Credit
that record, not all views claimed by a recipe or discovered afterwards.

Account for all accepted images that do not match a reference row. Resolve the
known export alias and ancestor/child ambiguities. Preserve one inventory row
per view even when it has no executable recipe, and give each missing row a
specific prerequisite or an explicit unknown. Do not invent a cause to clear
the unknown count.

Primary files: `scripts/lib/compare-app-flow-views.mjs`,
`scripts/lib/compare-app-flow-capture.mjs`, `src/shared/app-flow.ts`,
`src/server/app-flow/capture-manifest.ts`, `capture-driver.js` and
`tests/app-flow-views-comparison.test.ts`.

Acceptance: a versioned audit with explained changes; no collision or ancestor
credit; every old row remains traceable; a saved capture joins the body observed
at capture time. This work does not claim a capture gain by itself.

### 2. Prevent one native sheet from spoiling the next capture

Reproduce the orphan with the smallest opening/closing sequence. Keep the
owner, control and portal alive until the matching native close event arrives.
Then restore opening data and release the owner, in reverse order. Navigation
that removes an open owner must wait for that close.

If React removes an open host first, mark the window's presentation state as
unknown. Stop captures in that window. Detecting deletion in JavaScript can
prevent further invalid images; it cannot prove the surviving native controller
has closed. Resume only after a verified clean state, keeping prior captures.

Primary files: `capture-queue.js`, `presentations-runtime.js`, `portal-source.ts`,
`capture-driver.js`; existing queue, driver and portal behavior tests.

Acceptance: repeated minimal open/close sequences leave no sheet; interruption
and owner replacement cannot produce an accepted image after an unconfirmed
close; the affected Settings sequence restores cleanly. Image inspection must
agree with the capture gates.

Stop/go: give the minimal native-lifecycle investigation one 60-90-minute
checkpoint. If the suspected sequence does not reproduce the orphan, use the
saved failed sequence to locate it before adding another barrier. If JavaScript
cannot prove the required lifecycle, stop patching around it and propose a small
development-only native observer. It would expose
presentation/dismissal completion and require an app rebuild. Faster native
screenshots or transition suppression are separate, unmeasured additions.
Relaunch recovery is an alternative without a rebuild, but its cost belongs in
the run and it must return to a verified starting state.
Offline planning work can continue while that decision is pending.

### 3. Turn the existing catalog into work with prerequisites

Keep the shared executor and its prepared bindings. Change the planner so the
static inventory persists from the start. Each view retains alternative entry
recipes, guards, required real inputs, owning providers and its native
presentation requirements. Runtime discovery satisfies those requirements.
It should not determine whether the view exists in the report.

Collect bindings and child entries from a ready parent independently of whether
its screenshot succeeded. Choose a valid opening path and retain other paths
for fallback. Try a bounded set of live instances when one record does not
satisfy the opener's guard. Rebind when the owner or relevant values change.
Retry only when evidence changes, rather than repeating an impossible opening.

Do not enqueue every navigator registration or raw JSX candidate. Preserve
proof of an app-owned UI entry and the existing test/internal exclusions.

Primary files: `capture-planner.ts`, `presentations.ts`, `reachability.ts`,
`presentations-bindings.ts`, `capture-manifest.ts` and their behavior tests.

Acceptance: all 12 presently unmatched route entries and a frozen sample of the
55 action / 47 preview entries have either a valid scheduled recipe or a named
missing prerequisite. A failed parent capture does not silently erase its
children. Two valid parents retain two recipes. An invalid first parent does
not prevent the second from working.

### 4. Execute complete, source-proven openings with real data

Extend the existing expression and opening-data code to one ordered recipe:

1. Read the real input and verify the opener's guard.
2. Apply only the source-proven local UI setter needed to prepare the view.
3. Wait for that exact owner's commit and refresh its binding.
4. Open its exact control with the resolved argument.
5. Wait for content readiness and native presentation completion; capture.
6. Close through the control, await native dismissal, then restore local data.

This covers a family of cases: lazy menus that mount dialogs, selected records
fed into a global sheet, and child sheets that depend on their parent. It must
not execute arbitrary `onPress` handlers or run unrelated work from a handler.
Extract and approve the needed UI operations only.

Keep related values together. A report subject is a real structured record,
not independently guessed IDs. Accept inputs from exact live props/locals,
observed navigation parameters, mounted links or settled query data with a
proven relation to the source expression. Expire evidence when its owner,
query result or source version changes. AI may help identify the relation or
select a real record; it must not invent a token, credential or backend result.

Primary files: `opening-data-source.ts`, `presentations-source.ts`,
`state-expressions-source.ts`, `prepared-runtime.js`, `presentations-runtime.js`
and `tests/app-flow-opening-data.test.ts`.

Acceptance: a frozen set spanning lazy menus, argument-bearing controls and
parent/child sheets captures the correct variants with real inputs and clean
restoration. Missing input or a false guard gives a specific blocked result.
Use fixtures with unrelated names and structures so the production change
cannot depend on Bluesky.

This is the first planned coverage feature after the audit and lifecycle gates.
It has a credible benefit across existing plans. The 55 action and 47 preview
rows are investigation groups, not promised capture gains.

### 5. Address only the remaining measured barriers

Use the inventory to choose the next missing pattern. Add cold-module loading,
provider/prop construction or a source-proven read only when specific rows show
that it is the blocker. Module initialization and mounting can run effects;
loading an export is not automatically safe. Preserve normal React hook order
and the existing approved-effect boundaries. Do not add blanket effect
suppression or raw hook-state edits.

An isolated login/signup form may be valid with its own real inputs while the
main app remains logged in. A view that depends on a server-issued result or a
different account condition needs actual evidence for that state. Keep it
blocked when that evidence is absent. Never falsify global account state.

If the audited inventory needs another test account, existing group membership,
media or a regional/build setting, report that exact setup requirement. Any test
setup belongs outside the generic mapper and needs separate user authorization
if it changes account data. A session's inability to supply it remains visible
against the total inventory.

Acceptance: each new pattern unlocks a fixed group of correct captures without
regressing earlier groups. If it does not, stop that experiment and record the
constraint. Do not begin another broad fallback rewrite.

## How to measure progress without another long loop

- Work in 60-90-minute implementation checkpoints with one named change and a
  stop/report boundary. This limits engineering sessions, not mapping runtime.
- Start with the smallest failing sequence, then its affected group. Reuse the
  running Metro and installed tools. No recording or full-260 sweep per patch.
- Retain the same 20-view performance set and its two known failures. Preserve
  the 18 correct captures, real data, safe areas, presentation, readiness and
  restoration. Do not require 20/20 before measuring performance.
- Keep roughly twice the fixed-set valid-capture throughput as the performance
  experiment target. Added coverage alone does not meet that target. Do not
  claim a speed gain from a warmer session or a smaller set of attempted views.
- Separate preparation, data resolution, opening/capture and restoration in
  wall time. Report cold and warm runs separately. The source phase includes
  actual opening work. Do not rename it debugger overhead or hide setup costs.
- Retain shared parents when their owner/data/presentation identity still
  matches. This can reduce repeated setup within the existing executor. Measure
  the gain; none is promised by this plan.
- Run one full validation only after affected groups and the fixed selection
  pass their gates. A new failure class returns to a small reproduction. A
  later confirmation run follows only when the cause and fix are established.
- Report valid unique captures, live/preview split, invalid captures, blocked
  prerequisites and unresolved cases. Freeze the eligible set before each run.
  Count duplicates and timing regressions explicitly.
- Preserve current Sentry measurement names and boundaries. Add bounded counts
  for prerequisite outcomes and native-lifecycle failures where current metrics
  cannot distinguish them. Keep app content, props, paths, identities and query
  values out of telemetry. Test timer, binding and observer cleanup on the
  changed path. Do not add unsolicited lint, typecheck or visual suites.

## Claude review and decisions

Claude's completed review supports retaining the executor, recording every
source view and its prerequisites, preserving alternate parents, checking real
opening arguments and fixing native owner lifetime before broad capture runs.
It also challenges credit based on recipe claims instead of observed bodies.

The first review used older plan-type counts in the supplied evidence. The
follow-up accepts the fresh scan and withdraws the claimed plan regression,
numerical coverage ceiling and estimated gains. It also withdraws the claim
that one leak explains a particular number of failed views. Those need a
per-view eligibility and cause audit.

Claude's final counting proposal merges variants that differ only in text or
icons. This plan keeps source-defined purpose visible as a variant pending the
v2 review. Two settings can look alike while serving different user flows.
Report shared body counts separately so deduplication does not hide those flows.
Both reviews support capture-time final-body identity and the existing-plan
binding work. The follow-up agrees that detecting deletion in JavaScript cannot
prove native recovery. A pending native-helper decision must not block the
independent audit, compiler or planner work.

The next implementation should prove native lifetime and one complete opening
pattern, then measure its coverage gain. A claim of 80-90% needs the audited
inventory and verified images. Source matches and extra queued nodes cannot
establish it.

Local evidence lives in `.local-dev/coverage-plan-20261007/`: the fresh scan,
comparisons, sanitized findings and completed Claude review. The frozen v1
reference and old results remain unchanged.
