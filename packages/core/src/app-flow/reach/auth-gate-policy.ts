/**
 * When a cleared auth gate stays cleared for the rest of the sweep.
 *
 * The gate is the cheapest question the sweep asks — one screenshot, one classifier call — but it
 * was asking it four times in an eight-screen run, because it re-runs after every launch or
 * relaunch. Three of those four calls re-answered a question already answered about an app that
 * never signed out: relaunching a dev client does not clear the app's persisted session, so a
 * `clear` verdict can only go stale if something *inside* the sweep logs the user out, and the only
 * thing that could is a planner walk happening to press a sign-out control. That is rare, and the
 * cost of being wrong is one arrival mismatch on one node — not a broken run — so the gate is
 * settled once per sweep and never re-probed.
 *
 * What must *not* be remembered is an `uncertain` verdict. `uncertain` is the classifier saying it
 * could not read the frame, which on a cold launch is a coin flip against a splash screen rather
 * than a fact about the app. Caching one would let a single unlucky read decide the whole sweep,
 * which is the same class of bug as a probe disabling deep links off a loading frame
 * (`probe-route.ts`).
 *
 * Nor may a *confident* verdict be remembered when the frame behind it never became substantive.
 * That looked like a theoretical hole until the 2026-10-09 social-app sweep walked straight into
 * it: the adopt path relaunched a warm app into the dev-client launcher, the gate's pre-check saw
 * an unreadable frame and opened its 15s window (`AUTH_GATE_FRAME_WAIT_MS`), and
 * `waitForAppReady` came back after **1.9s** — not because the app had loaded but because the
 * device had stopped answering three reads in a row (`capture.ts`'s `device stopped answering`
 * return). The gate screenshotted a dead app, the classifier said `clear` about it, and that
 * verdict was latched for all 79 routes. Had the build been showing a login wall behind that
 * frame, the sweep would have explored a gated app in silence and never asked anyone. The 15s
 * window exists precisely so a splash is never the thing that gets cached, so an early return out
 * of it has to be carried through to here rather than quietly discarded — hence
 * `substantiveFrame` below. The gate may still *classify* such a frame (a real login screen is
 * legitimately sparse and must not be blocked on); it just may not speak for the rest of the run.
 *
 * So the rule is deliberately expressed as a question about the *resolution*,
 * not as a boolean the caller sets: a caller that merely saw the gate return `clear` cannot tell
 * whether that was the classifier being sure or the user overriding, and only one of those two
 * needs recording for the reason given below.
 *
 * No device or Electron import here — see `reach/types.ts`'s doc comment.
 */

/**
 * How long the gate may wait for a launch frame to render something substantive before it gives
 * up and classifies whatever is on screen.
 *
 * The gate runs immediately after `waitForAppReady`, which reports a *stable* frame — and a dev
 * client's loading screen is perfectly stable. On the social-app run that motivated this, the
 * first readiness check settled with 2 interactive elements, the classifier was handed that frame,
 * returned `uncertain` twice, and the sweep stopped to ask a human; they pressed Override 8.3s
 * later and the third call read a real screen and said `clear`. Three classifier calls and a user
 * prompt, all to classify a splash. `probe-route.ts` documents the identical failure for the deep
 * link probe and fixes it the same way, with `PROBE_FRAME_ELEMENT_FLOOR`.
 *
 * What the gate cannot borrow from that probe is the right to *insist*. A real login screen is
 * legitimately sparse — an email field, a password field, a button — so it can sit under the same
 * floor a splash does, and blocking until the floor is cleared would delay exactly the screen the
 * gate exists to catch. So this is a bounded wait and never a precondition: when it expires the
 * gate classifies whatever is there, which is precisely today's behaviour and no worse.
 *
 * Fifteen seconds is half the deep-link probe's budget, which is sized for a cold 6130-module
 * bundle. The gate does not need that headroom because it is not deciding anything sweep-wide: a
 * frame it misreads costs one prompt, not the transport for 79 routes. It is set instead from what
 * the measured failure needed — the app became readable about 12s after the gate first looked.
 *
 * Mostly dormant on the launch path now. The sweep's own readiness wait holds the same floor for
 * the same reason (`SUBSTANTIVE_FRAME_GRACE_MS` in `capture.ts`), so on a cold start the gate's
 * pre-check reads a substantive frame and never enters this wait — the run that motivated both
 * paid 10.0s settling on a splash here and 12.5s waiting for it there, for one app start. What
 * this still covers is the relaunch path, which does not go through sweep startup: the gate re-runs
 * after every launch, and only the first of those is the one the readiness wait saw.
 */
