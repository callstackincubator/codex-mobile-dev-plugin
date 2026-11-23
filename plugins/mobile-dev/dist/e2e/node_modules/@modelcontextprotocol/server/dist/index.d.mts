import { $ as isSpecType, $a as OAuthTokens, $i as TextContent, $n as JSONRPCErrorResponse, $r as ReadResourceRequest, $t as ClientResult, A as CacheHint, Aa as SUBSCRIPTION_ID_META_KEY, Ai as ServerNotification, An as GetTaskPayloadRequest, Ar as ModelHint, At as InboundHttpRequest, B as Protocol, Ba as OAuthError, Bi as SubscriptionsAcknowledgedNotification, Bn as InitializeRequestParams, Br as PaginatedResult, Bt as BaseMetadata, C as InMemoryTransport, Ca as LATEST_PROTOCOL_VERSION, Ci as Role, Cn as ElicitationCompleteNotificationParams, Cr as LoggingMessageNotification, Ct as inputRequired, D as STDIO_DEFAULT_MAX_BUFFER_SIZE, Da as PROTOCOL_VERSION_META_KEY, Di as SamplingMessage, Dn as GetPromptRequest, Dr as MetaObject, Dt as StandardSchemaV1Sync, E as ReadBuffer, Ea as PARSE_ERROR, Ei as SamplingContent, En as EnumSchema, Er as MessageExtraInfo, Et as StandardSchemaV1, F as BaseContext, Fa as resourceUrlFromServerUrl, Fi as SingleSelectEnumSchema, Fn as Icon, Fr as NotificationParams, Ft as InboundValidationRung, G as ServerContext, Ga as OAuthClientInformationFull, Gi as SubscriptionsListenResultMeta, Gn as InputRequiredResult, Gr as ProgressNotification, Gt as CallToolResult, H as RequestHandlerSchemas, Ha as AuthorizationServerMetadata, Hi as SubscriptionsListenRequest, Hn as InitializedNotification, Hr as PingRequest, Ht as BooleanSchema, I as ClientContext, Ia as SdkError, Ii as StringSchema, In as Icons, Ir as NotificationTypeMap, It as classifyInboundRequest, J as Transport, Ja as OAuthClientRegistrationError, Ji as TaskCreationParams, Jn as InternalError, Jr as Prompt, Jt as CancelledNotification, K as mergeCapabilities, Ka as OAuthClientInformationMixed, Ki as Task, Kn as InputResponse, Kr as ProgressNotificationParams, Kt as CancelTaskRequest, L as DEFAULT_REQUEST_TIMEOUT_MSEC, La as SdkErrorCode, Li as SubscribeRequest, Ln as ImageContent, Lr as NumberSchema, Lt as Annotations, M as ProtocolEra, Ma as TRACEPARENT_META_KEY, Mi as ServerResult, Mn as GetTaskRequest, Mr as MultiSelectEnumSchema, Mt as InboundLegacyRoute, N as getDisplayName, Na as TRACESTATE_META_KEY, Ni as SetLevelRequest, Nn as GetTaskResult, Nr as Notification, Nt as InboundLegacyRouteReason, O as deserializeMessage, Oa as RELATED_TASK_META_KEY, Oi as SamplingMessageContentBlock, On as GetPromptRequestParams, Or as MethodNotFoundError, Ot as StandardSchemaWithJSON, P as isJsonContentType, Pa as checkResourceAllowed, Pi as SetLevelRequestParams, Pn as HandlerResultTypeMap, Pr as NotificationMethod, Pt as InboundModernRoute, Q as SpecTypes, Qa as OAuthTokenRevocationRequest, Qi as TaskStatusNotificationParams, Qn as JSONObject, Qr as PromptReference, Qt as ClientRequest, R as NotificationOptions, Ra as SdkHttpError, Ri as SubscribeRequestParams, Rn as Implementation, Rr as PaginatedRequest, Rt as AudioContent, S as preloadSchemas, Sa as JSONRPC_VERSION, Si as ResultTypeMap, Sn as ElicitationCompleteNotification, Sr as LoggingLevel, St as acceptedContent, T as Variables, Ta as METHOD_NOT_FOUND, Ti as RootsListChangedNotification, Tn as EmptyResult, Tr as MessageClassification, Tt as ElicitInputParams, U as RequestOptions, Ua as IdJagTokenExchangeResponse, Ui as SubscriptionsListenRequestParams, Un as InputRequest, Ur as PrimitiveSchemaDefinition, Ut as CallToolRequest, V as ProtocolOptions, Va as OAuthErrorCode, Vi as SubscriptionsAcknowledgedNotificationParams, Vn as InitializeResult, Vr as ParseError, Vt as BlobResourceContents, W as RequestStateAccessor, Wa as OAuthClientInformation, Wi as SubscriptionsListenResult, Wn as InputRequests, Wr as Progress, Wt as CallToolRequestParams, X as createFetchWithInit, Xa as OAuthMetadata, Xi as TaskStatus, Xn as InvalidRequestError, Xr as PromptListChangedNotification, Xt as ClientCapabilities, Y as TransportSendOptions, Ya as OAuthErrorResponse, Yi as TaskMetadata, Yn as InvalidParamsError, Yr as PromptArgument, Yt as CancelledNotificationParams, Z as SpecTypeName, Za as OAuthProtectedResourceMetadata, Zi as TaskStatusNotification, Zn as JSONArray, Zr as PromptMessage, Zt as ClientNotification, _ as Server, _a as CLIENT_INFO_META_KEY, _i as ResourceTemplateType, _n as ElicitRequest, _r as ListRootsResult, _t as UnsupportedProtocolVersionError, a as McpServer, aa as ToolChoice, ai as RequestMeta, an as CompleteResult, ar as JSONValue, at as isInitializedNotification, b as ScopeChallengeHandler, ba as INVALID_PARAMS, bi as Result, bn as ElicitRequestURLParams, br as ListToolsRequest, bt as InputRequiredSpec, c as ReadResourceCallback, ca as ToolResultContent, ci as RequestMethod, cn as CreateMessageRequestParams, cr as ListChangedHandlers, ct as isJSONRPCNotification, d as RegisteredResource, da as UnsubscribeRequestParams, di as Resource, dn as CreateMessageResult, dr as ListPromptsResult, dt as isJSONRPCResultResponse, ea as TextResourceContents, ei as ReadResourceRequestParams, en as CompatibilityCallToolResult, eo as OpenIdProviderDiscoveryMetadata, er as JSONRPCMessage, et as specTypeSchemas, f as RegisteredResourceTemplate, fa as UnsupportedProtocolVersionErrorData, fi as ResourceContents, fn as CreateMessageResultWithTools, fr as ListResourceTemplatesRequest, ft as isTaskAugmentedRequestParams, g as ToolCallback, ga as CLIENT_CAPABILITIES_META_KEY, gi as ResourceTemplateReference, gn as DiscoverResult, gr as ListRootsRequest, gt as ResourceNotFoundError, h as ResourceTemplate, ha as BAGGAGE_META_KEY, hi as ResourceRequestParams, hn as DiscoverRequest, hr as ListResourcesResult, ht as ProtocolError, i as ListResourcesCallback, ia as ToolAnnotations, ii as RequestId, in as CompleteRequestResourceTemplate, ir as JSONRPCResultResponse, it as isInitializeRequest, j as CacheScope, ja as SUPPORTED_PROTOCOL_VERSIONS, ji as ServerRequest, jn as GetTaskPayloadResult, jr as ModelPreferences, jt as InboundLadderRejection, k as serializeMessage, ka as SERVER_INFO_META_KEY, ki as ServerCapabilities, kn as GetPromptResult, kr as MissingRequiredClientCapabilityErrorData, kt as InboundClassificationOutcome, l as ReadResourceTemplateCallback, la as ToolUseContent, li as RequestParams, ln as CreateMessageRequestParamsBase, lr as ListChangedOptions, lt as isJSONRPCRequest, m as ResourceMetadata, ma as UntitledSingleSelectEnumSchema, mi as ResourceListChangedNotification, mn as Cursor, mr as ListResourcesRequest, mt as MissingRequiredClientCapabilityError, n as BaseToolCallback, na as TitledSingleSelectEnumSchema, ni as RelatedTaskMetadata, nn as CompleteRequestParams, no as StoredOAuthClientInformation, nr as JSONRPCRequest, nt as assertCompleteRequestResourceTemplate, o as McpServerOptions, oa as ToolExecution, oi as RequestMetaEnvelope, on as ContentBlock, or as LegacyTitledEnumSchema, ot as isInputRequiredResult, p as RegisteredTool, pa as UntitledMultiSelectEnumSchema, pi as ResourceLink, pn as CreateTaskResult, pr as ListResourceTemplatesResult, pt as parseJSONRPCMessage, q as FetchLike, qa as OAuthClientMetadata, qi as TaskAugmentedRequestParams, qn as InputResponses, qr as ProgressToken, qt as CancelTaskResult, r as CompleteResourceTemplateCallback, ra as Tool, ri as Request$1, rn as CompleteRequestPrompt, ro as StoredOAuthTokens, rr as JSONRPCResponse, rt as isCallToolResult, s as PromptCallback, sa as ToolListChangedNotification, si as RequestMetaObject, sn as CreateMessageRequest, sr as ListChangedCallback, st as isJSONRPCErrorResponse, t as AnyToolHandler, ta as TitledMultiSelectEnumSchema, ti as ReadResourceResult, tn as CompleteRequest, to as OpenIdProviderMetadata, tr as JSONRPCNotification, tt as assertCompleteRequestPrompt, u as RegisteredPrompt, ua as UnsubscribeRequest, ui as RequestTypeMap, un as CreateMessageRequestParamsWithTools, ur as ListPromptsRequest, ut as isJSONRPCResponse, v as ServerOptions, va as DEFAULT_NEGOTIATED_PROTOCOL_VERSION, vi as ResourceUpdatedNotification, vn as ElicitRequestFormParams, vr as ListTasksRequest, vt as UrlElicitationRequiredError, w as UriTemplate, wa as LOG_LEVEL_META_KEY, wi as Root, wn as EmbeddedResource, wr as LoggingMessageNotificationParams, wt as inputResponse, x as requireScopes, xa as INVALID_REQUEST, xi as ResultMetaObject, xn as ElicitResult, xr as ListToolsResult, xt as InputResponseView, y as ScopeChallenge, ya as INTERNAL_ERROR, yi as ResourceUpdatedNotificationParams, yn as ElicitRequestParams, yr as ListTasksResult, yt as ProtocolErrorCode, z as ProgressCallback, za as SdkHttpErrorData, zi as SubscriptionFilter, zn as InitializeRequest, zr as PaginatedRequestParams, zt as AuthInfo } from "./mcp-BCJHyo7l.mjs";
import { i as jsonSchemaValidator, n as JsonSchemaValidator, r as JsonSchemaValidatorResult, t as JsonSchemaType } from "./types-DDiDRBhz.mjs";
import { _ as PerRequestHTTPServerTransportOptions, a as McpHandlerRequestOptions, c as McpServerFactory, d as legacyStatelessFallback, f as InMemoryServerEventBus, g as PerRequestHTTPServerTransport, h as ServerNotifier, i as LegacyStatelessFallbackOptions, l as createMcpHandler, m as ServerEventBus, n as IsLegacyRequestOptions, o as McpHttpHandler, p as ServerEvent, r as LegacyHttpHandler, s as McpRequestContext, t as CreateMcpHandlerOptions, u as isLegacyRequest, v as PerRequestMessageExtra, y as PerRequestResponseMode } from "./createMcpHandler-DzlXH0KL.mjs";

