import { v as DEFAULT_SSE_KEEP_ALIVE_MS, y as armSseKeepAlive } from "./mcp-oHn3ureC.mjs";
import { It as SERVER_INFO_META_KEY, Lt as SUBSCRIPTION_ID_META_KEY, ct as codecForVersion, st as MODERN_WIRE_REVISION } from "./src-DdvbAHrR.mjs";

//#region src/server/serverEventBus.ts
/**
* A `ServerEventBus` backed by an in-process listener set.
*
* `publish()` delivers synchronously to the live listener set (a listener
* unsubscribing itself mid-dispatch is safe; the entry's listen-router
* listeners never unsubscribe peers). A throwing listener does not stop
* delivery to the others.
*/
var InMemoryServerEventBus = class {
	_listeners = /* @__PURE__ */ new Set();
	/**
	* @param onerror - Optional callback for errors thrown by listeners
	*   during dispatch.
	*/
	constructor(onerror) {
		this.onerror = onerror;
	}
	publish(event) {
		for (const listener of this._listeners) try {
			listener(event);
		} catch (error) {
			this.onerror?.(error instanceof Error ? error : new Error(String(error)));
		}
	}
	subscribe(listener) {
		this._listeners.add(listener);
		let live = true;
		return () => {
			if (!live) return;
			live = false;
			this._listeners.delete(listener);
		};
	}
	/** The number of currently registered listeners (test/introspection only — the routers track capacity via their own open-subscription set). */
	get listenerCount() {
		return this._listeners.size;
	}
};
/** Build a {@linkcode ServerNotifier} over a bus. */
function createServerNotifier(bus) {
	return {
		toolsChanged: () => bus.publish({ kind: "tools_list_changed" }),
		promptsChanged: () => bus.publish({ kind: "prompts_list_changed" }),
		resourcesChanged: () => bus.publish({ kind: "resources_list_changed" }),
		resourceUpdated: (uri) => bus.publish({
			kind: "resource_updated",
			uri
		})
	};
}
/**
* Whether a `subscriptions/listen` filter accepts a given change event.
*
* Pure: no I/O, no mutation. The filter governs ONLY the four
* subscription-gated change types — non-gated notifications never reach the
* bus and are not modeled here.
*
* `resource_updated` matches only when `resourceSubscriptions` is present and
* contains the event's URI exactly (per the spec: "for these resource URIs").
*/
function listenFilterAccepts(filter, event) {
	switch (event.kind) {
		case "tools_list_changed": return filter.toolsListChanged === true;
		case "prompts_list_changed": return filter.promptsListChanged === true;
		case "resources_list_changed": return filter.resourcesListChanged === true;
		case "resource_updated": return filter.resourceSubscriptions !== void 0 && filter.resourceSubscriptions.includes(event.uri);
	}
}
/**
* The honored subset of a requested filter: keeps only the fields the client
* explicitly opted in to (drops `false` and absent fields), narrowed against
* the server's declared capabilities when supplied. The serving entry sends
* this back in `notifications/subscriptions/acknowledged` so the ack reflects
* what the server can actually deliver.
*
* - `toolsListChanged` is honored only when `capabilities.tools.listChanged`
*   is advertised; likewise `promptsListChanged` / `resourcesListChanged`.
* - `resourceSubscriptions` is honored only when
*   `capabilities.resources.subscribe` is advertised.
*
* `capabilities` is optional on this pure helper for test convenience only —
* both wired routers REQUIRE capabilities at the call site (the HTTP router's
* `serve()` takes a required parameter; `StdioListenRouter.serve()` throws
* before `setServerCapabilities()` was called), so the fail-open
* `undefined → honor everything` branch is never reachable on a wired entry.
*/
function honoredSubset(requested, capabilities) {
	const honored = {};
	const allow = (bit) => capabilities === void 0 || bit === true;
	if (requested.toolsListChanged === true && allow(capabilities?.tools?.listChanged)) honored.toolsListChanged = true;
	if (requested.promptsListChanged === true && allow(capabilities?.prompts?.listChanged)) honored.promptsListChanged = true;
	if (requested.resourcesListChanged === true && allow(capabilities?.resources?.listChanged)) honored.resourcesListChanged = true;
	if (requested.resourceSubscriptions !== void 0 && requested.resourceSubscriptions.length > 0 && allow(capabilities?.resources?.subscribe)) honored.resourceSubscriptions = [...requested.resourceSubscriptions];
	return honored;
}
/** Map a {@linkcode ServerEvent} onto its wire notification `{method, params}`. */
function serverEventToNotification(event) {
	switch (event.kind) {
		case "tools_list_changed": return {
			method: "notifications/tools/list_changed",
			...event.params !== void 0 && { params: event.params }
		};
		case "prompts_list_changed": return {
			method: "notifications/prompts/list_changed",
			...event.params !== void 0 && { params: event.params }
		};
		case "resources_list_changed": return {
			method: "notifications/resources/list_changed",
			...event.params !== void 0 && { params: event.params }
		};
		case "resource_updated": return {
			method: "notifications/resources/updated",
			params: {
				...event.params,
				uri: event.uri
			}
		};
	}
}

