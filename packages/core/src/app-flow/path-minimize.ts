/**
 * Trimming an emitted walk down to the journey it actually made, and naming the selectors in it
 * that only this account's data can match.
 *
 * Why this exists. `walk-commands.ts` records the explorer's steps verbatim, which is the right
 * default — a path that drops a step it did not understand is a path that presses two controls and
 * claims to have arrived. But verbatim also means the walk's *flailing* is stored as instructions.
 * Measured on session_2026-10-13_13-18-49, `ProfileList` stored eight commands (t=579.458,
 * "ProfileList stored a 8-command path"), six of them presses:
 *
 *   [ 539.786] explore ProfileList action tap id="profileHeaderDropdownBtn"
 *   [ 541.912] navigate step 2 — controls now: … {"identifier":"PopoverDismissRegion", …}
 *   [ 548.444] explore ProfileList action tap label="Dismiss"
 *   [ 550.630] navigate step 3 — controls now: … {"identifier":"profileScreen", …}
 *   [ 556.217] explore ProfileList action tap id="bottomBarHomeBtn"
 *   [ 560.945] explore ProfileList action tap label="Open drawer menu"
 *   [ 567.154] explore ProfileList action tap id="menuItemButton-Lists"
 *   [ 572.915] explore ProfileList action tap label="Dummy"
 *
 * The first two are the whole of what this module removes, and the frames either side are the
 * evidence: before the dropdown press the walk was on `profileScreen`, the press put a
 * `PopoverDismissRegion` on screen (t=541.912), the `Dismiss` press took it away, and at t=550.630
 * the walk was on `profileScreen` again. Two commands, no net effect, and the second of them is a
 * selector that only exists *while* a popover is up — a replay that pressed the dropdown a few
 * milliseconds slower would find nothing called `Dismiss` to press and fail the whole path. So the
 * pair is dead weight and a timing hazard at once, and the surface it leaves behind is identical
 * whether or not it ran.
 *
 * Deliberately a very small rule set. The instruction this module answers to is "only drop a step
 * when you can justify it structurally", and exactly one shape clears that bar on the measured
 * evidence. Two rules that were considered and are *not* implemented, recorded here so the next
 * reader does not have to rediscover why:
 *
 *  - **Back-pairs.** `ProfileKnownFollowers` walked `label="Chat"` → `label="Bluesky日本語（公式）"`
 *    → `label="Go back"` → `label="Requests"` …, and that middle pair looks exactly like the
 *    dismiss pair: open a conversation, return from it. It is not the same, because `Go back` is
 *    *navigation in its own right* while `Dismiss` only ever exists to undo an overlay. A walk that
 *    pressed a toggle (a like, a follow) and then pressed `Go back` would be mangled by this rule:
 *    dropping both leaves the path standing one screen deeper than the walk ended. Telling the two
 *    apart needs a per-step "did the surface change" bit the walk does not record today; until it
 *    does, a back press is kept.
 *
 *  - **Superseded tab switches.** `ProfileList`'s `id="bottomBarHomeBtn"` is tempting to read as a
 *    tab switch that the deep-linked `bluesky://profile/me` launch made pointless, or that a later
 *    tab press overrides. Neither is true of this path: it is the *only* tab press in it, and the
 *    drawer the next step opens was pressed from `HomeScreen` (t=558.428) and was never observed on
 *    `profileScreen`. Dropping it would be a guess about where the drawer lives, and confirming the
 *    guess would mean replaying on device, which is the cost this whole round removed. No walk in
 *    the measured sweep presses two tab-bar controls, so there is no evidence to build the rule on.
 *
 * Pure, and free of Electron and device imports, so every rule here is exercised under
 * `node --test` against the same `parsePathStep` (`manual/path-commands.ts`) that executes the
 * stored lines — the module reads commands with the executor's own parser rather than a private
 * regex, so it can never drop a line the executor would have read differently.
 */
import { parsePathStep } from './manual/path-commands.ts'

/**
 * The `by`/`value` halves of an `id="…"` / `label="…"` / `text="…"` selector, or null for anything
 * else (a bare `@ref`, a selector form a future agent-device grows).
 *
 * Unquoted values are accepted because `parsePathStep`'s own tests show them arriving that way
 * (`agent-device press id=submit`); the inner `\"` escape `walkStepCommand` writes is undone, so a
 * value is compared as the app actually renders it.
 */
