const require_chunk = require('./chunk-Bnu9O96Y.cjs');
const require_src = require('./src-BvE2tDzk.cjs');
let _modelcontextprotocol_server__shims = require("@modelcontextprotocol/server/_shims");
let _modelcontextprotocol_core_internal = require("@modelcontextprotocol/core/internal");

//#region src/server/completable.ts
const COMPLETABLE_SYMBOL = Symbol.for("mcp.completable");
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
function completable(schema, complete) {
	Object.defineProperty(schema, COMPLETABLE_SYMBOL, {
		value: { complete },
		enumerable: false,
		writable: false,
		configurable: false
	});
	return schema;
}
/**
* Checks if a schema is completable (has completion metadata).
*/
function isCompletable(schema) {
	return !!schema && typeof schema === "object" && COMPLETABLE_SYMBOL in schema;
}
/**
* Gets the completer callback from a completable schema, if it exists.
*/
function getCompleter(schema) {
	return schema[COMPLETABLE_SYMBOL]?.complete;
}

//#endregion
//#region src/server/sseKeepAlive.ts
/** Default interval between SSE keep-alive comment frames. */
const DEFAULT_SSE_KEEP_ALIVE_MS = 15e3;
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;
/** Arms an unref'd timer, or disables keep-alive for invalid delays. */
function armSseKeepAlive(intervalMs, onTick) {
	if (!Number.isFinite(intervalMs) || intervalMs < 1) return;
	const timer = setInterval(onTick, Math.min(intervalMs, MAX_TIMER_DELAY_MS));
	timer.unref?.();
	return timer;
}

//#endregion
//#region src/server/perRequestTransport.ts
let readClassification;
/**
* The per-request micro-transport: a real, connected `Transport` whose whole
* lifetime is one HTTP exchange. See the module documentation for the
* response shapes it produces.
*
* Connecting a `Server` binds the instance to the classified modern revision
* when its `supportedProtocolVersions` lists it and the SDK implements it.
*/
var PerRequestHTTPServerTransport = class {
	static {
		readClassification = (transport) => transport._classification;
	}
	onclose;
	onerror;
	onmessage;
	_classification;
	_responseMode;
	_started = false;
	_used = false;
	_closed = false;
	_terminalDelivered = false;
	/**
	* `true` only while the inbound message is being delivered synchronously
	* to the connected protocol layer. The pre-handler gates (the era
	* registry gate, the edge→instance handoff check, the missing-handler
	* rejection) answer inside this window; request handlers always run
	* after it (the protocol layer defers them to a microtask). An error
	* sent inside the window is therefore ladder-originated, and an error
	* sent after it is handler-produced.
	*/
	_dispatchWindowOpen = false;
	_requestId;
	_deferredResponse;
	_sse;
	_abortCleanup;
	_keepAliveMs;
	constructor(options) {
		this._classification = options.classification;
		this._responseMode = options.responseMode ?? "auto";
		this._keepAliveMs = options.keepAliveMs ?? DEFAULT_SSE_KEEP_ALIVE_MS;
	}
	async start() {
		if (this._started) throw new Error("PerRequestHTTPServerTransport is already started");
		this._started = true;
	}
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
	async handleMessage(message, extra) {
		if (this._used) throw new Error("PerRequestHTTPServerTransport serves exactly one exchange; construct a new transport per request");
		if (!this._started || this.onmessage === void 0) throw new Error("PerRequestHTTPServerTransport is not connected: connect a server to this transport before handling a message");
		if (this._closed) throw new Error("PerRequestHTTPServerTransport is closed");
		this._used = true;
		const signal = extra?.request?.signal;
		if (signal?.aborted) {
			await this.close();
			throw new require_src.SdkError(require_src.SdkErrorCode.ConnectionClosed, "The request was aborted before it could be handled");
		}
		const messageExtra = {
			classification: this._classification,
			...extra?.request !== void 0 && { request: extra.request },
			...extra?.authInfo !== void 0 && { authInfo: extra.authInfo }
		};
		if (require_src.isJSONRPCRequest(message)) {
			this._requestId = message.id;
			let resolve;
			let reject;
			const promise = new Promise((promiseResolve, promiseReject) => {
				resolve = promiseResolve;
				reject = promiseReject;
			});
			this._deferredResponse = {
				promise,
				resolve,
				reject,
				settled: false
			};
			if (signal !== void 0) {
				const onAbort = () => void this.close();
				signal.addEventListener("abort", onAbort, { once: true });
				this._abortCleanup = () => signal.removeEventListener("abort", onAbort);
			}
			this._dispatchWindowOpen = true;
			try {
				this.onmessage(message, messageExtra);
			} finally {
				this._dispatchWindowOpen = false;
			}
			if (this._responseMode === "sse" && !this._closed && !this._deferredResponse.settled) this.upgradeToSse();
			return promise;
		}
		this.onmessage(message, messageExtra);
		return new Response(null, { status: 202 });
	}
	async send(message, options) {
		if (this._closed) return;
		const isResponse = require_src.isJSONRPCResultResponse(message) || require_src.isJSONRPCErrorResponse(message);
		const relatedId = isResponse ? message.id : options?.relatedRequestId;
		if (this._requestId === void 0 || relatedId === void 0 || relatedId !== this._requestId) {
			if (isResponse) this.onerror?.(/* @__PURE__ */ new Error(`Received a response for an unknown request id: ${String(message.id)}`));
			return;
		}
		if (isResponse) {
			if (this._terminalDelivered) return;
			this._terminalDelivered = true;
			const errorCode = require_src.isJSONRPCErrorResponse(message) ? message.error.code : void 0;
			const ladderStatus = errorCode !== void 0 && (this._dispatchWindowOpen || errorCode === require_src.ProtocolErrorCode.MissingRequiredClientCapability) ? require_src.LADDER_ERROR_HTTP_STATUS[errorCode] : void 0;
			if (ladderStatus !== void 0 && this._sse === void 0) {
				this.settleResponse(Response.json(message, {
					status: ladderStatus,
					headers: { "Content-Type": "application/json" }
				}));
				queueMicrotask(() => void this.close());
				return;
			}
			if (this._sse !== void 0 || this._responseMode === "sse") {
				if (this._sse === void 0) this.upgradeToSse();
				this.writeMessageFrame(message);
				this.finalizeStream();
				return;
			}
			this.settleResponse(Response.json(message, {
				status: 200,
				headers: { "Content-Type": "application/json" }
			}));
			queueMicrotask(() => void this.close());
			return;
		}
		if (this._responseMode === "json") return;
		if (this._sse === void 0) this.upgradeToSse();
		this.writeMessageFrame(message);
	}
	/**
	* Writes an SSE comment frame (a keep-alive heartbeat). Dropped when the
	* exchange is not currently streaming.
	*/
	writeCommentFrame(comment) {
		if (this._closed || this._sse === void 0 || this._sse.closed) return;
		const frame = comment.split("\n").map((line) => `: ${line}`).join("\n");
		this.writeFrame(`${frame}\n\n`);
	}
	async close() {
		if (this._closed) return;
		this._closed = true;
		this._abortCleanup?.();
		this._abortCleanup = void 0;
		if (this._sse?.keepAliveTimer !== void 0) clearInterval(this._sse.keepAliveTimer);
		if (this._sse !== void 0 && !this._sse.closed) {
			this._sse.closed = true;
			try {
				this._sse.controller.close();
			} catch {}
		}
		if (this._deferredResponse !== void 0 && !this._deferredResponse.settled) {
			this._deferredResponse.settled = true;
			this._deferredResponse.reject(new require_src.SdkError(require_src.SdkErrorCode.ConnectionClosed, "Connection closed before a response was produced"));
		}
		this.onclose?.();
	}
	settleResponse(response) {
		if (this._deferredResponse === void 0 || this._deferredResponse.settled) return;
		this._deferredResponse.settled = true;
		this._deferredResponse.resolve(response);
	}
	upgradeToSse() {
		let controller;
		const readable = new ReadableStream({
			start: (streamController) => {
				controller = streamController;
			},
			cancel: () => {
				this.close();
			}
		});
		this._sse = {
			controller,
			encoder: new TextEncoder(),
			closed: false
		};
		this._sse.keepAliveTimer = armSseKeepAlive(this._keepAliveMs, () => this.writeCommentFrame("keepalive"));
		this.settleResponse(new Response(readable, {
			status: 200,
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no"
			}
		}));
	}
	finalizeStream() {
		if (this._sse?.keepAliveTimer !== void 0) clearInterval(this._sse.keepAliveTimer);
		if (this._sse !== void 0 && !this._sse.closed) {
			this._sse.closed = true;
			try {
				this._sse.controller.close();
			} catch {}
		}
		queueMicrotask(() => void this.close());
	}
	writeMessageFrame(message) {
		this.writeFrame(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
	}
	writeFrame(frame) {
		if (this._sse === void 0 || this._sse.closed) return;
		try {
			this._sse.controller.enqueue(this._sse.encoder.encode(frame));
		} catch (error) {
			this.onerror?.(/* @__PURE__ */ new Error(`Failed to write to the response stream: ${error}`));
		}
	}
};
/** Package-internal: the classification a per-request transport serves; `undefined` for any other transport. Not public API. */
function perRequestClassificationOf(transport) {
	return transport instanceof PerRequestHTTPServerTransport ? readClassification(transport) : void 0;
}

