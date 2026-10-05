# Bluesky source inventory and extraction comparison

The reviewed list contains **260 distinct views**. Plugin 0.1.137 has a distinct source match for **all 260**. There are no missing, container-only or ambiguous reference rows. The comparison has a strict mode that fails if any reviewed view loses its match.

Of the 260 matches, **164 have a route or UI action**, **75 have new UI preview plans**, and **21 have source evidence only**. That gives 239 views with a planned capture path. Plans still need live source bindings, real data and settled content. They do not establish that 239 screenshots can be taken in the current session.

This audit uses the clean iOS checkout at `2d8e349afd92d2be3ff31f298bc27ab0d82c61cc`. The scan read 2,371 files in 4.65 seconds. The comparison does not change or execute target app code.

The saved 0.1.136 run `4e553412-6f1f-49a1-a036-a154a48b2088` has verified
automatic screenshots for **2 of 260 views**, Home and Search. It has no captured
UI previews. The rest of its queued routes timed out with a remounting navigator.
The app log reports hook-order changes, with `useState` becoming `useReducer`,
and a missing media query. Injected wrappers captured loop bindings that affected
Hermes versions share. Version 0.1.137 binds each hook, effect and native completion
handler in its own function scope. Three regression tests fail on the old code
under shared loop bindings and pass with the fix. Discovery and timeout recovery
from 0.1.136 stay intact.

A full live run of **0.1.137**, `36ea26a0-117d-46cb-b6ea-a830aa7e2f02`,
finished in **734.1 seconds** on the iPhone 17 Pro simulator. Saved PNGs with
matching source hashes verify **52 of 260 views**, all navigator routes.
All 52 queued routes captured; four succeeded on their second attempt.
The app kept the same process through the run and returned to Home afterward.
The Hashtag image has loaded content, and the conversation image has no faded
message text. This checks those two images, not every screenshot's content.

**The full mapper still fails this test.** No guarded form, later flow step,
sheet, sheet step or prompt captured. The run reported presentation failures
and left out 27 registered names without a confirmed live entry. Thirteen of
the 65 reviewed navigator views have no verified capture. Source matches and
preview plans still do not prove working capture paths.

Two routes received params from real observed app data through the AI-facing
resolve tool. The test did not invent identifiers, submit forms or issue
account-changing actions. This does not verify background AI sampling on the host.

Two sampling windows during mapping and cleanup recorded an app physical
footprint peak of **7.29 GB**. Memory fell from that peak to **2.91 GB** by the
end of the first window. The windows do not cover the whole run, and there is
no fresh-launch baseline, so these samples neither prove a leak nor attribute
the spike to the mapper. The high memory use and slow run still need work.
The existing capture, readiness, timeout and recovery telemetry stayed intact.

A focused live test of **0.1.139** after reloading Codex,
`3cbc47e9-93f7-4e5c-a1b0-6701f7bec8f2`, captured Home, then timed out in
`presentations` while finding presentation entries. The test stopped at that
first failure, after 16.5 seconds; it was not a full coverage run. Its live
Metro log session returned no hook-order error during that attempt. This
identifies the failed stage, but does not establish its internal cost.
Version 0.1.140 skips native bounds for absent source-bound entries and shares
bounds across related owners within one lookup. Functional tests check both
changes and confirm that later lookups read new layout. A live 0.1.140 attempt after reloading Codex got past that discovery failure.

Run `194b847f-e206-4e3c-9d9e-c22fd0ecd3d3` stopped after **195.4 seconds**
when a UI preview raised an uncaught mapper error. It marked 43 images as
captured, but two showed the React Native error overlay. Excluding those two
leaves **41 app views: 40 navigator routes and one confirmation dialog**.
The dialog image shows the actual “Dismiss interests” sheet. No UI preview
captured. This was an interrupted attempt, not a full coverage result; the
remaining 219 reviewed views have no valid image from this attempt.

The Metro stack pins the error to `focusFor`, which checked whether a fiber
belonged to a null alternate scope. Version 0.1.141 treats that scope as absent
and catches errors in deferred presentation checks. It also observes React
Native's fatal error handler during capture, preserves the app's own error
handling, and stops the run before saving an error overlay. Cleanup removes
that observer without replacing a handler the app installed later. Regression
tests cover the missing alternate, deferred error replies, in-flight capture
failure, cleanup and stopping reconnect retries after a fatal app error.
The full 0.1.141 run after a host reload,
`3581bc05-b62d-4eee-9f52-f2024f47f7b1`, finished in **702.4 seconds**. It saved
**45 of 260 reviewed views**, all navigator routes, with no presentation or
preview images. Three queued views timed out and fifteen were blocked. The
app kept PID 33410 and restored Home beneath a remaining “Dismiss interests”
prompt; I closed that prompt with Cancel. Cleanup therefore did not fully
restore the UI. The fatal-error overlay did not return.
The log buffer dropped warnings, so its reads are not an exhaustive error audit.
PNG headers and source hashes verify these 45 files; their content has not
received a full visual audit. The mapper still fails the broader coverage test.

This run supplied ProfileSearch with a handle from observed query data and
ProfileList with a real URI from the public list endpoint for a profile visible
in the app. It submitted no form, changed no auth state, and issued no account
mutation. Those params did not make every route capturable. Several routes
reported unfinished native transitions; sheet attempts lost their failed step
behind a generic interruption message.

A live **0.1.142** attempt, `ea5bf8ee-38dc-46e5-a08e-b840cf1df973`,
stopped after **87.2 seconds** with five saved route PNGs and no presentation
images. Feeds timed out while opening a route and reconnect recovery stalled.
This was a focused diagnosis, not a full coverage run. It does not establish
an improvement over 0.1.141. The app returned to Home with no visible overlay.

Version 0.1.143 skips plain-host bounds after readiness has filled its existing
250-entry signature and proved visible content. Tests retain late loading,
query, heading and opacity checks. Scoped presentation checks skip bounds for
unrelated owners. Failed close calls keep their restore checkpoints. Local
fixed-name command totals and bounded inspector counts expose the next failed
stage without collecting app content. These changes have functional coverage;
their live speed and broader capture coverage still need verification.

The loaded **0.1.143** run, `60218872-6f2d-4941-8a6f-c252d8aa9871`,
stopped after **300.0 seconds** with eight saved route PNGs and no sheets or
state previews. This was a stopped diagnosis, not a full coverage run. PNG
headers and source hashes match; their content has not all been checked.
The early inspector snapshot hit the 1,500-entry cap, with 19,478 mounted
fibers. Later reads showed repeated install/recovery timeouts. Source
symbolication used 0.6 seconds in total and does not explain the stalls.

Version 0.1.144 shares exact JSX source matches across repeated instances,
frees stale entries before collection and uses initialized owner exports when
available to avoid rendering unrelated same-named components. It keeps
owner/controller ambiguity checks. Busy transition checks remove detached
navigation subscriptions while still waiting for active transitions. New
local numeric diagnostics separate native layout work from tree traversal.
These changes pass functional tests; 0.1.144 live results remain pending.

Version 0.1.142 keeps the fixed operation name in retry status. Its sheet motion
check stops reading bounds once the 24 rectangles used in its signature are
filled, while still checking later hosts for pending transition events. A
regression test checks identical rectangle output, bounded layout reads and
late events under both normal and shared Hermes loop bindings. The change
removes unused native layout reads; it does not shorten readiness waits or
prove faster live mapping. Version 0.1.142 still needs a live run.

Capture comparison checks saved PNG headers and source hashes; those checks
alone did not detect the two error-overlay images. The local attempt report
records their exclusion rather than changing the saved map or counting them
as success. Static extraction still matches all 260 source views. This does
not establish automatic capture of those views.