export const AUTH_GATE_FRAME_WAIT_MS = 15_000

/** The classifier's answer about one frame. Mirrors the inline verdict `checkAuthGate` parses. */
export type AuthGateVerdict = 'auth' | 'clear' | 'uncertain'

/** What one full run of the gate concluded, including how it got there. */
export interface AuthGateResolution {
  /** What the gate returned to its caller. */
  outcome: 'clear' | 'stop' | 'exhausted'
  /** The classifier's last verdict, or null when it never produced one. */
  verdict: AuthGateVerdict | null
  /**
   * Whether the frame the classifier was actually shown had reached the substantive floor
   * (`PROBE_FRAME_ELEMENT_FLOOR`), either on the gate's cheap pre-check or by the end of the
   * `AUTH_GATE_FRAME_WAIT_MS` window.
   *
   * Separate from `verdict` because the classifier cannot report this: it is handed a PNG and has
   * no way to say "this is a dead app" rather than "this is not a login screen" — in the sweep
   * that motivated the field it returned a confident `clear` about a process that was no longer
   * running. The readiness wait *does* know, because it returns false on a timeout, on a launcher
   * it could not clear, and on three consecutive failed accessibility reads, and only the last of
   * those takes under two seconds out of a fifteen-second window.
   *
   * False does not make the gate's answer unusable — the caller still gets `clear` and carries on
   * — it only makes it unrepeatable, so the next launch asks again. One extra screenshot and one
   * extra classifier call is the entire cost of being wrong here; exploring a gated build without
   * ever prompting is the cost of the other direction.
   */
  substantiveFrame: boolean
  /**
   * Whether the user resolved the gate by hand — signed in and pressed Continue, or pressed
   * Override on a frame the classifier could not read.
   *
   * Tracked separately from `verdict` because the two settle the run for different reasons. A
   * `clear` verdict is evidence about the app; a user resolution is an instruction about it, and an
   * instruction outranks a classifier that was unsure. Re-prompting someone who has already told
   * the sweep to carry on is the most expensive mistake this module can make: it stops an
   * unattended run dead at a prompt that has no timeout.
   */
  userResolved: boolean
}

/**
 * Who settled the gate for the remainder of the sweep, or null when nothing was settled and the
 * next launch must ask again.
 *
 * Returns the *source* rather than a boolean so the orchestrator can say which of the two it is in
 * its log line — the difference between "the classifier cleared this app" and "you cleared it"
 * matters when reading back why a run never prompted.
 */
export function settlesAuthGateForRun(
  resolution: AuthGateResolution
): 'classifier' | 'user' | null {
  if (resolution.outcome !== 'clear') return null
  // Checked before `substantiveFrame` on purpose. A person looking at the simulator can see what
  // no accessibility read could — including that the app is on its launcher or wedged — and
  // pressing Override is them saying "I have looked, carry on". Re-prompting someone who has
  // already answered is the one failure this module calls unaffordable, because an unattended run
  // then sits at a prompt with no timeout.
  if (resolution.userResolved) return 'user'
  // A confident verdict about a frame that never became substantive is a verdict about a splash,
  // a launcher or a dead process — see `substantiveFrame`. Answerable, not quotable.
  if (resolution.verdict === 'clear' && resolution.substantiveFrame) return 'classifier'
  // A `clear` outcome with neither a confident verdict nor a user behind it should be unreachable.
  // Falling through to null rather than asserting keeps the failure mode "ask again next launch",
  // which costs one classifier call, instead of "trust a frame nobody vouched for".
  return null
}
