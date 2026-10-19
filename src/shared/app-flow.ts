export type AppFlowStatus = 'idle' | 'running' | 'done' | 'error'
export type AppFlowBuildMode = 'structure-only' | 'screen-ui-and-structure'

/**
 * How a sweep is allowed to reach a screen it cannot address with a URL.
 *
 * The two mechanisms differ in more than speed, which is why this is a choice and not a tuning
 * knob. Dispatching through the app's own navigator costs roughly 2s per screen but produces no
 * replay script — a dispatched navigation is not a journey a user could repeat. Asking a model to
 * walk the UI costs 22-33s and produces one.
 *
 * - `auto` — try a deep link, then use the deterministic runtime navigator.
 * - `fast` — use the deterministic runtime navigator directly.
 * - `thorough` — try a deep link, then ask the model to explore the UI.
 *
 * Auto and Thorough reuse a verified probe or saved manual replay before the named pipeline. Fast
 * remains runtime-only: it does not open a probe URL or execute a stored agent-device journey.
 */
export type ExplorationMode = 'auto' | 'fast' | 'thorough'

/**
 * Whether a *deep link*'s arrival is confirmed by the vision judge.
 *
 * Every deep link opened today costs a screenshot plus a model call (~3.5s on the reference sweep)
 * to answer a question the URL mostly already answered: the app either routed to the URL or it
 * did not. `off` skips that call and takes the open at its word, with one exception the sweep
 * cannot do without — the build's own not-found route, which a registered-but-gated screen
 * resolves to and which drives the ancestor-prefix fallback, the exploration hint and the
 * deep-link breaker's 404 exemption. With the judge off that case is detected structurally from
 * the accessibility snapshot instead (`reach/not-found-signal.ts`).
 *
 * - `on` — the default, and exactly what every sweep did before this setting existed.
 * - `off` — no model call per deep link. Faster and cheaper, at the cost of not catching an open
 *   that resolved to a *different* real screen than the one asked for, which only the judge can
 *   see.
 *
 * Scoped to deep links on purpose. Exploration's arrival checks are not an optimisation of the
 * same kind: a walk has no "the URL resolved" to fall back on, so removing the judge there would
 * remove the sweep's only evidence that it arrived anywhere at all.
 */
export type DeepLinkJudgeMode = 'on' | 'off'

/**
 * One App Flow start request, as it crosses the renderer -> preload -> main boundary and as the
 * main-process service receives it. An object rather than positional arguments: the positional
 * form had reached `(projectPath, mode, screenLimit, explorationMode)` with every trailing slot
 * optional, so adding a fifth would have forced callers to write `undefined` through the middle.
 */
export interface StartAppFlowInput {
  projectPath: string
  mode?: AppFlowBuildMode
  screenLimit?: number
  explorationMode?: ExplorationMode
  deepLinkJudgeMode?: DeepLinkJudgeMode
}
export type AppFlowSweepStatus =
  'not-requested' | 'running' | 'awaiting-user' | 'completed' | 'paused' | 'stopped' | 'failed'

export type AppFlowCaptureStatus =
  | 'ok'
  | 'empty-state'
  /** The opened URL is not a route this build recognises. */
  | 'not-found'
  /** The route exists, but this build renders a fallback instead of the screen. */
  | 'unavailable'
  | 'error-boundary'
  | 'loading'
  | 'auth-wall'
  | 'missing'

/**
 * An in-component gate that swaps the whole screen for a fallback, read off the source. Bluesky's
 * moderation inbox is the shape this catches: the route is registered unconditionally, but the
 * component opens with `if (!features.enabled(...)) return <NotFoundScreen />`, so a deep link
 * routes correctly and still lands on a 404 the sweep would otherwise read as a wrong turn.
 */
export interface AppFlowGuard {
  /** Source text of the condition that must hold for the real screen to render. */
  condition: string
  /** Name of the component rendered in its place, e.g. `NotFoundScreen`. */
  fallback: string
}

/**
 * What the panel says before a Fast run, where nothing checks whether the app is signed in.
 *
 * Auto and Thorough still reach a model-backed auth gate that parks the sweep and asks for a
 * human; Fast has none, so a signed-out app simply sweeps a login wall and captures it as every
 * screen. The sign-in has to happen before the run, and this is the only place that says so.
 */
