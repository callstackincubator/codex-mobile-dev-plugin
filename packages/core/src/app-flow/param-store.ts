/**
 * Real values for route params, harvested from what the app itself showed us.
 *
 * `resolveRouteParams` (exploration.ts) reads values out of *source text* — the literals a
 * `navigate('Profile', {name: 'alice'})` call site spells out. On an app that passes variables,
 * which is nearly all of them, that finds nothing, and a parameterised route is then reachable only
 * by walking to it: `/profile/:name` cost 29.2s of exploration in the reference sweep for a screen a
 * resolved param opens in ~5s. The values were on the screen the whole time — Bluesky stamps handles
 * into testIDs (`profileCard-alice.test-link`) and every navigation the harness performs reports the
 * URL it landed on.
 *
 * Everything here obeys one rule: **a value is only ever observed, never invented.** A wrong id does
 * not produce a weaker deep link, it produces a confidently wrong capture of some other record, and
 * the 404 it lands on says nothing about the screen we were asked about. So where there is no
 * evidence the answer is "no value", and the caller explores instead — exactly what it does today.
 *
 * The unit of storage is a **record**, not a param. A record is a complete param set taken from one
 * single place: one pressable, one navigation observation, one real URL. Params are never spliced
 * across sources, because `/profile/:name/lists/:rkey` built from a right `name` and some other
 * record's `rkey` is precisely the wrong-capture failure above, and it is indistinguishable from
 * success until a human looks at the screenshot.
 */

/** Where a record's values came from, loosely ordered by how directly the app vouched for them. */
export type ParamSource = 'static' | 'nav-state' | 'a11y-learned' | 'a11y-affinity'

/** Highest first. Applied wholesale to whole records — see `best`. */
const SOURCE_RANK: Record<ParamSource, number> = {
  static: 0,
  'nav-state': 1,
  'a11y-learned': 2,
  'a11y-affinity': 3
}

/**
 * A complete param set for one route, from one observation.
 *
 * `values` covers **every** param the route declares or the record is not stored for it: a partial
 * fill is the one thing that lets a right `name` carry a wrong `rkey` into a URL that opens cleanly.
 */
export interface ParamRecord {
  /** The route these values are valid for. */
  nodeId: string
  /**
   * The route pattern `nodeId` carried when the observation was made, so the record can also answer
   * for a route that shares these parameters — see `sharesRouteParams`. Absent on records carried
   * over from a sweep that predates this field, which are then only ever used for their own node.
   */
  urlPath?: string | null
  /** Complete param set; every value has passed `PARAM_VALUE_RE` and any known shape check. */
  values: Record<string, string>
  source: ParamSource
  /** Screen id the observation was made on, for provenance in the log. */
  seenOn: string
  /** Monotonic within a run; higher is more recent. */
  seq: number
  /** Carried over from a previous sweep, so the record may point at a record the app has deleted. */
  fromPriorRun?: boolean
}

/**
 * A testID shape that is known to carry a value for one param of one route — `profileCard-`…`-link`
 * for `/profile/:name`'s `name`.
 *
 * Extraction strips the prefix and suffix rather than splitting on `-`, so a value that itself
 * contains a dash (`alice-bob.bsky.social`) survives intact.
 */
export interface PressableTemplate {
  prefix: string
  suffix: string
  nodeId: string
  paramKey: string
  /**
   * `learned` — the app demonstrated this mapping: a tap on a control with this identifier landed on
   * a URL that contained the token, so the binding is observed fact.
   *
   * `affinity` — nothing has been demonstrated yet and the identifier merely *reads* like it belongs
   * to the route (`profileCard` ↔ `/profile/:name`). This is a bootstrap guess about which route a
   * value belongs to; the value itself is still real. Worst case is one wasted open, and then the
   * same exploration that would have happened anyway.
   */
  evidence: 'learned' | 'affinity'
  /** 1 for learned; the token-overlap fraction for affinity. */
  score: number
}

/**
 * A value that can stand in for a route param — the one rule every source here is held to.
 *
 * The static layer reads values out of *source text*, so what sits where a value should be is often
 * the expression around it: a `navigate('ProfileList')` call site once yielded the deep link
 * `/profile/navigate('ProfileList')/lists/navigate('ProfileList')`. The harvesting layers have the
 * mirror-image problem — a testID segment or a navigation param can be anything the app felt like
 * putting there. Anything that is not a plain URL segment is an artefact rather than a value, and
 * this lives here rather than in `exploration.ts` so both layers are measured against one rule.
 */
export const PARAM_VALUE_RE = /^[\w.~@%-]{1,128}$/

