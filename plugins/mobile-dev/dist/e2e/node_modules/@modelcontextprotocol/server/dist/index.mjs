import { _ as PerRequestHTTPServerTransport, a as seedClientIdentityFromEnvelope, b as completable, c as findScopeChallenge, d as buildOAuthProtectedResourceMetadata, f as getOAuthProtectedResourceMetadataUrl, g as verifyBearerToken, h as requireBearerAuth, i as installModernOnlyHandlers, l as requireScopes, m as bearerAuthChallengeResponse, n as ResourceTemplate, o as serverIdentityOf, p as oauthMetadataResponse, r as Server, s as createScopeChallengeResponse, t as McpServer, u as scopeChallengeResourceMetadataUrl, v as DEFAULT_SSE_KEEP_ALIVE_MS, x as isCompletable, y as armSseKeepAlive } from "./mcp-oHn3ureC.mjs";
import { $ as isTaskAugmentedRequestParams, At as LATEST_PROTOCOL_VERSION, B as scanXMcpHeaderDeclarations, Bt as TRACESTATE_META_KEY, Ct as CLIENT_CAPABILITIES_META_KEY, D as acceptedContent, Dt as INVALID_PARAMS, Et as INTERNAL_ERROR, Ft as RELATED_TASK_META_KEY, G as isInitializeRequest, Gt as resourceUrlFromServerUrl, H as assertCompleteRequestPrompt, I as classifyInboundRequest, It as SERVER_INFO_META_KEY, J as isJSONRPCErrorResponse, Jt as SdkHttpError, K as isInitializedNotification, Kt as SdkError, L as httpStatusForErrorCode, Lt as SUBSCRIPTION_ID_META_KEY, Mt as METHOD_NOT_FOUND, Nt as PARSE_ERROR, O as inputRequired, Ot as INVALID_REQUEST, Pt as PROTOCOL_VERSION_META_KEY, Q as isJSONRPCResultResponse, R as modernOnlyStrictRejection, Rt as SUPPORTED_PROTOCOL_VERSIONS, S as specTypeSchemas, St as BAGGAGE_META_KEY, Tt as DEFAULT_NEGOTIATED_PROTOCOL_VERSION, U as assertCompleteRequestResourceTemplate, Ut as requiredClientCapabilitiesForRequest, V as validateMcpParamHeaders, Vt as missingClientCapabilities, W as isCallToolResult, Wt as checkResourceAllowed, X as isJSONRPCRequest, Xt as OAuthErrorCode, Y as isJSONRPCNotification, Yt as OAuthError, Z as isJSONRPCResponse, _ as mergeCapabilities, a as UriTemplate, at as requestMetaOf, c as ReadBuffer, d as serializeMessage, dt as ResourceNotFoundError, et as parseJSONRPCMessage, f as getDisplayName, ft as UnsupportedProtocolVersionError, g as Protocol, h as DEFAULT_REQUEST_TIMEOUT_MSEC, i as InMemoryTransport, jt as LOG_LEVEL_META_KEY, k as inputResponse, kt as JSONRPC_VERSION, l as STDIO_DEFAULT_MAX_BUFFER_SIZE, lt as MissingRequiredClientCapabilityError, m as mediaTypeEssence, mt as ProtocolErrorCode, n as preloadSchemas, o as createFetchWithInit, p as isJsonContentType, pt as UrlElicitationRequiredError, q as isInputRequiredResult, qt as SdkErrorCode, t as fromJsonSchema$1, tt as JSONRPCMessageSchema, u as deserializeMessage, ut as ProtocolError, vt as SUPPORTED_MODERN_PROTOCOL_VERSIONS, wt as CLIENT_INFO_META_KEY, x as isSpecType, y as setNegotiatedProtocolVersion, z as validateStandardRequestHeaders, zt as TRACEPARENT_META_KEY } from "./src-DdvbAHrR.mjs";
import { a as createServerNotifier, i as InMemoryServerEventBus, r as createListenRouter, t as DEFAULT_MAX_SUBSCRIPTIONS } from "./listenRouter-Bartj63y.mjs";
import { DefaultJsonSchemaValidator } from "@modelcontextprotocol/server/_shims";

//#region src/server/invoke.ts
/**
* Serves one classified inbound message on the given server instance and
* returns the HTTP response for the exchange.
*
* The instance is connected to a fresh single-exchange transport, the message
* is injected through the normal transport message path, and whatever the
* dispatch layer produces (the handler result, a protocol-level rejection, or
* streamed related messages followed by the result) is captured as the
* returned `Response`. For request exchanges, teardown rides the transport's
* close chain once the terminal response has been delivered; notification
* exchanges resolve with the 202 response immediately and do NOT run the
* close chain — the transport stays connected until the caller closes it or
* drops the per-request instance, which is the caller's choice either way.
*/
async function invoke(server, message, ctx) {
	const transport = new PerRequestHTTPServerTransport({
		classification: ctx.classification,
		...ctx.responseMode !== void 0 && { responseMode: ctx.responseMode },
		...ctx.keepAliveMs !== void 0 && { keepAliveMs: ctx.keepAliveMs }
	});
	await server.connect(transport);
	return transport.handleMessage(message, {
		...ctx.request !== void 0 && { request: ctx.request },
		...ctx.authInfo !== void 0 && { authInfo: ctx.authInfo }
	});
}

//#endregion
//#region src/server/requestBody.ts
/** Default upper bound, in bytes, on a request body read by the HTTP entry points (4 MiB). */
const DEFAULT_MAX_REQUEST_BODY_SIZE = 4 * 1024 * 1024;
/** Upper bound on the number of messages accepted in one JSON-RPC batch array. */
const MAX_BATCH_SIZE = 100;
/** The message answered with 413 for a request body over `maxBytes`. */
function requestBodyTooLargeMessage(maxBytes) {
	return `Payload Too Large: Request body must not exceed ${maxBytes} bytes`;
}
/**
* Resolves a `maxRequestBodySize` option to the bound to apply: the default when
* omitted, otherwise the value itself, which must be a positive finite number of
* bytes (a `RangeError` is thrown at configuration time for anything else).
*/
function resolveMaxRequestBodySize(value) {
	if (value === void 0) return DEFAULT_MAX_REQUEST_BODY_SIZE;
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new RangeError(`maxRequestBodySize must be a positive number of bytes, got ${String(value)}`);
	return value;
}
/**
* Reads a request body as text, up to `maxBytes` (default
* {@linkcode DEFAULT_MAX_REQUEST_BODY_SIZE}). A declared `Content-Length` over the
* limit is refused without reading anything; otherwise the read stops as soon as
* more than the limit has arrived. Stream failures propagate.
*/
async function readRequestBody(request, maxBytes = DEFAULT_MAX_REQUEST_BODY_SIZE) {
	if (Number(request.headers.get("content-length")) > maxBytes) return { tooLarge: true };
	if (request.body === null) return {
		tooLarge: false,
		text: ""
	};
	const reader = request.body.getReader();
	const decoder = new TextDecoder();
	let received = 0;
	let text = "";
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			if (received > maxBytes) return { tooLarge: true };
			text += decoder.decode(value, { stream: true });
		}
	} finally {
		reader.releaseLock();
	}
	return {
		tooLarge: false,
		text: text + decoder.decode()
	};
}