export function selectorParts(
  selector: string
): { by: 'id' | 'label' | 'text'; value: string } | null {
  const match = /^(id|label|text)=(?:"([\s\S]*)"|([\s\S]*))$/.exec(selector.trim())
  if (!match) return null
  const raw = match[2] ?? match[3] ?? ''
  return { by: match[1] as 'id' | 'label' | 'text', value: raw.replace(/\\"/g, '"') }
}

/**
 * Controls whose only purpose is to take an overlay back off the screen.
 *
 * `dismiss` and `PopoverDismissRegion` are the two the measured sweep actually produced — the
 * frame at t=541.912 carries `{"identifier":"PopoverDismissRegion","role":"UIDimmingView",
 * "label":"dismiss popup"}` and the step at t=548.444 pressed `label="Dismiss"`. `close` and
 * `cancel` are the other two standard spellings of the same affordance and are matched for the
 * same structural reason, not from a measurement of their own.
 *
 * Matched on the selector's *value* rather than its kind, since the same control shows up as an
 * identifier on the dimming view and as a label on the button.
 */
const DISMISS_VALUES = new Set([
  'dismiss',
  'dismiss popup',
  'dismiss popover',
  'popoverdismissregion',
  'close',
  'close popup',
  'close menu',
  'cancel'
])

/** Whether this selector names an overlay-dismissing control. */
export function isDismissSelector(selector: string): boolean {
  const parts = selectorParts(selector)
  if (!parts) return false
  return DISMISS_VALUES.has(parts.value.trim().toLowerCase())
}

/** One line the minimizer removed, and why — carried so the sweep can log what it dropped rather
 *  than quietly shortening a path the user may later have to debug. */
export interface RemovedCommand {
  command: string
  /** The only rule there is. Named rather than implied so a second rule can be added without the
   *  log line or the tests having to change shape. */
  rule: 'cancelled-overlay'
}

export interface MinimizedPath {
  commands: string[]
  removed: RemovedCommand[]
}

/**
 * The walk's own command lines with every cancelled-overlay pair removed.
 *
 * The rule, stated exactly: **a press on an overlay-dismissing control cancels the press
 * immediately before it, and both are dropped.** Adjacency is what makes it safe. With nothing in
 * between, the dismissed overlay can only be the one the previous press opened, and nothing
 * happened while it was up — so the surface the next command presses into is the same surface it
 * would have pressed into had neither line run.
 *
 * Everything else blocks the rule rather than being reasoned about:
 * - a dismiss whose predecessor is a `fill`, a `scroll`, an `open` or nothing at all is kept — the
 *   overlay was opened by something this function cannot see, so dropping the dismiss would leave
 *   the replay pressing into a popover;
 * - a line `parsePathStep` cannot read is kept and also blocks a following dismiss, because an
 *   unreadable line is exactly the one whose effect is unknown.
 *
 * Applied left to right over a stack, so chains collapse: `A, B, dismiss, dismiss` removes
 * `B, dismiss` and then `A, dismiss`, which is the same answer as collapsing by hand.
 *
 * Takes only the walk's own lines — never the baseline launch prefix or a command seed's inherited
 * journey. A seed prefix is a path that was already stored (and already minimized) for the parent
 * screen, and the first press of a last-hop walk cancelling the *parent's* last press is a claim
 * about two separate journeys that this rule's adjacency argument does not cover.
 */
export function minimizeWalkCommands(commands: readonly string[]): MinimizedPath {
  const kept: Array<{ command: string; press: boolean }> = []
  const removed: RemovedCommand[] = []

  for (const command of commands) {
    const step = parsePathStep(command)
    const isPress = step?.kind === 'press'
    if (isPress && isDismissSelector(step.selector)) {
      const previous = kept[kept.length - 1]
      if (previous?.press) {
        kept.pop()
        removed.push(
          { command: previous.command, rule: 'cancelled-overlay' },
          { command, rule: 'cancelled-overlay' }
        )
        continue
      }
    }
    kept.push({ command, press: isPress })
  }

  return { commands: kept.map((entry) => entry.command), removed }
}

/**
 * The selectors in a stored path that match on what the app *rendered* rather than on an identifier
 * its source declares — the portability question `manual/commands.ts`'s `isPortable` already asks,
 * asked one notch harder because a stored path has a harder job than a destination guard.
 *
 * `isPortable` accepts a `label` because it only has to re-verify a landmark inside the session
 * that just saw it; it refuses `text` because rendered copy changes under it. A `pathToReach` is
 * replayed days later, on another machine, against another account's data, so the same split does
 * not hold: `ProfileList`'s last step is `press 'label="Dummy"'` (t=572.915), and `Dummy` is not a
 * control — it is a list this account happens to own. On any other account that press matches
 * nothing and the path dies on its last line.
 *
 * What this deliberately does *not* do is single `Dummy` out. At this layer `label="Dummy"` and
 * `label="Open drawer menu"` (t=560.945) are the same thing: a string that was on the screen. One
 * breaks on another account's data, the other on a change of locale, and nothing in the stored path
 * distinguishes them — so both are reported and neither is dropped or rewritten. An `id=` selector
 * is a `nativeID`/`testID` written in the app's source, which is why `locatorFor` ranks it first
 * and why it is the only kind not reported here.
 *
 * Reported, never acted on: the caller persists the list so a consumer can say "this path leans on
 * two strings this device was showing" instead of discovering it from a replay failure. Dropping
 * such a step is not an option — it is the step that reaches the screen.
 */
export function contentMatchedSelectors(commands: readonly string[]): string[] {
  const found: string[] = []
  for (const command of commands) {
    const step = parsePathStep(command)
    if (step?.kind !== 'press' && step?.kind !== 'fill') continue
    const parts = selectorParts(step.selector)
    if (!parts || parts.by === 'id') continue
    if (!found.includes(step.selector)) found.push(step.selector)
  }
  return found
}