//#endregion
//#region src/server/listenRouter.ts
/** Default capacity guard: refuse a new subscription when this many are already open. */
const DEFAULT_MAX_SUBSCRIPTIONS = 1024;
function jsonRpcError(id, code, message) {
	return Response.json({
		jsonrpc: "2.0",
		error: {
			code,
			message
		},
		id
	}, { status: 200 });
}
/** Stamp the subscription id onto a notification's `_meta`. Non-mutating. */
function stampSubscriptionId(notification, subscriptionId) {
	return {
		method: notification.method,
		params: {
			...notification.params,
			_meta: {
				...notification.params?._meta,
				[SUBSCRIPTION_ID_META_KEY]: subscriptionId
			}
		}
	};
}
/**
* Read the requested filter off a `subscriptions/listen` request body.
* Returns the validated filter, or `undefined` when `params.notifications`
* is absent or fails the schema (the caller answers `-32602` — the spec
* marks `notifications` REQUIRED on the listen request).
*/
function parseListenFilter(message) {
	const outcome = codecForVersion(MODERN_WIRE_REVISION).validateRequest("subscriptions/listen", message);
	return outcome.ok ? outcome.value.params?.notifications : void 0;
}
function createListenRouter(options) {
	const { bus, onerror } = options;
	const maxSubscriptions = options.maxSubscriptions ?? DEFAULT_MAX_SUBSCRIPTIONS;
	const keepAliveMs = options.keepAliveMs ?? DEFAULT_SSE_KEEP_ALIVE_MS;
	const open = /* @__PURE__ */ new Set();
	function serve(message, signal, capabilities, serverInfo) {
		if (open.size >= maxSubscriptions) {
			onerror?.(/* @__PURE__ */ new Error(`subscriptions/listen refused: subscription limit reached (${maxSubscriptions})`));
			return jsonRpcError(message.id, -32603, "Subscription limit reached");
		}
		const filter = parseListenFilter(message);
		if (filter === void 0) return jsonRpcError(message.id, -32602, "Invalid params: 'notifications' is required and must be a valid SubscriptionFilter");
		const honored = honoredSubset(filter, capabilities);
		const subscriptionId = message.id;
		const encoder = new TextEncoder();
		let controller;
		let closed = false;
		let unsubscribe;
		let keepAliveTimer;
		let abortCleanup;
		const writeFrame = (frame) => {
			if (closed) return;
			try {
				controller.enqueue(encoder.encode(frame));
			} catch (error) {
				onerror?.(error instanceof Error ? error : new Error(String(error)));
			}
		};
		const writeNotification = (method, params) => {
			writeFrame(`event: message\ndata: ${JSON.stringify({
				jsonrpc: "2.0",
				method,
				params
			})}\n\n`);
		};
		const teardown = (graceful) => {
			if (closed) return;
			if (graceful) writeFrame(`event: message\ndata: ${JSON.stringify({
				jsonrpc: "2.0",
				id: subscriptionId,
				result: {
					resultType: "complete",
					_meta: {
						[SUBSCRIPTION_ID_META_KEY]: subscriptionId,
						[SERVER_INFO_META_KEY]: serverInfo
					}
				}
			})}\n\n`);
			closed = true;
			try {
				unsubscribe?.();
			} catch (error) {
				onerror?.(error instanceof Error ? error : new Error(String(error)));
			}
			if (keepAliveTimer !== void 0) clearInterval(keepAliveTimer);
			abortCleanup?.();
			open.delete(teardown);
			try {
				controller.close();
			} catch {}
		};
		const readable = new ReadableStream({
			start(streamController) {
				controller = streamController;
				const ack = stampSubscriptionId({
					method: "notifications/subscriptions/acknowledged",
					params: { notifications: honored }
				}, subscriptionId);
				writeNotification(ack.method, ack.params);
				if (Object.keys(honored).length === 0) {
					teardown(true);
					return;
				}
				unsubscribe = bus.subscribe((event) => {
					if (closed || !listenFilterAccepts(honored, event)) return;
					const note = stampSubscriptionId(serverEventToNotification(event), subscriptionId);
					writeNotification(note.method, note.params);
				});
				keepAliveTimer = armSseKeepAlive(keepAliveMs, () => writeFrame(": keepalive\n\n"));
				open.add(teardown);
			},
			cancel() {
				teardown(false);
			}
		});
		if (signal !== void 0) if (signal.aborted) teardown(false);
		else {
			const onAbort = () => teardown(false);
			signal.addEventListener("abort", onAbort, { once: true });
			abortCleanup = () => signal.removeEventListener("abort", onAbort);
		}
		return new Response(readable, {
			status: 200,
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no"
			}
		});
	}
	return {
		serve,
		closeAll() {
			for (const teardown of open) teardown(true);
		},
		get openCount() {
			return open.size;
		}
	};
}
const CHANGE_NOTIFICATION_METHODS = new Set([
	"notifications/tools/list_changed",
	"notifications/prompts/list_changed",
	"notifications/resources/list_changed",
	"notifications/resources/updated"
]);
/**
* Per-connection listen state for the stdio entry. One instance is held by
* `serveStdio` for the connection lifetime; it routes inbound
* `subscriptions/listen` / `notifications/cancelled` and rewrites outbound
* change notifications onto the active subscriptions. No bus — the long-lived
* pinned instance's existing `send*ListChanged()` calls feed straight into
* `routeOutbound()`.
*/
var StdioListenRouter = class {
	/** Active subscriptions, keyed by the listen request's JSON-RPC id verbatim. */
	_subs = /* @__PURE__ */ new Map();
	/**
	* The serving instance's declared capabilities. Filled in by the entry
	* once the modern instance is constructed (the router is created before
	* the instance exists), so the acknowledged filter is narrowed against
	* what the server can actually deliver.
	*/
	_serverCapabilities;
	/**
	* The serving instance's identity, stamped onto the graceful-close
	* results' `_meta` (the spec's `SubscriptionsListenResultMetaObject` extends
	* `ResultMetaObject`). Handed over together with the capabilities.
	*/
	_serverInfo;
	constructor(_maxSubscriptions = DEFAULT_MAX_SUBSCRIPTIONS, serverCapabilities, serverInfo) {
		this._maxSubscriptions = _maxSubscriptions;
		this._serverCapabilities = serverCapabilities;
		this._serverInfo = serverInfo;
	}
	/**
	* Record the serving instance's declared capabilities and identity once
	* it has been constructed. Called by `serveStdio`'s connect path;
	* subsequent `serve()` calls narrow the honored filter against the
	* capabilities, and `teardownAll()` stamps the identity.
	*/
	setServerCapabilities(capabilities, serverInfo) {
		this._serverCapabilities = capabilities;
		if (serverInfo !== void 0) this._serverInfo = serverInfo;
	}
	/** Whether `id` is an active listen subscription on this connection. */
	has(id) {
		return this._subs.has(id);
	}
	/**
	* Serve one inbound `subscriptions/listen` request: registers the
	* subscription and returns the stamped acknowledged notification (or, on
	* capacity / params rejection, the in-band JSON-RPC error response).
	*
	* @throws when called before {@linkcode setServerCapabilities} (or the
	* constructor) has supplied the serving instance's capabilities. Honoring a
	* filter without knowing the server's advertised capabilities would fail
	* open (deliver unadvertised types); the entry guarantees capabilities are
	* set before any listen request is routed here.
	*/
	serve(message) {
		if (this._serverCapabilities === void 0) throw new Error("StdioListenRouter.serve() called before setServerCapabilities(); refusing to honor a filter without capabilities");
		if (this._subs.size >= this._maxSubscriptions) return {
			jsonrpc: "2.0",
			id: message.id,
			error: {
				code: -32603,
				message: "Subscription limit reached"
			}
		};
		const filter = parseListenFilter(message);
		if (filter === void 0) return {
			jsonrpc: "2.0",
			id: message.id,
			error: {
				code: -32602,
				message: "Invalid params: 'notifications' is required and must be a valid SubscriptionFilter"
			}
		};
		const honored = honoredSubset(filter, this._serverCapabilities);
		this._subs.set(message.id, honored);
		return stampSubscriptionId({
			method: "notifications/subscriptions/acknowledged",
			params: { notifications: honored }
		}, message.id);
	}
	/**
	* Tear down one subscription (inbound `notifications/cancelled`). Returns
	* `true` when a subscription was removed. After this call NOTHING further
	* is delivered for that subscription id (the post-cancel hardening).
	*/
	cancel(id) {
		return this._subs.delete(id);
	}
	/**
	* Route an outbound notification through the active subscriptions.
	*
	* - For a subscription-gated change notification, returns one stamped copy
	*   per subscription that opted in to it (an empty array means it is
	*   dropped — the modern era never delivers an un-requested change type).
	* - For any other outbound message, returns `'passthrough'` (the entry
	*   forwards it as-is).
	*/
	routeOutbound(message) {
		if (!CHANGE_NOTIFICATION_METHODS.has(message.method)) return "passthrough";
		const uriParam = message.params?.["uri"];
		const uri = typeof uriParam === "string" ? uriParam : void 0;
		const event = notificationToServerEvent(message.method, uri);
		const out = [];
		for (const [subscriptionId, filter] of this._subs) if (listenFilterAccepts(filter, event)) out.push(stampSubscriptionId({
			method: message.method,
			params: message.params ?? {}
		}, subscriptionId));
		return out;
	}
	/**
	* Server-side graceful teardown of every active subscription: returns the
	* empty `subscriptions/listen` JSON-RPC result for each subscription id —
	* the spec's graceful-close signal, `_meta` carrying the subscription id
	* and the serving instance's identity — for the entry to emit before
	* closing the wire. Clears the set so nothing further is delivered.
	*/
	teardownAll() {
		const out = [];
		for (const id of this._subs.keys()) out.push({
			jsonrpc: "2.0",
			id,
			result: {
				resultType: "complete",
				_meta: {
					[SUBSCRIPTION_ID_META_KEY]: id,
					...this._serverInfo !== void 0 && { [SERVER_INFO_META_KEY]: this._serverInfo }
				}
			}
		});
		this._subs.clear();
		return out;
	}
};
function notificationToServerEvent(method, uri) {
	switch (method) {
		case "notifications/tools/list_changed": return { kind: "tools_list_changed" };
		case "notifications/prompts/list_changed": return { kind: "prompts_list_changed" };
		case "notifications/resources/list_changed": return { kind: "resources_list_changed" };
		default: return {
			kind: "resource_updated",
			uri: uri ?? ""
		};
	}
}

//#endregion
export { createServerNotifier as a, InMemoryServerEventBus as i, StdioListenRouter as n, createListenRouter as r, DEFAULT_MAX_SUBSCRIPTIONS as t };
//# sourceMappingURL=listenRouter-Bartj63y.mjs.map