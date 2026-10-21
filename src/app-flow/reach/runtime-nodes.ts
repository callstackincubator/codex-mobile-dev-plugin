/**
 * Runtime-discovered screens — plan Step 4a.
 *
 * Opportunistic capture (`orchestrator.ts`'s `observed` hook) can only recognise a screen the parser
 * already produced a node for, scored against that node's own static description
 * (`expectedNodeTokens`/`pickOpportunisticCandidate` in `exploration.ts`). A screen the parser missed
 * entirely — a drawer item behind a registration the static scan could not follow — is seen, judged,
 * and thrown away today. This module is what turns such a sighting into a durable node instead.
 *
 * Id derivation. A raw fingerprint hash does not work as an id: `fingerprint` (`screen-signals.ts`)
 * tokenizes every pressable, so a feed's fingerprint carries usernames and post text and differs
 * between visits — which is why `similarity` exists at all, and why a hash of it would mint a new
 * node practically every time the same screen is seen again. Identity instead comes from the arrival
 * judge's own `key` (already the trusted stable name the judge is asked to hold constant across
 * visits — see `ARRIVAL_SYSTEM_PROMPT`), run through `sanitizeScreenKey` the same way any other
 * screen key is turned into something filename- and id-safe: `id = runtime:<sanitized-key>`.
 *
 * Matching. Before minting, a caller should try an existing runtime node by exact id first (a
 * repeat sighting the judge named identically), then by content similarity against the node's own
 * *pruned* signature (`matchRuntimeNode`, below `RUNTIME_NODE_MATCH_THRESHOLD`) for the case where
 * the same screen got a slightly different name this time. Only when neither matches does a fresh
 * node get minted, and even then a base id that happens to already be taken by an unrelated node
 * (two different screens the judge both called, say, "Settings") is not silently aliased onto it —
 * `mintRuntimeNode` gives it a `--<signatureHash8>` suffix instead, so ids stay readable in the
 * ordinary case and collision-safe in the rare one.
 *
 * Slug ordering. `mintRuntimeNode` takes the same `usedSlugs` set `orchestrator.ts` already builds
 * while assigning every parsed node's slug, and mutates it in place. The caller MUST have finished
 * slugging every parsed node into that set before the first runtime mint — never interleaved with
 * it. A runtime node minted before all parsed slugs exist could claim a base slug a parsed node
 * wants, pushing that parsed node into its own hash-suffixed fallback and moving its screenshot
 * filename — orphaning every existing `screens/*.png` for that route. The same ordering is required
 * wherever `buildAgentDeviceScreens` assigns its own device keys.
 *
 * No device or Electron import here — see `reach/types.ts`'s doc comment. Only `adapters.ts` may
 * import `capture.ts`/`storage.ts` values.
 */
import { createHash } from 'node:crypto'
import type { AppFlowNode } from '../../shared/app-flow.ts'
import { similarity } from '../screen-signals.ts'

/**
 * Turns a judge's or a parser's free-text screen name into something safe to use as an id fragment,
 * a filename, or a slug. Kept here (rather than duplicated in `orchestrator.ts`, which used to have
 * its own private copy) so a runtime node's id and a node's display key are always derived by the
 * exact same rule.
 */
