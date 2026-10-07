# Plan for near-complete App Flow coverage

7 October 2026. This plan replaces the step order in the
[coverage plan](app-flow-coverage-plan.md). Its counting rules and constraints
still apply.
Progress is recorded in the [catalog checkpoint](app-flow-catalog-checkpoint.md) and the [identity and recovery checkpoint](app-flow-recovery-checkpoint.md).

The last reviewed broad run captured 69 of the 260 reference views correctly:
42 through the live app and 27 as UI previews. The sign-out prompt, fixed today,
brings the candidate total to 70. Every other row now has a phase that should
capture it, or a reason it can't be captured under our rules. The assignments
are in `.local-dev/inventory-v2-20261007/ledger.json`. Counts below are ceilings
for each phase, not predictions.

## What the evidence says

Three findings shape this plan.

Most failures among attempted views were one bug. The orphaned native sheet
covered 16 settings and list screens, and the run stopped before 22 more views.
The native lifecycle fix removed that failure. Those 38 rows need a re-run, not
new engine work.

126 rows never became work at all. The current planner only schedules what
runtime discovery exposes on a mounted parent. Discovery misses openers in lazy
menus, below the fold, in list rows that need particular data, and under
parents that failed. When I queued six of these openers directly, one failed on
an engine rule, which is now fixed. The other five needed data or account state
that this account doesn't have.

Most dialog bodies are easy to render on their own. Of the 81 dialog bodies the
inventory names by component, 23 need only their `control` prop. The other 55
need callbacks, which can stay inert because nothing gets pressed, or one or two
real records such as a profile, post, starter pack or list.

## Change of approach

I recommend four changes. The first three are about coverage, the last about
speed and reliability.

**Plan from a persistent screen catalog.** The static scan already finds every
reference view. Keep the result as a catalog per project, keyed by each view's
source identity. Each entry records the view's category, its natural parent, how
to open it, the real inputs that opening needs, and the last capture result.
Categories follow what a view is missing: no inputs, real inputs, app or account
state, or a server result we never capture.

The tool generates and updates the catalog; nobody edits it by hand. Inputs are
resolved once, by a deterministic lookup in loaded data first and AI only for
ambiguous choices, and every later run replays them. AI never drives captures.
Each capture re-checks its inputs and resolves them again when they fail. The
catalog holds real identifiers, so it lives in Mobile Dev's local storage, not
in the app repository. Saved maps already let a capture reuse an earlier run's
parameters and opening chains. The catalog is the long-lived version of that.

Runtime discovery then satisfies a view's prerequisites and binds its opener. It
no longer decides whether the view gets attempted. A failed parent must not hide
its children, and a view keeps every parent path the catalog knows. Runs can be
incremental: re-capture only views whose source changed or that failed.

**Use a fixed strategy ladder for each view.** Try the cheapest valid strategy
first, in this order:

1. A route with real parameters.
2. A live opener on a mounted parent.
3. A compound opening, such as a menu item, or a step inside an already open
   dialog.
4. A body preview over the view's natural parent, with real data.
5. A live capture on a test account that has the needed content.
6. Blocked, with a named reason.

**Render gated bodies directly with real data.** This is the largest lever, with
58 candidate rows. Many dialogs, shell gates and form steps can't open on this
account because of a role, an account status or a server result. The engine
already mounts finite forms under live providers. Extend that to any body the
catalog identifies:

1. Navigate to the natural parent.
2. Mount the body under the parent's live providers.
3. Take props from the live owner, using the same source expressions the app
   uses. That keeps related values in one coherent record, which fixes the class
   of error behind "Invalid report subject".
4. If no live owner exists, use whole records from the query cache whose shape
   matches the prop type. AI may choose among real records, but never edits or
   invents one.
5. Pass inert callbacks and create the control with the same hook the owner
   uses.
6. Open, wait for readiness, capture, close, unmount.

Fields are never mixed across records. Handlers are never called. Effects stay
contained, as in today's previews. The canvas labels these captures
**UI preview** and shows the source condition that gates the live path.

**Keep the app healthy between captures.** A degraded app process made one warm
benchmark run take 63.2 seconds instead of 44.8, with the same correct views.
The app sometimes enters a native networking loop on its own, even right after a
fresh launch, and a relaunch clears it. Check heartbeat latency and the app's
footprint before and during a run. Relaunch the app when it degrades, and refuse
or pause a debug-level log stream during capture. Each run also leaves memory
behind: about 150 MB per short run and 450 MB per fixed-20 run. That needs a fix
of its own.