/**
 * Param values are persisted to disk and replayed across sweeps, so anything that looks like a
 * credential, or that could poison an object when it is used as a key, must never enter the store.
 * This is additive to `PARAM_VALUE_RE`, which constrains the *shape* of a value but says nothing
 * about its key and lets a short opaque token or a dotted JWT-like string through.
 */
const SENSITIVE_KEY_RE = /token|password|secret|authorization|cookie/i
const PROTOTYPE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_PARAM_KEY_LENGTH = 64
const MAX_PARAM_VALUE_LENGTH = 128
const CREDENTIAL_VALUE_RE = /^(?:Bearer\s|eyJ[A-Za-z0-9_-]+\.)/

export type ParamRejectionReason =
  'sensitive-key' | 'prototype-key' | 'key-too-long' | 'value-too-long' | 'credential-shaped-value'

/** Why one param may not be stored, or null when it may. Never includes the value itself. */
export function unsafeParamReason(key: string, value: string): ParamRejectionReason | null {
  if (PROTOTYPE_KEYS.has(key)) return 'prototype-key'
  if (key.length > MAX_PARAM_KEY_LENGTH) return 'key-too-long'
  if (SENSITIVE_KEY_RE.test(key)) return 'sensitive-key'
  if (value.length > MAX_PARAM_VALUE_LENGTH) return 'value-too-long'
  if (CREDENTIAL_VALUE_RE.test(value)) return 'credential-shaped-value'
  return null
}

/** One refused param set, for the sweep log. Carries the key and the reason, never the value. */
export interface ParamRejection {
  nodeId: string
  key: string
  reason: ParamRejectionReason
  origin: ParamSource | 'disk'
}

/** What this module needs to know about a route. Structural, so tests need no fixtures. */
export interface ParamRouteNode {
  id: string
  title?: string
  urlPath: string | null
  params: readonly string[]
}

/** What this module needs from a captured control. Matches `AppFlowPressable` structurally. */
export interface ParamPressable {
  identifier?: string
  label?: string
  text?: string
  role?: string
}

/**
 * Whether two route patterns describe the same journey far enough in that one's observed values are
 * literally the other's.
 *
 * A value is only ever observed, never invented — but an observation of `/profile/:name/post/:rkey`
 * is an observation of a real `name` and a real `rkey` *in those positions*, and
 * `/profile/:name/post/:rkey/liked-by` addresses the same post with the same two values. Holding
 * records strictly per-route meant a sweep explored three descendants of a post whose ids it had
 * just harvested, at around fifty seconds each, with the answer already in the store.
 *
 * The test is positional rather than by param name on purpose: two routes may both call a param
 * `name` and mean different things, and nothing short of identical leading segments — literals and
 * `:param` spellings alike — establishes that the shorter path is a prefix of the longer one's
 * journey. Where they diverge, no value crosses. This is not splicing: a record still travels
 * whole, from one observation, which is the rule that stops a right `name` carrying some other
 * record's `rkey`.
 */
export function sharesRouteParams(
  owner: string | null | undefined,
  target: string | null
): boolean {
  if (!owner || !target) return false
  const ownerSegments = owner.split('/').filter(Boolean)
  const targetSegments = target.split('/').filter(Boolean)
  const shared = Math.min(ownerSegments.length, targetSegments.length)
  if (!shared) return false
  for (let at = 0; at < shared; at += 1) {
    if (ownerSegments[at] !== targetSegments[at]) return false
  }
  return true
}

/* ------------------------------------------------------------------ shapes */

/**
 * The coarse family a value belongs to. Used only as a *negative* check, and only when the static
 * layer already produced a literal for the same param: a handle-shaped route whose call sites say
 * `alice.test` should not accept a bare `42` scraped off a list row. With no literal there is no
 * baseline, so no check is applied — guessing a shape would be as inventive as guessing a value.
 */
export type ShapeClass = 'digits' | 'dotted' | 'token' | 'mixed'

export function shapeClass(value: string): ShapeClass {
  if (/^\d+$/.test(value)) return 'digits'
  if (value.includes('.')) return 'dotted'
  if (/^[a-z0-9]+$/.test(value)) return 'token'
  return 'mixed'
}

/* -------------------------------------------------------------- tokenizing */

/**
 * `profileHeaderFollowersButton` / `profile-header-followers` / `ProfileFollowers` → the words a
 * human reads in them. Identifiers are source text and carry no spaces, so without this an id's own
 * words never line up with a route's.
 */
export function tokenizeIdentifier(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean)
}

/** Words so generic that sharing them says nothing about which route a control belongs to. */
const STOP_TOKENS = new Set([
  'btn',
  'button',
  'link',
  'item',
  'card',
  'row',
  'cell',
  'view',
  'screen',
  'tab',
  'by',
  'to',
  'the',
  'a',
  'id'
])

