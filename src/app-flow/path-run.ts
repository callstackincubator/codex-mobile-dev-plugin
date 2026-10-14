/**
 * Executing a stored `pathToReach`, command by command, against a live `CaptureDevice`.
 *
 * Two callers, and the second is why this moved out of `manual/` (it was `manual/replay.ts`): the
 * Replay button on a screen node, and the sweep itself. Since exploration stopped recording `.ad`
 * scripts, a walk seeded from a screen the sweep already reached gets there by running that
 * screen's stored command list rather than by replaying a file — see `exploreFrom`
 * (`orchestrator.ts`) and `DevicePort.runPathCommands` (`reach/adapters.ts`). Both want the same
 * thing: run these lines, wait properly after each launch, and leave the app where they end.
 *
 * This is deliberately *not* `reachStartScreen`: that one needs a `ProfilingContext` and a
 * `ProfilingDevice`, both of which exist only inside a profiling run, and it shells out to the
 * agent-device CLI for any line it does not recognise. Here the recorder's own `CaptureDevice` is
 * already to hand and every line is one `walk-commands.ts` wrote, so the whole path runs in process
 * against the live client.
 *
 * The device is left running on purpose, for both callers. The button exists to put the app on
 * that screen and leave it there to be looked at, and a seeded walk has to keep acting in the
 * session this leaves behind — closing it tears down the XCUITest runner and the app with it.
 */
import { readFileSync } from 'node:fs'
import {
  openPathToReachApp,
  SUBSTANTIVE_FRAME_GRACE_MS,
  verifyAndRepairReplay,
  waitForAppReady,
  waitForRoute,
  type CaptureContext,
  type CaptureDevice
} from './capture.ts'
import { destinationGuardSelector } from './ad-script.ts'
import { PROBE_FRAME_ELEMENT_FLOOR } from './reach/probe-route.ts'
import { parsePathStep } from './manual/path-commands.ts'

/** Ceiling for one replayed `.ad`, matching the sweep's own replay timeout. */
const REPLAY_TIMEOUT_MS = 120_000

function log(step: string, detail?: string): void {
  console.log(detail ? `[app-flow:replay] ${step} — ${detail}` : `[app-flow:replay] ${step}`)
}

/**
 * Walks `pathToReach` command by command and leaves the app wherever it ends up.
 *
 * Throws on the first line that cannot be parsed or that fails, naming it. A path half-executed is
 * a worse outcome than an error: the user would be looking at some intermediate screen with no
 * indication that it is not the one they asked for.
 */
export async function runPathToReach(
  ctx: CaptureContext,
  device: CaptureDevice,
  pathToReach: readonly string[]
): Promise<void> {
  log('run', `${pathToReach.length} commands`)
  // The launch has to finish before the first command, not after it.
  //
  // `bootDevice` returns as soon as `apps.open` does, which on a dev client is about two seconds
  // into a launch whose JS bundle takes fifteen or more — and the first command of almost every
  // stored path is the deep link. `reopenBoundApp`'s doc comment names what happens to a URL
  // delivered into that gap: it is not slow, it is *lost*. React Navigation rejects it, the app
  // finishes launching on its default screen, and nothing downstream can tell the difference,
  // because the readiness wait that follows the open settles happily on the home feed.
  //
  // Measured on the 20-45-44 replay log: the dev client opened at +35.4s, the
  // `bluesky://moderation/interaction-settings` link went out at +39.1s, the app settled at
  // +45.6s with 20 interactive elements — the same count the sweep's own cold start settles on
  // for Home — and the replay reported success from the wrong screen. The sweep never had this
  // bug because `startSweep` pays exactly this wait between `bootDevice` and its first deep link;
  // on the same machine that wait took 18.9s.
  //
  // Same floor and grace as that one, via `waitForReplayableFrame`, for the same reason: a stable
  // frame and a loaded app are different things, and a dev client's loading screen is stable.
  await waitForReplayableFrame(ctx, device)
  for (const command of pathToReach) {
    if (ctx.signal?.aborted) throw new Error('Cancelled')
    const step = parsePathStep(command)
    if (!step) throw new Error(`This screen's path contains a command I cannot run: ${command}`)
    if (step.kind === 'skip') {
      log('skip setup', command)
      continue
    }

    log('step', command)
    try {
      await execute(ctx, device, step)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`${command} failed: ${detail}`)
    }
  }
  await waitForRoute()
}