//#region src/server/completable.d.ts
declare const COMPLETABLE_SYMBOL: unique symbol;
type CompleteCallback<T extends StandardSchemaV1 = StandardSchemaV1> = (value: StandardSchemaV1.InferInput<T>, context?: {
  arguments?: Record<string, string>;
}) => StandardSchemaV1.InferInput<T>[] | Promise<StandardSchemaV1.InferInput<T>[]>;
type CompletableMeta<T extends StandardSchemaV1 = StandardSchemaV1> = {
  complete: CompleteCallback<T>;
};
type CompletableSchema<T extends StandardSchemaV1> = T & {
  [COMPLETABLE_SYMBOL]: CompletableMeta<T>;
};
/**
 * Wraps a schema to provide autocompletion capabilities. Useful for, e.g., prompt arguments in MCP.
 *
 * @example
 * ```ts source="./completable.examples.ts#completable_basicUsage"
 * server.registerPrompt(
 *     'review-code',
 *     {
 *         title: 'Code Review',
 *         argsSchema: z.object({
 *             language: completable(z.string().describe('Programming language'), value =>
 *                 ['typescript', 'javascript', 'python', 'rust', 'go'].filter(lang => lang.startsWith(value))
 *             )
 *         })
 *     },
 *     ({ language }) => ({
 *         messages: [
 *             {
 *                 role: 'user' as const,
 *                 content: {
 *                     type: 'text' as const,
 *                     text: `Review this ${language} code.`
 *                 }
 *             }
 *         ]
 *     })
 * );
 * ```
 *
 * @see {@linkcode server/mcp.McpServer.registerPrompt | McpServer.registerPrompt} for using completable schemas in prompt argument definitions
 */
declare function completable<T extends StandardSchemaV1>(schema: T, complete: CompleteCallback<T>): CompletableSchema<T>;
/**
 * Checks if a schema is completable (has completion metadata).
 */