/** The words a route is identified by: its literal path segments plus its component name. */
export function nodeTokens(node: ParamRouteNode): Set<string> {
  const fromPath = (node.urlPath ?? '')
    .split('/')
    .filter((segment) => segment && !segment.startsWith(':') && !segment.startsWith('['))
    .flatMap((segment) => tokenizeIdentifier(segment))
  const fromTitle = tokenizeIdentifier(node.title ?? node.id.split('/').pop() ?? '')
  return new Set([...fromPath, ...fromTitle].filter((token) => !STOP_TOKENS.has(token)))
}

/**
 * How much of a testID's wording is accounted for by a route's own wording, in [0, 1]. Scored
 * against the prefix rather than the whole identifier so the value itself cannot contribute.
 */
export function affinityScore(prefix: string, node: ParamRouteNode): number {
  const prefixTokens = tokenizeIdentifier(prefix).filter((token) => !STOP_TOKENS.has(token))
  if (!prefixTokens.length) return 0
  const routeTokens = nodeTokens(node)
  const shared = prefixTokens.filter((token) => routeTokens.has(token))
  // A single short coincidence ("to", "id" are already dropped; "list" is not) is not evidence.
  if (!shared.some((token) => token.length >= 4)) return 0
  return shared.length / prefixTokens.length
}

/** Below this, the wording is a coincidence rather than a hint. */
const AFFINITY_FLOOR = 0.5

/* --------------------------------------------------------------- templates */

/**
 * The template a demonstrated mapping implies, found by locating the real value *inside* the
 * identifier. Substring search rather than segment splitting, so values containing `-` or `.` need
 * no special case and the recovered prefix/suffix are exactly what extraction will strip later.
 */
export function learnTemplate(
  identifier: string,
  value: string,
  nodeId: string,
  paramKey: string
): PressableTemplate | null {
  if (!value || value.length < 2) return null
  const at = identifier.indexOf(value)
  if (at === -1) return null
  // A value that is the entire identifier leaves nothing to key on and would match every control.
  if (at === 0 && value.length === identifier.length) return null
  return {
    prefix: identifier.slice(0, at),
    suffix: identifier.slice(at + value.length),
    nodeId,
    paramKey,
    evidence: 'learned',
    score: 1
  }
}

/**
 * Candidate value positions inside an identifier, for the bootstrap case where nothing has been
 * demonstrated yet. A segment only counts as a possible value when it does not read like a word a
 * developer typed: it carries a dot, a digit, an `@`, or is long enough to be an opaque key. That
 * keeps `tab-home-link` from offering `home` as somebody's handle while still finding `alice.test`,
 * `3kabc7xyz2p1q` and `did:plc:…`-style tokens.
 */
export function splitTestId(
  identifier: string
): { prefix: string; token: string; suffix: string }[] {
  const segments = identifier.split('-')
  if (segments.length < 2) return []
  const out: { prefix: string; token: string; suffix: string }[] = []
  for (let at = 0; at < segments.length; at += 1) {
    const token = segments[at]
    if (!token || !PARAM_VALUE_RE.test(token) || !looksLikeValue(token)) continue
    const prefix = segments.slice(0, at).join('-')
    if (!prefix) continue
    const suffix = segments.slice(at + 1).join('-')
    out.push({
      prefix: `${prefix}-`,
      token,
      suffix: suffix ? `-${suffix}` : ''
    })
  }
  return out
}

function looksLikeValue(token: string): boolean {
  if (/[.@%~]/.test(token)) return true
  if (/\d/.test(token) && !/^\d{1,2}$/.test(token)) return true
  return token.length >= 13
}

/** The value `identifier` carries for `template`, or null when the shape does not apply. */
export function applyTemplate(template: PressableTemplate, identifier: string): string | null {
  if (!identifier.startsWith(template.prefix)) return null
  if (template.suffix && !identifier.endsWith(template.suffix)) return null
  const token = identifier.slice(
    template.prefix.length,
    template.suffix ? identifier.length - template.suffix.length : undefined
  )
  if (!token || !PARAM_VALUE_RE.test(token)) return null
  return token
}

/* ------------------------------------------------------------- url parsing */

/**
 * The route a real URL belongs to, and the whole param set it fills.
 *
 * One observed URL is the cleanest record obtainable: every param comes from the same place by
 * construction, which is what makes nested routes like `/profile/:name/lists/:rkey` correct rather
 * than lucky. Ranked by literal segment count so a concrete route wins over a more parameterised one
 * that happens to have the same arity.
 */
