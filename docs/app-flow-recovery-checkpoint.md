# App Flow identity and recovery checkpoint

7 October 2026, late evening. This follows the
[catalog checkpoint](app-flow-catalog-checkpoint.md). Plugin version 0.1.197;
test app at `2d8e349afd92d2be3ff31f298bc27ab0d82c61cc`. Nothing was committed,
pushed or released.

## Coverage

Manually reviewed captures from all runs since the native fix now cover
**126 of 260** reference views: 87 live and 39 previews. The honest count at the
catalog checkpoint was 118.

One default "Map app" run, with nothing reused from earlier runs, now covers
**121** reference views by itself. It saved 154 images in 17.2 minutes,
including three app relaunches. The two previous full runs failed after 50 and
82 captures. All 128 of its credited rows were reviewed. 121 are correct:

- Six rows were rejected because their previews used data that does not fit the
  view: the age-assurance error branch, a link warning without a destination, a
  block prompt over Notifications, an unblock prompt with a Block button, a
  list-blocked notice listing no lists, and a hosting confirmation with no
  provider.
- One row was a double credit, now fixed (see below).

## What changed

**Capture identity.** A shared shell such as a prompt wrapper is rendered by
many callers. The capture build now marks every controller site the scan found;
on Bluesky that is 31 more markers, all in components that were already
instrumented. When an image is saved, the app records the marked sites above the
opened element that pass the same controller, with the prop that carried it. The
comparator credits controller views only from those sites. This removed the
false new-account chat credit. It also stopped one chat settings element, which
passes two controllers, from crediting both of its dialogs.

**One view per caller.** Discovery names each listed controller by the
outermost site passing it. A shell previewed under several callers is now one
node per caller, and replay opens only that caller's copy, even when two callers
are mounted in one scope. In the default run, the shared discard prompt became
three captured views: the profile editor, the list editor and the chat menu.
Previously all three collapsed into one node.

**Relaunch recovery.** Some app states cannot be restored in place: a native
sheet that never confirms dismissal, a fatal JavaScript error, or an app too busy
to acknowledge the inspector within two seconds. The first full run of this
stretch failed exactly that way after 264 seconds, with the app at 3.7 GB and
200% CPU. A run now relaunches the app through the simulator or `adb`,
reconnects and resumes the queue. The view that was opening gets one more
attempt; a second failure blocks only that view. A run may relaunch three times,
plus once more after every ten new captures, so a failure that recurs without
progress still ends the run. The run that followed relaunched three times and
blocked one view, a sheet inside the sign-up preview that never confirmed
dismissal. It finished its queue and then failed on a fourth native failure
during cleanup, before the progress-based allowance existed.

`app_flow.relaunches` and `app_flow.relaunch.*` report relaunch counts and
command time. Identity sites, app and device identifiers stay local.

All 627 App Flow and telemetry tests pass. The development build, the app's
compiled client and the installed plugin copy match.

## Speed and health

The run's largest in-app batch spent 239 seconds:

| Work | Seconds |
| --- | ---: |
| Readiness waits | 108 |
| Navigation | 39 |
| Restoration | 32 |
| Source binding | 21 |
| Motion probes | 20 |
| Screenshot waits | 17 |
| Tree structure | 16 |
| Commit observers | 14 |

These overlap. Successful captures took 2.1 seconds at the median and 5.7 at the
90th percentile. The 45 failed attempts took 243 seconds, mostly timeouts that
wait for the full deadline. App memory grew from 0.8 to 3.1 GB before the first
relaunch, and the app ran at 100% to 180% CPU during capture. After a run, the
app can stay at 83% CPU in native networking, animation and audio threads while
JavaScript is idle; a relaunch clears it.

## Next

1. Readiness is the largest cost. Find what each view waits for, and end
   attempts early when the target cannot appear.
2. Compound openings: menu openers in repeated rows, such as post, share and
   list menus, never open, because the runtime refuses to choose between rows.
   Choosing the first visible row would reach them; this needs a decision.
3. Preview data coherence for block, unblock, list-blocked, link warning,
   hosting confirmation and age result.
4. Tree indexing is about 12% of in-app work.

Evidence is in `.local-dev/identity-20261007/`: run results, reviews, memory
traces and comparisons.