declare function isCompletable(schema: unknown): schema is CompletableSchema<StandardSchemaV1>;
//#endregion
//#region src/server/middleware/bearerAuth.d.ts
/**
 * Minimal token-verifier interface for MCP servers acting as an OAuth 2.0
 * Resource Server. Implementations introspect or locally validate an access
 * token and return the resulting {@link AuthInfo}, which the serving entry
 * surfaces to MCP request handlers via `ctx.http.authInfo`.
 *
 * This is intentionally narrower than a full OAuth Authorization Server
 * provider — it only covers the verification step a Resource Server needs.
 */
interface OAuthTokenVerifier {
  /**
   * Verifies an access token and returns information about it.
   *
   * Implementations should throw an {@link OAuthError} with
   * `OAuthErrorCode.InvalidToken` when the token is unknown, revoked, or
   * otherwise invalid; the bearer-auth helpers map that to a `401` with a
   * `WWW-Authenticate` challenge.
   *
   * Note: bearer-auth verification rejects tokens whose
   * `AuthInfo.expiresAt` is unset (matches v1 behavior). Ensure your
   * verifier populates it (e.g. from RFC 7662 introspection `exp` or the
   * JWT `exp` claim).
   */
  verifyAccessToken(token: string): Promise<AuthInfo>;
}
/**
 * Options for {@link verifyBearerToken}, {@link requireBearerAuth}, and
 * {@link bearerAuthChallengeResponse}.
 */
interface BearerAuthOptions {
  /**
   * A verifier used to validate access tokens.
   */
  verifier: OAuthTokenVerifier;
  /**
   * Optional scopes that the token must have. When any are missing the
   * request is refused with `403 insufficient_scope`.
   */
  requiredScopes?: string[];
  /**
   * Optional Protected Resource Metadata URL to advertise in the
   * `WWW-Authenticate` header on 401/403 responses, per
   * {@link https://datatracker.ietf.org/doc/html/rfc9728 | RFC 9728}.
   *
   * Typically built with `getOAuthProtectedResourceMetadataUrl`, exported
   * from this package.
   *
   * When verification succeeds the value is also stamped onto the returned
   * {@link AuthInfo} (`authInfo.resourceMetadataUrl`, unless the verifier
   * already set one), so challenges built after authentication — such as
   * per-operation `insufficient_scope` scope challenges — advertise the
   * same document without being configured separately.
   */
  resourceMetadataUrl?: string;
}
/**
 * Options for {@link verifyBearerToken} and {@link requireBearerAuth}:
 * {@link BearerAuthOptions} plus `expectedResource`.
 */
interface VerifyBearerTokenOptions extends BearerAuthOptions {
  /**
   * Accept only tokens issued for this resource (the token's audience):
   * the value your authorization server puts into tokens meant for this
   * server, usually the server's URL (its
   * {@link https://datatracker.ietf.org/doc/html/rfc8707 | RFC 8707}
   * resource identifier).
   *
   * When set, a token is accepted only if the verifier reports that value
   * in `AuthInfo.resource`. The two are compared as strings, ignoring a
   * fragment and one trailing slash. A token reported for another value, or
   * for none, is refused with `401 invalid_token`, so the verifier has to
   * fill `AuthInfo.resource`, for example from the token's `aud` claim.
   * When unset, `AuthInfo.resource` is not compared with anything.
   */
  expectedResource?: URL;
}
/**
 * Validate a raw `Authorization` header value as a Bearer token and return
 * the verified {@link AuthInfo}.
 *
 * The runtime-neutral core of Bearer authentication: it parses the header,
 * runs the verifier, compares the token's resource with `expectedResource`,
 * enforces `requiredScopes`, and rejects tokens without an
 * expiration or past it. On any failure it throws an {@link OAuthError} —
 * pass that to {@link bearerAuthChallengeResponse} for the matching HTTP
 * answer, or use {@link requireBearerAuth} to get both steps as one call.
 *
 * Framework adapters build on this: `requireBearerAuth` from
 * `@modelcontextprotocol/express` feeds it `req.headers.authorization`.
 */
declare function verifyBearerToken(authorizationHeader: string | null | undefined, options: VerifyBearerTokenOptions): Promise<AuthInfo>;
/**
 * Build the HTTP answer for a Bearer authentication failure.
 *
 * Maps an {@link OAuthError} to its status — `401` for `invalid_token` and
 * `403` for `insufficient_scope` (both carrying the `WWW-Authenticate: Bearer …`
 * challenge, with `resource_metadata` when configured so clients can discover
 * the Authorization Server), `500` for `server_error`, `400` for anything
 * else. A non-`OAuthError` value answers `500 server_error`. The body is the
 * OAuth error JSON.
 */
declare function bearerAuthChallengeResponse(error: unknown, options?: Pick<BearerAuthOptions, 'requiredScopes' | 'resourceMetadataUrl'>): Response;
/**
 * Require a valid Bearer token on web-standard requests.
 *
 * The framework-free counterpart of `requireBearerAuth` from
 * `@modelcontextprotocol/express`, for hosts whose HTTP surface is a
 * `fetch(request)` handler — Cloudflare Workers, Deno, Bun, Hono. The
 * returned gate resolves to the verified {@link AuthInfo}, or to the
 * ready-to-return challenge `Response` when the request must be refused.
 *
 * @example
 * ```ts source="./bearerAuth.examples.ts#requireBearerAuth_fetchGate"
 * const gate = requireBearerAuth({ verifier, requiredScopes: ['mcp'] });
 *
 * async function fetchHandler(request: Request): Promise<Response> {
 *     const auth: AuthInfo | Response = await gate(request);
 *     if (auth instanceof Response) return auth;
 *     return handler.fetch(request, { authInfo: auth });
 * }
 * ```
 */
declare function requireBearerAuth(options: VerifyBearerTokenOptions): (request: Request) => Promise<AuthInfo | Response>;
//#endregion
//#region src/server/middleware/hostHeaderValidation.d.ts
type HostHeaderValidationResult = {
  ok: true;
  hostname: string;
} | {
  ok: false;
  errorCode: 'missing_host' | 'invalid_host_header' | 'invalid_host';
  message: string;
  hostHeader?: string;
  hostname?: string;
};
/**
 * Parse and validate a `Host` header against an allowlist of hostnames (port-agnostic).
 *
 * - Input host header may include a port (e.g. `localhost:3000`) or IPv6 brackets (e.g. `[::1]:3000`).
 * - Allowlist items should be hostnames only (no ports). For IPv6, include brackets (e.g. `[::1]`).
 */
declare function validateHostHeader(hostHeader: string | null | undefined, allowedHostnames: string[]): HostHeaderValidationResult;
/**
 * Convenience allowlist for `localhost` DNS rebinding protection.
 */
declare function localhostAllowedHostnames(): string[];
/**
 * Web-standard `Request` helper for DNS rebinding protection.
 * @example
 * ```ts source="./hostHeaderValidation.examples.ts#hostHeaderValidationResponse_basicUsage"
 * const result = validateHostHeader(req.headers.get('host'), ['localhost']);
 * ```
 */
