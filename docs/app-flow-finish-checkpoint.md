# App Flow finish-line checkpoint

8 October 2026. Plugin version 0.1.197; test app at
`2d8e349afd92d2be3ff31f298bc27ab0d82c61cc`. Commits are local on
`codex/app-flow`; nothing was pushed or released. This follows the
[recovery checkpoint](app-flow-recovery-checkpoint.md).

## Where it stands

Manually reviewed captures now cover **149 of 260** reference views: 88 live
and 61 UI previews. The previous checkpoint counted 138.

A default "Map app" run takes about **10 minutes** instead of 24 and saves 175
to 181 images, depending on the feed content of the day. Runs 7 to 10 took
12.3, 12.4, 12.3 and 12.0 minutes; run 15, after views that cannot change stop
waiting, took 9.9 minutes and saved 178 images, including every view runs 7 to
10 always captured. Retries now take 7 seconds instead of about 100, and
failures 135 seconds instead of 229. Single runs vary by 10 to 15 percent.
With the iOS simulator animation library, presentations captured 22 to 27
percent faster per view than in run 15; whole runs took 9.3 and 10.4 minutes.

| Run | Minutes | Images | Relaunches |
| --- | ---: | ---: | ---: |
| 3, before this work | 23.8 | 172 | 3 |
| 7 | 12.3 | 179 | 4 |
| 8 | 12.4 | 181 | 4 |
| 9 | 12.3 | 177 | 7 |
| 10 | 12.0 | 175 | 4 |
| 15, idle views stop waiting | 9.9 | 178 | 4 |
| 19, plus fast native animations | 10.4 | 178 | 3 and a fresh start |

Each run marks about 63 views it did not find as needs-data, under the screen
that should show them, with the source conditions that can hide them. Retrying
one of those nodes alone takes about 10 seconds.

## What changed

See [capture](app-flow-capture.md) sections from "Faster runs and views not
found" on: retries only for waits that can end, phase timings and relaunch
logs, a progress-based relaunch budget, pacing on the app's CPU probe and tree
size, not-found nodes with quoted source conditions, steps copied beside their
own element and re-attached after parent renders, needs-data for dialogs opened
without their opener's data, renamed component resolution, and compact tool
results.

## The remaining 111

Roughly, by what would unlock them:

- **Data this account lacks** (about 45): a group chat (13 views), lists,
  your own starter pack, a muted word, a saved draft with media, a second
  signed-in account, and profiles of particular kinds (bot, verifier, new
  account, live, labeled). The not-found nodes name the conditions; add the
  data, then use Retry screen.
- **Account states or features** (about 25): moderation inbox, age assurance,
  verifier rights, suspended or queued accounts, beta and live features.
  Unreachable without changing the account.
- **Engine work left** (about 25):
  - Five previews whose live data does not fit: two are now needs-data with
    their missing input named (link warning, hosting confirmation); the
    age-check error branch, the unblock prompt and the list-block notice still
    capture and are rejected in review.
  - The 2FA Disable steps: a second state change inside a copied dialog step
    is placed as a separate window that the sheet covers.
  - The group-name step shows no chosen members.
  - Routes that need params from loaded data, the drawer and image viewer,
    profile menu items, the profile Starter Packs tab and deleting your own
    post.
- **Server results** (about 5): views shown only after a submitted form.

## Known flaky views

- A picker sheet in the sign-up preview fails to confirm its native dismissal
  late in long runs, about 90 captures after a relaunch, and captures in
  isolation; it is not a reference view.
- A state inside the composer's reply-settings dialog fails dismissal every
  time; its owner unmounts before the sheet reports closing. It is blocked
  after two relaunches.

Evidence is in `.local-dev/finish-20261008/`: run comparisons, reviews and
local check scripts.
