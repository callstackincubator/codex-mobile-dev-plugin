/**
 * Chrome inventory detection — plan Step 3d.
 *
 * When the explorer reveals a drawer or reads a tab bar, most of that screen's pressables are
 * exactly the app's own vocabulary for its other destinations — "Settings", "Profile",
 * "Notifications" — which is precisely what `expectedNodeTokens` (`exploration.ts`) already builds
 * from a node's title/id/url for opportunistic capture. Detection here is nothing more than running
 * that same coverage scorer (`expectedCoverage`, exported from `exploration.ts` specifically so this
 * module never forks it) the other way around: for each visible pressable, which still-known
 * destination's own words does its text cover well enough to be that destination's control?
 *
 * Firing only above a coverage bar, and only when at least three pressables each resolve to a
 * *distinct* destination, is what keeps this from firing on ordinary content — a feed screen's rows
 * routinely share a stray word or two with some node's title, but a drawer or tab bar is the one
 * place several of them cluster together and each maps to a different destination.
 *
 * The payoff is `chromeEdges`: a recorded chrome becomes `entry -> item` runtime edges carrying the
 * item's own locator as the edge's `trigger`. `findNavigationPath` (`exploration.ts`) already prefers
 * a hop with a resolved trigger over one without (`UNRESOLVED_HOP_PENALTY`), so this turns "no path,
 * explore from scratch" into a walkable one-hop journey for every screen behind the chrome, with no
 * change to the path-finder itself.
 *
 * No device or Electron import here — see `reach/types.ts`'s doc comment. Only `adapters.ts` may
 * import `capture.ts`/`storage.ts` values.
 */
import type {
  AppFlowChrome,
  AppFlowChromeItem,
  AppFlowChromeKind,
  AppFlowEdge,
  AppFlowEdgeEvidence,
  AppFlowNode,
  AppFlowPressable,
  AppFlowStep,
  AppFlowTrigger
} from '../../shared/app-flow.ts'
import { expectedCoverage } from '../exploration.ts'
import { tokenize } from '../screen-signals.ts'

/**
 * One thing a chrome item's pressable text can be scored against — a node's own static vocabulary,
 * or (when no single node stands for a whole layout) the layout's own name. Deliberately generic:
 * this module does not care where a candidate's tokens came from, only how well a pressable's text
 * covers them.
 */
export interface ChromeCandidate {
  /** Used only to tell candidates apart while claiming one per item — not persisted anywhere. */
  label: string
  /** The node this candidate resolves to, or null for a bare layout name with no single node of its
   *  own (see `AppFlowChromeItem.toNodeId`'s doc comment in `shared/app-flow.ts`). */
  toNodeId: string | null
  tokens: ReadonlySet<string>
}

/**
 * Coverage a chrome item's own pressable text must reach against a candidate's vocabulary before the
 * two are considered the same destination. Shares `pickOpportunisticCandidate`'s 0.5 bar
 * (`exploration.ts`) rather than inventing a second number: the underlying question — does this
 * short piece of UI text carry a destination's own words — is identical in both places.
 */
const MIN_CHROME_ITEM_COVERAGE = 0.5

/**
 * How many pressables must each resolve to a distinct destination before this is treated as a
 * navigator chrome rather than incidental overlap. Below three, ordinary content (a back button
 * whose label happens to share a word with some node's title, one feed row that mentions another
 * screen's name) produces exactly this shape too often to trust.
 */
const MIN_CHROME_ITEMS = 3

/**
 * Longest a chrome item's label may be before it is rejected outright, regardless of coverage
 * score. A device run against the Bluesky app produced `chrome:tabs:HomeTab/Home` with 89 items
 * because ordinary post-body text ("Worth pointing out that this will disproportionately harm
 * men. Despite all the r…") happened to clear the 0.5 coverage bar against `AboutSettings` — long
 * free text simply has enough tokens for a coincidental match to slip through. A drawer row or tab
 * label is a short caption by construction ("Settings", "Notifications", "Moderation and content
 * filters" at the outer edge); 40 characters comfortably covers real navigator captions, including
 * multi-word ones, while cutting off a feed post's first sentence long before its tokens can pile
 * up enough coverage to fool the scorer.
 */
const MAX_CHROME_ITEM_LABEL_LENGTH = 40

/**
 * Most words a chrome item's label may contain. Pairs with `MAX_CHROME_ITEM_LABEL_LENGTH` to catch
 * the case a raw length cap alone would miss: a handful of short words packed together ("Add to
 * lists and mute") reads as a sentence fragment, not a caption, even under 40 characters. Real
 * chrome captions this module has actually seen top out at two or three words ("Moderation and
 * content filters" is four); five leaves headroom without opening the door back up to prose.
 */
const MAX_CHROME_ITEM_LABEL_WORDS = 5

