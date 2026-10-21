/**
 * Did the screenshot and the control read describe the same screen?
 *
 * **The bug this answers.** A deep-link reach reads the screen three times and, until this module,
 * compared none of them: the liveness probe's frame from before `apps.open` (`preOpen`), the last
 * read of the settle poll (`settled`), and the read `verifyWithDiagnostic` takes immediately after
 * the screenshot (`afterShot`). The screenshot is written *between* the second and the third. When
 * the router is still mid-transition at the settle, those two reads are two different screens and
 * the capture that gets stored is a photograph of one with the control list of the other.
 *
 * It is not a rare race. `session_2026-10-13_14-33-40.log`, a sweep run with the arrival judge off
 * for deep links, straddled eight of its 39 deep-linked nodes in one pass — settle count → verify
 * count: NotificationSettings 16→33, Profile 39→30, ProfileFollowers 46→9, ProfileFollows 15→9,
 * ProfileKnownFollowers 15→9, PostLikedBy 52→8, PostRepostedBy 44→10, PostQuotes 43→10. The other
 * 31 checks were identical or within 2 controls, so the signal is not noise: either the two reads
 * agree closely or they describe unrelated screens. Three of the eight are decisive on their own —
 * `screens/profilefollowers.png` is the MyProfile screen; `profilefollows.png` and
 * `profileknownfollowers.png` are byte-identical (md5 a96c9c4844407e874b88c0ad2856ae30); and the
 * Post chain is off by one, with PostRepostedBy's frame showing "Liked By / 8,100 likes" and
 * PostQuotes' showing "Reposted By / 1,400 reposts".
 *
 * **Why this is the right comparison and a content classifier is not.** The tempting fix — notice
 * that the frame is "still loading" — cannot work here: the in-flight frames carried 46 and 52
 * controls against their real screens' 9 and 8. The straddled frame is the *denser* one, because
 * it is the outgoing screen (a profile, a post thread) with the incoming one drawn over it. No
 * sparseness rule separates those. Two reads of the same screen moments apart, on the other hand,
 * agree on nearly all of their vocabulary; two different screens do not. That is the whole
 * mechanism.
 *
 * **What a classification is for.** `moved` is the straddle: re-settle and re-shoot once, and the
 * second frame is the screen. `never-left` is the opposite failure — the URL did nothing and the
 * app is still where it was — which is *not* worth another device call and is reported as
 * uncertain so the ladder falls through. `stable` is the overwhelmingly common case and costs
 * nothing.
 *
 * No device, no Electron, no model call: every input is a read the sweep already paid for. Pure
 * functions over `screen-signals.ts`, run under `node --test`.
 */
import type { AppFlowPressable } from '../../shared/app-flow.ts'
import { fingerprint, similarity } from '../screen-signals.ts'

export type FrameTransition = 'stable' | 'moved' | 'never-left'

/**
 * Below this overlap, the settle read and the post-screenshot read are not the same screen and the
 * screenshot sits between two different ones.
 *
 * Set from the measured gap in `session_2026-10-13_14-33-40.log` rather than from taste. The 31
 * sound checks in that run re-read a screen that had not moved and differed by at most 2 controls
 * out of 9–52, which is an overlap in the high 0.9s even allowing for a counter ticking or an
 * avatar resolving. The eight straddles crossed between screens with almost no shared vocabulary
 * at all (46 profile controls against 9 follower rows; 52 post-thread controls against 8). Nothing
 * measured lands between roughly 0.3 and 0.9, so the floor sits in the middle of an empty range
 * and the exact value is not load-bearing. It is deliberately *low*, because the cost is lopsided:
 * a missed straddle stores a wrong capture, while a false `moved` spends ~1.5s re-settling a
 * screen that was already right and then photographs it again.
 */
export const MOVED_FLOOR = 0.6

/**
 * At or above this overlap between the pre-open frame and the settled frame, the app is still
 * showing the screen it was on when the URL went out.
 *
 * Higher than `MOVED_FLOOR` on purpose: this one is read as "nothing happened", and the honest
 * version of that claim is a near-identical screen, not a vaguely similar one. It also has to
 * survive the ordinary churn of a live screen between two reads a second apart, which is what
 * keeps it below 1.0 — the same reasoning `APP_READY_SETTLE_SIMILARITY` records for the settle
 * poll, one notch looser because these two reads are further apart in time.
 *
 * 0.9 is also where the measured near-misses sit, scored over the stored captures of that same
 * sweep: the two sibling list screens that look most alike in this app, ProfileFollowers and
 * ProfileFollows (9 controls each, differing in one), overlap **0.867**, and a tab root against
 * its own variant, Profile and MyProfile, overlaps **0.641**. Both are genuinely different
 * screens and must never be called `never-left`; both clear `MOVED_FLOOR` comfortably and fall
 * below this one, so the band between the two floors is exactly the "similar but different
 * screen" region and nothing in it is acted on.
 */
export const UNCHANGED_FLOOR = 0.9

