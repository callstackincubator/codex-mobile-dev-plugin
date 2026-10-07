# App Flow screen catalog checkpoint

7 October 2026, evening. This follows the
[identity checkpoint](app-flow-identity-checkpoint.md) and implements the first
parts of P1 and P2 from the [full coverage plan](app-flow-full-coverage-plan.md).
Plugin version 0.1.197; test app at `2d8e349afd92d2be3ff31f298bc27ab0d82c61cc`.
Nothing was committed, pushed or released.

## Coverage

Manually reviewed captures from all runs since the native fix now cover
**118 of 260** reference views. The comparator reports 119; one of those credits
is wrong (see "Known gap"). The live and preview split before that correction is
85 live and 34 previews. The count started this session at 69, and P0 brought it
to 108.

The default "Map app" run and a seeded catalog sweep added Search, Feeds,
InviteScanner, the people step of the starter-pack wizard, send-via-chat, add
and delete app password, the contact-sharing step and the sign-out prompt.

## What changed

**Screen catalog.** Every finished run merges its screens, real params, working
recipes, edges and latest results into a local catalog per project. Catalog
runs replay `all` or `missing` screens. Review verdicts recorded through the
`catalog` action keep the catalog's accepted captures honest; a rejected image
returns the screen to `missing`.

**Seeding.** The scan records which registered screens render each opener's
owner. Catalog runs add a one-step recipe for every opener and linked route no
run has reached. The first sweep attempted 362 screens in 269 seconds and
captured 18. Of the 339 that needed data, 133 openers could not be bound on
their parent screen and 146 previews had no live owner or context. The other 60
needed route params, were outside the preview body, ambiguous or disabled. One-step
recipes are too shallow for most of this app; the openers sit in menus, list
rows that need particular data, or deeper parents.

**Readiness.** Fabric measurement now falls back to the UI manager when a host
has no public instance. Before, readiness measured some screens by a single
back button and skipped real loaders; this is why the Feeds placeholders and a
wizard spinner passed as captures. Placeholder query data counts as loading while
it fetches. Loading timeouts name the component. Temporary Modal previews keep
their original frame, which fixed the wizard steps drawn under the status bar.
LogBox notifications stay out of screenshots during capture.

**Robustness.** One emoji in a command crashed whole runs, because the debugger
path re-encoded it as separate surrogates; expressions now escape surrogates.
Views that time out on query data get one later attempt. Failed runs keep the
runtime error detail. The native ownership guard ignores hosts that never
reported a lifecycle event; a zero-event modal host had stopped a 455-second
default run. The previous session's native fix had also broken an inline
preview test, which now models the real close.

All 599 App Flow tests pass. The development build passed and the installed
plugin copy matches it.

## Speed and health

On a freshly launched app, the fixed 20 kept 18 correct views in about 46.7
seconds of capture time, close to the earlier 44.8, while now waiting for
loaders it used to miss. The full default run's in-app profile shows tree
indexing at about 174 seconds of 450, rollback 81, readiness 116 and navigation
61, overlapping. Indexing is the largest speed target.

The app often starts in a runaway networking state; three relaunches in a row
were needed once. Per-run memory growth continues, about 0.8 to 3.4 GB in P0.
A health check with relaunch recovery would make long runs reliable.

## Known gap

A preview of a shared component, such as a generic prompt shell, carries the
source views of every instance it could open. The comparator credited the
new-account chat prompt from a capture that shows the profile editor's discard
prompt. The capture must record the opened instance's exact JSX site, and the
comparator must credit only that site. Resolved in the
[identity and recovery checkpoint](app-flow-recovery-checkpoint.md).

## Next

1. Record the opened instance's source site at capture time and credit only
   that site.
2. Compound openings: open a menu or parent dialog, then its item.
3. Health check and relaunch recovery for long runs.
4. Reduce tree indexing work in the default mapper.

Evidence is in `.local-dev/inventory-v2-20261007/`: reviews, sweep results,
memory traces and the union comparison.