export const FAST_MODE_AUTH_NOTICE =
  'Fast mode does not check for a sign-in screen. Launch the app and finish signing in if you have not, then start the sweep.'

/**
 * The badge a route carries purely because its component declares a guard — see `AppFlowGuard`.
 *
 * Deliberately static: whether the flag behind the condition is on in this build is not knowable
 * from the source, and the sweep's own outcome does not settle it either (a guarded route that
 * rendered fine was flagged on for that run, which says nothing about the next one). So every
 * guarded route is labelled, the one that rendered a 404 and the one that did not, and the
 * condition is shown so a reader can decide what it means for their build.
 */
export function featureGateNotice(
  guard: AppFlowGuard | null | undefined
): { label: string; detail: string } | null {
  if (!guard) return null
  return { label: 'Feature Gated', detail: `Renders <${guard.fallback}/> unless ${guard.condition}` }
}

export interface AppFlowPressable {
  text?: string
  label?: string
  identifier?: string
  role?: string
}

export interface AppFlowCapture {
  status: AppFlowCaptureStatus
  needsNavigation: boolean
  note: string | null
  screenshot: string | null
  pressables: AppFlowPressable[]
  captureMethod?:
    | 'saved-replay'
    | 'deep-link'
    | 'agent-navigation'
    | 'unreached'
    /**
     * Captured as a side effect of exploring toward a *different* target: a tap made while
     * walking to screen X happened to land on this still-pending screen instead. Kept distinct
     * from `agent-navigation` because there is no verified journey to it — only an accidental
     * sighting confirmed by one arrival check — so a resumed sweep must still treat it as needing
     * navigation, not as a screen with a replayable path.
     */
    | 'opportunistic'
    /**
     * Recorded by the user driving the app themselves through the manual recorder, with no model
     * inference anywhere in the loop. Authoritative: the recorder publishes to the same
     * `<flows>/<slug>.ad` path `savedReplayStrategy` probes first, so a later sweep replays the
     * manual journey before it considers a deep link or exploration.
     */
    | 'manual'
    /**
     * Reached by dispatching navigation through the running app's own navigator, rather than by
     * a URL or by a model walking the UI. Distinct from `deep-link` because no URL was involved
     * and distinct from `agent-navigation` because no model decided the route — but like
     * `agent-navigation` it carries no replay script, since a dispatched navigation is not a
     * journey a user could repeat. See `reach/strategies/render.ts`.
     */
    | 'rendered'
  replayScript?: string | null
  replayVerified?: boolean
  /**
   * The journey to this screen as `agent-device …` command lines — exactly what
   * `buildAgentDeviceScreens` stores as its `pathToReach`, kept on the capture as well so the
   * sweep can seed the next walk off it without re-reading the screens map.
   *
   * This is what replaced the `.ad` script the sweep used to record. A recording forced a cold
   * `open --relaunch` before every walk — not to put the walk on a known screen, which a soft
   * re-root does, but so the recorded script's first line would be one — and on the 2026-10-13
   * sweep that cost ~173s of 683s and produced one script out of seven explorations. The explorer
   * already knew every step it took; this is that knowledge written down. See `walk-commands.ts`.
   *
   * Always standalone: the list opens with its own launch line (`baselineLaunchCommands`), so a
   * consumer can run it against any device state and a later walk can seed from it directly.
   * Absent on a capture whose journey could not be rendered faithfully (a coordinate tap, a
   * `@ref` press) and on every document written before this field existed.
   */
  pathCommands?: string[]
  /**
   * Whether anything ever executed the stored `pathToReach`, as opposed to inferring it.
   *
   * The companion to `replayVerified`, one level down: that field answers "was the `.ad` script
   * replayed and re-confirmed", this one answers the question the Replay button now actually asks,
   * which is "has this *path* ever been travelled". True for a walked journey (`pathCommands`), a
   * verified recording, and a deep link the sweep opened and the arrival judge accepted. False for
   * a path `buildChromePathToReach` reconstructed from a reveal/trigger pair observed on some other
   * screen.
   *
   * It exists because the two became indistinguishable when `pathToReach` turned into the Replay
   * button's only gate. On the 2026-10-13 sweep `ModerationInbox` is `captureMethod: 'unreached'`
   * with a note saying this build renders `<NotFoundScreen/>` for it, and it still carries
   * `[boot, open, press 'label="Inbox zero!"']` and `replayable: true` — a guess, presented exactly
   * like `My-Profile`'s walked path. The path is kept (it is the only lead to that screen there is);
   * it now says what it is.
   *
   * Written by `buildAgentDeviceScreens` and stamped on by `withReplayableCaptures`, from the
   * screens map's own entry rather than a second guess at it. Absent on documents written before
   * this field existed and on a node with no entry at all.
   */
  pathVerified?: boolean
  /**
   * The selectors in the stored `pathToReach` that match on what the app rendered rather than on an
   * identifier its source declares — every `label=`/`text=` selector in the path, in order.
   *
   * The portability question `manual/commands.ts`'s `isPortable` already asks of a single recorded
   * step, asked of a whole stored journey and one notch harder: a destination guard only has to
   * re-verify a landmark in the session that just saw it, while a `pathToReach` is replayed later,
   * elsewhere, against another account's data. `Profile-List`'s last command is
   * `press 'label="Dummy"'` — `Dummy` is a list this account happens to own, not a control — so the
   * path cannot replay on any other account, and nothing in the stored list said so.
   *
   * Deliberately does not try to single that one out: `label="Dummy"` and `label="Open drawer menu"`
   * are the same kind of string at this layer, one breaking on another account's data and the other
   * on a change of locale. Reported, never dropped or rewritten — the data-dependent press is
   * usually the step that reaches the screen. Absent when the path is built entirely from `id=`
   * selectors, which is the good case.
   */
  pathContentSelectors?: string[]
  /**
   * Whether this screen actually has a stored `pathToReach` — the one thing the Replay button
   * needs to know, carried here because the renderer never reads `agent-device-screens.json`.
   *
   * It was inferred from `status === 'ok'` before, and that guess was wrong in both directions on
   * the 20-41-31 sweep. `ModerationModlists`, `ModerationMutedAccounts` and
   * `ModerationBlockedAccounts` each landed on a real, deep-linkable screen that happened to be
   * empty, were stored with a two-command path, and were refused a Replay button because their
   * status is `empty-state`. `ProfileSearch` was seen `opportunistic` — `status: 'ok'`, no
   * journey to it — so it offered a button that could only ever answer "no recorded path".
   *
   * Written from the screens map itself (`buildAgentDeviceScreens`'s own output, not a second
   * guess at it), so the two cannot disagree. Optional because documents written before this
   * field exist; readers fall back to the old inference for those.
   */
  replayable?: boolean
  structureRevision?: string
  stale?: boolean
}

