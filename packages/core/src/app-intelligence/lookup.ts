import type { AppIntelQuery, AppIntelSnapshot, IntelEdge, IntelRef } from "@mobile-dev/shared/app-intelligence.ts";
import { fileRef, screenRef } from "@mobile-dev/shared/app-intelligence.ts";

const MAX_BYTES = 8000;
const screenItem = (id: string, snapshot: AppIntelSnapshot) => ({ kind: "screen", id, ...snapshot.screens[id] });
const edgeItem = (edge: IntelEdge) => ({ kind: "relationship", from: edge.from, to: edge.to, relationship: edge.kind, platforms: edge.platforms, specifier: edge.specifier });

export function lookupAppIntel(snapshot: AppIntelSnapshot, input: AppIntelQuery) {
  const query = input.query.toLowerCase();
  const items: Record<string, unknown>[] = [];
  let start: IntelRef | undefined;
  let note: string | undefined;
  if (input.operation === "file") {
    if (snapshot.files[input.query]) start = fileRef(input.query);
    else note = "File not found. Search for its project-relative path.";
  } else if (input.operation === "screen") {
    const hits = snapshot.screens[input.query] ? [input.query] : snapshot.indexes.screens[query] ?? [];
    if (hits.length === 1) start = screenRef(hits[0]);
    else { note = hits.length ? "Ambiguous screen. Use one of these exact IDs." : "Screen not found. Search by title or route."; for (const id of hits) items.push(screenItem(id, snapshot)); }
  } else {
    for (const [id, screen] of Object.entries(snapshot.screens)) if (`${id} ${screen.title} ${screen.route ?? ""}`.toLowerCase().includes(query)) items.push(screenItem(id, snapshot));
    for (const [path, file] of Object.entries(snapshot.files)) if (path.toLowerCase().includes(query)) items.push({ kind: "file", path, fileKind: file.kind });
  }
  if (start) {
    const queue: Array<[IntelRef, number]> = [[start, 0]];
    const visited = new Set<IntelRef>();
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const [ref, distance] = queue[cursor]; if (visited.has(ref)) continue; visited.add(ref);
      if (ref.startsWith("screen:")) items.push(screenItem(ref.slice(7), snapshot));
      else if (ref.startsWith("file:")) items.push({ kind: "file", path: ref.slice(5), fileKind: snapshot.files[ref.slice(5)]?.kind ?? "source" });
      else items.push({ kind: "package", name: ref.slice(8) });
      const ids = input.direction === "incoming" ? snapshot.indexes.incoming[ref] ?? [] : input.direction === "outgoing" ? snapshot.indexes.outgoing[ref] ?? [] : [...(snapshot.indexes.incoming[ref] ?? []), ...(snapshot.indexes.outgoing[ref] ?? [])];
      for (const id of new Set(ids)) {
        const edge = snapshot.edges[id];
        const ownership = edge.kind === "source" || edge.kind === "layout";
        if (!ownership && distance >= input.depth) continue;
        items.push(edgeItem(edge));
        const next = edge.from === ref ? edge.to : edge.from; if (next) queue.push([next, ownership ? distance : distance + 1]);
      }
    }
  }
  const unique = [...new Map(items.map(item => [JSON.stringify(item), item])).values()];
  const page = { meta: snapshot.meta, summary: { files: Object.keys(snapshot.files).length, screens: Object.keys(snapshot.screens).length, packages: Object.keys(snapshot.packages).length, diagnostics: snapshot.diagnostics.length }, items: [] as Record<string, unknown>[], total: unique.length, nextOffset: null as number | null, note };
  let cursor = input.offset;
  while (cursor < unique.length && page.items.length < input.limit) {
    page.items.push(unique[cursor]);
    if (Buffer.byteLength(JSON.stringify(page)) > MAX_BYTES) { page.items.pop(); break; }
    cursor++;
  }
  page.nextOffset = cursor < unique.length ? cursor : null;
  return page;
}