/**
 * Whether `label` is even plausibly a navigator caption, checked before it is ever scored against
 * a candidate's vocabulary. This is the fix for the device run's worst finding: post-body text
 * ("She demonstrated that power with Navatek. After the budgets became law, Collins'…") does not
 * look anything like "Settings" or "Notifications" to a human, but `expectedCoverage` only sees
 * token overlap, and long text has enough tokens to accidentally clear the bar. A newline is the
 * strongest signal of all — a caption is one line by definition, a multi-line body never is — so
 * it disqualifies a label outright regardless of length or word count.
 */
export function looksLikeChromeCaption(label: string): boolean {
  if (label.includes('\n')) return false
  if (label.length > MAX_CHROME_ITEM_LABEL_LENGTH) return false
  if (label.trim().split(/\s+/).length > MAX_CHROME_ITEM_LABEL_WORDS) return false
  return true
}

/** The locator a chrome item would be tapped through, read off the same pressable its label comes
 *  from. `text` is accepted here (unlike `pickLandmarkLocator`'s destination guard, `exploration.ts`)
 *  because a chrome item's trigger is a data record for later replay, not agent-device's publish
 *  guard, which is the only place a bare `text=` selector's weaker identity actually matters. */
function pressableTrigger(pressable: AppFlowPressable): AppFlowTrigger | null {
  if (pressable.identifier?.trim()) return { by: 'id', value: pressable.identifier.trim() }
  if (pressable.label?.trim()) return { by: 'label', value: pressable.label.trim() }
  if (pressable.text?.trim()) return { by: 'text', value: pressable.text.trim() }
  return null
}

function pressableLabel(pressable: AppFlowPressable): string {
  return (pressable.text ?? pressable.label ?? pressable.identifier ?? '').trim()
}

/**
 * What a control that opens a drawer is called, across the naming conventions apps actually use for
 * it — the device run that motivated this module's deliberate entry pass found Bluesky's own as
 * `label="Open drawer menu"`, and `id="hamburger"`/`"burgerMenu"`/`"navMenuButton"` are the same
 * control under RN's other common spellings. Deliberately narrower than a bare `/menu/i`: a "Menu"
 * button is just as likely to be a post's own context menu as a drawer opener, and a false match
 * here wastes the deliberate pass's one drawer attempt taping the wrong control instead of finding
 * none at all (which is handled safely — see `findDrawerOpener`'s doc comment).
 */
const DRAWER_OPENER_PATTERN =
  /drawer|hamburger|burger[-_ ]?menu|nav(?:igation)?[-_ ]?menu|menu[-_ ]?(?:button|icon|toggle)|open[-_ ]?menu/i

function triggerMatchCount(
  pressables: readonly AppFlowPressable[],
  trigger: AppFlowTrigger
): number {
  const field =
    trigger.by === 'id' ? 'identifier' : trigger.by === 'label' ? 'label' : ('text' as const)
  let count = 0
  for (const pressable of pressables) {
    if (
      (pressable[field as keyof AppFlowPressable] as string | undefined)?.trim() === trigger.value
    )
      count++
  }
  return count
}

/** Every locator that could stand for this pressable, strongest first — the same `id` > `label` >
 *  `text` order `pressableTrigger` uses, but as a list so the caller can keep looking when the
 *  strongest one turns out to be ambiguous. */
function candidateTriggers(pressable: AppFlowPressable): AppFlowTrigger[] {
  const triggers: AppFlowTrigger[] = []
  if (pressable.identifier?.trim()) triggers.push({ by: 'id', value: pressable.identifier.trim() })
  if (pressable.label?.trim()) triggers.push({ by: 'label', value: pressable.label.trim() })
  if (pressable.text?.trim()) triggers.push({ by: 'text', value: pressable.text.trim() })
  return triggers
}

/**
 * The control that opens the app's drawer, found by name alone — no screenshot, no model call, just
 * the same pressable list `capturePressables` already returns for free. Tried against
 * `identifier`/`label`/`text` together (a control's accessible name can live in any of them
 * depending on how the screen was built), preferring `id` over `label` over `text` exactly as every
 * other locator in this module does, but skipping any locator that would be ambiguous — see the
 * comment inside. Returns null when nothing in `pressables` reads as a drawer opener, or when no
 * match yields a usable locator; the caller (`orchestrator.ts`'s deliberate entry-chrome pass)
 * treats that as "this app has no drawer" and moves on, not as an error.
 */
export function findDrawerOpener(pressables: readonly AppFlowPressable[]): AppFlowTrigger | null {
  for (const pressable of pressables) {
    const candidateText = [pressable.identifier, pressable.label, pressable.text]
      .filter(Boolean)
      .join(' ')
    if (!DRAWER_OPENER_PATTERN.test(candidateText)) continue
    // Prefer a locator that is unique within `pressables`, since agent-device refuses to act on an
    // ambiguous selector rather than guessing. Walk down this pressable's own locators to the first
    // unambiguous one, and if it has none, keep looking at the other matching controls — a
    // duplicate label's twin often carries a distinct id.
    //
    // This cannot catch every ambiguity, and deliberately does not try to. `capturePressables`
    // (`capture.ts`) deduplicates by the exact object it builds, so two controls identical in
    // text/label/identifier/role — Bluesky's two `label="Open drawer menu"` buttons are exactly
    // that — arrive here already collapsed into one entry and look unique by construction. The
    // ambiguity is only observable on device, which is where it is handled: the tap itself narrows
    // and retries. This check is the cheap half, for the ambiguity that IS visible in the list.
    for (const trigger of candidateTriggers(pressable)) {
      if (triggerMatchCount(pressables, trigger) === 1) return trigger
    }
  }
  return null
}

