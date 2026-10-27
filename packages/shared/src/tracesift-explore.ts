import { z } from "zod";

/**
 * One finding, carried whole to the explorer over the MCP bridge as compressed
 * text — `structuredContent` would be walked node by node by three validators.
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
 * What the payload tool answers with when a finding cannot cross the bridge.
 * The card reads it to fall back to the browser window, so both sides name it
 * here rather than matching prose.
 */
export const TRACE_SIFT_PAYLOAD_TOO_LARGE = "This finding is larger than the panel can open.";

/** Whether a failed payload call is the size refusal rather than a real fault. */
export function traceSiftPayloadRefused(message: string): boolean {
  return message.includes(TRACE_SIFT_PAYLOAD_TOO_LARGE);
}

/**
 * Past this the explorer gives up before decoding. The service caps its trees
 * (60k nodes, 5k commits), so more than this is one for the browser window.
 */
export const TRACE_SIFT_PAYLOAD_MAX_BYTES = 24 * 1024 * 1024;

/**
 * Past this depth the payload goes to the browser instead: `JSON.stringify`
 * recurses, so a runaway tree overflows before the byte guard can see it.
 *
 * Counted in object levels, not call frames: a tree node and its `children`
 * array are two levels each, so a 900-frame stack — ordinary for a React Native
 * recording — measures about 1900. V8 serializes to roughly 6000 levels, so
 * this sits between the real recordings and the cliff. The serializer is
 * guarded against overflow in its own right, so this bound only decides where
 * a runaway tree is turned away.
 */
export const TRACE_SIFT_PAYLOAD_MAX_DEPTH = 4096;

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
 * The explorer's container class, and the scope `tooling/explore-css.mjs` folds
 * its theme tokens under. `tracesift-explore-css.test.ts` guards the pair.
 */
export const TRACE_SIFT_EXPLORE_CLASS = "tracesift-explorer";
