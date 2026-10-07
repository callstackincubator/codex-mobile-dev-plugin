# App Flow performance checkpoint — 7 October 2026

The in-app opening experiment reduced host binding work, but did not produce a
substantial wall-time gain. Keep the small change; do not treat it as evidence
that more approval caching will double throughput.

## Fixed benchmark

All runs used the same saved 20-view selection, source hash, recipes and real
route parameters. The shared executor, loading checks, native lifecycle checks,
pixel identity checks and restoration stayed active. No case was replaced.

| Run | Preparation | Capture and restoration | Total | Correct |
| --- | ---: | ---: | ---: | ---: |
| Before | 0.330 s | 44.536 s | 44.866 s | 18/20 |
| After, with two live diagnostic reads | 0.321 s | 43.872 s | 44.193 s | 18/20 |
| After, without live diagnostic reads | 0.371 s | 41.110 s | 41.481 s | 18/20 |

Preparation runs from the mapping request through scanning, connection and
manifest setup. Source approval and actual opening happen during capture, so
their cost remains in the second column. Total ends after restoration. The
repeat improves throughput by about 8%; the first comparison improves it by
about 2%. These samples do not establish a stable speedup or meet the 2× target.

The table starts with an instrumented, running app. One-time `prepare-build`
calls took 5.165 s for the baseline and 0.241 s for the initial candidate. The
final candidate's app reload and startup recovery were not timed end to end.
These are separate setup costs; this experiment makes no cold-start speed claim.

Each completed run saved 19 PNGs. Manual review of every image found the same
18 correct views, with matching form content, native presentation, safe areas
and settled content. Home was restored. Both known failures remain visible:

- The report-category PNG says “Invalid report subject”; it does not count.
- The discard-composer branch lacks its required real context and remains
  `needs-data`; it does not count.

An additional baseline attempt stopped after 19.673 s and seven saved images
when the app reported “Failed to load video.” It is not a completed timing
sample. A candidate startup attempt also failed before capture while the app
was reloading. Neither failure is attributed to a speed improvement.

## Change tested

The host still approves the source catalog and recipe. Later openings use the
same runtime opener through exact, live registered bindings. Owner changes
refresh those bindings and release retired ones. Missing bindings fall back to
the existing host path before opening; a failed local opening never executes
again through that fallback. Portal and UI-effect approval stays on the host.

An early six-view check lost a nested reducer preview. Reducer previews now
retain the existing host refresh path. The six-view check then passed, followed
by both full checks above. No new coverage case was added to the benchmark.

## Measured cost

| Host operation | Before | After repeat |
| --- | ---: | ---: |
| Source collection | 27 calls / 2.476 s | 12 calls / 1.387 s |
| Source symbolication | 20 calls / 0.557 s | 10 calls / 0.333 s |
| Source configuration | 19 calls / 0.389 s | 9 calls / 0.120 s |
| Source preparation | 19 calls / 0.187 s | 8 calls / 0.098 s |
| Screenshot work | 20 frames / 5.515 s | 22 frames / 5.792 s |

The four host binding operations fell by about 1.67 s in total. Host
`presentation-open` calls fell from 18 to seven, but their remaining work runs
inside the app; that reduction must not be counted as eliminated opening time.
The repeat needed two additional frame attempts and kept the normal identity
checks. No screenshot checks were skipped.

Navigation, settling, native dismissal and screenshot work still take most of
the run. For example, the final report step still took 4.6 s, GIF selection
3.5 s, and conversation capture 3.1 s. These per-view totals include their
opening and cleanup work, so they are not measurements of rendering alone.

## Decision

Keep this bounded reduction in host work. The next experiment should measure
why a shared parent is discarded and which readiness evidence becomes stale
between related views, before changing those paths. Do not expand coverage or
start a broad rewrite to chase the throughput target.

A native capture helper could reduce screenshot transport and encoding costs.
The current screenshot bucket is roughly 5.5–5.8 s, so even eliminating it would
not double throughput. Native transition suppression may save more, but its
benefit has not been measured. Both would require adding a development native
module and rebuilding the target app. No native helper was added here.

65 focused behavior and telemetry tests passed. Existing Sentry capture and
restoration boundaries remain intact; local diagnostics now distinguish full
`source-local` and `source-host` opening time without app data. No lint, type
check, visual suite, full-app sweep or recording ran. There was no Codex restart.

Local evidence, including the failed attempts, original selection and image
review sheets, is in `.local-dev/performance-checkpoint-20261007/`. The baseline
run is `c63831b4-9eb0-40d9-a05e-c7c3c7f6c53e`; the candidate runs are
`d4427257-081d-4da0-a903-4f90448a3c6e` and
`260a0479-6c54-44a5-a9dd-cf3093420720`.