//#endregion
//#region src/server/streamableHttp.ts
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
var WebStandardStreamableHTTPServerTransport = class {
	sessionIdGenerator;
	_started = false;
	_hasHandledRequest = false;
	_closed = false;
	_streamMapping = /* @__PURE__ */ new Map();
	_requestToStreamMapping = /* @__PURE__ */ new Map();
	_requestResponseMap = /* @__PURE__ */ new Map();
	_initialized = false;
	_enableJsonResponse = false;
	_standaloneSseStreamId = "_GET_stream";
	_eventStore;
	_onsessioninitialized;
	_onsessionclosed;
	_allowedHosts;
	_allowedOrigins;
	_enableDnsRebindingProtection;
	_retryInterval;
	_supportedProtocolVersions;
	_keepAliveMs;
	_maxRequestBodySize;
	_scopeChallengeResolver;
	sessionId;
	onclose;
	onerror;
	onmessage;
	constructor(options = {}) {
		this.sessionIdGenerator = options.sessionIdGenerator;
		this._enableJsonResponse = options.enableJsonResponse ?? false;
		this._eventStore = options.eventStore;
		this._onsessioninitialized = options.onsessioninitialized;
		this._onsessionclosed = options.onsessionclosed;
		this._allowedHosts = options.allowedHosts;
		this._allowedOrigins = options.allowedOrigins;
		this._enableDnsRebindingProtection = options.enableDnsRebindingProtection ?? false;
		this._retryInterval = options.retryInterval;
		this._supportedProtocolVersions = options.supportedProtocolVersions ?? SUPPORTED_PROTOCOL_VERSIONS;
		this._keepAliveMs = options.keepAliveMs ?? DEFAULT_SSE_KEEP_ALIVE_MS;
		this._maxRequestBodySize = resolveMaxRequestBodySize(options.maxRequestBodySize);
	}
	startKeepAlive(controller, encoder) {
		if (this._closed) return void 0;
		const timer = armSseKeepAlive(this._keepAliveMs, () => {
			try {
				controller.enqueue(encoder.encode(": keepalive\n\n"));
			} catch {
				if (timer !== void 0) clearInterval(timer);
			}
		});
		return timer;
	}
	/** Sets the scope challenge resolver for parsed JSON-RPC requests. */
	setScopeChallengeResolver(resolver) {
		this._scopeChallengeResolver = resolver;
	}
	/**
	* Starts the transport. This is required by the {@linkcode Transport} interface but is a no-op
	* for the Streamable HTTP transport as connections are managed per-request.
	*/
	async start() {
		if (this._started) throw new Error("Transport already started");
		this._started = true;
	}
	/**
	* Sets the supported protocol versions for header validation.
	* Called by the server during {@linkcode server/server.Server.connect | connect()} to pass its supported versions.
	*/
	setSupportedProtocolVersions(versions) {
		this._supportedProtocolVersions = versions;
	}
	/**
	* Helper to create a JSON error response
	*/
	createJsonErrorResponse(status, code, message, options) {
		const error = {
			code,
			message
		};
		if (options?.data !== void 0) error.data = options.data;
		return Response.json({
			jsonrpc: "2.0",
			error,
			id: null
		}, {
			status,
			headers: {
				"Content-Type": "application/json",
				...options?.headers
			}
		});
	}
	async _checkScopeChallenge(messages, authInfo) {
		if (!this._scopeChallengeResolver) return;
		const challenge = await findScopeChallenge(messages.filter((message) => isJSONRPCRequest(message)), authInfo, this._scopeChallengeResolver);
		return challenge === void 0 ? void 0 : createScopeChallengeResponse(challenge, scopeChallengeResourceMetadataUrl(authInfo));
	}
	/**
	* Validates request headers for DNS rebinding protection.
	* @returns Error response if validation fails, `undefined` if validation passes.
	*/
	validateRequestHeaders(req) {
		if (!this._enableDnsRebindingProtection) return;
		if (this._allowedHosts && this._allowedHosts.length > 0) {
			const hostHeader = req.headers.get("host");
			if (!hostHeader || !this._allowedHosts.includes(hostHeader)) {
				const error = `Invalid Host header: ${hostHeader}`;
				this.onerror?.(new Error(error));
				return this.createJsonErrorResponse(403, -32e3, error);
			}
		}
		if (this._allowedOrigins && this._allowedOrigins.length > 0) {
			const originHeader = req.headers.get("origin");
			if (originHeader && !this._allowedOrigins.includes(originHeader)) {
				const error = `Invalid Origin header: ${originHeader}`;
				this.onerror?.(new Error(error));
				return this.createJsonErrorResponse(403, -32e3, error);
			}
		}
	}
	/**
	* Handles an incoming HTTP request, whether `GET`, `POST`, or `DELETE`
	* Returns a `Response` object (Web Standard)
	*/
	async handleRequest(req, options) {
		if (this._closed) return this.createJsonErrorResponse(404, -32001, "Session not found");
		if (!this.sessionIdGenerator && this._hasHandledRequest) throw new Error("Stateless transport cannot be reused across requests. Create a new transport per request.");
		this._hasHandledRequest = true;
		const validationError = this.validateRequestHeaders(req);
		if (validationError) return validationError;
		switch (req.method) {
			case "POST": return this.handlePostRequest(req, options);
			case "GET": return this.handleGetRequest(req);
			case "DELETE": return this.handleDeleteRequest(req);
			default: return this.handleUnsupportedRequest();
		}
	}
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
	supportsEmptySSEData(protocolVersion) {
		return this._supportedProtocolVersions.includes(protocolVersion) && protocolVersion >= "2025-11-25";
	}
	/**
	* Writes a priming event to establish resumption capability.
	* Only sends if `eventStore` is configured (opt-in for resumability) and
	* the client's protocol version supports empty SSE data (a supported
	* version that is >= `2025-11-25`).
	*/
	async writePrimingEvent(controller, encoder, streamId, protocolVersion) {
		if (!this._eventStore) return;
		if (!this.supportsEmptySSEData(protocolVersion)) return;
		const primingEventId = await this._eventStore.storeEvent(streamId, {});
		let primingEvent = `id: ${primingEventId}\ndata: \n\n`;
		if (this._retryInterval !== void 0) primingEvent = `id: ${primingEventId}\nretry: ${this._retryInterval}\ndata: \n\n`;
		controller.enqueue(encoder.encode(primingEvent));
	}
	/**
	* Handles `GET` requests for SSE stream
	*/
	async handleGetRequest(req) {
		if (!req.headers.get("accept")?.includes("text/event-stream")) {
			this.onerror?.(/* @__PURE__ */ new Error("Not Acceptable: Client must accept text/event-stream"));
			return this.createJsonErrorResponse(406, -32e3, "Not Acceptable: Client must accept text/event-stream");
		}
		const sessionError = this.validateSession(req);
		if (sessionError) return sessionError;
		const protocolError = this.validateProtocolVersion(req);
		if (protocolError) return protocolError;
		if (this._eventStore) {
			const lastEventId = req.headers.get("last-event-id");
			if (lastEventId) return this.replayEvents(lastEventId);
		}
		if (this._streamMapping.get(this._standaloneSseStreamId) !== void 0) {
			this.onerror?.(/* @__PURE__ */ new Error("Conflict: Only one SSE stream is allowed per session"));
			return this.createJsonErrorResponse(409, -32e3, "Conflict: Only one SSE stream is allowed per session");
		}
		const encoder = new TextEncoder();
		let streamController;
		let keepAliveTimer;
		const readable = new ReadableStream({
			start: (controller) => {
				streamController = controller;
			},
			cancel: () => {
				if (keepAliveTimer !== void 0) clearInterval(keepAliveTimer);
				if (this._streamMapping.get(this._standaloneSseStreamId)?.controller === streamController) this._streamMapping.delete(this._standaloneSseStreamId);
			}
		});
		const headers = {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no"
		};
		if (this.sessionId !== void 0) headers["mcp-session-id"] = this.sessionId;
		this._streamMapping.set(this._standaloneSseStreamId, {
			controller: streamController,
			encoder,
			cleanup: () => {
				if (keepAliveTimer !== void 0) clearInterval(keepAliveTimer);
				this._streamMapping.delete(this._standaloneSseStreamId);
				try {
					streamController.close();
				} catch {}
			}
		});
		keepAliveTimer = this.startKeepAlive(streamController, encoder);
		return new Response(readable, { headers });
	}
	/**
	* Replays events that would have been sent after the specified event ID
	* Only used when resumability is enabled
	*/
	async replayEvents(lastEventId) {
		if (!this._eventStore) {
			this.onerror?.(/* @__PURE__ */ new Error("Event store not configured"));
			return this.createJsonErrorResponse(400, -32e3, "Event store not configured");
		}
		try {
			let streamId;
			if (this._eventStore.getStreamIdForEventId) {
				streamId = await this._eventStore.getStreamIdForEventId(lastEventId);
				if (!streamId) {
					this.onerror?.(/* @__PURE__ */ new Error("Invalid event ID format"));
					return this.createJsonErrorResponse(400, -32e3, "Invalid event ID format");
				}
				if (this._streamMapping.get(streamId) !== void 0) {
					this.onerror?.(/* @__PURE__ */ new Error("Conflict: Stream already has an active connection"));
					return this.createJsonErrorResponse(409, -32e3, "Conflict: Stream already has an active connection");
				}
			}
			const headers = {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no"
			};
			if (this.sessionId !== void 0) headers["mcp-session-id"] = this.sessionId;
			const encoder = new TextEncoder();
			let streamController;
			let keepAliveTimer;
			let cancelled = false;
			let replayedStreamId;
			const readable = new ReadableStream({
				start: (controller) => {
					streamController = controller;
				},
				cancel: () => {
					cancelled = true;
					if (keepAliveTimer !== void 0) clearInterval(keepAliveTimer);
					if (replayedStreamId !== void 0 && this._streamMapping.get(replayedStreamId)?.controller === streamController) this._streamMapping.delete(replayedStreamId);
				}
			});
			const replayedEventIds = /* @__PURE__ */ new Set();
			replayedStreamId = await this._eventStore.replayEventsAfter(lastEventId, { send: async (eventId, message) => {
				replayedEventIds.add(eventId);
				if (!this.writeSSEEvent(streamController, encoder, message, eventId)) try {
					streamController.close();
				} catch {}
			} });
			if (this._closed || cancelled) {
				try {
					streamController.close();
				} catch {}
				return this.createJsonErrorResponse(404, -32001, "Session not found");
			}
			this._streamMapping.get(replayedStreamId)?.cleanup();
			this._streamMapping.set(replayedStreamId, {
				controller: streamController,
				encoder,
				replayedEventIds,
				cleanup: () => {
					if (keepAliveTimer !== void 0) clearInterval(keepAliveTimer);
					this._streamMapping.delete(replayedStreamId);
					try {
						streamController.close();
					} catch {}
				}
			});
			if (replayedStreamId !== this._standaloneSseStreamId) {
				if (![...this._requestToStreamMapping.values()].includes(replayedStreamId)) {
					this._streamMapping.delete(replayedStreamId);
					try {
						streamController.close();
					} catch {}
				}
			}
			if (this._streamMapping.get(replayedStreamId)?.controller === streamController) keepAliveTimer = this.startKeepAlive(streamController, encoder);
			return new Response(readable, { headers });
		} catch (error) {
			this.onerror?.(error);
			return this.createJsonErrorResponse(500, -32e3, "Error replaying events");
		}
	}
	/**
	* Writes an event to an SSE stream via controller with proper formatting
	*/
	writeSSEEvent(controller, encoder, message, eventId) {
		try {
			let eventData = `event: message\n`;
			if (eventId) eventData += `id: ${eventId}\n`;
			eventData += `data: ${JSON.stringify(message)}\n\n`;
			controller.enqueue(encoder.encode(eventData));
			return true;
		} catch (error) {
			this.onerror?.(error);
			return false;
		}
	}
	/**
	* Handles unsupported requests (`PUT`, `PATCH`, etc.)
	*/
	handleUnsupportedRequest() {
		this.onerror?.(/* @__PURE__ */ new Error("Method not allowed."));
		return Response.json({
			jsonrpc: "2.0",
			error: {
				code: -32e3,
				message: "Method not allowed."
			},
			id: null
		}, {
			status: 405,
			headers: {
				Allow: "GET, POST, DELETE",
				"Content-Type": "application/json"
			}
		});
	}
	/**
	* Handles `POST` requests containing JSON-RPC messages
	*/
	async handlePostRequest(req, options) {
		try {
			const acceptHeader = req.headers.get("accept");
			if (!acceptHeader?.includes("application/json") || !acceptHeader.includes("text/event-stream")) {
				this.onerror?.(/* @__PURE__ */ new Error("Not Acceptable: Client must accept both application/json and text/event-stream"));
				return this.createJsonErrorResponse(406, -32e3, "Not Acceptable: Client must accept both application/json and text/event-stream");
			}
			if (!isJsonContentType(req.headers.get("content-type"))) {
				this.onerror?.(/* @__PURE__ */ new Error("Unsupported Media Type: Content-Type must be application/json"));
				return this.createJsonErrorResponse(415, -32e3, "Unsupported Media Type: Content-Type must be application/json");
			}
			const request = req;
			let rawMessage;
			if (options?.parsedBody === void 0) try {
				const body = await readRequestBody(req, this._maxRequestBodySize);
				if (body.tooLarge) {
					const message = requestBodyTooLargeMessage(this._maxRequestBodySize);
					this.onerror?.(new Error(message));
					return this.createJsonErrorResponse(413, -32e3, message);
				}
				rawMessage = JSON.parse(body.text);
			} catch (error) {
				this.onerror?.(error);
				return this.createJsonErrorResponse(400, -32700, "Parse error: Invalid JSON");
			}
			else rawMessage = options.parsedBody;
			if (Array.isArray(rawMessage) && rawMessage.length > MAX_BATCH_SIZE) {
				this.onerror?.(/* @__PURE__ */ new Error(`Invalid Request: Batch must not exceed ${MAX_BATCH_SIZE} messages`));
				return this.createJsonErrorResponse(400, -32600, `Invalid Request: Batch must not exceed ${MAX_BATCH_SIZE} messages`);
			}
			let messages;
			try {
				messages = Array.isArray(rawMessage) ? rawMessage.map((msg) => JSONRPCMessageSchema.parse(msg)) : [JSONRPCMessageSchema.parse(rawMessage)];
			} catch (error) {
				this.onerror?.(error);
				return this.createJsonErrorResponse(400, -32700, "Parse error: Invalid JSON-RPC message");
			}
			if (this._closed) return this.createJsonErrorResponse(404, -32001, "Session not found");
			const isInitializationRequest = messages.some((element) => isInitializeRequest(element));
			if (isInitializationRequest) {
				if (this._initialized && this.sessionId !== void 0) {
					this.onerror?.(/* @__PURE__ */ new Error("Invalid Request: Server already initialized"));
					return this.createJsonErrorResponse(400, -32600, "Invalid Request: Server already initialized");
				}
				if (messages.length > 1) {
					this.onerror?.(/* @__PURE__ */ new Error("Invalid Request: Only one initialization request is allowed"));
					return this.createJsonErrorResponse(400, -32600, "Invalid Request: Only one initialization request is allowed");
				}
				this.sessionId = this.sessionIdGenerator?.();
				this._initialized = true;
				if (this.sessionId && this._onsessioninitialized) await Promise.resolve(this._onsessioninitialized(this.sessionId));
			}
			if (!isInitializationRequest) {
				const sessionError = this.validateSession(req);
				if (sessionError) return sessionError;
				const protocolError = this.validateProtocolVersion(req);
				if (protocolError) return protocolError;
			}
			if (this._closed) return this.createJsonErrorResponse(404, -32001, "Session not found");
			let scopeChallengeResponse;
			try {
				scopeChallengeResponse = await this._checkScopeChallenge(messages, options?.authInfo);
			} catch (error) {
				this.onerror?.(error);
				return this.createJsonErrorResponse(500, -32603, "Internal server error");
			}
			if (scopeChallengeResponse) return scopeChallengeResponse;
			if (!messages.some((element) => isJSONRPCRequest(element))) {
				for (const message of messages) this.onmessage?.(message, {
					authInfo: options?.authInfo,
					request
				});
				return new Response(null, { status: 202 });
			}
			const streamId = crypto.randomUUID();
			const initRequest = messages.find((m) => isInitializeRequest(m));
			const clientProtocolVersion = initRequest ? initRequest.params.protocolVersion : req.headers.get("mcp-protocol-version") ?? DEFAULT_NEGOTIATED_PROTOCOL_VERSION;
			if (this._enableJsonResponse) return new Promise((resolve) => {
				this._streamMapping.set(streamId, {
					resolveJson: resolve,
					cleanup: () => {
						this._streamMapping.delete(streamId);
					}
				});
				for (const message of messages) if (isJSONRPCRequest(message)) this._requestToStreamMapping.set(message.id, streamId);
				for (const message of messages) this.onmessage?.(message, {
					authInfo: options?.authInfo,
					request
				});
			});
			const encoder = new TextEncoder();
			let streamController;
			let keepAliveTimer;
			const readable = new ReadableStream({
				start: (controller) => {
					streamController = controller;
				},
				cancel: () => {
					if (keepAliveTimer !== void 0) clearInterval(keepAliveTimer);
					if (this._streamMapping.get(streamId)?.controller === streamController) this._streamMapping.delete(streamId);
				}
			});
			const headers = {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no"
			};
			if (this.sessionId !== void 0) headers["mcp-session-id"] = this.sessionId;
			for (const message of messages) if (isJSONRPCRequest(message)) {
				this._streamMapping.set(streamId, {
					controller: streamController,
					encoder,
					cleanup: () => {
						if (keepAliveTimer !== void 0) clearInterval(keepAliveTimer);
						this._streamMapping.delete(streamId);
						try {
							streamController.close();
						} catch {}
					}
				});
				this._requestToStreamMapping.set(message.id, streamId);
			}
			await this.writePrimingEvent(streamController, encoder, streamId, clientProtocolVersion);
			for (const message of messages) {
				let closeSSEStream;
				let closeStandaloneSSEStream;
				if (isJSONRPCRequest(message) && this._eventStore && this.supportsEmptySSEData(clientProtocolVersion)) {
					closeSSEStream = () => {
						this.closeSSEStream(message.id);
					};
					closeStandaloneSSEStream = () => {
						this.closeStandaloneSSEStream();
					};
				}
				this.onmessage?.(message, {
					authInfo: options?.authInfo,
					request,
					closeSSEStream,
					closeStandaloneSSEStream
				});
			}
			if (this._streamMapping.get(streamId)?.controller === streamController) keepAliveTimer = this.startKeepAlive(streamController, encoder);
			return new Response(readable, {
				status: 200,
				headers
			});
		} catch (error) {
			this.onerror?.(error);
			return this.createJsonErrorResponse(400, -32700, "Parse error", { data: String(error) });
		}
	}
	/**
	* Handles `DELETE` requests to terminate sessions
	*/
	async handleDeleteRequest(req) {
		const sessionError = this.validateSession(req);
		if (sessionError) return sessionError;
		const protocolError = this.validateProtocolVersion(req);
		if (protocolError) return protocolError;
		try {
			await Promise.resolve(this._onsessionclosed?.(this.sessionId));
			return new Response(null, { status: 200 });
		} finally {
			await this.close();
		}
	}
	/**
	* Validates session ID for non-initialization requests.
	* Returns `Response` error if invalid, `undefined` otherwise
	*/
	validateSession(req) {
		if (this.sessionIdGenerator === void 0) return;
		if (!this._initialized) {
			this.onerror?.(/* @__PURE__ */ new Error("Bad Request: Server not initialized"));
			return this.createJsonErrorResponse(400, -32e3, "Bad Request: Server not initialized");
		}
		const sessionId = req.headers.get("mcp-session-id");
		if (!sessionId) {
			this.onerror?.(/* @__PURE__ */ new Error("Bad Request: Mcp-Session-Id header is required"));
			return this.createJsonErrorResponse(400, -32e3, "Bad Request: Mcp-Session-Id header is required");
		}
		if (sessionId !== this.sessionId) {
			this.onerror?.(/* @__PURE__ */ new Error("Session not found"));
			return this.createJsonErrorResponse(404, -32001, "Session not found");
		}
	}
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
	validateProtocolVersion(req) {
		const protocolVersion = req.headers.get("mcp-protocol-version");
		if (protocolVersion !== null && !this._supportedProtocolVersions.includes(protocolVersion)) {
			const error = `Bad Request: Unsupported protocol version: ${protocolVersion} (supported versions: ${this._supportedProtocolVersions.join(", ")})`;
			this.onerror?.(new Error(error));
			return this.createJsonErrorResponse(400, -32e3, error);
		}
	}
	async close() {
		if (this._closed) return;
		this._closed = true;
		for (const { cleanup } of this._streamMapping.values()) cleanup();
		this._streamMapping.clear();
		this._requestResponseMap.clear();
		this.onclose?.();
	}
	/**
	* Close an SSE stream for a specific request, triggering client reconnection.
	* Use this to implement polling behavior during long-running operations -
	* client will reconnect after the retry interval specified in the priming event.
	*/
	closeSSEStream(requestId) {
		const streamId = this._requestToStreamMapping.get(requestId);
		if (!streamId) return;
		const stream = this._streamMapping.get(streamId);
		if (stream) stream.cleanup();
	}
	/**
	* Close the standalone `GET` SSE stream, triggering client reconnection.
	* Use this to implement polling behavior for server-initiated notifications.
	*/
	closeStandaloneSSEStream() {
		const stream = this._streamMapping.get(this._standaloneSseStreamId);
		if (stream) stream.cleanup();
	}
	async send(message, options) {
		let requestId = options?.relatedRequestId;
		if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) requestId = message.id;
		if (requestId === void 0) {
			if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) throw new Error("Cannot send a response on a standalone SSE stream unless resuming a previous client request");
			let eventId;
			if (this._eventStore) eventId = await this._eventStore.storeEvent(this._standaloneSseStreamId, message);
			const standaloneSse = this._streamMapping.get(this._standaloneSseStreamId);
			if (standaloneSse === void 0) return;
			if (standaloneSse.controller && standaloneSse.encoder && (eventId === void 0 || !standaloneSse.replayedEventIds?.has(eventId))) this.writeSSEEvent(standaloneSse.controller, standaloneSse.encoder, message, eventId);
			return;
		}
		const streamId = this._requestToStreamMapping.get(requestId);
		if (!streamId) throw new Error(`No connection established for request ID: ${String(requestId)}`);
		let stream = this._streamMapping.get(streamId);
		if (!this._enableJsonResponse) {
			let eventId;
			if (this._eventStore) {
				eventId = await this._eventStore.storeEvent(streamId, message);
				stream = this._streamMapping.get(streamId);
			}
			if (stream?.controller && stream?.encoder && (eventId === void 0 || !stream.replayedEventIds?.has(eventId))) this.writeSSEEvent(stream.controller, stream.encoder, message, eventId);
		}
		if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
			this._requestResponseMap.set(requestId, message);
			const relatedIds = [...this._requestToStreamMapping.entries()].filter(([_, sid]) => sid === streamId).map(([id]) => id);
			if (relatedIds.every((id) => this._requestResponseMap.has(id))) {
				if (!stream) {
					if (this._enableJsonResponse) throw new Error(`No connection established for request ID: ${String(requestId)}`);
					if (!this._eventStore) {
						this.onerror?.(/* @__PURE__ */ new Error(`Response for request ID ${String(requestId)} is undeliverable: per-request stream is disconnected and no eventStore is configured`));
						for (const id of relatedIds) {
							this._requestResponseMap.delete(id);
							this._requestToStreamMapping.delete(id);
						}
						return;
					}
					for (const id of relatedIds) {
						this._requestResponseMap.delete(id);
						this._requestToStreamMapping.delete(id);
					}
					return;
				}
				if (this._enableJsonResponse && stream.resolveJson) {
					const headers = { "Content-Type": "application/json" };
					if (this.sessionId !== void 0) headers["mcp-session-id"] = this.sessionId;
					const responses = relatedIds.map((id) => this._requestResponseMap.get(id));
					if (responses.length === 1) stream.resolveJson(Response.json(responses[0], {
						status: 200,
						headers
					}));
					else stream.resolveJson(Response.json(responses, {
						status: 200,
						headers
					}));
					stream.cleanup();
				} else stream.cleanup();
				for (const id of relatedIds) {
					this._requestResponseMap.delete(id);
					this._requestToStreamMapping.delete(id);
				}
			}
		}
	}
};

