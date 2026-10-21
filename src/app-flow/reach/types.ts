/**
 * Shared types for the reach pipeline (`src/main/app-flow/reach/`).
 *
 * These are intentionally independent of `orchestrator.ts`, `capture.ts` and `storage.ts` — see the
 * module doc comment in `delivery.ts` for why that seam matters. Only `adapters.ts` is allowed to
 * import device/storage *values*; every other file here, this one included, stays plain data and
 * pure functions so it can run under `node --test` with no Electron runtime.
 */
import type {
  AppFlowChromeItem,
  AppFlowDeepLinkRejection,
  AppFlowNode,
  AppFlowPressable,
  AppFlowStep
} from '../../shared/app-flow.ts'

/**
 * The vision judge's verdict on whether the current screenshot is the exact target screen. Mirrors
 * the `ArrivalResult` shape `orchestrator.ts` builds from `parseArrivalVerdict` — kept as its own
 * type here (rather than imported) so `reach/` never depends on `orchestrator.ts`, which is what
 * would happen the moment that shape were declared there instead.
 */
export interface ArrivalVerdict {
  verdict: 'match' | 'mismatch' | 'uncertain'
  status: 'ok' | 'empty-state' | 'not-found' | null
  reason: string
  key?: string
  info?: string
}

/**
 * What a reach attempt has to show for itself, independent of whether the *delivery* screenshot
 * (the frame saved to `screens/<slug>.png`) ever succeeds. This is exactly the evidence
 * `decideDelivery` needs to tell "a verified reach whose screenshot happened to fail" apart from
 * "a screen that was never reached at all" — see that function's doc comment.
 */
export interface ReachEvidence {
  /**
   * The arrival verdict from whichever attempt is being delivered, or null when nothing confirmed
   * one live — a strategy that only replayed a script without a fresh arrival check, for instance.
   */
  arrival: ArrivalVerdict | null
  /**
   * The scratch frame the judge looked at when it accepted this arrival, or null when nothing kept
   * one. Set only by strategies that leave the app standing on the verified screen with nothing
   * further touching the device, which is what makes it a usable delivery frame rather than merely
   * a record of what was checked — see `chooseDeliverySources` (`delivery.ts`).
   */
  frame?: string | null
  /**
   * The controls read at the moment this reach was verified, when the strategy took them. Set under
   * exactly the same condition as `frame` — the app is standing on the verified screen and nothing
   * further touched the device — and delivered in place of a read of its own.
   */
  pressables?: readonly AppFlowPressable[] | null
  /**
   * The journey this reach walked, as `agent-device …` command lines, or null when it has none to
   * offer (a replay or a deep link reaches the screen without walking) or when the walk contained
   * a step with no faithful CLI form. Stored verbatim as the screen's `pathToReach` and used to
   * seed the next walk — see `walk-commands.ts`, and `AppFlowCapture.pathCommands` for what this
   * replaced.
   */
  pathCommands?: readonly string[] | null
  /** A `.ad` script this reach published for the node, if any. Only `savedReplayStrategy` sets one
   *  now, from a script the *manual* recorder published; the sweep stopped recording its own. */
  replayScript: string | null
  /**
   * Whether `replayScript` was itself re-confirmed (a fresh screenshot taken after replaying it
   * matched) as opposed to merely being recorded. False for the Step 1d case: exploration reached
   * and verified the target live, recorded the walk as a script, but the confirmation screenshot
   * that would normally re-verify the *replay* failed on a tooling error — the script is real and
   * worth keeping, but nothing has re-proven it plays back correctly.
   */
  replayVerified: boolean
}