/**
 * A cached "the arrival judge rejected this route's own URL" verdict, persisted on the node so a
 * later sweep skips straight to exploration instead of paying for a deep link this build has
 * already shown does not resolve to the target. Deliberately never recorded for a *partial*
 * attempt (the param-free prefix a route with unresolved params falls back to) — a prefix mismatch
 * is expected on a param route and says nothing about the route's own URL.
 *
 * Stored on the node in `app-flow.json`, not in `sweep-progress.json`: `clearSweepProgress` deletes
 * that checkpoint on every completed sweep, exactly when this suppression most needs to survive.
 * Invalidated per node by `parsedSignature` (see `nodeStructureSignature` in
 * `reach/deep-link-policy.ts`) rather than the graph-wide structure key, so one unrelated route
 * moving does not discard every rejection recorded across the whole app.
 */
export interface AppFlowDeepLinkRejection {
  /** The exact URL that was opened and rejected — always this node's own `urlPath`. */
  url: string
  /** The arrival judge's `reason` for the rejecting verdict. */
  reason: string
  rejectedAt: string
  parsedSignature: string
}

export interface AppFlowNode {
  id: string
  urlPath: string | null
  reach: 'deep-link' | 'navigation-only' | 'unknown'
  title: string
  file: string | null
  slug: string
  group: string
  /**
   * Every navigator/tab that registers this screen, not just `group` (which is one of these,
   * picked for a stable id/display). A screen registered through a shared helper called from
   * several tabs (bluesky's `commonScreens`) genuinely belongs to all of them — a prompt or report
   * that names only `group` for such a screen claims it lives in one tab when it lives in five.
   * Length 1 and equal to `[group]` for a screen registered directly under a single navigator.
   */
  groups: string[]
  navigator: string | null
  params: string[]
  presentation: string | null
  guard: AppFlowGuard | null
  capture: AppFlowCapture | null
  /** See `AppFlowDeepLinkRejection`. Absent or null: no rejection recorded, or none still current. */
  deepLinkRejection?: AppFlowDeepLinkRejection | null
  /**
   * `'parsed'` (the default, back-filled by `readAppFlow` for every document written before this
   * field existed): the static scan produced this node. `'runtime'`: the explorer saw a screen the
   * parser never registered a route for and minted a node for it live (plan Step 4a) — such a node
   * always has `file: null` and `urlPath: null`, because there is no source location or route to
   * point at. `computeStructureKey` (`reach/structure-key.ts`) throws if handed one: it fingerprints
   * only what the parser produced, and a runtime node folded into that hash would make the very act
   * of discovering a screen invalidate the checkpoint that discovery is trying to build on.
   *
   * `'chrome'`: a *virtual* node standing for a navigator surface (a drawer, a tab bar) rather than
   * a screen — see `chromeVirtualNodes` (`reach/chrome-inventory.ts`). It exists so a chrome's items
   * hang off the chrome itself instead of being re-attributed to whichever screen happened to reveal
   * it, which is what a readable flow needs: a drawer is reachable from everywhere, so pinning its
   * eight destinations onto one entry screen states something false about all the others. Such a
   * node has `file: null`, `urlPath: null` and `capture: null`, and must never enter the capture
   * sweep — there is nothing to navigate *to*. Like `'runtime'`, it is rejected by
   * `computeStructureKey` (`reach/structure-key.ts`).
   */
  origin?: 'parsed' | 'runtime' | 'chrome'
  /**
   * Present only on an `origin: 'runtime'` node. The vocabulary (`fingerprint`'s token set,
   * `screen-signals.ts`) that identifies this screen across visits, pruned over time down to tokens
   * repeat sightings agree on — see `matchRuntimeNode`/`recordRuntimeSighting` in
   * `reach/runtime-nodes.ts`. Starts as the full first-sighting fingerprint (every word the arrival
   * judge's screenshot happened to show) and narrows on every later match to the intersection with
   * that sighting's own fingerprint, which is what turns an incidental snapshot (a feed's caption
   * text, a badge count) into a converged identity a live observation can be compared against.
   */
  runtimeSignature?: string[]
  /** How many live observations have matched this runtime node so far — see `runtimeSignature`. */
  sightings?: number
}

