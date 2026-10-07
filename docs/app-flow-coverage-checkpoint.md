# App Flow coverage checkpoint, 7 October 2026

The two-hour checkpoint improved several failure paths but did not reach the
coverage, speed or long-run reliability goals. The final full-app attempt saved
108 images in 650.205 seconds. Manual review accepted 84 images; these match
68 distinct views in the frozen 260-view audit. The other 24 images must not
count. An orphaned native sheet covered later pages and survived restoration.

The final fixed 20-view run preserved the 18 correct captures, but two earlier
runs of the same final code each lost two report steps to loading timeouts. Those
steps passed in isolation, then passed in the complete selection. This remains
an intermittent failure, not a proven fix. The final warm result is not evidence
of a substantial speed improvement.

## Retained changes

- State rollback excludes native sheets that were already open before the state
  change. Restoring an inline expansion no longer waits for its parent to close.
  Newly opened sheets still require a real dismissal event.
- Source replies acknowledge the debugger before the next opening starts. Stop
  cancels the deferred delivery. Duplicate replies cannot resume a job twice.
- Portal traversal follows the current committed owner. The old alternate could
  retain empty children and hide the native dismissal listener.
- Readiness rejects a target covered by an earlier, still-owned sheet. This does
  not detect a UIKit controller whose React host has already disappeared.
- Preview mounting rejects provider children that would duplicate the live
  navigator. It leaves the case unresolved rather than removing app children.
- A new native preview window preserves app providers but resets native scroll
  and virtual-list ownership, as React Native Modal does. Relocated portal bodies
  also discard their former native scroll ownership. Inline previews preserve
  their existing container context.

These changes use source identity and framework bindings. No production change
names Bluesky, changes account data, executes arbitrary handlers or invents data.

## Fixed 20-view results

Every row uses the frozen selection and recipes from
`.local-dev/readiness-checkpoint-20261007/selection.json`. Every saved PNG in
these runs was reviewed for target, content, presentation and safe area.
Preparation is the recorded run preparation interval. Capture/restoration is
wall time minus that interval; it includes opening, loading checks, screenshots,
failures and cleanup. It does not include prior build/reload work or warm-up runs.
Those are disclosed below rather than treated as free preparation.

| Run | Preparation | Capture/restoration | Total | Correct / 20 |
| --- | ---: | ---: | ---: | ---: |
| Control, b8d3f60e | 0.310 s | 42.355 s | 42.665 s | 18 |
| Ancestry-index experiment, c48a4851 | 0.262 s | 42.763 s | 43.025 s | 18 |
| Navigation guard, 2d605805 | 0.281 s | 42.610 s | 42.891 s | 18 |
| Final code after app relaunch, 4e87bcba | 0.290 s | 50.790 s | 51.080 s | 16 |
| Final code repeat, b11b20d4 | 0.303 s | 48.970 s | 49.273 s | 16 |
| Final code after isolated report check, 570e884a | 0.256 s | 38.670 s | 38.926 s | 18 |

The two original failures remain: the global ReportDialog shows **Invalid report
subject** and is excluded, and the Basic discard-composer recipe lacks its real
parent context. The two additional failures were StepTitle and ButtonText on
the saved CustomFeed parent. Each timed out before opening with `busy` loading
state. Public feed requests returned real data, so expired data was not a valid
explanation. Both later captured correctly with the same parameters in the
isolated run aadbe2f8, which took 8.497 seconds including 0.292 seconds of
preparation. The final 38.926-second row follows that warm-up. It cannot establish
a cold-run speed gain. No fixture, route parameters or readiness checks changed.

The ancestry-index experiment reduced measured motion lookup from 0.784 to
0.306 seconds, but focus lookup rose from 0.840 to 1.509 seconds. Overall time
increased slightly. The experiment was removed from active source and the
installed runtime; its prototype remains in local evidence.

