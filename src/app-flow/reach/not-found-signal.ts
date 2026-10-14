/**
 * Deciding, without the vision judge, whether a deep link landed on the build's own not-found
 * screen.
 *
 * The arrival judge's `status: 'not-found'` is otherwise the sweep's only detector, and three
 * things downstream turn on it: the `deep-link-not-found` effect (which tells the exploration
 * prompt the route may not exist in this build at all), the `findRouteAncestor` prefix fallback,
 * and the exemption from the deep-link circuit breaker — a 404 is a settled answer about *this
 * route*, never evidence that the URL scheme stopped routing. With the judge switched off for deep
 * links (`arrivalJudge: false` in `DeepLinkInput`) that one bit has to come from evidence already
 * in hand, so this module reads it off the accessibility snapshot the strategy captures anyway.
 *
 * **The asymmetry that sets every threshold here.** A miss costs one wasted rung: the open is
 * treated as a match, the screen is captured, and at worst the sweep records a 404 frame for a
 * route it should have marked unavailable. A false positive costs much more — it diverts the reach
 * to the ancestor-prefix path, votes a `deep-link-rejection` into the durable store so *later
 * sweeps skip the URL too*, and (via `guard-gate-closed`) can wave every sibling behind the same
 * gate off its own probe. So every rule below is built to be wrong in the direction of "not a
 * 404", and the generic one-token tests that would catch the most screens are deliberately absent.
 *
 * Three rules, in descending order of how much they actually know:
 *
 * 1. `captured-fallback` — the build's *own* fallback route was captured at some point (this sweep
 *    or a previous one, read back off the document) and the controls on screen now look like the
 *    controls on that screen. This is the only rule with a build-specific signature rather than a
 *    guess about English, which is why it runs first and why `NotFoundEvidence.fallbackPressables`
 *    is worth threading through. Note the ordering it depends on: `isFallbackRoute`
 *    (`sweep-order.ts`) sorts `+not-found` / NotFound / unmatched routes into the *last* tier, so
 *    within a single fresh sweep this rule is usually dark and rules 2-3 carry the load. It pays
 *    off on a resumed or repeated sweep, where the capture is already on disk.
 *
 * 2. `caption` — some control's text is, in whole, one of the handful of captions a router's 404
 *    screen actually uses ("Page not found", "This screen doesn't exist.", "404"). Anchored at both
 *    ends on purpose: an app's own empty state says "No results found" or "User not found" inside a
 *    sentence, and neither is the router's fallback. Expo Router's stock `+not-found` ("This screen
 *    doesn't exist." / "Go to home screen!") and the hand-written NotFoundScreen pattern
 *    `parser.ts`'s `extractGuard` looks for both land here.
 *
 * 3. `phrase-and-exit` — a weaker phrase *inside* a longer string, accepted only on a screen that
 *    is also sparse and also offers a way back to the app's home. A real screen that merely
 *    mentions a missing thing is dense with its own content and offers its own controls; a 404 is
 *    a headline and an exit. All three conditions must hold, which is what keeps this rule from
 *    being the false-positive machine a bare phrase match would be.
 *
 * An empty or unreadable snapshot is never a 404 — a frame nothing could be read off is a frame
 * this module has no opinion about, and the caller's default is "match".
 *
 * No device or Electron import here — see `reach/types.ts`'s doc comment. Plain data and pure
 * functions, run under `node --test`.
 */
import type { AppFlowPressable } from '../../shared/app-flow.ts'
import { fingerprint, similarity } from '../screen-signals.ts'

/**
 * Whole-caption markers. Each is a complete control label on a router fallback screen and nothing
 * else — anchored at both ends so a sentence that contains one does not match (that is rule 3's
 * job, and rule 3 asks for corroboration).
 */