//#endregion
//#region src/server/middleware/bearerAuth.ts
function comparableResource(value) {
	const text = String(value);
	const hash = text.indexOf("#");
	return (hash === -1 ? text : text.slice(0, hash)).replace(/\/$/, "");
}
function sameResource(reported, expected) {
	if (!reported) return false;
	return comparableResource(reported) === comparableResource(expected);
}
function headerQuotedValue(value) {
	return value.replaceAll(/[\\"]/g, String.raw`\$&`).replaceAll(/[^\u0020-\u007E]/g, " ");
}
/**
* Build a `WWW-Authenticate: Bearer …` challenge header value (RFC 6750).
*
* The single formatter behind every challenge this package emits — the
* bearer-auth 401/403 answers and the per-operation scope-challenge 403 — so
* all challenges from one server agree on parameter order and quoting. Every
* parameter value is emitted as an HTTP quoted-string with `\` and `"`
* escaped and non-printable characters replaced.
*/
function buildWwwAuthenticateHeader(errorCode, description, requiredScopes, resourceMetadataUrl) {
	let header = `Bearer error="${headerQuotedValue(errorCode)}", error_description="${headerQuotedValue(description)}"`;
	if (requiredScopes.length > 0) header += `, scope="${headerQuotedValue(requiredScopes.join(" "))}"`;
	if (resourceMetadataUrl) header += `, resource_metadata="${headerQuotedValue(resourceMetadataUrl)}"`;
	return header;
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
async function verifyBearerToken(authorizationHeader, options) {
	const { verifier, requiredScopes = [], expectedResource } = options;
	if (!authorizationHeader) throw new require_src.OAuthError(require_src.OAuthErrorCode.InvalidToken, "Missing Authorization header");
	const [type, token] = authorizationHeader.split(" ");
	if (type?.toLowerCase() !== "bearer" || !token) throw new require_src.OAuthError(require_src.OAuthErrorCode.InvalidToken, "Invalid Authorization header format, expected 'Bearer TOKEN'");
	const authInfo = await verifier.verifyAccessToken(token);
	if (expectedResource !== void 0 && !sameResource(authInfo.resource, expectedResource)) throw new require_src.OAuthError(require_src.OAuthErrorCode.InvalidToken, "Token was not issued for this resource");
	if (requiredScopes.length > 0) {
		if (!requiredScopes.every((scope) => authInfo.scopes.includes(scope))) throw new require_src.OAuthError(require_src.OAuthErrorCode.InsufficientScope, "Insufficient scope");
	}
	if (typeof authInfo.expiresAt !== "number" || Number.isNaN(authInfo.expiresAt)) throw new require_src.OAuthError(require_src.OAuthErrorCode.InvalidToken, "Token has no expiration time");
	else if (authInfo.expiresAt < Date.now() / 1e3) throw new require_src.OAuthError(require_src.OAuthErrorCode.InvalidToken, "Token has expired");
	if (options.resourceMetadataUrl !== void 0 && authInfo.resourceMetadataUrl === void 0) return {
		...authInfo,
		resourceMetadataUrl: options.resourceMetadataUrl
	};
	return authInfo;
}
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
function bearerAuthChallengeResponse(error, options) {
	const { requiredScopes = [], resourceMetadataUrl } = options ?? {};
	if (!(error instanceof require_src.OAuthError)) {
		const serverError = new require_src.OAuthError(require_src.OAuthErrorCode.ServerError, "Internal Server Error");
		return Response.json(serverError.toResponseObject(), { status: 500 });
	}
	switch (error.code) {
		case require_src.OAuthErrorCode.InvalidToken: {
			const challenge = buildWwwAuthenticateHeader(error.code, error.message, requiredScopes, resourceMetadataUrl);
			return Response.json(error.toResponseObject(), {
				status: 401,
				headers: { "WWW-Authenticate": challenge }
			});
		}
		case require_src.OAuthErrorCode.InsufficientScope: {
			const challenge = buildWwwAuthenticateHeader(error.code, error.message, requiredScopes, resourceMetadataUrl);
			return Response.json(error.toResponseObject(), {
				status: 403,
				headers: { "WWW-Authenticate": challenge }
			});
		}
		case require_src.OAuthErrorCode.ServerError: return Response.json(error.toResponseObject(), { status: 500 });
		default: return Response.json(error.toResponseObject(), { status: 400 });
	}
}
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
function requireBearerAuth(options) {
	const { verifier, requiredScopes = [], resourceMetadataUrl, expectedResource } = options;
	const resolved = {
		verifier,
		requiredScopes,
		resourceMetadataUrl,
		expectedResource
	};
	return async (request) => {
		const [authorizationHeader] = (request.headers.get("authorization") ?? "").split(",");
		try {
			return await verifyBearerToken(authorizationHeader || void 0, resolved);
		} catch (error) {
			return bearerAuthChallengeResponse(error, resolved);
		}
	};
}

//#endregion
//#region src/server/middleware/oauthMetadata.ts
function checkIssuerUrl(issuer, allowInsecure) {
	if (issuer.protocol !== "https:" && issuer.hostname !== "localhost" && issuer.hostname !== "127.0.0.1" && !allowInsecure) throw new Error("Issuer URL must be HTTPS");
	if (issuer.hash) throw new Error(`Issuer URL must not have a fragment: ${issuer}`);
	if (issuer.search) throw new Error(`Issuer URL must not have a query string: ${issuer}`);
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
function buildOAuthProtectedResourceMetadata(options) {
	checkIssuerUrl(new URL(options.oauthMetadata.issuer), options.dangerouslyAllowInsecureIssuerUrl);
	return {
		resource: options.resourceServerUrl.href,
		authorization_servers: [options.oauthMetadata.issuer],
		scopes_supported: options.scopesSupported,
		resource_name: options.resourceName,
		resource_documentation: options.serviceDocumentationUrl?.href
	};
}
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
function getOAuthProtectedResourceMetadataUrl(serverUrl) {
	const metadataUrl = new URL(serverUrl);
	metadataUrl.pathname = protectedResourceMetadataPath(serverUrl);
	metadataUrl.hash = "";
	return metadataUrl.href;
}
/** The RFC 9728 path-aware well-known path for a resource URL. */
function protectedResourceMetadataPath(resourceServerUrl) {
	const rsPath = stripTrailingSlash(resourceServerUrl.pathname);
	return `/.well-known/oauth-protected-resource${rsPath === "/" ? "" : rsPath}`;
}
function stripTrailingSlash(path) {
	return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}
const ALLOWED_METHODS = "GET, HEAD, OPTIONS";
function metadataDocumentResponse(request, metadata) {
	if (request.method === "OPTIONS") {
		const requestedHeaders = request.headers.get("access-control-request-headers");
		return new Response(null, {
			status: 204,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": ALLOWED_METHODS,
				...requestedHeaders === null ? {} : {
					"Access-Control-Allow-Headers": requestedHeaders,
					Vary: "Access-Control-Request-Headers"
				}
			}
		});
	}
	if (request.method !== "GET" && request.method !== "HEAD") {
		const error = new require_src.OAuthError(require_src.OAuthErrorCode.MethodNotAllowed, `The method ${request.method} is not allowed for this endpoint`);
		return Response.json(error.toResponseObject(), {
			status: 405,
			headers: {
				Allow: ALLOWED_METHODS,
				"Access-Control-Allow-Origin": "*"
			}
		});
	}
	const response = Response.json(metadata, { headers: { "Access-Control-Allow-Origin": "*" } });
	return request.method === "HEAD" ? new Response(null, {
		status: response.status,
		headers: response.headers
	}) : response;
}
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
function oauthMetadataResponse(request, options) {
	const requestPath = stripTrailingSlash(new URL(request.url).pathname);
	if (requestPath === protectedResourceMetadataPath(options.resourceServerUrl)) return metadataDocumentResponse(request, buildOAuthProtectedResourceMetadata(options));
	if (requestPath === "/.well-known/oauth-authorization-server") {
		buildOAuthProtectedResourceMetadata(options);
		return metadataDocumentResponse(request, options.oauthMetadata);
	}
}

//#endregion
//#region src/server/scopeChallenge.ts
/** @internal */
function supportsScopeChallengeResolver(transport) {
	return typeof transport === "object" && transport !== null && "setScopeChallengeResolver" in transport && typeof transport.setScopeChallengeResolver === "function";
}
function assertScope(scope, location) {
	if (typeof scope !== "string" || !/^[\u0021\u0023-\u005B\u005D-\u007E]+$/.test(scope)) throw new TypeError(`${location} must satisfy the OAuth scope-token grammar`);
}
function validateScopeChallenge(challenge) {
	if (challenge === null || typeof challenge !== "object" || !Array.isArray(challenge.scopes) || challenge.scopes.length === 0) throw new TypeError("scope challenge must contain at least one scope");
	for (const [index, scope] of challenge.scopes.entries()) assertScope(scope, `scope challenge scopes[${index}]`);
	if (challenge.errorDescription !== void 0 && typeof challenge.errorDescription !== "string") throw new TypeError("scope challenge errorDescription must be a string");
	if (challenge.errorDescription !== void 0 && !/^[\u0020-\u0021\u0023-\u005B\u005D-\u007E]+$/.test(challenge.errorDescription)) throw new TypeError("scope challenge errorDescription must satisfy the RFC 6750 error-description grammar");
	return challenge;
}
/**
* Creates a handler that requires every supplied scope exactly.
*
* Requests without authentication are left to the server's authentication gate.
*/
function requireScopes(...scopes) {
	if (scopes.length === 0) throw new TypeError("requireScopes must contain at least one scope");
	for (const [index, scope] of scopes.entries()) assertScope(scope, `requireScopes scope[${index}]`);
	const requiredScopes = [...scopes];
	return ({ authInfo }) => {
		if (authInfo === void 0) return;
		const activeScopes = new Set(authInfo.scopes);
		if (requiredScopes.every((scope) => activeScopes.has(scope))) return;
		return { scopes: requiredScopes };
	};
}
/** @internal */
async function findScopeChallenge(requests, authInfo, resolve) {
	for (const request of requests) {
		const challenge = await resolve({
			request,
			...authInfo !== void 0 && { authInfo }
		});
		if (challenge !== void 0) return validateScopeChallenge(challenge);
	}
}
/**
* The RFC 9728 Protected Resource Metadata URL to advertise on a scope
* challenge, derived from the verified {@link AuthInfo}: the URL the
* authentication gate stamped (`authInfo.resourceMetadataUrl`, set by the
* bearer-auth helpers from their `resourceMetadataUrl` option), falling back
* to the well-known location for an HTTP(S) RFC 8707 `resource` identifier, or
* `undefined` when neither is available (the `resource_metadata` parameter is
* then omitted, matching the bearer-auth challenges).
*
* @internal
*/
function scopeChallengeResourceMetadataUrl(authInfo) {
	if (authInfo?.resourceMetadataUrl !== void 0) return authInfo.resourceMetadataUrl;
	if (authInfo?.resource?.protocol === "https:" || authInfo?.resource?.protocol === "http:") return getOAuthProtectedResourceMetadataUrl(authInfo.resource);
}
/** @internal */
function createScopeChallengeResponse(challenge, resourceMetadataUrl) {
	return bearerAuthChallengeResponse(new require_src.OAuthError(require_src.OAuthErrorCode.InsufficientScope, challenge.errorDescription ?? "Insufficient scope"), {
		requiredScopes: [...challenge.scopes],
		resourceMetadataUrl
	});
}

//#endregion
//#region src/server/legacyInputRequiredShim.ts
/**
* Default handler re-entries per originating request — tighter than the
* client driver's 10 because the shim holds a live wire request open.
*/
const DEFAULT_LEGACY_SHIM_MAX_ROUNDS = 8;
/** Default per-leg timeout: legs are human-paced, so the 60s protocol default is wrong. */
const DEFAULT_LEGACY_SHIM_ROUND_TIMEOUT_MS = 6e5;
/** Resolves and validates `ServerOptions.inputRequired`, failing loudly at construction time. */
function resolveLegacyShimOptions(options) {
	if (options?.maxRounds !== void 0 && (!Number.isInteger(options.maxRounds) || options.maxRounds < 1)) throw new RangeError(`inputRequired.maxRounds must be a positive integer (got ${options.maxRounds})`);
	if (options?.roundTimeoutMs !== void 0 && (!Number.isFinite(options.roundTimeoutMs) || options.roundTimeoutMs <= 0)) throw new RangeError(`inputRequired.roundTimeoutMs must be a positive number (got ${options.roundTimeoutMs})`);
	return {
		maxRounds: options?.maxRounds ?? DEFAULT_LEGACY_SHIM_MAX_ROUNDS,
		roundTimeoutMs: options?.roundTimeoutMs ?? DEFAULT_LEGACY_SHIM_ROUND_TIMEOUT_MS,
		legacyShim: options?.legacyShim ?? true
	};
}
/**
* Validates one `inputRequests` entry: malformed or unknown kinds are server
* bugs and fail loudly on both eras. Shared by the modern seam's capability
* check and the shim's gate.
*/
function coerceEmbeddedInputRequest(method, key, entry) {
	if (entry === null || typeof entry !== "object" || typeof entry.method !== "string") throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InternalError, `Handler for ${method} returned an invalid input request '${key}': each inputRequests entry must be an embedded elicitation/create, sampling/createMessage, or roots/list request`);
	const embedded = entry;
	const required = require_src.requiredClientCapabilitiesForInputRequest(embedded);
	if (required === void 0) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InternalError, `Handler for ${method} returned an input request '${key}' of kind '${embedded.method}', which is not an embedded request the 2026-07-28 revision defines`);
	return {
		embedded,
		required
	};
}
/**
* The 2025-11-25 URL-mode wire shape requires an `elicitationId`; the 2026
* in-band shape has none, so URL legs mint one (CSPRNG-backed, with a
* getRandomValues fallback for runtimes without `randomUUID`).
*/
function syntheticElicitationId() {
	const webCrypto = globalThis.crypto;
	if (webCrypto?.randomUUID !== void 0) return webCrypto.randomUUID();
	const bytes = new Uint8Array(16);
	webCrypto.getRandomValues(bytes);
	bytes[6] = bytes[6] & 15 | 64;
	bytes[8] = bytes[8] & 63 | 128;
	const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** Per-family surfacing: tools/call → isError result (the 2025 idiom); prompts/resources → JSON-RPC error. */
function legacyShimFailure(method, message) {
	if (method === "tools/call") return {
		content: [{
			type: "text",
			text: message
		}],
		isError: true
	};
	throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InternalError, message);
}
/** The fulfilment loop — see the module doc for the contract. */
var LegacyInputRequiredShim = class {
	constructor(_host) {
		this._host = _host;
	}
	async fulfill(method, handler, request, ctx, firstResult) {
		const { maxRounds, roundTimeoutMs } = this._host;
		const outerSignal = ctx.mcpReq.signal;
		let current = firstResult;
		let round = 0;
		while (true) {
			round += 1;
			if (round > maxRounds) return legacyShimFailure(method, require_src.inputRequiredRoundsExceededMessage(method, maxRounds));
			const inputRequests = current.inputRequests;
			const hasInputRequests = inputRequests != null && Object.keys(inputRequests).length > 0;
			const requestState = typeof current.requestState === "string" ? current.requestState : void 0;
			if (!hasInputRequests && requestState === void 0) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InternalError, `Handler for ${method} returned an input-required result with neither inputRequests nor requestState (every InputRequiredResult must include at least one of the two)`);
			let responses;
			if (hasInputRequests) {
				const declared = this._host.resolvedClientCapabilities(ctx);
				const coerced = [];
				for (const [key, entry] of Object.entries(inputRequests)) {
					const { embedded, required } = coerceEmbeddedInputRequest(method, key, entry);
					if (embedded.method !== "roots/list" && embedded.params === void 0) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InternalError, `Handler for ${method} returned an input request '${key}' of kind '${embedded.method}' without params`);
					if (require_src.missingClientCapabilities(required, declared) !== void 0) return legacyShimFailure(method, `Cannot request input '${key}' (${embedded.method}): the client on this 2025-era connection did not declare the required capability${declared === void 0 ? " (no client capabilities are available on this connection — per-request legacy serving cannot receive server-to-client requests)" : ""}`);
					coerced.push([key, embedded]);
				}
				const roundAbort = require_src.linkedRoundAbort(outerSignal);
				try {
					const legOptions = {
						relatedRequestId: ctx.mcpReq.id,
						timeout: roundTimeoutMs,
						resetTimeoutOnProgress: true,
						onprogress: () => {},
						signal: roundAbort.signal
					};
					const fulfilled = await Promise.all(coerced.map(async ([key, embedded]) => {
						try {
							return [key, await this._dispatchLeg(embedded, legOptions)];
						} catch (error) {
							roundAbort.abort(error);
							throw error;
						}
					}));
					responses = Object.fromEntries(fulfilled);
				} catch (error) {
					if (outerSignal.aborted) throw error;
					return legacyShimFailure(method, `Fulfilling input required by '${method}' failed: ${error instanceof Error ? error.message : String(error)}`);
				} finally {
					roundAbort.dispose();
				}
			} else await require_src.sleep(require_src.REQUEST_STATE_ONLY_LEG_PACING_MS, outerSignal);
			let ctxNext = {
				...ctx,
				mcpReq: {
					...ctx.mcpReq,
					inputResponses: responses,
					droppedInputResponseKeys: void 0,
					requestState: require_src.requestStateAccessor(requestState)
				}
			};
			if (requestState !== void 0) {
				const decoded = await this._host.verifyRequestState(requestState, ctxNext, method);
				if (decoded !== void 0) ctxNext = require_src.withRequestStateValue(ctxNext, decoded);
			}
			const next = await handler(request, ctxNext);
			if (!require_src.isInputRequiredResult(next)) return next;
			current = next;
		}
	}
	/** Routes one embedded request through the host's existing 2025-era senders (gate already ran). */
	async _dispatchLeg(embedded, options) {
		switch (embedded.method) {
			case "elicitation/create": {
				let params = embedded.params;
				if (params.mode === "url" && params.elicitationId === void 0) params = {
					...params,
					elicitationId: syntheticElicitationId()
				};
				return await this._host.sendElicitation(params, options);
			}
			case "sampling/createMessage": return await this._host.sendSampling(embedded.params, options);
			case "roots/list": return await this._host.listRoots(embedded.params, options);
		}
	}
};