## The denominator

Keep the v1 reference frozen. Build v2 with a change ledger, the counting rules
from the coverage plan, and one access tier per row:

| Tier | Meaning | Rows |
| --- | --- | ---: |
| A | Live with this account and read-only real data | 147 |
| B | UI preview with real data | 87 |
| C | Needs content or state on a test account | 22 |
| D | Needs a server-issued result we must never create | 3 |
| X | Internal build only | 1 |

The search for omitted views found few candidates. Most of the 285 executable
destinations the reference doesn't claim are refs on lists, scroll views and
text inputs. The rest are internal or web-only, unmounted announcements,
menus, or aliases of counted rows. The starter-pack landing dialog is the one
clear candidate, so v2 should differ from 260 by a handful of rows. Report
coverage per tier, and live and preview captures separately.

## Phases

Each phase has a frozen selection from the ledger. A phase ends with focused
runs on that selection, manual review of every saved image, and the fixed-20
gate: 18 correct views with both known failures visible. One broad run then
measures the phase.

### P0. Re-run with the native fix

38 candidates, ceiling 108.

Run one broad map with the current build on a freshly launched app, with no
debug log stream attached. Review every image. Compare with the corrected
comparator and `--accepted`.

Gate: each of the 38 rows is captured or has a newly named failure. If a native
timeout persists, return to a minimal reproduction before P1.

Result, run `c119e052`: the saved map of the last broad run supplied the plan,
and the run replayed its 133 attempted nodes in 449 seconds. It saved 117
images; manual review accepted 108 and rejected 9. The corrected comparator
counts **108 of 260** views: 78 live and 30 UI previews, up from 69. It gained
35 of the 38 P0 rows and 7 P1 rows whose native timeouts shared the
orphaned-sheet cause. Three rows verified before failed on readiness this time:
Feeds showed loading placeholders, Search never settled and a report step timed
out waiting for paint. The rejected images show missing or mismatched data
(link warning, hosting confirmation, block, unblock, block-by-list), an error
branch (age result), placeholders (Feeds) and two starter-pack wizard steps
drawn under the status bar. Those failures belong to P1. The app returned to
Home. Its footprint grew from 0.8 to 3.4 GB during the run. The review is in
`.local-dev/inventory-v2-20261007/p0-review.json`.

### P1. Fix attempted plans that still fail

25 candidates, ceiling 133.

- 8 native presentation timeouts. Check these first after P0, since some may
  share the orphaned-sheet cause.
- 3 email dialog steps with no content slot inside their native sheet.
- 3 views with incoherent subjects: the link warning lacks its real URL, the
  block dialog lacks another account, and the list-block prompt lacks a real
  blocking list. Take each subject from the opener's own record.
- 2 long lists that never settle. Accept a list once its first screen of rows
  has loaded.
- 2 routes that need real parameters.
- 2 starter-pack sheets still loading.
- 5 single cases: a CAPTCHA web view, a paint wait, a target-identity wait, a
  binding timeout and a handoff entry.

### P2. Screen catalog and compound openings

43 candidates, ceiling 176.

Work, in order:

1. Build the screen catalog described above and make capture runs read it.
   The planner holds every entry from the start, with prerequisites, alternate
   parents and the strategy ladder. It retries a view only when its evidence
   changes, such as a new owner binding or new data. 7 rows need nothing else,
   such as the new-chat dialog and the search filters.
2. A real-data index holds records from the query cache and observed route
   parameters, with their provenance. Keep the reader behind a small interface,
   since other apps use SWR, Apollo or Redux rather than React Query.
3. Route parameters come from that index for 8 unreached routes, such as video
   feeds, labeler likes and conversation settings.
4. Data search finds a loaded record that makes a data-gated opener appear: a
   bot badge, a labeled post, a verification badge, a live status, an external
   embed, alt text, a backdated post. This covers 13 rows.
5. Compound openings: open a menu or parent dialog, wait for the exact owner
   commit, then use the item's approved control. This covers 13 rows: post,
   profile, share, list and starter-pack menus, steps inside the muted-words and
   lists dialogs, and deleting the existing app password.
