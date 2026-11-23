import { Er as MessageExtraInfo, J as Transport, Tr as MessageClassification, Y as TransportSendOptions, _ as Server, a as McpServer, er as JSONRPCMessage, nr as JSONRPCRequest, tr as JSONRPCNotification, zt as AuthInfo } from "./mcp-DbUPMDd5.cjs";

//#region src/server/perRequestTransport.d.ts

/**
 * How the transport shapes its HTTP response for a request:
 *
 * - `auto` (default): answer with a single JSON body unless the handler emits
 *   a related message before its result, in which case the response upgrades
 *   to an SSE stream.
 * - `sse`: always answer handler output over an SSE stream. The stream opens
 *   once the request has passed the pre-dispatch validation gates, so ladder
 *   rejections keep their mapped HTTP status instead of being framed onto a
 *   200 stream.
 * - `json`: never stream; related messages other than the terminal response
 *   are dropped.
 */
type PerRequestResponseMode = 'auto' | 'sse' | 'json';
/** Constructor options for {@linkcode PerRequestHTTPServerTransport}. */
interface PerRequestHTTPServerTransportOptions {
  /** The edge classification of the message this transport will serve. */
  classification: MessageClassification;
  /** Response shaping for the exchange; defaults to `auto`. */
  responseMode?: PerRequestResponseMode;
  /** SSE keep-alive interval in milliseconds; defaults to `15000`, `0` disables. */
  keepAliveMs?: number;
}
/** Per-exchange context handed to {@linkcode PerRequestHTTPServerTransport.handleMessage}. */
interface PerRequestMessageExtra {
  /**
   * The original HTTP request. Used for handler context and, when the
   * runtime provides an abort signal on it, to cancel the exchange when the
   * client disconnects.
   */
  request?: globalThis.Request;
  /**
   * Validated authentication information supplied by the caller. Strictly
   * pass-through: the transport never populates this from request headers.
   */
  authInfo?: AuthInfo;
}
/**
 * The per-request micro-transport: a real, connected `Transport` whose whole
 * lifetime is one HTTP exchange. See the module documentation for the
 * response shapes it produces.
 *
 * Connecting a `Server` binds the instance to the classified modern revision
 * when its `supportedProtocolVersions` lists it and the SDK implements it.
 */
declare class PerRequestHTTPServerTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;
  private readonly _classification;
  private readonly _responseMode;
  private _started;
  private _used;
  private _closed;
  private _terminalDelivered;
  /**
   * `true` only while the inbound message is being delivered synchronously
   * to the connected protocol layer. The pre-handler gates (the era
   * registry gate, the edge→instance handoff check, the missing-handler
   * rejection) answer inside this window; request handlers always run
   * after it (the protocol layer defers them to a microtask). An error
   * sent inside the window is therefore ladder-originated, and an error
   * sent after it is handler-produced.
   */
  private _dispatchWindowOpen;
  private _requestId?;
  private _deferredResponse?;
  private _sse?;
  private _abortCleanup?;
  private readonly _keepAliveMs;
  constructor(options: PerRequestHTTPServerTransportOptions);
  start(): Promise<void>;
  /**
   * Serves the single exchange: delivers the classified message to the
   * connected server instance and resolves with the HTTP response.
   *
   * Throws when called a second time (the transport is strictly
   * single-use), or before a server has been connected to the transport.
   * The returned promise rejects with a connection-closed error when the
   * transport is closed before a response was produced (for example because
   * the client disconnected).
   */
  handleMessage(message: JSONRPCRequest | JSONRPCNotification, extra?: PerRequestMessageExtra): Promise<Response>;
  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void>;
  /**
   * Writes an SSE comment frame (a keep-alive heartbeat). Dropped when the
   * exchange is not currently streaming.
   */
  writeCommentFrame(comment: string): void;
  close(): Promise<void>;
  private settleResponse;
  private upgradeToSse;
  private finalizeStream;
  private writeMessageFrame;
  private writeFrame;
}
//#endregion
//#region src/server/serverEventBus.d.ts
/**
 * A change event a server publishes for delivery on open `subscriptions/listen`
 * streams. Each variant maps onto exactly one notification method:
 *
 * - `tools_list_changed` → `notifications/tools/list_changed`
 * - `prompts_list_changed` → `notifications/prompts/list_changed`
 * - `resources_list_changed` → `notifications/resources/list_changed`
 * - `resource_updated` → `notifications/resources/updated` (carries the URI)
 *
 * The bus carries the event and any forwarded notification params — the
 * entry's listen router owns subscription-id stamping and per-stream filtering.
 */
