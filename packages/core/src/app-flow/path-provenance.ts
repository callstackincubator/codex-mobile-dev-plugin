/**
 * Which of the four `pathToReach` sources a stored path came from, and whether anything ever
 * travelled it.
 *
 * `buildAgentDeviceScreens` (`orchestrator.ts`) picks a path from four places in a fixed order —
 * the walk's own `pathCommands`, a published `.ad` `replayScript`, a deep link the sweep opened,
 * and `buildChromePathToReach`'s reconstruction from a recorded chrome. Three of those are things
 * that *happened*; the fourth is a reconstruction. Until `pathToReach` became the Replay button's
 * only gate that difference was visible for free, because an unreached screen had no script and so
 * no button. Now it is not, and the measured sweep shows what that costs:
 *
 *   ModerationInbox  captureMethod: 'unreached', replayable: true
 *                    status: 'unavailable', note: "Registered but gated off in this build: the
 *                    screen renders <NotFoundScreen/> unless …"
 *                    pathToReach: [boot, open, press 'label="Inbox zero!"']
 *
 * Eight of the 48 entries in that sweep's `agent-device-screens.json` are chrome reconstructions
 * (`TermsOfService`, `Feeds-2`, `StarterPack`, `VideoFeed`, `Bookmarks`, `Home-Tab`, `Start`,
 * `ModerationInbox`), and every one of them was offered to the user under the same plain 'Replay'
 * button as `My-Profile`, whose three commands the sweep walked at t=153.4.
 *
 * The answer is not to drop the path. A reconstruction is the only lead to a screen the sweep never
 * reached, and a user who wants to try it should be able to. The answer is that it says what it is,
 * which is what this function computes and `AppFlowCapture.pathVerified` carries out to the badge
 * and the button.
 *
 * Pure, and free of Electron and device imports, so the one decision that changes what a button
 * promises is covered by `node --test` rather than by reading `buildAgentDeviceScreens`.
 */

/** The four sources, in `buildAgentDeviceScreens`'s own preference order. */
export type PathSource = 'walk' | 'replay-script' | 'deep-link' | 'chrome-inferred'

/** The subset of a capture this decision reads. Declared structurally so the function can be
 *  exercised without assembling a whole `AppFlowCapture`. */
export interface PathProvenanceInput {
  /** The walk's own emitted lines, when this sweep walked to the screen. */
  pathCommands?: readonly string[] | null
  /** A published `.ad` recording — only the manual recorder writes one now. */
  replayScript?: string | null
  /** Whether that recording was replayed and re-confirmed. */
  replayVerified?: boolean
  /** Whether this sweep opened a deep link for the node. */
  deepLinkOpened: boolean
}

/**
 * Which source `buildAgentDeviceScreens` would take the path from, mirroring its ladder exactly.
 *
 * Kept in step with that ladder by being the same four tests in the same order; a reader changing
 * one is expected to change the other, and `path-provenance.test.ts` pins the order so a silent
 * divergence shows up as a failed assertion rather than as a path labelled with the wrong source.
 */
export function pathSource(input: PathProvenanceInput): PathSource {
  if (input.pathCommands?.length) return 'walk'
  if (input.replayScript) return 'replay-script'
  if (input.deepLinkOpened) return 'deep-link'
  return 'chrome-inferred'
}

/**
 * Whether anything ever executed the path this source produced.
 *
 * - `walk`: the explorer performed every step, and `act` (`orchestrator.ts`) only appends a line
 *   after the device call for it returned. Travelled by construction.
 * - `replay-script`: `replayVerified` already answers this — a published recording that was
 *   replayed and re-confirmed, versus one published unverified.
 * - `deep-link`: an `openedByNode` entry exists only once `deepLinkStrategy` opened the URL **and**
 *   the arrival judge accepted the screen; the failure branch in
 *   `reach/strategies/deep-link.ts` returns above the `deep-link-opened` effect. So the presence of
 *   the entry is itself the verification.
 * - `chrome-inferred`: never, by definition. The reveal steps were observed on some other screen
 *   and the trigger was read off an edge; the sequence as a whole has not been run.
 */
export function isPathVerified(input: PathProvenanceInput): boolean {
  switch (pathSource(input)) {
    case 'walk':
      return true
    case 'replay-script':
      return input.replayVerified ?? false
    case 'deep-link':
      return true
    case 'chrome-inferred':
      return false
  }
}