export function matchFlowLink(
  url: string,
  nodes: readonly ParamRouteNode[]
): { nodeId: string; values: Record<string, string> } | null {
  const path = normalizePath(url)
  if (path === null) return null
  const actual = routeSegments(path)
  let best: { nodeId: string; values: Record<string, string>; literals: number } | null = null
  for (const node of nodes) {
    if (!node.urlPath || node.urlPath === '/') continue
    const pattern = routeSegments(node.urlPath)
    if (pattern.length !== actual.length) continue
    // A catch-all swallows the rest of the path, so the value it would yield is a path rather than
    // a segment and cannot be put back into a URL through `PARAM_VALUE_RE`. Nothing honest to do.
    if (pattern.some((segment) => segment.startsWith('[...'))) continue
    let literals = 0
    const values: Record<string, string> = {}
    let ok = true
    for (let at = 0; at < pattern.length; at += 1) {
      const key = patternParamKey(pattern[at])
      if (key === null) {
        if (pattern[at].toLowerCase() !== actual[at].toLowerCase()) {
          ok = false
          break
        }
        literals += 1
        continue
      }
      const value = decodeSegment(actual[at])
      if (!value || !PARAM_VALUE_RE.test(value)) {
        ok = false
        break
      }
      values[key] = value
    }
    if (!ok) continue
    if (!best || literals > best.literals) best = { nodeId: node.id, values, literals }
  }
  return best ? { nodeId: best.nodeId, values: best.values } : null
}