type ServerEvent = ({
  kind: 'tools_list_changed';
} | {
  kind: 'prompts_list_changed';
} | {
  kind: 'resources_list_changed';
} | {
  kind: 'resource_updated';
  uri: string;
}) & {
  /** Forwarded notification params; the router stamps its own subscription ID and the event's resource URI. */
  params?: JSONRPCNotification['params'];
};
/**
 * The server-side change-event seam for `subscriptions/listen`.
 *
 * The serving entry (`createMcpHandler`) owns the per-stream listen router:
 * each open `subscriptions/listen` stream registers a listener via
 * `subscribe()`, and consumer code (typically via `handler.notify.*` sugar)
 * publishes change events via `publish()`. In-process servers can use the
 * default {@linkcode InMemoryServerEventBus}; multi-process deployments
 * implement this interface over their own pub/sub.
 *
 * The SDK owns wire semantics (ack-first, filtering, subscription-id
 * stamping, teardown); a `ServerEventBus` only sources the events. It MUST
 * NOT echo back to the listener that published an event when called from
 * inside that listener (no surprise here — the default delivers
 * synchronously and listeners never publish).
 */
interface ServerEventBus {
  /**
   * Publish a change event to every registered listener.
   */
  publish(event: ServerEvent): void;
  /**
   * Register a listener; returns an idempotent unsubscribe function.
   */
  subscribe(listener: (event: ServerEvent) => void): () => void;
}
/**
 * A `ServerEventBus` backed by an in-process listener set.
 *
 * `publish()` delivers synchronously to the live listener set (a listener
 * unsubscribing itself mid-dispatch is safe; the entry's listen-router
 * listeners never unsubscribe peers). A throwing listener does not stop
 * delivery to the others.
 */
declare class InMemoryServerEventBus implements ServerEventBus {
  private readonly onerror?;
  private readonly _listeners;
  /**
   * @param onerror - Optional callback for errors thrown by listeners
   *   during dispatch.
   */
  constructor(onerror?: ((error: Error) => void) | undefined);
  publish(event: ServerEvent): void;
  subscribe(listener: (event: ServerEvent) => void): () => void;
  /** The number of currently registered listeners (test/introspection only — the routers track capacity via their own open-subscription set). */
  get listenerCount(): number;
}
/**
 * Typed publish-side facade over `bus.publish` returned by `createMcpHandler`:
 * each method publishes the corresponding {@linkcode ServerEvent}. Prefer this
 * over calling `bus.publish` directly — the names match the wire methods.
 */
interface ServerNotifier {
  /** Publish `notifications/tools/list_changed` to every open subscription that opted in. */
  toolsChanged(): void;
  /** Publish `notifications/prompts/list_changed` to every open subscription that opted in. */
  promptsChanged(): void;
  /** Publish `notifications/resources/list_changed` to every open subscription that opted in. */
  resourcesChanged(): void;
  /** Publish `notifications/resources/updated` for `uri` to every open subscription that opted in to that URI. */
  resourceUpdated(uri: string): void;
}
//#endregion
//#region src/server/createMcpHandler.d.ts
/**
 * Construction context handed to an {@linkcode McpServerFactory}.
 *
 * Both serving entries call the factory with this context whenever they need
 * a fresh instance: {@linkcode createMcpHandler} once per HTTP request, and
 * `serveStdio` (from `@modelcontextprotocol/server/stdio`) once per
 * connection — plus once for a `server/discover` probe instance that is
 * discarded again if the client falls back to `initialize`.
 *
 * Zero-argument factories remain assignable unchanged; the context exists for
 * factories that vary by principal or era (for example multi-tenant servers
 * keyed off `authInfo`, or a factory that registers extra surface only for one
 * era).
 */
interface McpRequestContext {
  /**
   * The protocol era the constructed instance will serve: `modern` for
   * 2026-07-28 (per-request envelope) traffic, `legacy` for 2025-era
   * traffic. Under {@linkcode createMcpHandler} a `legacy` instance serves
   * one request through the stateless legacy fallback (the default —
   * `legacy: 'reject'` endpoints are strict and never construct one); under
   * `serveStdio` it serves a connection that opened with the 2025 handshake
   * and stays pinned to that era for its lifetime.
   */
  era: 'legacy' | 'modern';
  /**
   * Validated authentication information passed by the caller of the
   * handler face (pass-through; HTTP only — `serveStdio` never sets it).
   */
  authInfo?: AuthInfo;
  /** The original HTTP request being served, when available (HTTP only — `serveStdio` never sets it). */
  requestInfo?: Request;
}
/**
 * A factory producing a fresh {@linkcode McpServer} (or low-level
 * {@linkcode Server}) instance for one serving unit: one HTTP request under
 * {@linkcode createMcpHandler}, or one connection (or one discarded
 * `server/discover` probe) under `serveStdio`. The same factory backs every
 * era either entry serves — define your tools, resources and prompts once and
 * serve them to both eras.
 */
