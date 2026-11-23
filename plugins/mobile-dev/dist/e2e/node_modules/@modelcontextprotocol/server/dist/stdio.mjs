import { i as installModernOnlyHandlers, o as serverIdentityOf, t as McpServer } from "./mcp-oHn3ureC.mjs";
import { F as carriesValidModernEnvelopeClaim, J as isJSONRPCErrorResponse, Q as isJSONRPCResultResponse, R as modernOnlyStrictRejection, X as isJSONRPCRequest, Y as isJSONRPCNotification, at as requestMetaOf, c as ReadBuffer, d as serializeMessage, ft as UnsupportedProtocolVersionError, it as hasEnvelopeClaim, mt as ProtocolErrorCode, ot as validateEnvelopeMeta, rt as envelopeClaimVersion, vt as SUPPORTED_MODERN_PROTOCOL_VERSIONS, y as setNegotiatedProtocolVersion } from "./src-DdvbAHrR.mjs";
import { n as StdioListenRouter, t as DEFAULT_MAX_SUBSCRIPTIONS } from "./listenRouter-Bartj63y.mjs";
import { process } from "@modelcontextprotocol/server/_shims";

//#region src/server/stdio.ts
/**
* Marks a stdout `'error'` listener that a closed transport left attached purely to
* swallow late write failures (see {@link StdioServerTransport.close}). A fresh
* transport taking over the same stream removes listeners carrying this tag in
* `start()`, so repeated create→close cycles on the process-global `process.stdout`
* don't accumulate listeners.
*/
const swallowsErrorsAfterClose = Symbol("swallowsErrorsAfterClose");
/**
* Server transport for stdio: this communicates with an MCP client by reading from the current process' `stdin` and writing to `stdout`.
*
* This transport is only available in Node.js environments.
*
* When the client closes its end of the pipe (stdin reaches end-of-file), the transport
* closes itself and fires `onclose`, per the MCP stdio binding's guidance that servers
* should exit promptly when their standard input is closed. A server that holds no other
* keep-alive handles will then exit naturally. Requests still in flight when stdin ends are
* aborted and not answered; a client that expects responses keeps stdin open until it has
* read them.
*
* @example
* ```ts source="./stdio.examples.ts#StdioServerTransport_basicUsage"
* const server = new McpServer({ name: 'my-server', version: '1.0.0' });
* const transport = new StdioServerTransport();
* await server.connect(transport);
* ```
*/
var StdioServerTransport = class {
	_readBuffer;
	_started = false;
	_closed = false;
	constructor(_stdin = process.stdin, _stdout = process.stdout, options) {
		this._stdin = _stdin;
		this._stdout = _stdout;
		this._readBuffer = new ReadBuffer({ maxBufferSize: options?.maxBufferSize });
	}
	onclose;
	onerror;
	onmessage;
	_ondata = (chunk) => {
		try {
			this._readBuffer.append(chunk);
			this.processReadBuffer();
		} catch (error) {
			this.onerror?.(error);
			this.close().catch(() => {});
		}
	};
	_onerror = (error) => {
		this.onerror?.(error);
	};
	_onstdouterror = (error) => {
		if (this._closed) return;
		this.onerror?.(error);
		this.close().catch(() => {});
	};
	_onstdinclose = () => {
		this.close().catch(() => {});
	};
	/**
	* Starts listening for messages on `stdin`.
	*/
	async start() {
		if (this._started) throw new Error("StdioServerTransport already started! If using Server class, note that connect() calls start() automatically.");
		this._started = true;
		for (const listener of this._stdout.listeners("error")) if (listener[swallowsErrorsAfterClose]) this._stdout.off("error", listener);
		if (this._stdin.readableEnded || this._stdin.destroyed) setImmediate(this._onstdinclose);
		this._stdin.on("data", this._ondata);
		this._stdin.on("error", this._onerror);
		this._stdin.on("end", this._onstdinclose);
		this._stdin.on("close", this._onstdinclose);
		this._stdout.on("error", this._onstdouterror);
	}
	processReadBuffer() {
		while (true) try {
			const message = this._readBuffer.readMessage();
			if (message === null) break;
			this.onmessage?.(message);
		} catch (error) {
			this.onerror?.(error);
		}
	}
	async close() {
		if (this._closed) return;
		this._closed = true;
		this._stdin.off("data", this._ondata);
		this._stdin.off("error", this._onerror);
		this._stdin.off("end", this._onstdinclose);
		this._stdin.off("close", this._onstdinclose);
		this._onstdouterror[swallowsErrorsAfterClose] = true;
		if (this._stdin.listenerCount("data") === 0) this._stdin.pause();
		this._readBuffer.clear();
		this.onclose?.();
	}
	send(message) {
		if (this._closed) return Promise.reject(/* @__PURE__ */ new Error("StdioServerTransport is closed"));
		return new Promise((resolve, reject) => {
			const json = serializeMessage(message);
			let settled = false;
			const onError = (error) => {
				if (settled) return;
				settled = true;
				this._stdout.off("error", onError);
				this._stdout.off("drain", onDrain);
				reject(error);
			};
			const onDrain = () => {
				if (settled) return;
				settled = true;
				this._stdout.off("error", onError);
				this._stdout.off("drain", onDrain);
				resolve();
			};
			this._stdout.once("error", onError);
			if (this._stdout.write(json)) {
				if (settled) return;
				settled = true;
				this._stdout.off("error", onError);
				resolve();
			} else if (!settled) this._stdout.once("drain", onDrain);
		});
	}
};

