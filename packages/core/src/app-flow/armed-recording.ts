/**
 * The one `--saveScript` transaction a device may have open at a time, and the rule every other
 * `apps.open` in this module has to obey while it is open.
 *
 * agent-device publishes a recording only if exactly one successful open belongs to it. A second
 * one — any `apps.open` issued between the arming open and `sessions.saveScript` /
 * `sessions.close({ saveScript })` — kills the transaction, and the publish that follows fails
 * with `This script recording was aborted by a second successful open and cannot be published`.
 * Nothing in the device API asks before opening, so the only way to keep that from happening is
 * for the sites that can open the app to know a recording is armed.
 *
 * Measured, session_2026-10-13_11-35-39: six walks armed a recording and six of them landed on the
 * dev-client launcher, because the arming open is `relaunch: true` and a dev client restarted
 * cold comes up on its launcher. `waitForAppReady` then cleared the launcher the only way it can,
 * with an `apps.open` of the bundle URL, and every one of those walks died at the publish:
 *
 *   [ 355.322] ProfileFollowers explore seeded at /profile/:name   <- recording armed here
 *   [ 357.987] dev-client launcher on screen with a recording armed — waiting up to 20.0s
 *   [ 379.530] apps.open — xyz.blueskyweb.app bluesky://expo-development-client/?url=...
 *   [ 403.843] walked edge — Profile -> ProfileFollowers            <- arrival verified
 *   [ 406.114] ProfileFollowers ... aborted by a second successful open and cannot be published
 *
 * The same shape at t=430.6/456.2, t=481.0, t=566.7/623.8, t=649.3/679.7 and t=704.3/743.1.
 * `MyProfile` — the one walk whose arming open did not land on the launcher, so the one walk with
 * no recovery open in its armed window — is the only node in that sweep that published
 * (`flows/myprofile.ad`, t=153.4). The `go home` lines sitting just ahead of five of those
 * failures are *downstream* of them, not the cause: they are `discardRecordingCandidate`'s soft
 * home, reached from the catch that the publish failure throws into (the log line carries no
 * `recorded steps kept at …` suffix, which is the branch where the candidate file was never
 * written because the transaction had already been aborted).
 *
 * Two different answers follow, because the two openers want different things:
 *
 *  - `goHome` is suppressed outright while armed (`suppressesSoftHome`). It is a convenience —
 *    put the app back on a known screen after an abandoned walk — and its own doc comment already
 *    records that the next caller to need a transaction restarts the app anyway. Skipping it costs
 *    a cosmetically wrong starting screen; issuing it costs the script.
 *
 *  - the dev-client launcher recovery cannot be suppressed: the app is not on screen, and waiting
 *    it out is already tried first and already measured as hopeless on this kind of device (see
 *    `launcher-deferral.ts`). So it opens, marks the transaction dead on its way past
 *    (`noteOpenWhileArmed`), and `startReplayRecording` re-arms afterwards (`needsRearm`) on top
 *    of the app the recovery has just loaded — a soft open this time, so there is no cold start,
 *    no launcher and therefore no third open to abort the replacement.
 *
 * Carried on `CaptureDevice` rather than threaded through arguments for the same reason
 * `pendingEntryGate` is: arming happens in the orchestrator's exploration setup and the opens that
 * can abort it happen several frames down inside `waitForAppReady`, and there is exactly one
 * recording per device at a time.
 */
export type ArmedRecording = {
  /** Candidate path the live transaction will publish to. Carried for the log line only. */
  readonly scriptPath: string
  /** Set once an `apps.open` has been issued behind this transaction's back. */
  aborted: boolean
}

/** A freshly armed transaction. Nothing has opened the app behind it yet, by construction. */
export function armRecording(scriptPath: string): ArmedRecording {
  return { scriptPath, aborted: false }
}

/**
 * Whether a soft `goHome` must be skipped right now.
 *
 * Only while a transaction is armed *and still alive*: once something has already aborted it there
 * is no publication left to protect, and the cosmetic value of putting the app back on its launch
 * screen is the only thing left on the table — so the home is allowed through again rather than
 * suppressed for the rest of a doomed walk.
 */
export function suppressesSoftHome(armed: ArmedRecording | null | undefined): boolean {
  return armed !== null && armed !== undefined && !armed.aborted
}

/**
 * Mark the armed transaction as aborted by an open that is about to be issued, and report whether
 * this call is the one that did it.
 *
 * Called *before* the open rather than after, because the thing being recorded is a decision the
 * caller has already made and the open itself may never return — a recovery that throws has still
 * opened the app as far as agent-device is concerned.
 *
 * The return value drives one log line, which is why it is "did this call change anything" rather
 * than "is it aborted": the launcher recovery can issue two opens (reconnect, then relaunch) for
 * one armed recording, and saying so twice would read as two lost scripts.
 */
export function noteOpenWhileArmed(armed: ArmedRecording | null | undefined): boolean {
  if (!armed || armed.aborted) return false
  armed.aborted = true
  return true
}

/**
 * Whether `startReplayRecording` has to replace the transaction it just armed before handing the
 * walk over.
 *
 * True exactly when the readiness wait that follows the arming open had to open the app itself.
 * The transaction is already unpublishable at that point, and the walk about to be recorded into
 * it would run to a verified arrival and then throw it away — which is the 5-in-6 failure the
 * measured sweep spent 683s producing.
 */
export function needsRearm(armed: ArmedRecording | null | undefined): boolean {
  return armed !== null && armed !== undefined && armed.aborted
}