/**
 * Whether a freshly detected chrome reads as an always-visible tab bar or a drawer that had to be
 * opened first, straight from the `reveal` steps the caller already worked out. No steps means
 * nothing happened before the pressables were read, so the bar was already on screen: `tabs`. A
 * drawer requires more than *some* step having happened — it requires a step that actually reads as
 * opening a drawer, matched with the same `DRAWER_OPENER_PATTERN` `findDrawerOpener` uses.
 *
 * The stricter test matters because the opportunistic caller (`orchestrator.ts`'s `chrome-observed`
 * fact) cannot supply a true reveal sequence and approximates it as `[lastAction]` — whatever tap
 * the walk happened to make before this frame. Inferring `drawer` from mere non-emptiness therefore
 * labelled every post-tap inventory a drawer: a device run recorded "8 items (drawer)" for the
 * profile screen reached by tapping the profile *tab*, and "3 items (drawer)" for a share popup.
 * Those are not drawers, and since `kind` is `sameChrome`'s primary identity signal, each bogus one
 * is a phantom chrome the merge can never reconcile with the real thing.
 *
 * See `mergeChromeInventory`'s doc comment for why a drawer and a tab bar must never be treated as
 * the same chrome even when a couple of item labels coincide (both might have a "Settings" row).
 */
export function inferChromeKind(reveal: readonly AppFlowStep[]): AppFlowChromeKind {
  const openedByDrawerControl = reveal.some((step) => {
    const locator = 'locator' in step ? step.locator : null
    return locator ? DRAWER_OPENER_PATTERN.test(locator.value) : false
  })
  return openedByDrawerControl ? 'drawer' : 'tabs'
}

/**
 * Matches visible pressables against `candidates`, greedily claiming each candidate for at most one
 * item (its best-scoring pressable) so two items never both point at the same destination. Returns
 * null when fewer than `MIN_CHROME_ITEMS` pressables resolve — either this frame is not a chrome at
 * all, or the destinations it lists are mostly ones nothing here recognises yet.
 */
export function detectChromeInventory(
  pressables: readonly AppFlowPressable[],
  candidates: readonly ChromeCandidate[],
  options: { minCoverage?: number } = {}
): { items: AppFlowChromeItem[] } | null {
  const minCoverage = options.minCoverage ?? MIN_CHROME_ITEM_COVERAGE
  const claimed = new Set<string>()
  const items: AppFlowChromeItem[] = []
  for (const pressable of pressables) {
    const trigger = pressableTrigger(pressable)
    const label = pressableLabel(pressable)
    if (!trigger || !label) continue
    // Reject content text before it ever reaches the scorer — see `looksLikeChromeCaption`'s doc
    // comment for the device run this fixes. Applied uniformly regardless of whether the pressable
    // also carries an `identifier`: a testID does not make a post's body text a navigator caption,
    // it only makes the *trigger* stronger, which `pressableTrigger` already accounts for.
    if (!looksLikeChromeCaption(label)) continue
    const tokens = new Set(tokenize(label))
    if (!tokens.size) continue
    let best: { candidate: ChromeCandidate; score: number } | null = null
    for (const candidate of candidates) {
      if (claimed.has(candidate.label)) continue
      const score = expectedCoverage(tokens, candidate.tokens)
      if (score < minCoverage) continue
      if (!best || score > best.score) best = { candidate, score }
    }
    if (!best) continue
    claimed.add(best.candidate.label)
    items.push({ label, toNodeId: best.candidate.toNodeId, trigger })
  }
  return items.length >= MIN_CHROME_ITEMS ? { items } : null
}

/**
 * The runtime edges a recorded chrome contributes: one `chrome -> item` edge per item that resolved
 * to a node, plus exactly one `entry -> chrome` reveal edge.
 *
 * Item edges used to run `entry -> item`, `entry` being `chrome.entryNodeId` — the node the FIRST
 * sighting happened to be observed from (see `AppFlowChrome.entryNodeId`'s doc comment). That is
 * false for every item merged in from a later sighting: `mergeChromeInventory` unions items across
 * sightings while keeping the first sighting's `entryNodeId` fixed, so an item harvested while the
 * chrome was seen from the Settings screen ("Appearance", "Accessibility", "Moderation and content
 * filters") was emitted as an edge out of `HomeTab/Home`. A device run against the Bluesky app
 * produced exactly this: `HomeTab/Home` accumulated 89 chrome items and 40 of the run's 54 runtime
 * edges, every one claiming to originate from Home, drowning out the tree of genuine pushes
 * underneath. The fix is to stop pretending the chrome belongs to any one screen at all: each item
 * edge now runs `chrome.id -> item.toNodeId`, and `chromeVirtualNodes` gives `chrome.id` a real node
 * to be the `from` of. The single reveal edge (`entryNodeId -> chrome.id`, `kind: 'reveal'`) is what
 * then makes the chrome — and everything behind it — reachable from the graph at all, without
 * asserting that any one of its items lives on the entry screen specifically.
 *
 * The reveal edge's trigger comes from the first `reveal` step that carries a `locator` — the
 * gesture that actually opens the chrome (e.g. tapping the hamburger button for a drawer). An empty
 * `reveal` (`inferChromeKind` reads that as `'tabs'`, an always-visible bar) still gets a reveal
 * edge, just with `trigger: null`: a tab bar needs no gesture to reach, but it must still be a
 * traversable edge in the graph, or nothing ever explains how its items are reachable.
 *
 * Always gives every edge a human `raw` — never `''` — because the renderer uses it as the edge's
 * label; see `AppFlowEdge.origin`'s doc comment in `shared/app-flow.ts`.
 */
