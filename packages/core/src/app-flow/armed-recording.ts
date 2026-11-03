/**
 * Tracks the device's active `--saveScript` transaction. agent-device aborts publication if a
 * second `apps.open` occurs before save/close, so every opener must update this shared state.
 * Soft-home opens are suppressed while the transaction is viable; required launcher recovery
 * aborts it and lets `startReplayRecording` re-arm after the app is ready.
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

/** Suppress soft home only while it could still invalidate a viable recording. */
export function suppressesSoftHome(armed: ArmedRecording | null | undefined): boolean {
  return armed !== null && armed !== undefined && !armed.aborted
}

/** Mark an imminent open as aborting the transaction; return true only on the first transition. */
export function noteOpenWhileArmed(armed: ArmedRecording | null | undefined): boolean {
  if (!armed || armed.aborted) return false
  armed.aborted = true
  return true
}

/** Whether `startReplayRecording` must replace an aborted transaction before the walk begins. */
export function needsRearm(armed: ArmedRecording | null | undefined): boolean {
  return armed !== null && armed !== undefined && armed.aborted
}