/**
 * How much of the target screen's own vocabulary has to show up in the frame before an unchanged
 * screen is read as "we were already there" rather than "the URL did nothing".
 *
 * This is the lookalike exemption, and it exists because `never-left` is ambiguous in exactly the
 * way `judgeProbeFrame` (`probe-route.ts`) documents for its own unchanged-frame rule: a tab root
 * and its first child share most of their controls, and a deep link to the screen the app is
 * already standing on legitimately changes nothing. Acting on the unchanged signal alone would
 * report those as failures and send them down the ladder to an exploration walk — which in the
 * reference run cost 163s on ProfileList and still recorded the screen missing. So the signal is
 * never acted on alone: `expectedCoverage`/`expectedNodeTokens` (`exploration.ts`) score the frame
 * against the node's own title/id/path words for nothing — no device call, no tokens — and a frame
 * that is already covered by the target's vocabulary breaks the tie in favour of `stable`.
 *
 * 0.5 rather than the 0.85 `pickOpportunisticCandidate` uses, because the two decisions are not
 * the same bet. That one nominates a screen for a vision call out of every node in the app and
 * must not fire on incidental chrome overlap; this one is handed a single named candidate — the
 * route we just opened — and only has to answer "does this frame look anything like it". Half the
 * node's own words is a weak claim deliberately, since the lopsided cost runs the other way here:
 * wrongly calling a frame `never-left` throws a working deep link into a walk.
 */
export const TARGET_COVERAGE_FLOOR = 0.5

export interface FrameTransitionInput {
  /** The frame as it stood immediately before the URL was opened, or null when the read failed or
   *  the caller has none (a tap, a replay). Null disables the `never-left` rule entirely: an
   *  unanswerable question is not evidence. */
  preOpen?: readonly AppFlowPressable[] | null
  /** The settle poll's own last read — what the harness believed the destination was. */
  settled?: readonly AppFlowPressable[] | null
  /** The read taken immediately after the screenshot, i.e. what the frame on disk is being
   *  claimed to show. */
  afterShot?: readonly AppFlowPressable[] | null
  /**
   * `expectedCoverage(fingerprint(afterShot), expectedNodeTokens(node))` — how much of the target
   * node's own vocabulary the frame carries, or null/undefined when the caller cannot compute it
   * (a node with no descriptive words, a failed read). Only consulted for `never-left`; see
   * `TARGET_COVERAGE_FLOOR`.
   */
  targetCoverage?: number | null
}

export interface FrameTransitionResult {
  transition: FrameTransition
  /** One sentence, carrying the numbers it was decided on, for the capture note and the log. */
  reason: string
}

function round(value: number): string {
  return value.toFixed(2)
}

/**
 * Classifies one deep-link open from the three reads around it.
 *
 * Order matters and mirrors `judgeProbeFrame`'s: the expensive, actionable answer is tested first,
 * and the "nothing happened" answer last, with its exemption applied before it is allowed to
 * stand. A frame that moved is a frame that moved regardless of what it looked like before the
 * open — the two rules cannot both be true of one open, and `moved` needs no exemption of its own
 * because a screen that changed under the camera is a straddle whatever screen it changed from.
 *
 * Missing reads resolve to `stable`. This function reports what it can see; a caller holding one
 * read and a null is in no position to disbelieve its own capture, and saying so here keeps every
 * caller from re-deriving the same "not enough evidence" branch.
 */
export function classifyFrameTransition(input: FrameTransitionInput): FrameTransitionResult {
  const settled = input.settled ?? null
  const afterShot = input.afterShot ?? null
  if (!settled?.length || !afterShot?.length) {
    return {
      transition: 'stable',
      reason: 'no pair of reads to compare around the screenshot'
    }
  }

  const settledFrame = fingerprint(settled)
  const afterShotFrame = fingerprint(afterShot)
  const acrossShot = similarity(settledFrame, afterShotFrame)
  if (acrossShot < MOVED_FLOOR) {
    return {
      transition: 'moved',
      reason:
        `the screen changed under the camera: the settle read ${settled.length} control(s) and ` +
        `the read after the screenshot found ${afterShot.length}, overlap ${round(acrossShot)} ` +
        `(below ${MOVED_FLOOR})`
    }
  }

  const preOpen = input.preOpen ?? null
  if (preOpen?.length) {
    const unchanged = similarity(fingerprint(preOpen), settledFrame)
    if (unchanged >= UNCHANGED_FLOOR) {
      const coverage = input.targetCoverage ?? null
      if (coverage !== null && coverage >= TARGET_COVERAGE_FLOOR) {
        return {
          transition: 'stable',
          reason:
            `the frame did not change across the open (overlap ${round(unchanged)}), but it ` +
            `carries ${round(coverage)} of the target screen's own vocabulary — this is a deep ` +
            'link to a screen the app was already showing, not a link that did nothing'
        }
      }
      return {
        transition: 'never-left',
        reason:
          `the frame is the same one that was on screen before the URL was opened (overlap ` +
          `${round(unchanged)}, at or above ${UNCHANGED_FLOOR})` +
          (coverage === null
            ? ' and nothing could score it against the target screen'
            : ` and it carries only ${round(coverage)} of the target screen's own vocabulary`)
      }
    }
  }

  return {
    transition: 'stable',
    reason: `the screenshot and the control read agree (overlap ${round(acrossShot)})`
  }
}