export function chromeEdges(chrome: AppFlowChrome): AppFlowEdge[] {
  const evidence: AppFlowEdgeEvidence = {
    structureRevision: chrome.structureRevision,
    observedAt: chrome.observedAt,
    verified: false,
    chromeId: chrome.id
  }
  // The reveal edge here is anchored to `entryNodeId`, unlike the authoritative one
  // `chromeRevealEdges` derives from the captures. These edges exist to be *planned over* during
  // the sweep: `findNavigationPath` needs some traversable `screen -> chrome` hop or nothing behind
  // the chrome is reachable, and mid-sweep there are no finished captures to derive the real sites
  // from. It is a working assumption, not a finding, and it never reaches the document —
  // `rebuildChromeEdges` discards every `runtime-chrome` edge at assembly time and re-derives the
  // whole set from the finished records and captures.
  const edges: AppFlowEdge[] = [
    {
      from: chrome.entryNodeId,
      to: chrome.id,
      raw: `reveal "${chrome.id}"`,
      target: null,
      trigger: revealLocator(chrome),
      origin: 'runtime-chrome',
      kind: 'reveal',
      evidence
    }
  ]
  for (const item of corroboratedChromeItems(chrome)) {
    if (!item.toNodeId) continue
    edges.push({
      from: chrome.id,
      to: item.toNodeId,
      raw: `chrome "${item.label}"`,
      target: null,
      trigger: item.trigger,
      origin: 'runtime-chrome',
      evidence
    })
  }
  return edges
}

/** `chrome.id` (e.g. `chrome:tabs:HomeTab/Home`) sanitised the same way `parser.ts`'s own
 *  `generateSlug` turns a route id into a slug — `:`/`/` and every other non-alphanumeric character
 *  collapsed to a single `_`, lowercased — so a chrome's virtual node has a slug as usable as any
 *  parsed node's for anything that indexes by slug (screenshot paths, saved scripts). */
function chromeSlug(id: string): string {
  return id
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase()
}

/** What to call a chrome's virtual node in the UI — the only two shapes `inferChromeKind` produces. */
function chromeTitle(kind: AppFlowChromeKind | undefined): string {
  return kind === 'drawer' ? 'Drawer' : 'Tab bar'
}

/**
 * One `AppFlowNode` per recorded chrome, so the chrome ids `chromeEdges` now uses as edge endpoints
 * (both the `from` of every item edge and the `to` of the reveal edge) are real nodes the rest of
 * the graph can point at, lay out, and render — an edge to an id with no matching node is simply
 * broken everywhere else in this codebase.
 *
 * These are virtual: `origin: 'chrome'`, `file: null`, `urlPath: null`, `capture: null`, matching
 * `AppFlowNode.origin`'s `'chrome'` case (`shared/app-flow.ts`), which spells out why. They stand for a
 * navigator surface, not a screen — there is no source location, no route, and nothing to run the
 * capture sweep against, so a caller that walks `nodes` looking for screens to capture must filter
 * these out exactly as that doc comment says. `computeStructureKey` (`reach/structure-key.ts`)
 * throws if handed one, the same as a `'runtime'` node — see its own doc comment for why a node
 * discovered live must never enter the hash that discovery itself is checkpointed against.
 */
export function chromeVirtualNodes(chrome: readonly AppFlowChrome[]): AppFlowNode[] {
  // Deduped by id even though `sameChrome` now settles identical ids at merge time, because this
  // also runs over chrome read back from documents written before that rule existed — and a node
  // table with two entries under one id is a worse failure than a missing surface: the renderer
  // builds its lookup one-for-one from this array, so the duplicate silently wins or loses
  // depending on iteration order.
  const seen = new Set<string>()
  return chrome
    .filter((entry) => {
      if (seen.has(entry.id)) return false
      seen.add(entry.id)
      return true
    })
    .map((entry) => ({
      id: entry.id,
      urlPath: null,
      reach: 'navigation-only',
      title: chromeTitle(entry.kind),
      file: null,
      slug: chromeSlug(entry.id),
      group: '',
      groups: [],
      navigator: null,
      params: [],
      presentation: null,
      stateHints: [],
      guard: null,
      capture: null,
      origin: 'chrome'
    }))
}