declare function hostHeaderValidationResponse(req: Request, allowedHostnames: string[]): Response | undefined;
//#endregion
//#region src/server/middleware/oauthMetadata.d.ts
/**
 * Options for {@link oauthMetadataResponse} and
 * {@link buildOAuthProtectedResourceMetadata}.
 */
interface AuthMetadataOptions {
  /**
   * Authorization Server metadata (RFC 8414) for the AS this MCP server
   * relies on. Served at `/.well-known/oauth-authorization-server` so
   * legacy clients that probe the resource origin still discover the AS.
   */
  oauthMetadata: OAuthMetadata;
  /**
   * The public URL of this MCP server, used as the `resource` value in the
   * Protected Resource Metadata document. Any path component is reflected
   * in the well-known route per RFC 9728.
   */
  resourceServerUrl: URL;
  /**
   * Optional documentation URL advertised as `resource_documentation`.
   */
  serviceDocumentationUrl?: URL;
  /**
   * Optional list of scopes this MCP server understands, advertised as
   * `scopes_supported`.
   */
  scopesSupported?: string[];
  /**
   * Optional human-readable name advertised as `resource_name`.
   */
  resourceName?: string;
  /**
   * Allow a non-HTTPS issuer URL. Local testing only — never enable in
   * production. The Express adapter maps its
   * `MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL` environment variable here.
   */
  dangerouslyAllowInsecureIssuerUrl?: boolean;
}
/**
 * Derive the RFC 9728 Protected Resource Metadata document from
 * {@link AuthMetadataOptions}, validating the Authorization Server issuer URL
 * (HTTPS required outside localhost) in the process.
 *
 * `oauthMetadataResponse` and the Express `mcpAuthMetadataRouter` both build
 * on this; use it directly when serving the document through your own
 * routing — or call it once at startup to fail fast on a misconfigured
 * issuer before any request arrives.
 */
declare function buildOAuthProtectedResourceMetadata(options: AuthMetadataOptions): OAuthProtectedResourceMetadata;
/**
 * Builds the RFC 9728 Protected Resource Metadata URL for a given MCP server
 * URL by inserting `/.well-known/oauth-protected-resource` ahead of the path.
 *
 * @example
 * ```ts
 * getOAuthProtectedResourceMetadataUrl(new URL('https://api.example.com/mcp'))
 * // → 'https://api.example.com/.well-known/oauth-protected-resource/mcp'
 * ```
 */
declare function getOAuthProtectedResourceMetadataUrl(serverUrl: URL): string;
/**
 * Serve the two OAuth discovery documents an MCP server acting as a Resource
 * Server exposes, from a web-standard `fetch(request)` handler:
 *
 *  - `/.well-known/oauth-protected-resource[/<path>]` — RFC 9728 Protected
 *    Resource Metadata, derived from the supplied options (path-aware: the
 *    resource URL's path is reflected in the route).
 *  - `/.well-known/oauth-authorization-server` — RFC 8414 Authorization
 *    Server Metadata, passed through verbatim.
 *
 * Returns the matched document `Response` (JSON with permissive CORS, `405`
 * with an `Allow` header for non-GET methods, `204` for CORS preflight), or
 * `undefined` when the request path is neither well-known route — fall
 * through to your own routing. The framework-free counterpart of
 * `mcpAuthMetadataRouter` from `@modelcontextprotocol/express`; pair it with
 * `requireBearerAuth` and `getOAuthProtectedResourceMetadataUrl` so
 * unauthenticated clients can discover the AS from the `401` challenge.
 *
 * @example
 * ```ts source="./oauthMetadata.examples.ts#oauthMetadataResponse_fetchHandler"
 * async function fetchHandler(request: Request): Promise<Response> {
 *     return oauthMetadataResponse(request, options) ?? serveMcp(request);
 * }
 * ```
 */
declare function oauthMetadataResponse(request: Request, options: AuthMetadataOptions): Response | undefined;
//#endregion
//#region src/server/middleware/originValidation.d.ts
/**
 * Framework-agnostic Origin header validation helpers.
 *
 * Browsers attach an `Origin` header to cross-origin requests; validating it
 * against an allowlist (alongside Host header validation) protects local and
 * development MCP servers against DNS rebinding and cross-site request
 * forgery. The framework middleware packages (`@modelcontextprotocol/express`,
 * `@modelcontextprotocol/hono`, `@modelcontextprotocol/fastify`,
 * `@modelcontextprotocol/node`) wrap these helpers; use them directly when
 * mounting a handler bare on a fetch-native runtime.
 *
 * Validation is deny-on-failure: a present `Origin` value that cannot be
 * parsed (including the opaque `null` origin) is rejected, never passed
 * through. Requests without an `Origin` header pass — non-browser MCP clients
 * do not send one.
 */
type OriginValidationResult = {
  ok: true;
  origin?: string;
  hostname?: string;
} | {
  ok: false;
  errorCode: 'invalid_origin_header' | 'invalid_origin';
  message: string;
  originHeader?: string;
  hostname?: string;
};
/**
 * Validate an `Origin` header against an allowlist of hostnames (port-agnostic).
 *
 * - A missing/empty `Origin` header passes: non-browser clients do not send one,
 *   and only browser-originated requests carry the header this check defends against.
 * - Allowlist items are hostnames only (no scheme, no port), the same convention as
 *   `validateHostHeader`. For IPv6, include brackets (e.g. `[::1]`).
 * - A browser extension's origin carries its extension ID as the hostname; list the
 *   ID to allow one extension. An allowlist item of the form `<scheme>://*`
 *   (lowercase, e.g. `moz-extension://*`) allows every origin of that scheme, which
 *   Firefox needs because its extension IDs differ on every install.
 *   `http://*` and `https://*` are not honoured: list websites by hostname.
 * - Any present value that cannot be parsed as an origin URL — including the literal
 *   `null` origin browsers send for opaque contexts — is rejected (deny on failure).
 */
declare function validateOriginHeader(originHeader: string | null | undefined, allowedOriginHostnames: string[]): OriginValidationResult;
/**
 * Convenience allowlist of localhost-class origin hostnames, mirroring
 * `localhostAllowedHostnames`.
 */
declare function localhostAllowedOrigins(): string[];
/**
 * Web-standard `Request` helper for Origin validation: returns a `403` JSON-RPC
 * error response when the request's `Origin` header is not allowed, and
 * `undefined` when the request may proceed.
 *
 * ```ts
 * const rejected = originValidationResponse(request, localhostAllowedOrigins());
 * if (rejected) return rejected;
 * ```
 */
declare function originValidationResponse(req: Request, allowedOriginHostnames: string[]): Response | undefined;
//#endregion
//#region src/server/requestStateCodec.d.ts
/**
 * Options for {@linkcode createRequestStateCodec}.
 */