/** The on-screen control that fires a navigation, as the explorer should locate it. */
export interface AppFlowTrigger {
  by: 'text' | 'label' | 'id'
  value: string
}

/**
 * One step of a recorded navigation, as persisted (`AppFlowChrome.reveal`) or exchanged with the
 * model (`capture.ts`'s `AppFlowNavigationAction`, aliased to this type so its many call sites did
 * not have to move for the alias to exist). Kept in `shared/types.ts`, not `capture.ts`, because a
 * persisted chrome's reveal steps ride in `app-flow.json` and the renderer reads them; `capture.ts`
 * is main-process-only and this file is read by the renderer too.
 */
export interface AppFlowStep {
  type: 'tap' | 'swipe' | 'input' | 'wait'
  /** Reuses `AppFlowTrigger` rather than a bespoke locator shape — a persisted step is exactly "the
   *  on-screen control that fires a navigation", the same concept `AppFlowEdge.trigger` already
   *  names. */
  locator?: AppFlowTrigger
  value?: string
  direction?: 'up' | 'down' | 'left' | 'right'
  duration?: number
}

/**
 * Provenance of a recorded transition between two screens, and the evidence backing it — additive
 * (plan Step 4c). `edge.origin` is absent (equivalently `'parsed'`, back-filled by `readAppFlow`)
 * for every edge the static scan produced. A runtime edge's `evidence` is what a consumer needs to
 * judge how much to trust it: `structureRevision` ties it to the build that observed it,
 * `observedAt` says when, `verified` says whether a fresh arrival check confirmed the destination
 * (as opposed to the edge being recorded from an observation alone), and `chromeId`/`replayScript`
 * point at the chrome inventory entry or the recorded script that produced it, when either exists.
 */
export interface AppFlowEdgeEvidence {
  structureRevision: string
  observedAt: string
  verified: boolean
  chromeId?: string
  replayScript?: string | null
}