//#endregion
//#region src/server/server.ts
/**
* The request methods whose 2026-07-28 result vocabulary includes
* `input_required` (the multi round-trip methods). Returning an
* input-required result from any other handler is a server bug.
*/
const INPUT_REQUIRED_CAPABLE_METHODS = new Set([
	"tools/call",
	"prompts/get",
	"resources/read"
]);
let writeClientIdentity;
let installDiscoverHandler;
let readServerIdentity;
/**
* Package-internal: backfills the connection-scoped client-identity fields of a
* per-request server instance from the request's validated `_meta` envelope, so the
* (deprecated) {@linkcode Server.getClientCapabilities} / {@linkcode Server.getClientVersion}
* accessors keep answering on instances that never see an `initialize` handshake.
* Not public API.
*/
function seedClientIdentityFromEnvelope(server, identity) {
	writeClientIdentity(server, identity);
}
/**
* Package-internal: installs the modern-only `server/discover` handler on an instance
* the HTTP entry has marked as serving the 2026-07-28 era, and makes sure the modern
* revisions the entry serves appear in the instance's supported-versions list (so the
* discover advertisement and version-mismatch errors name them). Idempotent.
* Hand-constructed instances are unaffected: nothing else calls this, so they keep
* answering `-32601` unless their own supported-versions list opts into a modern
* revision. Not public API.
*/
function installModernOnlyHandlers(server, servedModernVersions) {
	installDiscoverHandler(server, servedModernVersions);
}
/**
* Package-internal: the instance's implementation identity, for the serving
* entries to stamp onto entry-built results (the `subscriptions/listen`
* graceful-close result — built outside the encode seam, but the spec's
* `SubscriptionsListenResultMetaObject` extends `ResultMetaObject`, so it carries
* the serverInfo SHOULD like every other result). Not public API.
*/
function serverIdentityOf(server) {
	return readServerIdentity(server);
}
/**
* An MCP server on top of a pluggable transport.
*
* This server will automatically respond to the initialization flow as initiated from the client.
*
* @deprecated Use {@linkcode server/mcp.McpServer | McpServer} instead for the high-level API. Only use `Server` for advanced use cases.
*/
var Server = class extends require_src.Protocol {
	_clientCapabilities;
	_clientVersion;
	static {
		writeClientIdentity = (server, identity) => {
			if (identity.clientCapabilities !== void 0) server._clientCapabilities = identity.clientCapabilities;
			if (identity.clientInfo !== void 0) server._clientVersion = identity.clientInfo;
		};
		installDiscoverHandler = (server, servedModernVersions) => {
			const missing = servedModernVersions.filter((version) => !server._supportedProtocolVersions.includes(version));
			if (missing.length > 0) server._supportedProtocolVersions = [...server._supportedProtocolVersions, ...missing];
			server.setRequestHandler("server/discover", () => server._ondiscover());
		};
		readServerIdentity = (server) => server._serverInfo;
	}
	_capabilities;
	_instructions;
	_jsonSchemaValidator;
	_cacheHints;
	_requestStateVerify;
	_inputRequiredServing;
	_legacyShim;
	_boundFromTransport = false;
	/** Lazily-built legacy shim; the loop lives in legacyInputRequiredShim.ts behind a narrow host contract. */
	_legacyInputRequiredShim() {
		return this._legacyShim ??= new LegacyInputRequiredShim({
			maxRounds: this._inputRequiredServing.maxRounds,
			roundTimeoutMs: this._inputRequiredServing.roundTimeoutMs,
			resolvedClientCapabilities: (ctx) => this._inputRequestCapabilityView(ctx),
			verifyRequestState: (state, ctx, method) => this._verifyRequestState(state, ctx, method),
			sendElicitation: (params, options) => this._sendElicitationLeg(params, options, { validateAcceptedContent: false }),
			sendSampling: (params, options) => this.createMessage(params, options),
			listRoots: (params, options) => this.listRoots(params, options)
		});
	}
	/**
	* Callback for when initialization has fully completed (i.e., the client has sent an `notifications/initialized` notification).
	*/
	oninitialized;
	/**
	* Initializes this server with the given name and version information.
	*/
	constructor(_serverInfo, options) {
		super(options);
		this._serverInfo = _serverInfo;
		this._capabilities = options?.capabilities ? { ...options.capabilities } : {};
		this._instructions = options?.instructions;
		this._jsonSchemaValidator = options?.jsonSchemaValidator ?? new _modelcontextprotocol_server__shims.DefaultJsonSchemaValidator();
		this._requestStateVerify = options?.requestState?.verify;
		this._inputRequiredServing = resolveLegacyShimOptions(options?.inputRequired);
		if (options?.cacheHints !== void 0) {
			for (const [operation, hint] of Object.entries(options.cacheHints)) if (hint !== void 0) require_src.assertValidCacheHint(hint, `cacheHints['${operation}']`);
			this._cacheHints = options.cacheHints;
		}
		this.setRequestHandler("initialize", (request) => this._oninitialize(request));
		this.setNotificationHandler("notifications/initialized", () => this.oninitialized?.());
		if (require_src.modernProtocolVersions(this._supportedProtocolVersions).length > 0) this.setRequestHandler("server/discover", () => this._ondiscover());
		if (this._capabilities.logging) this._registerLoggingHandler();
	}
	/** Attaches to the given transport; rejects while this instance is connected to another one. */
	async connect(transport) {
		if (this.transport !== void 0) throw new require_src.SdkError(require_src.SdkErrorCode.AlreadyConnected, "Use a separate Server instance per connection: this instance is already connected to a transport. To connect it to a new transport, call close() first.");
		if (this._boundFromTransport) {
			this._boundFromTransport = false;
			this._negotiatedProtocolVersion = void 0;
		}
		const revision = perRequestClassificationOf(transport)?.revision;
		if (revision !== void 0 && !this._servedModernEra() && require_src.SUPPORTED_MODERN_PROTOCOL_VERSIONS.includes(revision) && require_src.modernProtocolVersions(this._supportedProtocolVersions).includes(revision)) {
			this._negotiatedProtocolVersion = revision;
			this._boundFromTransport = true;
		}
		await super.connect(transport);
	}
	/**
	* Registers the built-in `logging/setLevel` request handler.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
	* Remains functional during the deprecation window (at least twelve months).
	* Migrate to stderr logging (STDIO servers) or OpenTelemetry.
	*/
	_registerLoggingHandler() {
		this.setRequestHandler("logging/setLevel", async (request, ctx) => {
			const transportSessionId = ctx.sessionId || ctx.http?.req?.headers.get("mcp-session-id") || void 0;
			const { level } = request.params;
			const parseResult = require_src.parseSchema(_modelcontextprotocol_core_internal.LoggingLevelSchema, level);
			if (parseResult.success) this._loggingLevels.set(transportSessionId, parseResult.data);
			return {};
		});
	}
	buildContext(ctx, transportInfo) {
		const hasHttpInfo = ctx.http || transportInfo?.request || transportInfo?.closeSSEStream || transportInfo?.closeStandaloneSSEStream;
		return {
			...ctx,
			mcpReq: {
				...ctx.mcpReq,
				log: (level, data, logger) => {
					if (!this._capabilities.logging) return Promise.resolve();
					let threshold;
					if (this._servedModernEra()) {
						threshold = ctx.mcpReq.envelope?.[_modelcontextprotocol_core_internal.LOG_LEVEL_META_KEY];
						if (threshold === void 0) return Promise.resolve();
					} else threshold = this._loggingLevels.get(ctx.sessionId) ?? this._loggingLevels.get(void 0);
					if (threshold !== void 0 && this.LOG_LEVEL_SEVERITY.get(level) < this.LOG_LEVEL_SEVERITY.get(threshold)) return Promise.resolve();
					return ctx.mcpReq.notify({
						method: "notifications/message",
						params: {
							level,
							data,
							logger
						}
					});
				},
				elicitInput: (params, options) => this.elicitInput(params, options),
				requestSampling: (params, options) => this.createMessage(params, options)
			},
			http: hasHttpInfo ? {
				...ctx.http,
				req: transportInfo?.request,
				closeSSE: transportInfo?.closeSSEStream,
				closeStandaloneSSE: transportInfo?.closeStandaloneSSEStream
			} : void 0
		};
	}
	_loggingLevels = /* @__PURE__ */ new Map();
	LOG_LEVEL_SEVERITY = new Map(_modelcontextprotocol_core_internal.LoggingLevelSchema.options.map((level, index) => [level, index]));
	isMessageIgnored = (level, sessionId) => {
		const currentLevel = this._loggingLevels.get(sessionId);
		return currentLevel ? this.LOG_LEVEL_SEVERITY.get(level) < this.LOG_LEVEL_SEVERITY.get(currentLevel) : false;
	};
	/**
	* Registers new capabilities. This can only be called before connecting to a transport.
	*
	* The new capabilities will be merged with any existing capabilities previously given (e.g., at initialization).
	*/
	registerCapabilities(capabilities) {
		if (this.transport) throw new require_src.SdkError(require_src.SdkErrorCode.AlreadyConnected, "Cannot register capabilities after connecting to transport");
		const hadLogging = !!this._capabilities.logging;
		this._capabilities = require_src.mergeCapabilities(this._capabilities, capabilities);
		if (!hadLogging && this._capabilities.logging) this._registerLoggingHandler();
	}
	/**
	* Enforces server-side validation for `tools/call` results regardless of how the
	* handler was registered, attaches the configured per-operation cache hint
	* (when one exists) so the 2026-07-28 encode seam can fill `ttlMs`/`cacheScope`
	* for results that do not provide their own, and owns the multi-round-trip
	* seam: on the methods whose 2026-07-28 result vocabulary includes
	* `input_required` (`tools/call`, `prompts/get`, `resources/read`) an
	* input-required return skips result-schema validation and is checked
	* against the served era, the at-least-one rule, and the request's own
	* declared client capabilities; on every other method an input-required
	* return is a server bug and fails loudly. The hint rides a symbol-keyed
	* property that is never serialized, so 2025-era responses are unaffected.
	*/
	_wrapHandler(method, handler) {
		if (method !== "tools/call") {
			const cacheHint = this._cacheHints?.[method];
			const isInputRequiredCapable = INPUT_REQUIRED_CAPABLE_METHODS.has(method);
			if (cacheHint === void 0 && !isInputRequiredCapable) return async (request, ctx) => {
				const result = await handler(request, ctx);
				if (require_src.isInputRequiredResult(result)) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InternalError, `Handler for ${method} returned an input-required result, but only tools/call, prompts/get and resources/read support input_required (protocol revision 2026-07-28)`);
				return result;
			};
			return async (request, ctx) => {
				const result = isInputRequiredCapable ? await this._invokeInputRequiredCapableHandler(method, handler, request, ctx) : await handler(request, ctx);
				if (require_src.isInputRequiredResult(result)) {
					if (!isInputRequiredCapable) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InternalError, `Handler for ${method} returned an input-required result, but only tools/call, prompts/get and resources/read support input_required (protocol revision 2026-07-28)`);
					return result;
				}
				return cacheHint === void 0 ? result : require_src.attachCacheHintFallback(result, cacheHint);
			};
		}
		return async (request, ctx) => {
			const codec = require_src.codecForVersion(this._negotiatedProtocolVersion);
			const validatedRequest = codec.validateRequest("tools/call", request);
			if (!validatedRequest.ok) throw new require_src.ProtocolError(validatedRequest.reason === "not-in-era" ? require_src.ProtocolErrorCode.InternalError : require_src.ProtocolErrorCode.InvalidParams, validatedRequest.reason === "not-in-era" ? "No wire schema for tools/call in the resolved era" : `Invalid tools/call request: ${validatedRequest.message}`);
			const result = await this._invokeInputRequiredCapableHandler("tools/call", handler, request, ctx);
			if (require_src.isInputRequiredResult(result)) return result;
			const normalizedResult = require_src.normalizeContentlessToolResult(result);
			const validationResult = codec.validateResult("tools/call", normalizedResult);
			if (!validationResult.ok) throw new require_src.ProtocolError(validationResult.reason === "not-in-era" ? require_src.ProtocolErrorCode.InternalError : require_src.ProtocolErrorCode.InvalidParams, validationResult.reason === "not-in-era" ? "No wire schema for tools/call in the resolved era" : `Invalid tools/call result: ${validationResult.message}`);
			return validationResult.value;
		};
	}
	/**
	* Whether this instance is bound to a 2026-07-28-or-later protocol
	* revision. Era is instance state — a serving entry (`createMcpHandler`,
	* `serveStdio`) marks the instance modern at construction; a 2025-era
	* `initialize` handshake binds it legacy. The multi-round-trip seam reads
	* this directly: there is no per-request era consult.
	*/
	_servedModernEra() {
		return this._negotiatedProtocolVersion !== void 0 && require_src.isModernProtocolVersion(this._negotiatedProtocolVersion);
	}
	/**
	* Invokes a handler for one of the multi-round-trip methods and applies
	* the input-required seam:
	*
	* - a `UrlElicitationRequiredError` (or any 2025-style server→client
	*   request idiom) escaping the handler on a request served on the
	*   2026-07-28 era fails LOUDLY with a clear steer to
	*   `inputRequired.elicitUrl(...)` — the `-32042` error never reaches the
	*   2026-07-28 wire and the throw is not silently converted. Requests
	*   served on the 2025 era keep today's `-32042` behavior byte-exact (the
	*   error is rethrown unchanged).
	* - an input-required RETURN toward a 2026-07-28 request must satisfy
	*   the at-least-one rule, and every embedded request must be covered by
	*   the capabilities declared on the request's envelope (violations
	*   answer the typed `-32021` error). Toward a 2025-era request the
	*   return is fulfilled by the default-on legacy shim, whose own gate
	*   consults the initialize-declared capabilities and surfaces
	*   violations per family; `inputRequired.legacyShim: false` restores
	*   the pre-shim loud failure.
	*/
	async _invokeInputRequiredCapableHandler(method, handler, request, ctx) {
		const servedModern = this._servedModernEra();
		const rawRequestState = ctx.mcpReq.requestState();
		if (rawRequestState !== void 0 && typeof rawRequestState !== "string") throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, "Invalid or expired requestState", { reason: "invalid_request_state" });
		let ctxForHandler = ctx;
		if (typeof rawRequestState === "string") {
			const decoded = await this._verifyRequestState(rawRequestState, ctx, method);
			if (decoded !== void 0) ctxForHandler = require_src.withRequestStateValue(ctx, decoded);
		}
		let result;
		try {
			result = await handler(request, ctxForHandler);
		} catch (error) {
			if (error instanceof require_src.ProtocolError && error.code === require_src.ProtocolErrorCode.UrlElicitationRequired) {
				if (!servedModern) throw error;
				throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InternalError, `URL elicitation cannot be signalled by throwing UrlElicitationRequiredError on protocol revision ${this._negotiatedProtocolVersion}: return inputRequired({ inputRequests: { …: inputRequired.elicitUrl(...) } }) from the handler instead. The urlElicitationRequired error (-32042) of earlier revisions is not available on this revision.`);
			}
			throw error;
		}
		if (!require_src.isInputRequiredResult(result)) return result;
		if (!servedModern) {
			if (!this._inputRequiredServing.legacyShim) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InternalError, `Handler for ${method} returned an input-required result, but this request is served on protocol revision ${this._negotiatedProtocolVersion ?? _modelcontextprotocol_core_internal.LATEST_PROTOCOL_VERSION}, which has no input_required vocabulary`);
			return await this._legacyInputRequiredShim().fulfill(method, handler, request, ctxForHandler, result);
		}
		const inputRequests = result.inputRequests;
		const hasInputRequests = inputRequests != null && Object.keys(inputRequests).length > 0;
		const hasRequestState = typeof result.requestState === "string";
		if (!hasInputRequests && !hasRequestState) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InternalError, `Handler for ${method} returned an input-required result with neither inputRequests nor requestState (every InputRequiredResult must include at least one of the two)`);
		if (hasInputRequests) {
			const declared = this._inputRequestCapabilityView(ctx);
			for (const [key, entry] of Object.entries(inputRequests)) {
				const { embedded, required } = coerceEmbeddedInputRequest(method, key, entry);
				const missing = require_src.missingClientCapabilities(required, declared);
				if (missing !== void 0) throw new require_src.MissingRequiredClientCapabilityError({ requiredCapabilities: missing }, `Cannot request input '${key}' (${embedded.method}): the request's client capabilities do not declare the required capability`);
			}
		}
		return result;
	}
	/**
	* Runs the configured `requestState.verify` hook and returns its
	* resolved value (`undefined` when unconfigured or the hook returns
	* nothing). Deny-on-error: any hook failure answers the frozen `-32602`;
	* the reason goes to `onerror` only.
	*/
	async _verifyRequestState(state, ctx, method) {
		if (this._requestStateVerify === void 0) return;
		try {
			return await this._requestStateVerify(state, ctx);
		} catch (error) {
			this.onerror?.(/* @__PURE__ */ new Error(`requestState verification rejected ${method}: ${error instanceof Error ? error.message : String(error)}`));
			throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, "Invalid or expired requestState", { reason: "invalid_request_state" });
		}
	}
	/**
	* The per-request resolved client-capabilities view: the request's own
	* `_meta` envelope on the 2026 era; the `initialize`-declared state on a
	* 2025-era connection. Per-request instances that never saw an
	* initialize (stateless legacy) hold nothing, so gates refuse there.
	*/
	_inputRequestCapabilityView(ctx) {
		return this._servedModernEra() ? ctx.mcpReq.envelope?.[_modelcontextprotocol_core_internal.CLIENT_CAPABILITIES_META_KEY] : this._clientCapabilities;
	}
	/**
	* Guard for the push-style server→client request APIs ({@linkcode createMessage},
	* {@linkcode elicitInput}, {@linkcode listRoots}, {@linkcode ping}) on a
	* modern-era instance: the 2026-07-28 revision has no server→client request
	* channel, so the call fails before any wire traffic with a typed error
	* whose message steers to `inputRequired(...)`. The base era gate would
	* also reject it; this guard runs first to carry the steer.
	*/
	_assertPushApiInServedEra(method) {
		if (this._servedModernEra()) throw new require_src.SdkError(require_src.SdkErrorCode.MethodNotSupportedByProtocolVersion, `Server-to-client requests are not available on protocol revision ${this._negotiatedProtocolVersion}: '${method}' cannot be sent while serving a request on that revision. Return inputRequired({ ... }) from the handler instead — the client fulfils the embedded requests and retries the original request (multi round-trip requests).`, {
			method,
			era: "2026-07-28"
		});
	}
	assertCapabilityForMethod(method) {
		switch (method) {
			case "sampling/createMessage":
				if (!this._clientCapabilities?.sampling) throw new require_src.SdkError(require_src.SdkErrorCode.CapabilityNotSupported, `Client does not support sampling (required for ${method})`);
				break;
			case "elicitation/create":
				if (!this._clientCapabilities?.elicitation) throw new require_src.SdkError(require_src.SdkErrorCode.CapabilityNotSupported, `Client does not support elicitation (required for ${method})`);
				break;
			case "roots/list":
				if (!this._clientCapabilities?.roots) throw new require_src.SdkError(require_src.SdkErrorCode.CapabilityNotSupported, `Client does not support listing roots (required for ${method})`);
				break;
			case "ping": break;
		}
	}
	assertNotificationCapability(method) {
		switch (method) {
			case "notifications/message":
				if (!this._capabilities.logging) throw new require_src.SdkError(require_src.SdkErrorCode.CapabilityNotSupported, `Server does not support logging (required for ${method})`);
				break;
			case "notifications/resources/updated":
			case "notifications/resources/list_changed":
				if (!this._capabilities.resources) throw new require_src.SdkError(require_src.SdkErrorCode.CapabilityNotSupported, `Server does not support notifying about resources (required for ${method})`);
				break;
			case "notifications/tools/list_changed":
				if (!this._capabilities.tools) throw new require_src.SdkError(require_src.SdkErrorCode.CapabilityNotSupported, `Server does not support notifying of tool list changes (required for ${method})`);
				break;
			case "notifications/prompts/list_changed":
				if (!this._capabilities.prompts) throw new require_src.SdkError(require_src.SdkErrorCode.CapabilityNotSupported, `Server does not support notifying of prompt list changes (required for ${method})`);
				break;
			case "notifications/elicitation/complete":
				if (!this._clientCapabilities?.elicitation?.url) throw new require_src.SdkError(require_src.SdkErrorCode.CapabilityNotSupported, `Client does not support URL elicitation (required for ${method})`);
				break;
			case "notifications/cancelled": break;
			case "notifications/progress": break;
		}
	}
	assertRequestHandlerCapability(method) {
		switch (method) {
			case "completion/complete":
				if (!this._capabilities.completions) throw new require_src.SdkError(require_src.SdkErrorCode.CapabilityNotSupported, `Server does not support completions (required for ${method})`);
				break;
			case "logging/setLevel":
				if (!this._capabilities.logging) throw new require_src.SdkError(require_src.SdkErrorCode.CapabilityNotSupported, `Server does not support logging (required for ${method})`);
				break;
			case "prompts/get":
			case "prompts/list":
				if (!this._capabilities.prompts) throw new require_src.SdkError(require_src.SdkErrorCode.CapabilityNotSupported, `Server does not support prompts (required for ${method})`);
				break;
			case "resources/list":
			case "resources/templates/list":
			case "resources/read":
				if (!this._capabilities.resources) throw new require_src.SdkError(require_src.SdkErrorCode.CapabilityNotSupported, `Server does not support resources (required for ${method})`);
				break;
			case "tools/call":
			case "tools/list":
				if (!this._capabilities.tools) throw new require_src.SdkError(require_src.SdkErrorCode.CapabilityNotSupported, `Server does not support tools (required for ${method})`);
				break;
			case "ping":
			case "initialize": break;
		}
	}
	async _oninitialize(request) {
		const requestedVersion = request.params.protocolVersion;
		this._clientCapabilities = request.params.capabilities;
		this._clientVersion = request.params.clientInfo;
		const legacyVersions = require_src.legacyProtocolVersions(this._supportedProtocolVersions);
		const protocolVersion = legacyVersions.includes(requestedVersion) ? requestedVersion : legacyVersions[0] ?? _modelcontextprotocol_core_internal.LATEST_PROTOCOL_VERSION;
		this._negotiatedProtocolVersion = protocolVersion;
		this.transport?.setProtocolVersion?.(protocolVersion);
		return {
			protocolVersion,
			capabilities: this.getCapabilities(),
			serverInfo: this._serverInfo,
			...this._instructions && { instructions: this._instructions }
		};
	}
	/**
	* Answers `server/discover` (protocol revision 2026-07-28). `supportedVersions`
	* lists only modern revisions (2025-era versions are negotiated via `initialize`);
	* the capabilities are advertised as-is, listChanged/subscribe bits included
	* (see {@linkcode discoverAdvertisedCapabilities}).
	*/
	_ondiscover() {
		return {
			supportedVersions: require_src.modernProtocolVersions(this._supportedProtocolVersions),
			capabilities: discoverAdvertisedCapabilities(this.getCapabilities()),
			...this._instructions && { instructions: this._instructions }
		};
	}
	/**
	* The identity the 2026-era encode seam stamps into every outbound
	* result's `_meta` under `io.modelcontextprotocol/serverInfo` (spec PR
	* #3002: servers SHOULD identify themselves on every response).
	*/
	_outboundServerInfo() {
		return this._serverInfo;
	}
	/**
	* After initialization has completed, this will be populated with the client's reported capabilities.
	*
	* @deprecated Read client identity from the per-request handler context instead: on
	* 2026-07-28 (per-request envelope) requests `ctx.mcpReq.envelope` carries the client's
	* declared capabilities, while on 2025-era connections this accessor keeps returning the
	* `initialize`-scoped value. The accessor remains functional where `createMcpHandler`
	* serves the 2026-07-28 era: it backfills it per request from the validated envelope.
	*/
	getClientCapabilities() {
		return this._clientCapabilities;
	}
	/**
	* After initialization has completed, this will be populated with information about the client's name and version.
	*
	* @deprecated Read client identity from the per-request handler context instead: on
	* 2026-07-28 (per-request envelope) requests `ctx.mcpReq.envelope` carries the client's
	* name and version, while on 2025-era connections this accessor keeps returning the
	* `initialize`-scoped value. The accessor remains functional where `createMcpHandler`
	* serves the 2026-07-28 era: it backfills it per request from the validated envelope.
	*/
	getClientVersion() {
		return this._clientVersion;
	}
	/**
	* After initialization has completed, this will be populated with the protocol version negotiated
	* with the client (the version the server responded with during the initialize handshake), or
	* `undefined` before initialization.
	*
	* @deprecated Read the protocol revision from the per-request handler context instead: on
	* 2026-07-28 (per-request envelope) requests `ctx.mcpReq.envelope` names the revision the
	* request was sent for, while on 2025-era connections this accessor keeps returning the
	* `initialize`-negotiated version. The accessor remains functional — instances serving the
	* 2026-07-28 era report that revision.
	*/
	getNegotiatedProtocolVersion() {
		return this._negotiatedProtocolVersion;
	}
	/**
	* Project a `tools/call` result through this instance's negotiated wire
	* codec — the era-agnostic SEP-2106 §4.3 TextContent auto-append, plus on
	* the 2025 era the `{result:…}` wrap when `structuredContent` is a
	* non-object value or the advertised `outputSchema` had a non-object root.
	* Identity for object-shaped `structuredContent` on the 2026 era.
	*
	* `McpServer`'s built-in `tools/call` handler routes through this method.
	* Low-level `setRequestHandler('tools/call', …)` authors call it
	* themselves so the projection lives in one place (the codec) and the
	* server-side handler stays era-blind.
	*
	* This is the only codec function exposed on `Server` — the full
	* `WireCodec` is intentionally not part of the public surface.
	*/
	projectCallToolResult(result, advertisedOutputSchema) {
		return this._wireCodec().projectCallToolResult(result, advertisedOutputSchema);
	}
	/**
	* Returns the current server capabilities.
	*/
	getCapabilities() {
		return this._capabilities;
	}
	/**
	* Sends a `ping` request to the connected client.
	*
	* @deprecated The 2026-07-28 protocol removed ping; it throws on a 2026-07-28-era instance.
	* If your factory serves both eras, this only works on the legacy path.
	*/
	async ping() {
		this._assertPushApiInServedEra("ping");
		return this.request({ method: "ping" });
	}
	async createMessage(params, options) {
		this._assertPushApiInServedEra("sampling/createMessage");
		if ((params.tools || params.toolChoice) && !this._clientCapabilities?.sampling?.tools) throw new require_src.SdkError(require_src.SdkErrorCode.CapabilityNotSupported, "Client does not support sampling tools capability.");
		if (params.messages.length > 0) {
			const lastMessage = params.messages.at(-1);
			const lastContent = Array.isArray(lastMessage.content) ? lastMessage.content : [lastMessage.content];
			const hasToolResults = lastContent.some((c) => c.type === "tool_result");
			const previousMessage = params.messages.length > 1 ? params.messages.at(-2) : void 0;
			const previousContent = previousMessage ? Array.isArray(previousMessage.content) ? previousMessage.content : [previousMessage.content] : [];
			const hasPreviousToolUse = previousContent.some((c) => c.type === "tool_use");
			if (hasToolResults) {
				if (lastContent.some((c) => c.type !== "tool_result")) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, "The last message must contain only tool_result content if any is present");
				if (!hasPreviousToolUse) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, "tool_result blocks are not matching any tool_use from the previous message");
			}
			if (hasPreviousToolUse) {
				const toolUseIds = new Set(previousContent.filter((c) => c.type === "tool_use").map((c) => c.id));
				const toolResultIds = new Set(lastContent.filter((c) => c.type === "tool_result").map((c) => c.toolUseId));
				if (toolUseIds.size !== toolResultIds.size || ![...toolUseIds].every((id) => toolResultIds.has(id))) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, "ids of tool_result blocks and tool_use blocks from previous message do not match");
			}
		}
		const hasTools = Boolean(params.tools || params.toolChoice);
		const wide = await this.request({
			method: "sampling/createMessage",
			params
		}, options);
		const outcome = this._wireCodec().samplingResultVariant(hasTools, wide);
		if (!outcome.ok) throw new require_src.SdkError(require_src.SdkErrorCode.InvalidResult, `Invalid sampling/createMessage result: ${outcome.reason === "invalid" ? outcome.message : outcome.reason}`);
		return outcome.value;
	}
	/**
	* Creates an elicitation request for the given parameters.
	* For backwards compatibility, `mode` may be omitted for form requests and will default to `"form"`.
	* @param params The parameters for the elicitation request.
	* @param options Optional request options.
	* @returns The result of the elicitation request.
	*
	* @deprecated Throws on a 2026-07-28-era request — use {@link index.inputRequired | inputRequired} (multi-round-trip)
	* instead. The 2025 push-style server-to-client request model is replaced by input_required
	* results in the 2026-07-28 protocol. If your factory serves both eras, this only works on the
	* legacy path.
	*/
	async elicitInput(params, options) {
		this._assertPushApiInServedEra("elicitation/create");
		switch (params.mode ?? "form") {
			case "url":
				if (!this._clientCapabilities?.elicitation?.url) throw new require_src.SdkError(require_src.SdkErrorCode.CapabilityNotSupported, "Client does not support url elicitation.");
				break;
			case "form":
				if (!this._clientCapabilities?.elicitation?.form) throw new require_src.SdkError(require_src.SdkErrorCode.CapabilityNotSupported, "Client does not support form elicitation.");
				break;
		}
		return this._sendElicitationLeg(params, options);
	}
	/**
	* The capability-check-free core of {@linkcode elicitInput}. The shim
	* uses it because its gate differs from the public checks: a bare
	* `elicitation: {}` counts as form support (the pre-mode rule), and
	* accepted content passes through unvalidated for parity with the
	* modern client driver (handlers validate via the schema-aware
	* `acceptedContent` overload and can re-ask).
	*/
	async _sendElicitationLeg(params, options, behavior) {
		const mode = params.mode ?? "form";
		const validateAcceptedContent = behavior?.validateAcceptedContent ?? true;
		switch (mode) {
			case "url": {
				const urlParams = params;
				return this.request({
					method: "elicitation/create",
					params: urlParams
				}, options);
			}
			case "form": {
				const formParams = params.mode === "form" ? params : {
					...params,
					mode: "form"
				};
				const result = await this.request({
					method: "elicitation/create",
					params: formParams
				}, options);
				if (validateAcceptedContent && result.action === "accept" && result.content && formParams.requestedSchema) try {
					const validationResult = this._jsonSchemaValidator.getValidator(formParams.requestedSchema)(result.content);
					if (!validationResult.valid) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, `Elicitation response content does not match requested schema: ${validationResult.errorMessage}`);
				} catch (error) {
					if (error instanceof require_src.ProtocolError) throw error;
					throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InternalError, `Error validating elicitation response: ${error instanceof Error ? error.message : String(error)}`);
				}
				return result;
			}
		}
	}
	/**
	* Creates a reusable callback that, when invoked, will send a `notifications/elicitation/complete`
	* notification for the specified elicitation ID.
	*
	* The notification (and the `elicitationId` it references) exists only on protocol revision
	* 2025-11-25 — the 2026-07-28 revision removed both. On a connection negotiated at 2026-07-28 the
	* returned callback rejects with a typed local error before anything reaches the transport
	* (the method is not part of that revision's wire registry).
	*
	* @param elicitationId The ID of the elicitation to mark as complete.
	* @param options Optional notification options. Useful when the completion notification should be related to a prior request.
	* @returns A function that emits the completion notification when awaited.
	*/
	createElicitationCompletionNotifier(elicitationId, options) {
		if (!this._clientCapabilities?.elicitation?.url) throw new require_src.SdkError(require_src.SdkErrorCode.CapabilityNotSupported, "Client does not support URL elicitation (required for notifications/elicitation/complete)");
		return () => this.notification({
			method: "notifications/elicitation/complete",
			params: { elicitationId }
		}, options);
	}
	/**
	* Requests the list of roots from the client.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
	* Throws on a 2026-07-28-era request — use {@link index.inputRequired | inputRequired} (multi-round-trip) instead,
	* or migrate to passing paths via tool parameters, resource URIs, or configuration. The 2025
	* push-style server-to-client request model is replaced by input_required results in the
	* 2026-07-28 protocol. If your factory serves both eras, this only works on the legacy path.
	*/
	async listRoots(params, options) {
		this._assertPushApiInServedEra("roots/list");
		return this.request({
			method: "roots/list",
			params
		}, options);
	}
	/**
	* Sends a logging message to the client, if connected.
	* Note: You only need to send the parameters object, not the entire JSON-RPC message.
	* @see {@linkcode LoggingMessageNotification}
	* @param params
	* @param sessionId Optional for stateless transports and backward compatibility.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
	* Remains functional during the deprecation window (at least twelve months).
	* Migrate to stderr logging (STDIO servers) or OpenTelemetry.
	*/
	async sendLoggingMessage(params, sessionId) {
		if (this._capabilities.logging && !this.isMessageIgnored(params.level, sessionId)) return this.notification({
			method: "notifications/message",
			params
		});
	}
	async sendResourceUpdated(params) {
		return this.notification({
			method: "notifications/resources/updated",
			params
		});
	}
	async sendResourceListChanged() {
		return this.notification({ method: "notifications/resources/list_changed" });
	}
	async sendToolListChanged() {
		return this.notification({ method: "notifications/tools/list_changed" });
	}
	async sendPromptListChanged() {
		return this.notification({ method: "notifications/prompts/list_changed" });
	}
};
/**
* The capability set a server advertises on `server/discover`. Pure — never
* mutates the input; the legacy `initialize` advertisement is untouched.
*
* The serving entries serve `subscriptions/listen` themselves, so the
* `listChanged` and `resources.subscribe` capability bits are advertised
* as-is: a modern-era client uses them to decide which notification types to
* request on its listen filter.
*/
function discoverAdvertisedCapabilities(capabilities) {
	return { ...capabilities };
}

