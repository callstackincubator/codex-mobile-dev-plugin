/**
 * Decides what to record for a node once a reach attempt has run its course and the delivery
 * screenshot (the frame saved to `screens/<slug>.png`, distinct from any diagnostic screenshot a
 * reach strategy took along the way) has been attempted.
 *
 * This module exists to fix one specific, reported bug: a verified arrival gets thrown away because
 * of an unrelated capture failure. Concretely, `orchestrator.ts` used to turn *any* screenshot error
 * at delivery time into `recordUnreached(node, 'missing', …)` — writing `screenshot: null`,
 * `captureMethod: 'unreached'`, `pathCommands` dropped even when the vision judge had just confirmed
 * the exact target, or a replay script for it had just been published. `buildAgentDeviceScreens`
 * keys `pathToReach` off the stored journey, never off `capture.screenshot`, so simply
 * not overwriting the capture with a `missing` record is all it takes for the entry to survive a
 * transient screenshot failure — the next sweep does not need to re-explore it from scratch.
 *
 * No device or Electron import here, by design — see `reach/types.ts`'s doc comment. Every input is
 * data the caller already has in hand; this function only decides what to do with it.
 */
import type { AppFlowCapture, AppFlowCaptureStatus, AppFlowPressable } from '../../shared/app-flow.ts'
import type { ReachEvidence } from './types.ts'

/** Outcome of attempting the delivery screenshot itself, already resolved by the caller. */
export type DeliveryScreenshotOutcome =
  | { ok: true; relativePath: string }
  /**
   * `reason` should already describe *why* — including the "session was lost; the app was
   * relaunched at its launch URL" case a caller derives from `captureScreenshot`'s `relaunched`
   * flag. A relaunched frame is the launch screen, not the target, so a caller must never pass
   * `{ ok: true }` for one; treating it as a failure here is what keeps that stale frame from ever
   * being written under this node's slug.
   */
  | { ok: false; reason: string }

export interface DeliveryAttemptInput {
  kind: 'attempt'
  evidence: ReachEvidence
  screenshot: DeliveryScreenshotOutcome
  pressables: AppFlowPressable[]
  pressablesError: string | null
  /**
   * Which observation `pressables` were read from. 'live' is the normal delivery-time read.
   * 'arrival' means that read could not be trusted and the controls kept from the verified arrival
   * observation were used instead — see `chooseDeliverySources`. It is written into the capture's
   * note because `agent-device-screens.json` carries these controls to the debugging and profiling
   * pipelines, and a consumer there has no other way to tell a control list read off this screen
   * from one carried over from an earlier moment on it. Defaults to 'live'.
   */
  pressablesSource?: DeliverySourceKind
  captureMethod: NonNullable<AppFlowCapture['captureMethod']>
  structureRevision?: string
}

/** Which observation a delivered artefact (frame or control list) was taken from. */
export type DeliverySourceKind = 'live' | 'arrival'

/**
 * Everything the caller has in hand once both delivery reads have been attempted. `live*` is what
 * the device gave back just now; `arrival*` is what was kept the moment the vision judge accepted
 * this node — the frame copied to its own scratch slot, and that observation's controls.
 */
export interface DeliverySourceInput {
  liveScreenshot: DeliveryScreenshotOutcome
  livePressables: AppFlowPressable[]
  livePressablesError: string | null
  arrivalFramePath: string | null
  arrivalPressables: AppFlowPressable[]
}

export interface DeliverySources {
  /**
   * 'live' means copy the scratch frame the delivery capture just wrote; 'arrival' means copy
   * `framePath` instead; 'none' means there is no usable frame at all and `reason` is what the
   * record should say.
   */
  screenshot:
    | { source: 'live' }
    | { source: 'arrival'; framePath: string }
    | { source: 'none'; reason: string }
  pressables: { source: DeliverySourceKind; pressables: AppFlowPressable[]; error: string | null }
}

/**
 * Picks which observation each half of the delivery record comes from.
 *
 * Both halves hang off one fact: whether the live delivery capture is trustworthy. When exploration
 * reaches a screen, the publish step that follows saves the recording, closes the session and
 * *replays* the script — which relaunches the app and re-walks it. A replay that fails mid-walk
 * leaves the device stranded somewhere else entirely with no session, so the delivery screenshot
 * taken moments later comes back `relaunched: true` (the launch screen) and the control read taken
 * right after it reads the launch screen's controls. The screenshot half of that was already caught
 * — a relaunched frame is never written under the node's slug. The control read was not: it was
 * stored as this node's `pressables` with nothing to flag it, which is silent corruption rather
 * than a visible gap.
 *
 * So one rule covers both: a sound live capture wins, because it is the fresher look at the screen;
 * a compromised one falls back to what was kept at the verified arrival, which is a real look at
 * this exact screen even though it is older. Only when neither exists does the record go without.
 *
 * The live control read's own error is dropped when the arrival controls are used in its place —
 * it describes a read whose result was discarded, so reporting it in the note would only invite a
 * reader to distrust controls that are in fact good.
 */
export function chooseDeliverySources(input: DeliverySourceInput): DeliverySources {
  const {
    liveScreenshot,
    livePressables,
    livePressablesError,
    arrivalFramePath,
    arrivalPressables
  } = input
  const live = {
    source: 'live' as const,
    pressables: livePressables,
    error: livePressablesError
  }
  if (liveScreenshot.ok) {
    return { screenshot: { source: 'live' }, pressables: live }
  }
  return {
    screenshot: arrivalFramePath
      ? { source: 'arrival', framePath: arrivalFramePath }
      : { source: 'none', reason: liveScreenshot.reason },
    pressables: arrivalPressables.length
      ? { source: 'arrival', pressables: arrivalPressables, error: null }
      : live
  }
}