const CAPTION_RES: readonly RegExp[] = [
  /^404(?:\s*[-–—:|]?\s*(?:page |screen )?not found)?[.!]?$/i,
  /^(?:page|screen|route|url|link) not found[.!]?$/i,
  /^not found[.!]?$/i,
  /^unmatched route[.!]?$/i,
  /^(?:oops[,!.]?\s*)?(?:sorry[,!.]?\s*)?this (?:screen|page|route) does(?:n't| not) exist[.!]?$/i,
  /^(?:we )?could(?:n't| not) find (?:that|this) (?:page|screen|route)[.!]?$/i
]

/**
 * The same ideas as `CAPTION_RES`, allowed to appear inside a longer string. Never sufficient on
 * their own — see rule 3 in the module doc comment. Kept narrower than the captions deliberately:
 * a bare "not found" is omitted, because "User not found" and "No matching posts found" are
 * ordinary app empty states and are *not* the router's fallback.
 */
const PHRASE_RES: readonly RegExp[] = [
  /\b(?:page|screen|route) (?:was )?not found\b/i,
  /\bunmatched route\b/i,
  /\bthis (?:screen|page|route) does(?:n't| not) exist\b/i,
  /\b404\b/
]

/** A control that leaves the fallback for somewhere real — the other half of a 404's whole UI. */
const EXIT_RES: readonly RegExp[] = [
  /^go (?:back )?(?:to )?home(?: screen)?[.!]?$/i,
  /^(?:back|return) to (?:home|the app|safety)[.!]?$/i,
  /^go home[.!]?$/i,
  /^take me home[.!]?$/i,
  /^go back[.!]?$/i
]

/**
 * How much of the known fallback screen's vocabulary has to be on screen for rule 1 to fire.
 *
 * Jaccard overlap, the same measure `screen-signals.ts` uses to tell two visits to one screen
 * apart from two different screens. 0.6 rather than something looser because the two frames being
 * compared are supposed to be literally the same route rendering the same static copy: the only
 * drift expected between them is chrome a tab bar contributes, not a change of subject.
 */
const FALLBACK_SIMILARITY_FLOOR = 0.6

/**
 * Below this, the captured fallback's fingerprint is too thin to identify anything — a screen whose
 * whole vocabulary is two words will cross any overlap threshold against half the app.
 */
const MIN_FALLBACK_TOKENS = 3

/**
 * Rule 3's "this screen is a headline and an exit, not an app screen" bound. A router fallback
 * carries a title, a line of copy and a way out; anything appreciably busier is a screen with
 * content of its own, whatever words happen to be on it.
 */
const SPARSE_SCREEN_MAX_CONTROLS = 8

/** What this module knows about the build's own not-found screen, beyond the frame in front of it. */
export interface NotFoundEvidence {
  /**
   * The controls read off the build's own fallback route (`isFallbackRoute`, `sweep-order.ts`) the
   * last time anything captured it — this sweep, or a previous one read back off `app-flow.json`.
   * Absent or empty simply turns rule 1 off; it is not an error and not a signal.
   */
  fallbackPressables?: readonly AppFlowPressable[] | null
}

export type NotFoundRule = 'captured-fallback' | 'caption' | 'phrase-and-exit'

export interface NotFoundSignal {
  notFound: boolean
  /** Which rule fired, or null when none did. Diagnostic; only `notFound` is acted on. */
  rule: NotFoundRule | null
  /**
   * Why, phrased to read correctly where a judge's `reason` would have gone — it is stored
   * verbatim on a deep-link rejection and shown in the sweep's console trail.
   */
  reason: string
}

/** Every string a pressable contributes, trimmed, with blanks dropped. */
function captions(pressables: readonly AppFlowPressable[]): string[] {
  const out: string[] = []
  for (const pressable of pressables) {
    for (const source of [pressable.text, pressable.label, pressable.identifier]) {
      const text = source?.trim()
      if (text) out.push(text)
    }
  }
  return out
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

/**
 * Whether the screen these controls describe is the build's own not-found route.
 *
 * `pressables` is the accessibility snapshot taken alongside the deep link's diagnostic frame —
 * null when the read failed, which is treated exactly like an empty one: no opinion, no 404.
 */
export function detectNotFoundScreen(
  pressables: readonly AppFlowPressable[] | null | undefined,
  evidence: NotFoundEvidence = {}
): NotFoundSignal {
  const noSignal = (reason: string): NotFoundSignal => ({ notFound: false, rule: null, reason })
  if (!pressables || !pressables.length) {
    return noSignal(
      'No controls could be read, so nothing identifies this frame as a not-found screen.'
    )
  }

  // Rule 1 — the build's own fallback screen, as this build actually renders it.
  const fallback = evidence.fallbackPressables
  if (fallback && fallback.length) {
    const known = fingerprint(fallback)
    if (known.size >= MIN_FALLBACK_TOKENS) {
      const overlap = similarity(fingerprint(pressables), known)
      if (overlap >= FALLBACK_SIMILARITY_FLOOR) {
        return {
          notFound: true,
          rule: 'captured-fallback',
          reason: `the screen matches this build's own captured not-found route (${overlap.toFixed(2)} control overlap)`
        }
      }
    }
  }

  const texts = captions(pressables)

  // Rule 2 — a caption that is a router fallback's headline and nothing else.
  const caption = texts.find((text) => matchesAny(text, CAPTION_RES))
  if (caption) {
    return {
      notFound: true,
      rule: 'caption',
      reason: `the screen shows "${caption}", which is the app's not-found screen`
    }
  }

  // Rule 3 — a weaker phrase, on a sparse screen, next to a way back out.
  const phrase = texts.find((text) => matchesAny(text, PHRASE_RES))
  if (phrase) {
    if (pressables.length > SPARSE_SCREEN_MAX_CONTROLS) {
      return noSignal(
        `"${phrase}" appears here, but the screen carries ${pressables.length} controls, so it is content of its own rather than a not-found screen.`
      )
    }
    if (!texts.some((text) => matchesAny(text, EXIT_RES))) {
      return noSignal(
        `"${phrase}" appears here, but the screen offers no way back to the app, so it is not conclusively the not-found screen.`
      )
    }
    return {
      notFound: true,
      rule: 'phrase-and-exit',
      reason: `the screen shows "${phrase}" with a way back to the app and nothing else, which is the app's not-found screen`
    }
  }

  return noSignal('Nothing on this screen identifies it as the app’s not-found screen.')
}