export interface AppFlowEdge {
  from: string
  to: string | null
  raw: string
  target: string | null
  /**
   * What to tap to follow this edge, read from the call site. An edge without one still says two
   * screens are connected but not how to get across, which leaves the explorer guessing.
   */
  trigger?: AppFlowTrigger | null
  /**
   * `'parsed'` (the default): a static call site the parser found. `'runtime-chrome'`: minted from
   * a recorded chrome inventory (a drawer/tab-bar item observed once and reused — plan Step 3d).
   * `'runtime-walk'`: minted from an actual interactive hop the explorer walked. Never merged into
   * `edges` regardless of origin — see `AppFlowResult.runtimeEdges`'s doc comment for why a runtime
   * edge must never reach `pathsForScreen` (`profiling/dashboard.ts`) through the parsed array.
   * Always give a runtime edge a human-readable `raw` (e.g. `drawer "Settings"`, `walked: tap
   * label="Profile"`), never `''` — the renderer uses `raw` as the edge's label and feeds it to
   * `isUpwardHref`, so an empty string renders as a blank, unlabelled connection.
   */
  origin?: 'parsed' | 'runtime-chrome' | 'runtime-walk'
  /**
   * What kind of transition this is, as far as the source of the edge can tell. Absent means
   * unknown, which is what every edge written before this field existed reads as — it is a hint for
   * laying out and filtering a readable flow, never a fact a consumer may require.
   *
   * `'push'`: an ordinary forward navigation within a stack (the default the parser assigns when
   * nothing more specific applies). `'replace'`: the call replaced the current screen rather than
   * stacking on it, so there is no back edge. `'modal'`: the destination is presented modally
   * (`node.presentation` matches /modal/), so it sits on top of the source rather than replacing it
   * in the flow. `'tab-switch'`: source and destination live under different top-level tab layouts,
   * which is a jump between branches of the app rather than a step through one. `'reveal'`: the
   * edge opens a navigator chrome (a drawer) rather than a screen — its `to` is an
   * `origin: 'chrome'` virtual node, and following it puts a surface on screen, not a destination.
   *
   * A flow that draws every kind the same way is the unreadable one: tab switches and drawer
   * reveals connect nearly everything to nearly everything, so a reader cannot see the tree of
   * pushes underneath them unless the two can be told apart.
   */
  kind?: 'push' | 'replace' | 'modal' | 'tab-switch' | 'reveal'
  /** Present when `origin` is a `runtime-*` value. See `AppFlowEdgeEvidence`'s doc comment. */
  evidence?: AppFlowEdgeEvidence
}

export interface AppFlowManifest {
  formatVersion: number
  generator: string
  generatedAt: string
  project: {
    name: string
    path: string
    scheme: string | null
    platform: string
    mode: string
  }
  /** Summed LLM usage of every sub-agent call in the build that produced this manifest. */
  tokens?: TokenUsage
  /**
   * Wall-clock time of the build that produced this manifest, in milliseconds.
   *
   * Stamped on every terminal path, including a cancel or a failure, because "it ran for 40s then
   * stopped" is exactly what you want to know about a run that did not finish. Absent on documents
   * written before this field existed, which is why every reader treats it as optional rather than
   * showing a confident `0s`.
   */
  durationMs?: number
  /**
   * Wall-clock time spent producing this flow across the whole resume chain, in milliseconds —
   * this build's `durationMs` plus the carried total of every earlier run that the sweep resumed
   * from. A paused or stopped sweep leaves its checkpoint behind, and the next build picks up at
   * the first unfinished screen; charging each resumed run only its own clock used to hide the
   * real cost of a flow (a 2m30s sweep resumed for 1m5s read as 1m5s). The carried total is only
   * taken when the saved checkpoint's structure fingerprint still matches this build's parse —
   * the same condition the resume itself requires — so a fresh sweep of a changed app, or the
   * first sweep after one completed (whose checkpoint was cleared), starts a new chain at its own
   * duration rather than accumulating forever. Absent on documents written before this field
   * existed; readers fall back to `durationMs`.
   */
  cumulativeDurationMs?: number
  buildMode?: AppFlowBuildMode
  structureRevision?: string
  sweepStatus?: AppFlowSweepStatus
}

