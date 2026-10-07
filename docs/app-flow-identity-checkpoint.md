# App Flow identity and opener checkpoint, 7 October 2026

This checkpoint corrects capture credit in the comparison tooling, fixes one
opener rule in the runtime, and records what slowed the benchmark. Plugin source
started at `fceb294` plus the uncommitted native-lifecycle work; the test app
stayed at `2d8e349afd92d2be3ff31f298bc27ab0d82c61cc`. The plugin version is still
0.1.197. Nothing was pushed or released.

## Loaded code

The host changes from the native-lifecycle checkpoint now have a live check. The
MCP process used here started after that build and loaded it. The minimal
login → hosting provider → account chooser → Settings sequence captured both
views correctly in 10.557 seconds. Host-side `FlowNativeFailure` handling still
has behavior-test proof only, because no native failure occurred.

The runtime changes below were built, copied into the app's prepared client and
loaded with an app reload or relaunch. The installed plugin copy now matches this
build; its previous files are kept in `.local-dev/inventory-v2-20261007/installed-before`.

## Capture credit

The comparator now credits only the final captured body. Runtime discovery lists
every active view, including ancestors still mounted around the body, and a view
opened by an earlier step of the same chain no longer receives the child's image.
A generic boundary also matches both source names of a wrapped owner, such as
`export const AfterReportDialog = memo(function BlockOrDeleteDialogInner…)`.

| Reviewed run `cb0247fb` | Views | Live | Preview |
| --- | ---: | ---: | ---: |
| Frozen v1 report | 68 | 42 | 26 |
| Corrected comparator | 69 | 42 | 27 |

The after-report dialog image was already manually accepted; it is not a new
capture. The signup handle image no longer appears among the account-details
attempts; it never inflated the count. Source coverage is unchanged: 164
route/action plans, 83 preview plans, 13 source-only rows and no collisions. The
`--accepted` option applies the manual review, so the main command reproduces
these counts. Both corrections have regression tests that fail on the previous
comparator. The v1 reference file is unchanged. Known v1 audit notes
(`sheet:channel`, `guard:age-return`, notification purposes) are recorded in the
ledger, not applied.

## Where the unattempted rows sit

None of the 126 rows without an attempt (127 before the alias fix) was queued and
left behind; the broad run had no pending nodes. Each row's opener never became a
node. A local static JSX containment pass gives the likely parent screens:

| Unattempted rows | Count |
| --- | ---: |
| Opener under a captured route | 54 |
| Opener under a route that failed | 10 |
| Opener under an unreached route | 6 |
| Opener without a route ancestor (shell, global) | 31 |
| Route not reached | 12 |
| Source only | 13 |

Static containment cannot prove that a list row or conditional branch was
mounted. Six openers from the first group were queued directly on their captured
parent:

| Row | Result | Cause |
| --- | --- | --- |
| Sign-out prompt | Captured | Opener below the fold; runtime rule fixed |
| Remove account | Blocked | Needs a second signed-in account |
| Beta feedback | Blocked | Opener disabled until a beta feature is enabled |
| Search filters | Blocked | Rendered only with an active search query |
| Hide trending | Blocked | Feed interstitial not mounted |
| Germ button | Blocked | Needs a profile declaration |

One of six was an engine rule. The other five need data or account state the
mapper must not create. This sample is too small to estimate the group's yield.
The ledger is in `.local-dev/inventory-v2-20261007/ledger.json`; rows without a
probe keep the blocker `unknown`.

## Runtime changes

Control openers (sheets, dialogs and prompts) may now use an entry below the fold
of a vertical scroll view. Scroll reachability also accepts a scroll view inside
the owner, as for a screen rendering its own list; before, it required the owner
inside the scroll view. Horizontal pages, pagers, fixed scroll views, hidden
ancestors and disabled entries still block. State openers still need a visible
entry.

Plain openers now report their first unmet requirement instead of the generic
"no live owner, control, or real context" message. The beta feedback probe now
reports a disabled opener. Preview controls and missing bindings keep their
existing messages. Reasons are fixed strings stored in the local map; telemetry
is unchanged.

## Fixed-20 benchmark

| Run | Wall time | Preparation | Saved | Correct |
| --- | ---: | ---: | ---: | ---: |
| Previous final (`b0e7c23d`) | 43.015 s | 0.320 s | 19 | 18 |
| New host, debug log stream attached (`8ef99c56`) | 56.479 s | 0.477 s | 18 | Not inspected |
| Cold, fresh app process (`d196725a`) | 48.350 s | 0.308 s | 19 | 18 |
| Warm, degraded app process (`a3a4ef1b`) | 63.184 s | 0.387 s | 19 | 18 * |
| Warm, healthy app process (`a36a7633`) | 44.825 s | 0.322 s | 19 | 18 * |

All 19 cold images were inspected. The two known failures remain: ReportDialog
shows "Invalid report subject", and the composer confirmation `Basic` needs data.
\* The warm runs saved the same 19 nodes; three variance-prone images from the
healthy warm run were inspected, not all 19. The runtime change gives no speed
gain on this set, and none was expected.

The slow runs had measurable causes outside the capture path:

- A debug-level `log stream` from Mobile Dev's log feature attached during the
  56.5-second run. The app's network thread then spent a full core serializing
  debug logs. `HostingProviderDialog` timed out in that run.
- The app process sometimes enters a native networking loop: about 85% CPU and
  roughly 10 MB/s footprint growth while JavaScript is nearly idle. Mapping
  doesn't cause it. One fresh launch entered the loop with no mapper attached,
  another stayed at about 1% CPU for 6.5 minutes, and the loop once began
  30 seconds after a minimal run but not after three later runs. The process
  that ran before this checkpoint had reached 9.3 GB. A relaunch cleared it each
  time, so the tool can detect it and relaunch before capturing.
- Each capture run left memory behind: about 150 MB per 2-view run and 450 MB
  after one fixed-20 run, without release while idle.

Benchmarks need a fresh or verified-idle app process and no debug log stream.
Heartbeat time is a usable health signal: 78 ms in the healthy warm run against
2.1 s in the degraded one. Traces are in
`.local-dev/inventory-v2-20261007/memory-trace.txt`.

## Validation

Focused tests: 346 pass across presentations, runtime handoff, capture driver,
capture batch, runtime, reconnect, opening data and views comparison. The
development build passed. No lint, typecheck or visual suites were run.

Metro on port 8082 stopped when the Codex session that owned it exited. It was
restarted with the same command (`expo start --dev-client --port 8082`) and its
log is in the evidence folder. The app returned to a clean, signed-in Home after
each run.

## Next

1. Find what each run retains (about 150 MB per short run). Check preview trees,
   provider copies, the indexed fiber maps and the Hermes heap before and after
   cleanup.
2. Record the app's health before each run (idle CPU, heartbeat latency) and warn
   when a debug log stream is attached, so timing reports are comparable.
3. Probe the other openers under captured routes with the named reasons, and
   record blockers in the ledger before building planner changes.