6. Global openers take a real argument: the lightbox gets a real image, and the
   drawer opens through its state setter.
7. The canvas draws source-proven paths for every view and marks which edges a
   live run observed. The map then shows how users reach a view, even when its
   capture was a preview.

Gate: every row in the frozen set is captured or blocked with a named reason.
Two valid parents keep two recipes. An invalid first parent doesn't block the
second.

### P3. Body previews with real data

58 candidates, ceiling 234.

- 18 gated dialogs, such as age assurance, verifier prompts, the labeler limit
  and chat-disabled appeals.
- 14 finite steps inside dialogs, such as code entry and confirmation steps.
- 10 shell gates: queued, suspended, deactivated, age assurance and policy
  screens.
- 7 onboarding steps.
- 7 composer and editor states, such as alt-text dialogs and discard prompts.
- 2 contact-flow steps.

The work is the preview host for bodies, prop-flow analysis from a mounted
owner, type-shaped record matching, control creation, and local draft state for
composer dialogs. Build them in that order, and probe each kind on three rows
before applying it to the whole group.

Gate: manual review checks presentation, safe areas and data in every image. No
image shows invented data. Each capture record names the final body and
variant, its data provenance and its live-path condition.

### P4. Test-account fixtures

22 candidates, ceiling 256. This phase needs your authorization.

These rows need content this account doesn't have: an own starter pack, a group
chat with an invite link and a join request, a second signed-in account, a
saved draft, a conversation with a blocked user, a live status and
moderation inbox items. A separate fixture script outside the generic mapper
would create them on a dedicated test account, never on the personal one. The
mapper itself stays read-only.

### Not capturable under the rules

The created app-password screen displays a credential. The email-verification
intent needs a real token. The contact-match step needs a server result. The
update-channel sheet is internal. These four rows stay visible in reports with
their reasons.

## Speed track

This track runs alongside the phases. The healthy warm baseline is 44.8 seconds
for the fixed 20, which is 2.5 seconds per correct view. At that rate a full
inventory run would take about 11 minutes. Take each step only after measuring
the one before it:

1. **Health guard.** It removes the degraded-app penalty, worth 18 seconds in
   the run we saw.
2. **Parent reuse.** Prepared jobs are already sorted by parent route and shared
   opening steps, and the queue can keep an open parent. The fixed 20 still
   spends about 8.8 seconds navigating and 8.6 seconds restoring. Trace why
   reuse fails between siblings before adding any cache. Body previews and
   compound openings share parents, so P2 and P3 benefit directly.
3. **Fix the per-run memory retention.** Check preview trees, provider copies,
   indexed fiber maps and the Hermes heap after cleanup.
4. **Pipelined saving.** Encode and save one image while the next view opens.
   The screenshot wait is at most 5.7 seconds of the fixed 20.
5. **Parallel simulators.** Cloned simulators would scale throughput close to
   linearly. This Mac has 48 GB of RAM and 14 cores, but only 24 GB of free
   disk, which limits clones.
6. **A native development helper.** It could suppress native animations and
   speed up screenshots, but it needs an app rebuild. Consider it only if
   animation waits dominate after steps 1 to 5.

Report per-view time on the fixed 20, on a new fixed set of 20 body previews,
and on the full inventory. Report cold and warm runs separately.

## Decisions I need from you

1. **Body previews of gated views.** Should they count as coverage, labeled as
   UI previews? Some are views this account can never open live, such as the
   verifier prompts.
2. **Test account.** May I plan the P4 fixture script, and will you create a
   dedicated test account for it?
3. **Disk space.** Parallel simulators need roughly 20 to 30 GB more free disk.
4. **Native helper.** I'd defer it. Decide after the speed track's first four
   steps.

P0 to P2 don't depend on any of these decisions.

## Risks

- A body preview can differ from the live view in presentation or safe areas.
  Rendering it over its natural parent and reviewing every image limits that.
- Contained effects can leave a body loading. Readiness rejects skeletons, and
  such rows become blocked with a named reason.
- Static containment can be wrong about which parent mounts an opener. Probe
  each group on a few rows before building for it.
- Every phase will land below its ceiling. I'll report measured yield per phase
  and won't project a final total until P3's frozen set shows how well body
  previews work.

No production code may contain rules specific to the test app. Every technique
here is framework-level: source identities, live providers, query caches and
dialog controls.