type McpServerFactory = (ctx: McpRequestContext) => McpServer | Server | Promise<McpServer | Server>;
/** Caller-provided per-request inputs for {@linkcode McpHttpHandler.fetch} and fetch-shaped legacy handlers ({@linkcode LegacyHttpHandler}). */
interface McpHandlerRequestOptions {
  /**
   * Validated authentication information for the request. Strictly
   * pass-through: the handler never populates this from request headers and
   * performs no token verification of its own.
   */
  authInfo?: AuthInfo;
  /** A pre-parsed JSON request body (e.g. `req.body` from `express.json()`). */
  parsedBody?: unknown;
}
/**
 * A fetch-shaped handler serving 2025-era traffic: the shape produced by
 * {@linkcode legacyStatelessFallback}, and the shape a hand-wired composition
 * routes legacy requests to (see {@linkcode isLegacyRequest}). It is not a
 * `legacy` option value — the entry's own legacy serving is selected by the
 * `'stateless' | 'reject'` posture only.
 */
type LegacyHttpHandler = (request: Request, options?: McpHandlerRequestOptions) => Promise<Response>;
/** Options for {@linkcode createMcpHandler}. */
interface CreateMcpHandlerOptions {
  /**
   * How 2025-era (non-envelope) traffic is served:
   *
   * - `'stateless'` (the default, also when the option is omitted) —
   *   old-school stateless serving: each legacy request is answered by a
   *   fresh instance from the same factory over a streamable HTTP transport
   *   constructed with only `sessionIdGenerator: undefined` (the established
   *   stateless idiom). Because serving is per-request and stateless, GET and
   *   DELETE (2025 session operations) are answered with `405` /
   *   `Method not allowed.`.
   * - `'reject'` — modern-only strict: legacy-classified requests are
   *   rejected with the unsupported-protocol-version error naming the
   *   endpoint's supported revisions (legacy-classified notifications are
   *   acknowledged with `202` and dropped). **There is no 2025 serving in
   *   this mode.**
   *
   * There is no handler-valued option: to keep an existing legacy deployment
   * (for example a sessionful streamable HTTP wiring) serving 2025 traffic
   * next to this entry, route in user land with {@linkcode isLegacyRequest}
   * in front of a `legacy: 'reject'` handler — see that predicate's
   * documentation for the pattern.
   */
  legacy?: 'stateless' | 'reject';
  /** Callback for out-of-band errors and rejected requests (reporting only; it never alters the response). */
  onerror?: (error: Error) => void;
  /**
   * Response shaping for modern (2026-07-28) request exchanges:
   *
   * - `'auto'` (default) — a single JSON body unless the handler emits a
   *   related message before its result, in which case the response upgrades
   *   to an SSE stream.
   * - `'sse'` — always stream.
   * - `'json'` — never stream. **Mid-call notifications (progress, logging,
   *   any related message emitted before the result) are dropped** — only the
   *   terminal result is delivered. Listen-class subscription streams are
   *   always served over SSE regardless of this setting.
   */
  responseMode?: PerRequestResponseMode;
  /**
   * The change-event bus `subscriptions/listen` streams subscribe to.
   *
   * When omitted, an in-process {@link InMemoryServerEventBus} is created
   * and the returned handler's `notify` sugar publishes onto it.
   * Multi-process deployments supply their own implementation over their
   * pub/sub backend; the same instance can be shared across handlers.
   */
  bus?: ServerEventBus;
  /**
   * Reject a new `subscriptions/listen` with `-32603` 'Subscription limit
   * reached' (in-band, HTTP 200, before the ack) when this many subscription
   * streams are already open on this handler.
   * @default 1024
   */
  maxSubscriptions?: number;
  /**
   * SSE comment-frame keepalive interval for every SSE stream this handler
   * serves. In modern `auto` mode it starts after SSE upgrade. Set to `0` to disable.
   * @default 15000
   */
  keepAliveMs?: number;
  /**
   * Upper bound, in bytes, on a POST body the handler reads itself (the
   * classification step and the stateless legacy leg). A body over the bound
   * is answered `413` before anything is parsed or any server instance is
   * created. Not applied to a body supplied as `parsedBody`. Must be a
   * positive number. Hand-wired compositions routing on
   * {@linkcode isLegacyRequest} pass the same value to the predicate.
   * @default 4194304 (4 MiB)
   */
  maxRequestBodySize?: number;
}
/**
 * The handler returned by {@linkcode createMcpHandler}: a web-standard
 * `{ fetch, close, notify, bus }` object — the shape Workers/Bun/Deno expect
 * from `export default`. `fetch` is an arrow-assigned bound property: it can be
 * detached and passed around (`const { fetch } = handler`) without losing its
 * binding.
 *
 * Node frameworks (Express, Fastify, plain `node:http`) wrap the handler once
 * with `toNodeHandler(handler)` from `@modelcontextprotocol/node`.
 */