/**
 * A settled "this build withholds the screen" verdict — kept as its own input variant so the same
 * `needsNavigation` rule (`status !== 'unavailable'`, the same rule `recordUnreached` applies) is
 * expressed once and is exercised directly by tests, even though today only `recordUnreached` calls
 * this path in the running orchestrator.
 */
export interface DeliveryUnavailableInput {
  kind: 'unavailable'
  reason: string
  structureRevision?: string
}

export type DeliveryInput = DeliveryAttemptInput | DeliveryUnavailableInput

export type DeliveryOutcome =
  | { kind: 'reached'; capture: AppFlowCapture }
  | { kind: 'missing'; capture: AppFlowCapture }
  | { kind: 'unavailable'; capture: AppFlowCapture }

function joinNotes(...parts: (string | null | undefined)[]): string | null {
  const joined = parts.filter((part): part is string => Boolean(part)).join(' — ')
  return joined || null
}

function captureRecord(
  status: AppFlowCaptureStatus,
  fields: {
    note: string | null
    screenshot: string | null
    pressables: AppFlowPressable[]
    captureMethod: NonNullable<AppFlowCapture['captureMethod']>
    pathCommands?: readonly string[] | null
    replayScript: string | null
    replayVerified: boolean
    structureRevision?: string
  }
): AppFlowCapture {
  return {
    status,
    // Two different rules, kept distinct exactly as they were before this function existed:
    // an unreached node (missing/unavailable) needs another navigation attempt unless the verdict
    // is the settled 'unavailable' — that is `recordUnreached`'s rule. A reached node needs one only
    // when the method that reached it was live exploration rather than a replay or a deep link,
    // since those already have a reusable path recorded.
    needsNavigation:
      fields.captureMethod === 'unreached'
        ? status !== 'unavailable'
        : fields.captureMethod === 'agent-navigation',
    note: fields.note,
    screenshot: fields.screenshot,
    pressables: fields.pressables,
    captureMethod: fields.captureMethod,
    // Omitted rather than written as `null` when there is none, so a capture carried forward from
    // an earlier sweep is not overwritten with an absence by a later reach that walked nothing.
    ...(fields.pathCommands?.length ? { pathCommands: [...fields.pathCommands] } : {}),
    replayScript: fields.replayScript,
    replayVerified: fields.replayVerified,
    structureRevision: fields.structureRevision,
    stale: false
  }
}

export function decideDelivery(input: DeliveryInput): DeliveryOutcome {
  if (input.kind === 'unavailable') {
    return {
      kind: 'unavailable',
      capture: captureRecord('unavailable', {
        note: input.reason,
        screenshot: null,
        pressables: [],
        captureMethod: 'unreached',
        replayScript: null,
        replayVerified: false,
        structureRevision: input.structureRevision
      })
    }
  }

  const {
    evidence,
    screenshot,
    pressables,
    pressablesError,
    pressablesSource,
    captureMethod,
    structureRevision
  } = input
  const hasVerifiedArrival = evidence.arrival?.verdict === 'match'
  const hasPublishedReplay =
    Boolean(evidence.replayScript) || Boolean(evidence.pathCommands?.length)
  const pressablesNote = joinNotes(
    pressablesError ? `Interactive elements unavailable: ${pressablesError}` : null,
    pressablesSource === 'arrival'
      ? 'Interactive elements are from the verified arrival observation, not the delivery read'
      : null
  )

  if (!hasVerifiedArrival && !hasPublishedReplay) {
    // Nothing backs this attempt — no live arrival, no saved journey — so a missing screenshot
    // really does mean the screen was never reached. This is the one case that still becomes
    // `missing`, unchanged from before this fix: same shape `recordUnreached` produced, captureMethod
    // included, since there is nothing reach-specific left to preserve.
    return {
      kind: 'missing',
      capture: captureRecord('missing', {
        note: joinNotes(screenshot.ok ? null : screenshot.reason, pressablesNote),
        screenshot: null,
        pressables,
        captureMethod: 'unreached',
        replayScript: null,
        replayVerified: false,
        structureRevision
      })
    }
  }

  // The judge confirmed arrival, or a verified replay was published — this reach is real whatever
  // the screenshot did. Status comes from the arrival when there is one. A replay-only delivery
  // (a published script but no live arrival this attempt — `evidence.arrival` is only ever null when
  // a strategy replayed a script without a fresh arrival check) has no fresher status to report, so
  // it defaults to 'ok': the replay was verified at publish time, and nothing about a delivery-time
  // screenshot failure is evidence of a different status now.
  const status: AppFlowCaptureStatus = evidence.arrival?.status ?? 'ok'
  const note = screenshot.ok
    ? joinNotes(evidence.arrival?.reason ?? null, pressablesNote)
    : joinNotes(
        `Reached and verified; screenshot unavailable: ${screenshot.reason}`,
        pressablesNote
      )

  return {
    kind: 'reached',
    capture: captureRecord(status, {
      note,
      screenshot: screenshot.ok ? screenshot.relativePath : null,
      pressables,
      captureMethod,
      pathCommands: evidence.pathCommands,
      replayScript: evidence.replayScript,
      replayVerified: evidence.replayVerified,
      structureRevision
    })
  }
}