/** Item labels, normalised for identity comparison only — case/whitespace differences between two
 *  sightings of the same control are not a different chrome, so they must not defeat matching. */
function chromeItemLabels(chrome: AppFlowChrome): Set<string> {
  return new Set(chrome.items.map((item) => item.label.trim().toLowerCase()))
}

/** How many of the same item labels two chromes must share, at minimum, before they are treated as
 *  the same navigator surface rather than two different ones that happen to overlap — a drawer and a
 *  tab bar can both have a "Settings" row, and one shared word must not be enough to fold them
 *  together. `detectChromeInventory` never records fewer than `MIN_CHROME_ITEMS` (3) items for any
 *  chrome, so this is comfortably below what two genuinely different chromes would share by chance. */
const MIN_SHARED_CHROME_ITEMS = 2

/**
 * Whether `a` and `b` are the same navigator chrome — same kind, and enough of the same items that
 * this is unmistakably a repeat sighting rather than coincidental overlap. Deliberately NOT an exact
 * item-set match: a later sighting routinely sees more or fewer items than an earlier one (a drawer
 * scrolled to a different position, more of the app's nodes known by the time of a later pass, the
 * item that motivated this — see `AppFlowChrome.entryNodeId`'s doc comment), so requiring the two
 * sets to match exactly would keep failing to recognise the very sightings this exists to merge.
 * `kind` falls back to `inferChromeKind(chrome.reveal)` when unset, so a chrome read from a document
 * written before that field existed still compares correctly rather than always mismatching.
 */
export function sameChrome(a: AppFlowChrome, b: AppFlowChrome): boolean {
  // An identical id settles it before any item comparison. `id` is `chrome:<kind>:<entryNodeId>`
  // (`orchestrator.ts`), so two records carrying the same one agree on both the surface's kind and
  // the screen it was revealed from — there is no reading under which those are different chromes.
  // Without this, the label test alone could refuse to merge them, and because the id is computed
  // rather than allocated, the refusal minted a second record under the SAME id: a real sweep
  // ended up with two `chrome:tabs:MessagesConversation` entries, three items each, sharing one
  // label. That was survivable while a chrome id was only a bookkeeping key; now that
  // `chromeVirtualNodes` turns it into a graph node id and `chromeEdges` makes it the `from` of
  // every item edge, a duplicate id means two nodes claiming one identity and edges that cannot say
  // which they leave from.
  if (a.id === b.id) return true
  if ((a.kind ?? inferChromeKind(a.reveal)) !== (b.kind ?? inferChromeKind(b.reveal))) return false
  const labelsA = chromeItemLabels(a)
  const labelsB = chromeItemLabels(b)
  let shared = 0
  for (const label of labelsB) if (labelsA.has(label)) shared++
  return shared >= Math.min(MIN_SHARED_CHROME_ITEMS, labelsA.size, labelsB.size)
}

/**
 * The already-recorded chrome `detected` is a repeat sighting of, or null when nothing recorded so
 * far is the same chrome. Exported alongside `mergeChromeInventory` (which uses it internally) so a
 * caller that needs to know *which* record a detection landed on — `orchestrator.ts`'s chrome-observed
 * handler builds `chromeEdges` from the matched record's own `entryNodeId`/`id`, not the fresh
 * detection's, so a repeat sighting from a new screen still contributes an edge from the chrome's one
 * canonical entry rather than minting a parallel edge per screen it happens to be seen from — can get
 * it without re-deriving the same search.
 */
export function findMatchingChrome(
  existing: readonly AppFlowChrome[],
  detected: AppFlowChrome
): AppFlowChrome | null {
  return existing.find((chrome) => sameChrome(chrome, detected)) ?? null
}

/**
 * Folds a freshly detected chrome into whatever this sweep has already recorded, identified by what
 * the chrome IS (`sameChrome`'s kind-plus-item-overlap test) rather than by `entryNodeId` — see
 * `AppFlowChrome.entryNodeId`'s doc comment for the device run that showed why the entry a sighting
 * happened to occur from cannot be the identity: the same bottom tab bar was detected from three
 * different screens and, keyed by entry node, recorded three separate times. Items are merged by
 * label so a later, more complete reading of the same chrome adds or replaces items without losing
 * ones an earlier pass already resolved and this one simply did not see again — but only items the
 * sweep has corroborated survive, see `MIN_CHROME_ITEM_SIGHTINGS` below. `entryNodeId`,
 * `id` and `kind` all keep the FIRST record's own values on a merge — the first sighting (ideally the
 * deliberate entry-chrome pass, which observes it from the app's actual launch screen) is the most
 * trustworthy provenance for "where is this chrome reachable from", and overwriting it with whichever
 * screen a later, merely opportunistic sighting happened to occur from would make that provenance
 * worse with every repeat sighting instead of better.
 */
