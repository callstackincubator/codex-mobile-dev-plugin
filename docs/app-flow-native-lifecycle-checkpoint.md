# App Flow native sheet checkpoint, 7 October 2026

The blank native sheet reproduced in a two-view run. A login preview opened a
hosting-provider sheet, then changed to the account chooser. Replacing the
login body removed the sheet's React owner before its native controller closed.
The mapper saved the covered account chooser as a successful capture.

The shared executor now closes that owned child through its approved control,
waits for native dismissal, and only then replaces the preview body. It keeps
cleanup records until closure succeeds. This uses component ownership and
native lifecycle evidence; production code contains no test-app rules.

If an open native host disappears without a close event, capture stops. Removing
React content no longer counts as proof of native dismissal. A fixed failure
and owner token survive inspector replacement. A real close observed by the
retained owner can clear that failure. Once cleanup has removed its observers,
an app reload is required. No fibers or account data remain in the shared guard.

Class adapters with no observed native event do not prove that a native window
exists. Their stale `visible` flag caused a false positive during the first
test; the final guard uses dispatch hosts or observed adapter events. Detached,
silent adapters release their observers during the run. Repeated ownership
checks reuse the same committed tree and native-event revision.

The tests used the existing Metro server and installed Mobile Dev 0.1.197 on
the iPhone 17 Pro simulator. Plugin source started at `fceb294`; app source was
`2d8e349afd92d2be3ff31f298bc27ab0d82c61cc`. The prepared source hash remained
`104c54b6734e35fe0997f14d89567db51f2976c91781d9b4d5db7a6737f9db9b`.
The app retained only its existing reversible Babel instrumentation changes.

| Check | Wall time | Preparation | Capture queue | Correct images |
| --- | ---: | ---: | ---: | ---: |
| Minimal sequence, before | 8.178 s | 0.337 s | Not compared | 1/2 |
| Minimal sequence, final | 9.479 s | 0.320 s | 8.187 s | 2/2 |
| Fixed 20, historical control | 42.665 s | 0.310 s | 41.331 s | 18/20 |
| Fixed 20, first passing patch | 46.600 s | 0.335 s | 43.962 s | 18/20 |
| Fixed 20, final | 43.015 s | 0.320 s | 40.935 s | 18/20 |
| Notification group, before | 27.494 s | 0.332 s | Not compared | 15/15 |
| Notification group, after | 30.114 s | 0.360 s | Not compared | 15/15 |

Recorded map wall time includes preparation, execution, saving and final cleanup. Queue time
includes native openings, readiness, screenshot acknowledgements and queue
restoration. It excludes host preparation and final host teardown. The fixed-20
control comes from the earlier saved benchmark, so it is not a paired cold-start
comparison. The final patch ran after the minimal sequence. These results do
not show a material speed gain. These maps used an already instrumented app.
The preparation column measures each map's host setup. Plugin build, prepared
client refresh, Metro reload and preceding warm-up runs sit outside these map
times; this checkpoint did not measure their combined cold-start cost.

All 19 saved images in each fixed-20 run were inspected. Eighteen are valid.
ReportDialog still displays "Invalid report subject" and does not count.
The composer confirmation named Basic remains `needs-data`, with no image.
The same 20 IDs and recipes remain in the benchmark. The signup fields, real
data, native presentation, safe areas and readiness checks remain intact.

The minimal sequence also passed twice before the final build, in 8.640 and
10.506 seconds. Its account chooser and subsequent Settings captures are clean.
Both 15-view notification groups have valid images. Home restoration after the
final benchmark was checked on the device; no leftover sheet was visible.

| Fixed-20 measured work | Historical control | Final |
| --- | ---: | ---: |
| Source opening | 9.214 s | 7.748 s |
| Navigation | 8.979 s | 8.789 s |
| Rollback | 8.929 s | 8.617 s |
| Readiness | 7.828 s | 8.699 s |
| Screenshot acknowledgement | 5.659 s | 5.659 s |
| Structure indexing | 6.256 s | 5.242 s |
| Native motion inspection | 0.784 s | 2.133 s |

These measurements overlap and must not be summed. Source time includes actual
opening work. Source and structure times fell in this sample; readiness and
motion inspection rose. The aggregate result gives no basis for a speed claim.
During the final run, one diagnostic sample recorded 58 ownership checks and
268 reuses. This proves cache use, not a throughput improvement.

The focused App Flow tests passed 331 cases. Two focused telemetry tests also
passed. The late-preview-close cases passed again after their assertions were
extended. Tests cover owner replacement, interrupted dismissal, late real
events, shared failure state, cache invalidation, source fallback, reconnect
termination and observer cleanup. The development build passed. Existing Sentry
capture, readiness, opening and restoration measurements remain in place; new
bounded ownership diagnostics stay local.

The final compiled runtime and prepared client were loaded and tested without
restarting Codex or Metro. The built host error handling is installed for the
next Mobile Dev connection reload. The running host still uses its prior
server code, so the new host error classification and fallback handoff have
behavior-test proof, while the in-app handoff has live proof. Matching server
source maps remain in `.sentry/server`.

Evidence lives in `.local-dev/native-lifecycle-20261007/`. It includes saved
runs, unchanged selections, phase totals, manual image verdicts and review
contact sheets. Original PNGs remain in Mobile Dev's run store. Key run IDs:

- Reproducer before: `fb3892ff-c673-4256-9620-533ab96e0b03`.
- Minimal final: `a75b220c-b2a2-492f-a1d6-b283e0eeffd5`.
- Fixed 20 final: `b0e7c23d-1384-4382-8fb2-27d74e15eba7`.
- Notification group before: `4a1f5f23-7796-411c-a541-0da664bf992c`.
- Notification group after: `36d3008a-677d-4e27-8287-7dedbe28b0d9`.

Continue with the coverage plan's identity audit and persistent catalog with
explicit prerequisites. The 260-view denominator still needs review, and this
checkpoint does not establish a new full-app coverage total. Keep the shared
executor. The reproduced lifecycle failure has an app-agnostic fix and does
not currently require a native helper or app rebuild.