interface McpHttpHandler {
  /** Web-standard face: serve one HTTP request and resolve with the response. */
  fetch: (request: Request, options?: McpHandlerRequestOptions) => Promise<Response>;
  /**
   * Tears down the modern leg: aborts in-flight modern exchanges and closes
   * their per-request instances. Legacy serving is unaffected — the
   * stateless fallback is per-request by construction and holds nothing
   * between exchanges.
   */
  close: () => Promise<void>;
  /**
   * Typed publish-side facade over the handler's `subscriptions/listen` bus:
   * each method publishes the corresponding change event to every open
   * subscription stream that opted in to that notification type.
   *
   * Safe to call when no subscription is open (no-op).
   */
  notify: ServerNotifier;
  /**
   * The change-event bus this handler's `subscriptions/listen` streams
   * subscribe to (the supplied `bus` option, or the auto-created in-process
   * default).
   */
  bus: ServerEventBus;
}
/** Options for {@linkcode legacyStatelessFallback}. */
interface LegacyStatelessFallbackOptions {
  /**
   * Upper bound, in bytes, on a POST body the leg reads itself (not applied
   * to a body supplied as `parsedBody`). Must be a positive number.
   * @default 4194304 (4 MiB)
   */
  maxRequestBodySize?: number;
}
declare function legacyStatelessFallback(factory: McpServerFactory, onerror?: (error: Error) => void, options?: LegacyStatelessFallbackOptions): LegacyHttpHandler;
/** Options for {@linkcode isLegacyRequest}. */
interface IsLegacyRequestOptions {
  /**
   * The same `maxRequestBodySize` the handler the predicate routes for was
   * created with, so the two read the body under one bound (a body over it
   * classifies `false`; the modern handler answers `413`).
   * @default 4194304 (4 MiB)
   */
  maxRequestBodySize?: number;
}
/**
 * Whether {@linkcode createMcpHandler} would route this request to its legacy
 * (2025-era) serving rather than the modern (2026-07-28) path.
 *
 * Call it with just the request: `await isLegacyRequest(request)`. For a
 * `POST` the body is read from an internal clone, so the request you pass
 * stays fully readable for whichever handler you route it to — no second
 * argument is needed. (In a Node `(req, res)` handler, build that `Request`
 * with `toWebRequest(req)` from `@modelcontextprotocol/node`; behind a body
 * parser, which has already drained the Node stream, build it as
 * `toWebRequest(req, req.body)` so the bytes come from the parsed body —
 * either way the predicate still takes just the request.) The optional
 * `parsedBody` is a perf escape hatch for a body you already hold parsed:
 * pass it and the predicate classifies from the value directly, reading and
 * cloning nothing. It is needed, not just faster, when the request's own
 * body was already read — the internal clone is then impossible (cloning a
 * used body throws a `TypeError`), so such a single-argument call rejects
 * instead of guessing.
 *
 * This is the entry's own classification step exported as a predicate — it
 * runs exactly the code `createMcpHandler` runs to make the routing decision,
 * not a re-implementation — so a hand-wired composition that branches on it
 * can never disagree with the entry. It is classification only: hand-wired
 * compositions must validate Content-Type themselves (415 for POSTs whose
 * media type is not `application/json`, via {@linkcode isJsonContentType})
 * before dispatching either leg — routing the legacy leg into the SDK
 * transports gets their built-in check, but a custom modern leg has none. Use it to keep an existing legacy
 * deployment (for example a sessionful streamable HTTP wiring) serving 2025
 * traffic next to a strict modern endpoint, now that the entry has no
 * handler-valued `legacy` option:
 *
 * ```ts
 * import { createMcpHandler, isLegacyRequest } from '@modelcontextprotocol/server';
 *
 * const modern = createMcpHandler(factory, { legacy: 'reject' });
 *
 * export default {
 *     async fetch(request: Request): Promise<Response> {
 *         if (await isLegacyRequest(request)) {
 *             // e.g. an existing sessionful WebStandardStreamableHTTPServerTransport wiring
 *             return myExistingLegacyHandler(request);
 *         }
 *         return modern.fetch(request);
 *     }
 * };
 * ```
 *
 * Semantics (identical to the entry's routing):
 *
 * - Returns `true` only for requests with no per-request `_meta` envelope
 *   claim: claim-less POSTs (including the `initialize` handshake and 2025-era
 *   notification POSTs without a modern protocol-version header), body-less
 *   GET/DELETE session operations, all-legacy JSON-RPC batch arrays, posted
 *   JSON-RPC responses, and POSTs whose body is empty or not valid JSON.
 * - Returns `false` for everything the modern path answers, including its
 *   validation-ladder rejections: a request carrying the envelope claim (even
 *   one naming a revision the endpoint does not serve — the modern path
 *   answers it with the unsupported-protocol-version error), a malformed
 *   envelope behind a present claim (answered `-32602`), a request whose
 *   `MCP-Protocol-Version` header names a modern revision but that lacks the
 *   envelope (`-32602`), header/body mismatches (`-32020`), and a POST body
 *   over the size limit (413). Consumers
 *   routing on the predicate must send `false` traffic to the modern handler,
 *   never to a legacy handler — the modern path owns those error answers.
 * - `server/discover` probes sent by negotiating clients always carry the
 *   envelope claim, so they are never legacy; a hand-built claim-less POST to
 *   a method named `server/discover` has no claim and classifies legacy,
 *   exactly as the entry itself routes it.
 */