interface RequestStateCodecOptions {
  /**
   * The HMAC secret. A `string` value is UTF-8-encoded. MUST be at least
   * 32 bytes (256 bits) long; a `RangeError` is thrown at
   * construction otherwise. The same key must be available to every server
   * instance that may receive an echoed `requestState` (so a per-process
   * random key only works when one process serves every round of a flow).
   */
  key: Uint8Array | string;
  /**
   * How long a minted `requestState` stays valid, in seconds. An echoed
   * value past its expiry is rejected by {@linkcode RequestStateCodec.verify}.
   * Defaults to `600` (ten minutes).
   */
  ttlSeconds?: number;
  /**
   * Optional context binding. Called at mint time and again at verify time;
   * a `requestState` minted under one binding value is rejected when echoed
   * under a different one. Use this to bind state to the authenticated
   * principal and/or the originating method (the spec's user-binding MUST
   * for state that influences authorization), for example:
   *
   * ```ts
   * bind: ctx => `${ctx.mcpReq.method}\0${ctx.http?.authInfo?.clientId ?? ''}`
   * ```
   *
   * The returned value is stored in the envelope as a domain-separated HMAC
   * tag (keyed by the codec's `key`), not the raw string — so a principal
   * identifier in the binding does not appear in the wire value the client
   * holds.
   *
   * When configured, {@linkcode RequestStateCodec.mint} requires its `ctx`
   * argument.
   */
  bind?: (ctx: ServerContext) => string;
}
/**
 * The codec returned by {@linkcode createRequestStateCodec}: `mint` seals a
 * JSON-serializable payload into the wire string a handler returns from
 * `inputRequired({ requestState })`; `verify` is the function to drop into
 * {@linkcode server/server.ServerOptions | ServerOptions}`.requestState.verify`
 * (it throws on any failure, which the seam answers as the frozen `-32602`).
 * The decoded payload `verify` resolves with is handed to the handler by the
 * seam via the typed `ctx.mcpReq.requestState<T>()` accessor — `mint<T>` and
 * `requestState<T>()` are the typed encode/read pair.
 */
interface RequestStateCodec<T = unknown> {
  /**
   * Seal `payload` into an opaque wire string. The result is what the
   * handler returns from `inputRequired({ requestState })`.
   *
   * @param ctx The handler's context. Required when the codec was created
   *            with a {@linkcode RequestStateCodecOptions.bind | bind}
   *            callback; ignored otherwise.
   */
  mint(payload: T, ctx?: ServerContext): Promise<string>;
  /**
   * Verify an echoed `requestState` and return the original payload. Throws
   * on any failure (bad MAC, expired, bind mismatch, malformed). The thrown
   * message is a fixed opaque reason code (`'malformed'` / `'mac'` /
   * `'expired'` / `'bind'`) — never the decoded payload, the binding value,
   * or any other context-derived field.
   *
   * Pass this directly as `ServerOptions.requestState.verify`.
   */
  verify(state: string, ctx: ServerContext): Promise<T>;
}
/**
 * Create an opt-in HMAC-SHA256 codec for the multi-round-trip `requestState`
 * (protocol revision 2026-07-28).
 *
 * `requestState` round-trips through the client and is attacker-controlled
 * input on re-entry. The SDK applies no protection of its own; this helper is
 * the convenience implementation of the spec's integrity MUST so authors don't
 * hand-roll HMAC. Wire shape:
 *
 *     "v1." b64url({"p":<payload>,"exp":<unixSeconds>,"b":<bindTag>?}) "." b64url(mac)
 *
 * where `bindTag` is `b64url(HMAC(key, "mcp.requestState.bind:" + bind(ctx))[:16])`
 * — the binding value is never embedded raw.
 *
 * The codec is **signed, not encrypted**: the body is integrity-protected but
 * the client can base64url-decode it and read the payload (`p`) in clear. Do
 * not put secrets in the payload; use an AEAD construction if confidentiality
 * is required. The handler reads its payload back via the typed
 * `ctx.mcpReq.requestState<T>()` accessor — the seam has already run `verify`
 * (integrity proven, payload decoded) by the time the handler is entered.
 *
 * Verification is fail-closed and constant-time (WebCrypto `subtle.verify` for
 * the body MAC; a fixed-length XOR-accumulator compare for the bind tag).
 * See `examples/mrtr/server.ts` for a worked end-to-end example.
 *
 * Design comparison (mcp.d `secureRequestState`, the peer SDK's reference
 * implementation): mcp.d additionally offers an AES-256-GCM encrypted mode and
 * derives independent cipher / bind-HMAC sub-keys from the operator secret via
 * HKDF-SHA256, with an auto-generated per-process ephemeral key when none is
 * supplied. This codec deliberately ships only the signed mode and a single
 * keyed HMAC (domain-separated by input prefix) — HKDF sub-key derivation and
 * an encrypted mode are intentionally out of scope for the initial release.
 */
declare function createRequestStateCodec<T = unknown>(options: RequestStateCodecOptions): RequestStateCodec<T>;
//#endregion
//#region src/server/streamableHttp.d.ts
type StreamId = string;
type EventId = string;
/**
 * Interface for resumability support via event storage
 */
interface EventStore {
  /**
   * Stores an event for later retrieval
   * @param streamId ID of the stream the event belongs to
   * @param message The JSON-RPC message to store
   * @returns The generated event ID for the stored event
   */
  storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId>;
  /**
   * Get the stream ID associated with a given event ID.
   * @param eventId The event ID to look up
   * @returns The stream ID, or `undefined` if not found
   *
   * Optional: If not provided, the SDK will use the `streamId` returned by
   * {@linkcode replayEventsAfter} for stream mapping.
   */
  getStreamIdForEventId?(eventId: EventId): Promise<StreamId | undefined>;
  replayEventsAfter(lastEventId: EventId, {
    send
  }: {
    send: (eventId: EventId, message: JSONRPCMessage) => Promise<void>;
  }): Promise<StreamId>;
}
/**
 * Configuration options for {@linkcode WebStandardStreamableHTTPServerTransport}
 */