//#endregion
//#region src/server/serveStdio.ts
/**
* How long the probe-discard path waits for the probe instance to answer the
* requests it was delivered before closing it. The wait normally settles as
* soon as the DiscoverResult is handed to the wire (or immediately, when a
* delivered cancellation already settled the probe); the bound is a backstop
* so no edge can ever hold the connection's inbound pump indefinitely behind
* the discard.
*/
const DISCARD_ANSWER_TIMEOUT_MS = 3e3;
/**
* The transport a pinned instance is connected to: a thin channel that writes
* through to the entry-owned wire transport and receives the messages the
* entry forwards. The wire transport itself is never handed to an instance —
* that is what lets the entry discard an optimistic probe instance (close the
* channel) without tearing down the connection.
*/
var StdioConnectionChannel = class {
	onclose;
	onerror;
	onmessage;
	_closed = false;
	/** Request ids the entry delivered to the instance that the instance has not yet answered. */
	_pendingRequests = /* @__PURE__ */ new Set();
	_drainWaiters = [];
	constructor(_wire, _onInstanceClose, _outboundIntercept) {
		this._wire = _wire;
		this._onInstanceClose = _onInstanceClose;
		this._outboundIntercept = _outboundIntercept;
	}
	async start() {}
	async send(message, options) {
		if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
			const { id } = message;
			if (id !== void 0) this._settle(id);
		}
		if (this._closed) return;
		if (this._outboundIntercept?.(message) === "handled") return;
		return this._wire.send(message, options);
	}
	setProtocolVersion = (version) => {
		this._wire.setProtocolVersion?.(version);
	};
	/** Forwards one inbound message to the connected instance. */
	deliver(message, extra) {
		if (this._closed) return;
		if (isJSONRPCRequest(message)) this._pendingRequests.add(message.id);
		else if (isJSONRPCNotification(message) && message.method === "notifications/cancelled") {
			const cancelledId = message.params?.requestId;
			if (cancelledId !== void 0) this._settle(cancelledId);
		}
		this.onmessage?.(message, extra);
	}
	/**
	* Resolves once every request delivered to the instance has been answered
	* through {@linkcode send}, settled by a delivered cancellation, or the
	* channel has been closed and nothing further can be answered. The wait is
	* bounded by `timeoutMs` as a backstop so no edge can hold the caller
	* indefinitely; resolves `false` only when the bound elapsed with requests
	* still unanswered. Used by the probe-discard path so a probe request the
	* entry accepted is never silently dropped.
	*/
	async whenRequestsAnswered(timeoutMs) {
		if (this._closed || this._pendingRequests.size === 0) return true;
		return await new Promise((resolve) => {
			const waiter = () => {
				clearTimeout(timer);
				resolve(true);
			};
			const timer = setTimeout(() => {
				this._drainWaiters = this._drainWaiters.filter((pending) => pending !== waiter);
				resolve(false);
			}, timeoutMs);
			this._drainWaiters.push(waiter);
		});
	}
	async close() {
		if (this._closed) return;
		this._closed = true;
		this._pendingRequests.clear();
		this._releaseDrainWaiters();
		try {
			this._onInstanceClose();
		} finally {
			this.onclose?.();
		}
	}
	_settle(id) {
		this._pendingRequests.delete(id);
		if (this._pendingRequests.size === 0) this._releaseDrainWaiters();
	}
	_releaseDrainWaiters() {
		const waiters = this._drainWaiters;
		this._drainWaiters = [];
		for (const waiter of waiters) waiter();
	}
};
/**
* Classifies one message of the opening exchange with the same body-primary
* rules the HTTP entry applies per request: `initialize` is the legacy
* handshake unless it carries a valid modern envelope claim; a present claim
* is validated (never silently ignored); a claim-less message is 2025-era
* traffic. There is no header layer on stdio, so the body is the only signal.
*/
function classifyOpeningMessage(message) {
	const params = message.params;
	if (message.method === "initialize" && !carriesValidModernEnvelopeClaim(params)) {
		const requestedVersion = params !== null && typeof params === "object" && typeof params.protocolVersion === "string" ? params.protocolVersion : void 0;
		return {
			kind: "legacy",
			reason: "initialize",
			...requestedVersion !== void 0 && { requestedVersion }
		};
	}
	if (!hasEnvelopeClaim(params)) return {
		kind: "legacy",
		reason: "no-claim"
	};
	const meta = requestMetaOf(params);
	const firstIssue = (meta === void 0 ? [] : validateEnvelopeMeta(meta))[0];
	if (firstIssue !== void 0) return {
		kind: "invalid-envelope",
		issue: firstIssue
	};
	const claimedVersion = envelopeClaimVersion(params);
	if (claimedVersion === void 0 || !SUPPORTED_MODERN_PROTOCOL_VERSIONS.includes(claimedVersion)) return {
		kind: "unsupported-revision",
		requested: claimedVersion ?? "unknown"
	};
	return {
		kind: "modern",
		revision: claimedVersion,
		classification: {
			era: "modern",
			revision: claimedVersion
		}
	};
}
/**
* Serves MCP over stdio from a server factory, owning the era decision for
* the connection: the opening exchange selects the era, ONE instance from the
* factory is pinned for the connection lifetime, and everything after passes
* straight through to it. See the module documentation for the opening rules.
*
* ```ts
* import { serveStdio } from '@modelcontextprotocol/server/stdio';
*
* serveStdio(() => {
*     const server = new McpServer({ name: 'my-server', version: '1.0.0' }, { capabilities: { tools: {} } });
*     // register tools/resources/prompts once — the same factory serves both eras
*     return server;
* });
* ```
*/
function serveStdio(factory, options = {}) {
	const legacyMode = options.legacy ?? "serve";
	const wire = options.transport ?? new StdioServerTransport();
	let state = { phase: "opening" };
	/** Channel currently being discarded (its close must not tear the connection down). */
	let discarding;
	let closing = false;
	/**
	* Whether the connection has been torn down (`handle.close()` or the wire
	* closing). The opening arms re-check this after every await: a close can
	* race factory construction, and the continuation must neither resurrect
	* the connection state nor keep a late-resolved instance around.
	*/
	const isTornDown = () => closing || state.phase === "closed";
	const reportError = (error) => {
		try {
			options.onerror?.(error);
		} catch {}
	};
	const writeErrorResponse = (id, code, message, data) => wire.send({
		jsonrpc: "2.0",
		id,
		error: {
			code,
			message,
			...data !== void 0 && { data }
		}
	}).catch((error) => reportError(toError(error)));
	/**
	* Entry-handled `subscriptions/listen` for this connection: holds the
	* active subscriptions, serves inbound listen / cancelled-of-listen
	* before the pinned instance is consulted, and rewrites the instance's
	* outbound change notifications onto the active subscriptions. Only
	* consulted on a modern-pinned connection — on a legacy connection
	* change notifications pass straight through (the 2025 unsolicited
	* delivery model is unchanged).
	*/
	const listenRouter = new StdioListenRouter(options.maxSubscriptions ?? DEFAULT_MAX_SUBSCRIPTIONS);
	/** Outbound intercept installed on a modern instance's channel. */
	const modernOutboundIntercept = (message) => {
		if (!isJSONRPCNotification(message)) return void 0;
		const routed = listenRouter.routeOutbound(message);
		if (routed === "passthrough") return void 0;
		for (const stamped of routed) wire.send({
			jsonrpc: "2.0",
			...stamped
		}).catch((error) => reportError(toError(error)));
		return "handled";
	};
	/**
	* Entry-handled inbound listen routing for a modern-pinned connection.
	* Returns `true` when the message was served at the entry and must NOT
	* be delivered to the pinned instance.
	*/
	const tryServeListen = async (message) => {
		if (isJSONRPCRequest(message) && message.method === "subscriptions/listen") {
			const meta = requestMetaOf(message.params);
			const issue = hasEnvelopeClaim(message.params) ? (meta === void 0 ? [] : validateEnvelopeMeta(meta))[0] : {
				key: "_meta",
				problem: "the per-request envelope is required on protocol revision 2026-07-28"
			};
			const claimedVersion = envelopeClaimVersion(message.params);
			let reply;
			if (issue !== void 0) reply = {
				jsonrpc: "2.0",
				id: message.id,
				error: {
					code: -32602,
					message: `Invalid _meta envelope: ${issue.key}: ${issue.problem}`
				}
			};
			else if (claimedVersion === void 0 || !SUPPORTED_MODERN_PROTOCOL_VERSIONS.includes(claimedVersion)) {
				const error = new UnsupportedProtocolVersionError({
					supported: [...SUPPORTED_MODERN_PROTOCOL_VERSIONS],
					requested: claimedVersion ?? "unknown"
				});
				reply = {
					jsonrpc: "2.0",
					id: message.id,
					error: {
						code: error.code,
						message: error.message,
						data: error.data
					}
				};
			} else reply = listenRouter.serve(message);
			await wire.send("error" in reply ? reply : {
				jsonrpc: "2.0",
				method: reply.method,
				params: reply.params
			}).catch((error) => reportError(toError(error)));
			return true;
		}
		if (isJSONRPCNotification(message) && message.method === "notifications/cancelled") {
			const cancelledId = message.params?.requestId;
			if (cancelledId !== void 0 && listenRouter.cancel(cancelledId)) return true;
		}
		return false;
	};
	/** Answers a 2025-era request the entry will not serve (the modern-only rejection cells). */
	const answerLegacyRejection = (request, reason, requestedVersion) => {
		const rejection = modernOnlyStrictRejection({
			kind: "legacy",
			reason,
			...requestedVersion !== void 0 && { requestedVersion }
		}, SUPPORTED_MODERN_PROTOCOL_VERSIONS);
		if (rejection === void 0) return Promise.resolve();
		reportError(/* @__PURE__ */ new Error(`Rejected 2025-era request on a modern-only stdio connection (${rejection.cell}): ${rejection.message}`));
		return writeErrorResponse(request.id, rejection.code, rejection.message, rejection.data);
	};
	const onInstanceClosed = (channel) => {
		if (closing || channel === discarding) return;
		closeAll();
	};
	const connectInstance = async (era, revision) => {
		const product = await factory({ era });
		const server = product instanceof McpServer ? product.server : product;
		if (era === "modern") {
			setNegotiatedProtocolVersion(server, revision);
			installModernOnlyHandlers(server, SUPPORTED_MODERN_PROTOCOL_VERSIONS);
			listenRouter.setServerCapabilities(server.getCapabilities(), serverIdentityOf(server));
		}
		const channel = new StdioConnectionChannel(wire, () => onInstanceClosed(channel), era === "modern" ? modernOutboundIntercept : void 0);
		await product.connect(channel);
		return {
			product,
			channel
		};
	};
	/** Closes an instance whose factory resolved only after the connection was torn down. */
	const disposeLateInstance = (instance) => instance.product.close().catch((error) => reportError(toError(error)));
	const discardProbeInstance = async (instance) => {
		discarding = instance.channel;
		try {
			if (!await instance.channel.whenRequestsAnswered(DISCARD_ANSWER_TIMEOUT_MS)) reportError(/* @__PURE__ */ new Error(`Discarded the probe instance with requests still unanswered after ${DISCARD_ANSWER_TIMEOUT_MS}ms; continuing with the fallback`));
			await instance.product.close();
		} catch (error) {
			reportError(toError(error));
		} finally {
			discarding = void 0;
		}
	};
	const processMessage = async (message) => {
		if (state.phase === "closed") return;
		if (state.phase === "pinned") {
			if (state.era === "modern" && isJSONRPCRequest(message) && message.method === "initialize" && !carriesValidModernEnvelopeClaim(message.params)) {
				await answerLegacyRejection(message, "initialize", message.params !== null && typeof message.params === "object" && typeof message.params.protocolVersion === "string" ? message.params.protocolVersion : void 0);
				return;
			}
			if (state.era === "modern" && await tryServeListen(message)) return;
			if (isTornDown()) return;
			state.instance.channel.deliver(message);
			return;
		}
		if (!isJSONRPCRequest(message) && !isJSONRPCNotification(message)) {
			reportError(/* @__PURE__ */ new Error("Discarded a JSON-RPC response received before the connection negotiated an era"));
			return;
		}
		const opening = classifyOpeningMessage(message);
		switch (opening.kind) {
			case "invalid-envelope": {
				const detail = `Invalid _meta envelope for protocol revision 2026-07-28: ${opening.issue.key}: ${opening.issue.problem}`;
				if (isJSONRPCRequest(message)) await writeErrorResponse(message.id, ProtocolErrorCode.InvalidParams, detail, { envelope: opening.issue });
				else reportError(/* @__PURE__ */ new Error(`Discarded a notification with a malformed envelope: ${detail}`));
				return;
			}
			case "unsupported-revision":
				if (isJSONRPCRequest(message)) {
					const error = new UnsupportedProtocolVersionError({
						supported: [...SUPPORTED_MODERN_PROTOCOL_VERSIONS],
						requested: opening.requested
					});
					reportError(error);
					await writeErrorResponse(message.id, error.code, error.message, error.data);
				} else reportError(/* @__PURE__ */ new Error(`Discarded a notification claiming unsupported protocol revision ${opening.requested}`));
				return;
			case "modern":
				if (isJSONRPCRequest(message) && message.method === "server/discover") {
					if (state.phase === "probe") {
						state.instance.channel.deliver(message, { classification: opening.classification });
						return;
					}
					const instance = await connectInstance("modern", opening.revision);
					if (isTornDown()) {
						await disposeLateInstance(instance);
						return;
					}
					state = {
						phase: "probe",
						instance
					};
					instance.channel.deliver(message, { classification: opening.classification });
					return;
				}
				if (state.phase === "probe") {
					if (isJSONRPCNotification(message)) {
						state.instance.channel.deliver(message, { classification: opening.classification });
						return;
					}
					state = {
						phase: "pinned",
						era: "modern",
						instance: state.instance
					};
				} else {
					const instance = await connectInstance("modern", opening.revision);
					if (isTornDown()) {
						await disposeLateInstance(instance);
						return;
					}
					state = {
						phase: "pinned",
						era: "modern",
						instance
					};
				}
				if (await tryServeListen(message)) return;
				if (isTornDown()) return;
				state.instance.channel.deliver(message, { classification: opening.classification });
				return;
			case "legacy": {
				if (legacyMode === "reject") {
					if (isJSONRPCRequest(message)) await answerLegacyRejection(message, opening.reason, opening.requestedVersion);
					return;
				}
				if (state.phase === "probe") {
					await discardProbeInstance(state.instance);
					if (isTornDown()) return;
					state = { phase: "opening" };
				}
				const instance = await connectInstance("legacy");
				if (isTornDown()) {
					await disposeLateInstance(instance);
					return;
				}
				state = {
					phase: "pinned",
					era: "legacy",
					instance
				};
				state.instance.channel.deliver(message);
				return;
			}
		}
	};
	const queue = [];
	let pumping = false;
	const pump = async () => {
		if (pumping) return;
		pumping = true;
		try {
			while (queue.length > 0) {
				const message = queue.shift();
				try {
					await processMessage(message);
				} catch (error) {
					if (isJSONRPCRequest(message)) await writeErrorResponse(message.id, ProtocolErrorCode.InternalError, "Internal server error");
					reportError(toError(error));
				}
			}
		} finally {
			pumping = false;
		}
	};
	const closeAll = async () => {
		if (closing || state.phase === "closed") return;
		closing = true;
		const current = state;
		state = { phase: "closed" };
		for (const result of listenRouter.teardownAll()) await wire.send(result).catch((error) => reportError(toError(error)));
		if (current.phase === "probe" || current.phase === "pinned") await current.instance.product.close().catch((error) => reportError(toError(error)));
		await wire.close().catch((error) => reportError(toError(error)));
	};
	wire.onmessage = (message) => {
		queue.push(message);
		pump();
	};
	wire.onerror = (error) => {
		reportError(error);
		if (state.phase === "probe" || state.phase === "pinned") state.instance.channel.onerror?.(error);
	};
	wire.onclose = () => {
		if (closing || state.phase === "closed") return;
		closing = true;
		const current = state;
		state = { phase: "closed" };
		if (current.phase === "probe" || current.phase === "pinned") current.instance.product.close().catch((error) => reportError(toError(error)));
	};
	const started = wire.start().catch((error) => {
		reportError(toError(error));
		throw error;
	});
	started.catch(() => {});
	return { close: async () => {
		await started.catch(() => {});
		await closeAll();
	} };
}
function toError(value) {
	return value instanceof Error ? value : new Error(String(value));
}

//#endregion
export { StdioServerTransport, serveStdio };
//# sourceMappingURL=stdio.mjs.map