/**
 * How many separate sightings of a chrome must show an item before it is kept.
 *
 * `detectChromeInventory` reads a whole frame, not a cropped navigator surface, so every sighting
 * of a bottom tab bar also offers up whatever screen happens to be behind it. Unioning those
 * readings — which is what merging did — is how one real sweep turned a five-item tab bar into a
 * 55-item record: `Home | Search | Notifications | Profile` (the actual bar, present in every
 * sighting) unioned with `Appearance`, `Accessibility` and `Add another account` harvested off the
 * Settings screen, `Inbox zero!` off the moderation inbox, `51,215 followers` and a dozen
 * `View <someone>'s profile` rows off profile screens. Each of those appeared exactly once,
 * because each belongs to one screen rather than to the chrome.
 *
 * That is the whole signal, and two is enough to read it: a chrome's own controls are on screen
 * every time the chrome is, so they recur across sightings from unrelated screens; a screen's
 * content does not. This is the same convergence `recordRuntimeSighting`
 * (`reach/runtime-nodes.ts`) already applies to a runtime node's signature, narrowing a first
 * sighting's incidental vocabulary down to what repeat sightings agree on.
 *
 * An item that earns its second sighting is kept permanently, never re-tested — a drawer scrolled
 * to a different position legitimately hides rows it showed before, and the doc comment on
 * `sameChrome` explains why a later sighting seeing fewer items must not be read as disagreement.
 * The cost is that an item first seen in a chrome's final sighting is dropped for want of a second
 * chance; that is the conservative direction to fail in, since the alternative is what produced
 * the 55-item record.
 */
const MIN_CHROME_ITEM_SIGHTINGS = 2

/**
 * Least share of a chrome's own sightings an item must appear in, on top of
 * `MIN_CHROME_ITEM_SIGHTINGS`.
 *
 * A flat bar of two is only enough while a chrome is sighted a handful of times. The Bluesky sweep
 * that followed sighted its bottom tab bar **130 times** and recorded **87 items** — and two
 * sightings out of 130 cleared the bar, so 43 edges were published from what is a five-item tab
 * bar. The counts themselves separate the two populations completely, once read as a proportion
 * rather than a total:
 *
 *   Home 130 · Search 119 · Notifications 115 · Profile 109   ← the bar, on screen every time
 *   'View Kyle Orland’s profile' 1 · '165434 followers' 1 · 'Inbox zero!' 1 · 'Video Games' 5
 *
 * That is not a coincidence of this app: a chrome's own controls are on screen whenever the chrome
 * is, so their count tracks the record's, while a screen's content is captured by whichever
 * sightings happened to occur on that screen. Half is a deliberately loose reading of "most of
 * them" — it tolerates a drawer scrolled past a row, a bar that hides on some screens, and items
 * that only start being counted partway through a sweep, while still being far above anything
 * incidental can reach. On the run above it keeps exactly `Home | Search | Notifications | Profile`
 * and drops all 83 others.
 *
 * The proportion is also what makes those one-off items' fabricated `toNodeId`s disappear, which no
 * amount of label filtering managed to: five `View <someone>'s profile` rows resolved to five
 * different nodes (`Profile`, `MyProfile`, `ProfileFollowers`, `ProfileFollows`, `ProfileSearch`)
 * because token overlap on the word "profile" clears `MIN_CHROME_ITEM_COVERAGE` against all of
 * them. Garbage never recurs, so requiring recurrence removes it without having to recognise it.
 */
const MIN_CHROME_ITEM_SIGHTING_RATIO = 0.5

export function mergeChromeInventory(
  existing: readonly AppFlowChrome[],
  detected: AppFlowChrome
): AppFlowChrome[] {
  const match = findMatchingChrome(existing, detected)
  if (!match) {
    return [...existing, { ...detected, sightings: 1, items: detected.items.map(firstSighting) }]
  }
  // Carried-forward items missing a count are seeded to 1 rather than left undefined. A record
  // written before `sightings` existed has items that were certainly seen at least once, and
  // leaving them unset would invert the rule the moment this record is merged into: the
  // `undefined` legacy items would be kept unconditionally while freshly counted ones still had to
  // earn their second sighting, so the noise would outlive the signal.
  const items = new Map(
    match.items.map((item) => [item.label, { ...item, sightings: item.sightings ?? 1 }])
  )
  for (const item of detected.items) {
    const already = items.get(item.label)
    // The freshly detected item wins on `toNodeId`/`trigger` — a later reading resolves against
    // everything the sweep has learned since — while the count carries forward, because what is
    // being counted is how often this control has been seen, not how often this record was written.
    items.set(item.label, { ...item, sightings: (already?.sightings ?? 0) + 1 })
  }
  // Deliberately NOT filtered here. Dropping an uncorroborated item at merge time also drops its
  // count, so an item first seen on the second sighting would be erased before the third sighting
  // could confirm it, re-added at one, and erased again — it could never reach the bar no matter
  // how many times the chrome showed it. The record keeps every item it has ever seen, along with
  // how often; `corroboratedChromeItems` is where the bar is applied, at the point of use.
  const merged: AppFlowChrome = {
    ...match,
    items: [...items.values()],
    sightings: (match.sightings ?? 1) + 1,
    observedAt: detected.observedAt,
    structureRevision: detected.structureRevision,
    reveal: detected.reveal.length ? detected.reveal : match.reveal
  }
  return existing.map((chrome) => (chrome === match ? merged : chrome))
}