//#endregion
//#region src/server/mcp.ts
function toolInputElementCount(value, max) {
	let count = 0;
	const stack = [value];
	while (stack.length > 0) {
		const node = stack.pop();
		if (node === null || typeof node !== "object") continue;
		if (Array.isArray(node)) for (const child of node) {
			if (++count > max) return count;
			if (child !== null && typeof child === "object") stack.push(child);
		}
		else for (const key in node) {
			if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
			if (++count > max) return count;
			const child = node[key];
			if (child !== null && typeof child === "object") stack.push(child);
		}
	}
	return count;
}
function resolveMaxToolInputElements(value) {
	if (value === void 0 || value === Infinity) return void 0;
	if (typeof value !== "number" || Number.isNaN(value) || value < 1) throw new RangeError(`maxToolInputElements must be a number of at least 1, or Infinity, got ${String(value)}`);
	return value;
}
/**
* High-level MCP server that provides a simpler API for working with resources, tools, and prompts.
* For advanced usage (like sending notifications or setting custom request handlers), use the underlying
* {@linkcode Server} instance available via the {@linkcode McpServer.server | server} property.
*
* @example
* ```ts source="./mcp.examples.ts#McpServer_basicUsage"
* const server = new McpServer({
*     name: 'my-server',
*     version: '1.0.0'
* });
* ```
*/
var McpServer = class {
	/**
	* The underlying {@linkcode Server} instance, useful for advanced operations like sending notifications.
	*/
	server;
	_maxToolInputElements;
	_registeredResources = {};
	_registeredResourceTemplates = {};
	_registeredTools = {};
	_registeredPrompts = {};
	/** Per-tool JSON-converted `inputSchema`, filled on first use by `toolInputSchemaJson()`. */
	_toolInputSchemaJson = {};
	/**
	* The JSON-serialized `inputSchema` of a registered tool, or `undefined`
	* when no such tool is registered. Used by the HTTP entry's pre-dispatch
	* SEP-2243 `Mcp-Param-*` validation step (which needs the same JSON Schema
	* `tools/list` would emit, before dispatch reaches the handler).
	*
	* @internal
	*/
	toolInputSchemaJson(name) {
		const tool = this._registeredTools[name];
		if (tool === void 0 || !tool.enabled) return void 0;
		if (Object.hasOwn(this._toolInputSchemaJson, name)) return this._toolInputSchemaJson[name];
		if (tool.inputSchema === void 0) return EMPTY_OBJECT_JSON_SCHEMA;
		try {
			const json = require_src.standardSchemaToJsonSchema(tool.inputSchema, "input");
			this._toolInputSchemaJson[name] = json;
			return json;
		} catch {
			return;
		}
	}
	constructor(serverInfo, options) {
		this.server = new Server(serverInfo, options);
		this._maxToolInputElements = resolveMaxToolInputElements(options?.maxToolInputElements);
		if (options?.capabilities?.tools) this.setToolRequestHandlers();
		if (options?.capabilities?.resources) this.setResourceRequestHandlers();
		if (options?.capabilities?.prompts) this.setPromptRequestHandlers();
	}
	/**
	* Attaches to the given transport, starts it, and starts listening for messages.
	*
	* The `server` object assumes ownership of the {@linkcode Transport}, replacing any callbacks that have already been set, and expects that it is the only user of the {@linkcode Transport} instance going forward.
	*
	* @example
	* ```ts source="./mcp.examples.ts#McpServer_connect_stdio"
	* const server = new McpServer({ name: 'my-server', version: '1.0.0' });
	* const transport = new StdioServerTransport();
	* await server.connect(transport);
	* ```
	*/
	async connect(transport) {
		if (supportsScopeChallengeResolver(transport)) transport.setScopeChallengeResolver((context) => this.resolveScopeChallenge(context));
		return await this.server.connect(transport);
	}
	/**
	* Closes the connection.
	*/
	async close() {
		await this.server.close();
	}
	/** @internal */
	resolveScopeChallenge = (context) => {
		switch (context.request.method) {
			case "tools/call": {
				const toolName = context.request.params?.name;
				if (typeof toolName !== "string") return;
				const tool = this._registeredTools[toolName];
				if (tool === void 0 || !tool.enabled) return;
				return tool.scopeChallenge?.(context);
			}
			case "resources/read": {
				const resourceUri = context.request.params?.uri;
				if (typeof resourceUri !== "string") return;
				let uri;
				try {
					uri = new URL(resourceUri);
				} catch {
					return;
				}
				const resource = this._registeredResources[uri.toString()];
				if (resource !== void 0) return resource.enabled ? resource.scopeChallenge?.(context) : void 0;
				for (const template of Object.values(this._registeredResourceTemplates)) if (template.resourceTemplate.uriTemplate.match(uri.toString())) return template.enabled ? template.scopeChallenge?.(context) : void 0;
				return;
			}
			case "prompts/get": {
				const promptName = context.request.params?.name;
				if (typeof promptName !== "string") return;
				const prompt = this._registeredPrompts[promptName];
				if (prompt === void 0 || !prompt.enabled) return;
				return prompt.scopeChallenge?.(context);
			}
			default: return;
		}
	};
	_toolHandlersInitialized = false;
	setToolRequestHandlers() {
		if (this._toolHandlersInitialized) return;
		this.server.assertCanSetRequestHandler("tools/list");
		this.server.assertCanSetRequestHandler("tools/call");
		this.server.registerCapabilities({ tools: { listChanged: this.server.getCapabilities().tools?.listChanged ?? true } });
		this.server.setRequestHandler("tools/list", () => ({ tools: Object.entries(this._registeredTools).filter(([, tool]) => tool.enabled).map(([name, tool]) => {
			const toolDefinition = {
				name,
				title: tool.title,
				description: tool.description,
				inputSchema: tool.inputSchema ? convertListedInputSchema(name, tool.inputSchema) : EMPTY_OBJECT_JSON_SCHEMA,
				annotations: tool.annotations,
				icons: tool.icons,
				execution: tool.execution,
				_meta: tool._meta
			};
			if (tool.outputSchema) toolDefinition.outputSchema = require_src.standardSchemaToJsonSchema(tool.outputSchema, "output");
			return toolDefinition;
		}) }));
		this.server.setRequestHandler("tools/call", async (request, ctx) => {
			const tool = this._registeredTools[request.params.name];
			if (!tool) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, `Tool ${request.params.name} not found`);
			if (!tool.enabled) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, `Tool ${request.params.name} disabled`);
			try {
				const args = await this.validateToolInput(tool, request.params.arguments, request.params.name);
				const result = await this.executeToolHandler(tool, args, ctx);
				await this.validateToolOutput(tool, result, request.params.name);
				if (require_src.isInputRequiredResult(result)) return result;
				return this.server.projectCallToolResult(result, tool.outputSchemaJson);
			} catch (error) {
				if (error instanceof require_src.ProtocolError && error.code === require_src.ProtocolErrorCode.UrlElicitationRequired) throw error;
				return this.createToolError(error instanceof Error ? error.message : String(error));
			}
		});
		this._toolHandlersInitialized = true;
	}
	/**
	* Creates a tool error result.
	*
	* @param errorMessage - The error message.
	* @returns The tool error result.
	*/
	createToolError(errorMessage) {
		return {
			content: [{
				type: "text",
				text: errorMessage
			}],
			isError: true
		};
	}
	/**
	* Validates tool input arguments against the tool's input schema.
	*/
	async validateToolInput(tool, args, toolName) {
		if (this._maxToolInputElements !== void 0 && toolInputElementCount(args, this._maxToolInputElements) > this._maxToolInputElements) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, `Invalid arguments for tool ${toolName}: arguments contain more than the maximum of ${this._maxToolInputElements} elements`);
		if (!tool.inputSchema) return;
		const parseResult = await require_src.validateStandardSchema(tool.inputSchema, args ?? {});
		if (!parseResult.success) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, `Input validation error: Invalid arguments for tool ${toolName}: ${parseResult.error}`);
		return parseResult.data;
	}
	/**
	* Validates tool output against the tool's output schema.
	*/
	async validateToolOutput(tool, result, toolName) {
		if (!tool.outputSchema) return;
		if (require_src.isInputRequiredResult(result)) return;
		if (result.isError) return;
		if (result.structuredContent === void 0) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, `Output validation error: Tool ${toolName} has an output schema but no structured content was provided`);
		const parseResult = await require_src.validateStandardSchema(tool.outputSchema, result.structuredContent);
		if (!parseResult.success) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, `Output validation error: Invalid structured content for tool ${toolName}: ${parseResult.error}`);
	}
	/**
	* Executes a tool handler.
	*/
	async executeToolHandler(tool, args, ctx) {
		return tool.executor(args, ctx);
	}
	_completionHandlerInitialized = false;
	setCompletionRequestHandler() {
		if (this._completionHandlerInitialized) return;
		this.server.assertCanSetRequestHandler("completion/complete");
		this.server.registerCapabilities({ completions: {} });
		this.server.setRequestHandler("completion/complete", async (request) => {
			switch (request.params.ref.type) {
				case "ref/prompt":
					require_src.assertCompleteRequestPrompt(request);
					return this.handlePromptCompletion(request, request.params.ref);
				case "ref/resource":
					require_src.assertCompleteRequestResourceTemplate(request);
					return this.handleResourceCompletion(request, request.params.ref);
				default: throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, `Invalid completion reference: ${request.params.ref}`);
			}
		});
		this._completionHandlerInitialized = true;
	}
	async handlePromptCompletion(request, ref) {
		const prompt = this._registeredPrompts[ref.name];
		if (!prompt) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, `Prompt ${ref.name} not found`);
		if (!prompt.enabled) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, `Prompt ${ref.name} disabled`);
		if (!prompt.argsSchema) return EMPTY_COMPLETION_RESULT;
		const field = unwrapOptionalSchema(getSchemaShape(prompt.argsSchema)?.[request.params.argument.name]);
		if (!isCompletable(field)) return EMPTY_COMPLETION_RESULT;
		const completer = getCompleter(field);
		if (!completer) return EMPTY_COMPLETION_RESULT;
		return createCompletionResult(await completer(request.params.argument.value, request.params.context));
	}
	async handleResourceCompletion(request, ref) {
		const template = Object.values(this._registeredResourceTemplates).find((t) => t.resourceTemplate.uriTemplate.toString() === ref.uri);
		if (!template) {
			if (this._registeredResources[ref.uri]) return EMPTY_COMPLETION_RESULT;
			throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, `Resource template ${request.params.ref.uri} not found`);
		}
		const completer = template.resourceTemplate.completeCallback(request.params.argument.name);
		if (!completer) return EMPTY_COMPLETION_RESULT;
		return createCompletionResult(await completer(request.params.argument.value, request.params.context));
	}
	_resourceHandlersInitialized = false;
	setResourceRequestHandlers() {
		if (this._resourceHandlersInitialized) return;
		this.server.assertCanSetRequestHandler("resources/list");
		this.server.assertCanSetRequestHandler("resources/templates/list");
		this.server.assertCanSetRequestHandler("resources/read");
		this.server.registerCapabilities({ resources: { listChanged: this.server.getCapabilities().resources?.listChanged ?? true } });
		this.server.setRequestHandler("resources/list", async (_request, ctx) => {
			const resources = Object.entries(this._registeredResources).filter(([_, resource]) => resource.enabled).map(([uri, resource]) => ({
				uri,
				name: resource.name,
				...resource.metadata
			}));
			const templateResources = [];
			for (const template of Object.values(this._registeredResourceTemplates)) {
				if (!template.resourceTemplate.listCallback) continue;
				const result = await template.resourceTemplate.listCallback(ctx);
				for (const resource of result.resources) templateResources.push({
					...template.metadata,
					...resource
				});
			}
			return { resources: [...resources, ...templateResources] };
		});
		this.server.setRequestHandler("resources/templates/list", async () => {
			return { resourceTemplates: Object.entries(this._registeredResourceTemplates).map(([name, template]) => ({
				name,
				uriTemplate: template.resourceTemplate.uriTemplate.toString(),
				...template.metadata
			})) };
		});
		this.server.setRequestHandler("resources/read", async (request, ctx) => {
			let uri;
			try {
				uri = new URL(request.params.uri);
			} catch {
				throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, `Resource URI ${request.params.uri} is invalid`, {
					uri: request.params.uri,
					reason: "invalid_uri"
				});
			}
			const resource = this._registeredResources[uri.toString()];
			if (resource) {
				if (!resource.enabled) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, `Resource ${uri} disabled`);
				return require_src.attachCacheHintFallback(await resource.readCallback(uri, ctx), resource.cacheHint);
			}
			for (const template of Object.values(this._registeredResourceTemplates)) {
				const variables = template.resourceTemplate.uriTemplate.match(uri.toString());
				if (variables) {
					if (!template.enabled) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, `Resource template ${template.resourceTemplate.uriTemplate} disabled`);
					return require_src.attachCacheHintFallback(await template.readCallback(uri, variables, ctx), template.cacheHint);
				}
			}
			throw new require_src.ResourceNotFoundError(request.params.uri);
		});
		this._resourceHandlersInitialized = true;
	}
	_promptHandlersInitialized = false;
	setPromptRequestHandlers() {
		if (this._promptHandlersInitialized) return;
		this.server.assertCanSetRequestHandler("prompts/list");
		this.server.assertCanSetRequestHandler("prompts/get");
		this.server.registerCapabilities({ prompts: { listChanged: this.server.getCapabilities().prompts?.listChanged ?? true } });
		this.server.setRequestHandler("prompts/list", () => ({ prompts: Object.entries(this._registeredPrompts).filter(([, prompt]) => prompt.enabled).map(([name, prompt]) => {
			return {
				name,
				title: prompt.title,
				description: prompt.description,
				arguments: prompt.argsSchema ? require_src.promptArgumentsFromStandardSchema(prompt.argsSchema) : void 0,
				icons: prompt.icons,
				_meta: prompt._meta
			};
		}) }));
		this.server.setRequestHandler("prompts/get", async (request, ctx) => {
			const prompt = this._registeredPrompts[request.params.name];
			if (!prompt) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, `Prompt ${request.params.name} not found`);
			if (!prompt.enabled) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, `Prompt ${request.params.name} disabled`);
			return prompt.handler(request.params.arguments, ctx);
		});
		this._promptHandlersInitialized = true;
	}
	registerResource(name, uriOrTemplate, config, readCallback) {
		const { cacheHint, scopeChallenge, ...resourceMetadata } = config;
		const metadata = resourceMetadata;
		if (cacheHint !== void 0) require_src.assertValidCacheHint(cacheHint, `resource ${name}`);
		if (typeof uriOrTemplate === "string") {
			if (this._registeredResources[uriOrTemplate]) throw new Error(`Resource ${uriOrTemplate} is already registered`);
			const registeredResource = this._createRegisteredResource(name, config.title, uriOrTemplate, metadata, scopeChallenge, readCallback);
			if (cacheHint !== void 0) registeredResource.cacheHint = cacheHint;
			this.setResourceRequestHandlers();
			this.sendResourceListChanged();
			return registeredResource;
		} else {
			if (this._registeredResourceTemplates[name]) throw new Error(`Resource template ${name} is already registered`);
			const registeredResourceTemplate = this._createRegisteredResourceTemplate(name, config.title, uriOrTemplate, metadata, scopeChallenge, readCallback);
			if (cacheHint !== void 0) registeredResourceTemplate.cacheHint = cacheHint;
			this.setResourceRequestHandlers();
			this.sendResourceListChanged();
			return registeredResourceTemplate;
		}
	}
	_createRegisteredResource(name, title, uri, metadata, scopeChallenge, readCallback) {
		const registeredResource = {
			name,
			title,
			metadata,
			readCallback,
			scopeChallenge,
			enabled: true,
			disable: () => registeredResource.update({ enabled: false }),
			enable: () => registeredResource.update({ enabled: true }),
			remove: () => registeredResource.update({ uri: null }),
			update: (updates) => {
				if (updates.uri !== void 0 && updates.uri !== uri) {
					delete this._registeredResources[uri];
					if (updates.uri) this._registeredResources[updates.uri] = registeredResource;
				}
				if (updates.name !== void 0) registeredResource.name = updates.name;
				if (updates.metadata !== void 0) registeredResource.metadata = updates.metadata;
				if (updates.title !== void 0) {
					registeredResource.title = updates.title;
					registeredResource.metadata = {
						...registeredResource.metadata,
						title: updates.title
					};
				}
				if (updates.callback !== void 0) registeredResource.readCallback = updates.callback;
				if (updates.scopeChallenge !== void 0) registeredResource.scopeChallenge = updates.scopeChallenge === null ? void 0 : updates.scopeChallenge;
				if (updates.enabled !== void 0) registeredResource.enabled = updates.enabled;
				this.sendResourceListChanged();
			}
		};
		this._registeredResources[uri] = registeredResource;
		return registeredResource;
	}
	_createRegisteredResourceTemplate(name, title, template, metadata, scopeChallenge, readCallback) {
		const registeredResourceTemplate = {
			resourceTemplate: template,
			title,
			metadata,
			readCallback,
			scopeChallenge,
			enabled: true,
			disable: () => registeredResourceTemplate.update({ enabled: false }),
			enable: () => registeredResourceTemplate.update({ enabled: true }),
			remove: () => registeredResourceTemplate.update({ name: null }),
			update: (updates) => {
				if (updates.name !== void 0 && updates.name !== name) {
					delete this._registeredResourceTemplates[name];
					if (updates.name) this._registeredResourceTemplates[updates.name] = registeredResourceTemplate;
				}
				if (updates.template !== void 0) registeredResourceTemplate.resourceTemplate = updates.template;
				if (updates.metadata !== void 0) registeredResourceTemplate.metadata = updates.metadata;
				if (updates.title !== void 0) {
					registeredResourceTemplate.title = updates.title;
					registeredResourceTemplate.metadata = {
						...registeredResourceTemplate.metadata,
						title: updates.title
					};
				}
				if (updates.callback !== void 0) registeredResourceTemplate.readCallback = updates.callback;
				if (updates.scopeChallenge !== void 0) registeredResourceTemplate.scopeChallenge = updates.scopeChallenge === null ? void 0 : updates.scopeChallenge;
				if (updates.enabled !== void 0) registeredResourceTemplate.enabled = updates.enabled;
				this.sendResourceListChanged();
			}
		};
		this._registeredResourceTemplates[name] = registeredResourceTemplate;
		const variableNames = template.uriTemplate.variableNames;
		if (Array.isArray(variableNames) && variableNames.some((v) => !!template.completeCallback(v))) this.setCompletionRequestHandler();
		return registeredResourceTemplate;
	}
	_createRegisteredPrompt(name, title, description, argsSchema, callback, icons, scopeChallenge, _meta) {
		let currentArgsSchema = argsSchema;
		let currentCallback = callback;
		const registeredPrompt = {
			title,
			description,
			argsSchema,
			icons,
			scopeChallenge,
			_meta,
			handler: createPromptHandler(name, argsSchema, callback),
			enabled: true,
			disable: () => registeredPrompt.update({ enabled: false }),
			enable: () => registeredPrompt.update({ enabled: true }),
			remove: () => registeredPrompt.update({ name: null }),
			update: (updates) => {
				if (updates.name !== void 0 && updates.name !== name) {
					delete this._registeredPrompts[name];
					if (updates.name) this._registeredPrompts[updates.name] = registeredPrompt;
				}
				if (updates.title !== void 0) registeredPrompt.title = updates.title;
				if (updates.description !== void 0) registeredPrompt.description = updates.description;
				if (updates.icons !== void 0) registeredPrompt.icons = updates.icons;
				if (updates.scopeChallenge !== void 0) registeredPrompt.scopeChallenge = updates.scopeChallenge === null ? void 0 : updates.scopeChallenge;
				if (updates._meta !== void 0) registeredPrompt._meta = updates._meta;
				let needsHandlerRegen = false;
				if (updates.argsSchema !== void 0) {
					registeredPrompt.argsSchema = updates.argsSchema;
					currentArgsSchema = updates.argsSchema;
					needsHandlerRegen = true;
				}
				if (updates.callback !== void 0) {
					currentCallback = updates.callback;
					needsHandlerRegen = true;
				}
				if (needsHandlerRegen) registeredPrompt.handler = createPromptHandler(name, currentArgsSchema, currentCallback);
				if (updates.enabled !== void 0) registeredPrompt.enabled = updates.enabled;
				this.sendPromptListChanged();
			}
		};
		this._registeredPrompts[name] = registeredPrompt;
		if (argsSchema) {
			const shape = getSchemaShape(argsSchema);
			if (shape) {
				if (Object.values(shape).some((field) => {
					return isCompletable(unwrapOptionalSchema(field));
				})) this.setCompletionRequestHandler();
			}
		}
		return registeredPrompt;
	}
	_createRegisteredTool(name, title, description, inputSchema, outputSchema, annotations, icons, execution, scopeChallenge, _meta, handler) {
		require_src.validateAndWarnToolName(name);
		let currentHandler = handler;
		let outputSchemaJson;
		const registeredTool = {
			title,
			description,
			inputSchema,
			outputSchema,
			get outputSchemaJson() {
				return outputSchemaJson ??= convertOutputSchemaJson(registeredTool.outputSchema);
			},
			set outputSchemaJson(value) {
				outputSchemaJson = value;
			},
			annotations,
			icons,
			execution,
			scopeChallenge,
			_meta,
			handler,
			executor: createToolExecutor(inputSchema, handler),
			enabled: true,
			disable: () => registeredTool.update({ enabled: false }),
			enable: () => registeredTool.update({ enabled: true }),
			remove: () => registeredTool.update({ name: null }),
			update: (updates) => {
				if (updates.name !== void 0 && updates.name !== name) {
					if (typeof updates.name === "string") require_src.validateAndWarnToolName(updates.name);
					delete this._registeredTools[name];
					delete this._toolInputSchemaJson[name];
					if (updates.name) {
						delete this._toolInputSchemaJson[updates.name];
						this._registeredTools[updates.name] = registeredTool;
						name = updates.name;
					}
				}
				if (updates.title !== void 0) registeredTool.title = updates.title;
				if (updates.description !== void 0) registeredTool.description = updates.description;
				let needsExecutorRegen = false;
				if (updates.paramsSchema !== void 0) {
					registeredTool.inputSchema = updates.paramsSchema;
					delete this._toolInputSchemaJson[name];
					needsExecutorRegen = true;
				}
				if (updates.callback !== void 0) {
					registeredTool.handler = updates.callback;
					currentHandler = updates.callback;
					needsExecutorRegen = true;
				}
				if (needsExecutorRegen) registeredTool.executor = createToolExecutor(registeredTool.inputSchema, currentHandler);
				if (updates.outputSchema !== void 0) {
					registeredTool.outputSchema = updates.outputSchema;
					registeredTool.outputSchemaJson = convertOutputSchemaJson(updates.outputSchema);
				}
				if (updates.annotations !== void 0) registeredTool.annotations = updates.annotations;
				if (updates.icons !== void 0) registeredTool.icons = updates.icons;
				if (updates.scopeChallenge !== void 0) registeredTool.scopeChallenge = updates.scopeChallenge === null ? void 0 : updates.scopeChallenge;
				if (updates._meta !== void 0) registeredTool._meta = updates._meta;
				if (updates.enabled !== void 0) registeredTool.enabled = updates.enabled;
				this.sendToolListChanged();
			}
		};
		this._registeredTools[name] = registeredTool;
		this.setToolRequestHandlers();
		this.sendToolListChanged();
		return registeredTool;
	}
	registerTool(name, config, cb) {
		if (this._registeredTools[name]) throw new Error(`Tool ${name} is already registered`);
		const { title, description, inputSchema, outputSchema, annotations, icons, scopeChallenge, _meta } = config;
		return this._createRegisteredTool(name, title, description, require_src.normalizeRawShapeSchema(inputSchema), require_src.normalizeRawShapeSchema(outputSchema), annotations, icons, void 0, scopeChallenge, _meta, cb);
	}
	registerPrompt(name, config, cb) {
		if (this._registeredPrompts[name]) throw new Error(`Prompt ${name} is already registered`);
		const { title, description, argsSchema, icons, scopeChallenge, _meta } = config;
		const registeredPrompt = this._createRegisteredPrompt(name, title, description, require_src.normalizeRawShapeSchema(argsSchema), cb, icons, scopeChallenge, _meta);
		this.setPromptRequestHandlers();
		this.sendPromptListChanged();
		return registeredPrompt;
	}
	/**
	* Checks if the server is connected to a transport.
	* @returns `true` if the server is connected
	*/
	isConnected() {
		return this.server.transport !== void 0;
	}
	/**
	* Sends a logging message to the client, if connected.
	* Note: You only need to send the parameters object, not the entire JSON-RPC message.
	* @see {@linkcode LoggingMessageNotification}
	* @param params
	* @param sessionId Optional for stateless transports and backward compatibility.
	*
	* @example
	* ```ts source="./mcp.examples.ts#McpServer_sendLoggingMessage_basic"
	* await server.sendLoggingMessage({
	*     level: 'info',
	*     data: 'Processing complete'
	* });
	* ```
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
	* Remains functional during the deprecation window (at least twelve months).
	* Migrate to stderr logging (STDIO servers) or OpenTelemetry.
	*/
	async sendLoggingMessage(params, sessionId) {
		return this.server.sendLoggingMessage(params, sessionId);
	}
	/**
	* Sends a resource list changed event to the client, if connected.
	*/
	sendResourceListChanged() {
		if (this.isConnected()) this.server.sendResourceListChanged();
	}
	/**
	* Sends a tool list changed event to the client, if connected.
	*/
	sendToolListChanged() {
		if (this.isConnected()) this.server.sendToolListChanged();
	}
	/**
	* Sends a prompt list changed event to the client, if connected.
	*/
	sendPromptListChanged() {
		if (this.isConnected()) this.server.sendPromptListChanged();
	}
};
/**
* A resource template combines a URI pattern with optional functionality to enumerate
* all resources matching that pattern.
*/
var ResourceTemplate = class {
	_uriTemplate;
	constructor(uriTemplate, _callbacks) {
		this._callbacks = _callbacks;
		this._uriTemplate = typeof uriTemplate === "string" ? new require_src.UriTemplate(uriTemplate) : uriTemplate;
	}
	/**
	* Gets the URI template pattern.
	*/
	get uriTemplate() {
		return this._uriTemplate;
	}
	/**
	* Gets the list callback, if one was provided.
	*/
	get listCallback() {
		return this._callbacks.list;
	}
	/**
	* Gets the callback for completing a specific URI template variable, if one was provided.
	*/
	completeCallback(variable) {
		return this._callbacks.complete?.[variable];
	}
};
/**
* Creates an executor that invokes the handler with the appropriate arguments.
* When `inputSchema` is defined, the handler is called with `(args, ctx)`.
* When `inputSchema` is undefined, the handler is called with just `(ctx)`.
*/
function createToolExecutor(inputSchema, handler) {
	if (inputSchema) {
		const callback$1 = handler;
		return async (args, ctx) => callback$1(args, ctx);
	}
	const callback = handler;
	return async (_args, ctx) => callback(ctx);
}
const EMPTY_OBJECT_JSON_SCHEMA = {
	type: "object",
	properties: {}
};
/** Converts a tool's `inputSchema` for `tools/list` and warns on an invalid SEP-2243 `x-mcp-header` declaration. */
function convertListedInputSchema(name, inputSchema) {
	const json = require_src.standardSchemaToJsonSchema(inputSchema, "input");
	const scan = require_src.scanXMcpHeaderDeclarations(json);
	if (!scan.valid) console.warn(`[mcp-sdk] tool '${name}' carries an invalid x-mcp-header declaration and will be excluded by conforming Streamable HTTP clients: ${scan.reason}`);
	return json;
}
/**
* Convert a registered `outputSchema` to JSON Schema, memoised on {@link RegisteredTool.outputSchemaJson}
* so `tools/call` passes the SAME advertised schema to the wire codec's `projectCallToolResult` that
* `tools/list` emits (and that the 2025 codec's `encodeResult('tools/list', …)` may wrap). A conversion
* failure yields `undefined` so the failure surfaces where it always has (`tools/list`).
*/
function convertOutputSchemaJson(outputSchema) {
	if (outputSchema === void 0) return void 0;
	try {
		return require_src.standardSchemaToJsonSchema(outputSchema, "output");
	} catch {
		return;
	}
}
/**
* Creates a type-safe prompt handler that captures the schema and callback in a closure.
* This eliminates the need for type assertions at the call site.
*/
function createPromptHandler(name, argsSchema, callback) {
	if (argsSchema) {
		const typedCallback = callback;
		return async (args, ctx) => {
			const parseResult = await require_src.validateStandardSchema(argsSchema, args ?? {});
			if (!parseResult.success) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, `Invalid arguments for prompt ${name}: ${parseResult.error}`);
			return typedCallback(parseResult.data, ctx);
		};
	} else {
		const typedCallback = callback;
		return async (_args, ctx) => {
			return typedCallback(ctx);
		};
	}
}
function createCompletionResult(suggestions) {
	return { completion: {
		values: suggestions.map(String).slice(0, 100),
		total: suggestions.length,
		hasMore: suggestions.length > 100
	} };
}
const EMPTY_COMPLETION_RESULT = { completion: {
	values: [],
	hasMore: false
} };
/** @internal Gets the shape of a Zod object schema */
function getSchemaShape(schema) {
	const candidate = schema;
	if (candidate.shape && typeof candidate.shape === "object") return candidate.shape;
}
/** @internal Checks if a Zod schema is optional */
function isOptionalSchema(schema) {
	return schema?.type === "optional";
}
/** @internal Unwraps an optional Zod schema */
function unwrapOptionalSchema(schema) {
	if (!isOptionalSchema(schema)) return schema;
	return schema.def?.innerType ?? schema;
}

