# App Flow readiness experiment, 7 October 2026

Reducing repeated tree scans did not produce a meaningful speed gain. The
candidate is removed from the active runtime. The existing shared executor and
its readiness checks remain in place, with new bounded timing diagnostics.
The prototype and its tests are saved locally for reference.

## Fixed benchmark

Every full run used the frozen 20-view selection, recipes, source hash and real
route parameters. All ran through the compiled in-app executor, on the same
simulator and existing Metro server. No case was dropped or replaced.

| Run | Preparation | Capture and restoration | Total | Correct |
| --- | ---: | ---: | ---: | ---: |
| Original path | 0.269 s | 43.446 s | 43.715 s | 18/20 |
| Deferred index rebuild | 0.342 s | 42.549 s | 42.891 s | 18/20 |
| Deferred rebuild plus subtree reuse | 0.321 s | 44.569 s | 44.890 s | 18/20 |
| Candidate repeat, after reload | 0.263 s | 43.537 s | 43.800 s | 18/20 |
| Original path restored, after reload | 0.282 s | 42.038 s | 42.320 s | 18/20 |

The first two candidate variants followed a six-view check. The final candidate
and restored control each started from Home after an app reload. Feed content
and network timing can vary even with fixed route data. These samples show no
substantial gain and do not establish a stable regression either. They reject
the expected large benefit from this optimization.

Preparation starts with the map request and covers scanning, connection and
manifest setup. Capture includes source approval, actual opening, loading,
native transitions, screenshot checks and restoration. The table does not
include one-time development build setup. For the final pair, `prepare-build`
took 0.222 s for the candidate and 0.202 s for the control. From requesting app
reload to observing Home, elapsed time was 14.267 s and 18.786 s. Those are
upper bounds that include tool and operator delay, not measured startup times.
Earlier build setup and reloads were not timed end to end. No cold-start speed
claim follows from this experiment.

All five runs saved 19 PNGs. Manual review of every PNG found the same 18 correct
views, with settled content, native presentation and safe areas intact. The two
known failures remain in the selection and outside the success count:

- `ReportDialog` shows "Invalid report subject".
- The Basic discard-composer branch remains `needs-data`.

No run error or app crash occurred. Final image inspection confirmed Home was
restored without a leftover sheet. The map and log session are stopped.

## Change tested

The first variant refreshed image and native presentation listeners on every
commit but deferred full source/name/props indexing until a consumer needed it.
The second also reused native-host metadata for React subtrees whose exact
child list remained unchanged across paired alternate fibers. It kept a full
walk fallback, fresh native props and geometry, and live navigation focus.

Focused tests covered real React bailouts, descendant updates, new siblings,
hidden and revealed controls, image loading, native dismissal and cleanup.
Both six-view checks captured the correct auth forms and nested sheets. The
optimization preserved correctness in the fixed benchmark but did not improve
its elapsed time enough to justify the added cache and invalidation rules.

## Measured cost

| App-side timing | Original path | Final candidate |
| --- | ---: | ---: |
| Full structure indexing | 259 rebuilds / 6.496 s | 168 rebuilds / 3.850 s |
| Commit observer | 298 calls / 6.439 s | 302 calls / 2.733 s |
| Presentation focus lookup | 0.815 s | 2.267 s |
| Readiness waits | 9.030 s | 9.780 s |
| Navigation | 8.044 s | 8.057 s |
| Source opening | 9.098 s | 8.156 s |
| Rollback | 8.805 s | 8.477 s |
| Screenshot acknowledgement wait | 21 frames / 5.647 s | 22 frames / 6.190 s |

The synchronous timings overlap. For example, indexing runs inside commit
observation or focus lookup. They must not be summed or treated as exclusive
CPU time. Source timing includes actual opening, not just debugger overhead.
Screenshot wait includes transport, encoding, validation, saving and the
acknowledgement. Extra frame attempts retain the existing identity checks.

The candidate reduced work in the commit callback, but moved some indexing
into readiness probes. The large outer waits barely fell or grew. That is why
a smaller commit timing did not translate into faster mapping. The final
control finished faster even though it requested 23 frames.

## Decision

Keep the diagnostics and the original capture path. Do not continue this cache
experiment or expand coverage in the current checkpoint. A useful next
experiment should target repeated opening and settling of a shared parent,
starting with the exact reasons the executor discards that parent's readiness
proof. These measurements do not justify promising twice the throughput.

A native helper could reduce screenshot transport and native transition time,
but those savings remain unmeasured. A helper inside the target app requires a
development native module and an app rebuild. It was not added here, and the
pending rebuild decision did not block this experiment.

56 focused behavior and telemetry tests pass on the retained implementation.
Sentry timing boundaries remain unchanged. New local diagnostics contain fixed
numeric labels and no app data; tests cover batch reset, frozen totals and
logging failure. No lint, typecheck, visual suite, full-260 sweep, recording,
Codex restart or new Metro server ran.

Local evidence is in `.local-dev/readiness-checkpoint-20261007/`, including
the original selection, all run results, reviewed contact sheets and
`candidate.patch`. Full-run IDs, in table order:

1. `eef784b6-206f-4dc7-ad5b-c56a4825689d`
2. `130edaf9-8161-4c5a-81e1-ecfde2b5ea97`
3. `6624a27b-ae08-4ed8-b053-40ff47d6c3b3`
4. `dcc1e74c-97cf-4c9a-bffe-3824b93be2cc`
5. `3c34d97a-80ba-4fa6-ad1b-18216b27c411`