declare function isLegacyRequest(request: Request, parsedBody?: unknown, options?: IsLegacyRequestOptions): Promise<boolean>;
/**
 * Creates an HTTP handler that serves the 2026-07-28 protocol revision from a
 * per-request server factory and, by default, falls back to old-school
 * stateless serving for 2025-era traffic. Pass `legacy: 'reject'` for a
 * modern-only strict endpoint.
 *
 * Mounting: `handler.fetch` is the web-standard face (Cloudflare Workers,
 * Deno, Bun, Hono's `c.req.raw`); for Express/Fastify/plain `node:http`, wrap
 * the handler once with `toNodeHandler(handler)` from
 * `@modelcontextprotocol/node`. When mounting bare on a fetch-native runtime,
 * put Origin/Host validation in front of the handler — the entry itself is
 * deliberately validation-free:
 *
 * ```ts
 * import { hostHeaderValidationResponse, originValidationResponse, localhostAllowedHostnames, localhostAllowedOrigins } from '@modelcontextprotocol/server';
 *
 * export default {
 *     async fetch(request: Request): Promise<Response> {
 *         const rejected =
 *             hostHeaderValidationResponse(request, localhostAllowedHostnames()) ??
 *             originValidationResponse(request, localhostAllowedOrigins());
 *         return rejected ?? handler.fetch(request);
 *     }
 * };
 * ```
 *
 * Use ONE factory for both legs: the same tools/resources/prompts definition
 * backs the modern path and the stateless legacy fallback, so the two eras can
 * never drift apart. To keep an existing legacy deployment (for example a
 * sessionful streamable HTTP wiring) serving 2025 traffic instead of the
 * stateless fallback, route in user land with {@linkcode isLegacyRequest} in
 * front of a strict handler — see that predicate's documentation for the
 * pattern. Power users composing transport-neutral routing can also use the
 * exported building blocks directly: {@linkcode classifyInboundRequest} for
 * the era decision and `PerRequestHTTPServerTransport` for single-exchange
 * serving — such compositions must reject POSTs whose Content-Type media type
 * is not `application/json` (415) before parsing the body, using
 * {@linkcode isJsonContentType}; neither building block performs this
 * validation itself.
 *
 * The entry performs no token verification: `authInfo` given to `fetch` is
 * passed through to handlers and the factory as-is and is never derived from
 * request headers.
 */
declare function createMcpHandler(factory: McpServerFactory, options?: CreateMcpHandlerOptions): McpHttpHandler;
//#endregion
export { PerRequestHTTPServerTransportOptions as _, McpHandlerRequestOptions as a, McpServerFactory as c, legacyStatelessFallback as d, InMemoryServerEventBus as f, PerRequestHTTPServerTransport as g, ServerNotifier as h, LegacyStatelessFallbackOptions as i, createMcpHandler as l, ServerEventBus as m, IsLegacyRequestOptions as n, McpHttpHandler as o, ServerEvent as p, LegacyHttpHandler as r, McpRequestContext as s, CreateMcpHandlerOptions as t, isLegacyRequest as u, PerRequestMessageExtra as v, PerRequestResponseMode as y };
//# sourceMappingURL=createMcpHandler-CadSHsnp.d.cts.map