//#endregion
//#region src/server/createMcpHandler.ts
/**
* The JSON-RPC id to echo on an entry-built error response: the body's `id`
* when the body is a single JSON-RPC request whose id is a string or number,
* `null` otherwise. Error responses must carry the id of the request they
* correspond to whenever it could be read; `null` is reserved for the cases
* where no single request id is determinable — unparseable bodies, body-less
* methods, notifications, posted responses and batch arrays.
*/
function echoableRequestId(body) {
	if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
	const { method, id } = body;
	if (typeof method !== "string") return null;
	return typeof id === "string" || typeof id === "number" ? id : null;
}
function jsonRpcErrorResponse(httpStatus, code, message, data, id = null) {
	return Response.json({
		jsonrpc: "2.0",
		error: {
			code,
			message,
			...data !== void 0 && { data }
		},
		id
	}, {
		status: httpStatus,
		...httpStatus === 405 && { headers: { Allow: "POST" } }
	});
}
function rejectionResponse(rejection, id = null) {
	return jsonRpcErrorResponse(rejection.httpStatus, rejection.code, rejection.message, rejection.data, id);
}
function toError(value) {
	return value instanceof Error ? value : new Error(String(value));
}
function internalServerErrorResponse(id = null) {
	return jsonRpcErrorResponse(500, -32603, "Internal server error", void 0, id);
}
/** Throws when the factory returned an instance that is still connected to another exchange. */
function assertNotServing(server) {
	if (server.transport !== void 0) throw new Error("The factory returned an instance that is still serving another request. Return a new instance for each request.");
}
/**
* The entry's default legacy serving (`legacy: 'stateless'`): per-request
* stateless serving of 2025-era traffic using the same factory as the modern
* path. Exported as a standalone building block for hand-wired compositions
* (for example mounting legacy stateless serving on its own route next to a
* strict modern endpoint).
*
* Each POST is served by a fresh instance from the factory connected to a
* fresh streamable HTTP transport constructed with only
* `sessionIdGenerator: undefined` — the established stateless idiom, unchanged.
* Because serving is per-request and stateless, GET and DELETE (2025 session
* operations) are answered with `405` / `Method not allowed.`, exactly like the
* canonical stateless example.
*
* The optional `onerror` callback receives factory and serving failures on
* this leg (reporting only — the response stays the 500 internal-error body).
* The entry passes its own `onerror` here when expanding the default, so
* legacy-leg failures are never silently swallowed.
*/
function createLegacyStatelessFallback(factory, onerror, keepAliveMs, maxRequestBodySize) {
	return async (request, options) => {
		if (request.method.toUpperCase() !== "POST") return jsonRpcErrorResponse(405, -32e3, "Method not allowed.");
		try {
			const product = await factory({
				era: "legacy",
				...options?.authInfo !== void 0 && { authInfo: options.authInfo },
				requestInfo: request
			});
			const transport = new WebStandardStreamableHTTPServerTransport({
				sessionIdGenerator: void 0,
				...keepAliveMs !== void 0 && { keepAliveMs },
				...maxRequestBodySize !== void 0 && { maxRequestBodySize }
			});
			await product.connect(transport);
			const teardown = () => {
				transport.close().catch(() => {});
				product.close().catch(() => {});
			};
			request.signal?.addEventListener("abort", teardown, { once: true });
			const response = await transport.handleRequest(request, {
				...options?.authInfo !== void 0 && { authInfo: options.authInfo },
				...options?.parsedBody !== void 0 && { parsedBody: options.parsedBody }
			});
			if (response.body === null || mediaTypeEssence(response.headers.get("content-type")) !== "text/event-stream") {
				teardown();
				return response;
			}
			const reader = response.body.getReader();
			let toreDown = false;
			const completeExchange = () => {
				if (!toreDown) {
					toreDown = true;
					teardown();
				}
			};
			const monitoredBody = new ReadableStream({
				pull: async (controller) => {
					try {
						const { done, value } = await reader.read();
						if (done) {
							completeExchange();
							controller.close();
							return;
						}
						if (value !== void 0) controller.enqueue(value);
					} catch (error) {
						completeExchange();
						controller.error(error);
					}
				},
				cancel: (reason) => {
					completeExchange();
					return reader.cancel(reason).catch(() => {});
				}
			});
			return new Response(monitoredBody, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers
			});
		} catch (error) {
			try {
				onerror?.(toError(error));
			} catch {}
			return internalServerErrorResponse(echoableRequestId(options?.parsedBody));
		}
	};
}
function legacyStatelessFallback(factory, onerror, options) {
	return createLegacyStatelessFallback(factory, onerror, void 0, resolveMaxRequestBodySize(options?.maxRequestBodySize));
}
/**
* Read the SEP-2243 standard request headers off the inbound request.
*
* Both halves of the standard-header story need them — the body-primary
* classifier for its cross-check cells, and
* {@linkcode validateStandardRequestHeaders} for the presence half — and a
* header read at one site but not the other is precisely how a required header
* goes unenforced: that divergence is what let a modern POST omitting
* `MCP-Protocol-Version` be served. Read them here once so a header added to
* {@linkcode InboundHttpRequest} reaches both sites together.
*/
function standardHeadersOf(request) {
	return {
		protocolVersionHeader: request.headers.get("mcp-protocol-version") ?? void 0,
		mcpMethodHeader: request.headers.get("mcp-method") ?? void 0,
		mcpNameHeader: request.headers.get("mcp-name") ?? void 0
	};
}
/**
* The entry's classification step: read the request body exactly once (unless
* a pre-parsed body is supplied) and classify the request with
* {@linkcode classifyInboundRequest}. This is the single code path behind both
* {@linkcode createMcpHandler}'s routing and the exported
* {@linkcode isLegacyRequest} predicate, so the two can never disagree.
*
* Pass `needsForward: false` when the caller never reads `forwardRequest` —
* the body-preserving clone is then skipped and `forwardRequest` is the
* (consumed) input request.
*/
async function classifyEntryRequest(request, providedParsedBody, needsForward = true, maxRequestBodySize = DEFAULT_MAX_REQUEST_BODY_SIZE) {
	const httpMethod = request.method.toUpperCase();
	let body;
	let parsedBody = providedParsedBody;
	let forwardRequest = request;
	let unparseable = false;
	if (httpMethod === "POST") {
		if (parsedBody === void 0) {
			if (needsForward) forwardRequest = request.clone();
			let bodyText;
			try {
				const read = await readRequestBody(request, maxRequestBodySize);
				if (read.tooLarge) return { step: "body-too-large" };
				bodyText = read.text;
			} catch {
				return { step: "unreadable-body" };
			}
			try {
				body = bodyText.length === 0 ? void 0 : JSON.parse(bodyText);
			} catch {
				unparseable = true;
			}
			if (!unparseable && body !== void 0) parsedBody = body;
		} else body = parsedBody;
		if (unparseable || body === void 0) return {
			step: "no-json-body",
			forwardRequest
		};
	}
	return {
		step: "classified",
		outcome: classifyInboundRequest({
			httpMethod,
			...standardHeadersOf(request),
			...body !== void 0 && { body }
		}),
		body,
		parsedBody,
		forwardRequest
	};
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
async function isLegacyRequest(request, parsedBody, options) {
	const maxRequestBodySize = resolveMaxRequestBodySize(options?.maxRequestBodySize);
	const classified = await classifyEntryRequest(parsedBody === void 0 && request.method.toUpperCase() === "POST" ? request.clone() : request, parsedBody, false, maxRequestBodySize);
	return classified.step === "no-json-body" || classified.step === "classified" && classified.outcome.kind === "legacy";
}
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
function createMcpHandler(factory, options = {}) {
	const { legacy, onerror, responseMode } = options;
	const maxRequestBodySize = resolveMaxRequestBodySize(options.maxRequestBodySize);
	if (typeof legacy === "function") throw new TypeError("The 'legacy' option only accepts 'stateless' or 'reject', not a handler function. To serve 2025-era traffic with your own handler, route in user land with the exported isLegacyRequest(request) predicate in front of a strict (legacy: 'reject') handler.");
	/** Modern per-request instances with an exchange still in flight (close() tears these down). */
	const inflight = /* @__PURE__ */ new Set();
	let closed = false;
	const reportError = (error) => {
		try {
			onerror?.(error);
		} catch {}
	};
	const bus = options.bus ?? new InMemoryServerEventBus(reportError);
	const notify = createServerNotifier(bus);
	const listenRouter = createListenRouter({
		bus,
		maxSubscriptions: options.maxSubscriptions ?? DEFAULT_MAX_SUBSCRIPTIONS,
		keepAliveMs: options.keepAliveMs ?? DEFAULT_SSE_KEEP_ALIVE_MS,
		onerror: reportError
	});
	if (responseMode === "json") console.warn("responseMode: 'json' drops mid-call notifications. subscriptions/listen streams are always served over SSE regardless; other notifications emitted before a result are dropped.");
	const legacyHandler = legacy === "reject" ? void 0 : createLegacyStatelessFallback(factory, reportError, options.keepAliveMs, maxRequestBodySize);
	async function serveModern(route, request, authInfo) {
		const claimedRevision = route.classification.revision;
		if (claimedRevision === void 0 || !SUPPORTED_MODERN_PROTOCOL_VERSIONS.includes(claimedRevision)) {
			const error = new UnsupportedProtocolVersionError({
				supported: [...SUPPORTED_MODERN_PROTOCOL_VERSIONS],
				requested: claimedRevision ?? "unknown"
			});
			reportError(error);
			return jsonRpcErrorResponse(400, error.code, error.message, error.data, echoableRequestId(route.message));
		}
		const stdHeaderRejection = validateStandardRequestHeaders({
			httpMethod: request.method,
			...standardHeadersOf(request)
		}, route);
		if (stdHeaderRejection !== void 0) {
			reportError(/* @__PURE__ */ new Error(`Rejected inbound request (${stdHeaderRejection.cell}): ${stdHeaderRejection.message}`));
			return rejectionResponse(stdHeaderRejection, echoableRequestId(route.message));
		}
		const meta = route.messageKind === "request" ? requestMetaOf(route.message.params) : void 0;
		const declaredClientCapabilities = meta?.[CLIENT_CAPABILITIES_META_KEY];
		if (route.messageKind === "request") {
			const required = requiredClientCapabilitiesForRequest(route.message.method);
			if (required !== void 0) {
				const missing = missingClientCapabilities(required, declaredClientCapabilities);
				if (missing !== void 0) {
					const error = new MissingRequiredClientCapabilityError({ requiredCapabilities: missing });
					reportError(error);
					return jsonRpcErrorResponse(httpStatusForErrorCode(error.code, "ladder"), error.code, error.message, error.data, route.message.id);
				}
			}
		}
		const product = await factory({
			era: "modern",
			...authInfo !== void 0 && { authInfo },
			requestInfo: request
		});
		const server = product instanceof McpServer ? product.server : product;
		assertNotServing(server);
		if (route.messageKind === "request" && route.message.method === "subscriptions/listen") {
			const capabilities = server.getCapabilities();
			const serverInfo = serverIdentityOf(server);
			product.close().catch(reportError);
			return listenRouter.serve(route.message, request.signal, capabilities, serverInfo);
		}
		if (route.messageKind === "request" && route.message.method === "tools/call" && product instanceof McpServer) {
			const callParams = route.message.params;
			const toolName = typeof callParams?.name === "string" ? callParams.name : void 0;
			const inputSchema = toolName === void 0 ? void 0 : product.toolInputSchemaJson(toolName);
			if (inputSchema !== void 0) {
				const scan = scanXMcpHeaderDeclarations(inputSchema);
				if (scan.declarations !== void 0 && scan.declarations.length > 0) {
					const rejection = validateMcpParamHeaders(scan.declarations, callParams?.arguments, request.headers);
					if (rejection !== void 0) {
						product.close().catch(reportError);
						reportError(/* @__PURE__ */ new Error(`Rejected inbound request (${rejection.cell}): ${rejection.message}`));
						return rejectionResponse(rejection, route.message.id);
					}
				}
			}
		}
		if (route.messageKind === "request" && product instanceof McpServer) try {
			const challenge = await findScopeChallenge([route.message], authInfo, (context) => product.resolveScopeChallenge(context));
			if (challenge !== void 0) {
				product.close().catch(reportError);
				return createScopeChallengeResponse(challenge, scopeChallengeResourceMetadataUrl(authInfo));
			}
		} catch (error) {
			product.close().catch(reportError);
			reportError(toError(error));
			return internalServerErrorResponse(route.message.id);
		}
		assertNotServing(server);
		setNegotiatedProtocolVersion(server, claimedRevision);
		installModernOnlyHandlers(server, SUPPORTED_MODERN_PROTOCOL_VERSIONS);
		if (meta !== void 0) seedClientIdentityFromEnvelope(server, {
			clientInfo: meta[CLIENT_INFO_META_KEY],
			clientCapabilities: declaredClientCapabilities
		});
		const previousOnClose = server.onclose;
		inflight.add(server);
		const onExchangeClose = () => {
			inflight.delete(server);
			if (server.onclose === onExchangeClose) server.onclose = previousOnClose;
			previousOnClose?.();
		};
		server.onclose = onExchangeClose;
		try {
			const response = await invoke(product, route.message, {
				classification: route.classification,
				request,
				...authInfo !== void 0 && { authInfo },
				...responseMode !== void 0 && { responseMode },
				...options.keepAliveMs !== void 0 && { keepAliveMs: options.keepAliveMs }
			});
			if (route.messageKind === "notification") queueMicrotask(() => void server.close().catch(() => {}));
			return response;
		} catch (error) {
			if (error instanceof SdkError && error.code === SdkErrorCode.ConnectionClosed) return new Response(null, { status: 499 });
			await server.close().catch(() => {});
			inflight.delete(server);
			reportError(toError(error));
			return internalServerErrorResponse(echoableRequestId(route.message));
		}
	}
	async function serveLegacyRoute(route, forwardRequest, authInfo, parsedBody) {
		if (legacyHandler !== void 0) return legacyHandler(forwardRequest, {
			...authInfo !== void 0 && { authInfo },
			...parsedBody !== void 0 && { parsedBody }
		});
		const strict = modernOnlyStrictRejection(route, SUPPORTED_MODERN_PROTOCOL_VERSIONS);
		if (strict === void 0) return new Response(null, { status: 202 });
		reportError(/* @__PURE__ */ new Error(`Rejected 2025-era request on a modern-only endpoint (${strict.cell}): ${strict.message}`));
		return rejectionResponse(strict, echoableRequestId(parsedBody));
	}
	async function handle(request, requestOptions) {
		const authInfo = requestOptions?.authInfo;
		if (request.method.toUpperCase() === "POST" && !isJsonContentType(request.headers.get("content-type"))) {
			reportError(/* @__PURE__ */ new Error("Unsupported Media Type: Content-Type must be application/json"));
			return jsonRpcErrorResponse(415, -32e3, "Unsupported Media Type: Content-Type must be application/json");
		}
		const classified = await classifyEntryRequest(request, requestOptions?.parsedBody, true, maxRequestBodySize);
		if (classified.step === "unreadable-body") return jsonRpcErrorResponse(400, -32700, "Parse error: the request body could not be read");
		if (classified.step === "body-too-large") return jsonRpcErrorResponse(413, -32e3, requestBodyTooLargeMessage(maxRequestBodySize));
		if (classified.step === "no-json-body") {
			if (legacyHandler !== void 0) return legacyHandler(classified.forwardRequest, { ...authInfo !== void 0 && { authInfo } });
			return jsonRpcErrorResponse(400, -32700, "Parse error: the request body is not valid JSON");
		}
		const { outcome, body, parsedBody, forwardRequest } = classified;
		try {
			switch (outcome.kind) {
				case "reject":
					reportError(/* @__PURE__ */ new Error(`Rejected inbound request (${outcome.cell}): ${outcome.message}`));
					return rejectionResponse(outcome, echoableRequestId(body));
				case "modern": return await serveModern(outcome, request, authInfo);
				case "legacy": return await serveLegacyRoute(outcome, forwardRequest, authInfo, parsedBody);
			}
		} catch (error) {
			reportError(toError(error));
			return internalServerErrorResponse(echoableRequestId(body));
		}
	}
	const fetchFace = async (request, requestOptions) => {
		if (closed) throw new Error("This MCP handler has been closed");
		try {
			return await handle(request, requestOptions);
		} catch (error) {
			reportError(toError(error));
			return internalServerErrorResponse(echoableRequestId(requestOptions?.parsedBody));
		}
	};
	return {
		fetch: fetchFace,
		notify,
		bus,
		close: async () => {
			closed = true;
			listenRouter.closeAll();
			const closing = [...inflight].map((server) => server.close().catch(() => {}));
			inflight.clear();
			await Promise.all(closing);
		}
	};
}

//#endregion
//#region src/server/middleware/hostHeaderValidation.ts
/**
* Parse and validate a `Host` header against an allowlist of hostnames (port-agnostic).
*
* - Input host header may include a port (e.g. `localhost:3000`) or IPv6 brackets (e.g. `[::1]:3000`).
* - Allowlist items should be hostnames only (no ports). For IPv6, include brackets (e.g. `[::1]`).
*/
function validateHostHeader(hostHeader, allowedHostnames) {
	if (!hostHeader) return {
		ok: false,
		errorCode: "missing_host",
		message: "Missing Host header"
	};
	let hostname;
	try {
		hostname = new URL(`http://${hostHeader}`).hostname;
	} catch {
		return {
			ok: false,
			errorCode: "invalid_host_header",
			message: `Invalid Host header: ${hostHeader}`,
			hostHeader
		};
	}
	if (!allowedHostnames.includes(hostname)) return {
		ok: false,
		errorCode: "invalid_host",
		message: `Invalid Host: ${hostname}`,
		hostHeader,
		hostname
	};
	return {
		ok: true,
		hostname
	};
}
/**
* Convenience allowlist for `localhost` DNS rebinding protection.
*/
function localhostAllowedHostnames() {
	return [
		"localhost",
		"127.0.0.1",
		"[::1]"
	];
}
/**
* Web-standard `Request` helper for DNS rebinding protection.
* @example
* ```ts source="./hostHeaderValidation.examples.ts#hostHeaderValidationResponse_basicUsage"
* const result = validateHostHeader(req.headers.get('host'), ['localhost']);
* ```
*/
function hostHeaderValidationResponse(req, allowedHostnames) {
	const result = validateHostHeader(req.headers.get("host"), allowedHostnames);
	if (result.ok) return void 0;
	return Response.json({
		jsonrpc: "2.0",
		error: {
			code: -32e3,
			message: result.message
		},
		id: null
	}, {
		status: 403,
		headers: { "Content-Type": "application/json" }
	});
}

//#endregion
//#region src/server/middleware/originValidation.ts
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
function validateOriginHeader(originHeader, allowedOriginHostnames) {
	if (originHeader === null || originHeader === void 0 || originHeader === "") return { ok: true };
	let hostname;
	let scheme;
	try {
		const url = new URL(originHeader);
		hostname = url.hostname;
		scheme = url.protocol;
	} catch {
		return {
			ok: false,
			errorCode: "invalid_origin_header",
			message: `Invalid Origin header: ${originHeader}`,
			originHeader
		};
	}
	if (hostname === "") return {
		ok: false,
		errorCode: "invalid_origin_header",
		message: `Invalid Origin header: ${originHeader}`,
		originHeader
	};
	if (!(scheme !== "http:" && scheme !== "https:" && allowedOriginHostnames.includes(`${scheme}//*`)) && !allowedOriginHostnames.includes(hostname)) return {
		ok: false,
		errorCode: "invalid_origin",
		message: `Invalid Origin: ${hostname}`,
		originHeader,
		hostname
	};
	return {
		ok: true,
		origin: originHeader,
		hostname
	};
}
/**
* Convenience allowlist of localhost-class origin hostnames, mirroring
* `localhostAllowedHostnames`.
*/
function localhostAllowedOrigins() {
	return [
		"localhost",
		"127.0.0.1",
		"[::1]"
	];
}
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
function originValidationResponse(req, allowedOriginHostnames) {
	const result = validateOriginHeader(req.headers.get("origin"), allowedOriginHostnames);
	if (result.ok) return void 0;
	return Response.json({
		jsonrpc: "2.0",
		error: {
			code: -32e3,
			message: result.message
		},
		id: null
	}, {
		status: 403,
		headers: { "Content-Type": "application/json" }
	});
}

//#endregion
//#region src/server/requestStateCodec.ts
const PREFIX = "v1.";
function bytesToBase64Url(bytes) {
	let bin = "";
	for (const b of bytes) bin += String.fromCodePoint(b);
	return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function constantTimeTagEqual(a, b) {
	if (a.length !== b.length) return false;
	let r = 0;
	for (let i = 0; i < a.length; i++) r |= a.codePointAt(i) ^ b.codePointAt(i);
	return r === 0;
}
function base64UrlToBytes(s) {
	const b64 = s.replaceAll("-", "+").replaceAll("_", "/");
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.codePointAt(i);
	return bytes;
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
function createRequestStateCodec(options) {
	const subtle = globalThis.crypto?.subtle;
	if (subtle === void 0) throw new TypeError("createRequestStateCodec requires the Web Crypto API (globalThis.crypto.subtle); see https://ts.sdk.modelcontextprotocol.io/v2/troubleshooting for the Node.js polyfill instructions");
	const keyBytes = typeof options.key === "string" ? new TextEncoder().encode(options.key) : Uint8Array.from(options.key);
	if (keyBytes.byteLength < 32) throw new RangeError(`createRequestStateCodec: key must be at least 32 bytes (got ${keyBytes.byteLength})`);
	const ttlSeconds = options.ttlSeconds ?? 600;
	if (!Number.isFinite(ttlSeconds)) throw new RangeError("createRequestStateCodec: ttlSeconds must be a finite number");
	const bind = options.bind;
	let cryptoKey;
	const importedKey = () => cryptoKey ??= subtle.importKey("raw", keyBytes, {
		name: "HMAC",
		hash: "SHA-256"
	}, false, ["sign", "verify"]);
	const utf8 = new TextEncoder();
	const BIND_LABEL = "mcp.requestState.bind:";
	const bindTag = async (value) => {
		return bytesToBase64Url(new Uint8Array(await subtle.sign("HMAC", await importedKey(), utf8.encode(BIND_LABEL + value))).slice(0, 16));
	};
	return {
		async mint(payload, ctx) {
			const envelope = {
				p: payload,
				exp: Math.floor(Date.now() / 1e3) + ttlSeconds
			};
			if (bind !== void 0) {
				if (ctx === void 0) throw new TypeError("createRequestStateCodec: mint() requires ctx when a bind callback is configured");
				envelope.b = await bindTag(bind(ctx));
			}
			const body = bytesToBase64Url(utf8.encode(JSON.stringify(envelope)));
			return `${PREFIX}${body}.${bytesToBase64Url(new Uint8Array(await subtle.sign("HMAC", await importedKey(), utf8.encode(PREFIX + body))))}`;
		},
		async verify(state, ctx) {
			const dot = state.lastIndexOf(".");
			if (!state.startsWith(PREFIX) || dot <= 3) throw new Error("malformed");
			const body = state.slice(3, dot);
			let macBytes;
			try {
				macBytes = base64UrlToBytes(state.slice(dot + 1));
			} catch {
				throw new Error("malformed");
			}
			if (!await subtle.verify("HMAC", await importedKey(), macBytes, utf8.encode(PREFIX + body))) throw new Error("mac");
			let envelope;
			try {
				envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(body)));
			} catch {
				throw new Error("malformed");
			}
			if (typeof envelope.exp !== "number" || envelope.exp < Math.floor(Date.now() / 1e3)) throw new Error("expired");
			if (bind !== void 0) {
				const expected = await bindTag(bind(ctx));
				if (envelope.b === void 0 || !constantTimeTagEqual(envelope.b, expected)) throw new Error("bind");
			} else if (envelope.b !== void 0) throw new Error("bind");
			return envelope.p;
		}
	};
}

//#endregion
//#region src/fromJsonSchema.ts
let _defaultValidator;
function fromJsonSchema(schema, validator) {
	return fromJsonSchema$1(schema, validator ?? (_defaultValidator ??= new DefaultJsonSchemaValidator()));
}

//#endregion
export { BAGGAGE_META_KEY, CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, DEFAULT_MAX_REQUEST_BODY_SIZE, DEFAULT_NEGOTIATED_PROTOCOL_VERSION, DEFAULT_REQUEST_TIMEOUT_MSEC, INTERNAL_ERROR, INVALID_PARAMS, INVALID_REQUEST, InMemoryServerEventBus, InMemoryTransport, JSONRPC_VERSION, LATEST_PROTOCOL_VERSION, LOG_LEVEL_META_KEY, METHOD_NOT_FOUND, McpServer, MissingRequiredClientCapabilityError, OAuthError, OAuthErrorCode, PARSE_ERROR, PROTOCOL_VERSION_META_KEY, PerRequestHTTPServerTransport, Protocol, ProtocolError, ProtocolErrorCode, RELATED_TASK_META_KEY, ReadBuffer, ResourceNotFoundError, ResourceTemplate, SERVER_INFO_META_KEY, STDIO_DEFAULT_MAX_BUFFER_SIZE, SUBSCRIPTION_ID_META_KEY, SUPPORTED_PROTOCOL_VERSIONS, SdkError, SdkErrorCode, SdkHttpError, Server, TRACEPARENT_META_KEY, TRACESTATE_META_KEY, UnsupportedProtocolVersionError, UriTemplate, UrlElicitationRequiredError, WebStandardStreamableHTTPServerTransport, acceptedContent, assertCompleteRequestPrompt, assertCompleteRequestResourceTemplate, bearerAuthChallengeResponse, buildOAuthProtectedResourceMetadata, checkResourceAllowed, classifyInboundRequest, completable, createFetchWithInit, createMcpHandler, createRequestStateCodec, deserializeMessage, fromJsonSchema, getDisplayName, getOAuthProtectedResourceMetadataUrl, hostHeaderValidationResponse, inputRequired, inputResponse, isCallToolResult, isCompletable, isInitializeRequest, isInitializedNotification, isInputRequiredResult, isJSONRPCErrorResponse, isJSONRPCNotification, isJSONRPCRequest, isJSONRPCResponse, isJSONRPCResultResponse, isJsonContentType, isLegacyRequest, isSpecType, isTaskAugmentedRequestParams, legacyStatelessFallback, localhostAllowedHostnames, localhostAllowedOrigins, mergeCapabilities, oauthMetadataResponse, originValidationResponse, parseJSONRPCMessage, preloadSchemas, readRequestBody, requireBearerAuth, requireScopes, resourceUrlFromServerUrl, serializeMessage, specTypeSchemas, validateHostHeader, validateOriginHeader, verifyBearerToken };
//# sourceMappingURL=index.mjs.map