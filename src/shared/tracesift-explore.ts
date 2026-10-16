import { z } from "zod";

/**
 * The one finding a reader opened, carried whole to the embedded explorer.
 *
 * A full task card is its call tree and timeline, which run to megabytes on a
 * real recording, and the card's frame cannot reach the TraceSift service
 * itself: Codex strips plain-HTTP origins from a widget's CSP, so the payload
 * has to ride the MCP bridge like everything else here.
 *
 * It travels as a gzip-compressed base64 text item rather than as
 * `structuredContent`. The bridge's known weak point is deep and large
 * *structured* payloads — the host's decoder and the schema validators on both
 * ends walk them node by node, and `docs/architecture.md` records a host that
 * discarded a deep runtime tree outright — while a compressed string crosses as
 * one opaque value the iframe inflates and parses once into the shapes it
 * draws. The spike behind this choice measured 25 MB of tree at 8 ms of bridge
 * time and a fifth of the wire bytes, against 120 ms and a third more bytes for
 * plain JSON. Small payloads stay plain: below the threshold, compression buys
 * nothing and an uncompressed reading of the same tool result keeps working.
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
 * trees (60k nodes, 5k commits), so exceeding this is a runaway recording, and
 * the browser window renders those without crossing a bridge at all.
 */
export const TRACE_SIFT_PAYLOAD_MAX_BYTES = 24 * 1024 * 1024;

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
 * The class on the element that holds the embedded explorer, which is also the
 * scope the Explore stylesheet's theme tokens are folded under.
 *
 * `scripts/explore-css.mjs` rewrites the package's `:root` and `.dark` token
 * blocks onto this class so they reach the explorer's descendants without
 * repainting the plugin's own cards. That makes the class a contract across the
 * build boundary: rename it on one side and every TraceSift rule reading
 * `var(--primary)`, `var(--success)` or `var(--muted)` falls back to the plugin's
 * grey card theme, drawing an unreadable Explore while the build stays green.
 * Both sides name it here, and `tests/tracesift-explore-css.test.ts` fails if the
 * folded sheet ever stops scoping to what is actually rendered.
 */
export const TRACE_SIFT_EXPLORE_CLASS = "tracesift-explorer";