/**
 * The reach ladder — plan landing-order item 4 — and the strategies that run on it.
 *
 * A strategy is `(input, ports) => Promise<ReachAttempt>`: it reads `input` and `ports`, does
 * whatever device work it needs, and returns a full account of what happened. It never reaches
 * into orchestrator-level mutable state to record what it found — that is exactly the ten-variable
 * closure shape (`openedByNode`, `consecutiveDeepLinkFailures`, `deepLinkEnabled`, `authStopped`,
 * `deepLinkNotFound`, `unavailableReason`, `deepLinkAttempted`, `reachError`, `acceptedArrival`,
 * `replayScript`) this module exists to replace. Each of those ten is now represented as either a
 * field on `ReachAttempt` (`ok`/`failure`/`reason`/`touchedDevice`/`arrival`/`evidence`) or as one
 * of `effects` below, which the caller folds into whatever durable state it owns (the deep-link
 * breaker, the persisted rejection map, the in-sweep memo) — see `runReachLadder`'s doc comment in
 * `ladder.ts`.
 */
export type ReachStrategyName =
  | 'saved-replay'
  | 'deep-link'
  | 'render'
  | 'seeded-replay'
  | 'seeded-exploration'
  | 'entry-exploration'

/**
 * A side effect one attempt produced, for the caller to fold into whatever state it owns. Strategies
 * never apply these themselves — see this section's doc comment above — so every effect is named
 * for the fact it reports, not the write it implies.
 */
export type ReachEffect =
  | { kind: 'deep-link-opened'; nodeId: string; opened: { app: string; url: string } }
  | { kind: 'deep-link-rejection-recorded'; nodeId: string; rejection: AppFlowDeepLinkRejection }
  | { kind: 'deep-link-rejection-cleared'; nodeId: string }
  | { kind: 'deep-link-memo-rejected'; url: string }
  /**
   * A guarded route's 404 was explained by its in-component gate, so that gate is now *observed*
   * closed in this build and every sibling behind the same condition can skip its own probe —
   * see `GuardGateMemo`. Carries the condition text rather than the node because the whole value
   * of the fact is that it spans nodes.
   */
  | { kind: 'guard-gate-closed'; condition: string }
  | { kind: 'deep-link-not-found' }
  | { kind: 'deep-link-breaker-success' }
  | { kind: 'deep-link-breaker-failure' }
  | { kind: 'deep-link-breaker-disabled' }
  /**
   * A partial (param-free-prefix) deep link landed on a real screen rather than the build's own
   * not-found route — plan Step 3f. This is not itself a reach (the target node's own URL was never
   * opened), so it is reported as an effect rather than `ok: true`, and a later strategy in the same
   * ladder run (the exploration strategy, inspecting `priorAttempts`) is what turns it into a
   * bounded last-hop attempt. Keeping it as data here rather than a direct call from the deep-link
   * strategy into exploration is what keeps the deep-link strategy itself pure and independently
   * testable — see `strategies/deep-link.test.ts`.
   */
  | {
      kind: 'deep-link-partial-landed'
      seed: { id: string; urlPath: string; url: string; app: string }
    }

export interface ReachAttempt {
  strategy: ReachStrategyName
  ok: boolean
  /**
   * Set only when the ladder must stop rather than fall through to the next strategy — the plan's
   * "short-circuits on ok, on unavailable | auth-stopped | cancelled, and on budget exhaustion".
   * Absent on an ordinary failure, which lets the ladder try the next strategy.
   */
  failure?: 'unavailable' | 'auth-stopped' | 'cancelled'
  reason: string
  /** Whether this attempt actually made a device call, as opposed to short-circuiting on a
   *  disabled breaker, an unresolved param, or a cached rejection. */
  touchedDevice: boolean
  /**
   * The attempt ran, but whatever it asked of the app was *declined without being carried out* —
   * a navigation dispatch the running navigator refused because it does not register the route.
   *
   * Deliberately not the inverse of `touchedDevice`: a refusal is reported *by the runtime*, so an
   * eval did go out and come back (see `renderStrategy`'s note on why it stays `touchedDevice:
   * true`). What makes it worth its own field is that the screen is left exactly as it was found.
   * The sweep's blocked-run detector reads "the app did not change" as evidence that the app is
   * stuck; three refusals in a row are not a stuck app, they are three routes this navigator does
   * not have, and counting them tripped the breaker and halted a run. See `orchestrator.ts`'s
   * `captureMethod === 'unreached'` branch, which skips the fingerprint comparison entirely here.
   */
  refused?: boolean
  arrival?: ArrivalVerdict | null
  /** Set on `ok: true` — what `decideDelivery` (or a later ladder consumer) needs to know this
   *  attempt proved. */
  evidence?: ReachEvidence
  elapsedMs: number
  effects: ReachEffect[]
}