The final warm run spent 6.342 seconds in source opening, 8.365 in rollback,
7.092 in navigation, 9.059 in readiness and 5.750 waiting for screenshot delivery.
These are app-side queue phases. Synchronous `self-*` counters overlap them and
must not be added to them as CPU time. The control's source phase was 9.214
seconds, but the combined changes and different warm state do not isolate the
cause of that reduction. The earlier failed final-code run spent 21.285 seconds
in navigation, including the two loading timeouts. Eliminating screenshot work
alone would still fall far short of doubling throughput.

## Full-app checks and limits

The initial full run stopped at seven saved images after repeated rollback
failures. Later full attempts got past that point, but exposed different failures.
The two fully image-reviewed comparisons are:

| Run | Wall time | Saved images | Usable images | Distinct audit views |
| --- | ---: | ---: | ---: | ---: |
| Current-portal fix, 51f2fefc | 505.952 s | 115 | 81 | 66 / 260 |
| Final code, cb0247fb | 650.205 s | 108 | 84 | 68 / 260 |

These are incomplete runs, not equivalent throughput benchmarks: discovery
changes the queue, and the final run was stopped when the empty sheet recurred.
Both comparisons use each run's source catalog and the same frozen audit.
The final 68 consists of 42 live openings and 26 isolated previews. Duplicate
images and invalid data states do not increase the distinct count.

The final run did not repeat the duplicate-navigation or nested-virtual-list
warnings seen in earlier attempts. It had no source-ack timeout, but still had
four heartbeat timeouts, one presentation-configuration timeout, one
presentation-open timeout and a five-second restoration timeout. Recovery ran
once. No app crash was observed, but this is not a clean completion: Home still
had an empty native sheet. Relaunching the same development app cleared it; the
running Metro and account session were preserved. The final fixed selection then
restored a clean Home screen.

The app process RSS grew from about 2.44 GiB near the start of this process
lifetime to 5.22 GiB after the full run. These two RSS readings include app,
React Native development and mapper work. They do not prove which part retains
memory, and they are not physical-footprint or leak measurements. The native
observer record count was below its bound in the sampled failures, so raising
that bound would not address the evidence.

## Checks and telemetry

234 focused behavior and telemetry tests passed: capture queue, capture driver,
presentations, portals, prepared slots, server telemetry and UI telemetry. Native
context fixtures exercise Modal, inline and relocated portal cases. Tests also
cover current-owner traversal, native dismissal ownership, source cancellation
and duplicate source acknowledgements. No lint, typecheck, React Doctor or visual
test suite ran. Screenshots were inspected manually.

Existing Sentry capture, source, readiness and restoration boundaries remain
unchanged. Local diagnostics retain bounded numeric timings. Provider values,
app content and callback arguments are not added to telemetry. Stop cancels the
new delivery timer; existing observer cleanup remains covered. See
[telemetry.md](telemetry.md).

Runtime/client builds were installed together into the existing 0.1.197 test
connection and reloaded through the running Metro. This was not a new plugin
release. Build/reload work occurred outside timed capture runs. No Codex restart,
new Metro server, native rebuild, video or performance recording ran.

## Decision

Do not count this checkpoint as a speed success or proceed to another broad
rewrite. The compiled shared executor remains the active path. Native sheet
ownership and missing real opening props are still the main correctness gaps.

Claude Opus 5.5's source review identified a concrete next source change: reject
missing required opening props, then support a source-proven compound operation
that sets real opening data, waits for its commit, opens that exact control and
restores in reverse order. That scanner/server work is not implemented here.
A follow-up source-sharing request was blocked by automatic approval review and
was not retried without permission.

Before another full sweep, reproduce the orphaned native sheet with its smallest
source recipe and prove that the native dismissal completes before unmounting
its owner. JavaScript currently loses evidence when a native controller outlives
its React host. An optional native lifecycle observer could make that ownership
explicit; transition suppression could reduce opening/closing waits. Both would
require an app rebuild and separate approval, and neither has a measured speed
benefit yet. Do not add them on the strength of this report alone.

Raw run snapshots, phase summaries, image-review verdicts and the frozen-audit
comparison are local in `.local-dev/coverage-goal-20261007/`. Full-run evidence
includes failed and stopped attempts; it is not limited to the best sample.