/**
 * The readiness wait every launch step in a replay has to clear before the next step may press
 * anything.
 *
 * A bare `waitForAppReady` reports a *stable* frame, and a dev client's loading screen is stable:
 * measured on social-app, both recorded paths settled with **3** interactive elements 2.1s after
 * the open, the very next command pressed a selector that screen has never contained, and
 * agent-device answered `Selector did not match` 165ms later. The path was correct; it was replayed
 * into a splash.
 *
 * Nothing downstream can recover from that, which is what makes this different from the sweep. A
 * sweep that mis-reads a launch frame has a planner walk to fall back on; a replay has one scripted
 * press and no alternative, and `interactions.press` does not wait out a miss — its 10s timeout
 * bounds a *matched* control settling, not the appearance of an unmatched one. So the only place to
 * spend the time is here, before the press.
 *
 * Holds the same floor and grace as the sweep's own startup wait, for the same reason and off the
 * same measurements (`PROBE_FRAME_ELEMENT_FLOOR`, `SUBSTANTIVE_FRAME_GRACE_MS`). Graced rather than
 * held to `timeoutMs` because a replayed path may legitimately start on a sparse screen — a login
 * form, an empty state — and refusing to proceed for the full 90s would turn a slow replay into a
 * failed one. The return value is deliberately ignored: expiring means "this is the app's own
 * screen, press and find out", which is exactly today's behaviour.
 */
async function waitForReplayableFrame(ctx: CaptureContext, device: CaptureDevice): Promise<void> {
  await waitForAppReady(ctx, device, ctx.signal, undefined, {
    minInteractiveElements: PROBE_FRAME_ELEMENT_FLOOR,
    minInteractiveElementsGraceMs: SUBSTANTIVE_FRAME_GRACE_MS
  })
}

async function execute(
  ctx: CaptureContext,
  device: CaptureDevice,
  step: Exclude<ReturnType<typeof parsePathStep>, null | { kind: 'skip' }>
): Promise<void> {
  const platform = ctx.platform
  switch (step.kind) {
    case 'replay': {
      // Repaired, not merely run — the same two recovery tiers `savedReplayStrategy` gets, for the
      // same reason. Scripts are published unverified now, so the first thing to re-read a
      // recorded identity against a fresh tree may well be this button, and on the 20-45-44 log it
      // was: `profilefollowers.ad` died at step 5 with `IDENTITY_MISMATCH` on `bottomBarProfileBtn`
      // — the ancestry-instability class the strip exists for — and the user saw a raw agent-device
      // error for a script the sweep could have rescued. Repairing in place also means the next
      // press of the button, and the next sweep, replay the fixed bytes.
      //
      // `verifyAndRepairReplay` keeps the session alive, which this path requires: the point of
      // the button is to leave the app sitting on the screen, and closing the session takes the
      // XCUITest runner and the app with it.
      //
      // A script with no trailing destination guard predates `saveAndReplayRecording` appending
      // one. The tiers have nowhere to wait after rewriting a step, so it runs the old way and a
      // divergence stays fatal — which is exactly what it was before this.
      const guard = destinationGuardSelector(readFileSync(step.path, 'utf8').split('\n'))
      if (guard === undefined) {
        const result = await device.client.replay.run({
          path: step.path,
          platform,
          udid: device.deviceId,
          keepSession: true,
          timeoutMs: REPLAY_TIMEOUT_MS
        })
        if (!result.sessionActive)
          throw new Error(`Replay did not leave an active session: ${step.path}`)
      } else {
        await verifyAndRepairReplay(ctx, device, step.path, guard, Date.now() + REPLAY_TIMEOUT_MS)
      }
      await waitForReplayableFrame(ctx, device)
      return
    }
    case 'open': {
      await openPathToReachApp(device, step.app, step.url)
      await waitForReplayableFrame(ctx, device)
      return
    }
    case 'press':
      await device.client.interactions.press({
        platform,
        selector: step.selector,
        settle: true,
        timeoutMs: 10_000
      })
      return
    case 'pressPoint':
      await device.client.interactions.press({
        platform,
        x: step.x,
        y: step.y,
        settle: true,
        timeoutMs: 10_000
      })
      return
    case 'fill':
      await device.client.interactions.fill({
        platform,
        selector: step.selector,
        text: step.value,
        settle: true,
        timeoutMs: 10_000
      })
      return
    case 'scroll':
      await device.client.interactions.scroll({ platform, direction: step.direction })
      return
  }
}