/**
 * What the ladder settled on for one node, replacing the seven locals (`captureMethod`,
 * `unavailableReason`, `authStopped`/`sweepStopped`, `reachError`, plus the three that
 * `ReachAttempt.evidence` now carries) the orchestrator used to reconstruct this same information
 * from. Every variant carries the full `attempts` list in ladder order, since `effects` must be
 * folded regardless of how the node settled — including on `unreached`, where the caller still
 * needs, for instance, whichever deep-link rejection an earlier attempt recorded.
 */
export type ReachOutcome =
  | { status: 'reached'; strategy: ReachStrategyName; attempts: ReachAttempt[] }
  | {
      status: 'unreached'
      reason: string
      /** Every attempt that ran was `refused` — see `ReachAttempt.refused`. The node was not
       *  reached, but nothing the ladder did changed what is on screen. */
      refused?: boolean
      attempts: ReachAttempt[]
    }
  | { status: 'unavailable'; reason: string; attempts: ReachAttempt[] }
  | { status: 'stopped'; reason: 'auth' | 'cancelled'; attempts: ReachAttempt[] }

/**
 * One fact `runInteractiveExploration`'s `observed` hook noticed about the app that is not about
 * the walk's own target — see that hook's doc comment in `exploration.ts`. Before landing-order item
 * 5 (deferred; see the CHECKPOINT), `observed`'s one consumer wrote straight into the orchestrator's
 * `captureMap` for the single case it knew about: a tap made while walking to one screen happened to
 * land on some other still-pending screen instead. This union generalises that into a small,
 * self-describing report so two more kinds of side-observation — a navigator chrome revealed and
 * read (plan Step 3d), a screen the parser never registered a node for at all (plan Step 4a) — can
 * ride the same seam without `observed` (or `exploreFrom`, which still owns it) knowing anything
 * about `captureMap`, `app-flow.json`, or checkpoints. A fact only reports what was seen; the sweep
 * — in `orchestrator.ts`, right next to the state it owns (`captureMap`, the running list of runtime
 * nodes/edges/chrome) — is what folds one into the graph. Kept in this file rather than `capture.ts`
 * because the two new fact kinds are chrome-inventory/runtime-node data these `reach/*` modules own.
 */
export type DiscoveredFact =
  | {
      kind: 'opportunistic-capture'
      /** The already-known (parsed or runtime) node this observation confirmed. */
      nodeId: string
      arrival: ArrivalVerdict
      screenshotPath: string
      pressables: readonly AppFlowPressable[]
    }
  | {
      kind: 'chrome-observed'
      /** Node the chrome was observed being revealed from. */
      entryNodeId: string
      /** The action(s), if any, that revealed this chrome — empty when it needed none (an
       *  always-visible tab bar, say). */
      reveal: AppFlowStep[]
      items: AppFlowChromeItem[]
    }
  | {
      kind: 'runtime-screen-sighted'
      /**
       * The existing runtime node this observation matched (by id, then by signature similarity —
       * see `matchRuntimeNode` in `reach/runtime-nodes.ts`), or null when nothing already known
       * accounts for it and a fresh node should be minted. Never a parsed node: a screen the parser
       * already has a node for is reported as `opportunistic-capture` instead.
       */
      match: AppFlowNode | null
      /** The judge's own name for the screen — becomes the id via `sanitizeScreenKey` on a fresh
       *  mint, ignored on a match (the existing node's id is reused). */
      key: string
      info: string
      observedTokens: readonly string[]
      screenshotPath: string
      pressables: readonly AppFlowPressable[]
    }