interface WebStandardStreamableHTTPServerTransportOptions {
  /**
   * Function that generates a session ID for the transport.
   * The session ID SHOULD be globally unique and cryptographically secure (e.g., a securely generated UUID, a JWT, or a cryptographic hash)
   *
   * If not provided, session management is disabled (stateless mode).
   */
  sessionIdGenerator?: (() => string) | undefined;
  /**
   * A callback for session initialization events
   * This is called when the server initializes a new session.
   * Useful in cases when you need to register multiple mcp sessions
   * and need to keep track of them.
   * @param sessionId The generated session ID
   */
  onsessioninitialized?: ((sessionId: string) => void | Promise<void>) | undefined;
  /**
   * A callback for session close events
   * This is called when the server closes a session due to a `DELETE` request.
   * Useful in cases when you need to clean up resources associated with the session.
   * Note that this is different from the transport closing, if you are handling
   * HTTP requests from multiple nodes you might want to close each
   * {@linkcode WebStandardStreamableHTTPServerTransport} after a request is completed while still keeping the
   * session open/running.
   * @param sessionId The session ID that was closed
   */
  onsessionclosed?: ((sessionId: string) => void | Promise<void>) | undefined;
  /**
   * If `true`, the server will return JSON responses instead of starting an SSE stream.
   * This can be useful for simple request/response scenarios without streaming.
   * Default is `false` (SSE streams are preferred).
   */
  enableJsonResponse?: boolean;
  /**
   * Event store for resumability support
   * If provided, resumability will be enabled, allowing clients to reconnect and resume messages
   */
  eventStore?: EventStore;
  /**
   * List of allowed `Host` header values for DNS rebinding protection.
   * If not specified, host validation is disabled.
   * @deprecated Use external middleware for host validation instead.
   */
  allowedHosts?: string[];
  /**
   * List of allowed `Origin` header values for DNS rebinding protection.
   * If not specified, origin validation is disabled.
   * @deprecated Use external middleware for origin validation instead.
   */
  allowedOrigins?: string[];
  /**
   * Enable DNS rebinding protection (requires `allowedHosts` and/or `allowedOrigins` to be configured).
   * Default is `false` for backwards compatibility.
   * @deprecated Use external middleware for DNS rebinding protection instead.
   */
  enableDnsRebindingProtection?: boolean;
  /**
   * Retry interval in milliseconds to suggest to clients in SSE `retry` field.
   * When set, the server will send a `retry` field in SSE priming events to control
   * client reconnection timing for polling behavior.
   */
  retryInterval?: number;
  /**
   * Interval in milliseconds between SSE keep-alive comment frames.
   * Defaults to `15000`; set to `0` to disable.
   */
  keepAliveMs?: number;
  /**
   * Upper bound, in bytes, on a POST body the transport reads itself. A body
   * over the bound (declared `Content-Length`, or observed while streaming)
   * is answered `413` before anything is parsed. Not applied when the caller
   * supplies `parsedBody`. Must be a positive number.
   * @default 4194304 (4 MiB)
   */
  maxRequestBodySize?: number;
  /**
   * List of protocol versions that this transport will accept.
   * Used to validate the `mcp-protocol-version` header in incoming requests.
   *
   * Note: When using {@linkcode server/server.Server.connect | Server.connect()}, the server automatically passes its
   * `supportedProtocolVersions` to the transport, so you typically don't need
   * to set this option directly.
   *
   * @default {@linkcode SUPPORTED_PROTOCOL_VERSIONS}
   */
  supportedProtocolVersions?: string[];
}
/**
 * Options for handling a request
 */
interface HandleRequestOptions {
  /**
   * Pre-parsed request body. If provided, the transport will use this instead of reading and parsing the request body.
   * Useful when using body-parser middleware that has already parsed the body.
   */
  parsedBody?: unknown;
  /**
   * Authentication info from middleware. If provided, will be passed to message handlers.
   */
  authInfo?: AuthInfo;
}
/**
 * Server transport for Web Standards Streamable HTTP: this implements the MCP Streamable HTTP transport specification
 * using Web Standard APIs (`Request`, `Response`, `ReadableStream`).
 *
 * This transport works on any runtime that supports Web Standards: Node.js 18+, Cloudflare Workers, Deno, Bun, etc.
 *
 * In stateful mode:
 * - Session ID is generated and included in response headers
 * - Session ID is always included in initialization responses
 * - Requests with invalid session IDs are rejected with `404 Not Found`
 * - Non-initialization requests without a session ID are rejected with `400 Bad Request`
 * - State is maintained in-memory (connections, message history)
 *
 * In stateless mode:
 * - No Session ID is included in any responses
 * - No session validation is performed
 *
 * @example Stateful setup
 * ```ts source="./streamableHttp.examples.ts#WebStandardStreamableHTTPServerTransport_stateful"
 * const server = new McpServer({ name: 'my-server', version: '1.0.0' });
 *
 * const transport = new WebStandardStreamableHTTPServerTransport({
 *     sessionIdGenerator: () => crypto.randomUUID()
 * });
 *
 * await server.connect(transport);
 * ```
 *
 * @example Stateless setup
 * ```ts source="./streamableHttp.examples.ts#WebStandardStreamableHTTPServerTransport_stateless"
 * const transport = new WebStandardStreamableHTTPServerTransport({
 *     sessionIdGenerator: undefined
 * });
 * ```
 *
 * @example Hono.js
 * ```ts source="./streamableHttp.examples.ts#WebStandardStreamableHTTPServerTransport_hono"
 * app.all('/mcp', async c => {
 *     // Stateless example: create a server and a transport per request.
 *     const server = new McpServer({ name: 'my-server', version: '1.0.0' });
 *     const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
 *     await server.connect(transport);
 *     return transport.handleRequest(c.req.raw);
 * });
 * ```
 *
 * @example Cloudflare Workers
 * ```ts source="./streamableHttp.examples.ts#WebStandardStreamableHTTPServerTransport_workers"
 * const worker = {
 *     async fetch(request: Request): Promise<Response> {
 *         // Stateless example: create a server and a transport per request.
 *         const server = new McpServer({ name: 'my-server', version: '1.0.0' });
 *         const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
 *         await server.connect(transport);
 *         return transport.handleRequest(request);
 *     }
 * };
 * ```
 */