/**
 * How a navigator is mounted in the parsed tree — moved here from `parser.ts` (where it originated
 * as part of `ParsedAppGraph`) because `AppFlowResult.navigation` persists this shape verbatim into
 * `app-flow.json`, which the renderer reads; `parser.ts` re-exports it so `ParsedAppGraph`'s own
 * field declarations did not have to change.
 */
export interface AppFlowLayout {
  /** How the navigator is mounted — the tab or stack name the explorer sees. */
  name: string
  /** `Tabs` | `TopTabs` | `Drawer` | `Stack`. */
  navigator: string
  /** Name of the layout this one is mounted inside, or null for the app root. */
  parent: string | null
}

/**
 * One destination a recorded chrome (drawer, tab bar) can reach once it is revealed — plan Step 3d.
 * Produced by `detectChromeInventory` (`reach/chrome-inventory.ts`), which the sweep runs both
 * opportunistically (mid-walk, off whatever a node's own exploration happens to reveal) and
 * deliberately (a dedicated entry-chrome pass before the per-node sweep — `orchestrator.ts`).
 */
export interface AppFlowChromeItem {
  /** Display name read off the control — the drawer row's label, the tab's title. */
  label: string
  /** Node this item opens, when it resolves to one the parser (or a prior runtime mint) already
   *  knows about; null when the destination has no node yet. */
  toNodeId: string | null
  /** How to tap this item, once the chrome itself is already revealed. */
  trigger: AppFlowTrigger
  /**
   * How many separate sightings of this chrome have shown this item — see
   * `mergeChromeInventory` (`reach/chrome-inventory.ts`), which uses it to tell the chrome's own
   * controls apart from the underlying screen's content. Absent on a document written before the
   * field existed, which reads as "unknown", not as zero.
   */
  sightings?: number
}

/**
 * Which navigator surface a recorded chrome is — the two shapes a sweep actually finds: a bar that
 * is always on screen with nothing to reveal (`'tabs'`), or one that had to be opened first, such as
 * a drawer behind a hamburger button (`'drawer'`). `inferChromeKind` (`reach/chrome-inventory.ts`)
 * derives this from whether `reveal` is empty, so it is never guessed independently of that field.
 * This is also the primary signal `mergeChromeInventory` matches sightings on — see `AppFlowChrome`'s
 * doc comment for why identity cannot be the entry node a sighting happened to occur from.
 */
export type AppFlowChromeKind = 'tabs' | 'drawer'

/**
 * One navigator chrome recorded from a live observation — the reveal gesture (e.g. tap the
 * hamburger button to open a drawer) plus every item found inside it, so a later sweep can reach
 * anything behind the chrome as "replay the reveal, then tap one named item" instead of paying for
 * a fresh exploration per screen.
 */
export interface AppFlowChrome {
  id: string
  /**
   * Which surface this is — see `AppFlowChromeKind`. Optional only so a document written before this
   * field existed still parses; `normalizeAppFlow` (`app-flow-normalize.ts`) back-fills it from
   * `reveal` on read, and every fresh detection sets it directly, so in practice this is always
   * present once a chrome has passed through either path.
   */
  kind?: AppFlowChromeKind
  /**
   * Node the chrome was observed being revealed from — descriptive provenance for the *first*
   * sighting folded into this record (or the sweep's deliberate entry pass, when that is what found
   * it first), not an identity a later sighting must match to be folded in. A device run showed why
   * that distinction matters: the same bottom tab bar was independently detected while exploring
   * toward `Profile`, `ProfileFollows` and `ProfileKnownFollowers` — three different `entryNodeId`
   * values for the identical chrome — so keying merge identity on this field left the same chrome
   * recorded several times over instead of once. See `mergeChromeInventory`'s doc comment
   * (`reach/chrome-inventory.ts`) for the identity it uses instead.
   */
  entryNodeId: string
  /** Steps that reveal the chrome, replayed before any item's own trigger. */
  reveal: AppFlowStep[]
  items: AppFlowChromeItem[]
  /** How many separate detections have been folded into this record. Pairs with
   *  `AppFlowChromeItem.sightings` — an item is only judged against the corroboration bar once the
   *  chrome itself has been seen more than once. */
  sightings?: number
  observedAt: string
  structureRevision: string
}

