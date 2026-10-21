import { z } from "zod";

/**
 * The one finding a reader opened, carried whole to the embedded explorer.
 *
 * The card's frame cannot reach the TraceSift service — Codex strips plain-HTTP
 * origins from a widget's CSP — so megabytes of call tree ride the MCP bridge.
 * They travel as a gzip-compressed base64 text item rather than
 * `structuredContent`: the host's decoder and both schema validators walk a
 * structured payload node by node, while a compressed string crosses as one
 * opaque value the iframe inflates and parses once. See `docs/architecture.md`.
 */
export const traceSiftExploreEnvelopeSchema = z.object({
  apiVersion: z.literal(1),
  kind: z.enum(["task", "react"]),
  encoding: z.enum(["json", "gzip+base64"]),
  /** JSON bytes before compression, which is the figure the size gauge reports. */
  payloadBytes: z.number().int().nonnegative(),
});
export type TraceSiftExploreEnvelope = z.infer<typeof traceSiftExploreEnvelopeSchema>;
export type TraceSiftExploreKind = TraceSiftExploreEnvelope["kind"];

/** Above this, the JSON always travels compressed. Below it, plain. */
export const TRACE_SIFT_PAYLOAD_GZIP_MIN_BYTES = 64 * 1024;

/**
 * Past this, the explorer gives up before decoding. The service caps its own
 * trees (60k nodes, 5k commits), so exceeding this is a runaway recording the
 * browser window renders without crossing a bridge at all.
 */
export const TRACE_SIFT_PAYLOAD_MAX_BYTES = 24 * 1024 * 1024;

/**
 * Past this nesting depth the payload goes to the browser instead.
 * `JSON.stringify` recurses, so a pathological tree overflows the stack before
 * any byte-size guard can see it; real call trees sit in the low hundreds.
 */
export const TRACE_SIFT_PAYLOAD_MAX_DEPTH = 1024;

/** Walks `value` with an explicit stack, so measuring depth cannot itself overflow. */
export function traceSiftPayloadTooDeep(value: unknown, maxDepth = TRACE_SIFT_PAYLOAD_MAX_DEPTH): boolean {
  const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (typeof node !== "object" || node === null) continue;
    if (depth >= maxDepth) return true;
    for (const child of Array.isArray(node) ? node : Object.values(node)) {
      if (typeof child === "object" && child !== null) stack.push({ node: child, depth: depth + 1 });
    }
  }
  return false;
}

export function decodeTraceSiftExplorePayload(result: { content?: unknown }, envelope: TraceSiftExploreEnvelope): Promise<unknown> {
  const first = Array.isArray(result.content) ? result.content[0] : undefined;
  const text = typeof first === "object" && first !== null && "type" in first && first.type === "text"
    && "text" in first && typeof first.text === "string" ? first.text : undefined;
  if (text === undefined) return Promise.reject(new Error("TraceSift did not return the data this explorer needs."));
  return decodePayloadText(text, envelope.encoding);
}

async function decodePayloadText(text: string, encoding: TraceSiftExploreEnvelope["encoding"]): Promise<unknown> {
  try {
    if (encoding === "json") return JSON.parse(text);
    const bytes = Uint8Array.from(atob(text), character => character.charCodeAt(0));
    const inflated = new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")));
    return JSON.parse(await inflated.text());
  } catch {
    throw new Error("TraceSift returned Explore data the card could not read.");
  }
}

/**
 * The class on the element holding the embedded explorer, and the scope
 * `scripts/explore-css.mjs` folds the Explore stylesheet's theme tokens under.
 * A contract across the build boundary: both sides read it from here, and
 * `tests/tracesift-explore-css.test.ts` fails if the fold stops matching.
 */
export const TRACE_SIFT_EXPLORE_CLASS = "tracesift-explorer";