declare class WebStandardStreamableHTTPServerTransport implements Transport {
  private sessionIdGenerator;
  private _started;
  private _hasHandledRequest;
  private _closed;
  private _streamMapping;
  private _requestToStreamMapping;
  private _requestResponseMap;
  private _initialized;
  private _enableJsonResponse;
  private _standaloneSseStreamId;
  private _eventStore?;
  private _onsessioninitialized?;
  private _onsessionclosed?;
  private _allowedHosts?;
  private _allowedOrigins?;
  private _enableDnsRebindingProtection;
  private _retryInterval?;
  private _supportedProtocolVersions;
  private _keepAliveMs;
  private _maxRequestBodySize;
  private _scopeChallengeResolver?;
  sessionId?: string;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage, extra?: MessageExtraInfo) => void;
  constructor(options?: WebStandardStreamableHTTPServerTransportOptions);
  private startKeepAlive;
  /** Sets the scope challenge resolver for parsed JSON-RPC requests. */
  setScopeChallengeResolver(resolver: ScopeChallengeHandler): void;
  /**
   * Starts the transport. This is required by the {@linkcode Transport} interface but is a no-op
   * for the Streamable HTTP transport as connections are managed per-request.
   */
  start(): Promise<void>;
  /**
   * Sets the supported protocol versions for header validation.
   * Called by the server during {@linkcode server/server.Server.connect | connect()} to pass its supported versions.
   */
  setSupportedProtocolVersions(versions: string[]): void;
  /**
   * Helper to create a JSON error response
   */
  private createJsonErrorResponse;
  private _checkScopeChallenge;
  /**
   * Validates request headers for DNS rebinding protection.
   * @returns Error response if validation fails, `undefined` if validation passes.
   */
  private validateRequestHeaders;
  /**
   * Handles an incoming HTTP request, whether `GET`, `POST`, or `DELETE`
   * Returns a `Response` object (Web Standard)
   */
  handleRequest(req: Request, options?: HandleRequestOptions): Promise<Response>;
  /**
   * Returns true if the client's protocol version supports empty SSE data in
   * priming events (the fix shipped with protocol version `2025-11-25`).
   *
   * The version is checked for membership in this transport instance's
   * supported protocol versions rather than with an open-ended
   * `>= '2025-11-25'` comparison: the value may come from an `initialize`
   * request body, which (unlike the `MCP-Protocol-Version` header) is not
   * validated against `supportedProtocolVersions` before reaching this
   * check. An unknown future version string must not silently enable
   * behavior reserved for versions this transport actually supports.
   */
  private supportsEmptySSEData;
  /**
   * Writes a priming event to establish resumption capability.
   * Only sends if `eventStore` is configured (opt-in for resumability) and
   * the client's protocol version supports empty SSE data (a supported
   * version that is >= `2025-11-25`).
   */
  private writePrimingEvent;
  /**
   * Handles `GET` requests for SSE stream
   */
  private handleGetRequest;
  /**
   * Replays events that would have been sent after the specified event ID
   * Only used when resumability is enabled
   */
  private replayEvents;
  /**
   * Writes an event to an SSE stream via controller with proper formatting
   */
  private writeSSEEvent;
  /**
   * Handles unsupported requests (`PUT`, `PATCH`, etc.)
   */
  private handleUnsupportedRequest;
  /**
   * Handles `POST` requests containing JSON-RPC messages
   */
  private handlePostRequest;
  /**
   * Handles `DELETE` requests to terminate sessions
   */
  private handleDeleteRequest;
  /**
   * Validates session ID for non-initialization requests.
   * Returns `Response` error if invalid, `undefined` otherwise
   */
  private validateSession;
  /**
   * Validates the `MCP-Protocol-Version` header on incoming requests.
   *
   * For initialization: Version negotiation handles unknown versions gracefully
   * (server responds with its supported version).
   *
   * For subsequent requests with `MCP-Protocol-Version` header:
   * - Accept if in supported list
   * - 400 if unsupported
   *
   * For HTTP requests without the `MCP-Protocol-Version` header:
   * - Accept and default to the version negotiated at initialization
   */
  private validateProtocolVersion;
  close(): Promise<void>;
  /**
   * Close an SSE stream for a specific request, triggering client reconnection.
   * Use this to implement polling behavior during long-running operations -
   * client will reconnect after the retry interval specified in the priming event.
   */
  closeSSEStream(requestId: RequestId): void;
  /**
   * Close the standalone `GET` SSE stream, triggering client reconnection.
   * Use this to implement polling behavior for server-initiated notifications.
   */
  closeStandaloneSSEStream(): void;
  send(message: JSONRPCMessage, options?: {
    relatedRequestId?: RequestId;
  }): Promise<void>;
}
//#endregion
//#region src/server/requestBody.d.ts
/** Default upper bound, in bytes, on a request body read by the HTTP entry points (4 MiB). */
declare const DEFAULT_MAX_REQUEST_BODY_SIZE: number;
/**
 * Reads a request body as text, up to `maxBytes` (default
 * {@linkcode DEFAULT_MAX_REQUEST_BODY_SIZE}). A declared `Content-Length` over the
 * limit is refused without reading anything; otherwise the read stops as soon as
 * more than the limit has arrived. Stream failures propagate.
 */