//#endregion
Object.defineProperty(exports, 'DEFAULT_SSE_KEEP_ALIVE_MS', {
  enumerable: true,
  get: function () {
    return DEFAULT_SSE_KEEP_ALIVE_MS;
  }
});
Object.defineProperty(exports, 'McpServer', {
  enumerable: true,
  get: function () {
    return McpServer;
  }
});
Object.defineProperty(exports, 'PerRequestHTTPServerTransport', {
  enumerable: true,
  get: function () {
    return PerRequestHTTPServerTransport;
  }
});
Object.defineProperty(exports, 'ResourceTemplate', {
  enumerable: true,
  get: function () {
    return ResourceTemplate;
  }
});
Object.defineProperty(exports, 'Server', {
  enumerable: true,
  get: function () {
    return Server;
  }
});
Object.defineProperty(exports, 'armSseKeepAlive', {
  enumerable: true,
  get: function () {
    return armSseKeepAlive;
  }
});
Object.defineProperty(exports, 'bearerAuthChallengeResponse', {
  enumerable: true,
  get: function () {
    return bearerAuthChallengeResponse;
  }
});
Object.defineProperty(exports, 'buildOAuthProtectedResourceMetadata', {
  enumerable: true,
  get: function () {
    return buildOAuthProtectedResourceMetadata;
  }
});
Object.defineProperty(exports, 'completable', {
  enumerable: true,
  get: function () {
    return completable;
  }
});
Object.defineProperty(exports, 'createScopeChallengeResponse', {
  enumerable: true,
  get: function () {
    return createScopeChallengeResponse;
  }
});
Object.defineProperty(exports, 'findScopeChallenge', {
  enumerable: true,
  get: function () {
    return findScopeChallenge;
  }
});
Object.defineProperty(exports, 'getOAuthProtectedResourceMetadataUrl', {
  enumerable: true,
  get: function () {
    return getOAuthProtectedResourceMetadataUrl;
  }
});
Object.defineProperty(exports, 'installModernOnlyHandlers', {
  enumerable: true,
  get: function () {
    return installModernOnlyHandlers;
  }
});
Object.defineProperty(exports, 'isCompletable', {
  enumerable: true,
  get: function () {
    return isCompletable;
  }
});
Object.defineProperty(exports, 'oauthMetadataResponse', {
  enumerable: true,
  get: function () {
    return oauthMetadataResponse;
  }
});
Object.defineProperty(exports, 'requireBearerAuth', {
  enumerable: true,
  get: function () {
    return requireBearerAuth;
  }
});
Object.defineProperty(exports, 'requireScopes', {
  enumerable: true,
  get: function () {
    return requireScopes;
  }
});
Object.defineProperty(exports, 'scopeChallengeResourceMetadataUrl', {
  enumerable: true,
  get: function () {
    return scopeChallengeResourceMetadataUrl;
  }
});
Object.defineProperty(exports, 'seedClientIdentityFromEnvelope', {
  enumerable: true,
  get: function () {
    return seedClientIdentityFromEnvelope;
  }
});
Object.defineProperty(exports, 'serverIdentityOf', {
  enumerable: true,
  get: function () {
    return serverIdentityOf;
  }
});
Object.defineProperty(exports, 'verifyBearerToken', {
  enumerable: true,
  get: function () {
    return verifyBearerToken;
  }
});
//# sourceMappingURL=mcp-uPg2RfP3.cjs.map