| Category | Reviewed views | Exact source matches | Container only | Ambiguous | Missing |
| --- | ---: | ---: | ---: | ---: | ---: |
| Navigator routes | 65 | 65 | 0 | 0 | 0 |
| Auth and account gates | 25 | 25 | 0 | 0 | 0 |
| Steps inside navigator flows | 5 | 5 | 0 | 0 | 0 |
| Sheets and overlays | 91 | 91 | 0 | 0 | 0 |
| Steps inside sheets | 29 | 29 | 0 | 0 | 0 |
| Confirmation and information dialogs | 45 | 45 | 0 | 0 | 0 |
| **Total** | **260** | **260** | **0** | **0** | **0** |

| Category | Reviewed views | Verified captures in 0.1.137 |
| --- | ---: | ---: |
| Navigator routes | 65 | 52 |
| Auth and account gates | 25 | 0 |
| Steps inside navigator flows | 5 | 0 |
| Sheets and overlays | 91 | 0 |
| Steps inside sheets | 29 | 0 |
| Confirmation and information dialogs | 45 | 0 |
| **Total** | **260** | **52** |

## Counting rules

The first reference pass came from reading navigator registrations and callers, the native auth wrapper, shell gates, dialog boundaries, and the state/reducer branches that render their bodies. Reviewing unmatched candidates then found omissions in that reference: the moderation notice appeal sheet, account appeal/gate bodies, and the label appeal form inside moderation details. That review also split the eleven fixed notification settings subjects and linked shared wrapper aliases. The reference was corrected without changing production extraction.

Each distinct form or presented body counts once. Shared bodies opened from several parents count once. The first body of a registered wizard already counts in its route; later full-body steps add views. Login and signup wrappers, sheet containers and the onboarding contacts wrapper do not add a view on top of their forms. Notification settings for likes, followers, messages and other fixed subjects count separately because they have separate UI entries and change different settings.

Feature-gated, geography-gated, signed-out, restricted-account and server-result views remain in the list when source establishes a path. This does not mean all are available to the same account. Password reset results, generated credentials and report results require real responses; no forms were submitted, accounts changed or credentials fabricated.

Inline tabs, expanded post text, loading skeletons, ordinary inline errors/empty states, menus, selects, tooltips, autocomplete, keyboards, OS pickers and external browser pages do not add screens. Full-page account gates and separately presented prompts do count. Internal/debug, dead announcement and web-only views have an explicit exclusion list below. This is a reviewable inventory within those boundaries, not a claim that every possible UI state has been proved reachable.

## What changed

- Source previews initialize finite `useState` and `useReducer` selectors in a temporary component copy. Shared-state previews copy one proven reference into its consumer's props or context. They retain real data and leave the original form, reducer and provider intact.
- Temporary copies suppress app effects, including effects that can submit signup forms. A body that needs those effects or missing data can remain blocked. Mounted controllers can open through exact source bindings without a visible button when their opening method needs no arguments and has a known close method.
- Saved automatic captures now carry a local source hash. The comparison counts matching PNGs, excludes recorded steps, and separates live captures from temporary UI previews. A screenshot of a child never counts as a screenshot of its parent.

- Controller destinations now retain the target's exact JSX source range. Runtime binding checks that target as well as its opener, so different `Basic`, `Outer` and notification dialogs do not collapse into one destination or open the wrong instance.
- A separate source catalog follows finite state through `useReducer`, returned custom hooks, tuple/object contexts and component props. It retains each origin when a shared form has several callers, and resolves enum/type-union fallback branches and early render returns. These facts remain separate from executable UI actions.
- Account and server-result views have exact render-branch or component/caller evidence. Eleven old rows lacked a testable selector; this revision adds one for each. It also corrects the case of `Wizard/State.tsx` and identifies the invite announcement's own sheet, rather than its wrapper or the shared invitation dialog. No reviewed view was removed to obtain a match.
- Literal-disabled JSX branches do not prove an entry. The catalog still retains broad render facts for inspection; those facts are not automatically screens. Actual mapping continues to use live entry checks.

The script reports 79 registered route names, 212 opener actions, and 515 preview plans. The source catalog contains 5,535 render facts, including inline UI and component bodies. These facts do not count as 5,535 screens. The report separates routes/actions, preview plans and source-only evidence. It retains 247 unclassified action/preview destinations for review; these are not extra confirmed screens. All reviewed rows have their own proof; finding a parent/container alone never supplies a child form.

The full catalog stays out of runtime injection and canvas polling. It saves once in a separate local file, and a fresh MCP process can load it for inspection. Only compact action/preview plans enter the runtime. Capture timings, readiness checks, retries and account/session rules stay intact.

## Repeating the comparison

```sh
node scripts/compare-app-flow-views.mjs /path/to/social-app \
  tests/fixtures/app-flow/bluesky-views-reference.json \
  --strict --output /tmp/bluesky-views-comparison.json
```

The command requires the pinned revision and a clean tracked checkout. `--write-snapshot` saves the raw scan with revision/platform/plugin provenance. `--snapshot` reuses it only when that provenance matches. It parses source to resolve identities; it does not import project modules. Without `--strict`, gaps remain report data. With `--strict`, any missing exact match makes the command fail.

After a fresh automatic run, add `--capture-map` to measure screenshots:

```sh
node scripts/compare-app-flow-views.mjs /path/to/social-app \
  tests/fixtures/app-flow/bluesky-views-reference.json \
  --capture-map '/path/to/app-flow/<run-id>/map.json' \
  --output /tmp/bluesky-capture-comparison.json
```

The map and scan must have the same source hash, and each counted image must have
that hash and a saved PNG. The report includes each reviewed view's capture status
and attempts. Old maps without image hashes cannot supply this count.

[Reference JSON](../tests/fixtures/app-flow/bluesky-views-reference.json) contains every expected identity, source evidence, guard and selector. [Comparison JSON](../tests/fixtures/app-flow/bluesky-views-comparison.json) contains exact matches, container-only results, collisions and unmatched candidates. The scanner, runtime and comparison implementation have no Bluesky-specific rules. The named views live only in this reference and report.

Functional tests cover exact source bindings, temporary reducer initialization, shared context copies, effect containment, cleanup, failed preview bodies, and capture comparison, as well as the existing extraction and capture paths. Scan and capture telemetry stays intact. Preview metrics count plans, captured previews and blocked previews. Neither sends source, paths, state, hashes or app data.

## Full view inventory

`Route` and `Action` describe extracted access paths. `UI preview plan` describes
a source-bound temporary preview. `Source only` describes a rendered body without
a capture plan. None confirms a successful screenshot in the current session.

