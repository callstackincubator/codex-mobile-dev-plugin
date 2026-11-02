/**
 * How long to let the dev-client launcher clear on its own before recovering from it.
 *
 * `startReplayRecording` arms a recording with an `apps.open --saveScript`, and the launcher
 * recovery in `waitForAppReady` clears the launcher with an `apps.open` of its own — which
 * agent-device treats as "a second successful open" and refuses to publish the script after. The
 * deferral exists so that a launcher which is merely slow (a cold bundle build) is waited out
 * rather than recovered from, keeping the recording publishable.
 *
 * That bet is only worth making while it can still be won. On the measured sweep it was not: the
 * deferral fired on six separate nodes, ran its full 20s every single time, and every one of those
 * six still ended with `This script recording was aborted by a second successful open and cannot
 * be published` — because the launcher in that setup is pointed at no Metro, so nothing but the
 * reconnect was ever going to clear it. 131s of waiting bought six publication failures that
 * happened anyway, on a sweep that was 75s slower than the one before it.
 *
 * So the deferral is kept, and spent once. The first time it elapses with the launcher still on
 * screen, that is the evidence that this device's launcher does not self-clear, and every later
 * call recovers immediately. A launcher that *does* clear within the window never records an
 * expiry, so a genuinely slow bundle keeps being waited out for the whole sweep.
 *
 * Deliberately per-device and per-run rather than a constant: "does the launcher clear itself"
 * is a property of how this dev client was started, not of the harness, and a device that is
 * reconnected to Metro between sweeps should get the benefit of the doubt again.
 */
export type LauncherDeferralOutcome =
  /** No deferral has elapsed on this device yet — either none ran, or one ran and the launcher cleared. */
  | 'untested'
  /** A deferral ran its full length and the launcher was still on screen at the end of it. */
  | 'expired'

export function launcherDeferralMs(configuredMs: number, outcome: LauncherDeferralOutcome): number {
  if (!(configuredMs > 0)) return 0
  return outcome === 'expired' ? 0 : configuredMs
}