/** The parsed navigator tree, persisted verbatim (plan Step 4d) so a consumer of `app-flow.json`
 *  can say where a journey starts without re-parsing the project. Mirrors the corresponding fields
 *  on `ParsedAppGraph` (`parser.ts`) exactly — see that interface's doc comments for what each one
 *  means; duplicated here only because `ParsedAppGraph` is a main-process-only parse result and this
 *  is the persisted, renderer-visible shape. */
export interface AppFlowNavigation {
  layouts: AppFlowLayout[]
  rootNavigator: string | null
  entryLayouts: string[]
  entryScreenIds: string[]
}

export interface AppFlowResult {
  manifest: AppFlowManifest
  nodes: AppFlowNode[]
  edges: AppFlowEdge[]
  /**
   * Edges observed live (a recorded chrome reveal, an actual interactive hop) — kept in a separate
   * array, never merged into `edges`, because `pathsForScreen` (`profiling/dashboard.ts`) hashes
   * every parsed edge's `raw` into a profiling transition identity. A runtime edge's `raw` is
   * fabricated (there is no call site to read it from), so merging would mint a spurious profiling
   * transition per runtime edge from a string only a runtime edge can produce. A consumer that wants
   * the merged view writes `[...edges, ...(runtimeEdges ?? [])]` and gets a self-describing list,
   * since `origin` is set on every edge either way — see the reach path-finder, which does exactly
   * that in memory. Absent or `[]` on a document with no observed runtime edges, including every
   * document written before this field existed.
   */
  runtimeEdges?: AppFlowEdge[]
  /** Chrome inventories recorded from live observation. See `AppFlowChrome`'s doc comment for why
   *  this is `[]` on every document as of this round. */
  chrome?: AppFlowChrome[]
  /**
   * The parsed navigator tree — see `AppFlowNavigation`. Null on a document read before this field
   * existed (a v3 document has no navigator tree to report) or while a build has not yet parsed;
   * never partially populated.
   */
  navigation?: AppFlowNavigation | null
}

export interface AgentDeviceScreenEntry {
  key: string
  screenId?: string
  info: string
  pressables: AppFlowPressable[]
  pathToReach: string[]
  /** Whether anything ever executed these lines — see `AppFlowCapture.pathVerified`, which is
   *  stamped from this field. Absent on an entry written before it existed; a reader that has to
   *  assume should assume `false`, since the entries that predate it include every chrome-inferred
   *  guess the sweep has ever written. */
  pathVerified?: boolean
  /** The `label=`/`text=` selectors in `pathToReach` — see `AppFlowCapture.pathContentSelectors`. */
  pathContentSelectors?: string[]
  replayScript?: string | null
  replayVerified?: boolean
}

export type AgentDeviceScreensMap = Record<string, AgentDeviceScreenEntry>

/** A rectangle in device points, as agent-device reports it on a snapshot node. */
export interface ManualSnapshotRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * One element of a manual-recording snapshot, as the panel draws it.
 *
 * Carries `rect` and `ref`, which `AppFlowPressable` deliberately drops — the panel positions each
 * element by its rect. `ref` is informational only: agent-device `@ref`s expire after any device
 * action, so the renderer identifies a clicked element by `identifier`/`label`/`value`, never by
 * the ref it happened to carry on the tick it was drawn.
 */
export interface ManualSnapshotNode {
  ref: string
  role?: string
  type?: string
  label?: string
  value?: string
  identifier?: string
  rect?: ManualSnapshotRect
}

/** What the user did in the panel, translated into one agent-device interaction. */
export type ManualRecordingAction =
  | { type: 'tap'; target: ManualSnapshotNode }
  | { type: 'fill'; target: ManualSnapshotNode; value: string }
  | { type: 'scroll'; direction: 'up' | 'down' | 'left' | 'right' }

export type ManualRecordingStatus =
  'starting' | 'recording' | 'acting' | 'saving' | 'stopped' | 'error'

export type ManualRecordingEvent =
  | {
      type: 'status'
      projectId: string
      nodeId: string
      status: ManualRecordingStatus
      message?: string
    }
  | {
      type: 'snapshot'
      projectId: string
      nodeId: string
      revision: number
      nodes: ManualSnapshotNode[]
      bounds: ManualSnapshotRect
    }
  /** One recorded step, echoed back so the panel can show the journey as it grows. */
  | { type: 'step'; projectId: string; nodeId: string; command: string; portable: boolean }
  | {
      type: 'complete'
      projectId: string
      nodeId: string
      pathToReach: string[]
      replayVerified: boolean
      /** Why the verified replay was not produced, when `replayVerified` is false. */
      fallbackReason?: string
    }
  | { type: 'error'; projectId: string; nodeId: string; message: string }