| View | Category | Coverage | Reviewed source |
| --- | --- | --- | --- |
| AboutSettings | Navigator routes | Route | [src/screens/Settings/Settings.tsx:182](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/Settings.tsx#L182) |
| AccessibilitySettings | Navigator routes | Route | [src/screens/Settings/Settings.tsx:182](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/Settings.tsx#L182) |
| AccountSettings | Navigator routes | Route | [src/screens/Settings/Settings.tsx:182](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/Settings.tsx#L182) |
| ActivityNotificationSettings | Navigator routes | Route | [src/screens/Settings/NotificationSettings/index.tsx:221](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/NotificationSettings/index.tsx#L221) |
| ActivityPrivacySettings | Navigator routes | Route | [src/screens/Settings/PrivacyAndSecuritySettings.tsx:73](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/PrivacyAndSecuritySettings.tsx#L73) |
| AppPasswords | Navigator routes | Route | [src/screens/Settings/PrivacyAndSecuritySettings.tsx:73](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/PrivacyAndSecuritySettings.tsx#L73) |
| AppearanceSettings | Navigator routes | Route | [src/screens/Settings/Settings.tsx:182](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/Settings.tsx#L182) |
| AutomationLabelSettings | Navigator routes | Route | [src/screens/Settings/AccountSettings.tsx:154](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/AccountSettings.tsx#L154) |
| BetaFeaturesSettings | Navigator routes | Route | [src/screens/Settings/Settings.tsx:182](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/Settings.tsx#L182) |
| Bookmarks | Navigator routes | Route | [src/view/shell/Drawer.tsx:272](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/shell/Drawer.tsx#L272) |
| ContentAndMediaSettings | Navigator routes | Route | [src/screens/Settings/Settings.tsx:182](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/Settings.tsx#L182) |
| CustomFeed | Navigator routes | Route | [src/view/com/feeds/FeedSourceCard.tsx:193](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/com/feeds/FeedSourceCard.tsx#L193) |
| CustomFeedLikedBy | Navigator routes | Route | [src/screens/CustomFeed/components/CustomFeedHeader.tsx:541](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/CustomFeed/components/CustomFeedHeader.tsx#L541) |
| Feeds | Navigator routes | Route | [src/view/shell/Drawer.tsx:272](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/shell/Drawer.tsx#L272) |
| FindContactsFlow | Navigator routes | Route | [src/screens/Settings/FindContactsSettings.tsx:155](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/FindContactsSettings.tsx#L155) |
| FindContactsSettings | Navigator routes | Route | [src/screens/Settings/Settings.tsx:228](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/Settings.tsx#L228) |
| Hashtag | Navigator routes | Route | [src/components/RichTextTag.tsx:27](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/RichTextTag.tsx#L27) |
| Home | Navigator routes | Route | [src/Navigation.tsx:636](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/Navigation.tsx#L636) |
| InterestsSettings | Navigator routes | Route | [src/screens/Settings/ContentAndMediaSettings.tsx:61](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/ContentAndMediaSettings.tsx#L61) |
| InviteScanner | Navigator routes | Route | [src/features/inviteFriends/InviteFriendsDialogInner.tsx:113](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/features/inviteFriends/InviteFriendsDialogInner.tsx#L113) |
| LanguageSettings | Navigator routes | Route | [src/screens/Settings/Settings.tsx:182](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/Settings.tsx#L182) |
| Lists | Navigator routes | Route | [src/view/shell/Drawer.tsx:272](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/shell/Drawer.tsx#L272) |
| Log | Navigator routes | Route | [src/screens/Settings/AboutSettings.tsx:117](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/AboutSettings.tsx#L117) |
| Messages | Navigator routes | Route | [src/Navigation.tsx:636](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/Navigation.tsx#L636) |
| MessagesConversation | Navigator routes | Route | [src/screens/Messages/components/ChatListItem.tsx:494](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Messages/components/ChatListItem.tsx#L494) |
| MessagesConversationSettings | Navigator routes | Route | [src/components/dms/MessagesListHeader.tsx:154](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dms/MessagesListHeader.tsx#L154) |
| MessagesInbox | Navigator routes | Route | [src/screens/Messages/components/InboxRequests.tsx:44](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Messages/components/InboxRequests.tsx#L44) |
| MessagesJoinRequests | Navigator routes | Route | [src/screens/Messages/ConversationSettings/MembersAndRequests.tsx:51](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Messages/ConversationSettings/MembersAndRequests.tsx#L51) |
| MessagesSettings | Navigator routes | Route | [src/screens/Messages/ChatList.tsx:669](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Messages/ChatList.tsx#L669) |
| Moderation | Navigator routes | Route | [src/screens/Settings/Settings.tsx:182](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/Settings.tsx#L182) |
| ModerationBlockedAccounts | Navigator routes | Route | [src/screens/Moderation/index.tsx:326](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Moderation/index.tsx#L326) |
| ModerationInbox | Navigator routes | Route | [src/screens/Moderation/index.tsx:202](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Moderation/index.tsx#L202) |
| ModerationInboxNoticeDetails | Navigator routes | Route | [src/screens/ModerationInbox/index.tsx:47](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/ModerationInbox/index.tsx#L47) |
| ModerationInboxReportDetails | Navigator routes | Route | [src/screens/ModerationInbox/index.tsx:47](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/ModerationInbox/index.tsx#L47) |
| ModerationInboxSettings | Navigator routes | Route | [src/screens/ModerationInbox/index.tsx:47](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/ModerationInbox/index.tsx#L47) |
| ModerationInteractionSettings | Navigator routes | Route | [src/screens/Moderation/index.tsx:326](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Moderation/index.tsx#L326) |
| ModerationModlists | Navigator routes | Route | [src/screens/Moderation/index.tsx:326](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Moderation/index.tsx#L326) |
| ModerationMutedAccounts | Navigator routes | Route | [src/screens/Moderation/index.tsx:326](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Moderation/index.tsx#L326) |
| ModerationVerificationSettings | Navigator routes | Route | [src/screens/Moderation/index.tsx:326](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Moderation/index.tsx#L326) |
| MyProfile | Navigator routes | Route | [src/Navigation.tsx:636](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/Navigation.tsx#L636) |
| NotificationSettings | Navigator routes | Route | [src/screens/Settings/Settings.tsx:182](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/Settings.tsx#L182) |
| Notifications | Navigator routes | Route | [src/Navigation.tsx:636](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/Navigation.tsx#L636) |
| NotificationsActivityList | Navigator routes | Route | [src/view/com/notifications/NotificationFeedItem.tsx:130](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/com/notifications/NotificationFeedItem.tsx#L130) |
| PostLikedBy | Navigator routes | Route | [src/screens/PostThread/components/LikesStat.tsx:26](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/PostThread/components/LikesStat.tsx#L26) |
| PostQuotes | Navigator routes | Route | [src/screens/PostThread/components/ThreadItemAnchor.tsx:478](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/PostThread/components/ThreadItemAnchor.tsx#L478) |
| PostRepostedBy | Navigator routes | Route | [src/screens/PostThread/components/ThreadItemAnchor.tsx:459](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/PostThread/components/ThreadItemAnchor.tsx#L459) |
| PostThread | Navigator routes | Route | [src/view/com/notifications/NotificationFeedItem.tsx:106](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/com/notifications/NotificationFeedItem.tsx#L106) |
| PreferencesExternalEmbeds | Navigator routes | Route | [src/screens/Settings/ContentAndMediaSettings.tsx:61](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/ContentAndMediaSettings.tsx#L61) |
| PreferencesFollowingFeed | Navigator routes | Route | [src/screens/Settings/ContentAndMediaSettings.tsx:61](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/ContentAndMediaSettings.tsx#L61) |
| PreferencesThreads | Navigator routes | Route | [src/screens/Settings/ContentAndMediaSettings.tsx:61](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/ContentAndMediaSettings.tsx#L61) |
| PrivacyAndSecuritySettings | Navigator routes | Route | [src/screens/Settings/Settings.tsx:182](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/Settings.tsx#L182) |
| Profile | Navigator routes | Route | [src/components/RichText.tsx:153](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/RichText.tsx#L153) |
| ProfileFollowers | Navigator routes | Route | [src/screens/Profile/Header/Metrics.tsx:38](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Profile/Header/Metrics.tsx#L38) |
| ProfileFollows | Navigator routes | Route | [src/screens/Profile/Header/Metrics.tsx:38](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Profile/Header/Metrics.tsx#L38) |
| ProfileKnownFollowers | Navigator routes | Route | [src/components/KnownFollowers.tsx:126](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/KnownFollowers.tsx#L126) |
| ProfileLabelerLikedBy | Navigator routes | Route | [src/screens/Profile/Header/ProfileHeaderLabeler.tsx:139](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Profile/Header/ProfileHeaderLabeler.tsx#L139) |
| ProfileList | Navigator routes | Route | [src/view/screens/Lists.tsx:45](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/screens/Lists.tsx#L45) |
| ProfileSearch | Navigator routes | Route | [src/view/com/profile/ProfileMenu.tsx:267](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/com/profile/ProfileMenu.tsx#L267) |
| SavedFeeds | Navigator routes | Route | [src/screens/Settings/ContentAndMediaSettings.tsx:61](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/ContentAndMediaSettings.tsx#L61) |
| Search | Navigator routes | Route | [src/Navigation.tsx:636](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/Navigation.tsx#L636) |
| Settings | Navigator routes | Route | [src/view/shell/Drawer.tsx:272](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/shell/Drawer.tsx#L272) |
| StarterPack | Navigator routes | Route | [src/components/StarterPack/StarterPackCard.tsx:155](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/StarterPack/StarterPackCard.tsx#L155) |
| StarterPackEdit | Navigator routes | Route | [src/screens/StarterPack/StarterPackScreen.tsx:606](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/StarterPack/StarterPackScreen.tsx#L606) |
| StarterPackWizard | Navigator routes | Route | [src/components/StarterPack/ProfileStarterPacks.tsx:211](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/StarterPack/ProfileStarterPacks.tsx#L211) |
| VideoFeed | Navigator routes | Route | [src/components/VideoPostCard.tsx:114](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/VideoPostCard.tsx#L114) |
| Login / create account landing | Auth and account gates | UI preview plan | [src/view/com/auth/LoggedOut.tsx:63](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/com/auth/LoggedOut.tsx#L63) |
| Login form | Auth and account gates | Action | [src/screens/Login/index.tsx:63](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Login/index.tsx#L63) |
| Choose saved account | Auth and account gates | UI preview plan | [src/screens/Login/index.tsx:63](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Login/index.tsx#L63) |
| Forgot password | Auth and account gates | Action | [src/screens/Login/index.tsx:63](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Login/index.tsx#L63) |
| Set new password | Auth and account gates | UI preview plan | [src/screens/Login/index.tsx:63](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Login/index.tsx#L63) |
| Password updated | Auth and account gates | UI preview plan | [src/screens/Login/index.tsx:63](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Login/index.tsx#L63) |
| Signup account details | Auth and account gates | Action | [src/view/com/auth/LoggedOut.tsx:63](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/com/auth/LoggedOut.tsx#L63) |
| Signup handle | Auth and account gates | UI preview plan | [src/screens/Signup/index.tsx:41](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Signup/index.tsx#L41) |
| Signup CAPTCHA | Auth and account gates | UI preview plan | [src/screens/Signup/index.tsx:41](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Signup/index.tsx#L41) |
| Onboarding profile | Auth and account gates | UI preview plan | [src/screens/Onboarding/index.tsx:52](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Onboarding/index.tsx#L52) |
| Onboarding interests | Auth and account gates | UI preview plan | [src/screens/Onboarding/index.tsx:52](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Onboarding/index.tsx#L52) |
| Onboarding suggested accounts | Auth and account gates | UI preview plan | [src/screens/Onboarding/index.tsx:52](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Onboarding/index.tsx#L52) |
| Onboarding suggested starter packs | Auth and account gates | UI preview plan | [src/screens/Onboarding/index.tsx:52](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Onboarding/index.tsx#L52) |
| Onboarding contacts introduction | Auth and account gates | UI preview plan | [src/screens/Onboarding/index.tsx:52](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Onboarding/index.tsx#L52) |
| Onboarding finished | Auth and account gates | UI preview plan | [src/screens/Onboarding/index.tsx:52](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Onboarding/index.tsx#L52) |
| Signup queued | Auth and account gates | Source only | [src/screens/SignupQueued.tsx:22](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/SignupQueued.tsx#L22) |
| Account taken down | Auth and account gates | Action | [src/screens/Takendown.tsx:30](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Takendown.tsx#L30) |
| Account deactivated | Auth and account gates | Source only | [src/screens/Deactivated.tsx:33](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Deactivated.tsx#L33) |
| Age assurance data unavailable | Auth and account gates | Source only | [src/ageAssurance/components/DataUnavailableScreen.tsx:9](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/ageAssurance/components/DataUnavailableScreen.tsx#L9) |
| Age assurance access blocked | Auth and account gates | Source only | [src/ageAssurance/components/NoAccessScreen.tsx:47](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/ageAssurance/components/NoAccessScreen.tsx#L47) |
| Policy update acceptance | Auth and account gates | Source only | [src/components/PolicyUpdateOverlay/index.tsx:15](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/PolicyUpdateOverlay/index.tsx#L15) |
| Age assurance return overlay | Auth and account gates | Source only | [src/ageAssurance/components/RedirectOverlay.tsx:133](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/ageAssurance/components/RedirectOverlay.tsx#L133) |
| Contacts verification code | Steps inside navigator flows | UI preview plan | [src/components/contacts/state.ts:183](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/contacts/state.ts#L183) |
| Contacts import consent | Steps inside navigator flows | UI preview plan | [src/components/contacts/state.ts:183](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/contacts/state.ts#L183) |
| Contacts matches | Steps inside navigator flows | UI preview plan | [src/components/contacts/state.ts:183](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/contacts/state.ts#L183) |
| Starter pack wizard profiles | Steps inside navigator flows | Source only | [src/screens/StarterPack/Wizard/State.tsx:172](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/StarterPack/Wizard/State.tsx#L172) |
| Starter pack wizard feeds | Steps inside navigator flows | UI preview plan | [src/screens/StarterPack/Wizard/State.tsx:172](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/StarterPack/Wizard/State.tsx#L172) |
| Bot account information | Sheets and overlays | Action | [src/components/BotAccountAlert.tsx:13](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/BotAccountAlert.tsx#L13) |
| Switch update channel | Sheets and overlays | Action | [src/components/OTAChannelNotice.tsx:169](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/OTAChannelNotice.tsx#L169) |
| Who can reply information | Sheets and overlays | Action | [src/components/WhoCanReply.tsx:187](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/WhoCanReply.tsx#L187) |
| Suggested follows | Sheets and overlays | Action | [src/components/ProgressGuide/FollowDialog.tsx:57](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/ProgressGuide/FollowDialog.tsx#L57) |
| Send app error report | Sheets and overlays | Action | [src/components/SendErrorReportDialog.tsx:16](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/SendErrorReportDialog.tsx#L16) |
| Starter pack QR code | Sheets and overlays | UI preview plan | [src/components/StarterPack/QrCodeDialog.tsx:29](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/StarterPack/QrCodeDialog.tsx#L29) |
| Share starter pack | Sheets and overlays | UI preview plan | [src/components/StarterPack/ShareDialog.tsx:31](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/StarterPack/ShareDialog.tsx#L31) |
| Edit starter pack members | Sheets and overlays | Action | [src/components/StarterPack/Wizard/WizardEditListDialog.tsx:33](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/StarterPack/Wizard/WizardEditListDialog.tsx#L33) |
| Profile activity subscription | Sheets and overlays | Action | [src/components/activity-notifications/SubscribeProfileDialog.tsx:39](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/activity-notifications/SubscribeProfileDialog.tsx#L39) |
| Age assurance appeal | Sheets and overlays | UI preview plan | [src/components/ageAssurance/AgeAssuranceAppealDialog.tsx:21](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/ageAssurance/AgeAssuranceAppealDialog.tsx#L21) |
| Begin age assurance | Sheets and overlays | UI preview plan | [src/components/ageAssurance/AgeAssuranceInitDialog.tsx:41](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/ageAssurance/AgeAssuranceInitDialog.tsx#L41) |
| Age assurance return dialog | Sheets and overlays | UI preview plan | [src/components/ageAssurance/AgeAssuranceRedirectDialog.tsx:63](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/ageAssurance/AgeAssuranceRedirectDialog.tsx#L63) |
| Contacts invitation information | Sheets and overlays | Action | [src/components/contacts/components/InviteInfo.tsx:13](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/contacts/components/InviteInfo.tsx#L13) |
| Edit birthdate | Sheets and overlays | Action | [src/components/dialogs/BirthDateSettings.tsx:29](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/BirthDateSettings.tsx#L29) |
| Device location request | Sheets and overlays | UI preview plan | [src/components/dialogs/DeviceLocationRequestDialog.tsx:30](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/DeviceLocationRequestDialog.tsx#L30) |
| External embed consent | Sheets and overlays | UI preview plan | [src/components/dialogs/EmbedConsent.tsx:19](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/EmbedConsent.tsx#L19) |
| In-app browser consent | Sheets and overlays | UI preview plan | [src/components/dialogs/InAppBrowserConsent.tsx:17](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/InAppBrowserConsent.tsx#L17) |
| Language selection | Sheets and overlays | Action | [src/components/dialogs/LanguageSelectDialog.tsx:31](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/LanguageSelectDialog.tsx#L31) |
| Link safety warning | Sheets and overlays | UI preview plan | [src/components/dialogs/LinkWarning.tsx:16](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/LinkWarning.tsx#L16) |
| Muted words | Sheets and overlays | UI preview plan | [src/components/dialogs/MutedWords.tsx:43](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/MutedWords.tsx#L43) |
| New account information | Sheets and overlays | Action | [src/components/dialogs/NewskieDialog/index.tsx:24](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/NewskieDialog/index.tsx#L24) |
| Post interaction settings | Sheets and overlays | Action | [src/components/dialogs/PostInteractionSettingsDialog.tsx:144](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/PostInteractionSettingsDialog.tsx#L144) |
| Custom hosting provider | Sheets and overlays | Action | [src/components/dialogs/ServerInput.tsx:23](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/ServerInput.tsx#L23) |
| Sign-in reminder | Sheets and overlays | UI preview plan | [src/components/dialogs/Signin.tsx:18](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/Signin.tsx#L18) |
| Profile starter packs | Sheets and overlays | Action | [src/components/dialogs/StarterPackDialog.tsx:42](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/StarterPackDialog.tsx#L42) |
| Switch account | Sheets and overlays | UI preview plan | [src/components/dialogs/SwitchAccount.tsx:15](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/SwitchAccount.tsx#L15) |
| Create list from starter pack | Sheets and overlays | Action | [src/components/dialogs/lists/CreateListFromStarterPackDialog.tsx:28](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/lists/CreateListFromStarterPackDialog.tsx#L28) |
| Create / edit list | Sheets and overlays | Action | [src/components/dialogs/lists/CreateOrEditListDialog.tsx:41](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/lists/CreateOrEditListDialog.tsx#L41) |
| Add / remove list members | Sheets and overlays | UI preview plan | [src/components/dialogs/lists/ListAddRemoveUsersDialog.tsx:28](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/lists/ListAddRemoveUsersDialog.tsx#L28) |
| Add / remove user from lists | Sheets and overlays | Action | [src/components/dialogs/lists/UserAddRemoveListsDialog.tsx:39](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/lists/UserAddRemoveListsDialog.tsx#L39) |
| Group chats announcement | Sheets and overlays | UI preview plan | [src/components/dialogs/nuxs/GroupChatsAnnouncement.tsx:52](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/nuxs/GroupChatsAnnouncement.tsx#L52) |
| Invite friends announcement | Sheets and overlays | UI preview plan | [src/components/dialogs/nuxs/InviteFriendsAnnouncement.tsx:26](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/nuxs/InviteFriendsAnnouncement.tsx#L26) |
| After reporting a conversation | Sheets and overlays | UI preview plan | [src/components/dms/AfterReportConversationDialog.tsx:32](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dms/AfterReportConversationDialog.tsx#L32) |
| After reporting a message | Sheets and overlays | UI preview plan | [src/components/dms/AfterReportDialog.tsx:32](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dms/AfterReportDialog.tsx#L32) |
| Message reactions | Sheets and overlays | UI preview plan | [src/components/dms/ReactionsDialog.tsx:37](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dms/ReactionsDialog.tsx#L37) |
| New chat recipient picker | Sheets and overlays | Action | [src/components/dms/dialogs/NewChatDialog.tsx:21](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dms/dialogs/NewChatDialog.tsx#L21) |
| Share via chat | Sheets and overlays | Action | [src/components/dms/dialogs/ShareViaChatDialog.tsx:16](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dms/dialogs/ShareViaChatDialog.tsx#L16) |
| Date picker | Sheets and overlays | Action | [src/components/forms/DateField/index.tsx:36](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/forms/DateField/index.tsx#L36) |
| Join group chat intent | Sheets and overlays | UI preview plan | [src/components/intents/GroupChatJoinDialog.tsx:52](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/intents/GroupChatJoinDialog.tsx#L52) |
| Verify email intent | Sheets and overlays | UI preview plan | [src/components/intents/VerifyEmailIntentDialog.tsx:21](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/intents/VerifyEmailIntentDialog.tsx#L21) |
| Block account | Sheets and overlays | Action | [src/components/moderation/BlockDialog.tsx:38](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/moderation/BlockDialog.tsx#L38) |
| Labels applied to your content | Sheets and overlays | Action | [src/components/moderation/LabelsOnMeDialog.tsx:35](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/moderation/LabelsOnMeDialog.tsx#L35) |
| Moderation details | Sheets and overlays | Action | [src/components/moderation/ModerationDetailsDialog.tsx:30](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/moderation/ModerationDetailsDialog.tsx#L30) |
| Report category | Sheets and overlays | Action | [src/components/moderation/ReportDialog/index.tsx:80](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/moderation/ReportDialog/index.tsx#L80) |
| Account verifications | Sheets and overlays | Action | [src/components/verification/VerificationsDialog.tsx:28](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/verification/VerificationsDialog.tsx#L28) |
| Verifier information | Sheets and overlays | Action | [src/components/verification/VerifierDialog.tsx:22](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/verification/VerifierDialog.tsx#L22) |
| GIF picker | Sheets and overlays | Action | [src/features/gifPicker/GifPickerDialog.tsx:22](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/features/gifPicker/GifPickerDialog.tsx#L22) |
| Invite friends | Sheets and overlays | Action | [src/features/inviteFriends/InviteFriendsDialog.tsx:4](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/features/inviteFriends/InviteFriendsDialog.tsx#L4) |
| Edit live status | Sheets and overlays | UI preview plan | [src/features/liveNow/components/EditLiveDialog.tsx:31](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/features/liveNow/components/EditLiveDialog.tsx#L31) |
| Go live | Sheets and overlays | UI preview plan | [src/features/liveNow/components/GoLiveDialog.tsx:34](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/features/liveNow/components/GoLiveDialog.tsx#L34) |
| Live status unavailable | Sheets and overlays | UI preview plan | [src/features/liveNow/components/GoLiveDisabledDialog.tsx:19](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/features/liveNow/components/GoLiveDisabledDialog.tsx#L19) |
| Live status information | Sheets and overlays | Action | [src/features/liveNow/components/LiveStatusDialog.tsx:32](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/features/liveNow/components/LiveStatusDialog.tsx#L32) |
| Login hosting provider | Sheets and overlays | Action | [src/screens/Login/components/HostingProviderDialog.tsx:28](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Login/components/HostingProviderDialog.tsx#L28) |
| Confirm login provider | Sheets and overlays | UI preview plan | [src/screens/Login/components/ConfirmHostingProviderDialog.tsx:20](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Login/components/ConfirmHostingProviderDialog.tsx#L20) |
| Edit profile | Sheets and overlays | Action | [src/screens/Profile/Header/EditProfileDialog.tsx:29](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Profile/Header/EditProfileDialog.tsx#L29) |
| Advanced search | Sheets and overlays | UI preview plan | [src/screens/Search/components/AdvancedSearchDialog/index.tsx:40](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Search/components/AdvancedSearchDialog/index.tsx#L40) |
| Create app password | Sheets and overlays | Action | [src/screens/Settings/components/AddAppPasswordDialog.tsx:30](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/components/AddAppPasswordDialog.tsx#L30) |
| Beta features feedback | Sheets and overlays | Action | [src/screens/Settings/components/BetaFeaturesFeedbackDialog.tsx:19](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/components/BetaFeaturesFeedbackDialog.tsx#L19) |
| Change handle: provided handle | Sheets and overlays | Action | [src/screens/Settings/components/ChangeHandleDialog.tsx:51](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/components/ChangeHandleDialog.tsx#L51) |
| Change password: request code | Sheets and overlays | Action | [src/screens/Settings/components/ChangePasswordDialog.tsx:29](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/components/ChangePasswordDialog.tsx#L29) |
| Disable 2FA: send email | Sheets and overlays | UI preview plan | [src/screens/Settings/components/DisableEmail2FADialog.tsx:27](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/components/DisableEmail2FADialog.tsx#L27) |
| Export account data | Sheets and overlays | Action | [src/screens/Settings/components/ExportCarDialog.tsx:18](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/components/ExportCarDialog.tsx#L18) |
| Deactivate account confirmation | Sheets and overlays | UI preview plan | [src/screens/Settings/components/DeactivateAccountDialog.tsx:19](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/components/DeactivateAccountDialog.tsx#L19) |
| Delete account: request code | Sheets and overlays | Action | [src/screens/Settings/components/DeleteAccountDialog.tsx:52](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/components/DeleteAccountDialog.tsx#L52) |
| GIF alt text | Sheets and overlays | UI preview plan | [src/view/com/composer/GifAltText.tsx:29](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/com/composer/GifAltText.tsx#L29) |
| Post drafts | Sheets and overlays | Action | [src/view/com/composer/drafts/DraftsListDialog.tsx:22](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/com/composer/drafts/DraftsListDialog.tsx#L22) |
| Image alt text | Sheets and overlays | Action | [src/view/com/composer/photos/ImageAltTextDialog.tsx:28](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/com/composer/photos/ImageAltTextDialog.tsx#L28) |
| Unavailable feed information | Sheets and overlays | Action | [src/view/com/feeds/MissingFeed.tsx:20](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/com/feeds/MissingFeed.tsx#L20) |
| Repost / quote choices | Sheets and overlays | UI preview plan | [src/components/PostControls/RepostButton.tsx:95](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/PostControls/RepostButton.tsx#L95) |
| Feed information | Sheets and overlays | Action | [src/screens/CustomFeed/components/CustomFeedHeader.tsx:398](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/CustomFeed/components/CustomFeedHeader.tsx#L398) |
| Add group members | Sheets and overlays | Action | [src/screens/Messages/ConversationSettings/AddMembersLink.tsx:118](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Messages/ConversationSettings/AddMembersLink.tsx#L118) |
| Chat disabled information | Sheets and overlays | Action | [src/screens/Messages/components/ChatDisabled.tsx:82](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Messages/components/ChatDisabled.tsx#L82) |
| Onboarding avatar creator | Sheets and overlays | UI preview plan | [src/screens/Onboarding/StepProfile/index.tsx:322](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Onboarding/StepProfile/index.tsx#L322) |
| Encrypted messaging introduction | Sheets and overlays | Action | [src/screens/Profile/components/GermButton.tsx:234](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Profile/components/GermButton.tsx#L234) |
| Post content warning labels | Sheets and overlays | Action | [src/view/com/composer/labels/LabelsBtn.tsx:76](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/com/composer/labels/LabelsBtn.tsx#L76) |
| Video alt text | Sheets and overlays | Action | [src/view/com/composer/videos/SubtitleDialog.tsx:63](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/com/composer/videos/SubtitleDialog.tsx#L63) |
| Compose post | Sheets and overlays | Action | [src/view/shell/Composer.ios.tsx:11](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/shell/Composer.ios.tsx#L11) |
| Navigation drawer | Sheets and overlays | Source only | [src/view/shell/Drawer.tsx:184](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/shell/Drawer.tsx#L184) |
| Image lightbox | Sheets and overlays | Source only | [src/components/Lightbox/Lightbox.tsx:8](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/Lightbox/Lightbox.tsx#L8) |
| Update email address | Steps inside sheets | UI preview plan | [src/components/dialogs/EmailDialog/index.tsx:49](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/EmailDialog/index.tsx#L49) |
| Verify email: send email | Steps inside sheets | UI preview plan | [src/components/dialogs/EmailDialog/index.tsx:49](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/EmailDialog/index.tsx#L49) |
| Verify email reminder | Steps inside sheets | UI preview plan | [src/components/dialogs/EmailDialog/index.tsx:49](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/EmailDialog/index.tsx#L49) |
| Enable email 2FA | Steps inside sheets | Source only | [src/components/dialogs/EmailDialog/screens/Manage2FA/index.tsx:14](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/EmailDialog/screens/Manage2FA/index.tsx#L14) |
| Disable email 2FA: request code | Steps inside sheets | Source only | [src/components/dialogs/EmailDialog/screens/Manage2FA/index.tsx:14](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/EmailDialog/screens/Manage2FA/index.tsx#L14) |
| Update email: security code | Steps inside sheets | UI preview plan | [src/components/dialogs/EmailDialog/screens/Update.tsx:110](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/EmailDialog/screens/Update.tsx#L110) |
| Verify email: enter code | Steps inside sheets | UI preview plan | [src/components/dialogs/EmailDialog/screens/Verify.tsx:97](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/EmailDialog/screens/Verify.tsx#L97) |
| Email verified | Steps inside sheets | UI preview plan | [src/components/dialogs/EmailDialog/screens/Verify.tsx:97](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/EmailDialog/screens/Verify.tsx#L97) |
| Disable email 2FA: enter code | Steps inside sheets | UI preview plan | [src/components/dialogs/EmailDialog/screens/Manage2FA/Disable.tsx:99](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/EmailDialog/screens/Manage2FA/Disable.tsx#L99) |
| Change handle: own domain | Steps inside sheets | UI preview plan | [src/screens/Settings/components/ChangeHandleDialog.tsx:73](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/components/ChangeHandleDialog.tsx#L73) |
| Change password: enter code | Steps inside sheets | Action | [src/screens/Settings/components/ChangePasswordDialog.tsx:52](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/components/ChangePasswordDialog.tsx#L52) |
| Password changed | Steps inside sheets | UI preview plan | [src/screens/Settings/components/ChangePasswordDialog.tsx:52](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/components/ChangePasswordDialog.tsx#L52) |
| Disable 2FA: enter code | Steps inside sheets | Action | [src/screens/Settings/components/DisableEmail2FADialog.tsx:39](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/components/DisableEmail2FADialog.tsx#L39) |
| Delete account: verify code | Steps inside sheets | UI preview plan | [src/screens/Settings/components/DeleteAccountDialog.tsx:87](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/components/DeleteAccountDialog.tsx#L87) |
| Delete account: final confirmation | Steps inside sheets | Action | [src/screens/Settings/components/DeleteAccountDialog.tsx:87](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/components/DeleteAccountDialog.tsx#L87) |
| New group: choose members | Steps inside sheets | Source only | [src/components/dms/InitiateChatFlow.tsx:275](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dms/InitiateChatFlow.tsx#L275) |
| New group: choose name | Steps inside sheets | Source only | [src/components/dms/InitiateChatFlow.tsx:275](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dms/InitiateChatFlow.tsx#L275) |
| Report reason | Steps inside sheets | UI preview plan | [src/components/moderation/ReportDialog/index.tsx:172](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/moderation/ReportDialog/index.tsx#L172) |
| Report moderation service | Steps inside sheets | UI preview plan | [src/components/moderation/ReportDialog/index.tsx:172](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/moderation/ReportDialog/index.tsx#L172) |
| Report details / final confirmation | Steps inside sheets | UI preview plan | [src/components/moderation/ReportDialog/index.tsx:172](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/moderation/ReportDialog/index.tsx#L172) |
| Group invite link information | Steps inside sheets | UI preview plan | [src/screens/Messages/components/InviteLinkDialog.tsx:80](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Messages/components/InviteLinkDialog.tsx#L80) |
| Generate group invite link | Steps inside sheets | Action | [src/screens/Messages/components/InviteLinkDialog.tsx:80](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Messages/components/InviteLinkDialog.tsx#L80) |
| Manage group invite link | Steps inside sheets | Action | [src/screens/Messages/components/InviteLinkDialog.tsx:80](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Messages/components/InviteLinkDialog.tsx#L80) |
| Disable group invite link confirmation | Steps inside sheets | Action | [src/screens/Messages/components/InviteLinkDialog.tsx:80](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Messages/components/InviteLinkDialog.tsx#L80) |
| Appeal moderation notice | Sheets and overlays | Action | [src/screens/ModerationInbox/Notice.tsx:119](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/ModerationInbox/Notice.tsx#L119) |
| Notification options: Likes | Sheets and overlays | Action | [src/screens/Settings/NotificationSettings/index.tsx:310](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/NotificationSettings/index.tsx#L310) |
| Notification options: New followers | Sheets and overlays | Action | [src/screens/Settings/NotificationSettings/index.tsx:319](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/NotificationSettings/index.tsx#L319) |
| Notification options: Replies | Sheets and overlays | Action | [src/screens/Settings/NotificationSettings/index.tsx:326](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/NotificationSettings/index.tsx#L326) |
| Notification options: Mentions | Sheets and overlays | Action | [src/screens/Settings/NotificationSettings/index.tsx:335](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/NotificationSettings/index.tsx#L335) |
| Notification options: Quotes | Sheets and overlays | Action | [src/screens/Settings/NotificationSettings/index.tsx:342](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/NotificationSettings/index.tsx#L342) |
| Notification options: Reposts | Sheets and overlays | Action | [src/screens/Settings/NotificationSettings/index.tsx:351](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/NotificationSettings/index.tsx#L351) |
| Notification options: Likes of your reposts | Sheets and overlays | Action | [src/screens/Settings/NotificationSettings/index.tsx:360](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/NotificationSettings/index.tsx#L360) |
| Notification options: Reposts of your reposts | Sheets and overlays | Action | [src/screens/Settings/NotificationSettings/index.tsx:369](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/NotificationSettings/index.tsx#L369) |
| Notification options: Everything else | Sheets and overlays | Action | [src/screens/Settings/NotificationSettings/index.tsx:382](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/NotificationSettings/index.tsx#L382) |
| Notification options: New messages | Sheets and overlays | Action | [src/screens/Settings/NotificationSettings/components/ChatNotificationDialogs.tsx:17](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/NotificationSettings/components/ChatNotificationDialogs.tsx#L17) |
| Notification options: New message requests | Sheets and overlays | Action | [src/screens/Settings/NotificationSettings/components/ChatNotificationDialogs.tsx:27](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/NotificationSettings/components/ChatNotificationDialogs.tsx#L27) |
| Account suspension appeal form | Auth and account gates | Action | [src/screens/Takendown.tsx:38](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Takendown.tsx#L38) |
| Account appeal submitted | Auth and account gates | Source only | [src/screens/Takendown.tsx:155](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Takendown.tsx#L155) |
| Profile / screen moderation gate | Auth and account gates | Source only | [src/components/moderation/ScreenHider.tsx:40](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/moderation/ScreenHider.tsx#L40) |
| Appeal moderation label | Steps inside sheets | Action | [src/components/moderation/ModerationDetailsDialog.tsx:53](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/moderation/ModerationDetailsDialog.tsx#L53) |
| Birthdate update not allowed | Steps inside sheets | Source only | [src/components/dialogs/BirthDateSettings.tsx:91](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/BirthDateSettings.tsx#L91) |
| Generated app password | Steps inside sheets | Source only | [src/screens/Settings/components/AddAppPasswordDialog.tsx:182](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/components/AddAppPasswordDialog.tsx#L182) |
| Age verification email sent | Steps inside sheets | Source only | [src/components/ageAssurance/AgeAssuranceInitDialog.tsx:229](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/ageAssurance/AgeAssuranceInitDialog.tsx#L229) |
| Age assurance return success | Steps inside sheets | Source only | [src/ageAssurance/components/RedirectOverlay.tsx:235](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/ageAssurance/components/RedirectOverlay.tsx#L235) |
| Alt text information | Confirmation and information dialogs | Action | [src/components/AltBadgeWithDialog.tsx:80](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/AltBadgeWithDialog.tsx#L80) |
| Remove feed confirmation | Confirmation and information dialogs | UI preview plan | [src/components/FeedCard.tsx:399](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/FeedCard.tsx#L399) |
| Delete post confirmation | Confirmation and information dialogs | Action | [src/components/PostControls/PostMenu/PostMenuItems.tsx:816](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/PostControls/PostMenu/PostMenuItems.tsx#L816) |
| Hide post from feed confirmation | Confirmation and information dialogs | Action | [src/components/PostControls/PostMenu/PostMenuItems.tsx:824](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/PostControls/PostMenu/PostMenuItems.tsx#L824) |
| Detach quote confirmation | Confirmation and information dialogs | UI preview plan | [src/components/PostControls/PostMenu/PostMenuItems.tsx:852](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/PostControls/PostMenu/PostMenuItems.tsx#L852) |
| Hide reply in thread confirmation | Confirmation and information dialogs | UI preview plan | [src/components/PostControls/PostMenu/PostMenuItems.tsx:859](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/PostControls/PostMenu/PostMenuItems.tsx#L859) |
| Generate starter pack confirmation | Confirmation and information dialogs | Action | [src/components/StarterPack/ProfileStarterPacks.tsx:332](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/StarterPack/ProfileStarterPacks.tsx#L332) |
| Starter pack minimum follows information | Confirmation and information dialogs | UI preview plan | [src/components/StarterPack/ProfileStarterPacks.tsx:359](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/StarterPack/ProfileStarterPacks.tsx#L359) |
| Starter pack generation retry dialog | Confirmation and information dialogs | UI preview plan | [src/components/StarterPack/ProfileStarterPacks.tsx:366](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/StarterPack/ProfileStarterPacks.tsx#L366) |
| Trending topics information | Confirmation and information dialogs | Action | [src/components/TrendingTopics.tsx:28](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/TrendingTopics.tsx#L28) |
| Delete muted word confirmation | Confirmation and information dialogs | Action | [src/components/dialogs/MutedWords.tsx:452](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/MutedWords.tsx#L452) |
| Discard list edits confirmation | Confirmation and information dialogs | Source only | [src/components/dialogs/lists/CreateOrEditListDialog.tsx:97](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/lists/CreateOrEditListDialog.tsx#L97) |
| Account blocked by moderation list | Confirmation and information dialogs | UI preview plan | [src/components/dms/BlockedByListDialog.tsx:26](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dms/BlockedByListDialog.tsx#L26) |
| Account too new for group chat | Confirmation and information dialogs | UI preview plan | [src/components/dms/InitiateChatFlow.tsx:834](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dms/InitiateChatFlow.tsx#L834) |
| Leave conversation confirmation | Confirmation and information dialogs | Action | [src/components/dms/LeaveConvoPrompt.tsx:55](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dms/LeaveConvoPrompt.tsx#L55) |
| Hidden blocked messages information | Confirmation and information dialogs | Action | [src/components/dms/MessageItem.tsx:731](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dms/MessageItem.tsx#L731) |
| Delete message confirmation | Confirmation and information dialogs | UI preview plan | [src/components/dms/MessageOverlays.tsx:180](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dms/MessageOverlays.tsx#L180) |
| Hide trending videos confirmation | Confirmation and information dialogs | Action | [src/components/interstitials/TrendingVideos.tsx:136](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/interstitials/TrendingVideos.tsx#L136) |
| Verify account confirmation | Confirmation and information dialogs | Action | [src/components/verification/VerificationCreatePrompt.tsx:48](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/verification/VerificationCreatePrompt.tsx#L48) |
| Remove verification confirmation | Confirmation and information dialogs | Action | [src/components/verification/VerificationRemovePrompt.tsx:44](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/verification/VerificationRemovePrompt.tsx#L44) |
| Edit group chat name | Confirmation and information dialogs | Action | [src/screens/Messages/ConversationSettings/prompts.tsx:39](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Messages/ConversationSettings/prompts.tsx#L39) |
| Lock group chat confirmation | Confirmation and information dialogs | UI preview plan | [src/screens/Messages/ConversationSettings/prompts.tsx:103](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Messages/ConversationSettings/prompts.tsx#L103) |
| Leave group chat confirmation | Confirmation and information dialogs | Action | [src/screens/Messages/ConversationSettings/prompts.tsx:126](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Messages/ConversationSettings/prompts.tsx#L126) |
| Leave and lock group chat confirmation | Confirmation and information dialogs | UI preview plan | [src/screens/Messages/ConversationSettings/prompts.tsx:150](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Messages/ConversationSettings/prompts.tsx#L150) |
| Remove group member confirmation | Confirmation and information dialogs | Action | [src/screens/Messages/ConversationSettings/prompts.tsx:174](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Messages/ConversationSettings/prompts.tsx#L174) |
| Rescind group join request confirmation | Confirmation and information dialogs | UI preview plan | [src/screens/Messages/components/OutgoingRequestListItem.tsx:111](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Messages/components/OutgoingRequestListItem.tsx#L111) |
| Account moderation status information | Confirmation and information dialogs | Action | [src/screens/ModerationInbox/components/AccountStatus.tsx:59](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/ModerationInbox/components/AccountStatus.tsx#L59) |
| Archived post information | Confirmation and information dialogs | Action | [src/screens/PostThread/components/ThreadItemAnchor.tsx:633](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/PostThread/components/ThreadItemAnchor.tsx#L633) |
| Discard profile edits confirmation | Confirmation and information dialogs | Source only | [src/screens/Profile/Header/EditProfileDialog.tsx:74](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Profile/Header/EditProfileDialog.tsx#L74) |
| Labeler subscription limit information | Confirmation and information dialogs | UI preview plan | [src/screens/Profile/Header/ProfileHeaderLabeler.tsx:213](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Profile/Header/ProfileHeaderLabeler.tsx#L213) |
| Unblock account confirmation | Confirmation and information dialogs | Action | [src/screens/Profile/Header/ProfileHeaderStandard.tsx:181](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Profile/Header/ProfileHeaderStandard.tsx#L181) |
| Delete list confirmation | Confirmation and information dialogs | Action | [src/screens/ProfileList/components/MoreOptionsMenu.tsx:315](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/ProfileList/components/MoreOptionsMenu.tsx#L315) |
| Opt out of starter pack confirmation | Confirmation and information dialogs | Action | [src/screens/ProfileList/components/MoreOptionsMenu.tsx:324](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/ProfileList/components/MoreOptionsMenu.tsx#L324) |
| Mute list confirmation | Confirmation and information dialogs | Action | [src/screens/ProfileList/components/SubscribeMenu.tsx:102](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/ProfileList/components/SubscribeMenu.tsx#L102) |
| Block list confirmation | Confirmation and information dialogs | Action | [src/screens/ProfileList/components/SubscribeMenu.tsx:112](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/ProfileList/components/SubscribeMenu.tsx#L112) |
| Dismiss explore interests confirmation | Confirmation and information dialogs | Action | [src/screens/Search/modules/ExploreInterestsCard.tsx:40](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Search/modules/ExploreInterestsCard.tsx#L40) |
| Delete app password confirmation | Confirmation and information dialogs | Action | [src/screens/Settings/AppPasswords.tsx:207](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/AppPasswords.tsx#L207) |
| Sign out confirmation | Confirmation and information dialogs | Action | [src/screens/Settings/Settings.tsx:306](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/Settings.tsx#L306) |
| Remove saved account confirmation | Confirmation and information dialogs | Action | [src/screens/Settings/Settings.tsx:687](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/Settings.tsx#L687) |
| Delete starter pack confirmation | Confirmation and information dialogs | Action | [src/screens/StarterPack/StarterPackScreen.tsx:706](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/StarterPack/StarterPackScreen.tsx#L706) |
| Save / discard composer confirmation | Confirmation and information dialogs | Action | [src/view/com/composer/Composer.tsx:1509](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/com/composer/Composer.tsx#L1509) |
| Skip empty thread posts confirmation | Confirmation and information dialogs | UI preview plan | [src/view/com/composer/Composer.tsx:1566](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/com/composer/Composer.tsx#L1566) |
| Discard thread post confirmation | Confirmation and information dialogs | UI preview plan | [src/view/com/composer/Composer.tsx:1758](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/com/composer/Composer.tsx#L1758) |
| Delete saved draft confirmation | Confirmation and information dialogs | Action | [src/view/com/composer/drafts/DraftItem.tsx:238](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/com/composer/drafts/DraftItem.tsx#L238) |
| Private profile sharing notice | Confirmation and information dialogs | UI preview plan | [src/view/com/profile/ProfileMenu.tsx:577](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/com/profile/ProfileMenu.tsx#L577) |

## Excluded source views

| View | Reason | Source |
| --- | --- | --- |
| AppIconSettings | link-only | [src/screens/Settings/AppearanceSettings.tsx:166](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/AppearanceSettings.tsx#L166) |
| CommunityGuidelines | link-only | [src/routes.ts:71](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/routes.ts#L71) |
| CopyrightPolicy | link-only | [src/routes.ts:71](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/routes.ts#L71) |
| Debug | internal | [src/screens/Settings/Settings.tsx:301](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/Settings.tsx#L301) |
| DebugMod | internal | [src/screens/Settings/Settings.tsx:481](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/Settings.tsx#L481) |
| LegacyNotificationSettings | redirect | [src/screens/Settings/LegacyNotificationSettings.tsx:13](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/LegacyNotificationSettings.tsx#L13) |
| NotFound | fallback | [src/lib/routes/router.ts:26](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/lib/routes/router.ts#L26) |
| PrivacyPolicy | link-only | [src/routes.ts:71](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/routes.ts#L71) |
| SharedPreferencesTester | internal | [src/view/screens/Storybook/Storybook.tsx:86](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/screens/Storybook/Storybook.tsx#L86) |
| Start | redirect | [src/view/screens/Home.tsx:73](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/screens/Home.tsx#L73) |
| StarterPackShort | link-only | [src/lib/strings/url-helpers.ts:412](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/lib/strings/url-helpers.ts#L412) |
| Support | link-only | [src/routes.ts:71](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/routes.ts#L71) |
| TermsOfService | link-only | [src/routes.ts:71](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/routes.ts#L71) |
| Topic | server-link | [src/components/TrendingTopics.tsx:142](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/TrendingTopics.tsx#L142) |
| Web embed code dialog | Only web callers | [src/components/dialogs/Embed.tsx:1](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/Embed.tsx#L1) |
| Native image editor | Native implementation returns null | [src/view/com/composer/photos/EditImageDialog.tsx:1](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/view/com/composer/photos/EditImageDialog.tsx#L1) |
| Bookmarks announcement | Not mounted by current NUX host | [src/components/dialogs/nuxs/BookmarksAnnouncement.tsx:1](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/nuxs/BookmarksAnnouncement.tsx#L1) |
| Drafts announcement | Not mounted by current NUX host | [src/components/dialogs/nuxs/DraftsAnnouncement.tsx:1](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/nuxs/DraftsAnnouncement.tsx#L1) |
| Contacts announcement | Not mounted by current NUX host | [src/components/dialogs/nuxs/FindContactsAnnouncement.tsx:1](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/nuxs/FindContactsAnnouncement.tsx#L1) |
| Verification announcement | Not mounted by current NUX host | [src/components/dialogs/nuxs/InitialVerificationAnnouncement.tsx:1](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/nuxs/InitialVerificationAnnouncement.tsx#L1) |
| Live now beta announcement | Not mounted by current NUX host | [src/components/dialogs/nuxs/LiveNowBetaDialog.tsx:1](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/nuxs/LiveNowBetaDialog.tsx#L1) |
| Activity subscription announcement | Not mounted by current NUX host | [src/components/dialogs/nuxs/ActivitySubscriptions.tsx:1](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/dialogs/nuxs/ActivitySubscriptions.tsx#L1) |
| Growthbook flags dialog | Internal builds only | [src/screens/Settings/components/GrowthbookDialog.tsx:1](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/screens/Settings/components/GrowthbookDialog.tsx#L1) |
| Debug field prompt | Internal debugging UI | [src/components/DebugFieldDisplay.tsx:1](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/DebugFieldDisplay.tsx#L1) |
| Web welcome overlay | Only mounted by index.web.tsx; native useWelcomeModal throws | [src/components/hooks/useWelcomeModal.native.ts:4](https://github.com/bluesky-social/social-app/blob/2d8e349afd92d2be3ff31f298bc27ab0d82c61cc/src/components/hooks/useWelcomeModal.native.ts#L4) |