/** The path part of a URL or a bare path, or null when there is nothing routable in it. */
function normalizePath(url: string): string | null {
  const scheme = url.match(/^([a-zA-Z][\w+.-]*):\/\//)?.[1]?.toLowerCase()
  let path = (scheme ? url.slice(url.indexOf('://') + 3) : url).split(/[?#]/)[0]
  // Only `http(s)` puts an authority where a path segment would otherwise sit. An app's own scheme
  // has no host — `bluesky://profile/alice.test` means `/profile/alice.test` — so dropping a
  // "hostname" there eats the first real segment and the route never matches.
  if (scheme === 'http' || scheme === 'https') path = path.split('/').slice(1).join('/')
  const trimmed = `/${path}`.replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  return trimmed || null
}

/**
 * The routable segments of a path or template.
 *
 * `index` and Expo Router group segments (`(tabs)`) are spelled in a route's *file* path but never
 * appear in the URL the app navigates to, so a template carrying them would never match a real
 * link on length alone. Dropped from both sides, as `codex-mobile-dev-plugin`'s `matchFlowLink`
 * does, so `(tabs)/profile/[name]/index` and `/profile/alice.test` line up.
 */
function routeSegments(path: string): string[] {
  return path
    .split(/[?#]/)[0]
    .split('/')
    .filter((segment) => segment && segment !== 'index' && !/^\(.+\)$/.test(segment))
}

/** The param a template segment declares — `:name`, `:name?` and `[name]` alike. */
function patternParamKey(segment: string): string | null {
  if (segment.startsWith(':')) return segment.slice(1).replace(/\?$/, '')
  if (segment.startsWith('[') && segment.endsWith(']')) {
    return segment.slice(1, -1).replace(/^\.\.\./, '')
  }
  return null
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/* ------------------------------------------------------------------- store */

/** How a nav-state read has turned out this sweep. Latched on first failure; see `nav-state.ts`. */
export type NavStateStatus = 'unknown' | 'ready' | 'unavailable'

export interface ParamStoreJson {
  records: ParamRecord[]
  templates: PressableTemplate[]
  /** `${nodeId}\u0000${paramKey}` → the shape a static literal established for that param. */
  shapes: Record<string, ShapeClass>
}

/** One accepted record, with the provenance the sweep log prints. */
export interface ParamResolution {
  values: Record<string, string>
  source: ParamSource
  seenOn: string
  /**
   * The route whose record this is, which is not always the route being resolved — see
   * `sharesRouteParams`. `demote` is keyed on it, so a value that turns out to name something the
   * app no longer has is forgotten where it actually lives rather than left for the next
   * descendant to borrow.
   */
  ownedBy: string
}

export class ParamStore {
  /**
   * Indexed by route and by (route, param) rather than held as flat lists.
   *
   * `ingestPressables` runs once per captured screen over every control on it against every
   * parameterised route — on Bluesky that is ~45 x 22 per screen, 76 times a sweep — and the
   * bootstrap layer can mint a template per (testID shape, route) pair. Flat arrays turn each of
   * those into a scan, which is a lot of work to spend inside a change whose entire purpose is to
   * make the sweep faster. The buckets are small and kept sorted on insert, so selection is a map
   * lookup and a short walk.
   */
  private recordsByNode = new Map<string, ParamRecord[]>()
  private templatesByParam = new Map<string, PressableTemplate[]>()
  private shapes = new Map<string, ShapeClass>()
  private seq = 0
  /** Every param set refused as unsafe, in order. The same entries are logged as they happen. */
  readonly rejections: ParamRejection[] = []
  /** Set by the orchestrator so one failed nav-state read is not retried all sweep. */
  navState: NavStateStatus = 'unknown'

  /* ---------------------------------------------------------- static layer */

  /**
   * Register what `resolveRouteParams` found in source text. A complete set becomes the
   * highest-precedence record; every literal, complete or not, establishes the shape later
   * harvested values for that param have to match.
   */
  noteStatic(node: ParamRouteNode, resolved: Record<string, string>): void {
    // Static values never pass through `addObserved`, so the guard is applied here as well. One
    // unsafe literal poisons the whole set, and no shape is learned from it either.
    const unsafe = this.firstUnsafe(node, resolved, 'static')
    if (unsafe) return
    for (const [key, value] of Object.entries(resolved)) {
      if (PARAM_VALUE_RE.test(value)) this.shapes.set(shapeKey(node.id, key), shapeClass(value))
    }
    if (node.params.length && node.params.every((key) => resolved[key])) {
      this.add({
        nodeId: node.id,
        values: Object.fromEntries(node.params.map((key) => [key, resolved[key]])),
        source: 'static',
        seenOn: 'call-site',
        seq: (this.seq += 1)
      })
    }
  }

  /* ------------------------------------------------------- url observation */

  /**
   * A URL the app actually navigated to. Classified as a navigation observation because that is what
   * it is: the app produced the string, so every param in it is simultaneously real and
   * co-occurring.
   */
  ingestUrl(url: string, seenOn: string, nodes: readonly ParamRouteNode[]): ParamRecord | null {
    const match = matchFlowLink(url, nodes)
    if (!match) return null
    const node = nodes.find((candidate) => candidate.id === match.nodeId)
    if (!node) return null
    return this.addObserved(node, match.values, 'nav-state', seenOn)
  }

  /**
   * One route out of a flattened navigation state. Non-string params are dropped rather than
   * coerced past numbers: an object or array in a param slot cannot be put in a URL, and stringifying
   * it produces `[object Object]`, which is an invented value.
   */
  ingestNavRoute(
    node: ParamRouteNode,
    params: Record<string, unknown>,
    seenOn: string
  ): ParamRecord | null {
    const values: Record<string, string> = {}
    for (const key of node.params) {
      const raw = params[key]
      if (typeof raw === 'string') values[key] = raw
      else if (typeof raw === 'number' && Number.isFinite(raw)) values[key] = String(raw)
      else return null
    }
    return this.addObserved(node, values, 'nav-state', seenOn)
  }

  /* ------------------------------------------------------- a11y harvesting */

  /**
   * Teach the store a testID shape from a navigation the harness just performed: the control it
   * tapped, and the URL the app reported afterwards. This is the only evidence class that ties a
   * value to a *route* rather than merely reading like it might belong to one, so it also
   * back-fills a record for the node it just demonstrated.
   */
  learnFromNavigation(
    identifier: string | undefined,
    landedUrl: string,
    seenOn: string,
    nodes: readonly ParamRouteNode[]
  ): void {
    const match = matchFlowLink(landedUrl, nodes)
    if (!match) return
    const node = nodes.find((candidate) => candidate.id === match.nodeId)
    if (node) this.addObserved(node, match.values, 'nav-state', seenOn)
    if (!identifier) return
    for (const [key, value] of Object.entries(match.values)) {
      const template = learnTemplate(identifier, value, match.nodeId, key)
      if (template) this.addTemplate(template)
    }
  }

  /**
   * A walked arrival: the harness tapped a control and the arrival judge confirmed the app landed on
   * `node`. No URL is involved — an in-app tap produces none — so the value has to come out of the
   * identifier itself. The binding is still *demonstrated* rather than guessed, because the app is
   * what performed the navigation; this is the only way a walk pays for itself on later routes.
   *
   * Restricted to a single-param route whose identifier offers exactly one candidate position. Two
   * candidates are two readings of the same control with nothing to choose between them, and a
   * multi-param route would need every value out of this one identifier with no way to tell which
   * is which. Both stay unresolved, and the next route explores exactly as it does today.
   */
  learnFromArrival(
    identifier: string | undefined,
    node: ParamRouteNode,
    seenOn: string
  ): ParamRecord | null {
    if (!identifier || node.params.length !== 1) return null
    const candidates = splitTestId(identifier)
    if (candidates.length !== 1) return null
    const [candidate] = candidates
    const paramKey = node.params[0]
    this.addTemplate({
      prefix: candidate.prefix,
      suffix: candidate.suffix,
      nodeId: node.id,
      paramKey,
      evidence: 'learned',
      score: 1
    })
    return this.addObserved(node, { [paramKey]: candidate.token }, 'a11y-learned', seenOn)
  }

  /**
   * Read every value the controls on a captured screen carry.
   *
   * A record is only built from **one** pressable: all of a node's params must come out of the same
   * identifier, via one template each. That is what stops a `name` from one row pairing with an
   * `rkey` from another. Nodes whose params cannot all be filled from a single control stay
   * unresolved, and the caller explores — the intended outcome, not a failure.
   */
  ingestPressables(
    seenOn: string,
    pressables: readonly ParamPressable[],
    nodes: readonly ParamRouteNode[]
  ): ParamRecord[] {
    const wanted = nodes.filter((node) => node.params.length)
    if (!wanted.length) return []
    this.proposeAffinityTemplates(pressables, wanted)
    const added: ParamRecord[] = []
    for (const pressable of pressables) {
      const identifier = pressable.identifier
      if (!identifier) continue
      for (const node of wanted) {
        const values: Record<string, string> = {}
        let evidence: 'learned' | 'affinity' = 'learned'
        for (const key of node.params) {
          const hit = this.templatesFor(node.id, key)
            .map((template) => ({ template, value: applyTemplate(template, identifier) }))
            .find((candidate) => candidate.value !== null)
          if (!hit?.value) break
          values[key] = hit.value
          if (hit.template.evidence === 'affinity') evidence = 'affinity'
        }
        if (Object.keys(values).length !== node.params.length) continue
        const record = this.addObserved(
          node,
          values,
          evidence === 'learned' ? 'a11y-learned' : 'a11y-affinity',
          seenOn
        )
        if (record) added.push(record)
      }
    }
    return added
  }

  /**
   * Bootstrap templates from wording alone, for routes nothing has demonstrated yet. Only ever
   * produces `affinity` evidence, and only for a (node, param) pair that has no learned template —
   * once the app has shown us the real shape there is no reason to keep guessing at it.
   */
  private proposeAffinityTemplates(
    pressables: readonly ParamPressable[],
    nodes: readonly ParamRouteNode[]
  ): void {
    // One identifier carrying one value can only speak for a single-param route; a multi-param
    // route needs every value from the same control, which affinity scoring has no way to
    // establish. And once the app has demonstrated the real shape for a param there is no reason
    // to keep guessing at it.
    const bootstrap = nodes.filter(
      (node) => node.params.length === 1 && !this.hasLearnedTemplate(node.id, node.params[0])
    )
    if (!bootstrap.length) return
    // A feed shows the same row shape forty times over. Scoring is per distinct shape, not per
    // control, so a long list costs what a short one does.
    const shapes = new Map<string, { prefix: string; suffix: string }>()
    for (const pressable of pressables) {
      if (!pressable.identifier) continue
      for (const candidate of splitTestId(pressable.identifier)) {
        shapes.set(`${candidate.prefix}\u0000${candidate.suffix}`, candidate)
      }
    }
    for (const shape of shapes.values()) {
      for (const node of bootstrap) {
        const score = affinityScore(shape.prefix, node)
        if (score < AFFINITY_FLOOR) continue
        this.addTemplate({
          prefix: shape.prefix,
          suffix: shape.suffix,
          nodeId: node.id,
          paramKey: node.params[0],
          evidence: 'affinity',
          score
        })
      }
    }
  }

  /** Candidate shapes for one param, demonstrated ones first. Kept sorted by `addTemplate`. */
  private templatesFor(nodeId: string, paramKey: string): readonly PressableTemplate[] {
    return this.templatesByParam.get(shapeKey(nodeId, paramKey)) ?? []
  }

  private hasLearnedTemplate(nodeId: string, paramKey: string): boolean {
    return this.templatesFor(nodeId, paramKey).some((template) => template.evidence === 'learned')
  }

  /* ------------------------------------------------------------- selection */

  /**
   * The best complete param set for `node`, or null when nothing observed covers it.
   *
   * Precedence is applied to whole records and never merged: if the static layer filled `name` but
   * not `rkey`, a harvested record supplying both wins outright rather than contributing its `rkey`
   * to the static `name`.
   */
  best(node: ParamRouteNode): ParamResolution | null {
    if (!node.params.length) return null
    const covering = (records: readonly ParamRecord[]): ParamRecord[] =>
      records
        .filter((record) => node.params.every((key) => record.values[key] !== undefined))
        .sort(recordOrder)
    // The node's own observations first, whatever their source: a record made for this route is a
    // statement about this route, and one offered by a neighbour is an inference from it — sound,
    // but second in line. Precedence inside each group is unchanged.
    const own = covering(this.recordsByNode.get(node.id) ?? [])
    const chosen =
      own[0] ??
      covering(
        this.allRecords.filter(
          (record) => record.nodeId !== node.id && sharesRouteParams(record.urlPath, node.urlPath)
        )
      )[0]
    if (!chosen) return null
    return {
      values: Object.fromEntries(node.params.map((key) => [key, chosen.values[key]])),
      source: chosen.source,
      seenOn: chosen.seenOn,
      ownedBy: chosen.nodeId
    }
  }

  /**
   * Forget a record that turned out to point at something the app does not have — a handle deleted
   * since the previous sweep, an affinity template that bound the wrong route. Called when a deep
   * link built from harvested values is rejected on arrival, so the next attempt falls through to
   * the next-best record and ultimately to exploration.
   *
   * `nodeId` is the route that *owns* the record (`ParamResolution.ownedBy`), which is not always
   * the route that just failed on it: a record borrowed by a descendant has to be forgotten where
   * it lives, or every other descendant goes on borrowing the same dead value.
   */
  demote(nodeId: string, values: Record<string, string>): void {
    const stamp = valueStamp(values)
    const bucket = this.recordsByNode.get(nodeId)
    if (!bucket) return
    this.recordsByNode.set(
      nodeId,
      bucket.filter((record) => valueStamp(record.values) !== stamp)
    )
  }

  /* ------------------------------------------------------------ bookkeeping */

  private addObserved(
    node: ParamRouteNode,
    values: Record<string, string>,
    source: ParamSource,
    seenOn: string
  ): ParamRecord | null {
    if (!node.params.length) return null
    // The whole record is refused, not just the offending param: a record with a hole in it would
    // be "resolved" and then replayed incomplete.
    if (this.firstUnsafe(node, values, source)) return null
    const complete: Record<string, string> = {}
    for (const key of node.params) {
      const value = values[key]
      if (!value || !PARAM_VALUE_RE.test(value)) return null
      const expected = this.shapes.get(shapeKey(node.id, key))
      if (expected && shapeClass(value) !== expected) return null
      complete[key] = value
    }
    return this.add({
      nodeId: node.id,
      urlPath: node.urlPath,
      values: complete,
      source,
      seenOn,
      seq: (this.seq += 1)
    })
  }

  /**
   * The first unsafe param of a set, recorded and logged (key and reason only), or null when all are
   * safe. Checks the keys the route declares as well as any extra keys supplied.
   */
  private firstUnsafe(
    node: ParamRouteNode,
    values: Record<string, string>,
    origin: ParamRejection['origin']
  ): ParamRejection | null {
    const keys = new Set([...node.params, ...Object.keys(values)])
    for (const key of keys) {
      const raw = Object.hasOwn(values, key) ? values[key] : undefined
      const reason = unsafeParamReason(key, typeof raw === 'string' ? raw : '')
      if (!reason) continue
      return this.reject({ nodeId: node.id, key, reason, origin })
    }
    return null
  }

  private reject(rejection: ParamRejection): ParamRejection {
    this.rejections.push(rejection)
    console.warn(
      `[app-flow] param-store refused record for ${rejection.nodeId}: param "${rejection.key.slice(0, MAX_PARAM_KEY_LENGTH)}" ${rejection.reason} (${rejection.origin})`
    )
    return rejection
  }

  private add(record: ParamRecord): ParamRecord {
    const stamp = valueStamp(record.values)
    const bucket = this.recordsByNode.get(record.nodeId) ?? []
    const existing = bucket.find((candidate) => valueStamp(candidate.values) === stamp)
    if (existing) {
      // Re-seeing the same values from a better source is a promotion, not a duplicate.
      if (SOURCE_RANK[record.source] < SOURCE_RANK[existing.source]) existing.source = record.source
      // A record read back from a sweep older than `urlPath` learns its pattern the first time the
      // same values are seen again, rather than staying unusable by its own descendants forever.
      if (!existing.urlPath && record.urlPath) existing.urlPath = record.urlPath
      existing.seq = record.seq
      existing.fromPriorRun = false
      return existing
    }
    bucket.push(record)
    this.recordsByNode.set(record.nodeId, bucket)
    return record
  }

  private addTemplate(template: PressableTemplate): void {
    const key = shapeKey(template.nodeId, template.paramKey)
    const bucket = this.templatesByParam.get(key) ?? []
    const existing = bucket.find(
      (candidate) => candidate.prefix === template.prefix && candidate.suffix === template.suffix
    )
    if (!existing) bucket.push(template)
    else if (existing.evidence === 'affinity' && template.evidence === 'learned') {
      existing.evidence = 'learned'
      existing.score = 1
    } else if (template.score > existing.score) existing.score = template.score
    bucket.sort(templateOrder)
    this.templatesByParam.set(key, bucket)
  }

  private get allRecords(): ParamRecord[] {
    return [...this.recordsByNode.values()].flat()
  }

  private get allTemplates(): PressableTemplate[] {
    return [...this.templatesByParam.values()].flat()
  }

  /** Provenance for the sweep log: how much was learned and from where. */
  summary(): { records: number; templates: number; learned: number } {
    const templates = this.allTemplates
    return {
      records: this.allRecords.length,
      templates: templates.length,
      learned: templates.filter((template) => template.evidence === 'learned').length
    }
  }

  toJSON(): ParamStoreJson {
    return {
      records: this.allRecords.map((record) => ({ ...record })),
      templates: this.allTemplates.map((template) => ({ ...template })),
      shapes: Object.fromEntries(this.shapes)
    }
  }

  /**
   * Rehydrate from a previous sweep. Carried records are marked `fromPriorRun` and sort below
   * anything seen live, because the record they name may have been deleted in the meantime; a 404 on
   * one demotes it through `demote` exactly as a bad live record would be.
   *
   * Hostile or merely stale input is dropped rather than trusted: this file is on disk between runs.
   */
  static fromJSON(raw: unknown, { fromPriorRun = true } = {}): ParamStore {
    const store = new ParamStore()
    if (!raw || typeof raw !== 'object') return store
    const data = raw as Partial<ParamStoreJson>
    for (const record of Array.isArray(data.records) ? data.records : []) {
      if (!isPlainRecord(record)) continue
      // A file written before the guard existed may hold an unsafe record; it is dropped whole.
      const unsafe = Object.entries(record.values).find(([key, value]) =>
        unsafeParamReason(key, value)
      )
      if (unsafe) {
        store.reject({
          nodeId: record.nodeId,
          key: unsafe[0],
          reason: unsafeParamReason(unsafe[0], unsafe[1])!,
          origin: 'disk'
        })
        continue
      }
      store.add({ ...record, fromPriorRun: fromPriorRun || record.fromPriorRun })
      store.seq = Math.max(store.seq, record.seq ?? 0)
    }
    for (const template of Array.isArray(data.templates) ? data.templates : []) {
      if (isPlainTemplate(template)) store.addTemplate(template)
    }
    for (const [key, value] of Object.entries(data.shapes ?? {})) {
      if (value === 'digits' || value === 'dotted' || value === 'token' || value === 'mixed') {
        store.shapes.set(key, value)
      }
    }
    return store
  }
}

function shapeKey(nodeId: string, paramKey: string): string {
  return `${nodeId}\u0000${paramKey}`
}

/** Identity of a param set, so the same values seen twice do not become two records. */
function valueStamp(values: Record<string, string>): string {
  return Object.keys(values)
    .sort()
    .map((key) => `${key}=${values[key]}`)
    .join('&')
}

/**
 * Seen-this-run first, then precedence, then most recent.
 *
 * Freshness outranks source, which looks backwards until you notice that only the *observed*
 * sources can be carried over at all: `static` is re-derived from the project's source text on
 * every run and so is never `fromPriorRun`. Among observations, a handle read off the screen a
 * moment ago is far more likely to still exist than one a sweep from last week recorded, and the
 * record that no longer exists is the one that costs a wasted open and a 404. Within a single run
 * this comparison is inert and precedence decides everything, which is the common case.
 */
function recordOrder(left: ParamRecord, right: ParamRecord): number {
  const byRun = Number(left.fromPriorRun ?? false) - Number(right.fromPriorRun ?? false)
  if (byRun !== 0) return byRun
  const bySource = SOURCE_RANK[left.source] - SOURCE_RANK[right.source]
  if (bySource !== 0) return bySource
  return right.seq - left.seq
}

/** Demonstrated shapes before guessed ones, then the better-scoring guess. */
function templateOrder(left: PressableTemplate, right: PressableTemplate): number {
  if (left.evidence !== right.evidence) return left.evidence === 'learned' ? -1 : 1
  return right.score - left.score
}

function isPlainRecord(value: unknown): value is ParamRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<ParamRecord>
  if (typeof record.nodeId !== 'string' || !record.nodeId) return false
  if (!record.values || typeof record.values !== 'object') return false
  if (record.urlPath !== undefined && record.urlPath !== null && typeof record.urlPath !== 'string')
    return false
  const entries = Object.entries(record.values)
  if (!entries.length) return false
  if (
    !entries.every(([key, item]) => key && typeof item === 'string' && PARAM_VALUE_RE.test(item))
  ) {
    return false
  }
  return record.source !== undefined && record.source in SOURCE_RANK
}

function isPlainTemplate(value: unknown): value is PressableTemplate {
  if (!value || typeof value !== 'object') return false
  const template = value as Partial<PressableTemplate>
  return (
    typeof template.prefix === 'string' &&
    typeof template.suffix === 'string' &&
    typeof template.nodeId === 'string' &&
    typeof template.paramKey === 'string' &&
    (template.evidence === 'learned' || template.evidence === 'affinity') &&
    typeof template.score === 'number'
  )
}