export interface StartManualRecordingInput {
  projectPath: string
  nodeId: string
}

export interface ManualRecordingActInput {
  projectPath: string
  action: ManualRecordingAction
}

export interface AppFlowProjectEntry {
  id: string
  name: string
  path: string
  lastOpenedAt: string
}

export interface AppFlowPrompt {
  /**
   * `blocked`: the app kept rendering one screen whatever route was opened. Named for what was
   * observed, not for what the screen is — the screenshot tells the user that, and a sign-in wall,
   * an onboarding gate and a paywall all need the same thing from them.
   */
  kind: 'auth' | 'blocked' | 'review'
  /** Unique checkpoint identifier; stale replies are rejected. */
  id: string
  /** What the user has to do before the build can carry on. */
  detail: string
  /** `appflow://` URL of the blocking screen, or null when the capture failed. */
  screenshot: string | null
  /** Screens that stay uncaptured if the user stops the sweep. */
  remaining: number
}

export type AppFlowPromptResolution = 'continue' | 'stop' | 'override'

export interface AppFlowProgressEvent {
  type: 'phase' | 'step' | 'error' | 'prompt' | 'structure-ready' | 'complete'
  phase: 'parse' | 'boot' | 'capture' | 'classify' | 'render'
  message: string
  projectId?: string
  completed?: number
  total?: number
  /** Successful screen captures so far. Unlike `completed`, this excludes unreachable routes. */
  captured?: number
  /** Requested successful-capture goal, when the run has one. */
  captureLimit?: number
  /** Live sum of sub-agent LLM usage so far in this build. */
  tokens?: TokenUsage
  /** Set on `prompt` events: what the build is waiting for the user to do. */
  prompt?: AppFlowPrompt
}

export interface AppFlowStatusResult {
  exists: boolean
  projectId: string
  manifest?: AppFlowManifest
  error?: string
}

/** Aggregated LLM usage of a session (or of a single assistant message), summed across turns. */
export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** Reasoning tokens reported by the provider. Already included in `output`. */
  reasoning: number
  /** input + output + cacheRead + cacheWrite. */
  total: number
  /** Provider-reported cost. 0 for zero-priced providers. */
  cost: number
}

/** A zeroed usage snapshot, for starting points and for records stored before usage was tracked. */
export function emptyTokenUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, cost: 0 }
}

/**
 * What earlier runs of the resume chain contributed to the next build's `cumulativeDurationMs`.
 *
 * Non-zero only when the next build continues the *same* chain of work — a sweep resuming the
 * checkpoint its structure fingerprint still matches, or a structure-only rebuild that keeps
 * carrying the previous sweep's captures as "Previous capture". The caller passes that from the
 * identical structure-key test the captures' own resume uses, so the clock chain can never
 * outlive the checkpoint it mirrors (see `AppFlowManifest.cumulativeDurationMs`). Falls back to
 * `durationMs` so a chain begun by a build that predates this field still carries its last
 * recorded wall clock rather than silently restarting at zero.
 */
export function carriedSweepDurationMs(previous: AppFlowManifest | null, chainContinues: boolean): number {
  if (!chainContinues || !previous) return 0
  return previous.cumulativeDurationMs ?? previous.durationMs ?? 0
}

/** Sum of two usage snapshots (used to fold live per-turn usage into session totals). */
export function addTokenUsage(base: TokenUsage | undefined, delta: TokenUsage): TokenUsage {
  return {
    input: (base?.input ?? 0) + delta.input,
    output: (base?.output ?? 0) + delta.output,
    cacheRead: (base?.cacheRead ?? 0) + delta.cacheRead,
    cacheWrite: (base?.cacheWrite ?? 0) + delta.cacheWrite,
    reasoning: (base?.reasoning ?? 0) + delta.reasoning,
    total: (base?.total ?? 0) + delta.total,
    cost: (base?.cost ?? 0) + delta.cost
  }
}
