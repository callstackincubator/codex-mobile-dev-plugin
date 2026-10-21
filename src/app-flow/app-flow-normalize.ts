/**
 * Back-compat normalization for a document read from `app-flow.json` — factored out of
 * `readAppFlow` (`storage.ts`) purely so it has a unit test: `storage.ts` value-imports `electron`,
 * which loads the instant anything imports that module, so this logic could not otherwise run under
 * plain `node --test`.
 *
 * Every new field Step 4 added is defaulted here value-driven — following the pre-existing
 * `node.urlPath ?? null` pattern this function also carries forward — rather than gated on
 * `manifest.formatVersion`. A build that is interrupted mid-write can leave a document whose
 * manifest already claims a v4 `formatVersion` but whose nodes/edges predate this round; defaulting
 * on whether each field is actually present is correct in that case, where branching on the version
 * number would not be. A v3 document normalized here becomes a v4 document with empty runtime
 * state, which is exactly right: a v3 sweep observed none of it.
 */
import type { AppFlowResult } from '../shared/app-flow.ts'
import {
  inferChromeKind,
  looksLikeChromeCaption,
  navigatorChrome,
  rebuildChromeEdges
} from './reach/chrome-inventory.ts'

export function normalizeAppFlow(result: AppFlowResult): AppFlowResult {
  // Two repairs beyond the `kind` back-fill, both applied on read so a document written by an
  // earlier sweep heals instead of carrying its damage into every consumer that opens it.
  //
  // Items are re-filtered through `looksLikeChromeCaption`. That guard did not exist when these
  // documents were written, and without it a real sweep recorded 97 items for one tab bar — whole
  // post bodies matched against node vocabulary by token overlap, so that a feed caption about
  // budget legislation was persisted as the control that opens `Support`. Re-running the guard
  // here costs a string length check per item and removes every one of them.
  //
  // Records are deduped by id because a chrome id doubles as a graph node id now
  // (`chromeVirtualNodes`), and a document written before `sameChrome` settled identical ids can
  // hold two records under one — a real sweep produced two `chrome:tabs:MessagesConversation`.
  // First wins: the earlier sighting is the one whose provenance the id already describes.
  const healed = dedupeById(
    (result.chrome ?? []).map((chrome) => ({
      ...chrome,
      kind: chrome.kind ?? inferChromeKind(chrome.reveal),
      items: chrome.items.filter((item) => looksLikeChromeCaption(item.label))
    }))
  )
  const allNodes = result.nodes.map((node) => ({
    ...node,
    urlPath: node.urlPath ?? null,
    reach: node.reach ?? (node.urlPath ? 'deep-link' : 'navigation-only'),
    deepLinkRejection: node.deepLinkRejection ?? null,
    origin: node.origin ?? 'parsed'
  }))
  // Which of the recorded surfaces the screens' own captures corroborate — see `navigatorChrome`.
  // The `chrome` array itself keeps every record it ever had, honest observation history and all;
  // this is only about which of them earn a node and edges, and it has to be recomputed on read
  // because a document written before `navigatorChrome` existed has virtual nodes for surfaces that
  // were never navigator chrome at all — a conversation's overflow menu persisted as "Tab bar".
  const navigators = navigatorChrome(healed, allNodes)
  const navigatorIds = new Set(navigators.map((chrome) => chrome.id))
  const nodes = allNodes.filter((node) => node.origin !== 'chrome' || navigatorIds.has(node.id))
  return {
    ...result,
    manifest: {
      ...result.manifest,
      formatVersion: Math.max(result.manifest.formatVersion ?? 1, 1)
    },
    nodes,
    edges: result.edges.map((edge) => ({
      ...edge,
      origin: edge.origin ?? 'parsed'
    })),
    // Filtered to the surfaces the captures corroborate, exactly as the sweep's own assembly does
    // (`orchestrator.ts`) — a document written before `navigatorChrome` existed carries records for
    // context menus that were never navigator chrome, and they must not survive a read.
    runtimeEdges: rebuildChromeEdges(result.runtimeEdges ?? [], navigators, nodes),
    // Per-item, like `node.origin` above, not just defaulting the whole array to `[]`: a document
    // can have a real, non-empty `chrome` array and still predate the `kind` field on each entry.
    // `inferChromeKind` is the same reveal-length rule a fresh detection already uses, so a
    // back-filled record compares identically under `sameChrome` (`reach/chrome-inventory.ts`) to one
    // that carried `kind` from the start.
    // Two repairs beyond the `kind` back-fill, both applied on read so a document written by an
    // earlier sweep heals instead of carrying its damage into every consumer that opens it.
    //
    // Items are re-filtered through `looksLikeChromeCaption`. That guard did not exist when these
    // documents were written, and without it a real sweep recorded 97 items for one tab bar —
    // whole post bodies matched against node vocabulary by token overlap, so that a feed caption
    // about budget legislation was persisted as the control that opens `Support`. Re-running the
    // guard here costs a string length check per item and removes every one of them.
    //
    // Records are deduped by id because a chrome id doubles as a graph node id now
    // (`chromeVirtualNodes`), and a document written before `sameChrome` settled identical ids can
    // hold two records under one — a real sweep produced two `chrome:tabs:MessagesConversation`.
    // First wins: the earlier sighting is the one whose provenance the id already describes.
    chrome: healed,
    navigation: result.navigation ?? null
  }
}

function dedupeById<T extends { id: string }>(records: T[]): T[] {
  const seen = new Set<string>()
  return records.filter((record) => {
    if (seen.has(record.id)) return false
    seen.add(record.id)
    return true
  })
}