function firstSighting(item: AppFlowChromeItem): AppFlowChromeItem {
  return { ...item, sightings: 1 }
}

/**
 * The items of `chrome` that repeat sightings agree actually belong to it — see
 * `MIN_CHROME_ITEM_SIGHTINGS` and `MIN_CHROME_ITEM_SIGHTING_RATIO`. This is what any consumer that treats a chrome as navigation should
 * read instead of `chrome.items`: the record itself keeps the full, honest observation history
 * (including how often each control was seen), and this is the view of it worth drawing an edge
 * from.
 *
 * A chrome seen only once has nothing to corroborate against, so all of its items are returned — a
 * single sighting is the one case where "seen once" carries no information either way, and the
 * deliberate entry-chrome pass (`orchestrator.ts`), which opens a drawer on purpose and reads it,
 * is exactly that case. Items with no `sightings` at all come from a document written before the
 * field existed and are likewise kept rather than silently erased.
 */
export function corroboratedChromeItems(chrome: AppFlowChrome): AppFlowChromeItem[] {
  const sightings = chrome.sightings ?? 1
  if (sightings < 2) return [...chrome.items]
  // Whichever bar is higher. The ratio is what scales with a long sweep; the flat minimum is what
  // keeps a twice- or thrice-sighted chrome from admitting an item on a single sighting, which a
  // ratio alone would (half of two rounds to one).
  const required = Math.max(
    MIN_CHROME_ITEM_SIGHTINGS,
    Math.ceil(sightings * MIN_CHROME_ITEM_SIGHTING_RATIO)
  )
  // An item still carrying no count inside a multiply-sighted record cannot occur through
  // `mergeChromeInventory`, which seeds every carried-forward item to 1 — but a hand-built or
  // hand-edited document could produce one, and reading it as 0 would delete it on a technicality.
  return chrome.items.filter((item) => (item.sightings ?? 1) >= required)
}

/** The locator a chrome's reveal sequence presses, or null for an always-visible chrome. */
function revealLocator(chrome: AppFlowChrome): AppFlowTrigger | null {
  return chrome.reveal.find((step) => 'locator' in step && step.locator)?.locator ?? null
}

function showsControl(node: AppFlowNode, locator: AppFlowTrigger): boolean {
  return (node.capture?.pressables ?? []).some((pressable) => {
    if (locator.by === 'id') return pressable.identifier === locator.value
    if (locator.by === 'label') return pressable.label === locator.value
    return pressable.text === locator.value
  })
}

/**
 * Least number of distinct screens a chrome's own controls must be seen on before it is treated as
 * a navigator surface at all.
 *
 * `detectChromeInventory` reads a whole frame rather than a cropped navigator, so any screen
 * showing three pressables whose labels token-match three known routes is recorded as a chrome. On
 * a content-heavy app that fires constantly, and `MIN_CHROME_ITEM_SIGHTING_RATIO` cannot catch it:
 * an overflow menu re-read eight times on the same screen has items sighted 8 of 8 times, which is
 * perfect corroboration of something that is not chrome. A Bluesky sweep recorded five `tabs`
 * records for an app with one tab bar — the real one plus a conversation overflow menu
 * (`Mute conversation`, `Block account`), a profile context menu and a list context menu, each a
 * repeat reading of one screen's own content.
 *
 * What separates them is not how often a surface was seen but how many *different* screens it was
 * seen on, which is the definition of navigator chrome: furniture the app carries between screens,
 * rather than controls belonging to one of them. Measured against that sweep's own captures the
 * two populations do not overlap at all — the tab bar appears on 57 screens and the drawer's
 * hamburger on 5, while the three phantoms appear on 1, 0 and 0. Two is therefore a deliberately
 * low bar: it only has to be more than one, and everything real clears it by an order of magnitude.
 */
const MIN_CHROME_SITES = 2

/**
 * The screens whose own captured controls show this chrome — the evidence that it is a surface the
 * app carries between screens rather than one screen's content.
 *
 * Read two different ways, because the two kinds of chrome leave different traces. A chrome with a
 * reveal gesture (a drawer) is shown by any screen whose capture includes the control that opens
 * it. An always-visible chrome (a tab bar) has no opener to look for, so it is shown by any screen
 * whose capture includes enough of its own corroborated items — `MIN_SHARED_CHROME_ITEMS`, the same
 * bar `sameChrome` uses to decide two sightings are one surface, and for the same reason: one
 * coincidental label is not a tab bar.
 *
 * Both readings run off `node.capture.pressables`, which the sweep already recorded per screen, so
 * this needs no extra device work and re-derives correctly for documents captured before it
 * existed.
 */