export function sanitizeScreenKey(raw: string): string {
  return raw
    .trim()
    .replace(/[/\\]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * How similar a live observation's fingerprint must be to an existing runtime node's *pruned*
 * signature before it counts as a repeat sighting of that node rather than a candidate for a new
 * one. Deliberately looser than `ARRIVAL_SIMILARITY`'s 0.9 (`orchestrator.ts`): that constant
 * compares two observations of a *single* already-confirmed visit, taken moments apart, while this
 * compares a fresh live observation — taken on some later walk, possibly with different feed
 * content on screen around it — against a signature that has already been pruned down to just the
 * tokens earlier sightings agreed on. Demanding 0.9 here would mint a new node for almost every
 * repeat visit to a content-heavy screen.
 */
export const RUNTIME_NODE_MATCH_THRESHOLD = 0.6

export interface RuntimeNodeMintInput {
  /** The judge's own stable name for the screen. Never a raw fingerprint hash — see this module's
   *  doc comment on id derivation. */
  key: string
  title: string
  observedTokens: ReadonlySet<string>
  /**
   * Every node id already in play, parsed and runtime alike, so a fresh mint can tell a genuine id
   * collision (an unrelated screen the judge happened to name identically) apart from an ordinary
   * first sighting with nothing to collide against.
   */
  existingIds: ReadonlySet<string>
  /**
   * Hoisted out of the parsed-node slugging loop and mutated in place here — see this module's doc
   * comment on slug ordering. Must already contain every parsed node's slug before the first call.
   */
  usedSlugs: Set<string>
}

/** Mirrors `storage.ts`'s `generateSlug` exactly, duplicated rather than imported: that module
 *  value-imports `electron`, and only `adapters.ts` is allowed to pull that into `reach/`. */
function slugifyId(id: string): string {
  return id
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase()
}

function uniqueRuntimeSlug(id: string, used: Set<string>): string {
  const base = slugifyId(id) || 'runtime_screen'
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let index = 2
  while (used.has(`${base}_${index}`)) index += 1
  const next = `${base}_${index}`
  used.add(next)
  return next
}

/** A short, stable-enough fragment to disambiguate two unrelated screens whose sanitized keys
 *  happen to collide — sorted so the same signature always yields the same suffix. */
function collisionSuffix(observedTokens: ReadonlySet<string>): string {
  return createHash('sha256')
    .update([...observedTokens].sort().join(','))
    .digest('hex')
    .slice(0, 8)
}

/**
 * Builds a fresh `origin: 'runtime'` node for a screen nothing already known accounts for. Callers
 * must have already tried `matchRuntimeNode` and gotten null back — this never checks for a match
 * itself, only for an id collision worth disambiguating.
 */
export function mintRuntimeNode(input: RuntimeNodeMintInput): AppFlowNode {
  const baseId = `runtime:${sanitizeScreenKey(input.key) || 'screen'}`
  const id = input.existingIds.has(baseId)
    ? `${baseId}--${collisionSuffix(input.observedTokens)}`
    : baseId
  return {
    id,
    urlPath: null,
    reach: 'navigation-only',
    title: input.title.trim() || input.key,
    file: null,
    slug: uniqueRuntimeSlug(id, input.usedSlugs),
    group: '',
    groups: [],
    navigator: null,
    params: [],
    presentation: null,
    guard: null,
    capture: null,
    origin: 'runtime',
    runtimeSignature: [...input.observedTokens],
    sightings: 1
  }
}

/**
 * Finds the existing runtime node a live observation belongs to, or null when none does — see this
 * module's doc comment on matching order. `candidateId` is optional because a caller cheaply
 * pre-checking similarity alone (before spending a model call to learn the judge's `key`, and so
 * before it has an id to compare) has none yet.
 */
export function matchRuntimeNode(
  existing: readonly AppFlowNode[],
  observedTokens: ReadonlySet<string>,
  candidateId?: string | null,
  threshold = RUNTIME_NODE_MATCH_THRESHOLD
): AppFlowNode | null {
  if (candidateId) {
    const exact = existing.find((node) => node.id === candidateId)
    if (exact) return exact
  }
  let best: { node: AppFlowNode; score: number } | null = null
  for (const node of existing) {
    if (!node.runtimeSignature?.length) continue
    const score = similarity(observedTokens, new Set(node.runtimeSignature))
    if (score >= threshold && (!best || score > best.score)) best = { node, score }
  }
  return best?.node ?? null
}

/**
 * Folds a repeat sighting into an already-minted runtime node: bumps `sightings`, and re-prunes
 * `runtimeSignature` down to the intersection with this sighting's own tokens. That intersection is
 * exactly "tokens seen in at least two sightings" for the node's first repeat, and "tokens every
 * sighting so far agrees on" for every one after — the convergence that is what makes the signature
 * an identity rather than one visit's incidental vocabulary. Falls back to keeping the prior
 * signature unpruned on the degenerate case where this sighting shares nothing with it at all,
 * rather than erasing the node's identity down to an empty set it could never be matched against
 * again.
 */
export function recordRuntimeSighting(
  node: AppFlowNode,
  observedTokens: ReadonlySet<string>
): AppFlowNode {
  const prior = node.runtimeSignature ?? []
  const pruned = prior.filter((token) => observedTokens.has(token))
  return {
    ...node,
    sightings: (node.sightings ?? 1) + 1,
    runtimeSignature: pruned.length ? pruned : prior
  }
}