declare function readRequestBody(request: Request, maxBytes?: number): Promise<{
  tooLarge: true;
} | {
  tooLarge: false;
  text: string;
}>;
//#endregion
//#region src/fromJsonSchema.d.ts
declare function fromJsonSchema<T = unknown>(schema: JsonSchemaType, validator?: jsonSchemaValidator): StandardSchemaWithJSON<T, T>;
//#endregion
export { Annotations, type AnyToolHandler, AudioContent, AuthInfo, type AuthMetadataOptions, type AuthorizationServerMetadata, BAGGAGE_META_KEY, type BaseContext, BaseMetadata, type BaseToolCallback, type BearerAuthOptions, BlobResourceContents, BooleanSchema, CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, type CacheHint, type CacheScope, CallToolRequest, CallToolRequestParams, CallToolResult, CancelTaskRequest, CancelTaskResult, CancelledNotification, CancelledNotificationParams, ClientCapabilities, type ClientContext, ClientNotification, ClientRequest, ClientResult, CompatibilityCallToolResult, type CompletableSchema, type CompleteCallback, CompleteRequest, CompleteRequestParams, CompleteRequestPrompt, CompleteRequestResourceTemplate, type CompleteResourceTemplateCallback, CompleteResult, ContentBlock, type CreateMcpHandlerOptions, CreateMessageRequest, CreateMessageRequestParams, CreateMessageRequestParamsBase, CreateMessageRequestParamsWithTools, CreateMessageResult, CreateMessageResultWithTools, CreateTaskResult, Cursor, DEFAULT_MAX_REQUEST_BODY_SIZE, DEFAULT_NEGOTIATED_PROTOCOL_VERSION, DEFAULT_REQUEST_TIMEOUT_MSEC, DiscoverRequest, DiscoverResult, type ElicitInputParams, ElicitRequest, ElicitRequestFormParams, ElicitRequestParams, ElicitRequestURLParams, ElicitResult, ElicitationCompleteNotification, ElicitationCompleteNotificationParams, EmbeddedResource, EmptyResult, EnumSchema, type EventId, type EventStore, type FetchLike, GetPromptRequest, GetPromptRequestParams, GetPromptResult, GetTaskPayloadRequest, GetTaskPayloadResult, GetTaskRequest, GetTaskResult, type HandleRequestOptions, HandlerResultTypeMap, type HostHeaderValidationResult, INTERNAL_ERROR, INVALID_PARAMS, INVALID_REQUEST, Icon, Icons, type IdJagTokenExchangeResponse, ImageContent, Implementation, InMemoryServerEventBus, InMemoryTransport, type InboundClassificationOutcome, type InboundHttpRequest, type InboundLadderRejection, type InboundLegacyRoute, type InboundLegacyRouteReason, type InboundModernRoute, type InboundValidationRung, InitializeRequest, InitializeRequestParams, InitializeResult, InitializedNotification, InputRequest, InputRequests, InputRequiredResult, type InputRequiredSpec, InputResponse, type InputResponseView, InputResponses, InternalError, InvalidParamsError, InvalidRequestError, type IsLegacyRequestOptions, JSONArray, JSONObject, JSONRPCErrorResponse, JSONRPCMessage, JSONRPCNotification, JSONRPCRequest, JSONRPCResponse, JSONRPCResultResponse, JSONRPC_VERSION, JSONValue, type JsonSchemaType, type JsonSchemaValidator, type JsonSchemaValidatorResult, LATEST_PROTOCOL_VERSION, LOG_LEVEL_META_KEY, type LegacyHttpHandler, type LegacyStatelessFallbackOptions, LegacyTitledEnumSchema, ListChangedCallback, ListChangedHandlers, ListChangedOptions, ListPromptsRequest, ListPromptsResult, ListResourceTemplatesRequest, ListResourceTemplatesResult, type ListResourcesCallback, ListResourcesRequest, ListResourcesResult, ListRootsRequest, ListRootsResult, ListTasksRequest, ListTasksResult, ListToolsRequest, ListToolsResult, LoggingLevel, LoggingMessageNotification, LoggingMessageNotificationParams, METHOD_NOT_FOUND, type McpHandlerRequestOptions, type McpHttpHandler, type McpRequestContext, McpServer, type McpServerFactory, type McpServerOptions, MessageClassification, MessageExtraInfo, MetaObject, MethodNotFoundError, MissingRequiredClientCapabilityError, MissingRequiredClientCapabilityErrorData, ModelHint, ModelPreferences, MultiSelectEnumSchema, Notification, NotificationMethod, type NotificationOptions, NotificationParams, NotificationTypeMap, NumberSchema, type OAuthClientInformation, type OAuthClientInformationFull, type OAuthClientInformationMixed, type OAuthClientMetadata, type OAuthClientRegistrationError, OAuthError, OAuthErrorCode, type OAuthErrorResponse, type OAuthMetadata, type OAuthProtectedResourceMetadata, type OAuthTokenRevocationRequest, type OAuthTokenVerifier, type OAuthTokens, type OpenIdProviderDiscoveryMetadata, type OpenIdProviderMetadata, type OriginValidationResult, PARSE_ERROR, PROTOCOL_VERSION_META_KEY, PaginatedRequest, PaginatedRequestParams, PaginatedResult, ParseError, PerRequestHTTPServerTransport, type PerRequestHTTPServerTransportOptions, type PerRequestMessageExtra, type PerRequestResponseMode, PingRequest, PrimitiveSchemaDefinition, Progress, type ProgressCallback, ProgressNotification, ProgressNotificationParams, ProgressToken, Prompt, PromptArgument, type PromptCallback, PromptListChangedNotification, PromptMessage, PromptReference, Protocol, type ProtocolEra, ProtocolError, ProtocolErrorCode, type ProtocolOptions, RELATED_TASK_META_KEY, ReadBuffer, type ReadResourceCallback, ReadResourceRequest, ReadResourceRequestParams, ReadResourceResult, type ReadResourceTemplateCallback, type RegisteredPrompt, type RegisteredResource, type RegisteredResourceTemplate, type RegisteredTool, RelatedTaskMetadata, Request$1 as Request, type RequestHandlerSchemas, RequestId, RequestMeta, RequestMetaEnvelope, RequestMetaObject, RequestMethod, type RequestOptions, RequestParams, type RequestStateAccessor, type RequestStateCodec, type RequestStateCodecOptions, RequestTypeMap, Resource, ResourceContents, ResourceLink, ResourceListChangedNotification, type ResourceMetadata, ResourceNotFoundError, ResourceRequestParams, ResourceTemplate, ResourceTemplateReference, ResourceTemplateType, ResourceUpdatedNotification, ResourceUpdatedNotificationParams, Result, ResultMetaObject, ResultTypeMap, Role, Root, RootsListChangedNotification, SERVER_INFO_META_KEY, STDIO_DEFAULT_MAX_BUFFER_SIZE, SUBSCRIPTION_ID_META_KEY, SUPPORTED_PROTOCOL_VERSIONS, SamplingContent, SamplingMessage, SamplingMessageContentBlock, type ScopeChallenge, type ScopeChallengeHandler, SdkError, SdkErrorCode, SdkHttpError, type SdkHttpErrorData, Server, ServerCapabilities, type ServerContext, type ServerEvent, type ServerEventBus, ServerNotification, type ServerNotifier, type ServerOptions, ServerRequest, ServerResult, SetLevelRequest, SetLevelRequestParams, SingleSelectEnumSchema, type SpecTypeName, type SpecTypes, type StandardSchemaV1, type StandardSchemaV1Sync, type StandardSchemaWithJSON, type StoredOAuthClientInformation, type StoredOAuthTokens, type StreamId, StringSchema, SubscribeRequest, SubscribeRequestParams, SubscriptionFilter, SubscriptionsAcknowledgedNotification, SubscriptionsAcknowledgedNotificationParams, SubscriptionsListenRequest, SubscriptionsListenRequestParams, SubscriptionsListenResult, SubscriptionsListenResultMeta, TRACEPARENT_META_KEY, TRACESTATE_META_KEY, Task, TaskAugmentedRequestParams, TaskCreationParams, TaskMetadata, TaskStatus, TaskStatusNotification, TaskStatusNotificationParams, TextContent, TextResourceContents, TitledMultiSelectEnumSchema, TitledSingleSelectEnumSchema, Tool, ToolAnnotations, type ToolCallback, ToolChoice, ToolExecution, ToolListChangedNotification, ToolResultContent, ToolUseContent, type Transport, type TransportSendOptions, UnsubscribeRequest, UnsubscribeRequestParams, UnsupportedProtocolVersionError, UnsupportedProtocolVersionErrorData, UntitledMultiSelectEnumSchema, UntitledSingleSelectEnumSchema, UriTemplate, UrlElicitationRequiredError, type Variables, type VerifyBearerTokenOptions, WebStandardStreamableHTTPServerTransport, type WebStandardStreamableHTTPServerTransportOptions, acceptedContent, assertCompleteRequestPrompt, assertCompleteRequestResourceTemplate, bearerAuthChallengeResponse, buildOAuthProtectedResourceMetadata, checkResourceAllowed, classifyInboundRequest, completable, createFetchWithInit, createMcpHandler, createRequestStateCodec, deserializeMessage, fromJsonSchema, getDisplayName, getOAuthProtectedResourceMetadataUrl, hostHeaderValidationResponse, inputRequired, inputResponse, isCallToolResult, isCompletable, isInitializeRequest, isInitializedNotification, isInputRequiredResult, isJSONRPCErrorResponse, isJSONRPCNotification, isJSONRPCRequest, isJSONRPCResponse, isJSONRPCResultResponse, isJsonContentType, isLegacyRequest, isSpecType, isTaskAugmentedRequestParams, type jsonSchemaValidator, legacyStatelessFallback, localhostAllowedHostnames, localhostAllowedOrigins, mergeCapabilities, oauthMetadataResponse, originValidationResponse, parseJSONRPCMessage, preloadSchemas, readRequestBody, requireBearerAuth, requireScopes, resourceUrlFromServerUrl, serializeMessage, specTypeSchemas, validateHostHeader, validateOriginHeader, verifyBearerToken };
//# sourceMappingURL=index.d.mts.map