export function chromeSites(chrome: AppFlowChrome, nodes: readonly AppFlowNode[]): string[] {
  const locator = revealLocator(chrome)
  if (locator) {
    return nodes
      .filter((node) => node.id !== chrome.id && showsControl(node, locator))
      .map((node) => node.id)
  }
  const triggers = corroboratedChromeItems(chrome).map((item) => item.trigger)
  return nodes
    .filter(
      (node) =>
        node.id !== chrome.id &&
        triggers.filter((trigger) => showsControl(node, trigger)).length >= MIN_SHARED_CHROME_ITEMS
    )
    .map((node) => node.id)
}

/**
 * The subset of `chrome` that the captures prove is really a navigator surface — see
 * `MIN_CHROME_SITES`.
 *
 * Applied where chrome is turned into nodes and edges, never where it is recorded: exactly like
 * `corroboratedChromeItems`, the record itself keeps the full, honest observation history and the
 * bar is applied at the point of use. Filtering at merge time instead would throw away the
 * sightings a surface needs in order to eventually clear the bar.
 *
 * Callers must pass this same filtered list to both `chromeVirtualNodes` and `rebuildChromeEdges`.
 * Filtering one and not the other leaves either a node nothing points at or, worse, edges leaving
 * an id that has no node.
 */
export function navigatorChrome(
  chrome: readonly AppFlowChrome[],
  nodes: readonly AppFlowNode[]
): AppFlowChrome[] {
  return chrome.filter((record) => chromeSites(record, nodes).length >= MIN_CHROME_SITES)
}

/**
 * The `screen -> chrome` reveal edges a chrome record justifies, one per screen that can actually
 * open it.
 *
 * A chrome used to get exactly one reveal edge, from `entryNodeId` — whichever screen the sweep
 * happened to first detect it on. For a surface that is reachable from many screens that is not
 * merely imprecise, it is the difference between a connected graph and an orphaned one. On a real
 * Bluesky sweep the drawer was first opened from `DebugMod`, a debug screen nothing else links to,
 * so the entire drawer — 8 corroborated items, and with them the whole Settings and Moderation
 * subtree, 31 screens — hung off a node no walk could reach. Reachability from the app's tab roots
 * measured 22 of 82 with the drawer attached there and 53 of 82 with it attached to the tab roots
 * that genuinely show its hamburger.
 *
 * The fix is not to guess a better single entry but to stop guessing: a screen can open this chrome
 * if that screen's own captured controls include the one the reveal sequence presses.
 *
 * An always-visible chrome gets no reveal edge at all. There is no gesture to record, and the
 * honest reading of a bar that is on screen from the moment the app launches is that it is where
 * navigation starts — so it is left with no inbound edge and becomes a root of the map, rather than
 * being hung off whichever screen happened to sight it first. That fallback was actively wrong: it
 * published `HomeTab/Home -> chrome:tabs:HomeTab/Home` beside the tab bar's own edge back to
 * `HomeTab/Home`, a two-node cycle asserting that you reach the tab bar by being on Home.
 */
export function chromeRevealEdges(
  chrome: AppFlowChrome,
  nodes: readonly AppFlowNode[]
): AppFlowEdge[] {
  const locator = revealLocator(chrome)
  if (!locator) return []
  const evidence: AppFlowEdgeEvidence = {
    structureRevision: chrome.structureRevision,
    observedAt: chrome.observedAt,
    verified: false,
    chromeId: chrome.id
  }
  return chromeSites(chrome, nodes).map((source) => ({
    from: source,
    to: chrome.id,
    raw: `reveal "${chrome.id}"`,
    target: null,
    trigger: locator,
    origin: 'runtime-chrome' as const,
    kind: 'reveal' as const,
    evidence
  }))
}

/**
 * Re-derives every `runtime-chrome` edge from the chrome records and the nodes' captures, leaving
 * `runtime-walk` edges untouched.
 *
 * Chrome edges are a pure function of the chrome records plus what each screen was seen to show, so
 * deriving them beats accumulating them. During a sweep they cannot be: each sighting publishes its
 * edges immediately, against a record that has only been sighted once, so `corroboratedChromeItems`
 * has nothing to judge against and every item it has ever seen gets an edge. Those edges then
 * outlive the evidence — an item later sightings refute has already been written, and nothing goes
 * back for it. That is how a five-item tab bar shipped 43 item edges. Running this at result
 * assembly (and again on read, for documents written before it existed) settles the whole set
 * against the finished record in one pass, so what the graph shows is what the sweep concluded
 * rather than what it guessed on the way.
 */
export function rebuildChromeEdges(
  runtimeEdges: readonly AppFlowEdge[],
  chrome: readonly AppFlowChrome[],
  nodes: readonly AppFlowNode[]
): AppFlowEdge[] {
  const kept = runtimeEdges.filter((edge) => edge.origin !== 'runtime-chrome')
  const derived = chrome.flatMap((record) => [
    ...chromeRevealEdges(record, nodes),
    ...chromeEdges(record).filter((edge) => edge.kind !== 'reveal')
  ])
  return [...kept, ...derived]
}
