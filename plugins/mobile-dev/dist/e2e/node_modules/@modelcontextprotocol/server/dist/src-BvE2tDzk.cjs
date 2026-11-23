const require_chunk = require('./chunk-Bnu9O96Y.cjs');
const require_dialects = require('./dialects-D8eXzoGv.cjs');
let _modelcontextprotocol_core_internal = require("@modelcontextprotocol/core/internal");
let zod_v4 = require("zod/v4");
zod_v4 = require_chunk.__toESM(zod_v4);

//#region ../core-internal/src/errors/crossBundleBrand.ts
/**
* Cross-bundle `instanceof` support for the SDK error classes.
*
* `@modelcontextprotocol/client` and `@modelcontextprotocol/server` each bundle their
* own copy of `core-internal`, so an error constructed by one package fails a
* prototype-identity `instanceof` against the same class re-exported by the other —
* exactly the check a dual-role process (gateway, host, in-process test) writes.
*
* Instead of prototype identity, branded classes stamp every instance with the brand
* strings of its class chain under a registry symbol (`Symbol.for`, shared across
* bundles and realms), and resolve `instanceof` via `Symbol.hasInstance` against the
* brand set. Ordinary prototype-based `instanceof` is kept as a fallback so behavior
* is unchanged for anything unbranded.
*
* A class participates by defining an **own** `mcpBrand` static (via a `static {}`
* block, so nothing reaches the declaration files — a declared `protected static`
* field would make the constructor types nominally incompatible across the bundled
* copies) and (for hierarchy roots) installing {@linkcode brandedHasInstance} as
* `Symbol.hasInstance`. User-defined subclasses that do not declare their own brand
* keep plain prototype semantics — a foreign base-class instance never satisfies
* `instanceof UserSubclass`.
*
* Prior art — the same stamp-and-hook shape ships at scale elsewhere: Node core
* (stream.Writable since 2017, Console via a marker symbol, diagnostics_channel),
* undici's whole error hierarchy (vendored into Node as fetch), googleapis/gaxios
* (GaxiosError, Symbol.for marker), AWS SDK v3's ServiceException (which pairs a
* Symbol.hasInstance override with a static isInstance guard, as we do), and zod v4
* (Symbol.hasInstance on every schema class for cross-version interop).
*
* Contract notes:
* - Participation criterion: **every error class exported from a public package that
*   callers are documented to `instanceof` must be branded.** The per-package
*   errorBrandConformance tests walk the export surfaces and fail naming any
*   exported Error subclass that has not opted in.
* - Brands assert **identity, not shape**: brand strings are version-less, so an
*   instance from one SDK version matches the class of another. Members added to a
*   branded class in a later version may be absent on a matched instance — read
*   fields defensively, and treat branded classes as additive-only. The escape
*   hatch when a release must break a branded class's read contract: change that
*   class's brand string in the same release, which cleanly severs cross-version
*   matching for that class. The per-package brand pins make the rename
*   deliberate: errorSurfacePins.test.ts owns the core-internal brands, and each
*   package's errorBrandConformance test pins its package-local ones.
* - Cross-bundle matching requires **both** copies to be at or after the release
*   that introduced branding; against an older copy, behavior degrades to plain
*   prototype `instanceof` in both directions.
* - A consumer re-bundling the SDK with property mangling (`mangle.props`) would
*   break the brand statics; default esbuild/webpack/terser settings do not.
*/
/** Registry symbol — identical across bundled copies and realms. */
const BRANDS = Symbol.for("mcp.sdk.errorBrands");
/**
* Stamp `instance` with the brand of every class in `ctor`'s chain that declares an
* own `mcpBrand`. Call once from the hierarchy root's constructor with `new.target` —
* subclasses inherit the stamping without touching their constructors.
*
* Constructor-time only: never stamp arbitrary objects. A stamped non-instance would
* satisfy `instanceof` while lacking the prototype members (getters like `.status`)
* that callers reach for after the check.
*/
function stampErrorBrands(instance, ctor) {
	const brands = /* @__PURE__ */ new Set();
	let current = ctor;
	while (typeof current === "function") {
		const brand = current.mcpBrand;
		if (Object.prototype.hasOwnProperty.call(current, "mcpBrand") && typeof brand === "string") brands.add(brand);
		current = Object.getPrototypeOf(current);
	}
	if (brands.size === 0) return;
	Object.defineProperty(instance, BRANDS, {
		value: brands,
		enumerable: false,
		configurable: true
	});
}
/**
* `Symbol.hasInstance` implementation for branded hierarchy roots. Matches when the
* value carries the **own** brand of the class being tested against (cross-bundle
* path), falling back to ordinary prototype-based `instanceof` otherwise.
*/
function brandedHasInstance(cls, value) {
	try {
		if (typeof value === "object" && value !== null && Object.prototype.hasOwnProperty.call(cls, "mcpBrand") && typeof cls.mcpBrand === "string" && Object.prototype.hasOwnProperty.call(value, BRANDS)) {
			const carried = value[BRANDS];
			if (carried && typeof carried.has === "function" && carried.has(cls.mcpBrand)) return true;
		}
	} catch {}
	return Function.prototype[Symbol.hasInstance].call(cls, value);
}

//#endregion
//#region ../core-internal/src/auth/errors.ts
/**
* OAuth error codes as defined by {@link https://datatracker.ietf.org/doc/html/rfc6749#section-5.2 | RFC 6749}
* and extensions.
*/
let OAuthErrorCode = /* @__PURE__ */ function(OAuthErrorCode$1) {
	/**
	* The request is missing a required parameter, includes an invalid parameter value,
	* includes a parameter more than once, or is otherwise malformed.
	*/
	OAuthErrorCode$1["InvalidRequest"] = "invalid_request";
	/**
	* Client authentication failed (e.g., unknown client, no client authentication included,
	* or unsupported authentication method).
	*/
	OAuthErrorCode$1["InvalidClient"] = "invalid_client";
	/**
	* The provided authorization grant or refresh token is invalid, expired, revoked,
	* does not match the redirection URI used in the authorization request, or was issued to another client.
	*/
	OAuthErrorCode$1["InvalidGrant"] = "invalid_grant";
	/**
	* The authenticated client is not authorized to use this authorization grant type.
	*/
	OAuthErrorCode$1["UnauthorizedClient"] = "unauthorized_client";
	/**
	* The authorization grant type is not supported by the authorization server.
	*/
	OAuthErrorCode$1["UnsupportedGrantType"] = "unsupported_grant_type";
	/**
	* The requested scope is invalid, unknown, malformed, or exceeds the scope granted by the resource owner.
	*/
	OAuthErrorCode$1["InvalidScope"] = "invalid_scope";
	/**
	* The resource owner or authorization server denied the request.
	*/
	OAuthErrorCode$1["AccessDenied"] = "access_denied";
	/**
	* The authorization server encountered an unexpected condition that prevented it from fulfilling the request.
	*/
	OAuthErrorCode$1["ServerError"] = "server_error";
	/**
	* The authorization server is currently unable to handle the request due to temporary overloading or maintenance.
	*/
	OAuthErrorCode$1["TemporarilyUnavailable"] = "temporarily_unavailable";
	/**
	* The authorization server does not support obtaining an authorization code using this method.
	*/
	OAuthErrorCode$1["UnsupportedResponseType"] = "unsupported_response_type";
	/**
	* The authorization server does not support the requested token type.
	*/
	OAuthErrorCode$1["UnsupportedTokenType"] = "unsupported_token_type";
	/**
	* The access token provided is expired, revoked, malformed, or invalid for other reasons.
	*/
	OAuthErrorCode$1["InvalidToken"] = "invalid_token";
	/**
	* The HTTP method used is not allowed for this endpoint. (Custom, non-standard error)
	*/
	OAuthErrorCode$1["MethodNotAllowed"] = "method_not_allowed";
	/**
	* Rate limit exceeded. (Custom, non-standard error based on RFC 6585)
	*/
	OAuthErrorCode$1["TooManyRequests"] = "too_many_requests";
	/**
	* The client metadata is invalid. (Custom error for dynamic client registration - RFC 7591)
	*/
	OAuthErrorCode$1["InvalidClientMetadata"] = "invalid_client_metadata";
	/**
	* The value of one or more redirection URIs is invalid. (Dynamic client registration - RFC 7591 §3.2.2)
	*/
	OAuthErrorCode$1["InvalidRedirectUri"] = "invalid_redirect_uri";
	/**
	* The request requires higher privileges than provided by the access token.
	*/
	OAuthErrorCode$1["InsufficientScope"] = "insufficient_scope";
	/**
	* The requested resource is invalid, missing, unknown, or malformed. (Custom error for resource indicators - RFC 8707)
	*/
	OAuthErrorCode$1["InvalidTarget"] = "invalid_target";
	/**
	* The DPoP proof accompanying the request is invalid, or does not match the key the grant
	* (e.g. a refresh token) is bound to. (RFC 9449 §5 / §7.1)
	*/
	OAuthErrorCode$1["InvalidDpopProof"] = "invalid_dpop_proof";
	/**
	* The server requires a server-supplied nonce in the DPoP proof; retry with the `DPoP-Nonce`
	* it returned. (RFC 9449 §8 / §9)
	*/
	OAuthErrorCode$1["UseDpopNonce"] = "use_dpop_nonce";
	return OAuthErrorCode$1;
}({});
/**
* OAuth error class for all OAuth-related errors.
*/
var OAuthError = class OAuthError extends Error {
	static {
		Object.defineProperty(this, "mcpBrand", { value: "mcp.OAuthError" });
	}
	static [Symbol.hasInstance](value) {
		return brandedHasInstance(this, value);
	}
	/**
	* Brand-based type guard: equivalent to `value instanceof this`, as an
	* explicit static predicate (the axios/AWS-SDK `isInstance` style). Reads
	* the caller's own brand via `this`, so every branded subclass gets a
	* correctly-scoped guard by inheritance. Must be invoked on the class —
	* in callback position write `v => SdkError.isInstance(v)`, not
	* `.filter(SdkError.isInstance)` (detached calls throw rather than
	* silently matching nothing).
	*/
	static isInstance(value) {
		if (typeof this !== "function") throw new TypeError("isInstance must be called on the class (e.g. `SdkError.isInstance(value)`); for callbacks use `v => SdkError.isInstance(v)`");
		return brandedHasInstance(this, value);
	}
	constructor(code, message, errorUri) {
		super(message);
		this.code = code;
		this.errorUri = errorUri;
		this.name = "OAuthError";
		stampErrorBrands(this, new.target);
	}
	/**
	* Converts the error to a standard OAuth error response object.
	*/
	toResponseObject() {
		const response = {
			error: this.code,
			error_description: this.message
		};
		if (this.errorUri) response.error_uri = this.errorUri;
		return response;
	}
	/**
	* Creates an {@linkcode OAuthError} from an OAuth error response.
	*/
	static fromResponse(response) {
		return new OAuthError(response.error, response.error_description ?? response.error, response.error_uri);
	}
};

//#endregion
//#region ../core-internal/src/errors/sdkErrors.ts
/**
* Error codes for SDK errors (local errors that never cross the wire).
* Unlike {@linkcode ProtocolErrorCode} which uses numeric JSON-RPC codes, `SdkErrorCode` uses
* descriptive string values for better developer experience.
*
* These errors are thrown locally by the SDK and are never serialized as
* JSON-RPC error responses.
*/
let SdkErrorCode = /* @__PURE__ */ function(SdkErrorCode$1) {
	/** Transport is not connected */
	SdkErrorCode$1["NotConnected"] = "NOT_CONNECTED";
	/** Transport is already connected */
	SdkErrorCode$1["AlreadyConnected"] = "ALREADY_CONNECTED";
	/** Protocol is not initialized */
	SdkErrorCode$1["NotInitialized"] = "NOT_INITIALIZED";
	/** Required capability is not supported by the remote side */
	SdkErrorCode$1["CapabilityNotSupported"] = "CAPABILITY_NOT_SUPPORTED";
	/** Request timed out waiting for response */
	SdkErrorCode$1["RequestTimeout"] = "REQUEST_TIMEOUT";
	/** Connection was closed */
	SdkErrorCode$1["ConnectionClosed"] = "CONNECTION_CLOSED";
	/** Failed to send message */
	SdkErrorCode$1["SendFailed"] = "SEND_FAILED";
	/** Response result failed local schema validation */
	SdkErrorCode$1["InvalidResult"] = "INVALID_RESULT";
	/**
	* The response carried a `resultType` discriminator (protocol revision
	* 2026-07-28) naming a result kind this client cannot consume yet, e.g.
	* `input_required`. The kind is carried in `data.resultType`.
	*/
	SdkErrorCode$1["UnsupportedResultType"] = "UNSUPPORTED_RESULT_TYPE";
	/**
	* The multi-round-trip auto-fulfilment driver exhausted its round cap
	* (`inputRequired.maxRounds`) without the server returning a complete
	* result. `data.rounds` carries the cap that was hit and
	* `data.lastResult` carries the last `input_required` payload received
	* (`{ inputRequests, requestState? }`), so callers can inspect or resume
	* the flow manually.
	*/
	SdkErrorCode$1["InputRequiredRoundsExceeded"] = "INPUT_REQUIRED_ROUNDS_EXCEEDED";
	/**
	* The auto-aggregating no-`cursor` `listTools()` / `listPrompts()` /
	* `listResources()` / `listResourceTemplates()` walk hit the
	* `ClientOptions.listMaxPages` cap without the server's pagination
	* converging. `data.method` carries the list verb and
	* `data.listMaxPages` the cap that was hit; raise the cap or fall back to
	* explicit per-page `{ cursor }` calls.
	*/
	SdkErrorCode$1["ListPaginationExceeded"] = "LIST_PAGINATION_EXCEEDED";
	/**
	* The spec method being sent does not exist on the negotiated protocol
	* version's wire era (e.g. `tasks/get` toward a 2026-07-28 peer, or
	* `server/discover` toward a 2025-era peer). Raised locally, before
	* anything reaches the transport. The method and era are carried in
	* `data.method` / `data.era`.
	*/
	SdkErrorCode$1["MethodNotSupportedByProtocolVersion"] = "METHOD_NOT_SUPPORTED_BY_PROTOCOL_VERSION";
	/**
	* Protocol-era negotiation at connect time failed without producing either a
	* usable modern (2026-07-28+) era or a definitive legacy fallback signal —
	* e.g. the negotiation mode forbids falling back (`pin`), the probe hit a
	* network failure, or the server answered the probe with a 5xx (a typed
	* connect error, never an era verdict).
	*
	* Negotiation-phase only: this code is never used once an era is
	* established. Auth walls never carry it: a 401/403 rejecting the probe
	* uses {@linkcode ClientHttpAuthentication} / {@linkcode ClientHttpForbidden}
	* instead, so era-recovery flows keyed on this code (e.g. cached-verdict
	* gateways) can never persist a verdict for an unauthorized exchange.
	*/
	SdkErrorCode$1["EraNegotiationFailed"] = "ERA_NEGOTIATION_FAILED";
	SdkErrorCode$1["ClientHttpNotImplemented"] = "CLIENT_HTTP_NOT_IMPLEMENTED";
	/**
	* HTTP 401 authentication failure: the transport's re-auth retry still got
	* 401 (`Server returned 401 after re-authentication`), or the version
	* negotiation probe was rejected 401 with no `authProvider` configured
	* (`Version negotiation failed: the server requires authorization (HTTP 401)`).
	* Carried on an {@linkcode SdkHttpError} with `status: 401`.
	*/
	SdkErrorCode$1["ClientHttpAuthentication"] = "CLIENT_HTTP_AUTHENTICATION";
	/**
	* HTTP 403 denial: the step-up re-authorization retry limit was reached,
	* or the version negotiation probe was rejected 403
	* (`Version negotiation failed: the server denied access (HTTP 403)`).
	* Carried on an {@linkcode SdkHttpError} with `status: 403`.
	*/
	SdkErrorCode$1["ClientHttpForbidden"] = "CLIENT_HTTP_FORBIDDEN";
	SdkErrorCode$1["ClientHttpUnexpectedContent"] = "CLIENT_HTTP_UNEXPECTED_CONTENT";
	SdkErrorCode$1["ClientHttpFailedToOpenStream"] = "CLIENT_HTTP_FAILED_TO_OPEN_STREAM";
	SdkErrorCode$1["ClientHttpFailedToTerminateSession"] = "CLIENT_HTTP_FAILED_TO_TERMINATE_SESSION";
	return SdkErrorCode$1;
}({});
/**
* SDK errors are local errors that never cross the wire.
* They are distinct from {@linkcode ProtocolError} which represents JSON-RPC protocol errors
* that are serialized and sent as error responses.
*
* @example
* ```ts source="./sdkErrors.examples.ts#SdkError_basicUsage"
* try {
*     // Throwing an SDK error
*     throw new SdkError(SdkErrorCode.NotConnected, 'Transport is not connected');
* } catch (error) {
*     // Checking error type by code
*     if (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout) {
*         // Handle timeout
*     }
* }
* ```
*/
var SdkError = class extends Error {
	static {
		Object.defineProperty(this, "mcpBrand", { value: "mcp.SdkError" });
	}
	static [Symbol.hasInstance](value) {
		return brandedHasInstance(this, value);
	}
	/**
	* Brand-based type guard: equivalent to `value instanceof this`, as an
	* explicit static predicate (the axios/AWS-SDK `isInstance` style). Reads
	* the caller's own brand via `this`, so every branded subclass gets a
	* correctly-scoped guard by inheritance. Must be invoked on the class —
	* in callback position write `v => SdkError.isInstance(v)`, not
	* `.filter(SdkError.isInstance)` (detached calls throw rather than
	* silently matching nothing).
	*/
	static isInstance(value) {
		if (typeof this !== "function") throw new TypeError("isInstance must be called on the class (e.g. `SdkError.isInstance(value)`); for callbacks use `v => SdkError.isInstance(v)`");
		return brandedHasInstance(this, value);
	}
	/**
	* @param code - Stable string code identifying the failure ({@linkcode SdkErrorCode}).
	* @param message - Human-readable description.
	* @param data - Optional structured payload (for example the HTTP status carried by
	* {@linkcode SdkHttpError}). Opaque to the SDK: a `cause` key inside `data` is not
	* promoted to `Error.cause`.
	* @param options - Standard `ErrorOptions`, forwarded to `Error`. Pass the underlying
	* failure as `{ cause }` so it is reachable through the `Error.cause` chain that
	* loggers and error trackers walk.
	*/
	constructor(code, message, data, options) {
		super(message, options);
		this.code = code;
		this.data = data;
		this.name = "SdkError";
		stampErrorBrands(this, new.target);
	}
};
/**
* An {@linkcode SdkError} subclass for HTTP transport failures.
*
* Thrown by the streamable HTTP transport when the server responds with a
* non-OK status code. Narrows {@linkcode SdkError.data | data} to
* {@linkcode SdkHttpErrorData} so consumers can inspect the HTTP status
* without unsafe casting.
*
* @example
* ```ts source="./sdkErrors.examples.ts#SdkHttpError_basicUsage"
* if (error instanceof SdkHttpError) {
*     console.log(error.status); // number
*     console.log(error.statusText); // string | undefined
* }
* ```
*/
var SdkHttpError = class extends SdkError {
	static {
		Object.defineProperty(this, "mcpBrand", { value: "mcp.SdkHttpError" });
	}
	/**
	* @param options - Standard `ErrorOptions`, forwarded to `Error` (see {@linkcode SdkError}).
	*/
	constructor(code, message, data, options) {
		super(code, message, data, options);
		this.name = "SdkHttpError";
	}
	get status() {
		return this.data.status;
	}
	get statusText() {
		return this.data.statusText;
	}
};

//#endregion
//#region ../core-internal/src/shared/authUtils.ts
/**
* Utilities for handling OAuth resource URIs.
*/
/**
* Converts a server URL to a resource URL by removing the fragment.
* {@link https://datatracker.ietf.org/doc/html/rfc8707#section-2 | RFC 8707 section 2}
* states that resource URIs "MUST NOT include a fragment component".
* Keeps everything else unchanged (scheme, domain, port, path, query).
*/
function resourceUrlFromServerUrl(url) {
	const resourceURL = typeof url === "string" ? new URL(url) : new URL(url.href);
	resourceURL.hash = "";
	return resourceURL;
}
/**
* Checks if a requested resource URL matches a configured resource URL.
* A requested resource matches if it has the same scheme, domain, port,
* and its path starts with the configured resource's path.
*
* @param options - The options object
* @param options.requestedResource - The resource URL being requested
* @param options.configuredResource - The resource URL that has been configured
* @returns true if the requested resource matches the configured resource, false otherwise
*/
function checkResourceAllowed({ requestedResource, configuredResource }) {
	const requested = typeof requestedResource === "string" ? new URL(requestedResource) : new URL(requestedResource.href);
	const configured = typeof configuredResource === "string" ? new URL(configuredResource) : new URL(configuredResource.href);
	if (requested.origin !== configured.origin) return false;
	if (requested.pathname.length < configured.pathname.length) return false;
	const requestedPath = requested.pathname.endsWith("/") ? requested.pathname : requested.pathname + "/";
	const configuredPath = configured.pathname.endsWith("/") ? configured.pathname : configured.pathname + "/";
	return requestedPath.startsWith(configuredPath);
}

//#endregion
//#region ../core-internal/src/shared/clientCapabilityRequirements.ts
/**
* Inbound request methods whose processing structurally requires a client
* capability, keyed by method, valued by the capabilities required.
*
* Currently empty: none of the request methods served on the 2026-07-28
* registry unconditionally requires a client capability. Entries appear here
* when such methods exist — for example requests whose handling embeds
* elicitation or sampling input requests (the input-request engine), or
* opt-in subscription delivery. Handler-conditional requirements (a specific
* tool that needs sampling) are not expressible as a static method table and
* are enforced at the point the requirement arises instead.
*/
const REQUIRED_CLIENT_CAPABILITIES_BY_METHOD = {};
/**
* The client capabilities a request method structurally requires, or
* `undefined` when the method has no static requirement.
*/
function requiredClientCapabilitiesForRequest(method) {
	return Object.hasOwn(REQUIRED_CLIENT_CAPABILITIES_BY_METHOD, method) ? REQUIRED_CLIENT_CAPABILITIES_BY_METHOD[method] : void 0;
}
function isPlainObject$7(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/**
* Whether a required nested member counts as declared even though it is not
* spelled out: a bare `elicitation: {}` declaration (no mode sub-capability at
* all) is read as form support — the pre-mode (2025) meaning of a bare
* declaration — so an `elicitation.form` requirement treats it as satisfied.
* Declaring any mode explicitly (for example `elicitation: { url: {} }`)
* removes the implication.
*/
function isImpliedCapabilityMember(capability, member, declaredValue) {
	return capability === "elicitation" && member === "form" && declaredValue["form"] === void 0 && declaredValue["url"] === void 0;
}
/**
* The client capabilities an embedded multi-round-trip input request requires
* (call site 2 — the outbound input-request leg): a server MUST NOT send an
* `inputRequests` kind the request's declared client capabilities do not
* cover. Returns `undefined` for entries whose method is not one of the
* embedded input-request kinds (those are a server bug handled separately,
* not a capability question).
*
* The requirement is mode-aware where the capability is: URL-mode elicitation
* requires `elicitation.url`; form-mode (or mode-omitted) elicitation requires
* `elicitation.form` (modes are sub-capabilities, and a server MUST NOT send a
* mode the client did not declare); sampling with `tools`/`toolChoice`
* requires `sampling.tools`. A bare `elicitation: {}` declaration satisfies
* the form requirement — see {@linkcode missingClientCapabilities}.
*/
function requiredClientCapabilitiesForInputRequest(entry) {
	switch (entry.method) {
		case "elicitation/create":
			if (entry.params?.["mode"] === "url") return { elicitation: { url: {} } };
			return { elicitation: { form: {} } };
		case "sampling/createMessage": {
			const params = entry.params;
			if (params !== void 0 && (params["tools"] !== void 0 || params["toolChoice"] !== void 0)) return { sampling: { tools: {} } };
			return { sampling: {} };
		}
		case "roots/list": return { roots: {} };
		default: return;
	}
}
/**
* Computes the subset of `required` client capabilities the client did not
* declare. Returns `undefined` when every required capability is declared;
* otherwise returns an object in the `ClientCapabilities` shape containing
* exactly the missing capabilities (suitable for
* `data.requiredCapabilities` on the `-32021` error).
*
* A capability counts as declared when its top-level key is present on the
* declared capabilities; when the requirement names nested members (for
* example `elicitation: { url: {} }`), each named member must also be present
* under the declared capability. One lenient reading applies: a bare
* `elicitation: {}` declaration (no mode sub-capability at all) counts as
* declaring `elicitation.form` — the pre-mode (2025) meaning of a bare
* declaration. An absent or empty `declared` value means
* nothing is declared — every required capability is missing (the structural
* clean-refusal posture for sessions with no per-request capability view).
*/
function missingClientCapabilities(required, declared) {
	const missing = {};
	for (const [capability, requirement] of Object.entries(required)) {
		if (requirement === void 0) continue;
		const declaredValue = declared === void 0 ? void 0 : declared[capability];
		if (declaredValue === void 0) {
			missing[capability] = requirement;
			continue;
		}
		if (isPlainObject$7(requirement) && isPlainObject$7(declaredValue)) {
			const missingMembers = {};
			for (const [member, memberRequirement] of Object.entries(requirement)) if (memberRequirement !== void 0 && declaredValue[member] === void 0 && !isImpliedCapabilityMember(capability, member, declaredValue)) missingMembers[member] = memberRequirement;
			if (Object.keys(missingMembers).length > 0) missing[capability] = missingMembers;
		}
	}
	return Object.keys(missing).length > 0 ? missing : void 0;
}

//#endregion
//#region ../core-internal/src/shared/protocolEras.ts
/**
* The first protocol revision of the modern (2026-07-28) era. Revision identifiers
* are ISO dates, so lexicographic comparison orders them chronologically.
*/
const FIRST_MODERN_PROTOCOL_VERSION = "2026-07-28";
/**
* Modern-era protocol revisions this SDK can negotiate via `server/discover`.
* Deliberately separate from {@linkcode SUPPORTED_PROTOCOL_VERSIONS} (the legacy
* `initialize` list), so adding a revision here can never leak a modern version
* string into a 2025-era handshake. Internal — not part of the public API surface.
*/
const SUPPORTED_MODERN_PROTOCOL_VERSIONS = [FIRST_MODERN_PROTOCOL_VERSION];
/** Whether the given protocol revision belongs to the modern (2026-07-28+) era. */
function isModernProtocolVersion(version) {
	return version >= FIRST_MODERN_PROTOCOL_VERSION;
}
/** The legacy-era (pre-2026-07-28) subset of a supported-versions list, in the list's own preference order. */
function legacyProtocolVersions(versions) {
	return versions.filter((version) => !isModernProtocolVersion(version));
}
/** The modern-era (2026-07-28+) subset of a supported-versions list, in the list's own preference order. */
function modernProtocolVersions(versions) {
	return versions.filter((version) => isModernProtocolVersion(version));
}

//#endregion
//#region ../core-internal/src/wire/textFallback.ts
/**
* SEP-2106 §4.3 TextContent auto-append, era-agnostic, called from BOTH
* codecs' {@link WireCodec.projectCallToolResult}: when `structuredContent`
* is a non-object value (array/primitive/`null`) and the handler authored no
* `type:'text'` block, append `{type:'text', text: JSON.stringify(value)}`.
* Object-shaped (or absent) `structuredContent` returns the same reference.
*
* Leaf module: imported by both era codec modules, so it must NOT import from
* `./codec.js` (which value-imports the rev codecs at top level — that would
* make a runtime cycle and a TDZ hazard for entries that evaluate a rev codec
* module first).
*/
function appendTextFallbackForNonObject(result) {
	const sc = result.structuredContent;
	if (sc === void 0) return result;
	if (!(typeof sc !== "object" || sc === null || Array.isArray(sc))) return result;
	if (result.content?.some((c) => c.type === "text") ?? false) return result;
	return {
		...result,
		content: [...result.content ?? [], {
			type: "text",
			text: JSON.stringify(sc)
		}]
	};
}

//#endregion
//#region ../core-internal/src/wire/resultFamilies.ts
/**
* Result-family keys that must never default into a `{content: []}` tools/call
* success. Shared by the 2025 wire-seam schema and server normalization.
* Leaf module (like `textFallback.ts`): imported by registry/server paths, so
* it must NOT import from `./codec.js` — that would close a runtime cycle.
*/
const TOOL_RESULT_FOREIGN_FAMILY_KEYS = [
	"task",
	"inputRequests",
	"requestState"
];
/**
* Single owner of the v1-parity ruling: a plain-object tool result without `content` (and
* without foreign-family keys) gains `content: []`. Shared by the 2025 wire seam and server-side handler normalization.
*/
function normalizeContentlessToolResult(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value) || value.content !== void 0 || TOOL_RESULT_FOREIGN_FAMILY_KEYS.some((key) => key in value)) return value;
	return {
		...value,
		content: []
	};
}

//#endregion
//#region ../core-internal/src/wire/rev2025-11-25/buildSchemas.ts
/**
* Complete frozen 2025-11-25 wire schemas. Self-contained — no imports from
* the public/neutral types/schemas.ts. The neutral layer is the public-API
* superset and is free to evolve (e.g., SEP-2106 widening); this file is the
* 2025 wire-parse contract (Q10-L2 byte-identity) and is BEHAVIOR-FROZEN.
*
* This is the era's complete frozen wire-parse contract — both the 2025-only
* delta (the deprecated task family, the era role unions) AND frozen copies of
* every era-shared shape (Tool, CallToolResult, Initialize*, ContentBlock,
* prompts/resources/completion/elicitation, …). The 2026-era codec
* (`wire/rev2026-07-28/`) is symmetrically self-contained in the same way.
*
* The 2025-only delta (the task message surface, restored types-only by #2248
* for interop with task-capable 2025 peers) is parsed ONLY through this era's
* registry; the deprecated Task* schemas also live (marked `@deprecated`) in
* the neutral schema layer so the public types stay nameable without a
* cross-layer import — nameability is constant, runtime availability is
* version-keyed — but appear in no API signature. Q1 increment 2 — deletions
* are physical: the
* 2026-era REGISTRY has no Task* methods (its frozen building-block copies do
* carry the deprecated Task* sub-schemas by composition — soft contamination,
* tracked for anchor-exactness adjudication).
*
* The only cross-layer dependency is `import type { JSONObject, JSONValue }`
* from the neutral types barrel — pure structural type aliases with no parse
* behavior. No runtime schema is shared with the neutral layer.
*/
function build$1() {
	const JSONValueSchema$1 = zod_v4.lazy(() => zod_v4.union([
		zod_v4.string(),
		zod_v4.number(),
		zod_v4.boolean(),
		zod_v4.null(),
		zod_v4.record(zod_v4.string(), JSONValueSchema$1),
		zod_v4.array(JSONValueSchema$1)
	]));
	const JSONObjectSchema$1 = zod_v4.record(zod_v4.string(), JSONValueSchema$1);
	/**
	* A progress token, used to associate progress notifications with the original request.
	*/
	const ProgressTokenSchema$1 = zod_v4.union([zod_v4.string(), zod_v4.number().int()]);
	/**
	* An opaque token used to represent a cursor for pagination.
	*/
	const CursorSchema$1 = zod_v4.string();
	/** @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only. */
	const TaskMetadataSchema$1 = zod_v4.object({ ttl: zod_v4.number().optional() });
	/**
	* Metadata for associating messages with a task.
	* Include this in the `_meta` field under the key `io.modelcontextprotocol/related-task`.
	*
	* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
	*/
	const RelatedTaskMetadataSchema$1 = zod_v4.object({ taskId: zod_v4.string() });
	const RequestMetaSchema$1 = zod_v4.looseObject({
		progressToken: ProgressTokenSchema$1.optional(),
		"io.modelcontextprotocol/related-task": RelatedTaskMetadataSchema$1.optional()
	});
	/**
	* Common params for any request.
	*/
	const BaseRequestParamsSchema$1 = zod_v4.object({ _meta: RequestMetaSchema$1.optional() });
	/**
	* Common params for any task-augmented request.
	*
	* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
	*/
	const TaskAugmentedRequestParamsSchema$1 = BaseRequestParamsSchema$1.extend({ task: TaskMetadataSchema$1.optional() });
	const RequestSchema$1 = zod_v4.object({
		method: zod_v4.string(),
		params: BaseRequestParamsSchema$1.loose().optional()
	});
	const NotificationsParamsSchema$1 = zod_v4.object({ _meta: RequestMetaSchema$1.optional() });
	const NotificationSchema$1 = zod_v4.object({
		method: zod_v4.string(),
		params: NotificationsParamsSchema$1.loose().optional()
	});
	const ResultSchema$1 = zod_v4.looseObject({ _meta: RequestMetaSchema$1.optional() });
	/**
	* A uniquely identifying ID for a request in JSON-RPC.
	*/
	const RequestIdSchema$1 = zod_v4.union([zod_v4.string(), zod_v4.number().int()]);
	/**
	* A response that indicates success but carries no data.
	*/
	const EmptyResultSchema$1 = ResultSchema$1.strict();
	const CancelledNotificationParamsSchema$1 = NotificationsParamsSchema$1.extend({
		requestId: RequestIdSchema$1.optional(),
		reason: zod_v4.string().optional()
	});
	/**
	* This notification can be sent by either side to indicate that it is cancelling a previously-issued request.
	*
	* The request SHOULD still be in-flight, but due to communication latency, it is always possible that this notification MAY arrive after the request has already finished.
	*
	* This notification indicates that the result will be unused, so any associated processing SHOULD cease.
	*
	* A client MUST NOT attempt to cancel its {@linkcode InitializeRequest | initialize} request.
	*/
	const CancelledNotificationSchema$1 = NotificationSchema$1.extend({
		method: zod_v4.literal("notifications/cancelled"),
		params: CancelledNotificationParamsSchema$1
	});
	/**
	* Icon schema for use in {@link Tool | tools}, {@link Prompt | prompts}, {@link Resource | resources}, and {@link Implementation | implementations}.
	*/
	const IconSchema$1 = zod_v4.object({
		src: zod_v4.string(),
		mimeType: zod_v4.string().optional(),
		sizes: zod_v4.array(zod_v4.string()).optional(),
		theme: zod_v4.enum(["light", "dark"]).optional()
	});
	/**
	* Base schema to add `icons` property.
	*
	*/
	const IconsSchema$1 = zod_v4.object({ icons: zod_v4.array(IconSchema$1).optional() });
	/**
	* Base metadata interface for common properties across {@link Resource | resources}, {@link Tool | tools}, {@link Prompt | prompts}, and {@link Implementation | implementations}.
	*/
	const BaseMetadataSchema$1 = zod_v4.object({
		name: zod_v4.string(),
		title: zod_v4.string().optional()
	});
	/**
	* Describes the name and version of an MCP implementation.
	*/
	const ImplementationSchema$1 = BaseMetadataSchema$1.extend({
		...BaseMetadataSchema$1.shape,
		...IconsSchema$1.shape,
		version: zod_v4.string(),
		websiteUrl: zod_v4.string().optional(),
		description: zod_v4.string().optional()
	});
	const FormElicitationCapabilitySchema = zod_v4.intersection(zod_v4.object({ applyDefaults: zod_v4.boolean().optional() }), JSONObjectSchema$1);
	const ElicitationCapabilitySchema = zod_v4.preprocess((value) => {
		if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return { form: {} };
		return value;
	}, zod_v4.intersection(zod_v4.object({
		form: FormElicitationCapabilitySchema.optional(),
		url: JSONObjectSchema$1.optional()
	}), JSONObjectSchema$1.optional()));
	/**
	* Task capabilities for clients, indicating which request types support task creation.
	*
	* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
	*/
	const ClientTasksCapabilitySchema$1 = zod_v4.looseObject({
		list: JSONObjectSchema$1.optional(),
		cancel: JSONObjectSchema$1.optional(),
		requests: zod_v4.looseObject({
			sampling: zod_v4.looseObject({ createMessage: JSONObjectSchema$1.optional() }).optional(),
			elicitation: zod_v4.looseObject({ create: JSONObjectSchema$1.optional() }).optional()
		}).optional()
	});
	/**
	* Task capabilities for servers, indicating which request types support task creation.
	*
	* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
	*/
	const ServerTasksCapabilitySchema$1 = zod_v4.looseObject({
		list: JSONObjectSchema$1.optional(),
		cancel: JSONObjectSchema$1.optional(),
		requests: zod_v4.looseObject({ tools: zod_v4.looseObject({ call: JSONObjectSchema$1.optional() }).optional() }).optional()
	});
	/**
	* Capabilities a client may support. Known capabilities are defined here, in this schema, but this is not a closed set: any client can define its own, additional capabilities.
	*/
	const ClientCapabilitiesSchema$1 = zod_v4.object({
		experimental: zod_v4.record(zod_v4.string(), JSONObjectSchema$1).optional(),
		sampling: zod_v4.object({
			context: JSONObjectSchema$1.optional(),
			tools: JSONObjectSchema$1.optional()
		}).optional(),
		elicitation: ElicitationCapabilitySchema.optional(),
		roots: zod_v4.object({ listChanged: zod_v4.boolean().optional() }).optional(),
		tasks: ClientTasksCapabilitySchema$1.optional(),
		extensions: zod_v4.record(zod_v4.string(), JSONObjectSchema$1).optional()
	});
	const InitializeRequestParamsSchema$1 = BaseRequestParamsSchema$1.extend({
		protocolVersion: zod_v4.string(),
		capabilities: ClientCapabilitiesSchema$1,
		clientInfo: ImplementationSchema$1
	});
	/**
	* This request is sent from the client to the server when it first connects, asking it to begin initialization.
	*/
	const InitializeRequestSchema$1 = RequestSchema$1.extend({
		method: zod_v4.literal("initialize"),
		params: InitializeRequestParamsSchema$1
	});
	/**
	* Capabilities that a server may support. Known capabilities are defined here, in this schema, but this is not a closed set: any server can define its own, additional capabilities.
	*/
	const ServerCapabilitiesSchema$1 = zod_v4.object({
		experimental: zod_v4.record(zod_v4.string(), JSONObjectSchema$1).optional(),
		logging: JSONObjectSchema$1.optional(),
		completions: JSONObjectSchema$1.optional(),
		prompts: zod_v4.object({ listChanged: zod_v4.boolean().optional() }).optional(),
		resources: zod_v4.object({
			subscribe: zod_v4.boolean().optional(),
			listChanged: zod_v4.boolean().optional()
		}).optional(),
		tools: zod_v4.object({ listChanged: zod_v4.boolean().optional() }).optional(),
		tasks: ServerTasksCapabilitySchema$1.optional(),
		extensions: zod_v4.record(zod_v4.string(), JSONObjectSchema$1).optional()
	});
	/**
	* After receiving an initialize request from the client, the server sends this response.
	*/
	const InitializeResultSchema$1 = ResultSchema$1.extend({
		protocolVersion: zod_v4.string(),
		capabilities: ServerCapabilitiesSchema$1,
		serverInfo: ImplementationSchema$1,
		instructions: zod_v4.string().optional()
	});
	/**
	* This notification is sent from the client to the server after initialization has finished.
	*/
	const InitializedNotificationSchema$1 = NotificationSchema$1.extend({
		method: zod_v4.literal("notifications/initialized"),
		params: NotificationsParamsSchema$1.optional()
	});
	/**
	* A ping, issued by either the server or the client, to check that the other party is still alive. The receiver must promptly respond, or else may be disconnected.
	*/
	const PingRequestSchema$1 = RequestSchema$1.extend({
		method: zod_v4.literal("ping"),
		params: BaseRequestParamsSchema$1.optional()
	});
	const ProgressSchema$1 = zod_v4.object({
		progress: zod_v4.number(),
		total: zod_v4.optional(zod_v4.number()),
		message: zod_v4.optional(zod_v4.string())
	});
	const ProgressNotificationParamsSchema$1 = zod_v4.object({
		...NotificationsParamsSchema$1.shape,
		...ProgressSchema$1.shape,
		progressToken: ProgressTokenSchema$1
	});
	/**
	* An out-of-band notification used to inform the receiver of a progress update for a long-running request.
	*
	* @category notifications/progress
	*/
	const ProgressNotificationSchema$1 = NotificationSchema$1.extend({
		method: zod_v4.literal("notifications/progress"),
		params: ProgressNotificationParamsSchema$1
	});
	const PaginatedRequestParamsSchema$1 = BaseRequestParamsSchema$1.extend({ cursor: CursorSchema$1.optional() });
	const PaginatedRequestSchema$1 = RequestSchema$1.extend({ params: PaginatedRequestParamsSchema$1.optional() });
	const PaginatedResultSchema$1 = ResultSchema$1.extend({ nextCursor: CursorSchema$1.optional() });
	/**
	* The contents of a specific resource or sub-resource.
	*/
	const ResourceContentsSchema$1 = zod_v4.object({
		uri: zod_v4.string(),
		mimeType: zod_v4.optional(zod_v4.string()),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	const TextResourceContentsSchema$1 = ResourceContentsSchema$1.extend({ text: zod_v4.string() });
	/**
	* A Zod schema for validating Base64 strings that is more performant and
	* robust for very large inputs than the default regex-based check. It avoids
	* stack overflows by using the native `atob` function for validation.
	*/
	const Base64Schema = zod_v4.string().refine((val) => {
		try {
			atob(val);
			return true;
		} catch {
			return false;
		}
	}, { message: "Invalid Base64 string" });
	const BlobResourceContentsSchema$1 = ResourceContentsSchema$1.extend({ blob: Base64Schema });
	/**
	* The sender or recipient of messages and data in a conversation.
	*/
	const RoleSchema$1 = zod_v4.enum(["user", "assistant"]);
	/**
	* Optional annotations providing clients additional context about a resource.
	*/
	const AnnotationsSchema$1 = zod_v4.object({
		audience: zod_v4.array(RoleSchema$1).optional(),
		priority: zod_v4.number().min(0).max(1).optional(),
		lastModified: zod_v4.iso.datetime({ offset: true }).optional()
	});
	/**
	* A known resource that the server is capable of reading.
	*/
	const ResourceSchema$1 = zod_v4.object({
		...BaseMetadataSchema$1.shape,
		...IconsSchema$1.shape,
		uri: zod_v4.string(),
		description: zod_v4.optional(zod_v4.string()),
		mimeType: zod_v4.optional(zod_v4.string()),
		size: zod_v4.optional(zod_v4.number()),
		annotations: AnnotationsSchema$1.optional(),
		_meta: zod_v4.optional(zod_v4.looseObject({}))
	});
	/**
	* A template description for resources available on the server.
	*/
	const ResourceTemplateSchema$1 = zod_v4.object({
		...BaseMetadataSchema$1.shape,
		...IconsSchema$1.shape,
		uriTemplate: zod_v4.string(),
		description: zod_v4.optional(zod_v4.string()),
		mimeType: zod_v4.optional(zod_v4.string()),
		annotations: AnnotationsSchema$1.optional(),
		_meta: zod_v4.optional(zod_v4.looseObject({}))
	});
	/**
	* Sent from the client to request a list of resources the server has.
	*/
	const ListResourcesRequestSchema$1 = PaginatedRequestSchema$1.extend({ method: zod_v4.literal("resources/list") });
	/**
	* The server's response to a {@linkcode ListResourcesRequest | resources/list} request from the client.
	*/
	const ListResourcesResultSchema$1 = PaginatedResultSchema$1.extend({ resources: zod_v4.array(ResourceSchema$1) });
	/**
	* Sent from the client to request a list of resource templates the server has.
	*/
	const ListResourceTemplatesRequestSchema$1 = PaginatedRequestSchema$1.extend({ method: zod_v4.literal("resources/templates/list") });
	/**
	* The server's response to a {@linkcode ListResourceTemplatesRequest | resources/templates/list} request from the client.
	*/
	const ListResourceTemplatesResultSchema$1 = PaginatedResultSchema$1.extend({ resourceTemplates: zod_v4.array(ResourceTemplateSchema$1) });
	const ResourceRequestParamsSchema$1 = BaseRequestParamsSchema$1.extend({ uri: zod_v4.string() });
	/**
	* Parameters for a {@linkcode ReadResourceRequest | resources/read} request.
	*/
	const ReadResourceRequestParamsSchema$1 = ResourceRequestParamsSchema$1;
	/**
	* Sent from the client to the server, to read a specific resource URI.
	*/
	const ReadResourceRequestSchema$1 = RequestSchema$1.extend({
		method: zod_v4.literal("resources/read"),
		params: ReadResourceRequestParamsSchema$1
	});
	/**
	* The server's response to a {@linkcode ReadResourceRequest | resources/read} request from the client.
	*/
	const ReadResourceResultSchema$1 = ResultSchema$1.extend({ contents: zod_v4.array(zod_v4.union([TextResourceContentsSchema$1, BlobResourceContentsSchema$1])) });
	/**
	* An optional notification from the server to the client, informing it that the list of resources it can read from has changed. This may be issued by servers without any previous subscription from the client.
	*/
	const ResourceListChangedNotificationSchema$1 = NotificationSchema$1.extend({
		method: zod_v4.literal("notifications/resources/list_changed"),
		params: NotificationsParamsSchema$1.optional()
	});
	const SubscribeRequestParamsSchema$1 = ResourceRequestParamsSchema$1;
	/**
	* Sent from the client to request `resources/updated` notifications from the server whenever a particular resource changes.
	*/
	const SubscribeRequestSchema$1 = RequestSchema$1.extend({
		method: zod_v4.literal("resources/subscribe"),
		params: SubscribeRequestParamsSchema$1
	});
	const UnsubscribeRequestParamsSchema$1 = ResourceRequestParamsSchema$1;
	/**
	* Sent from the client to request cancellation of {@linkcode ResourceUpdatedNotification | resources/updated} notifications from the server. This should follow a previous {@linkcode SubscribeRequest | resources/subscribe} request.
	*/
	const UnsubscribeRequestSchema$1 = RequestSchema$1.extend({
		method: zod_v4.literal("resources/unsubscribe"),
		params: UnsubscribeRequestParamsSchema$1
	});
	/**
	* Parameters for a {@linkcode ResourceUpdatedNotification | notifications/resources/updated} notification.
	*/
	const ResourceUpdatedNotificationParamsSchema$1 = NotificationsParamsSchema$1.extend({ uri: zod_v4.string() });
	/**
	* A notification from the server to the client, informing it that a resource has changed and may need to be read again. This should only be sent if the client previously sent a {@linkcode SubscribeRequest | resources/subscribe} request.
	*/
	const ResourceUpdatedNotificationSchema$1 = NotificationSchema$1.extend({
		method: zod_v4.literal("notifications/resources/updated"),
		params: ResourceUpdatedNotificationParamsSchema$1
	});
	/**
	* Describes an argument that a prompt can accept.
	*/
	const PromptArgumentSchema$1 = zod_v4.object({
		name: zod_v4.string(),
		description: zod_v4.optional(zod_v4.string()),
		required: zod_v4.optional(zod_v4.boolean())
	});
	/**
	* A prompt or prompt template that the server offers.
	*/
	const PromptSchema$1 = zod_v4.object({
		...BaseMetadataSchema$1.shape,
		...IconsSchema$1.shape,
		description: zod_v4.optional(zod_v4.string()),
		arguments: zod_v4.optional(zod_v4.array(PromptArgumentSchema$1)),
		_meta: zod_v4.optional(zod_v4.looseObject({}))
	});
	/**
	* Sent from the client to request a list of prompts and prompt templates the server has.
	*/
	const ListPromptsRequestSchema$1 = PaginatedRequestSchema$1.extend({ method: zod_v4.literal("prompts/list") });
	/**
	* The server's response to a {@linkcode ListPromptsRequest | prompts/list} request from the client.
	*/
	const ListPromptsResultSchema$1 = PaginatedResultSchema$1.extend({ prompts: zod_v4.array(PromptSchema$1) });
	/**
	* Parameters for a {@linkcode GetPromptRequest | prompts/get} request.
	*/
	const GetPromptRequestParamsSchema$1 = BaseRequestParamsSchema$1.extend({
		name: zod_v4.string(),
		arguments: zod_v4.record(zod_v4.string(), zod_v4.string()).optional()
	});
	/**
	* Used by the client to get a prompt provided by the server.
	*/
	const GetPromptRequestSchema$1 = RequestSchema$1.extend({
		method: zod_v4.literal("prompts/get"),
		params: GetPromptRequestParamsSchema$1
	});
	/**
	* Text provided to or from an LLM.
	*/
	const TextContentSchema$1 = zod_v4.object({
		type: zod_v4.literal("text"),
		text: zod_v4.string(),
		annotations: AnnotationsSchema$1.optional(),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	/**
	* An image provided to or from an LLM.
	*/
	const ImageContentSchema$1 = zod_v4.object({
		type: zod_v4.literal("image"),
		data: Base64Schema,
		mimeType: zod_v4.string(),
		annotations: AnnotationsSchema$1.optional(),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	/**
	* Audio content provided to or from an LLM.
	*/
	const AudioContentSchema$1 = zod_v4.object({
		type: zod_v4.literal("audio"),
		data: Base64Schema,
		mimeType: zod_v4.string(),
		annotations: AnnotationsSchema$1.optional(),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	/**
	* A tool call request from an assistant (LLM).
	* Represents the assistant's request to use a tool.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to calling LLM
	* provider APIs directly.
	*/
	const ToolUseContentSchema$1 = zod_v4.object({
		type: zod_v4.literal("tool_use"),
		name: zod_v4.string(),
		id: zod_v4.string(),
		input: zod_v4.record(zod_v4.string(), zod_v4.unknown()),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	/**
	* The contents of a resource, embedded into a prompt or tool call result.
	*/
	const EmbeddedResourceSchema$1 = zod_v4.object({
		type: zod_v4.literal("resource"),
		resource: zod_v4.union([TextResourceContentsSchema$1, BlobResourceContentsSchema$1]),
		annotations: AnnotationsSchema$1.optional(),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	/**
	* A resource that the server is capable of reading, included in a prompt or tool call result.
	*
	* Note: resource links returned by tools are not guaranteed to appear in the results of {@linkcode ListResourcesRequest | resources/list} requests.
	*/
	const ResourceLinkSchema$1 = ResourceSchema$1.extend({ type: zod_v4.literal("resource_link") });
	/**
	* A content block that can be used in prompts and tool results.
	*/
	const ContentBlockSchema$1 = zod_v4.union([
		TextContentSchema$1,
		ImageContentSchema$1,
		AudioContentSchema$1,
		ResourceLinkSchema$1,
		EmbeddedResourceSchema$1
	]);
	/**
	* Describes a message returned as part of a prompt.
	*/
	const PromptMessageSchema$1 = zod_v4.object({
		role: RoleSchema$1,
		content: ContentBlockSchema$1
	});
	/**
	* The server's response to a {@linkcode GetPromptRequest | prompts/get} request from the client.
	*/
	const GetPromptResultSchema$1 = ResultSchema$1.extend({
		description: zod_v4.string().optional(),
		messages: zod_v4.array(PromptMessageSchema$1)
	});
	/**
	* An optional notification from the server to the client, informing it that the list of prompts it offers has changed. This may be issued by servers without any previous subscription from the client.
	*/
	const PromptListChangedNotificationSchema$1 = NotificationSchema$1.extend({
		method: zod_v4.literal("notifications/prompts/list_changed"),
		params: NotificationsParamsSchema$1.optional()
	});
	/**
	* Additional properties describing a `Tool` to clients.
	*
	* NOTE: all properties in {@linkcode ToolAnnotations} are **hints**.
	* They are not guaranteed to provide a faithful description of
	* tool behavior (including descriptive properties like `title`).
	*
	* Clients should never make tool use decisions based on `ToolAnnotations`
	* received from untrusted servers.
	*/
	const ToolAnnotationsSchema$1 = zod_v4.object({
		title: zod_v4.string().optional(),
		readOnlyHint: zod_v4.boolean().optional(),
		destructiveHint: zod_v4.boolean().optional(),
		idempotentHint: zod_v4.boolean().optional(),
		openWorldHint: zod_v4.boolean().optional()
	});
	/**
	* Execution-related properties for a tool.
	*/
	const ToolExecutionSchema$1 = zod_v4.object({ taskSupport: zod_v4.enum([
		"required",
		"optional",
		"forbidden"
	]).optional() });
	/**
	* Definition for a tool the client can call.
	*/
	const ToolSchema$1 = zod_v4.object({
		...BaseMetadataSchema$1.shape,
		...IconsSchema$1.shape,
		description: zod_v4.string().optional(),
		inputSchema: zod_v4.object({
			type: zod_v4.literal("object"),
			properties: zod_v4.record(zod_v4.string(), JSONValueSchema$1).optional(),
			required: zod_v4.array(zod_v4.string()).optional()
		}).catchall(zod_v4.unknown()),
		outputSchema: zod_v4.object({
			type: zod_v4.literal("object"),
			properties: zod_v4.record(zod_v4.string(), JSONValueSchema$1).optional(),
			required: zod_v4.array(zod_v4.string()).optional()
		}).catchall(zod_v4.unknown()).optional(),
		annotations: ToolAnnotationsSchema$1.optional(),
		execution: ToolExecutionSchema$1.optional(),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	/**
	* Sent from the client to request a list of tools the server has.
	*/
	const ListToolsRequestSchema$1 = PaginatedRequestSchema$1.extend({ method: zod_v4.literal("tools/list") });
	/**
	* The server's response to a {@linkcode ListToolsRequest | tools/list} request from the client.
	*/
	const ListToolsResultSchema$1 = PaginatedResultSchema$1.extend({ tools: zod_v4.array(ToolSchema$1) });
	/**
	* The server's response to a tool call.
	*/
	const CallToolResultSchema$1 = ResultSchema$1.extend({
		content: zod_v4.array(ContentBlockSchema$1),
		structuredContent: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional(),
		isError: zod_v4.boolean().optional()
	});
	/**
	* Parameters for a `tools/call` request.
	*/
	const CallToolRequestParamsSchema$1 = TaskAugmentedRequestParamsSchema$1.extend({
		name: zod_v4.string(),
		arguments: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	/**
	* Used by the client to invoke a tool provided by the server.
	*/
	const CallToolRequestSchema$1 = RequestSchema$1.extend({
		method: zod_v4.literal("tools/call"),
		params: CallToolRequestParamsSchema$1
	});
	/**
	* An optional notification from the server to the client, informing it that the list of tools it offers has changed. This may be issued by servers without any previous subscription from the client.
	*/
	const ToolListChangedNotificationSchema$1 = NotificationSchema$1.extend({
		method: zod_v4.literal("notifications/tools/list_changed"),
		params: NotificationsParamsSchema$1.optional()
	});
	/**
	* The severity of a log message.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to stderr logging
	* (STDIO servers) or OpenTelemetry.
	*/
	const LoggingLevelSchema$1 = zod_v4.enum([
		"debug",
		"info",
		"notice",
		"warning",
		"error",
		"critical",
		"alert",
		"emergency"
	]);
	/**
	* Parameters for a `logging/setLevel` request.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to stderr logging
	* (STDIO servers) or OpenTelemetry.
	*/
	const SetLevelRequestParamsSchema$1 = BaseRequestParamsSchema$1.extend({ level: LoggingLevelSchema$1 });
	/**
	* A request from the client to the server, to enable or adjust logging.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to stderr logging
	* (STDIO servers) or OpenTelemetry.
	*/
	const SetLevelRequestSchema$1 = RequestSchema$1.extend({
		method: zod_v4.literal("logging/setLevel"),
		params: SetLevelRequestParamsSchema$1
	});
	/**
	* Parameters for a `notifications/message` notification.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to stderr logging
	* (STDIO servers) or OpenTelemetry.
	*/
	const LoggingMessageNotificationParamsSchema$1 = NotificationsParamsSchema$1.extend({
		level: LoggingLevelSchema$1,
		logger: zod_v4.string().optional(),
		data: zod_v4.unknown()
	});
	/**
	* Notification of a log message passed from server to client. If no `logging/setLevel` request has been sent from the client, the server MAY decide which messages to send automatically.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to stderr logging
	* (STDIO servers) or OpenTelemetry.
	*/
	const LoggingMessageNotificationSchema$1 = NotificationSchema$1.extend({
		method: zod_v4.literal("notifications/message"),
		params: LoggingMessageNotificationParamsSchema$1
	});
	/**
	* Hints to use for model selection.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to calling LLM
	* provider APIs directly.
	*/
	const ModelHintSchema$1 = zod_v4.object({ name: zod_v4.string().optional() });
	/**
	* The server's preferences for model selection, requested of the client during sampling.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to calling LLM
	* provider APIs directly.
	*/
	const ModelPreferencesSchema$1 = zod_v4.object({
		hints: zod_v4.array(ModelHintSchema$1).optional(),
		costPriority: zod_v4.number().min(0).max(1).optional(),
		speedPriority: zod_v4.number().min(0).max(1).optional(),
		intelligencePriority: zod_v4.number().min(0).max(1).optional()
	});
	/**
	* Controls tool usage behavior in sampling requests.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to calling LLM
	* provider APIs directly.
	*/
	const ToolChoiceSchema$1 = zod_v4.object({ mode: zod_v4.enum([
		"auto",
		"required",
		"none"
	]).optional() });
	/**
	* The result of a tool execution, provided by the user (server).
	* Represents the outcome of invoking a tool requested via `ToolUseContent`.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to calling LLM
	* provider APIs directly.
	*/
	const ToolResultContentSchema$1 = zod_v4.object({
		type: zod_v4.literal("tool_result"),
		toolUseId: zod_v4.string().describe("The unique identifier for the corresponding tool call."),
		content: zod_v4.array(ContentBlockSchema$1),
		structuredContent: zod_v4.object({}).loose().optional(),
		isError: zod_v4.boolean().optional(),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	/**
	* Basic content types for sampling responses (without tool use).
	* Used for backwards-compatible {@linkcode CreateMessageResult} when tools are not used.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to calling LLM
	* provider APIs directly.
	*/
	const SamplingContentSchema$1 = zod_v4.discriminatedUnion("type", [
		TextContentSchema$1,
		ImageContentSchema$1,
		AudioContentSchema$1
	]);
	/**
	* Content block types allowed in sampling messages.
	* This includes text, image, audio, tool use requests, and tool results.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to calling LLM
	* provider APIs directly.
	*/
	const SamplingMessageContentBlockSchema$1 = zod_v4.discriminatedUnion("type", [
		TextContentSchema$1,
		ImageContentSchema$1,
		AudioContentSchema$1,
		ToolUseContentSchema$1,
		ToolResultContentSchema$1
	]);
	/**
	* Describes a message issued to or received from an LLM API.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to calling LLM
	* provider APIs directly.
	*/
	const SamplingMessageSchema$1 = zod_v4.object({
		role: RoleSchema$1,
		content: zod_v4.union([SamplingMessageContentBlockSchema$1, zod_v4.array(SamplingMessageContentBlockSchema$1)]),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	/**
	* Parameters for a `sampling/createMessage` request.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to calling LLM
	* provider APIs directly.
	*/
	const CreateMessageRequestParamsSchema$1 = TaskAugmentedRequestParamsSchema$1.extend({
		messages: zod_v4.array(SamplingMessageSchema$1),
		modelPreferences: ModelPreferencesSchema$1.optional(),
		systemPrompt: zod_v4.string().optional(),
		includeContext: zod_v4.enum([
			"none",
			"thisServer",
			"allServers"
		]).optional(),
		temperature: zod_v4.number().optional(),
		maxTokens: zod_v4.number().int(),
		stopSequences: zod_v4.array(zod_v4.string()).optional(),
		metadata: JSONObjectSchema$1.optional(),
		tools: zod_v4.array(ToolSchema$1).optional(),
		toolChoice: ToolChoiceSchema$1.optional()
	});
	/**
	* A request from the server to sample an LLM via the client. The client has full discretion over which model to select. The client should also inform the user before beginning sampling, to allow them to inspect the request (human in the loop) and decide whether to approve it.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to calling LLM
	* provider APIs directly.
	*/
	const CreateMessageRequestSchema$1 = RequestSchema$1.extend({
		method: zod_v4.literal("sampling/createMessage"),
		params: CreateMessageRequestParamsSchema$1
	});
	/**
	* The client's response to a `sampling/create_message` request from the server.
	* This is the backwards-compatible version that returns single content (no arrays).
	* Used when the request does not include tools.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to calling LLM
	* provider APIs directly.
	*/
	const CreateMessageResultSchema$1 = ResultSchema$1.extend({
		model: zod_v4.string(),
		stopReason: zod_v4.optional(zod_v4.enum([
			"endTurn",
			"stopSequence",
			"maxTokens"
		]).or(zod_v4.string())),
		role: RoleSchema$1,
		content: SamplingContentSchema$1
	});
	/**
	* The client's response to a `sampling/create_message` request when tools were provided.
	* This version supports array content for tool use flows.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to calling LLM
	* provider APIs directly.
	*/
	const CreateMessageResultWithToolsSchema$1 = ResultSchema$1.extend({
		model: zod_v4.string(),
		stopReason: zod_v4.optional(zod_v4.enum([
			"endTurn",
			"stopSequence",
			"maxTokens",
			"toolUse"
		]).or(zod_v4.string())),
		role: RoleSchema$1,
		content: zod_v4.union([SamplingMessageContentBlockSchema$1, zod_v4.array(SamplingMessageContentBlockSchema$1)])
	});
	/**
	* Primitive schema definition for boolean fields.
	*/
	const BooleanSchemaSchema$1 = zod_v4.object({
		type: zod_v4.literal("boolean"),
		title: zod_v4.string().optional(),
		description: zod_v4.string().optional(),
		default: zod_v4.boolean().optional()
	});
	/**
	* Primitive schema definition for string fields.
	*/
	const StringSchemaSchema$1 = zod_v4.object({
		type: zod_v4.literal("string"),
		title: zod_v4.string().optional(),
		description: zod_v4.string().optional(),
		minLength: zod_v4.number().optional(),
		maxLength: zod_v4.number().optional(),
		format: zod_v4.enum([
			"email",
			"uri",
			"date",
			"date-time"
		]).optional(),
		default: zod_v4.string().optional()
	});
	/**
	* Primitive schema definition for number fields.
	*/
	const NumberSchemaSchema$1 = zod_v4.object({
		type: zod_v4.enum(["number", "integer"]),
		title: zod_v4.string().optional(),
		description: zod_v4.string().optional(),
		minimum: zod_v4.number().optional(),
		maximum: zod_v4.number().optional(),
		default: zod_v4.number().optional()
	});
	/**
	* Schema for single-selection enumeration without display titles for options.
	*/
	const UntitledSingleSelectEnumSchemaSchema$1 = zod_v4.object({
		type: zod_v4.literal("string"),
		title: zod_v4.string().optional(),
		description: zod_v4.string().optional(),
		enum: zod_v4.array(zod_v4.string()),
		default: zod_v4.string().optional()
	});
	/**
	* Schema for single-selection enumeration with display titles for each option.
	*/
	const TitledSingleSelectEnumSchemaSchema$1 = zod_v4.object({
		type: zod_v4.literal("string"),
		title: zod_v4.string().optional(),
		description: zod_v4.string().optional(),
		oneOf: zod_v4.array(zod_v4.object({
			const: zod_v4.string(),
			title: zod_v4.string()
		})),
		default: zod_v4.string().optional()
	});
	/**
	* Use {@linkcode TitledSingleSelectEnumSchema} instead.
	* This interface will be removed in a future version.
	*/
	const LegacyTitledEnumSchemaSchema$1 = zod_v4.object({
		type: zod_v4.literal("string"),
		title: zod_v4.string().optional(),
		description: zod_v4.string().optional(),
		enum: zod_v4.array(zod_v4.string()),
		enumNames: zod_v4.array(zod_v4.string()).optional(),
		default: zod_v4.string().optional()
	});
	const SingleSelectEnumSchemaSchema$1 = zod_v4.union([UntitledSingleSelectEnumSchemaSchema$1, TitledSingleSelectEnumSchemaSchema$1]);
	/**
	* Schema for multiple-selection enumeration without display titles for options.
	*/
	const UntitledMultiSelectEnumSchemaSchema$1 = zod_v4.object({
		type: zod_v4.literal("array"),
		title: zod_v4.string().optional(),
		description: zod_v4.string().optional(),
		minItems: zod_v4.number().optional(),
		maxItems: zod_v4.number().optional(),
		items: zod_v4.object({
			type: zod_v4.literal("string"),
			enum: zod_v4.array(zod_v4.string())
		}),
		default: zod_v4.array(zod_v4.string()).optional()
	});
	/**
	* Schema for multiple-selection enumeration with display titles for each option.
	*/
	const TitledMultiSelectEnumSchemaSchema$1 = zod_v4.object({
		type: zod_v4.literal("array"),
		title: zod_v4.string().optional(),
		description: zod_v4.string().optional(),
		minItems: zod_v4.number().optional(),
		maxItems: zod_v4.number().optional(),
		items: zod_v4.object({ anyOf: zod_v4.array(zod_v4.object({
			const: zod_v4.string(),
			title: zod_v4.string()
		})) }),
		default: zod_v4.array(zod_v4.string()).optional()
	});
	/**
	* Combined schema for multiple-selection enumeration
	*/
	const MultiSelectEnumSchemaSchema$1 = zod_v4.union([UntitledMultiSelectEnumSchemaSchema$1, TitledMultiSelectEnumSchemaSchema$1]);
	/**
	* Primitive schema definition for enum fields.
	*/
	const EnumSchemaSchema$1 = zod_v4.union([
		LegacyTitledEnumSchemaSchema$1,
		SingleSelectEnumSchemaSchema$1,
		MultiSelectEnumSchemaSchema$1
	]);
	/**
	* Union of all primitive schema definitions.
	*/
	const PrimitiveSchemaDefinitionSchema$1 = zod_v4.union([
		EnumSchemaSchema$1,
		BooleanSchemaSchema$1,
		StringSchemaSchema$1,
		NumberSchemaSchema$1
	]);
	/**
	* Parameters for an `elicitation/create` request for form-based elicitation.
	*/
	const ElicitRequestFormParamsSchema$1 = TaskAugmentedRequestParamsSchema$1.extend({
		mode: zod_v4.literal("form").optional(),
		message: zod_v4.string(),
		requestedSchema: zod_v4.object({
			type: zod_v4.literal("object"),
			properties: zod_v4.record(zod_v4.string(), PrimitiveSchemaDefinitionSchema$1),
			required: zod_v4.array(zod_v4.string()).optional()
		}).catchall(zod_v4.unknown())
	});
	/**
	* Parameters for an {@linkcode ElicitRequest | elicitation/create} request for URL-based elicitation.
	*/
	const ElicitRequestURLParamsSchema$1 = TaskAugmentedRequestParamsSchema$1.extend({
		mode: zod_v4.literal("url"),
		message: zod_v4.string(),
		elicitationId: zod_v4.string(),
		url: zod_v4.string().url()
	});
	/**
	* The parameters for a request to elicit additional information from the user via the client.
	*/
	const ElicitRequestParamsSchema$1 = zod_v4.union([ElicitRequestFormParamsSchema$1, ElicitRequestURLParamsSchema$1]);
	/**
	* A request from the server to elicit user input via the client.
	* The client should present the message and form fields to the user (form mode)
	* or navigate to a URL (URL mode).
	*/
	const ElicitRequestSchema$1 = RequestSchema$1.extend({
		method: zod_v4.literal("elicitation/create"),
		params: ElicitRequestParamsSchema$1
	});
	/**
	* Parameters for a {@linkcode ElicitationCompleteNotification | notifications/elicitation/complete} notification.
	*
	* @category notifications/elicitation/complete
	*/
	const ElicitationCompleteNotificationParamsSchema$1 = NotificationsParamsSchema$1.extend({ elicitationId: zod_v4.string() });
	/**
	* A notification from the server to the client, informing it of a completion of an out-of-band elicitation request.
	*
	* @category notifications/elicitation/complete
	*/
	const ElicitationCompleteNotificationSchema$1 = NotificationSchema$1.extend({
		method: zod_v4.literal("notifications/elicitation/complete"),
		params: ElicitationCompleteNotificationParamsSchema$1
	});
	/**
	* The client's response to an {@linkcode ElicitRequest | elicitation/create} request from the server.
	*/
	const ElicitResultSchema$1 = ResultSchema$1.extend({
		action: zod_v4.enum([
			"accept",
			"decline",
			"cancel"
		]),
		content: zod_v4.preprocess((val) => val === null ? void 0 : val, zod_v4.record(zod_v4.string(), zod_v4.union([
			zod_v4.string(),
			zod_v4.number(),
			zod_v4.boolean(),
			zod_v4.array(zod_v4.string())
		])).optional())
	});
	/**
	* A reference to a resource or resource template definition.
	*/
	const ResourceTemplateReferenceSchema$1 = zod_v4.object({
		type: zod_v4.literal("ref/resource"),
		uri: zod_v4.string()
	});
	/**
	* Identifies a prompt.
	*/
	const PromptReferenceSchema$1 = zod_v4.object({
		type: zod_v4.literal("ref/prompt"),
		name: zod_v4.string()
	});
	/**
	* Parameters for a {@linkcode CompleteRequest | completion/complete} request.
	*/
	const CompleteRequestParamsSchema$1 = BaseRequestParamsSchema$1.extend({
		ref: zod_v4.union([PromptReferenceSchema$1, ResourceTemplateReferenceSchema$1]),
		argument: zod_v4.object({
			name: zod_v4.string(),
			value: zod_v4.string()
		}),
		context: zod_v4.object({ arguments: zod_v4.record(zod_v4.string(), zod_v4.string()).optional() }).optional()
	});
	/**
	* A request from the client to the server, to ask for completion options.
	*/
	const CompleteRequestSchema$1 = RequestSchema$1.extend({
		method: zod_v4.literal("completion/complete"),
		params: CompleteRequestParamsSchema$1
	});
	/**
	* The server's response to a {@linkcode CompleteRequest | completion/complete} request
	*/
	const CompleteResultSchema$1 = ResultSchema$1.extend({ completion: zod_v4.looseObject({
		values: zod_v4.array(zod_v4.string()).max(100),
		total: zod_v4.optional(zod_v4.number().int()),
		hasMore: zod_v4.optional(zod_v4.boolean())
	}) });
	/**
	* Represents a root directory or file that the server can operate on.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to passing paths via
	* tool parameters, resource URIs, or configuration.
	*/
	const RootSchema$1 = zod_v4.object({
		uri: zod_v4.string().startsWith("file://"),
		name: zod_v4.string().optional(),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	/**
	* Sent from the server to request a list of root URIs from the client.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to passing paths via
	* tool parameters, resource URIs, or configuration.
	*/
	const ListRootsRequestSchema$1 = RequestSchema$1.extend({
		method: zod_v4.literal("roots/list"),
		params: BaseRequestParamsSchema$1.optional()
	});
	/**
	* The client's response to a `roots/list` request from the server.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to passing paths via
	* tool parameters, resource URIs, or configuration.
	*/
	const ListRootsResultSchema$1 = ResultSchema$1.extend({ roots: zod_v4.array(RootSchema$1) });
	/**
	* A notification from the client to the server, informing it that the list of roots has changed.
	*
	* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
	* in the specification for at least twelve months. Migrate to passing paths via
	* tool parameters, resource URIs, or configuration.
	*/
	const RootsListChangedNotificationSchema$1 = NotificationSchema$1.extend({
		method: zod_v4.literal("notifications/roots/list_changed"),
		params: NotificationsParamsSchema$1.optional()
	});
	/**
	* Task creation parameters, used to ask that the server create a task to represent a request.
	*
	* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
	*/
	const TaskCreationParamsSchema$1 = zod_v4.looseObject({
		ttl: zod_v4.number().optional(),
		pollInterval: zod_v4.number().optional()
	});
	/**
	* The status of a task.
	*
	* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
	*/
	const TaskStatusSchema$1 = zod_v4.enum([
		"working",
		"input_required",
		"completed",
		"failed",
		"cancelled"
	]);
	/**
	* A pollable state object associated with a request.
	*
	* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
	*/
	const TaskSchema$1 = zod_v4.object({
		taskId: zod_v4.string(),
		status: TaskStatusSchema$1,
		ttl: zod_v4.union([zod_v4.number(), zod_v4.null()]),
		createdAt: zod_v4.string(),
		lastUpdatedAt: zod_v4.string(),
		pollInterval: zod_v4.optional(zod_v4.number()),
		statusMessage: zod_v4.optional(zod_v4.string())
	});
	/**
	* Result returned when a task is created, containing the task data wrapped in a `task` field.
	*
	* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
	*/
	const CreateTaskResultSchema$1 = ResultSchema$1.extend({ task: TaskSchema$1 });
	/**
	* Parameters for task status notification.
	*
	* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
	*/
	const TaskStatusNotificationParamsSchema$1 = NotificationsParamsSchema$1.merge(TaskSchema$1);
	/**
	* A notification sent when a task's status changes.
	*
	* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
	*/
	const TaskStatusNotificationSchema$1 = NotificationSchema$1.extend({
		method: zod_v4.literal("notifications/tasks/status"),
		params: TaskStatusNotificationParamsSchema$1
	});
	/**
	* A request to get the state of a specific task.
	*
	* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
	*/
	const GetTaskRequestSchema$1 = RequestSchema$1.extend({
		method: zod_v4.literal("tasks/get"),
		params: BaseRequestParamsSchema$1.extend({ taskId: zod_v4.string() })
	});
	/**
	* The response to a {@linkcode GetTaskRequest | tasks/get} request.
	*
	* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
	*/
	const GetTaskResultSchema$1 = ResultSchema$1.merge(TaskSchema$1);
	/**
	* A request to get the result of a specific task.
	*
	* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
	*/
	const GetTaskPayloadRequestSchema$1 = RequestSchema$1.extend({
		method: zod_v4.literal("tasks/result"),
		params: BaseRequestParamsSchema$1.extend({ taskId: zod_v4.string() })
	});
	/**
	* The response to a `tasks/result` request.
	* The structure matches the result type of the original request.
	* For example, a {@linkcode CallToolRequest | tools/call} task would return the `CallToolResult` structure.
	*
	*
	* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
	*/
	const GetTaskPayloadResultSchema$1 = ResultSchema$1.loose();
	/**
	* A request to list tasks.
	*
	* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
	*/
	const ListTasksRequestSchema$1 = PaginatedRequestSchema$1.extend({ method: zod_v4.literal("tasks/list") });
	/**
	* The response to a {@linkcode ListTasksRequest | tasks/list} request.
	*
	* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
	*/
	const ListTasksResultSchema$1 = PaginatedResultSchema$1.extend({ tasks: zod_v4.array(TaskSchema$1) });
	/**
	* A request to cancel a specific task.
	*
	* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
	*/
	const CancelTaskRequestSchema$1 = RequestSchema$1.extend({
		method: zod_v4.literal("tasks/cancel"),
		params: BaseRequestParamsSchema$1.extend({ taskId: zod_v4.string() })
	});
	return {
		JSONValueSchema: JSONValueSchema$1,
		JSONObjectSchema: JSONObjectSchema$1,
		ProgressTokenSchema: ProgressTokenSchema$1,
		CursorSchema: CursorSchema$1,
		TaskMetadataSchema: TaskMetadataSchema$1,
		RelatedTaskMetadataSchema: RelatedTaskMetadataSchema$1,
		RequestMetaSchema: RequestMetaSchema$1,
		BaseRequestParamsSchema: BaseRequestParamsSchema$1,
		TaskAugmentedRequestParamsSchema: TaskAugmentedRequestParamsSchema$1,
		RequestSchema: RequestSchema$1,
		NotificationsParamsSchema: NotificationsParamsSchema$1,
		NotificationSchema: NotificationSchema$1,
		ResultSchema: ResultSchema$1,
		RequestIdSchema: RequestIdSchema$1,
		EmptyResultSchema: EmptyResultSchema$1,
		CancelledNotificationParamsSchema: CancelledNotificationParamsSchema$1,
		CancelledNotificationSchema: CancelledNotificationSchema$1,
		IconSchema: IconSchema$1,
		IconsSchema: IconsSchema$1,
		BaseMetadataSchema: BaseMetadataSchema$1,
		ImplementationSchema: ImplementationSchema$1,
		ClientTasksCapabilitySchema: ClientTasksCapabilitySchema$1,
		ServerTasksCapabilitySchema: ServerTasksCapabilitySchema$1,
		ClientCapabilitiesSchema: ClientCapabilitiesSchema$1,
		InitializeRequestParamsSchema: InitializeRequestParamsSchema$1,
		InitializeRequestSchema: InitializeRequestSchema$1,
		ServerCapabilitiesSchema: ServerCapabilitiesSchema$1,
		InitializeResultSchema: InitializeResultSchema$1,
		InitializedNotificationSchema: InitializedNotificationSchema$1,
		PingRequestSchema: PingRequestSchema$1,
		ProgressSchema: ProgressSchema$1,
		ProgressNotificationParamsSchema: ProgressNotificationParamsSchema$1,
		ProgressNotificationSchema: ProgressNotificationSchema$1,
		PaginatedRequestParamsSchema: PaginatedRequestParamsSchema$1,
		PaginatedRequestSchema: PaginatedRequestSchema$1,
		PaginatedResultSchema: PaginatedResultSchema$1,
		ResourceContentsSchema: ResourceContentsSchema$1,
		TextResourceContentsSchema: TextResourceContentsSchema$1,
		BlobResourceContentsSchema: BlobResourceContentsSchema$1,
		RoleSchema: RoleSchema$1,
		AnnotationsSchema: AnnotationsSchema$1,
		ResourceSchema: ResourceSchema$1,
		ResourceTemplateSchema: ResourceTemplateSchema$1,
		ListResourcesRequestSchema: ListResourcesRequestSchema$1,
		ListResourcesResultSchema: ListResourcesResultSchema$1,
		ListResourceTemplatesRequestSchema: ListResourceTemplatesRequestSchema$1,
		ListResourceTemplatesResultSchema: ListResourceTemplatesResultSchema$1,
		ResourceRequestParamsSchema: ResourceRequestParamsSchema$1,
		ReadResourceRequestParamsSchema: ReadResourceRequestParamsSchema$1,
		ReadResourceRequestSchema: ReadResourceRequestSchema$1,
		ReadResourceResultSchema: ReadResourceResultSchema$1,
		ResourceListChangedNotificationSchema: ResourceListChangedNotificationSchema$1,
		SubscribeRequestParamsSchema: SubscribeRequestParamsSchema$1,
		SubscribeRequestSchema: SubscribeRequestSchema$1,
		UnsubscribeRequestParamsSchema: UnsubscribeRequestParamsSchema$1,
		UnsubscribeRequestSchema: UnsubscribeRequestSchema$1,
		ResourceUpdatedNotificationParamsSchema: ResourceUpdatedNotificationParamsSchema$1,
		ResourceUpdatedNotificationSchema: ResourceUpdatedNotificationSchema$1,
		PromptArgumentSchema: PromptArgumentSchema$1,
		PromptSchema: PromptSchema$1,
		ListPromptsRequestSchema: ListPromptsRequestSchema$1,
		ListPromptsResultSchema: ListPromptsResultSchema$1,
		GetPromptRequestParamsSchema: GetPromptRequestParamsSchema$1,
		GetPromptRequestSchema: GetPromptRequestSchema$1,
		TextContentSchema: TextContentSchema$1,
		ImageContentSchema: ImageContentSchema$1,
		AudioContentSchema: AudioContentSchema$1,
		ToolUseContentSchema: ToolUseContentSchema$1,
		EmbeddedResourceSchema: EmbeddedResourceSchema$1,
		ResourceLinkSchema: ResourceLinkSchema$1,
		ContentBlockSchema: ContentBlockSchema$1,
		PromptMessageSchema: PromptMessageSchema$1,
		GetPromptResultSchema: GetPromptResultSchema$1,
		PromptListChangedNotificationSchema: PromptListChangedNotificationSchema$1,
		ToolAnnotationsSchema: ToolAnnotationsSchema$1,
		ToolExecutionSchema: ToolExecutionSchema$1,
		ToolSchema: ToolSchema$1,
		ListToolsRequestSchema: ListToolsRequestSchema$1,
		ListToolsResultSchema: ListToolsResultSchema$1,
		CallToolResultSchema: CallToolResultSchema$1,
		CallToolRequestParamsSchema: CallToolRequestParamsSchema$1,
		CallToolRequestSchema: CallToolRequestSchema$1,
		ToolListChangedNotificationSchema: ToolListChangedNotificationSchema$1,
		LoggingLevelSchema: LoggingLevelSchema$1,
		SetLevelRequestParamsSchema: SetLevelRequestParamsSchema$1,
		SetLevelRequestSchema: SetLevelRequestSchema$1,
		LoggingMessageNotificationParamsSchema: LoggingMessageNotificationParamsSchema$1,
		LoggingMessageNotificationSchema: LoggingMessageNotificationSchema$1,
		ModelHintSchema: ModelHintSchema$1,
		ModelPreferencesSchema: ModelPreferencesSchema$1,
		ToolChoiceSchema: ToolChoiceSchema$1,
		ToolResultContentSchema: ToolResultContentSchema$1,
		SamplingContentSchema: SamplingContentSchema$1,
		SamplingMessageContentBlockSchema: SamplingMessageContentBlockSchema$1,
		SamplingMessageSchema: SamplingMessageSchema$1,
		CreateMessageRequestParamsSchema: CreateMessageRequestParamsSchema$1,
		CreateMessageRequestSchema: CreateMessageRequestSchema$1,
		CreateMessageResultSchema: CreateMessageResultSchema$1,
		CreateMessageResultWithToolsSchema: CreateMessageResultWithToolsSchema$1,
		BooleanSchemaSchema: BooleanSchemaSchema$1,
		StringSchemaSchema: StringSchemaSchema$1,
		NumberSchemaSchema: NumberSchemaSchema$1,
		UntitledSingleSelectEnumSchemaSchema: UntitledSingleSelectEnumSchemaSchema$1,
		TitledSingleSelectEnumSchemaSchema: TitledSingleSelectEnumSchemaSchema$1,
		LegacyTitledEnumSchemaSchema: LegacyTitledEnumSchemaSchema$1,
		SingleSelectEnumSchemaSchema: SingleSelectEnumSchemaSchema$1,
		UntitledMultiSelectEnumSchemaSchema: UntitledMultiSelectEnumSchemaSchema$1,
		TitledMultiSelectEnumSchemaSchema: TitledMultiSelectEnumSchemaSchema$1,
		MultiSelectEnumSchemaSchema: MultiSelectEnumSchemaSchema$1,
		EnumSchemaSchema: EnumSchemaSchema$1,
		PrimitiveSchemaDefinitionSchema: PrimitiveSchemaDefinitionSchema$1,
		ElicitRequestFormParamsSchema: ElicitRequestFormParamsSchema$1,
		ElicitRequestURLParamsSchema: ElicitRequestURLParamsSchema$1,
		ElicitRequestParamsSchema: ElicitRequestParamsSchema$1,
		ElicitRequestSchema: ElicitRequestSchema$1,
		ElicitationCompleteNotificationParamsSchema: ElicitationCompleteNotificationParamsSchema$1,
		ElicitationCompleteNotificationSchema: ElicitationCompleteNotificationSchema$1,
		ElicitResultSchema: ElicitResultSchema$1,
		ResourceTemplateReferenceSchema: ResourceTemplateReferenceSchema$1,
		PromptReferenceSchema: PromptReferenceSchema$1,
		CompleteRequestParamsSchema: CompleteRequestParamsSchema$1,
		CompleteRequestSchema: CompleteRequestSchema$1,
		CompleteResultSchema: CompleteResultSchema$1,
		RootSchema: RootSchema$1,
		ListRootsRequestSchema: ListRootsRequestSchema$1,
		ListRootsResultSchema: ListRootsResultSchema$1,
		RootsListChangedNotificationSchema: RootsListChangedNotificationSchema$1,
		TaskCreationParamsSchema: TaskCreationParamsSchema$1,
		TaskStatusSchema: TaskStatusSchema$1,
		TaskSchema: TaskSchema$1,
		CreateTaskResultSchema: CreateTaskResultSchema$1,
		TaskStatusNotificationParamsSchema: TaskStatusNotificationParamsSchema$1,
		TaskStatusNotificationSchema: TaskStatusNotificationSchema$1,
		GetTaskRequestSchema: GetTaskRequestSchema$1,
		GetTaskResultSchema: GetTaskResultSchema$1,
		GetTaskPayloadRequestSchema: GetTaskPayloadRequestSchema$1,
		GetTaskPayloadResultSchema: GetTaskPayloadResultSchema$1,
		ListTasksRequestSchema: ListTasksRequestSchema$1,
		ListTasksResultSchema: ListTasksResultSchema$1,
		CancelTaskRequestSchema: CancelTaskRequestSchema$1,
		CancelTaskResultSchema: ResultSchema$1.merge(TaskSchema$1),
		ClientRequestSchema: zod_v4.union([
			PingRequestSchema$1,
			InitializeRequestSchema$1,
			CompleteRequestSchema$1,
			SetLevelRequestSchema$1,
			GetPromptRequestSchema$1,
			ListPromptsRequestSchema$1,
			ListResourcesRequestSchema$1,
			ListResourceTemplatesRequestSchema$1,
			ReadResourceRequestSchema$1,
			SubscribeRequestSchema$1,
			UnsubscribeRequestSchema$1,
			CallToolRequestSchema$1,
			ListToolsRequestSchema$1,
			GetTaskRequestSchema$1,
			GetTaskPayloadRequestSchema$1,
			ListTasksRequestSchema$1,
			CancelTaskRequestSchema$1
		]),
		ClientNotificationSchema: zod_v4.union([
			CancelledNotificationSchema$1,
			ProgressNotificationSchema$1,
			InitializedNotificationSchema$1,
			RootsListChangedNotificationSchema$1,
			TaskStatusNotificationSchema$1
		]),
		ClientResultSchema: zod_v4.union([
			EmptyResultSchema$1,
			CreateMessageResultSchema$1,
			CreateMessageResultWithToolsSchema$1,
			ElicitResultSchema$1,
			ListRootsResultSchema$1,
			GetTaskResultSchema$1,
			ListTasksResultSchema$1,
			CreateTaskResultSchema$1
		]),
		ServerRequestSchema: zod_v4.union([
			PingRequestSchema$1,
			CreateMessageRequestSchema$1,
			ElicitRequestSchema$1,
			ListRootsRequestSchema$1,
			GetTaskRequestSchema$1,
			GetTaskPayloadRequestSchema$1,
			ListTasksRequestSchema$1,
			CancelTaskRequestSchema$1
		]),
		ServerNotificationSchema: zod_v4.union([
			CancelledNotificationSchema$1,
			ProgressNotificationSchema$1,
			LoggingMessageNotificationSchema$1,
			ResourceUpdatedNotificationSchema$1,
			ResourceListChangedNotificationSchema$1,
			ToolListChangedNotificationSchema$1,
			PromptListChangedNotificationSchema$1,
			TaskStatusNotificationSchema$1,
			ElicitationCompleteNotificationSchema$1
		]),
		ServerResultSchema: zod_v4.union([
			EmptyResultSchema$1,
			InitializeResultSchema$1,
			CompleteResultSchema$1,
			GetPromptResultSchema$1,
			ListPromptsResultSchema$1,
			ListResourcesResultSchema$1,
			ListResourceTemplatesResultSchema$1,
			ReadResourceResultSchema$1,
			CallToolResultSchema$1,
			ListToolsResultSchema$1,
			GetTaskResultSchema$1,
			ListTasksResultSchema$1,
			CreateTaskResultSchema$1
		]),
		CallToolResultWireSchema: zod_v4.unknown().superRefine((value, ctx) => {
			if (typeof value !== "object" || value === null || Array.isArray(value) || value.content !== void 0) return;
			for (const key of TOOL_RESULT_FOREIGN_FAMILY_KEYS) if (key in value) {
				ctx.addIssue({
					code: "custom",
					message: `content is required when the body carries '${key}' — another result family cannot default into an empty tools/call success`
				});
				return;
			}
		}).transform(normalizeContentlessToolResult).pipe(CallToolResultSchema$1)
	};
}
let memo$1;
/**
* Builds the era wire-schema set on first call and returns the same object
* thereafter. Module evaluation stays construction-free so importing the
* era codec/registry costs nothing until the first validation actually
* needs a schema; the registry, the codec, and the eager `schemas.ts`
* shim all pull through this memo, so reference identity holds across
* every consumer.
*/
function buildSchemas2025() {
	return memo$1 ??= build$1();
}

//#endregion
//#region ../core-internal/src/wire/rev2025-11-25/legacyWrap.ts
/**
* SEP-2106 legacy `outputSchema` wrap helpers (2025-era projection only).
*
* The neutral / 2026-07-28 model lets a tool's `outputSchema` carry any JSON
* Schema root. The 2025-11-25 wire shape requires `type:'object'` at the root,
* so when an era-blind handler advertises a non-object root, the 2025 codec's
* `encodeResult('tools/list', …)` projects it down to
* `{type:'object', properties:{result:<natural>}, required:['result']}`, and
* `projectCallToolResult` wraps the matching `structuredContent` as
* `{result:<value>}`. The 2026 codec's projections are the identity.
*
* These helpers are wire-layer property — they exist so the projection can
* live behind {@link WireCodec.encodeResult} / {@link WireCodec.projectCallToolResult}
* and never be re-derived in shared/ or server-side code.
*/
/**
* Whether a JSON Schema's root is non-object: either an explicit non-object
* `type`, or a typeless root such as `{anyOf:[…]}`. Object-shaped typeless
* roots that the schema-conversion layer can prove are objects are stamped
* `type:'object'` upstream, so they reach this predicate as object roots.
*/
function isNonObjectJsonSchemaRoot(json) {
	return json["type"] !== "object";
}
/**
* Keyword-position keys whose values are instance data (not subschemas). A
* `{$ref:…}` appearing inside one is a literal value, not a JSON Pointer to
* rewrite. Only consulted when the current object is in keyword position —
* a PROPERTY named `default`/`const` (under `properties`/`$defs`/…) is a name
* position whose value IS a subschema and is recursed into.
*/
const REF_REWRITE_DATA_POSITION_KEYS = new Set([
	"const",
	"enum",
	"default",
	"examples"
]);
/**
* Keyword-position keys whose value is a name→subschema map. Entries inside
* such a map are in NAME position: their keys are author-chosen property
* names (which may collide with JSON Schema keywords), their values are
* subschemas to recurse into.
*/
const REF_REWRITE_NAME_MAP_KEYS = new Set([
	"properties",
	"patternProperties",
	"$defs",
	"definitions",
	"dependentSchemas",
	"dependencies"
]);
/**
* Whether a subtree's `$id` establishes a new resolution base. A fragment-only
* `$id` (`"#item"`, the draft-07/06 spelling of 2020-12's `$anchor`) does not
* change the RFC 3986 base URI — same-document pointers inside still resolve
* against the document root and must be rewritten.
*/
function establishesNewBase(id) {
	return id !== void 0 && !(typeof id === "string" && id.startsWith("#"));
}
/**
* Wrap a non-object output schema in the 2025-era envelope:
* `{type:'object', properties:{result:<natural>}, required:['result']}`.
*
* Same-document `$ref` / `$dynamicRef` JSON Pointers inside the natural schema
* (e.g. `#/properties/foo` produced by zod for de-duplicated/recursive types)
* are rewritten to account for the new `#/properties/result` root: bare `#` →
* `#/properties/result`, `#/…` → `#/properties/result/…`. Cross-document refs
* (anything not starting with `#`) are left untouched.
*
* The rewrite is position-aware: data-valued keywords
* (`const`/`enum`/`default`/`examples`) in keyword position are NOT descended
* into; the same names appearing as property names under
* `properties`/`patternProperties`/`$defs`/`definitions`/`dependentSchemas`/
* `dependencies` ARE descended into (they're subschemas). The rewrite is also
* `$id`-scoped: if the natural root carries a base-establishing `$id` no
* pointer is rewritten (same-document refs inside resolve against the embedded
* `$id` base, not the wrapper root), and any subtree that establishes its own
* `$id` is left untouched for the same reason. Fragment-only `$id` (`"#item"`,
* draft-07's anchor spelling) does not establish a base and IS descended into.
*/
function wrapOutputSchemaForLegacy(natural) {
	const $schema = typeof natural["$schema"] === "string" ? natural["$schema"] : void 0;
	if (establishesNewBase(natural["$id"])) return {
		...$schema !== void 0 && { $schema },
		type: "object",
		properties: { result: natural },
		required: ["result"]
	};
	const convertRecursiveRefs = require_dialects.declares2019Dialect(natural["$schema"]) && natural["$recursiveAnchor"] !== true;
	const rewriteRefs = (node, parentIsNameMap) => {
		if (Array.isArray(node)) return node.map((item) => rewriteRefs(item, false));
		if (node === null || typeof node !== "object") return node;
		if (!parentIsNameMap && establishesNewBase(node["$id"])) return node;
		const out = {};
		let convertedRecursion = false;
		for (const [k, v] of Object.entries(node)) if (parentIsNameMap) out[k] = rewriteRefs(v, false);
		else if ((k === "$ref" || k === "$dynamicRef") && typeof v === "string") out[k] = v === "#" ? "#/properties/result" : v.startsWith("#/") ? `#/properties/result${v.slice(1)}` : v;
		else if (k === "$recursiveRef" && v === "#" && convertRecursiveRefs) convertedRecursion = true;
		else if (REF_REWRITE_DATA_POSITION_KEYS.has(k)) out[k] = v;
		else if (REF_REWRITE_NAME_MAP_KEYS.has(k)) out[k] = rewriteRefs(v, true);
		else out[k] = rewriteRefs(v, false);
		if (convertedRecursion) if ("$ref" in out) out["allOf"] = [...Array.isArray(out["allOf"]) ? out["allOf"] : [], { $ref: "#/properties/result" }];
		else out["$ref"] = "#/properties/result";
		return out;
	};
	return {
		...$schema !== void 0 && { $schema },
		type: "object",
		properties: { result: rewriteRefs(natural, false) },
		required: ["result"]
	};
}

//#endregion
//#region ../core-internal/src/wire/rev2025-11-25/registry.ts
const requestMethodKeys$1 = {
	ping: null,
	initialize: null,
	"completion/complete": null,
	"logging/setLevel": null,
	"prompts/get": null,
	"prompts/list": null,
	"resources/list": null,
	"resources/templates/list": null,
	"resources/read": null,
	"resources/subscribe": null,
	"resources/unsubscribe": null,
	"tools/call": null,
	"tools/list": null,
	"tasks/get": null,
	"tasks/result": null,
	"tasks/list": null,
	"tasks/cancel": null,
	"sampling/createMessage": null,
	"elicitation/create": null,
	"roots/list": null
};
const notificationMethodKeys$1 = {
	"notifications/cancelled": null,
	"notifications/progress": null,
	"notifications/initialized": null,
	"notifications/roots/list_changed": null,
	"notifications/tasks/status": null,
	"notifications/message": null,
	"notifications/resources/updated": null,
	"notifications/resources/list_changed": null,
	"notifications/tools/list_changed": null,
	"notifications/prompts/list_changed": null,
	"notifications/elicitation/complete": null
};
const resultMethodKeys = {
	ping: null,
	initialize: null,
	"completion/complete": null,
	"logging/setLevel": null,
	"prompts/get": null,
	"prompts/list": null,
	"resources/list": null,
	"resources/templates/list": null,
	"resources/read": null,
	"resources/subscribe": null,
	"resources/unsubscribe": null,
	"tools/call": null,
	"tools/list": null,
	"sampling/createMessage": null,
	"elicitation/create": null,
	"roots/list": null
};
let maps$1;
function registryMaps() {
	if (maps$1) return maps$1;
	const s = buildSchemas2025();
	maps$1 = {
		requestSchemas: {
			ping: s.PingRequestSchema,
			initialize: s.InitializeRequestSchema,
			"completion/complete": s.CompleteRequestSchema,
			"logging/setLevel": s.SetLevelRequestSchema,
			"prompts/get": s.GetPromptRequestSchema,
			"prompts/list": s.ListPromptsRequestSchema,
			"resources/list": s.ListResourcesRequestSchema,
			"resources/templates/list": s.ListResourceTemplatesRequestSchema,
			"resources/read": s.ReadResourceRequestSchema,
			"resources/subscribe": s.SubscribeRequestSchema,
			"resources/unsubscribe": s.UnsubscribeRequestSchema,
			"tools/call": s.CallToolRequestSchema,
			"tools/list": s.ListToolsRequestSchema,
			"tasks/get": s.GetTaskRequestSchema,
			"tasks/result": s.GetTaskPayloadRequestSchema,
			"tasks/list": s.ListTasksRequestSchema,
			"tasks/cancel": s.CancelTaskRequestSchema,
			"sampling/createMessage": s.CreateMessageRequestSchema,
			"elicitation/create": s.ElicitRequestSchema,
			"roots/list": s.ListRootsRequestSchema
		},
		notificationSchemas: {
			"notifications/cancelled": s.CancelledNotificationSchema,
			"notifications/progress": s.ProgressNotificationSchema,
			"notifications/initialized": s.InitializedNotificationSchema,
			"notifications/roots/list_changed": s.RootsListChangedNotificationSchema,
			"notifications/tasks/status": s.TaskStatusNotificationSchema,
			"notifications/message": s.LoggingMessageNotificationSchema,
			"notifications/resources/updated": s.ResourceUpdatedNotificationSchema,
			"notifications/resources/list_changed": s.ResourceListChangedNotificationSchema,
			"notifications/tools/list_changed": s.ToolListChangedNotificationSchema,
			"notifications/prompts/list_changed": s.PromptListChangedNotificationSchema,
			"notifications/elicitation/complete": s.ElicitationCompleteNotificationSchema
		},
		resultSchemas: {
			ping: s.EmptyResultSchema,
			initialize: s.InitializeResultSchema,
			"completion/complete": s.CompleteResultSchema,
			"logging/setLevel": s.EmptyResultSchema,
			"prompts/get": s.GetPromptResultSchema,
			"prompts/list": s.ListPromptsResultSchema,
			"resources/list": s.ListResourcesResultSchema,
			"resources/templates/list": s.ListResourceTemplatesResultSchema,
			"resources/read": s.ReadResourceResultSchema,
			"resources/subscribe": s.EmptyResultSchema,
			"resources/unsubscribe": s.EmptyResultSchema,
			"tools/call": s.CallToolResultWireSchema,
			"tools/list": s.ListToolsResultSchema,
			"sampling/createMessage": s.CreateMessageResultWithToolsSchema,
			"elicitation/create": s.ElicitResultSchema,
			"roots/list": s.ListRootsResultSchema
		}
	};
	return maps$1;
}
/**
* Forces the lazy registry maps (and, through them, the era's schema memo).
* Warm-up hook for `preloadSchemas()` — no-op once the maps exist.
*/
function warmRegistryMaps2025() {
	registryMaps();
}
/** The 2025-era request-method set (registry membership = the deletion story). */
function hasRequestMethod2025(method) {
	return Object.prototype.hasOwnProperty.call(requestMethodKeys$1, method);
}
/** The 2025-era notification-method set. */
function hasNotificationMethod2025(method) {
	return Object.prototype.hasOwnProperty.call(notificationMethodKeys$1, method);
}
/** Result-map membership: exactly the era's typed-method subset (no task entries, no 2026-only methods). */
function hasResultMethod(method) {
	return Object.prototype.hasOwnProperty.call(resultMethodKeys, method);
}
function getResultSchema(method) {
	return hasResultMethod(method) ? registryMaps().resultSchemas[method] : void 0;
}
function getRequestSchema(method) {
	return hasRequestMethod2025(method) ? registryMaps().requestSchemas[method] : void 0;
}
function getNotificationSchema(method) {
	return hasNotificationMethod2025(method) ? registryMaps().notificationSchemas[method] : void 0;
}
/** Registry method lists (for the spec-method universe and the CI registry-diff oracle). */
const rev2025RequestMethods = Object.keys(requestMethodKeys$1);
const rev2025NotificationMethods = Object.keys(notificationMethodKeys$1);

//#endregion
//#region ../core-internal/src/wire/rev2025-11-25/codec.ts
function isPlainObject$6(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Tri-state wrap of an optional Zod schema lookup (the function-only contract). */
function triState$1(schema, raw) {
	if (schema === void 0) return {
		ok: false,
		reason: "not-in-era"
	};
	const parsed = schema.safeParse(raw);
	return parsed.success ? {
		ok: true,
		value: parsed.data
	} : {
		ok: false,
		reason: "invalid",
		message: String(parsed.error)
	};
}
const NOT_IN_ERA$1 = {
	ok: false,
	reason: "not-in-era"
};
/** Whether a `tools/list` entry advertises a non-object `outputSchema` root that needs the SEP-2106 legacy wrap. */
function toolNeedsLegacyWrap(t) {
	return isPlainObject$6(t) && isPlainObject$6(t["outputSchema"]) && isNonObjectJsonSchemaRoot(t["outputSchema"]);
}
/** The wire→neutral trust boundary: a decoded 2025-era wire result is adopted as the neutral `Result` here (the module's single deliberate assertion). */
function toNeutralResult(value) {
	return value;
}
const rev2025Codec = {
	era: "2025-11-25",
	hasRequestMethod: hasRequestMethod2025,
	hasNotificationMethod: hasNotificationMethod2025,
	validateRequest: (method, raw) => triState$1(getRequestSchema(method), raw),
	validateResult: (method, raw) => triState$1(getResultSchema(method), raw),
	validateNotification: (method, raw) => triState$1(getNotificationSchema(method), raw),
	hasInputRequestMethod: () => false,
	validateInputRequest: () => NOT_IN_ERA$1,
	validateInputResponse: () => NOT_IN_ERA$1,
	samplingResultVariant: ((hasTools, raw) => {
		const s = buildSchemas2025();
		return triState$1(hasTools ? s.CreateMessageResultWithToolsSchema : s.CreateMessageResultSchema, raw);
	}),
	outboundEnvelope: (_material) => void 0,
	validateEnvelopeMeta: (_meta) => [],
	projectCallToolResult(result, advertisedOutputSchema) {
		const withText = appendTextFallbackForNonObject(result);
		const sc = withText.structuredContent;
		if (sc === void 0) return withText;
		const valueIsNonObject = typeof sc !== "object" || sc === null || Array.isArray(sc);
		const schemaWrapped = advertisedOutputSchema !== void 0 && isNonObjectJsonSchemaRoot(advertisedOutputSchema);
		if (!valueIsNonObject && !schemaWrapped) return withText;
		return {
			...withText,
			structuredContent: { result: sc }
		};
	},
	decodeResult(_method, raw) {
		if (isPlainObject$6(raw) && "resultType" in raw) {
			const stripped = { ...raw };
			delete stripped["resultType"];
			return {
				kind: "complete",
				result: toNeutralResult(stripped)
			};
		}
		return {
			kind: "complete",
			result: toNeutralResult(raw)
		};
	},
	encodeResult(method, result) {
		if (method !== "tools/list") return result;
		const tools = result.tools;
		if (!Array.isArray(tools) || !tools.some((t) => toolNeedsLegacyWrap(t))) return result;
		return {
			...result,
			tools: tools.map((t) => toolNeedsLegacyWrap(t) ? {
				...t,
				outputSchema: wrapOutputSchemaForLegacy(t.outputSchema)
			} : t)
		};
	},
	encodeErrorCode: (code) => code === -32002 ? -32602 : code,
	checkInboundEnvelope: (_material) => void 0
};

//#endregion
//#region ../core-internal/src/wire/rev2026-07-28/buildSchemas.ts
/**
* 2026-era wire schemas (protocol revision 2026-07-28).
*
* Fully self-contained — no runtime imports from types/schemas.ts. The
* neutral types/schemas.ts layer is the public-API superset and is free to
* evolve; this file is the 2026 wire-parse contract and is BEHAVIOR-FROZEN
* against the 2026-07-28 anchor. Every era-shared building block (content
* blocks, resources, prompts, capabilities, notifications, …) that the wire
* shapes compose is a frozen LOCAL copy — verbatim from the neutral layer at
* the point this revision was sealed, dependencies first. The only cross-layer
* dependency is `import type { JSONObject, JSONValue }` from the neutral types
* barrel — pure structural type aliases with no parse behavior.
*
* This module is the only place the per-request `_meta` envelope is modeled.
* The envelope is wire-only vocabulary: the protocol layer lifts it off
* inbound requests before any handler runs and surfaces it at
* `ctx.mcpReq.envelope`; the 2026-era codec enforces its requiredness at
* dispatch time (`checkInboundEnvelope`) - the former neutral-schema JSDoc
* deferral ("enforced per request at dispatch time, not here") is now
* discharged by that codec step.
*
* No 2025-era traffic ever touches this module, so requiredness here is
* bare and spec-exact (the shared-schema `.catch` hazards do not apply).
*
* SPEC-CURRENCY RE-SEAL (2026-07-17): the 2026-07-28 revision was re-sealed
* upstream by spec PR #3002 (commit 71e30695, merged 2026-07-15 — after the
* previous anchor pin f68d864a): the envelope's `clientInfo` demoted from
* required to SHOULD, and `DiscoverResult.serverInfo` moved from the result
* body to the new `ResultMetaObject` key
* `_meta['io.modelcontextprotocol/serverInfo']` (optional on every result).
* The shapes below are the re-sealed anchor, exactly — no pre-#3002 shape is
* modeled anywhere (per ruling: the final revision is the only 2026-07-28).
*/
function build() {
	const JSONValueSchema$1 = zod_v4.lazy(() => zod_v4.union([
		zod_v4.string(),
		zod_v4.number(),
		zod_v4.boolean(),
		zod_v4.null(),
		zod_v4.record(zod_v4.string(), JSONValueSchema$1),
		zod_v4.array(JSONValueSchema$1)
	]));
	const JSONObjectSchema$1 = zod_v4.record(zod_v4.string(), JSONValueSchema$1);
	/**
	* A progress token, used to associate progress notifications with the original request.
	*/
	const ProgressTokenSchema$1 = zod_v4.union([zod_v4.string(), zod_v4.number().int()]);
	/**
	* An opaque token used to represent a cursor for pagination.
	*/
	const CursorSchema$1 = zod_v4.string();
	/**
	* A uniquely identifying ID for a request in JSON-RPC.
	*/
	const RequestIdSchema$1 = zod_v4.union([zod_v4.string(), zod_v4.number().int()]);
	/**
	* The sender or recipient of messages and data in a conversation.
	*/
	const RoleSchema$1 = zod_v4.enum(["user", "assistant"]);
	/**
	* The severity of a log message.
	*/
	const LoggingLevelSchema$1 = zod_v4.enum([
		"debug",
		"info",
		"notice",
		"warning",
		"error",
		"critical",
		"alert",
		"emergency"
	]);
	/**
	* A Zod schema for validating Base64 strings that is more performant and
	* robust for very large inputs than the default regex-based check. It avoids
	* stack overflows by using the native `atob` function for validation.
	*/
	const Base64Schema = zod_v4.string().refine((val) => {
		try {
			atob(val);
			return true;
		} catch {
			return false;
		}
	}, { message: "Invalid Base64 string" });
	/** @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only. */
	const TaskMetadataSchema$1 = zod_v4.object({ ttl: zod_v4.number().optional() });
	/** @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only. */
	const RelatedTaskMetadataSchema$1 = zod_v4.object({ taskId: zod_v4.string() });
	const RequestMetaSchema$1 = zod_v4.looseObject({
		progressToken: ProgressTokenSchema$1.optional(),
		"io.modelcontextprotocol/related-task": RelatedTaskMetadataSchema$1.optional()
	});
	const BaseRequestParamsSchema$1 = zod_v4.object({ _meta: RequestMetaSchema$1.optional() });
	/** @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only. */
	const TaskAugmentedRequestParamsSchema$1 = BaseRequestParamsSchema$1.extend({ task: TaskMetadataSchema$1.optional() });
	const NotificationsParamsSchema$1 = zod_v4.object({ _meta: RequestMetaSchema$1.optional() });
	const NotificationSchema$1 = zod_v4.object({
		method: zod_v4.string(),
		params: NotificationsParamsSchema$1.loose().optional()
	});
	const IconSchema$1 = zod_v4.object({
		src: zod_v4.string(),
		mimeType: zod_v4.string().optional(),
		sizes: zod_v4.array(zod_v4.string()).optional(),
		theme: zod_v4.enum(["light", "dark"]).optional()
	});
	const IconsSchema$1 = zod_v4.object({ icons: zod_v4.array(IconSchema$1).optional() });
	const BaseMetadataSchema$1 = zod_v4.object({
		name: zod_v4.string(),
		title: zod_v4.string().optional()
	});
	const ImplementationSchema$1 = BaseMetadataSchema$1.extend({
		...BaseMetadataSchema$1.shape,
		...IconsSchema$1.shape,
		version: zod_v4.string(),
		websiteUrl: zod_v4.string().optional(),
		description: zod_v4.string().optional()
	});
	const FormElicitationCapabilitySchema = zod_v4.intersection(zod_v4.object({ applyDefaults: zod_v4.boolean().optional() }), JSONObjectSchema$1);
	const ElicitationCapabilitySchema = zod_v4.preprocess((value) => {
		if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return { form: {} };
		return value;
	}, zod_v4.intersection(zod_v4.object({
		form: FormElicitationCapabilitySchema.optional(),
		url: JSONObjectSchema$1.optional()
	}), JSONObjectSchema$1.optional()));
	/** @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only. */
	const ClientTasksCapabilitySchema$1 = zod_v4.looseObject({
		list: JSONObjectSchema$1.optional(),
		cancel: JSONObjectSchema$1.optional(),
		requests: zod_v4.looseObject({
			sampling: zod_v4.looseObject({ createMessage: JSONObjectSchema$1.optional() }).optional(),
			elicitation: zod_v4.looseObject({ create: JSONObjectSchema$1.optional() }).optional()
		}).optional()
	});
	/** @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only. */
	const ServerTasksCapabilitySchema$1 = zod_v4.looseObject({
		list: JSONObjectSchema$1.optional(),
		cancel: JSONObjectSchema$1.optional(),
		requests: zod_v4.looseObject({ tools: zod_v4.looseObject({ call: JSONObjectSchema$1.optional() }).optional() }).optional()
	});
	const ClientCapabilitiesSchema$1 = zod_v4.object({
		experimental: zod_v4.record(zod_v4.string(), JSONObjectSchema$1).optional(),
		sampling: zod_v4.object({
			context: JSONObjectSchema$1.optional(),
			tools: JSONObjectSchema$1.optional()
		}).optional(),
		elicitation: ElicitationCapabilitySchema.optional(),
		roots: zod_v4.object({ listChanged: zod_v4.boolean().optional() }).optional(),
		tasks: ClientTasksCapabilitySchema$1.optional(),
		extensions: zod_v4.record(zod_v4.string(), JSONObjectSchema$1).optional()
	});
	const ServerCapabilitiesSchema$1 = zod_v4.object({
		experimental: zod_v4.record(zod_v4.string(), JSONObjectSchema$1).optional(),
		logging: JSONObjectSchema$1.optional(),
		completions: JSONObjectSchema$1.optional(),
		prompts: zod_v4.object({ listChanged: zod_v4.boolean().optional() }).optional(),
		resources: zod_v4.object({
			subscribe: zod_v4.boolean().optional(),
			listChanged: zod_v4.boolean().optional()
		}).optional(),
		tools: zod_v4.object({ listChanged: zod_v4.boolean().optional() }).optional(),
		tasks: ServerTasksCapabilitySchema$1.optional(),
		extensions: zod_v4.record(zod_v4.string(), JSONObjectSchema$1).optional()
	});
	const ProgressSchema$1 = zod_v4.object({
		progress: zod_v4.number(),
		total: zod_v4.optional(zod_v4.number()),
		message: zod_v4.optional(zod_v4.string())
	});
	const ProgressNotificationParamsSchema$1 = zod_v4.object({
		...NotificationsParamsSchema$1.shape,
		...ProgressSchema$1.shape,
		progressToken: ProgressTokenSchema$1
	});
	const ProgressNotificationSchema$1 = NotificationSchema$1.extend({
		method: zod_v4.literal("notifications/progress"),
		params: ProgressNotificationParamsSchema$1
	});
	const LoggingMessageNotificationParamsSchema$1 = NotificationsParamsSchema$1.extend({
		level: LoggingLevelSchema$1,
		logger: zod_v4.string().optional(),
		data: zod_v4.unknown()
	});
	const LoggingMessageNotificationSchema$1 = NotificationSchema$1.extend({
		method: zod_v4.literal("notifications/message"),
		params: LoggingMessageNotificationParamsSchema$1
	});
	const ResourceContentsSchema$1 = zod_v4.object({
		uri: zod_v4.string(),
		mimeType: zod_v4.optional(zod_v4.string()),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	const TextResourceContentsSchema$1 = ResourceContentsSchema$1.extend({ text: zod_v4.string() });
	const BlobResourceContentsSchema$1 = ResourceContentsSchema$1.extend({ blob: Base64Schema });
	const AnnotationsSchema$1 = zod_v4.object({
		audience: zod_v4.array(RoleSchema$1).optional(),
		priority: zod_v4.number().min(0).max(1).optional(),
		lastModified: zod_v4.iso.datetime({ offset: true }).optional()
	});
	const ResourceSchema$1 = zod_v4.object({
		...BaseMetadataSchema$1.shape,
		...IconsSchema$1.shape,
		uri: zod_v4.string(),
		description: zod_v4.optional(zod_v4.string()),
		mimeType: zod_v4.optional(zod_v4.string()),
		size: zod_v4.optional(zod_v4.number()),
		annotations: AnnotationsSchema$1.optional(),
		_meta: zod_v4.optional(zod_v4.looseObject({}))
	});
	const ResourceTemplateSchema$1 = zod_v4.object({
		...BaseMetadataSchema$1.shape,
		...IconsSchema$1.shape,
		uriTemplate: zod_v4.string(),
		description: zod_v4.optional(zod_v4.string()),
		mimeType: zod_v4.optional(zod_v4.string()),
		annotations: AnnotationsSchema$1.optional(),
		_meta: zod_v4.optional(zod_v4.looseObject({}))
	});
	const ResourceListChangedNotificationSchema$1 = NotificationSchema$1.extend({
		method: zod_v4.literal("notifications/resources/list_changed"),
		params: NotificationsParamsSchema$1.optional()
	});
	const ResourceUpdatedNotificationParamsSchema$1 = NotificationsParamsSchema$1.extend({ uri: zod_v4.string() });
	const ResourceUpdatedNotificationSchema$1 = NotificationSchema$1.extend({
		method: zod_v4.literal("notifications/resources/updated"),
		params: ResourceUpdatedNotificationParamsSchema$1
	});
	const PromptArgumentSchema$1 = zod_v4.object({
		name: zod_v4.string(),
		description: zod_v4.optional(zod_v4.string()),
		required: zod_v4.optional(zod_v4.boolean())
	});
	const PromptSchema$1 = zod_v4.object({
		...BaseMetadataSchema$1.shape,
		...IconsSchema$1.shape,
		description: zod_v4.optional(zod_v4.string()),
		arguments: zod_v4.optional(zod_v4.array(PromptArgumentSchema$1)),
		_meta: zod_v4.optional(zod_v4.looseObject({}))
	});
	const PromptListChangedNotificationSchema$1 = NotificationSchema$1.extend({
		method: zod_v4.literal("notifications/prompts/list_changed"),
		params: NotificationsParamsSchema$1.optional()
	});
	const TextContentSchema$1 = zod_v4.object({
		type: zod_v4.literal("text"),
		text: zod_v4.string(),
		annotations: AnnotationsSchema$1.optional(),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	const ImageContentSchema$1 = zod_v4.object({
		type: zod_v4.literal("image"),
		data: Base64Schema,
		mimeType: zod_v4.string(),
		annotations: AnnotationsSchema$1.optional(),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	const AudioContentSchema$1 = zod_v4.object({
		type: zod_v4.literal("audio"),
		data: Base64Schema,
		mimeType: zod_v4.string(),
		annotations: AnnotationsSchema$1.optional(),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	const ToolUseContentSchema$1 = zod_v4.object({
		type: zod_v4.literal("tool_use"),
		name: zod_v4.string(),
		id: zod_v4.string(),
		input: zod_v4.record(zod_v4.string(), zod_v4.unknown()),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	const EmbeddedResourceSchema$1 = zod_v4.object({
		type: zod_v4.literal("resource"),
		resource: zod_v4.union([TextResourceContentsSchema$1, BlobResourceContentsSchema$1]),
		annotations: AnnotationsSchema$1.optional(),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	const ResourceLinkSchema$1 = ResourceSchema$1.extend({ type: zod_v4.literal("resource_link") });
	const ContentBlockSchema$1 = zod_v4.union([
		TextContentSchema$1,
		ImageContentSchema$1,
		AudioContentSchema$1,
		ResourceLinkSchema$1,
		EmbeddedResourceSchema$1
	]);
	const PromptMessageSchema$1 = zod_v4.object({
		role: RoleSchema$1,
		content: ContentBlockSchema$1
	});
	const ToolAnnotationsSchema$1 = zod_v4.object({
		title: zod_v4.string().optional(),
		readOnlyHint: zod_v4.boolean().optional(),
		destructiveHint: zod_v4.boolean().optional(),
		idempotentHint: zod_v4.boolean().optional(),
		openWorldHint: zod_v4.boolean().optional()
	});
	const ToolListChangedNotificationSchema$1 = NotificationSchema$1.extend({
		method: zod_v4.literal("notifications/tools/list_changed"),
		params: NotificationsParamsSchema$1.optional()
	});
	const ModelHintSchema$1 = zod_v4.object({ name: zod_v4.string().optional() });
	const ModelPreferencesSchema$1 = zod_v4.object({
		hints: zod_v4.array(ModelHintSchema$1).optional(),
		costPriority: zod_v4.number().min(0).max(1).optional(),
		speedPriority: zod_v4.number().min(0).max(1).optional(),
		intelligencePriority: zod_v4.number().min(0).max(1).optional()
	});
	const ToolChoiceSchema$1 = zod_v4.object({ mode: zod_v4.enum([
		"auto",
		"required",
		"none"
	]).optional() });
	const BooleanSchemaSchema$1 = zod_v4.object({
		type: zod_v4.literal("boolean"),
		title: zod_v4.string().optional(),
		description: zod_v4.string().optional(),
		default: zod_v4.boolean().optional()
	});
	const StringSchemaSchema$1 = zod_v4.object({
		type: zod_v4.literal("string"),
		title: zod_v4.string().optional(),
		description: zod_v4.string().optional(),
		minLength: zod_v4.number().optional(),
		maxLength: zod_v4.number().optional(),
		format: zod_v4.enum([
			"email",
			"uri",
			"date",
			"date-time"
		]).optional(),
		default: zod_v4.string().optional()
	});
	const NumberSchemaSchema$1 = zod_v4.object({
		type: zod_v4.enum(["number", "integer"]),
		title: zod_v4.string().optional(),
		description: zod_v4.string().optional(),
		minimum: zod_v4.number().optional(),
		maximum: zod_v4.number().optional(),
		default: zod_v4.number().optional()
	});
	const UntitledSingleSelectEnumSchemaSchema$1 = zod_v4.object({
		type: zod_v4.literal("string"),
		title: zod_v4.string().optional(),
		description: zod_v4.string().optional(),
		enum: zod_v4.array(zod_v4.string()),
		default: zod_v4.string().optional()
	});
	const TitledSingleSelectEnumSchemaSchema$1 = zod_v4.object({
		type: zod_v4.literal("string"),
		title: zod_v4.string().optional(),
		description: zod_v4.string().optional(),
		oneOf: zod_v4.array(zod_v4.object({
			const: zod_v4.string(),
			title: zod_v4.string()
		})),
		default: zod_v4.string().optional()
	});
	const LegacyTitledEnumSchemaSchema$1 = zod_v4.object({
		type: zod_v4.literal("string"),
		title: zod_v4.string().optional(),
		description: zod_v4.string().optional(),
		enum: zod_v4.array(zod_v4.string()),
		enumNames: zod_v4.array(zod_v4.string()).optional(),
		default: zod_v4.string().optional()
	});
	const SingleSelectEnumSchemaSchema$1 = zod_v4.union([UntitledSingleSelectEnumSchemaSchema$1, TitledSingleSelectEnumSchemaSchema$1]);
	const UntitledMultiSelectEnumSchemaSchema$1 = zod_v4.object({
		type: zod_v4.literal("array"),
		title: zod_v4.string().optional(),
		description: zod_v4.string().optional(),
		minItems: zod_v4.number().optional(),
		maxItems: zod_v4.number().optional(),
		items: zod_v4.object({
			type: zod_v4.literal("string"),
			enum: zod_v4.array(zod_v4.string())
		}),
		default: zod_v4.array(zod_v4.string()).optional()
	});
	const TitledMultiSelectEnumSchemaSchema$1 = zod_v4.object({
		type: zod_v4.literal("array"),
		title: zod_v4.string().optional(),
		description: zod_v4.string().optional(),
		minItems: zod_v4.number().optional(),
		maxItems: zod_v4.number().optional(),
		items: zod_v4.object({ anyOf: zod_v4.array(zod_v4.object({
			const: zod_v4.string(),
			title: zod_v4.string()
		})) }),
		default: zod_v4.array(zod_v4.string()).optional()
	});
	const MultiSelectEnumSchemaSchema$1 = zod_v4.union([UntitledMultiSelectEnumSchemaSchema$1, TitledMultiSelectEnumSchemaSchema$1]);
	const EnumSchemaSchema$1 = zod_v4.union([
		LegacyTitledEnumSchemaSchema$1,
		SingleSelectEnumSchemaSchema$1,
		MultiSelectEnumSchemaSchema$1
	]);
	const PrimitiveSchemaDefinitionSchema$1 = zod_v4.union([
		EnumSchemaSchema$1,
		BooleanSchemaSchema$1,
		StringSchemaSchema$1,
		NumberSchemaSchema$1
	]);
	const ElicitRequestFormParamsSchema$1 = TaskAugmentedRequestParamsSchema$1.extend({
		mode: zod_v4.literal("form").optional(),
		message: zod_v4.string(),
		requestedSchema: zod_v4.object({
			type: zod_v4.literal("object"),
			properties: zod_v4.record(zod_v4.string(), PrimitiveSchemaDefinitionSchema$1),
			required: zod_v4.array(zod_v4.string()).optional()
		}).catchall(zod_v4.unknown())
	});
	const ResourceTemplateReferenceSchema$1 = zod_v4.object({
		type: zod_v4.literal("ref/resource"),
		uri: zod_v4.string()
	});
	const PromptReferenceSchema$1 = zod_v4.object({
		type: zod_v4.literal("ref/prompt"),
		name: zod_v4.string()
	});
	const RootSchema$1 = zod_v4.object({
		uri: zod_v4.string().startsWith("file://"),
		name: zod_v4.string().optional(),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	const sharedClientCapabilityShape = ClientCapabilitiesSchema$1.shape;
	const ClientCapabilities2026Schema = zod_v4.object({
		experimental: sharedClientCapabilityShape.experimental,
		sampling: sharedClientCapabilityShape.sampling,
		elicitation: sharedClientCapabilityShape.elicitation,
		roots: sharedClientCapabilityShape.roots,
		extensions: sharedClientCapabilityShape.extensions
	});
	const sharedServerCapabilityShape = ServerCapabilitiesSchema$1.shape;
	const ServerCapabilities2026Schema = zod_v4.object({
		experimental: sharedServerCapabilityShape.experimental,
		logging: sharedServerCapabilityShape.logging,
		completions: sharedServerCapabilityShape.completions,
		prompts: sharedServerCapabilityShape.prompts,
		resources: sharedServerCapabilityShape.resources,
		tools: sharedServerCapabilityShape.tools,
		extensions: sharedServerCapabilityShape.extensions
	});
	/**
	* The per-request `_meta` envelope carried by every request under protocol revision
	* 2026-07-28: the protocol version governing the request, the client implementation
	* info, and the client's capabilities — declared per request rather than once at
	* initialization — plus the optional log-level opt-in.
	*
	* This schema models the complete envelope on its own (loose: foreign keys
	* pass through - the lift extracts exactly the reserved keys, so enforcement
	* never sees extension material). Requiredness is enforced per request at
	* dispatch time by the 2026-era codec's `checkInboundEnvelope` step.
	*/
	const RequestMetaEnvelopeSchema = zod_v4.looseObject({
		progressToken: ProgressTokenSchema$1.optional(),
		[_modelcontextprotocol_core_internal.PROTOCOL_VERSION_META_KEY]: zod_v4.string(),
		[_modelcontextprotocol_core_internal.CLIENT_INFO_META_KEY]: ImplementationSchema$1.optional(),
		[_modelcontextprotocol_core_internal.CLIENT_CAPABILITIES_META_KEY]: ClientCapabilities2026Schema,
		[_modelcontextprotocol_core_internal.LOG_LEVEL_META_KEY]: LoggingLevelSchema$1.optional()
	});
	/** 2026-era Tool: anchor-exact — no `execution` (deleted vocabulary). */
	const ToolSchema$1 = zod_v4.object({
		...BaseMetadataSchema$1.shape,
		...IconsSchema$1.shape,
		description: zod_v4.string().optional(),
		inputSchema: zod_v4.looseObject({
			$schema: zod_v4.string().optional(),
			type: zod_v4.literal("object")
		}),
		outputSchema: zod_v4.looseObject({ $schema: zod_v4.string().optional() }).optional(),
		annotations: ToolAnnotationsSchema$1.optional(),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	/** 2026-era ToolResultContent (anchor-exact: `structuredContent?: unknown`). */
	const ToolResultContentSchema$1 = zod_v4.object({
		type: zod_v4.literal("tool_result"),
		toolUseId: zod_v4.string(),
		content: zod_v4.array(ContentBlockSchema$1),
		structuredContent: zod_v4.unknown().optional(),
		isError: zod_v4.boolean().optional(),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	/** 2026-era sampling content union (composes the forked tool-result shape). */
	const SamplingMessageContentBlockSchema$1 = zod_v4.union([
		TextContentSchema$1,
		ImageContentSchema$1,
		AudioContentSchema$1,
		ToolUseContentSchema$1,
		ToolResultContentSchema$1
	]);
	/** 2026-era SamplingMessage (anchor-exact: single block or array). */
	const SamplingMessageSchema$1 = zod_v4.object({
		role: RoleSchema$1,
		content: zod_v4.union([SamplingMessageContentBlockSchema$1, zod_v4.array(SamplingMessageContentBlockSchema$1)]),
		_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
	});
	/** Open union per the anchor: 'complete' | 'input_required' | string. */
	const ResultTypeSchema = zod_v4.string();
	/**
	* Result `_meta` (anchor `ResultMetaObject`, added by spec PR #3002):
	* loose, with the serverInfo key typed when present; the outbound stamp
	* is the encode contract's `stampServerInfoMeta` step.
	*/
	const ResultMetaSchema = zod_v4.looseObject({ [_modelcontextprotocol_core_internal.SERVER_INFO_META_KEY]: ImplementationSchema$1.optional().catch(void 0) });
	const wireMeta = ResultMetaSchema.optional();
	function wireResult(shape) {
		return zod_v4.looseObject({
			_meta: wireMeta,
			resultType: ResultTypeSchema.default("complete"),
			...shape
		});
	}
	const ResultSchema$1 = wireResult({});
	const PaginatedResultSchema$1 = wireResult({ nextCursor: CursorSchema$1.optional() });
	const CallToolResultSchema$1 = wireResult({
		content: zod_v4.array(ContentBlockSchema$1),
		structuredContent: zod_v4.unknown().optional(),
		isError: zod_v4.boolean().optional()
	});
	const ListToolsResultSchema$1 = wireResult({
		ttlMs: zod_v4.number().int().min(0),
		cacheScope: zod_v4.enum(["public", "private"]),
		tools: zod_v4.array(ToolSchema$1),
		nextCursor: CursorSchema$1.optional()
	});
	const ListPromptsResultSchema$1 = wireResult({
		ttlMs: zod_v4.number().int().min(0),
		cacheScope: zod_v4.enum(["public", "private"]),
		prompts: zod_v4.array(PromptSchema$1),
		nextCursor: CursorSchema$1.optional()
	});
	const GetPromptResultSchema$1 = wireResult({
		description: zod_v4.string().optional(),
		messages: zod_v4.array(PromptMessageSchema$1)
	});
	const ListResourcesResultSchema$1 = wireResult({
		ttlMs: zod_v4.number().int().min(0),
		cacheScope: zod_v4.enum(["public", "private"]),
		resources: zod_v4.array(ResourceSchema$1),
		nextCursor: CursorSchema$1.optional()
	});
	const ListResourceTemplatesResultSchema$1 = wireResult({
		ttlMs: zod_v4.number().int().min(0),
		cacheScope: zod_v4.enum(["public", "private"]),
		resourceTemplates: zod_v4.array(ResourceTemplateSchema$1),
		nextCursor: CursorSchema$1.optional()
	});
	const ReadResourceResultSchema$1 = wireResult({
		ttlMs: zod_v4.number().int().min(0),
		cacheScope: zod_v4.enum(["public", "private"]),
		contents: zod_v4.array(zod_v4.union([TextResourceContentsSchema$1, BlobResourceContentsSchema$1]))
	});
	const CompleteResultSchema$1 = wireResult({ completion: zod_v4.object({
		values: zod_v4.array(zod_v4.string()).max(100),
		total: zod_v4.number().int().optional(),
		hasMore: zod_v4.boolean().optional()
	}).loose() });
	/** CacheableResult (SEP-2549): ttlMs and cacheScope REQUIRED per the anchor. */
	const CacheableResultSchema = wireResult({
		ttlMs: zod_v4.number().int().min(0),
		cacheScope: zod_v4.enum(["public", "private"])
	});
	const DiscoverResultSchema$1 = wireResult({
		ttlMs: zod_v4.number().int().min(0).catch(0),
		cacheScope: zod_v4.enum(["public", "private"]).catch("private"),
		supportedVersions: zod_v4.array(zod_v4.string()),
		capabilities: ServerCapabilities2026Schema,
		instructions: zod_v4.string().optional()
	});
	/** 2026-era CreateMessageRequestParams (anchor-exact: forked SamplingMessage/Tool, no task augmentation). */
	const CreateMessageRequestParamsSchema$1 = zod_v4.object({
		messages: zod_v4.array(SamplingMessageSchema$1),
		modelPreferences: ModelPreferencesSchema$1.optional(),
		systemPrompt: zod_v4.string().optional(),
		includeContext: zod_v4.enum([
			"none",
			"thisServer",
			"allServers"
		]).optional(),
		temperature: zod_v4.number().optional(),
		maxTokens: zod_v4.number().int(),
		stopSequences: zod_v4.array(zod_v4.string()).optional(),
		metadata: JSONObjectSchema$1.optional(),
		tools: zod_v4.array(ToolSchema$1).optional(),
		toolChoice: ToolChoiceSchema$1.optional()
	});
	/** 2026-era embedded sampling request (de-JSON-RPC'd). */
	const CreateMessageRequestSchema$1 = zod_v4.object({
		method: zod_v4.literal("sampling/createMessage"),
		params: CreateMessageRequestParamsSchema$1
	});
	/**
	* 2026-era embedded roots listing request (de-JSON-RPC'd). Embedded input
	* requests do NOT carry the per-request `_meta` envelope on this revision —
	* the anchor declares a bare optional `_meta` on `params`.
	*/
	const ListRootsRequestSchema$1 = zod_v4.object({
		method: zod_v4.literal("roots/list"),
		params: zod_v4.object({ _meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional() }).optional()
	});
	/** 2026-era embedded sampling response (anchor-exact: extends the forked SamplingMessage). */
	const CreateMessageResultSchema$1 = zod_v4.object({
		...SamplingMessageSchema$1.shape,
		model: zod_v4.string(),
		stopReason: zod_v4.string().optional()
	});
	/** 2026-era embedded roots listing response (anchor-exact: bare `roots` array). */
	const ListRootsResultSchema$1 = zod_v4.object({ roots: zod_v4.array(RootSchema$1) });
	/** 2026-era embedded elicitation response (anchor-exact: bare result, restricted content value types). */
	const ElicitResultSchema$1 = zod_v4.object({
		action: zod_v4.enum([
			"accept",
			"decline",
			"cancel"
		]),
		content: zod_v4.record(zod_v4.string(), zod_v4.union([
			zod_v4.string(),
			zod_v4.number(),
			zod_v4.boolean(),
			zod_v4.array(zod_v4.string())
		])).optional()
	});
	/**
	* 2026-era URL-mode elicitation params (anchor-exact fork): the draft removed
	* `elicitationId` (and the `notifications/elicitation/complete` channel it
	* keyed) — the shared schema keeps the field because it is required on the
	* frozen 2025-11-25 revision.
	*/
	const ElicitRequestURLParamsSchema$1 = zod_v4.object({
		mode: zod_v4.literal("url"),
		message: zod_v4.string(),
		url: zod_v4.string().url()
	});
	/** 2026-era elicitation params (form mode is revision-identical; URL mode is the fork above). */
	const ElicitRequestParamsSchema$1 = zod_v4.union([ElicitRequestFormParamsSchema$1, ElicitRequestURLParamsSchema$1]);
	/** 2026-era embedded elicitation request (de-JSON-RPC'd; see the URL-mode fork above). */
	const ElicitRequestSchema$1 = zod_v4.object({
		method: zod_v4.literal("elicitation/create"),
		params: ElicitRequestParamsSchema$1
	});
	/** A single embedded input request (one of the three demoted server→client requests). */
	const InputRequestSchema = zod_v4.union([
		CreateMessageRequestSchema$1,
		ListRootsRequestSchema$1,
		ElicitRequestSchema$1
	]);
	/** A single embedded input response — the BARE result union (never a `{method, result}` wrapper). */
	const InputResponseSchema = zod_v4.union([
		CreateMessageResultSchema$1,
		ListRootsResultSchema$1,
		ElicitResultSchema$1
	]);
	/** Map of embedded input requests, keyed by server-assigned identifiers. */
	const InputRequestsSchema = zod_v4.record(zod_v4.string(), InputRequestSchema);
	/** Map of embedded input responses, keyed by the corresponding request identifiers. */
	const InputResponsesSchema = zod_v4.record(zod_v4.string(), InputResponseSchema);
	/**
	* The wire InputRequiredResult: `resultType: 'input_required'` plus at least
	* one of `inputRequests` / `requestState` (the at-least-one rule is enforced
	* at the server seam, not by this parse shape).
	*/
	const InputRequiredResultSchema = wireResult({
		inputRequests: InputRequestsSchema.optional(),
		requestState: zod_v4.string().optional()
	});
	/** The retry-channel members carried by client-initiated requests on this revision. */
	const retryParamsShape = {
		inputResponses: InputResponsesSchema.optional(),
		requestState: zod_v4.string().optional()
	};
	/** Anchor InputResponseRequestParams: the retry channel on top of the required request `_meta` envelope. */
	const InputResponseRequestParamsSchema = zod_v4.object({
		_meta: RequestMetaEnvelopeSchema,
		...retryParamsShape
	});
	/** Post-lift request `_meta` (progressToken + extension keys; loose). */
	const DispatchRequestMetaSchema = zod_v4.looseObject({ progressToken: ProgressTokenSchema$1.optional() });
	function wireRequest(method, paramsShape) {
		return zod_v4.object({
			method: zod_v4.literal(method),
			params: zod_v4.object({
				_meta: RequestMetaEnvelopeSchema,
				...paramsShape
			})
		});
	}
	function dispatchRequest(method, paramsShape) {
		return zod_v4.object({
			method: zod_v4.literal(method),
			params: zod_v4.object({
				_meta: DispatchRequestMetaSchema.optional(),
				...paramsShape
			}).optional()
		});
	}
	const callToolParamsShape = {
		name: zod_v4.string(),
		arguments: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional(),
		...retryParamsShape
	};
	const paginatedParamsShape = { cursor: CursorSchema$1.optional() };
	const CallToolRequestSchema$1 = wireRequest("tools/call", callToolParamsShape);
	const ListToolsRequestSchema$1 = wireRequest("tools/list", paginatedParamsShape);
	const ListPromptsRequestSchema$1 = wireRequest("prompts/list", paginatedParamsShape);
	const GetPromptRequestSchema$1 = wireRequest("prompts/get", {
		name: zod_v4.string(),
		arguments: zod_v4.record(zod_v4.string(), zod_v4.string()).optional(),
		...retryParamsShape
	});
	const ListResourcesRequestSchema$1 = wireRequest("resources/list", paginatedParamsShape);
	const ListResourceTemplatesRequestSchema$1 = wireRequest("resources/templates/list", paginatedParamsShape);
	const ReadResourceRequestSchema$1 = wireRequest("resources/read", {
		uri: zod_v4.string(),
		...retryParamsShape
	});
	const completeParamsShape = {
		ref: zod_v4.union([PromptReferenceSchema$1, ResourceTemplateReferenceSchema$1]),
		argument: zod_v4.object({
			name: zod_v4.string(),
			value: zod_v4.string()
		}),
		context: zod_v4.object({ arguments: zod_v4.record(zod_v4.string(), zod_v4.string()).optional() }).optional()
	};
	const CompleteRequestSchema$1 = wireRequest("completion/complete", completeParamsShape);
	const DiscoverRequestSchema$1 = wireRequest("server/discover", {});
	/** Anchor SubscriptionFilter (2026-only). */
	const SubscriptionFilterSchema$1 = zod_v4.object({
		toolsListChanged: zod_v4.boolean().optional(),
		promptsListChanged: zod_v4.boolean().optional(),
		resourcesListChanged: zod_v4.boolean().optional(),
		resourceSubscriptions: zod_v4.array(zod_v4.string()).optional()
	});
	const subscriptionsListenParamsShape = { notifications: SubscriptionFilterSchema$1 };
	const SubscriptionsListenRequestSchema$1 = wireRequest("subscriptions/listen", subscriptionsListenParamsShape);
	/**
	* Anchor SubscriptionsListenResultMetaObject — required subscriptionId stamp on
	* the graceful-close result. Extends `ResultMetaObject` since spec PR
	* #3002 (composed, so the serverInfo key and its leniency stay single-sourced).
	*/
	const SubscriptionsListenResultMetaSchema$1 = ResultMetaSchema.extend({ "io.modelcontextprotocol/subscriptionId": RequestIdSchema$1 });
	/**
	* Anchor SubscriptionsListenResult (2026-only). The empty `subscriptions/listen`
	* response signalling that the subscription has ended gracefully (server
	* shutdown). An abrupt transport close carries no response — the client treats
	* stream-close-without-result as a disconnect.
	*/
	const SubscriptionsListenResultSchema$1 = zod_v4.looseObject({
		_meta: SubscriptionsListenResultMetaSchema$1,
		resultType: ResultTypeSchema.default("complete")
	});
	/** Dispatch (post-lift) request schemas, keyed by method — registry-internal. */
	const dispatchRequestSchemas = {
		"tools/call": dispatchRequest("tools/call", callToolParamsShape),
		"tools/list": dispatchRequest("tools/list", paginatedParamsShape),
		"prompts/get": dispatchRequest("prompts/get", {
			name: zod_v4.string(),
			arguments: zod_v4.record(zod_v4.string(), zod_v4.string()).optional()
		}),
		"prompts/list": dispatchRequest("prompts/list", paginatedParamsShape),
		"resources/list": dispatchRequest("resources/list", paginatedParamsShape),
		"resources/templates/list": dispatchRequest("resources/templates/list", paginatedParamsShape),
		"resources/read": dispatchRequest("resources/read", { uri: zod_v4.string() }),
		"completion/complete": dispatchRequest("completion/complete", completeParamsShape),
		"server/discover": dispatchRequest("server/discover", {}),
		"subscriptions/listen": dispatchRequest("subscriptions/listen", subscriptionsListenParamsShape)
	};
	/** Dispatch (post-lift) result schemas, keyed by method — what the funnel
	* validates AFTER `decodeResult` consumed `resultType`. */
	function liftedResult(shape) {
		return zod_v4.looseObject({
			_meta: wireMeta,
			...shape
		});
	}
	const dispatchResultSchemas = {
		"tools/call": liftedResult({
			content: zod_v4.array(ContentBlockSchema$1),
			structuredContent: zod_v4.unknown().optional(),
			isError: zod_v4.boolean().optional()
		}),
		"tools/list": liftedResult({
			ttlMs: zod_v4.number().int().min(0),
			cacheScope: zod_v4.enum(["public", "private"]),
			tools: zod_v4.array(ToolSchema$1),
			nextCursor: CursorSchema$1.optional()
		}),
		"prompts/get": liftedResult({
			description: zod_v4.string().optional(),
			messages: zod_v4.array(PromptMessageSchema$1)
		}),
		"prompts/list": liftedResult({
			ttlMs: zod_v4.number().int().min(0),
			cacheScope: zod_v4.enum(["public", "private"]),
			prompts: zod_v4.array(PromptSchema$1),
			nextCursor: CursorSchema$1.optional()
		}),
		"resources/list": liftedResult({
			ttlMs: zod_v4.number().int().min(0),
			cacheScope: zod_v4.enum(["public", "private"]),
			resources: zod_v4.array(ResourceSchema$1),
			nextCursor: CursorSchema$1.optional()
		}),
		"resources/templates/list": liftedResult({
			ttlMs: zod_v4.number().int().min(0),
			cacheScope: zod_v4.enum(["public", "private"]),
			resourceTemplates: zod_v4.array(ResourceTemplateSchema$1),
			nextCursor: CursorSchema$1.optional()
		}),
		"resources/read": liftedResult({
			ttlMs: zod_v4.number().int().min(0),
			cacheScope: zod_v4.enum(["public", "private"]),
			contents: zod_v4.array(zod_v4.union([TextResourceContentsSchema$1, BlobResourceContentsSchema$1]))
		}),
		"completion/complete": liftedResult({ completion: zod_v4.object({
			values: zod_v4.array(zod_v4.string()).max(100),
			total: zod_v4.number().int().optional(),
			hasMore: zod_v4.boolean().optional()
		}).loose() }),
		"server/discover": liftedResult({
			ttlMs: zod_v4.number().int().min(0).catch(0),
			cacheScope: zod_v4.enum(["public", "private"]).catch("private"),
			supportedVersions: zod_v4.array(zod_v4.string()),
			capabilities: ServerCapabilities2026Schema,
			instructions: zod_v4.string().optional()
		}),
		"subscriptions/listen": liftedResult({})
	};
	/**
	* Notification `_meta` (anchor `NotificationMetaObject`): loose, with the
	* subscriptions/listen demux key typed when present. Only the anchor-exact
	* SHAPE is modeled here — listen delivery itself (filter gating, demux,
	* teardown) is #14 scope and not implemented by this module.
	*/
	const NotificationMetaSchema = zod_v4.looseObject({ "io.modelcontextprotocol/subscriptionId": RequestIdSchema$1.optional() });
	/** Anchor SubscriptionsAcknowledgedNotification (2026-only). */
	const SubscriptionsAcknowledgedNotificationSchema$1 = zod_v4.object({
		method: zod_v4.literal("notifications/subscriptions/acknowledged"),
		params: zod_v4.object({
			_meta: NotificationMetaSchema.optional(),
			notifications: SubscriptionFilterSchema$1
		})
	});
	/**
	* 2026-era `notifications/cancelled` params (anchor-exact fork): `requestId`
	* is REQUIRED on this revision — the shared schema keeps it optional because
	* the frozen 2025-11-25 shape declares it optional (task cancellation goes
	* through `tasks/cancel` there). Requiredness is bare because no 2025-era
	* traffic touches this module.
	*/
	const CancelledNotificationParamsSchema$1 = zod_v4.object({
		_meta: NotificationMetaSchema.optional(),
		requestId: RequestIdSchema$1,
		reason: zod_v4.string().optional()
	});
	/** 2026-era `notifications/cancelled` (see the params fork above). */
	const CancelledNotificationSchema$1 = zod_v4.object({
		method: zod_v4.literal("notifications/cancelled"),
		params: CancelledNotificationParamsSchema$1
	});
	const notificationSchemas2026 = {
		"notifications/cancelled": CancelledNotificationSchema$1,
		"notifications/progress": ProgressNotificationSchema$1,
		"notifications/message": LoggingMessageNotificationSchema$1,
		"notifications/resources/updated": ResourceUpdatedNotificationSchema$1,
		"notifications/resources/list_changed": ResourceListChangedNotificationSchema$1,
		"notifications/tools/list_changed": ToolListChangedNotificationSchema$1,
		"notifications/prompts/list_changed": PromptListChangedNotificationSchema$1,
		"notifications/subscriptions/acknowledged": SubscriptionsAcknowledgedNotificationSchema$1
	};
	const wireResultResponse = (result) => zod_v4.object({
		jsonrpc: zod_v4.literal("2.0"),
		id: zod_v4.union([zod_v4.string(), zod_v4.number().int()]),
		result
	}).strict();
	return {
		JSONValueSchema: JSONValueSchema$1,
		JSONObjectSchema: JSONObjectSchema$1,
		ProgressTokenSchema: ProgressTokenSchema$1,
		CursorSchema: CursorSchema$1,
		RequestIdSchema: RequestIdSchema$1,
		RoleSchema: RoleSchema$1,
		LoggingLevelSchema: LoggingLevelSchema$1,
		TaskMetadataSchema: TaskMetadataSchema$1,
		RelatedTaskMetadataSchema: RelatedTaskMetadataSchema$1,
		RequestMetaSchema: RequestMetaSchema$1,
		BaseRequestParamsSchema: BaseRequestParamsSchema$1,
		TaskAugmentedRequestParamsSchema: TaskAugmentedRequestParamsSchema$1,
		NotificationsParamsSchema: NotificationsParamsSchema$1,
		NotificationSchema: NotificationSchema$1,
		IconSchema: IconSchema$1,
		IconsSchema: IconsSchema$1,
		BaseMetadataSchema: BaseMetadataSchema$1,
		ImplementationSchema: ImplementationSchema$1,
		ClientTasksCapabilitySchema: ClientTasksCapabilitySchema$1,
		ServerTasksCapabilitySchema: ServerTasksCapabilitySchema$1,
		ClientCapabilitiesSchema: ClientCapabilitiesSchema$1,
		ServerCapabilitiesSchema: ServerCapabilitiesSchema$1,
		ProgressSchema: ProgressSchema$1,
		ProgressNotificationParamsSchema: ProgressNotificationParamsSchema$1,
		ProgressNotificationSchema: ProgressNotificationSchema$1,
		LoggingMessageNotificationParamsSchema: LoggingMessageNotificationParamsSchema$1,
		LoggingMessageNotificationSchema: LoggingMessageNotificationSchema$1,
		ResourceContentsSchema: ResourceContentsSchema$1,
		TextResourceContentsSchema: TextResourceContentsSchema$1,
		BlobResourceContentsSchema: BlobResourceContentsSchema$1,
		AnnotationsSchema: AnnotationsSchema$1,
		ResourceSchema: ResourceSchema$1,
		ResourceTemplateSchema: ResourceTemplateSchema$1,
		ResourceListChangedNotificationSchema: ResourceListChangedNotificationSchema$1,
		ResourceUpdatedNotificationParamsSchema: ResourceUpdatedNotificationParamsSchema$1,
		ResourceUpdatedNotificationSchema: ResourceUpdatedNotificationSchema$1,
		PromptArgumentSchema: PromptArgumentSchema$1,
		PromptSchema: PromptSchema$1,
		PromptListChangedNotificationSchema: PromptListChangedNotificationSchema$1,
		TextContentSchema: TextContentSchema$1,
		ImageContentSchema: ImageContentSchema$1,
		AudioContentSchema: AudioContentSchema$1,
		ToolUseContentSchema: ToolUseContentSchema$1,
		EmbeddedResourceSchema: EmbeddedResourceSchema$1,
		ResourceLinkSchema: ResourceLinkSchema$1,
		ContentBlockSchema: ContentBlockSchema$1,
		PromptMessageSchema: PromptMessageSchema$1,
		ToolAnnotationsSchema: ToolAnnotationsSchema$1,
		ToolListChangedNotificationSchema: ToolListChangedNotificationSchema$1,
		ModelHintSchema: ModelHintSchema$1,
		ModelPreferencesSchema: ModelPreferencesSchema$1,
		ToolChoiceSchema: ToolChoiceSchema$1,
		BooleanSchemaSchema: BooleanSchemaSchema$1,
		StringSchemaSchema: StringSchemaSchema$1,
		NumberSchemaSchema: NumberSchemaSchema$1,
		UntitledSingleSelectEnumSchemaSchema: UntitledSingleSelectEnumSchemaSchema$1,
		TitledSingleSelectEnumSchemaSchema: TitledSingleSelectEnumSchemaSchema$1,
		LegacyTitledEnumSchemaSchema: LegacyTitledEnumSchemaSchema$1,
		SingleSelectEnumSchemaSchema: SingleSelectEnumSchemaSchema$1,
		UntitledMultiSelectEnumSchemaSchema: UntitledMultiSelectEnumSchemaSchema$1,
		TitledMultiSelectEnumSchemaSchema: TitledMultiSelectEnumSchemaSchema$1,
		MultiSelectEnumSchemaSchema: MultiSelectEnumSchemaSchema$1,
		EnumSchemaSchema: EnumSchemaSchema$1,
		PrimitiveSchemaDefinitionSchema: PrimitiveSchemaDefinitionSchema$1,
		ElicitRequestFormParamsSchema: ElicitRequestFormParamsSchema$1,
		ResourceTemplateReferenceSchema: ResourceTemplateReferenceSchema$1,
		PromptReferenceSchema: PromptReferenceSchema$1,
		RootSchema: RootSchema$1,
		ClientCapabilities2026Schema,
		ServerCapabilities2026Schema,
		RequestMetaEnvelopeSchema,
		ToolSchema: ToolSchema$1,
		ToolResultContentSchema: ToolResultContentSchema$1,
		SamplingMessageContentBlockSchema: SamplingMessageContentBlockSchema$1,
		SamplingMessageSchema: SamplingMessageSchema$1,
		ResultTypeSchema,
		ResultMetaSchema,
		ResultSchema: ResultSchema$1,
		PaginatedResultSchema: PaginatedResultSchema$1,
		CallToolResultSchema: CallToolResultSchema$1,
		ListToolsResultSchema: ListToolsResultSchema$1,
		ListPromptsResultSchema: ListPromptsResultSchema$1,
		GetPromptResultSchema: GetPromptResultSchema$1,
		ListResourcesResultSchema: ListResourcesResultSchema$1,
		ListResourceTemplatesResultSchema: ListResourceTemplatesResultSchema$1,
		ReadResourceResultSchema: ReadResourceResultSchema$1,
		CompleteResultSchema: CompleteResultSchema$1,
		CacheableResultSchema,
		DiscoverResultSchema: DiscoverResultSchema$1,
		CreateMessageRequestParamsSchema: CreateMessageRequestParamsSchema$1,
		CreateMessageRequestSchema: CreateMessageRequestSchema$1,
		ListRootsRequestSchema: ListRootsRequestSchema$1,
		CreateMessageResultSchema: CreateMessageResultSchema$1,
		ListRootsResultSchema: ListRootsResultSchema$1,
		ElicitResultSchema: ElicitResultSchema$1,
		ElicitRequestURLParamsSchema: ElicitRequestURLParamsSchema$1,
		ElicitRequestParamsSchema: ElicitRequestParamsSchema$1,
		ElicitRequestSchema: ElicitRequestSchema$1,
		InputRequestSchema,
		InputResponseSchema,
		InputRequestsSchema,
		InputResponsesSchema,
		InputRequiredResultSchema,
		InputResponseRequestParamsSchema,
		CallToolRequestSchema: CallToolRequestSchema$1,
		ListToolsRequestSchema: ListToolsRequestSchema$1,
		ListPromptsRequestSchema: ListPromptsRequestSchema$1,
		GetPromptRequestSchema: GetPromptRequestSchema$1,
		ListResourcesRequestSchema: ListResourcesRequestSchema$1,
		ListResourceTemplatesRequestSchema: ListResourceTemplatesRequestSchema$1,
		ReadResourceRequestSchema: ReadResourceRequestSchema$1,
		CompleteRequestSchema: CompleteRequestSchema$1,
		DiscoverRequestSchema: DiscoverRequestSchema$1,
		SubscriptionFilterSchema: SubscriptionFilterSchema$1,
		SubscriptionsListenRequestSchema: SubscriptionsListenRequestSchema$1,
		SubscriptionsListenResultMetaSchema: SubscriptionsListenResultMetaSchema$1,
		SubscriptionsListenResultSchema: SubscriptionsListenResultSchema$1,
		dispatchRequestSchemas,
		dispatchResultSchemas,
		NotificationMetaSchema,
		SubscriptionsAcknowledgedNotificationSchema: SubscriptionsAcknowledgedNotificationSchema$1,
		CancelledNotificationParamsSchema: CancelledNotificationParamsSchema$1,
		CancelledNotificationSchema: CancelledNotificationSchema$1,
		notificationSchemas2026,
		JSONRPCResultResponseSchema: wireResultResponse(ResultSchema$1),
		CallToolResultResponseSchema: wireResultResponse(zod_v4.union([CallToolResultSchema$1, InputRequiredResultSchema])),
		ListToolsResultResponseSchema: wireResultResponse(ListToolsResultSchema$1),
		ListPromptsResultResponseSchema: wireResultResponse(ListPromptsResultSchema$1),
		GetPromptResultResponseSchema: wireResultResponse(zod_v4.union([GetPromptResultSchema$1, InputRequiredResultSchema])),
		ListResourcesResultResponseSchema: wireResultResponse(ListResourcesResultSchema$1),
		ListResourceTemplatesResultResponseSchema: wireResultResponse(ListResourceTemplatesResultSchema$1),
		ReadResourceResultResponseSchema: wireResultResponse(zod_v4.union([ReadResourceResultSchema$1, InputRequiredResultSchema])),
		CompleteResultResponseSchema: wireResultResponse(CompleteResultSchema$1),
		DiscoverResultResponseSchema: wireResultResponse(DiscoverResultSchema$1),
		SubscriptionsListenResultResponseSchema: wireResultResponse(SubscriptionsListenResultSchema$1)
	};
}
let memo;
/**
* Builds the era wire-schema set on first call and returns the same object
* thereafter. Module evaluation stays construction-free so importing the
* era codec/registry costs nothing until the first validation actually
* needs a schema; the registry, the codec, and the eager `schemas.ts`
* shim all pull through this memo, so reference identity holds across
* every consumer.
*/
function buildSchemas2026() {
	return memo ??= build();
}

//#endregion
//#region ../core-internal/src/shared/resultCacheHints.ts
/**
* The operations whose results are cacheable on the 2026-07-28 revision (the
* `CacheableResult` extenders). This list is closed: no other operation's
* result ever receives cache fields from the SDK.
*/
const CACHEABLE_RESULT_METHODS = [
	"tools/list",
	"prompts/list",
	"resources/list",
	"resources/templates/list",
	"resources/read",
	"server/discover"
];
/** Whether the given method's result is cacheable on the 2026-07-28 revision. */
function isCacheableResultMethod(method) {
	return CACHEABLE_RESULT_METHODS.includes(method);
}
/**
* The symbol-keyed carrier for a configured cache hint on a result object.
* Symbol properties are invisible to JSON serialization, so the carrier can be
* attached era-blind: only the 2026-era encode seam consumes it.
*/
const RESULT_CACHE_HINT_FALLBACK = Symbol("modelcontextprotocol.resultCacheHintFallback");
/**
* Attaches a configured cache hint to a result as the encode-time fallback.
* Returns the result unchanged when there is nothing to attach. When a more
* specific hint is already attached, the two hints are combined per field
* (most-specific-author-wins for each of `ttlMs` and `cacheScope`): the
* per-registration hint attached by the feature layer keeps every field it
* sets, and the server-level per-operation hint only fills the fields the
* more specific hint leaves unset.
*/
function attachCacheHintFallback(result, hint) {
	if (hint === void 0) return result;
	const attached = result[RESULT_CACHE_HINT_FALLBACK];
	if (attached === void 0) return {
		...result,
		[RESULT_CACHE_HINT_FALLBACK]: hint
	};
	const merged = {};
	const ttlMs = attached.ttlMs ?? hint.ttlMs;
	if (ttlMs !== void 0) merged.ttlMs = ttlMs;
	const cacheScope = attached.cacheScope ?? hint.cacheScope;
	if (cacheScope !== void 0) merged.cacheScope = cacheScope;
	return {
		...result,
		[RESULT_CACHE_HINT_FALLBACK]: merged
	};
}
/** Reads the configured cache-hint fallback attached to a result, if any. */
function cacheHintFallbackOf(result) {
	return result[RESULT_CACHE_HINT_FALLBACK];
}
/**
* Whether a value is a valid `ttlMs`: a non-negative safe integer. Safe
* integers are required because the wire schemas validate `ttlMs` as an
* integer within `Number.MIN_SAFE_INTEGER`/`Number.MAX_SAFE_INTEGER`; a value
* outside that range is treated as invalid here so it falls through to the
* next author instead of being emitted and rejected downstream.
*/
function isValidCacheTtlMs(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
/** Whether a value is a valid `cacheScope`. */
function isValidCacheScope(value) {
	return value === "public" || value === "private";
}
/**
* Validates a configured cache hint at configuration time. Throws a
* `RangeError` naming the offending field, so misconfiguration fails at
* startup/registration rather than silently degrading at encode time.
*/
function assertValidCacheHint(hint, context) {
	if (hint.ttlMs !== void 0 && !isValidCacheTtlMs(hint.ttlMs)) throw new RangeError(`Invalid cache hint for ${context}: ttlMs must be a non-negative safe integer (got ${String(hint.ttlMs)})`);
	if (hint.cacheScope !== void 0 && !isValidCacheScope(hint.cacheScope)) throw new RangeError(`Invalid cache hint for ${context}: cacheScope must be 'public' or 'private' (got ${String(hint.cacheScope)})`);
}

//#endregion
//#region ../core-internal/src/types/enums.ts
/**
* Error codes for protocol errors that cross the wire as JSON-RPC error responses.
* These follow the JSON-RPC specification and MCP-specific extensions.
*/
let ProtocolErrorCode = /* @__PURE__ */ function(ProtocolErrorCode$1) {
	ProtocolErrorCode$1[ProtocolErrorCode$1["ParseError"] = -32700] = "ParseError";
	ProtocolErrorCode$1[ProtocolErrorCode$1["InvalidRequest"] = -32600] = "InvalidRequest";
	ProtocolErrorCode$1[ProtocolErrorCode$1["MethodNotFound"] = -32601] = "MethodNotFound";
	ProtocolErrorCode$1[ProtocolErrorCode$1["InvalidParams"] = -32602] = "InvalidParams";
	ProtocolErrorCode$1[ProtocolErrorCode$1["InternalError"] = -32603] = "InternalError";
	/**
	* Resource not found.
	*
	* Receive-tolerated only: the SDK never EMITS `-32002` — `resources/read`
	* misses answer `-32602` (Invalid Params) on every protocol revision per
	* the 2026-07-28 spec MUST, and a handler-thrown `-32002` is mapped to
	* `-32602` at the era encode seam. The member stays importable so clients
	* can recognise `-32002` from peers built on earlier SDK releases (the
	* spec's "clients SHOULD also accept `-32002`" backwards-compatibility
	* clause). Throw `ResourceNotFoundError` instead.
	*/
	ProtocolErrorCode$1[ProtocolErrorCode$1["ResourceNotFound"] = -32002] = "ResourceNotFound";
	/**
	* Processing the request requires a capability the client did not declare
	* in the request's `clientCapabilities` (protocol revision 2026-07-28).
	*/
	ProtocolErrorCode$1[ProtocolErrorCode$1["MissingRequiredClientCapability"] = -32021] = "MissingRequiredClientCapability";
	/**
	* The request's protocol version is unknown to the server or unsupported
	* by it (protocol revision 2026-07-28).
	*/
	ProtocolErrorCode$1[ProtocolErrorCode$1["UnsupportedProtocolVersion"] = -32022] = "UnsupportedProtocolVersion";
	ProtocolErrorCode$1[ProtocolErrorCode$1["UrlElicitationRequired"] = -32042] = "UrlElicitationRequired";
	return ProtocolErrorCode$1;
}({});

//#endregion
//#region ../core-internal/src/types/errors.ts
/**
* Protocol errors are JSON-RPC errors that cross the wire as error responses.
* They use numeric error codes from the {@linkcode ProtocolErrorCode} enum.
*
* `instanceof` on this class (and its subclasses) is brand-matched, so it works
* across separately bundled copies of the SDK — e.g. an error constructed by
* `@modelcontextprotocol/client` matches the class re-exported by
* `@modelcontextprotocol/server` in the same process.
*/
var ProtocolError = class ProtocolError extends Error {
	static {
		Object.defineProperty(this, "mcpBrand", { value: "mcp.ProtocolError" });
	}
	static [Symbol.hasInstance](value) {
		return brandedHasInstance(this, value);
	}
	/**
	* Brand-based type guard: equivalent to `value instanceof this`, as an
	* explicit static predicate (the axios/AWS-SDK `isInstance` style). Reads
	* the caller's own brand via `this`, so every branded subclass gets a
	* correctly-scoped guard by inheritance. Must be invoked on the class —
	* in callback position write `v => SdkError.isInstance(v)`, not
	* `.filter(SdkError.isInstance)` (detached calls throw rather than
	* silently matching nothing).
	*/
	static isInstance(value) {
		if (typeof this !== "function") throw new TypeError("isInstance must be called on the class (e.g. `SdkError.isInstance(value)`); for callbacks use `v => SdkError.isInstance(v)`");
		return brandedHasInstance(this, value);
	}
	constructor(code, message, data) {
		super(message);
		this.code = code;
		this.data = data;
		this.name = "ProtocolError";
		stampErrorBrands(this, new.target);
	}
	/**
	* Factory method to create the appropriate error type based on the error code and data
	*/
	static fromError(code, message, data) {
		if (code === ProtocolErrorCode.UrlElicitationRequired && data) {
			const errorData = data;
			if (errorData.elicitations) return new UrlElicitationRequiredError(errorData.elicitations, message);
		}
		if (code === ProtocolErrorCode.UnsupportedProtocolVersion && data) {
			const errorData = data;
			if (Array.isArray(errorData.supported) && typeof errorData.requested === "string") return new UnsupportedProtocolVersionError({
				supported: errorData.supported,
				requested: errorData.requested
			}, message);
		}
		if (code === ProtocolErrorCode.InvalidParams || code === ProtocolErrorCode.ResourceNotFound) {
			const errorData = data;
			if (typeof errorData?.uri === "string" && (code === ProtocolErrorCode.ResourceNotFound || Object.keys(errorData).length === 1)) return new ResourceNotFoundError(errorData.uri, message);
		}
		if (code === ProtocolErrorCode.MissingRequiredClientCapability && data) {
			const errorData = data;
			if (errorData.requiredCapabilities !== null && typeof errorData.requiredCapabilities === "object" && !Array.isArray(errorData.requiredCapabilities)) return new MissingRequiredClientCapabilityError({ requiredCapabilities: errorData.requiredCapabilities }, message);
		}
		return new ProtocolError(code, message, data);
	}
};
/**
* Error type for a `resources/read` miss: the requested resource does not
* exist. The wire code is `-32602` (Invalid Params) on every protocol
* revision — the spec MUST for revision 2026-07-28, and the value the v1.x
* SDK has always emitted on earlier revisions. The error data echoes the
* requested URI.
*
* Recognise this error by checking `error.data` is exactly `{ uri: string }`
* (a `-32602` whose data carries `uri` and nothing else is resource-not-found;
* any other `-32602` is an ordinary Invalid Params). For backwards compatibility, clients should also
* accept `-32002` as resource not found — earlier SDK builds emitted that
* code, and {@linkcode ProtocolError.fromError} reconstructs this class for
* either code **when `error.data` carries `uri`** (a bare `-32002` without
* `data.uri` stays a generic {@linkcode ProtocolError}). `instanceof` checks
* are brand-matched and work across separately bundled copies of the SDK.
*/
var ResourceNotFoundError = class extends ProtocolError {
	static {
		Object.defineProperty(this, "mcpBrand", { value: "mcp.ResourceNotFoundError" });
	}
	constructor(uri, message = `Resource not found: ${uri}`) {
		super(ProtocolErrorCode.InvalidParams, message, { uri });
	}
	/** The URI that was requested and not found. */
	get uri() {
		return this.data.uri;
	}
};
/**
* Specialized error type when a tool requires a URL mode elicitation.
* This makes it nicer for the client to handle since there is specific data to work with instead of just a code to check against.
*/
var UrlElicitationRequiredError = class extends ProtocolError {
	static {
		Object.defineProperty(this, "mcpBrand", { value: "mcp.UrlElicitationRequiredError" });
	}
	constructor(elicitations, message = `URL elicitation${elicitations.length > 1 ? "s" : ""} required`) {
		super(ProtocolErrorCode.UrlElicitationRequired, message, { elicitations });
	}
	get elicitations() {
		return this.data?.elicitations ?? [];
	}
};
/**
* Error type for the `-32022` UnsupportedProtocolVersion protocol error (protocol
* revision 2026-07-28): the request's protocol version is unknown to the server or
* unsupported by it.
*
* The error data lists the protocol versions the receiver supports (`supported`),
* so the sender can choose a mutually supported version and retry, and echoes the
* version that was requested (`requested`).
*/
var UnsupportedProtocolVersionError = class extends ProtocolError {
	static {
		Object.defineProperty(this, "mcpBrand", { value: "mcp.UnsupportedProtocolVersionError" });
	}
	constructor(data, message = `Unsupported protocol version: ${data.requested}`) {
		super(ProtocolErrorCode.UnsupportedProtocolVersion, message, data);
	}
	/**
	* Protocol versions the receiver supports.
	*/
	get supported() {
		return this.data.supported;
	}
	/**
	* The protocol version that was requested.
	*/
	get requested() {
		return this.data.requested;
	}
};
/**
* Error type for the `-32021` MissingRequiredClientCapability protocol error
* (protocol revision 2026-07-28): processing the request requires a capability
* the client did not declare in the request's `clientCapabilities`.
*
* The error data lists the missing capabilities (`requiredCapabilities`) in
* the `ClientCapabilities` shape, so the client can see exactly what it would
* have to declare for the request to be served. On HTTP, the response status
* is `400 Bad Request`.
*
* Recognize this error by its code and `data.requiredCapabilities`, or by
* `instanceof` — checks are brand-matched and work across separately bundled
* copies of the SDK.
*/
var MissingRequiredClientCapabilityError = class extends ProtocolError {
	static {
		Object.defineProperty(this, "mcpBrand", { value: "mcp.MissingRequiredClientCapabilityError" });
	}
	constructor(data, message = `Missing required client capabilities: ${Object.keys(data.requiredCapabilities).join(", ")}`) {
		super(ProtocolErrorCode.MissingRequiredClientCapability, message, data);
	}
	/**
	* The capabilities the server requires from the client to process the
	* request (only the missing capabilities are listed).
	*/
	get requiredCapabilities() {
		return this.data.requiredCapabilities;
	}
};

//#endregion
//#region ../core-internal/src/wire/rev2026-07-28/encodeContract.ts
/** The default cache policy when neither the handler nor configuration provides one. */
const DEFAULT_CACHE_TTL_MS = 0;
const DEFAULT_CACHE_SCOPE = "private";
/**
* Request methods whose spec result vocabulary goes beyond `'complete'` on the
* 2026-07-28 revision: their results may be `input_required` (multi
* round-trip requests), so a handler-provided `resultType` passes through the
* stamp untouched. `subscriptions/listen` is NOT in this set: it never emits
* a JSON-RPC result — termination is stream close (HTTP) or
* `notifications/cancelled` (stdio) per the spec.
*/
const EXTENDED_RESULT_TYPE_METHODS = [
	"tools/call",
	"prompts/get",
	"resources/read"
];
/**
* Step 1 of the encode contract: ensure the outbound result carries the
* required `resultType` discriminator.
*
* - No handler-provided value → stamp `'complete'`.
* - Handler-provided `'complete'` → kept as-is.
* - Handler-provided non-`'complete'` value on a method whose vocabulary
*   allows it ({@linkcode EXTENDED_RESULT_TYPE_METHODS}) → passes through.
*   The value is forwarded verbatim — the wire vocabulary is an open union and
*   the SDK does not validate the string, so emitting a `resultType` the
*   negotiated revision does not define is the handler author's
*   responsibility.
* - Handler-provided non-`'complete'` value on any other method → internal
*   error (loud): the value would be mis-typed on the wire, and silently
*   rewriting it would hide a server bug.
*/
function stampResultType(method, result) {
	const provided = result["resultType"];
	if (provided === void 0) return {
		...result,
		resultType: "complete"
	};
	if (provided === "complete") return result;
	if (EXTENDED_RESULT_TYPE_METHODS.includes(method)) return result;
	throw new ProtocolError(ProtocolErrorCode.InternalError, `Handler for ${method} returned resultType '${String(provided)}', but results of ${method} only support 'complete' on protocol revision 2026-07-28`);
}
/**
* Step 2 of the encode contract: fill the required `ttlMs`/`cacheScope` fields
* on cacheable results.
*
* Applies only when the (post-stamp) `resultType` is `'complete'` and the
* method is one of the cacheable operations; everything else is returned
* untouched apart from removing the configured-hint carrier. Field resolution
* is per field, most specific author first: a valid handler-returned value,
* then the configured cache hint attached by the server layer, then the
* defaults. Handler-returned values are validated at encode time (`ttlMs`
* must be a non-negative integer, `cacheScope` must be `'public'` or
* `'private'`); invalid values are ignored rather than emitted.
*/
function fillCacheFields(method, result) {
	const fallback = cacheHintFallbackOf(result);
	if (result["resultType"] !== "complete" || !isCacheableResultMethod(method)) return fallback === void 0 ? result : stripCacheHintFallback(result);
	const provided = result;
	const ttlMs = isValidCacheTtlMs(provided["ttlMs"]) ? provided["ttlMs"] : resolveTtlMs(fallback);
	const cacheScope = isValidCacheScope(provided["cacheScope"]) ? provided["cacheScope"] : resolveCacheScope(fallback);
	const filled = {
		...provided,
		ttlMs,
		cacheScope
	};
	delete filled[RESULT_CACHE_HINT_FALLBACK];
	return filled;
}
function isPlainObject$5(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/**
* Step 3 of the encode contract: stamp the server's identity into the
* result's `_meta` under `io.modelcontextprotocol/serverInfo` (spec PR #3002:
* servers SHOULD include it on every response).
*
* - No `serverInfo` supplied (a client instance, or a hand-constructed
*   protocol object) → identity function.
* - The result's `_meta` already carries the key → kept as-is (the handler
*   is the more specific author; mirrors the cache-fill resolution order).
* - A present-but-non-object `_meta` (a dynamic-caller bug) → kept as-is:
*   the stamp never rewrites handler material, and the malformed value fails
*   loudly at the peer instead of being silently replaced here.
* - Otherwise → the key is added, preserving any other `_meta` entries.
*
* Runs for every result regardless of `resultType`: the anchor types
* `Result._meta` as `ResultMetaObject` on all results, `input_required`
* included.
*/
function stampServerInfoMeta(result, serverInfo) {
	if (serverInfo === void 0) return result;
	const meta = result["_meta"];
	if (meta === void 0) return {
		...result,
		_meta: { [_modelcontextprotocol_core_internal.SERVER_INFO_META_KEY]: serverInfo }
	};
	if (!isPlainObject$5(meta)) return result;
	if (meta[_modelcontextprotocol_core_internal.SERVER_INFO_META_KEY] !== void 0) return result;
	return {
		...result,
		_meta: {
			...meta,
			[_modelcontextprotocol_core_internal.SERVER_INFO_META_KEY]: serverInfo
		}
	};
}
function resolveTtlMs(fallback) {
	return fallback !== void 0 && isValidCacheTtlMs(fallback.ttlMs) ? fallback.ttlMs : DEFAULT_CACHE_TTL_MS;
}
function resolveCacheScope(fallback) {
	return fallback !== void 0 && isValidCacheScope(fallback.cacheScope) ? fallback.cacheScope : DEFAULT_CACHE_SCOPE;
}
function stripCacheHintFallback(result) {
	const copy = { ...result };
	delete copy[RESULT_CACHE_HINT_FALLBACK];
	return copy;
}

//#endregion
//#region ../core-internal/src/wire/rev2026-07-28/inputRequired.ts
/**
* In-band input-request vocabulary of the 2026-07-28 revision (SEP-2322
* multi round-trip requests), dispatch view.
*
* The three former server→client wire requests (`elicitation/create`,
* `sampling/createMessage`, `roots/list`) are NOT wire request methods on
* this revision — they are demoted to de-JSON-RPC'd payloads embedded in an
* `input_required` result. The multi-round-trip driver dispatches those
* embedded payloads to the client's registered handlers through the normal
* handler machinery, and these are the schemas that dispatch parses them
* with: lenient where the anchor's wire-true artifacts are strict (an
* embedded request never carries the per-request `_meta` envelope), exact
* where the vocabulary forks (the sampling shapes compose the forked
* SamplingMessage/Tool payloads).
*
* Registry membership is intentionally NOT granted here — these methods stay
* absent from the 2026-era request registry (a peer sending one as a wire
* request still gets −32601 by absence). Only the codec's
* `inputRequestSchema`/`inputResponseSchema` accessors expose them.
*/
/** The embedded input-request methods of the 2026-07-28 revision. */
const INPUT_REQUEST_METHODS_2026 = [
	"elicitation/create",
	"sampling/createMessage",
	"roots/list"
];
let maps;
function inputSchemaMaps() {
	if (maps) return maps;
	const s = buildSchemas2026();
	maps = {
		request: {
			"elicitation/create": zod_v4.object({
				method: zod_v4.literal("elicitation/create"),
				params: s.ElicitRequestParamsSchema
			}),
			"sampling/createMessage": zod_v4.object({
				method: zod_v4.literal("sampling/createMessage"),
				params: s.CreateMessageRequestParamsSchema
			}),
			"roots/list": zod_v4.object({
				method: zod_v4.literal("roots/list"),
				params: zod_v4.looseObject({}).optional()
			})
		},
		response: {
			"elicitation/create": s.ElicitResultSchema,
			"sampling/createMessage": s.CreateMessageResultSchema,
			"roots/list": s.ListRootsResultSchema
		}
	};
	return maps;
}
/**
* Forces the lazy embedded-request maps (and, through them, the era's schema
* memo). Warm-up hook for `preloadSchemas()` — no-op once the maps exist.
*/
function warmInputSchemaMaps2026() {
	inputSchemaMaps();
}
function isInputRequestMethod2026(method) {
	return INPUT_REQUEST_METHODS_2026.includes(method);
}
function getInputRequestSchema2026(method) {
	return isInputRequestMethod2026(method) ? inputSchemaMaps().request[method] : void 0;
}
function getInputResponseSchema2026(method) {
	return isInputRequestMethod2026(method) ? inputSchemaMaps().response[method] : void 0;
}

//#endregion
//#region ../core-internal/src/wire/rev2026-07-28/registry.ts
const requestMethodKeys = {
	"tools/call": null,
	"tools/list": null,
	"prompts/get": null,
	"prompts/list": null,
	"resources/list": null,
	"resources/templates/list": null,
	"resources/read": null,
	"completion/complete": null,
	"server/discover": null,
	"subscriptions/listen": null
};
const notificationMethodKeys = {
	"notifications/cancelled": null,
	"notifications/progress": null,
	"notifications/message": null,
	"notifications/resources/updated": null,
	"notifications/resources/list_changed": null,
	"notifications/tools/list_changed": null,
	"notifications/prompts/list_changed": null,
	"notifications/subscriptions/acknowledged": null
};
/** The 2026-era request-method set (registry membership = the deletion story). */
function hasRequestMethod2026(method) {
	return Object.prototype.hasOwnProperty.call(requestMethodKeys, method);
}
/** The 2026-era notification-method set. */
function hasNotificationMethod2026(method) {
	return Object.prototype.hasOwnProperty.call(notificationMethodKeys, method);
}
/** Result-map membership (same key set as the request map on this era). */
function hasResultMethod2026(method) {
	return Object.prototype.hasOwnProperty.call(requestMethodKeys, method);
}
function getRequestSchema2026(method) {
	return hasRequestMethod2026(method) ? buildSchemas2026().dispatchRequestSchemas[method] : void 0;
}
function getResultSchema2026(method) {
	return hasResultMethod2026(method) ? buildSchemas2026().dispatchResultSchemas[method] : void 0;
}
function getNotificationSchema2026(method) {
	return hasNotificationMethod2026(method) ? buildSchemas2026().notificationSchemas2026[method] : void 0;
}
/** Registry method lists (for the spec-method universe and the CI registry-diff oracle). */
const rev2026RequestMethods = Object.keys(requestMethodKeys);
const rev2026NotificationMethods = Object.keys(notificationMethodKeys);

//#endregion
//#region ../core-internal/src/wire/rev2026-07-28/codec.ts
function isPlainObject$4(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Tri-state wrap of an optional Zod schema lookup (the function-only contract). */
function triState(schema, raw) {
	if (schema === void 0) return {
		ok: false,
		reason: "not-in-era"
	};
	const parsed = schema.safeParse(raw);
	return parsed.success ? {
		ok: true,
		value: parsed.data
	} : {
		ok: false,
		reason: "invalid",
		message: String(parsed.error)
	};
}
const NOT_IN_ERA = {
	ok: false,
	reason: "not-in-era"
};
/**
* The reserved `_meta` keys an envelope must carry on this era (in reporting
* order). `clientInfo` is NOT here: spec PR #3002 demoted it to SHOULD, so a
* request without it is accepted (a present-but-malformed value still fails
* the envelope schema parse below).
*/
const REQUIRED_ENVELOPE_KEYS = [_modelcontextprotocol_core_internal.PROTOCOL_VERSION_META_KEY, _modelcontextprotocol_core_internal.CLIENT_CAPABILITIES_META_KEY];
/** Strip the known deleted-field set from an outbound result (Q1-SD3 iii). */
function enforceDeletedFields(method, result) {
	let next = result;
	let copied = false;
	const copy = () => {
		if (!copied) {
			next = { ...next };
			copied = true;
		}
		return next;
	};
	const tools = result.tools;
	if (method === "tools/list" && Array.isArray(tools) && tools.some((tool) => isPlainObject$4(tool) && "execution" in tool)) copy().tools = tools.map((tool) => {
		if (!isPlainObject$4(tool) || !("execution" in tool)) return tool;
		const rest = { ...tool };
		delete rest["execution"];
		return rest;
	});
	const capabilities = result.capabilities;
	if (isPlainObject$4(capabilities) && "tasks" in capabilities) {
		const rest = { ...capabilities };
		delete rest["tasks"];
		copy().capabilities = rest;
	}
	return next;
}
const rev2026Codec = {
	era: "2026-07-28",
	hasRequestMethod: hasRequestMethod2026,
	hasNotificationMethod: hasNotificationMethod2026,
	hasInputRequestMethod: (method) => getInputRequestSchema2026(method) !== void 0,
	validateRequest: (method, raw) => triState(getRequestSchema2026(method), raw),
	validateResult: (method, raw) => triState(getResultSchema2026(method), raw),
	validateNotification: (method, raw) => triState(getNotificationSchema2026(method), raw),
	validateInputRequest: (method, raw) => triState(getInputRequestSchema2026(method), raw),
	validateInputResponse: (method, raw) => triState(getInputResponseSchema2026(method), raw),
	samplingResultVariant: () => NOT_IN_ERA,
	outboundEnvelope(material) {
		return {
			[_modelcontextprotocol_core_internal.PROTOCOL_VERSION_META_KEY]: material.protocolVersion,
			[_modelcontextprotocol_core_internal.CLIENT_INFO_META_KEY]: material.clientInfo,
			[_modelcontextprotocol_core_internal.CLIENT_CAPABILITIES_META_KEY]: material.clientCapabilities,
			...material.logLevel !== void 0 && { [_modelcontextprotocol_core_internal.LOG_LEVEL_META_KEY]: material.logLevel }
		};
	},
	validateEnvelopeMeta(meta) {
		const issues = [];
		for (const key of REQUIRED_ENVELOPE_KEYS) if (!(key in meta)) issues.push({
			key,
			problem: "missing"
		});
		const parsed = buildSchemas2026().RequestMetaEnvelopeSchema.safeParse(meta);
		if (!parsed.success) for (const issue of parsed.error.issues) {
			const path = issue.path.map(String);
			const key = path.length > 0 ? path.join(".") : "_meta";
			if (path.length === 1 && issues.some((existing) => existing.key === key && existing.problem === "missing")) continue;
			issues.push({
				key,
				problem: issue.message
			});
		}
		return issues;
	},
	projectCallToolResult: (result) => appendTextFallbackForNonObject(result),
	inputRequestSchema: getInputRequestSchema2026,
	decodeResult(method, raw) {
		if (!isPlainObject$4(raw)) return {
			kind: "invalid",
			error: new SdkError(SdkErrorCode.InvalidResult, `Invalid result for ${method}: not an object`, { method })
		};
		const rawResultType = raw["resultType"];
		if (rawResultType === void 0) return {
			kind: "invalid",
			error: new SdkError(SdkErrorCode.InvalidResult, `Invalid result for ${method}: missing required resultType — servers implementing protocol revision 2026-07-28 MUST include it (the absent-means-complete bridge applies only to earlier-revision servers)`, {
				method,
				violation: "missing-resultType"
			})
		};
		if (typeof rawResultType !== "string") return {
			kind: "invalid",
			error: new SdkError(SdkErrorCode.InvalidResult, `Invalid result for ${method}: non-string resultType`, {
				method,
				resultType: rawResultType
			})
		};
		if (rawResultType === "input_required") {
			const rawInputRequests = raw["inputRequests"];
			const inputRequests = isPlainObject$4(rawInputRequests) ? rawInputRequests : {};
			const requestState = raw["requestState"];
			const metaParse = raw["_meta"] === void 0 ? void 0 : buildSchemas2026().ResultMetaSchema.safeParse(raw["_meta"]);
			const meta = metaParse?.success ? metaParse.data : void 0;
			if (Object.keys(inputRequests).length === 0 && typeof requestState !== "string") return {
				kind: "invalid",
				error: new SdkError(SdkErrorCode.InvalidResult, `Invalid result for ${method}: input_required carries neither inputRequests nor requestState (every input_required result must include at least one of the two)`, {
					method,
					violation: "input-required-missing-both"
				})
			};
			return {
				kind: "input_required",
				inputRequests,
				...typeof requestState === "string" && { requestState },
				...meta !== void 0 && { _meta: meta }
			};
		}
		if (rawResultType !== "complete") return {
			kind: "invalid",
			error: new SdkError(SdkErrorCode.UnsupportedResultType, `Unsupported result type '${rawResultType}' for ${method}`, {
				resultType: rawResultType,
				method
			})
		};
		const wireResultSchemas = getWireResultSchemas();
		const wireSchema = Object.hasOwn(wireResultSchemas, method) ? wireResultSchemas[method] : void 0;
		if (wireSchema !== void 0) {
			const parsed = wireSchema.safeParse(raw);
			if (!parsed.success) return {
				kind: "invalid",
				error: new SdkError(SdkErrorCode.InvalidResult, `Invalid result for ${method}: ${parsed.error}`, { method })
			};
		}
		const lifted = { ...raw };
		delete lifted["resultType"];
		return {
			kind: "complete",
			result: lifted
		};
	},
	encodeResult(method, result, serverInfo) {
		return stampServerInfoMeta(fillCacheFields(method, stampResultType(method, enforceDeletedFields(method, result))), serverInfo);
	},
	encodeErrorCode: (code) => code === -32002 ? -32602 : code,
	checkInboundEnvelope(material) {
		if (material.envelope === void 0) return "Request is missing the required _meta envelope for protocol revision 2026-07-28 (io.modelcontextprotocol/protocolVersion, io.modelcontextprotocol/clientCapabilities)";
		const parsed = buildSchemas2026().RequestMetaEnvelopeSchema.safeParse(material.envelope);
		if (!parsed.success) return `Invalid _meta envelope for protocol revision 2026-07-28: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`;
	}
};
/** Wire-true result wrappers consulted by decode step 2, keyed by method —
* built once through the era's schema memo on the first decode. */
let wireResultSchemasMemo;
function getWireResultSchemas() {
	if (wireResultSchemasMemo) return wireResultSchemasMemo;
	const s = buildSchemas2026();
	wireResultSchemasMemo = {
		"tools/call": s.CallToolResultSchema,
		"tools/list": s.ListToolsResultSchema,
		"prompts/get": s.GetPromptResultSchema,
		"prompts/list": s.ListPromptsResultSchema,
		"resources/list": s.ListResourcesResultSchema,
		"resources/templates/list": s.ListResourceTemplatesResultSchema,
		"resources/read": s.ReadResourceResultSchema,
		"completion/complete": s.CompleteResultSchema,
		"server/discover": s.DiscoverResultSchema
	};
	return wireResultSchemasMemo;
}
/**
* Forces the lazy wire-result wrapper map (and, through it, the era's schema
* memo). Warm-up hook for `preloadSchemas()` — no-op once the map exists.
*/
function warmWireResultSchemas2026() {
	getWireResultSchemas();
}

//#endregion
//#region ../core-internal/src/wire/codec.ts
/**
* The modern wire revision literal. Internal only — deliberately NOT a public
* constant (G-D2-4: no public modern-version constant ships before era-aware
* list semantics exist).
*/
const MODERN_WIRE_REVISION = "2026-07-28";
/**
* Era resolution, many-to-one (Q1-SD1): every modern-era revision
* (`>= 2026-07-28`) → the 2026-era codec; every legacy revision (the five
* `SUPPORTED_PROTOCOL_VERSIONS`) and `undefined`/unknown → the 2025-era
* codec (the DV-13 default posture — hand-constructed instances and
* unclassified traffic are legacy-era). This is the same era predicate the
* rest of the SDK uses ({@link isModernProtocolVersion}); a pinned modern
* revision other than the literal '2026-07-28' must still resolve modern.
*/
function codecForVersion(version) {
	return version !== void 0 && isModernProtocolVersion(version) ? rev2026Codec : rev2025Codec;
}
/**
* The wire era an edge classification names (Q2 — produced at the
* transport/entry edge; this layer only CONSUMES it). The dispatch funnel no
* longer resolves a codec FROM the classification: era is instance state, and
* a classified inbound message is VALIDATED against the instance era — a
* mismatch is an entry/routing error, never a per-message era switch. The
* exact `revision` wins over the coarse era flag when both are present.
*/
function classifiedWireEra(classification) {
	if (classification.revision !== void 0) return codecForVersion(classification.revision).era;
	return classification.era === "modern" ? rev2026Codec.era : rev2025Codec.era;
}
/**
* The derived spec-method universe: the union of every codec registry. A
* method in this set is era-gated at dispatch and send time; a method outside
* it is a consumer-owned extension method (era-blind, schema-explicit).
* Derived from the registries — never hand-curated (the LEGACY_ONLY_METHODS
* table class is exactly what registry membership replaces).
*/
function isSpecRequestMethod(method) {
	return ALL_CODECS.some((codec) => codec.hasRequestMethod(method));
}
function isSpecNotificationMethod(method) {
	return ALL_CODECS.some((codec) => codec.hasNotificationMethod(method));
}
/** The names SEP-2663 re-defines for the Tasks extension on the era that removed them from core. */
function isExtensionReusedRequestMethod(method) {
	return method === "tasks/get" || method === "tasks/cancel";
}
const ALL_CODECS = [rev2025Codec, rev2026Codec];

//#endregion
//#region ../core-internal/src/shared/envelope.ts
/**
* Per-request `_meta` envelope claim helpers (protocol revision 2026-07-28).
*
* Pure, value-returning helpers used by the inbound HTTP classifier
* (`classifyInboundRequest`): claim detection and envelope validation with
* self-identifying issues. The envelope schema itself stays the wire layer's
* single source of truth (`RequestMetaEnvelopeSchema`); this module only maps
* its outcomes into the shapes the validation ladder emits.
*
* Claim detection is deliberately narrow: a message claims the 2026-07-28
* envelope mechanism if and only if the reserved protocol-version `_meta` key
* is present in `params._meta`. Other reserved keys (client info, client
* capabilities, log level), a bare `progressToken`, or unrelated keys under
* the `io.modelcontextprotocol/` prefix do NOT constitute a claim on their
* own — but once the claim key is present, a malformed envelope is a
* validation error, never a silent fall back to legacy handling.
*
* The wire-exact envelope schema, the required-key set, and the per-key issue
* mapping live in the wire layer (the 2026-era codec's `validateEnvelopeMeta`).
* This module never reaches into a per-revision wire module directly.
*/
function isPlainObject$3(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** The `_meta` object of a message's params, when present. */
function requestMetaOf(params) {
	if (!isPlainObject$3(params)) return void 0;
	const meta = params["_meta"];
	return isPlainObject$3(meta) ? meta : void 0;
}
/**
* Whether a message's params carry the per-request envelope claim: the
* reserved protocol-version `_meta` key is present (regardless of whether the
* rest of the envelope is valid — validation is a separate, later step).
*/
function hasEnvelopeClaim(params) {
	const meta = requestMetaOf(params);
	return meta !== void 0 && _modelcontextprotocol_core_internal.PROTOCOL_VERSION_META_KEY in meta;
}
/**
* The protocol version named by a message's envelope claim, when the claim is
* present and carries a string value. A present claim with a non-string value
* still counts as a claim ({@linkcode hasEnvelopeClaim}); it surfaces as a
* validation issue instead of a version.
*/
function envelopeClaimVersion(params) {
	const value = requestMetaOf(params)?.[_modelcontextprotocol_core_internal.PROTOCOL_VERSION_META_KEY];
	return typeof value === "string" ? value : void 0;
}
/**
* Validates a request's `_meta` object as a 2026-07-28 per-request envelope
* and reports problems as self-identifying issues (which key, what problem).
*
* Returns an empty array when the envelope is valid. Missing required keys are
* reported first (as `problem: 'missing'`), then schema violations inside
* present keys, in a stable order.
*/
function validateEnvelopeMeta(meta) {
	return codecForVersion(MODERN_WIRE_REVISION).validateEnvelopeMeta(meta);
}

//#endregion
//#region ../core-internal/src/types/schemas.ts
var schemas_exports = /* @__PURE__ */ require_chunk.__exportAll({
	AnnotationsSchema: () => _modelcontextprotocol_core_internal.AnnotationsSchema,
	AudioContentSchema: () => _modelcontextprotocol_core_internal.AudioContentSchema,
	BaseMetadataSchema: () => _modelcontextprotocol_core_internal.BaseMetadataSchema,
	BaseRequestParamsSchema: () => _modelcontextprotocol_core_internal.BaseRequestParamsSchema,
	BlobResourceContentsSchema: () => _modelcontextprotocol_core_internal.BlobResourceContentsSchema,
	BooleanSchemaSchema: () => _modelcontextprotocol_core_internal.BooleanSchemaSchema,
	CallToolRequestParamsSchema: () => _modelcontextprotocol_core_internal.CallToolRequestParamsSchema,
	CallToolRequestSchema: () => _modelcontextprotocol_core_internal.CallToolRequestSchema,
	CallToolResultSchema: () => _modelcontextprotocol_core_internal.CallToolResultSchema,
	CancelTaskRequestSchema: () => _modelcontextprotocol_core_internal.CancelTaskRequestSchema,
	CancelTaskResultSchema: () => _modelcontextprotocol_core_internal.CancelTaskResultSchema,
	CancelledNotificationParamsSchema: () => _modelcontextprotocol_core_internal.CancelledNotificationParamsSchema,
	CancelledNotificationSchema: () => _modelcontextprotocol_core_internal.CancelledNotificationSchema,
	ClientCapabilitiesSchema: () => _modelcontextprotocol_core_internal.ClientCapabilitiesSchema,
	ClientNotificationSchema: () => _modelcontextprotocol_core_internal.ClientNotificationSchema,
	ClientRequestSchema: () => _modelcontextprotocol_core_internal.ClientRequestSchema,
	ClientResultSchema: () => _modelcontextprotocol_core_internal.ClientResultSchema,
	ClientTasksCapabilitySchema: () => _modelcontextprotocol_core_internal.ClientTasksCapabilitySchema,
	CompatibilityCallToolResultSchema: () => _modelcontextprotocol_core_internal.CompatibilityCallToolResultSchema,
	CompleteRequestParamsSchema: () => _modelcontextprotocol_core_internal.CompleteRequestParamsSchema,
	CompleteRequestSchema: () => _modelcontextprotocol_core_internal.CompleteRequestSchema,
	CompleteResultSchema: () => _modelcontextprotocol_core_internal.CompleteResultSchema,
	ContentBlockSchema: () => _modelcontextprotocol_core_internal.ContentBlockSchema,
	CreateMessageRequestParamsSchema: () => _modelcontextprotocol_core_internal.CreateMessageRequestParamsSchema,
	CreateMessageRequestSchema: () => _modelcontextprotocol_core_internal.CreateMessageRequestSchema,
	CreateMessageResultSchema: () => _modelcontextprotocol_core_internal.CreateMessageResultSchema,
	CreateMessageResultWithToolsSchema: () => _modelcontextprotocol_core_internal.CreateMessageResultWithToolsSchema,
	CreateTaskResultSchema: () => _modelcontextprotocol_core_internal.CreateTaskResultSchema,
	CursorSchema: () => _modelcontextprotocol_core_internal.CursorSchema,
	DiscoverRequestSchema: () => _modelcontextprotocol_core_internal.DiscoverRequestSchema,
	DiscoverResultSchema: () => _modelcontextprotocol_core_internal.DiscoverResultSchema,
	ElicitRequestFormParamsSchema: () => _modelcontextprotocol_core_internal.ElicitRequestFormParamsSchema,
	ElicitRequestParamsSchema: () => _modelcontextprotocol_core_internal.ElicitRequestParamsSchema,
	ElicitRequestSchema: () => _modelcontextprotocol_core_internal.ElicitRequestSchema,
	ElicitRequestURLParamsSchema: () => _modelcontextprotocol_core_internal.ElicitRequestURLParamsSchema,
	ElicitResultSchema: () => _modelcontextprotocol_core_internal.ElicitResultSchema,
	ElicitationCompleteNotificationParamsSchema: () => _modelcontextprotocol_core_internal.ElicitationCompleteNotificationParamsSchema,
	ElicitationCompleteNotificationSchema: () => _modelcontextprotocol_core_internal.ElicitationCompleteNotificationSchema,
	EmbeddedResourceSchema: () => _modelcontextprotocol_core_internal.EmbeddedResourceSchema,
	EmptyResultSchema: () => _modelcontextprotocol_core_internal.EmptyResultSchema,
	EnumSchemaSchema: () => _modelcontextprotocol_core_internal.EnumSchemaSchema,
	GetPromptRequestParamsSchema: () => _modelcontextprotocol_core_internal.GetPromptRequestParamsSchema,
	GetPromptRequestSchema: () => _modelcontextprotocol_core_internal.GetPromptRequestSchema,
	GetPromptResultSchema: () => _modelcontextprotocol_core_internal.GetPromptResultSchema,
	GetTaskPayloadRequestSchema: () => _modelcontextprotocol_core_internal.GetTaskPayloadRequestSchema,
	GetTaskPayloadResultSchema: () => _modelcontextprotocol_core_internal.GetTaskPayloadResultSchema,
	GetTaskRequestSchema: () => _modelcontextprotocol_core_internal.GetTaskRequestSchema,
	GetTaskResultSchema: () => _modelcontextprotocol_core_internal.GetTaskResultSchema,
	IconSchema: () => _modelcontextprotocol_core_internal.IconSchema,
	IconsSchema: () => _modelcontextprotocol_core_internal.IconsSchema,
	ImageContentSchema: () => _modelcontextprotocol_core_internal.ImageContentSchema,
	ImplementationSchema: () => _modelcontextprotocol_core_internal.ImplementationSchema,
	InitializeRequestParamsSchema: () => _modelcontextprotocol_core_internal.InitializeRequestParamsSchema,
	InitializeRequestSchema: () => _modelcontextprotocol_core_internal.InitializeRequestSchema,
	InitializeResultSchema: () => _modelcontextprotocol_core_internal.InitializeResultSchema,
	InitializedNotificationSchema: () => _modelcontextprotocol_core_internal.InitializedNotificationSchema,
	JSONArraySchema: () => _modelcontextprotocol_core_internal.JSONArraySchema,
	JSONObjectSchema: () => _modelcontextprotocol_core_internal.JSONObjectSchema,
	JSONRPCErrorResponseSchema: () => _modelcontextprotocol_core_internal.JSONRPCErrorResponseSchema,
	JSONRPCMessageSchema: () => _modelcontextprotocol_core_internal.JSONRPCMessageSchema,
	JSONRPCNotificationSchema: () => _modelcontextprotocol_core_internal.JSONRPCNotificationSchema,
	JSONRPCRequestSchema: () => _modelcontextprotocol_core_internal.JSONRPCRequestSchema,
	JSONRPCResponseSchema: () => _modelcontextprotocol_core_internal.JSONRPCResponseSchema,
	JSONRPCResultResponseSchema: () => _modelcontextprotocol_core_internal.JSONRPCResultResponseSchema,
	JSONValueSchema: () => _modelcontextprotocol_core_internal.JSONValueSchema,
	LegacyTitledEnumSchemaSchema: () => _modelcontextprotocol_core_internal.LegacyTitledEnumSchemaSchema,
	ListChangedOptionsBaseSchema: () => _modelcontextprotocol_core_internal.ListChangedOptionsBaseSchema,
	ListPromptsRequestSchema: () => _modelcontextprotocol_core_internal.ListPromptsRequestSchema,
	ListPromptsResultSchema: () => _modelcontextprotocol_core_internal.ListPromptsResultSchema,
	ListResourceTemplatesRequestSchema: () => _modelcontextprotocol_core_internal.ListResourceTemplatesRequestSchema,
	ListResourceTemplatesResultSchema: () => _modelcontextprotocol_core_internal.ListResourceTemplatesResultSchema,
	ListResourcesRequestSchema: () => _modelcontextprotocol_core_internal.ListResourcesRequestSchema,
	ListResourcesResultSchema: () => _modelcontextprotocol_core_internal.ListResourcesResultSchema,
	ListRootsRequestSchema: () => _modelcontextprotocol_core_internal.ListRootsRequestSchema,
	ListRootsResultSchema: () => _modelcontextprotocol_core_internal.ListRootsResultSchema,
	ListTasksRequestSchema: () => _modelcontextprotocol_core_internal.ListTasksRequestSchema,
	ListTasksResultSchema: () => _modelcontextprotocol_core_internal.ListTasksResultSchema,
	ListToolsRequestSchema: () => _modelcontextprotocol_core_internal.ListToolsRequestSchema,
	ListToolsResultSchema: () => _modelcontextprotocol_core_internal.ListToolsResultSchema,
	LoggingLevelSchema: () => _modelcontextprotocol_core_internal.LoggingLevelSchema,
	LoggingMessageNotificationParamsSchema: () => _modelcontextprotocol_core_internal.LoggingMessageNotificationParamsSchema,
	LoggingMessageNotificationSchema: () => _modelcontextprotocol_core_internal.LoggingMessageNotificationSchema,
	ModelHintSchema: () => _modelcontextprotocol_core_internal.ModelHintSchema,
	ModelPreferencesSchema: () => _modelcontextprotocol_core_internal.ModelPreferencesSchema,
	MultiSelectEnumSchemaSchema: () => _modelcontextprotocol_core_internal.MultiSelectEnumSchemaSchema,
	NotificationSchema: () => _modelcontextprotocol_core_internal.NotificationSchema,
	NotificationsParamsSchema: () => _modelcontextprotocol_core_internal.NotificationsParamsSchema,
	NumberSchemaSchema: () => _modelcontextprotocol_core_internal.NumberSchemaSchema,
	PaginatedRequestParamsSchema: () => _modelcontextprotocol_core_internal.PaginatedRequestParamsSchema,
	PaginatedRequestSchema: () => _modelcontextprotocol_core_internal.PaginatedRequestSchema,
	PaginatedResultSchema: () => _modelcontextprotocol_core_internal.PaginatedResultSchema,
	PingRequestSchema: () => _modelcontextprotocol_core_internal.PingRequestSchema,
	PrimitiveSchemaDefinitionSchema: () => _modelcontextprotocol_core_internal.PrimitiveSchemaDefinitionSchema,
	ProgressNotificationParamsSchema: () => _modelcontextprotocol_core_internal.ProgressNotificationParamsSchema,
	ProgressNotificationSchema: () => _modelcontextprotocol_core_internal.ProgressNotificationSchema,
	ProgressSchema: () => _modelcontextprotocol_core_internal.ProgressSchema,
	ProgressTokenSchema: () => _modelcontextprotocol_core_internal.ProgressTokenSchema,
	PromptArgumentSchema: () => _modelcontextprotocol_core_internal.PromptArgumentSchema,
	PromptListChangedNotificationSchema: () => _modelcontextprotocol_core_internal.PromptListChangedNotificationSchema,
	PromptMessageSchema: () => _modelcontextprotocol_core_internal.PromptMessageSchema,
	PromptReferenceSchema: () => _modelcontextprotocol_core_internal.PromptReferenceSchema,
	PromptSchema: () => _modelcontextprotocol_core_internal.PromptSchema,
	ReadResourceRequestParamsSchema: () => _modelcontextprotocol_core_internal.ReadResourceRequestParamsSchema,
	ReadResourceRequestSchema: () => _modelcontextprotocol_core_internal.ReadResourceRequestSchema,
	ReadResourceResultSchema: () => _modelcontextprotocol_core_internal.ReadResourceResultSchema,
	RelatedTaskMetadataSchema: () => _modelcontextprotocol_core_internal.RelatedTaskMetadataSchema,
	RequestIdSchema: () => _modelcontextprotocol_core_internal.RequestIdSchema,
	RequestMetaSchema: () => _modelcontextprotocol_core_internal.RequestMetaSchema,
	RequestSchema: () => _modelcontextprotocol_core_internal.RequestSchema,
	ResourceContentsSchema: () => _modelcontextprotocol_core_internal.ResourceContentsSchema,
	ResourceLinkSchema: () => _modelcontextprotocol_core_internal.ResourceLinkSchema,
	ResourceListChangedNotificationSchema: () => _modelcontextprotocol_core_internal.ResourceListChangedNotificationSchema,
	ResourceRequestParamsSchema: () => _modelcontextprotocol_core_internal.ResourceRequestParamsSchema,
	ResourceSchema: () => _modelcontextprotocol_core_internal.ResourceSchema,
	ResourceTemplateReferenceSchema: () => _modelcontextprotocol_core_internal.ResourceTemplateReferenceSchema,
	ResourceTemplateSchema: () => _modelcontextprotocol_core_internal.ResourceTemplateSchema,
	ResourceUpdatedNotificationParamsSchema: () => _modelcontextprotocol_core_internal.ResourceUpdatedNotificationParamsSchema,
	ResourceUpdatedNotificationSchema: () => _modelcontextprotocol_core_internal.ResourceUpdatedNotificationSchema,
	ResultMetaObjectSchema: () => _modelcontextprotocol_core_internal.ResultMetaObjectSchema,
	ResultSchema: () => _modelcontextprotocol_core_internal.ResultSchema,
	RoleSchema: () => _modelcontextprotocol_core_internal.RoleSchema,
	RootSchema: () => _modelcontextprotocol_core_internal.RootSchema,
	RootsListChangedNotificationSchema: () => _modelcontextprotocol_core_internal.RootsListChangedNotificationSchema,
	SamplingContentSchema: () => _modelcontextprotocol_core_internal.SamplingContentSchema,
	SamplingMessageContentBlockSchema: () => _modelcontextprotocol_core_internal.SamplingMessageContentBlockSchema,
	SamplingMessageSchema: () => _modelcontextprotocol_core_internal.SamplingMessageSchema,
	ServerCapabilitiesSchema: () => _modelcontextprotocol_core_internal.ServerCapabilitiesSchema,
	ServerNotificationSchema: () => _modelcontextprotocol_core_internal.ServerNotificationSchema,
	ServerRequestSchema: () => _modelcontextprotocol_core_internal.ServerRequestSchema,
	ServerResultSchema: () => _modelcontextprotocol_core_internal.ServerResultSchema,
	ServerTasksCapabilitySchema: () => _modelcontextprotocol_core_internal.ServerTasksCapabilitySchema,
	SetLevelRequestParamsSchema: () => _modelcontextprotocol_core_internal.SetLevelRequestParamsSchema,
	SetLevelRequestSchema: () => _modelcontextprotocol_core_internal.SetLevelRequestSchema,
	SingleSelectEnumSchemaSchema: () => _modelcontextprotocol_core_internal.SingleSelectEnumSchemaSchema,
	StringSchemaSchema: () => _modelcontextprotocol_core_internal.StringSchemaSchema,
	SubscribeRequestParamsSchema: () => _modelcontextprotocol_core_internal.SubscribeRequestParamsSchema,
	SubscribeRequestSchema: () => _modelcontextprotocol_core_internal.SubscribeRequestSchema,
	SubscriptionFilterSchema: () => _modelcontextprotocol_core_internal.SubscriptionFilterSchema,
	SubscriptionsAcknowledgedNotificationParamsSchema: () => _modelcontextprotocol_core_internal.SubscriptionsAcknowledgedNotificationParamsSchema,
	SubscriptionsAcknowledgedNotificationSchema: () => _modelcontextprotocol_core_internal.SubscriptionsAcknowledgedNotificationSchema,
	SubscriptionsListenRequestParamsSchema: () => _modelcontextprotocol_core_internal.SubscriptionsListenRequestParamsSchema,
	SubscriptionsListenRequestSchema: () => _modelcontextprotocol_core_internal.SubscriptionsListenRequestSchema,
	SubscriptionsListenResultMetaSchema: () => _modelcontextprotocol_core_internal.SubscriptionsListenResultMetaSchema,
	SubscriptionsListenResultSchema: () => _modelcontextprotocol_core_internal.SubscriptionsListenResultSchema,
	TaskAugmentedRequestParamsSchema: () => _modelcontextprotocol_core_internal.TaskAugmentedRequestParamsSchema,
	TaskCreationParamsSchema: () => _modelcontextprotocol_core_internal.TaskCreationParamsSchema,
	TaskMetadataSchema: () => _modelcontextprotocol_core_internal.TaskMetadataSchema,
	TaskSchema: () => _modelcontextprotocol_core_internal.TaskSchema,
	TaskStatusNotificationParamsSchema: () => _modelcontextprotocol_core_internal.TaskStatusNotificationParamsSchema,
	TaskStatusNotificationSchema: () => _modelcontextprotocol_core_internal.TaskStatusNotificationSchema,
	TaskStatusSchema: () => _modelcontextprotocol_core_internal.TaskStatusSchema,
	TextContentSchema: () => _modelcontextprotocol_core_internal.TextContentSchema,
	TextResourceContentsSchema: () => _modelcontextprotocol_core_internal.TextResourceContentsSchema,
	TitledMultiSelectEnumSchemaSchema: () => _modelcontextprotocol_core_internal.TitledMultiSelectEnumSchemaSchema,
	TitledSingleSelectEnumSchemaSchema: () => _modelcontextprotocol_core_internal.TitledSingleSelectEnumSchemaSchema,
	ToolAnnotationsSchema: () => _modelcontextprotocol_core_internal.ToolAnnotationsSchema,
	ToolChoiceSchema: () => _modelcontextprotocol_core_internal.ToolChoiceSchema,
	ToolExecutionSchema: () => _modelcontextprotocol_core_internal.ToolExecutionSchema,
	ToolListChangedNotificationSchema: () => _modelcontextprotocol_core_internal.ToolListChangedNotificationSchema,
	ToolResultContentSchema: () => _modelcontextprotocol_core_internal.ToolResultContentSchema,
	ToolSchema: () => _modelcontextprotocol_core_internal.ToolSchema,
	ToolUseContentSchema: () => _modelcontextprotocol_core_internal.ToolUseContentSchema,
	UnsubscribeRequestParamsSchema: () => _modelcontextprotocol_core_internal.UnsubscribeRequestParamsSchema,
	UnsubscribeRequestSchema: () => _modelcontextprotocol_core_internal.UnsubscribeRequestSchema,
	UntitledMultiSelectEnumSchemaSchema: () => _modelcontextprotocol_core_internal.UntitledMultiSelectEnumSchemaSchema,
	UntitledSingleSelectEnumSchemaSchema: () => _modelcontextprotocol_core_internal.UntitledSingleSelectEnumSchemaSchema
});

//#endregion
//#region ../core-internal/src/types/guards.ts
/**
* Validates and parses an unknown value as a JSON-RPC message.
*
* Use this to validate incoming messages in custom transport implementations.
* Throws if the value does not conform to the JSON-RPC message schema.
*
* @param value - The value to validate (typically a parsed JSON object).
* @returns The validated {@linkcode JSONRPCMessage}.
* @throws If validation fails.
*/
function parseJSONRPCMessage(value) {
	return _modelcontextprotocol_core_internal.JSONRPCMessageSchema.parse(value);
}
const isJSONRPCRequest = (value) => _modelcontextprotocol_core_internal.JSONRPCRequestSchema.safeParse(value).success;
const isJSONRPCNotification = (value) => _modelcontextprotocol_core_internal.JSONRPCNotificationSchema.safeParse(value).success;
/**
* Checks if a value is a valid {@linkcode JSONRPCResultResponse}.
* @param value - The value to check.
*
* @returns True if the value is a valid {@linkcode JSONRPCResultResponse}, false otherwise.
*/
const isJSONRPCResultResponse = (value) => _modelcontextprotocol_core_internal.JSONRPCResultResponseSchema.safeParse(value).success;
/**
* Checks if a value is a valid {@linkcode JSONRPCErrorResponse}.
* @param value - The value to check.
*
* @returns True if the value is a valid {@linkcode JSONRPCErrorResponse}, false otherwise.
*/
const isJSONRPCErrorResponse = (value) => _modelcontextprotocol_core_internal.JSONRPCErrorResponseSchema.safeParse(value).success;
/**
* Checks if a value is a valid {@linkcode JSONRPCResponse} (either a result or error response).
* @param value - The value to check.
*
* @returns True if the value is a valid {@linkcode JSONRPCResponse}, false otherwise.
*/
const isJSONRPCResponse = (value) => _modelcontextprotocol_core_internal.JSONRPCResponseSchema.safeParse(value).success;
/**
* Checks if a value is a valid {@linkcode CallToolResult}.
*
* This is a consumer-side VALUE check against the neutral model, not a wire
* validator: a raw wire object that additionally carries wire-only members
* (e.g. `resultType`) still passes through the loose index signature. Use a
* transport-level parse to validate raw wire traffic.
*
* @param value - The value to check.
*
* @returns True if the value is a valid {@linkcode CallToolResult}, false otherwise.
*/
const isCallToolResult = (value) => {
	if (typeof value !== "object" || value === null || value.content === void 0) return false;
	return _modelcontextprotocol_core_internal.CallToolResultSchema.safeParse(value).success;
};
/**
* Checks whether a value is an input-required result (protocol revision
* 2026-07-28): the multi-round-trip return shape discriminated by
* `resultType: 'input_required'`.
*
* This is a discriminator check, not a full validator — the at-least-one rule
* (`inputRequests` or `requestState`) is enforced by the `inputRequired()`
* builder and re-checked by the server seam for hand-built values.
*
* @param value - The value to check.
* @returns True if the value carries the `input_required` discriminator.
*/
const isInputRequiredResult = (value) => typeof value === "object" && value !== null && !Array.isArray(value) && value.resultType === "input_required";
/**
* Checks if a value is a valid {@linkcode TaskAugmentedRequestParams}.
* @param value - The value to check.
*
* @returns True if the value is a valid {@linkcode TaskAugmentedRequestParams}, false otherwise.
*
* @deprecated Recognizes 2025-11-25 task wire vocabulary, which has no SDK
* runtime; kept importable for interoperability only.
*/
const isTaskAugmentedRequestParams = (value) => _modelcontextprotocol_core_internal.TaskAugmentedRequestParamsSchema.safeParse(value).success;
const isInitializeRequest = (value) => _modelcontextprotocol_core_internal.InitializeRequestSchema.safeParse(value).success;
const isInitializedNotification = (value) => _modelcontextprotocol_core_internal.InitializedNotificationSchema.safeParse(value).success;
function assertCompleteRequestPrompt(request) {
	if (request.params.ref.type !== "ref/prompt") throw new TypeError(`Expected CompleteRequestPrompt, but got ${request.params.ref.type}`);
}
function assertCompleteRequestResourceTemplate(request) {
	if (request.params.ref.type !== "ref/resource") throw new TypeError(`Expected CompleteRequestResourceTemplate, but got ${request.params.ref.type}`);
}

//#endregion
//#region ../core-internal/src/shared/mcpParamHeaders.ts
/** The fixed prefix every custom-parameter header carries. */
const MCP_PARAM_HEADER_PREFIX = "Mcp-Param-";
/** The schema-extension property name a tool's `inputSchema` carries. */
const X_MCP_HEADER_KEY = "x-mcp-header";
/**
* RFC 9110 §5.1 `token` syntax (`1*tchar`). Rejects empty, space, control
* characters (including CR/LF), and the listed delimiters.
*/
const RFC9110_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/**
* JSON Schema `type` values the spec admits on an `x-mcp-header` property:
* `integer`, `string` and `boolean`. `number` is explicitly not permitted
* (2026-07-28 Streamable HTTP, "Schema Extension"), so a tool that annotates a
* `number`-typed property is invalid (the server still checks its headers).
* Everything else (`object`, `array`, `null`, absent) is rejected too.
*/
const PERMITTED_X_MCP_HEADER_TYPES = new Set([
	"string",
	"integer",
	"boolean"
]);
/**
* Scan a tool's JSON-serialized `inputSchema` for `x-mcp-header` declarations
* and validate every constraint the spec places on them. Returns either the
* collected declarations (possibly empty) or the first violated constraint
* (with the declarations too, when `number`-typed declarations are the only fault).
*
* The walk descends through `properties` at any depth (the spec's "any nesting
* depth" clause). The static-reachability MUST is enforced as a structural
* sweep: every position the chain MUST NOT pass through (`items`/
* `additionalProperties`, `oneOf`/`anyOf`/`allOf`/`not`, `if`/`then`/`else`,
* `$defs`, `$ref` targets within `$defs`) is visited too, and an
* `x-mcp-header` found anywhere on that path invalidates the schema — "an
* annotation anywhere else makes the tool definition invalid".
*/
function scanXMcpHeaderDeclarations(inputSchema) {
	const declarations = [];
	const seenLower = /* @__PURE__ */ new Map();
	let numberFault;
	const visit = (node, path, reachable) => {
		if (node === null || typeof node !== "object") return void 0;
		const schema = node;
		if (X_MCP_HEADER_KEY in schema) {
			if (!reachable || path.length === 0) return `${pathName(path)}: x-mcp-header is only permitted on properties statically reachable via a chain of 'properties' keys (not under items, additionalProperties, oneOf/anyOf/allOf/not, if/then/else, or $ref)`;
			const raw = schema[X_MCP_HEADER_KEY];
			if (typeof raw !== "string" || raw.length === 0) return `${pathName(path)}: x-mcp-header MUST be a non-empty string`;
			if (!RFC9110_TOKEN.test(raw)) return `${pathName(path)}: x-mcp-header '${raw}' is not a valid RFC 9110 token (no spaces, control characters or HTTP delimiters)`;
			const type = typeof schema.type === "string" ? schema.type : void 0;
			if (type === void 0 || !PERMITTED_X_MCP_HEADER_TYPES.has(type)) {
				const fault$1 = `${pathName(path)}: x-mcp-header is only permitted on primitive-typed properties (string, integer, boolean); got ${type ?? "<none>"}`;
				if (type !== "number") return fault$1;
				numberFault ??= fault$1;
			}
			const lower = raw.toLowerCase();
			const prior = seenLower.get(lower);
			if (prior !== void 0) return `x-mcp-header '${raw}' is not case-insensitively unique (also declared as '${prior}')`;
			seenLower.set(lower, raw);
			declarations.push({
				path,
				headerName: raw,
				type
			});
		}
		const properties = schema.properties;
		if (properties !== null && typeof properties === "object") for (const [key, child] of Object.entries(properties)) {
			const fault$1 = visit(child, [...path, key], reachable);
			if (fault$1 !== void 0) return fault$1;
		}
		for (const k of NON_REACHABLE_SUBSCHEMA_KEYWORDS) {
			const sub = schema[k];
			if (sub === void 0) continue;
			const branches = Array.isArray(sub) ? sub : sub !== null && typeof sub === "object" && OBJECT_VALUED_SUBSCHEMA_KEYWORDS.has(k) ? Object.values(sub) : [sub];
			for (const branch of branches) {
				const fault$1 = visit(branch, [...path, `<${k}>`], false);
				if (fault$1 !== void 0) return fault$1;
			}
		}
	};
	const fault = visit(inputSchema, [], true);
	if (fault !== void 0) return {
		valid: false,
		reason: numberFault ?? fault
	};
	return numberFault === void 0 ? {
		valid: true,
		declarations
	} : {
		valid: false,
		reason: numberFault,
		declarations
	};
}
/**
* JSON Schema keywords whose subschemas the SEP-2243 static-reachability
* constraint excludes from the `properties`-only chain. An `x-mcp-header`
* found under any of these invalidates the tool definition.
*/
const NON_REACHABLE_SUBSCHEMA_KEYWORDS = [
	"items",
	"prefixItems",
	"contains",
	"additionalProperties",
	"unevaluatedProperties",
	"unevaluatedItems",
	"propertyNames",
	"patternProperties",
	"dependentSchemas",
	"oneOf",
	"anyOf",
	"allOf",
	"not",
	"if",
	"then",
	"else",
	"$defs",
	"definitions"
];
/**
* Subschema-carrying keywords whose value is a `name → subschema` object
* (not a single subschema or array of subschemas). The visit branches over
* `Object.values()` for these.
*/
const OBJECT_VALUED_SUBSCHEMA_KEYWORDS = new Set([
	"patternProperties",
	"dependentSchemas",
	"$defs",
	"definitions"
]);
function pathName(path) {
	return path.length === 0 ? "<root>" : path.join(".");
}
const BASE64_SENTINEL_PREFIX = "=?base64?";
const BASE64_SENTINEL_SUFFIX = "?=";
const BASE64_CANONICAL = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CANONICAL_DECIMAL = /^-?\d+(\.\d+)?$/;
/**
* Convert a primitive argument value to its string representation per the
* spec's type-conversion rules: strings pass through, integers and numbers
* become their decimal string, booleans become lowercase `'true'` / `'false'`.
* Non-finite numbers and integers outside the safe range are refused (the
* caller treats `undefined` as "do not emit a header for this value").
*/
function mcpParamPrimitiveToString(value) {
	if (typeof value === "string") return value;
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") {
		if (!Number.isFinite(value)) return void 0;
		if (Number.isInteger(value) && !Number.isSafeInteger(value)) return void 0;
		return String(value);
	}
}
function base64ToUtf8(b64) {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.codePointAt(i);
	return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
/**
* Decode an `Mcp-Param-*` header value: when it carries the Base64 sentinel,
* the payload is decoded as UTF-8; otherwise the value is returned as-is.
* Returns `undefined` when the sentinel is present but the payload is not
* canonical Base64 (or not valid UTF-8) — the spec requires servers to reject
* such values.
*/
function decodeMcpParamValue(value) {
	if (!(value.startsWith(BASE64_SENTINEL_PREFIX) && value.endsWith(BASE64_SENTINEL_SUFFIX))) return value;
	const b64 = value.slice(9, value.length - 2);
	if (!BASE64_CANONICAL.test(b64)) return void 0;
	try {
		return base64ToUtf8(b64);
	} catch {
		return;
	}
}
function valueAtPath(root, path) {
	let node = root;
	for (const key of path) {
		if (node === null || typeof node !== "object") return void 0;
		node = node[key];
	}
	return node;
}
/**
* The header/body comparison the server performs at tool-resolution time.
*
* For each `x-mcp-header` declaration on the named tool: when the body
* `arguments` carries a value, the matching `Mcp-Param-{Name}` header MUST be
* present and decode to an equal value; when the body value is `null` or
* absent the server MUST NOT expect the header (a present header is ignored).
* A sentinel-carrying header whose payload is not canonical Base64 / valid
* UTF-8 is rejected as invalid characters.
*
* Integer- and number-typed declarations are compared numerically (the spec's SHOULD —
* `42.0` and `42` are equal); everything else is compared as decoded strings.
*
* Returns `undefined` when every check passes, or an
* {@linkcode InboundLadderRejection} carrying the same `-32020`
* (`HeaderMismatch`) shape the inbound classifier emits for the
* standard-header cross-checks — `400 Bad Request` with the disagreeing pair
* in `data.mismatch`.
*/
function validateMcpParamHeaders(declarations, args, headers) {
	for (const decl of declarations) {
		const headerKey = `${MCP_PARAM_HEADER_PREFIX}${decl.headerName}`;
		const headerValue = headers.get(headerKey);
		const bodyRaw = valueAtPath(args, decl.path);
		if (bodyRaw === void 0 || bodyRaw === null) continue;
		const bodyString = mcpParamPrimitiveToString(bodyRaw);
		if (bodyString === void 0) continue;
		if (headerValue === null) return paramHeaderMismatchRejection("param-header-missing", headerKey, `the body carries ${pathName(decl.path)}=${JSON.stringify(bodyRaw)} but the ${headerKey} header is absent`);
		const decoded = decodeMcpParamValue(headerValue);
		if (decoded === void 0) return paramHeaderMismatchRejection("param-header-invalid-encoding", headerKey, `the ${headerKey} header carries an invalid Base64 sentinel value`);
		if (!((decl.type === "integer" || decl.type === "number") && CANONICAL_DECIMAL.test(decoded) && typeof bodyRaw === "number" ? Number(decoded) === bodyRaw : decoded === bodyString)) return paramHeaderMismatchRejection("param-header-mismatch", headerKey, `the ${headerKey} header decodes to ${JSON.stringify(decoded)} but the body carries ${pathName(decl.path)}=${JSON.stringify(bodyRaw)}`);
	}
}
/**
* Build the `-32020` (`HeaderMismatch`) rejection for an `Mcp-Param-*`
* disagreement. Same shape as the inbound classifier's standard-header
* cross-check mismatch (HTTP `400`, `data.mismatch` naming the disagreeing
* pair, `settled: true`); only the rung differs because this check runs at the
* pre-dispatch step against a known tool's schema rather than at the edge.
*/
function paramHeaderMismatchRejection(cell, header, body) {
	return {
		kind: "reject",
		rung: "param-header-validation",
		cell,
		httpStatus: 400,
		code: HEADER_MISMATCH_ERROR_CODE,
		message: `Bad Request: the request headers and body disagree: ${body}`,
		data: { mismatch: {
			header,
			body
		} },
		settled: true
	};
}

//#endregion
//#region ../core-internal/src/shared/inboundClassification.ts
/**
* Inbound HTTP request classification and the inbound validation ladder
* (protocol revision 2026-07-28).
*
* `classifyInboundRequest` is the body-primary era predicate for an HTTP
* entry that serves both protocol eras on one endpoint. It is evaluated
* exactly once, at the entry boundary, on the already-parsed request body:
*
* - `initialize` is a legacy-era request by definition (the modern era has no
*   `initialize` handshake) — unless it carries a valid envelope claim naming
*   a modern revision, in which case the claim wins and the request is
*   classified like any other enveloped request (the modern era then answers
*   it with method-not-found, exactly like every other method it does not
*   define).
* - A request whose `params._meta` carries the reserved protocol-version key
*   claims the per-request envelope mechanism and classifies into the era the
*   named revision belongs to (a malformed envelope behind a present claim is
*   a validation error, never a silent fall back to legacy handling).
* - A request without a claim is legacy-era traffic.
* - The `MCP-Protocol-Version` header is a cross-check only *for
*   classification*: it never upgrades or downgrades a body-derived
*   classification, and a disagreement between header and body is an explicit
*   ladder outcome. Its absence likewise never changes the era — but the spec
*   requires the header on every modern *request* POST, so a
*   modern-classified request that omits it is refused one rung later, by
*   {@linkcode validateStandardRequestHeaders}, not here. Notification POSTs
*   are exempt (see the next bullet), and that rung enforces presence on
*   requests only.
* - Notifications carry no envelope claim of their own under the current
*   spec, so for notification POSTs without a body claim the modern header is
*   determinative; the `Mcp-Method` header is validated against the body when
*   the message classifies modern and is never enforced on legacy traffic.
*   A notification that does carry a claim is treated body-primary like a
*   request, and a malformed claim is rejected the same way a request's
*   malformed claim is — never silently resolved against the header.
*   The notification-POST header cross-checks here are an SDK-defensive
*   posture, not a spec requirement: the spec leaves header rules for posted
*   notifications undefined (core client notifications do not occur over
*   Streamable HTTP); applying the request rules symmetrically is what an
*   ecosystem custom-notification POST expects, and the −32020 cells stay
*   passing for them.
* - `GET`/`DELETE` (and any other non-`POST` method) are body-less 2025-era
*   session operations: the modern era is `POST`-only, so they are routed to
*   legacy serving when it is configured and rejected otherwise.
* - Array (batch) bodies are classified element-wise: an array containing a
*   modern-claiming or invalid element is rejected, an all-legacy array is
*   legacy traffic unchanged, and a single-element array is still an array.
*
* The classifier returns plain values (it never throws and never touches a
* transport): a routing outcome (`legacy`/`modern`) or a ladder rejection
* carrying the JSON-RPC error to emit and the HTTP status to emit it with.
* Legacy routing outcomes deliberately carry NO `MessageClassification` —
* legacy and hand-wired traffic is never classified, which keeps its
* dispatch behavior byte-identical to today's.
*
* Error codes for the modern-path rejection cells follow the published
* conformance suite (and the spec text it asserts):
*
* - A header/body cross-check mismatch (the `MCP-Protocol-Version` header
*   disagreeing with the body, or the `Mcp-Method` header disagreeing with the
*   body method) is rejected with `-32020` (`HeaderMismatch`) on HTTP 400.
* - A request whose protocol-version header names a modern revision but whose
*   body carries no `_meta` envelope claim — including an envelope present but
*   missing the required protocol-version key — is rejected with `-32602`
*   (invalid params) naming the missing key(s), on HTTP 400.
*
* Should a future spec revision or conformance release change these
* assignments, the affected cells are re-derived against that release; the
* `settled` flag on {@linkcode InboundLadderRejection} stays available to mark
* a cell provisional again while such a change is in flight.
*/
/**
* The error code emitted for header/body cross-check mismatches: the
* `MCP-Protocol-Version` header disagreeing with the body's envelope claim (or
* with the body's classification), and the `Mcp-Method` header disagreeing
* with the body method.
*
* `-32020` is the draft schema's `HEADER_MISMATCH` constant (the SEP-2243
* `HeaderMismatch` code; the spec requires HTTP 400 for it), as also asserted
* by the published conformance suite for header-validation failures. It has no
* {@linkcode ProtocolErrorCode} member because it is not part of the 2025-era
* wire vocabulary; the validation ladder is its only emitter.
*/
const HEADER_MISMATCH_ERROR_CODE = -32020;
/**
* The inbound validation ladder, expressed as data rather than control flow.
*
* The edge rungs are evaluated by {@linkcode classifyInboundRequest}; the
* dispatch rungs are evaluated by the protocol layer once the classified
* message is injected into a per-request server instance (the era registry
* gate, the envelope requiredness check, and per-method params validation).
* The client-capability rung is evaluated by the HTTP entry itself,
* pre-dispatch, on the validated envelope the classifier produced — see that
* rung's rationale for the ordering caveat. The order is the precedence: a
* request that fails several rungs is answered by the earliest one.
*/
const INBOUND_VALIDATION_LADDER = [
	{
		rung: "http-method",
		order: 1,
		evaluatedAt: "edge",
		codes: [-32e3],
		conformance: [],
		rationale: "The modern era is POST-only; GET/DELETE are body-less 2025-era session operations and are method-routed to legacy serving (405 when legacy serving is not configured), before any body is read."
	},
	{
		rung: "jsonrpc-shape",
		order: 2,
		evaluatedAt: "edge",
		codes: [ProtocolErrorCode.InvalidRequest],
		conformance: ["server-stateless"],
		rationale: "The body must be a JSON-RPC request or notification: posted responses and batch arrays containing a modern or invalid element are rejected before classification (element-wise batch rule); all-legacy arrays stay legacy traffic."
	},
	{
		rung: "era-classification",
		order: 3,
		evaluatedAt: "edge",
		codes: [HEADER_MISMATCH_ERROR_CODE, ProtocolErrorCode.UnsupportedProtocolVersion],
		conformance: [
			"server-stateless",
			"http-header-validation",
			"http-custom-header-server-validation"
		],
		rationale: "Body-primary era classification with the protocol-version header as a cross-check; a header/body disagreement is rejected with -32020 (HeaderMismatch), and an envelope-less request on a modern-only endpoint is answered with the unsupported-protocol-version error naming the supported revisions."
	},
	{
		rung: "envelope",
		order: 4,
		evaluatedAt: "edge",
		codes: [ProtocolErrorCode.InvalidParams],
		conformance: ["server-stateless"],
		rationale: "A present envelope claim with a malformed envelope — and a missing envelope on a request whose protocol-version header names a modern revision — is an invalid-params rejection naming the offending or missing key(s); never a silent fall back to legacy handling. This is the only place an invalid-params rejection maps to HTTP 400."
	},
	{
		rung: "method-registry",
		order: 5,
		evaluatedAt: "dispatch",
		codes: [ProtocolErrorCode.MethodNotFound],
		conformance: ["server-stateless"],
		rationale: "Method existence outranks parameter validity: a method absent from the negotiated revision’s registry (or with no handler installed) answers method-not-found before params or capabilities are looked at."
	},
	{
		rung: "request-params",
		order: 6,
		evaluatedAt: "dispatch",
		codes: [ProtocolErrorCode.InvalidParams],
		conformance: [],
		rationale: "Per-method params validation; emitted in-band by the dispatch layer (HTTP 200), never via the ladder status table."
	},
	{
		rung: "standard-header-validation",
		order: 7,
		evaluatedAt: "pre-dispatch",
		codes: [HEADER_MISMATCH_ERROR_CODE],
		conformance: ["http-header-validation"],
		rationale: "SEP-2243 standard `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` headers — presence, sentinel decoding, and `Mcp-Name` ↔ body cross-check — are validated by the HTTP entry on a modern-classified request after the supported-revision gate and before dispatch. The spec requires `MCP-Protocol-Version` and `Mcp-Method` on every modern *request* POST (`Mcp-Name` only for the methods that mirror `params.name` / `params.uri` / `params.taskId`, see `MCP_NAME_HEADER_SOURCE`) and names them in that order, so a request missing several is answered by the earliest. Notification POSTs are exempt: the presence half runs on requests only, so a modern-enveloped notification is dispatched even with no standard headers at all. The classifier’s own header-mismatch cells (protocol-version, `Mcp-Method` mismatch) stay on the edge `era-classification` rung; this rung carries the entry-layer presence/`Mcp-Name` half — including the missing `MCP-Protocol-Version` cell, which cannot live on the edge rung without breaking body-primary classification. Evaluated before the capability gate, the factory call, and the `Mcp-Param-*` rung so a request that fails several rungs is answered by the standard-header rung first. The documented order (after method-registry 5 and request-params 6) is NOT the observed precedence: serveModern evaluates this rung immediately after the supported-revision gate, so a request that also fails a dispatch rung is answered here before the dispatch rungs (5–6) are consulted."
	},
	{
		rung: "client-capabilities",
		order: 8,
		evaluatedAt: "pre-dispatch",
		codes: [ProtocolErrorCode.MissingRequiredClientCapability],
		conformance: ["server-stateless"],
		rationale: "The capability requirement is checked by the HTTP entry, pre-dispatch, against the validated envelope the classifier produced — pinning the spec-mandated HTTP 400 independently of how dispatch- and handler-produced errors are mapped. The documented order (after method resolution and params validation) is preserved observably only while the requirement table is empty: once a served method gains a requirement entry, a request that is missing the capability and would also fail a dispatch rung is answered by this gate first, so the entry must consult the method registry before the gate if the documented precedence is to stay observable."
	},
	{
		rung: "param-header-validation",
		order: 9,
		evaluatedAt: "pre-dispatch",
		codes: [HEADER_MISMATCH_ERROR_CODE],
		conformance: ["http-custom-header-server-validation"],
		rationale: "SEP-2243 `Mcp-Param-*` headers are validated against the named tool’s `x-mcp-header` declarations and the body `arguments` after the tool registry is known and before dispatch reaches the handler; a missing/disagreeing/malformed header is rejected 400 / -32020 with the same shape as the standard-header cross-checks. The documented order (after method resolution and params validation) is preserved observably only when the body `arguments` would otherwise validate: the check runs pre-dispatch, so a `tools/call` that fails BOTH this rung and a dispatch-time rung (e.g. order-6 `request-params`, -32602) is answered by this gate first with 400 / -32020, not by the earlier-ordered rung."
	}
];
/**
* HTTP status for ladder-originated JSON-RPC error codes.
*
* Keyed on origin, not on the bare code: this table only applies to errors
* the ladder (or a pre-handler protocol gate) produced. Errors produced by
* request handlers — whatever their code — stay in-band on HTTP 200, and are
* never mapped to an HTTP status by this table; in particular `-32603` and
* domain-specific codes never become a blanket 500. The single exception is
* `MissingRequiredClientCapability` (-32021) — see
* {@linkcode httpStatusForErrorCode}.
*
* `-32602` (invalid params) deliberately has NO entry: the only invalid-params
* rejection that maps to HTTP 400 is the classifier's own envelope rung
* short-circuit, which carries its HTTP status directly. A dispatch- or
* handler-produced invalid-params error is always in-band.
*/
const LADDER_ERROR_HTTP_STATUS = {
	[ProtocolErrorCode.ParseError]: 400,
	[ProtocolErrorCode.InvalidRequest]: 400,
	[ProtocolErrorCode.MethodNotFound]: 404,
	[ProtocolErrorCode.UnsupportedProtocolVersion]: 400,
	[ProtocolErrorCode.MissingRequiredClientCapability]: 400,
	[HEADER_MISMATCH_ERROR_CODE]: 400
};
/**
* The HTTP status to answer a JSON-RPC error with, keyed on the error's
* origin. `in-band` errors (anything produced by a request handler) are
* HTTP 200 — the JSON-RPC error response is the payload, not an HTTP
* failure — with ONE exception: `MissingRequiredClientCapability` (-32021),
* whose 400 the spec mandates on the error itself with no origin condition,
* and which the SDK genuinely produces after dispatch (the `input_required`
* capability gate). A handler relaying some downstream peer's `-32020`/`-32022`
* is NOT that peer's spec error and stays in-band like every other handler
* code. `ladder` errors map through {@linkcode LADDER_ERROR_HTTP_STATUS}.
*
* The per-request transport intentionally does NOT delegate to this function:
* its `?? 400` ladder fallback is only correct for entry-gate codes known to
* the table, and would wrongly map dispatch-window errors outside it (a
* window `-32602` must stay in-band on 200). The transport indexes the table
* directly; keep the two in agreement when editing either.
*/
function httpStatusForErrorCode(code, origin) {
	if (origin === "in-band") return code === ProtocolErrorCode.MissingRequiredClientCapability ? 400 : 200;
	return LADDER_ERROR_HTTP_STATUS[code] ?? 400;
}
function rejection(rung, cell, httpStatus, error, settled) {
	return {
		kind: "reject",
		rung,
		cell,
		httpStatus,
		code: error.code,
		message: error.message,
		...error.data !== void 0 && { data: error.data },
		settled
	};
}
function crossCheckMismatch(cell, header, body, rung = "era-classification") {
	return rejection(rung, cell, 400, new ProtocolError(HEADER_MISMATCH_ERROR_CODE, `Bad Request: the request headers and body disagree: ${body}`, { mismatch: {
		header,
		body
	} }), true);
}
/**
* The methods whose body carries a `params.name` / `params.uri` /
* `params.taskId` value the `Mcp-Name` header must mirror, and which body
* field supplies it. The core rows come from SEP-2243 § Standard Request
* Headers (`Required For` column); the `tasks/*` rows come from SEP-2663's
* Streamable HTTP binding ("the client MUST set the `Mcp-Name` header to the
* value of `params.taskId`" for `tasks/get` / `tasks/update` /
* `tasks/cancel`, so intermediaries can route every request for a task to the
* instance holding its state). Shared by the client transport (header
* emission) and the server ladder (validation) so both sides derive from one
* table.
*/
const MCP_NAME_HEADER_SOURCE = {
	"tools/call": "name",
	"prompts/get": "name",
	"resources/read": "uri",
	"tasks/get": "taskId",
	"tasks/update": "taskId",
	"tasks/cancel": "taskId"
};
/**
* Resolve the `Mcp-Name` source for one request against
* {@linkcode MCP_NAME_HEADER_SOURCE}: which body field the header mirrors for
* `method`, and the string value that field carries in `params`.
*
* Returns `undefined` when `method` is off-table (no `Mcp-Name` is emitted or
* required). Otherwise `value` is the field's string value, or `undefined`
* when `params` is not a plain object or the field is absent / not a string —
* the client emits no header then, and the server leaves that body to the
* rungs further down the ladder.
*
* `method` is peer-supplied on the server and caller-supplied on the client,
* so the table lookup is `Object.hasOwn`-guarded against `Object.prototype`
* collisions (`constructor`, `toString`, …). Shared by the client transport
* (emission) and {@linkcode validateStandardRequestHeaders} (validation) so
* the extraction — not just the table — cannot drift between the two sides.
*/
function mcpNameSource(method, params) {
	const field = Object.hasOwn(MCP_NAME_HEADER_SOURCE, method) ? MCP_NAME_HEADER_SOURCE[method] : void 0;
	if (field === void 0) return;
	const raw = isPlainObject$2(params) ? params[field] : void 0;
	return {
		field,
		value: typeof raw === "string" ? raw : void 0
	};
}
/** Strip RFC 9110 optional whitespace (SP / HTAB) around a field value in linear time. */
function stripHttpOws(value) {
	let start = 0;
	while (start < value.length) {
		const code = value.codePointAt(start);
		if (code !== 9 && code !== 32) break;
		start += 1;
	}
	let end = value.length;
	while (end > start) {
		const code = value.codePointAt(end - 1);
		if (code !== 9 && code !== 32) break;
		end -= 1;
	}
	return start === 0 && end === value.length ? value : value.slice(start, end);
}
/**
* SEP-2243 standard-header server-side validation, evaluated by the HTTP
* entry on a modern-classified request immediately after
* {@linkcode classifyInboundRequest} returns a modern route.
*
* Returns the `-32020` (`HeaderMismatch`) ladder rejection (HTTP `400`,
* `standard-header-validation` rung — the same shape
* {@linkcode classifyInboundRequest} already emits on the edge
* `era-classification` rung for the `MCP-Protocol-Version` and
* `Mcp-Method` *mismatch* cells) when:
*
* - the required `MCP-Protocol-Version` header is absent (SEP-2243 requires it
*   on every modern *request* POST, and lists it first among the required
*   standard headers — so a request missing it *and* `Mcp-Method` is answered
*   by this cell);
* - the required `Mcp-Method` header is absent;
* - the required `Mcp-Name` header is absent on a `tools/call`,
*   `prompts/get`, `resources/read`, or (per SEP-2663's Streamable HTTP
*   binding) `tasks/get` / `tasks/update` / `tasks/cancel` request whose
*   body carries the `params.name` / `params.uri` / `params.taskId` value
*   the header mirrors;
* - the `Mcp-Name` header carries an invalid `=?base64?…?=` sentinel; or
* - the (decoded) `Mcp-Name` value disagrees with the body's
*   `params.name` / `params.uri` / `params.taskId`.
*
* Returns `undefined` (pass) for notifications (the spec table reads
* "All requests"), for methods that have no `Mcp-Name` source, and when the
* headers agree with the body. Never enforced on legacy traffic — the entry
* only calls this on a modern route.
*
* Kept separate from {@linkcode classifyInboundRequest} so that a body-only
* call to the classifier (no headers passed) keeps routing a modern request
* unchanged: the classifier remains a pure body-primary router, and this
* function is the presence/`Mcp-Name` half of the standard-header rung the
* entry layers on top. That separation is what lets the missing
* `MCP-Protocol-Version` cell live here without disturbing the body-primary
* rule — classification still resolves from the body (a proxy stripping the
* header must not change the era), and only this rung refuses to serve it.
*/
function validateStandardRequestHeaders(request, route) {
	if (route.messageKind !== "request") return;
	const method = route.message.method;
	if (request.protocolVersionHeader === void 0) {
		const claimed = route.classification.revision;
		return crossCheckMismatch("version-header-missing", "(missing)", claimed === void 0 ? "the body carries a modern per-request envelope but the required MCP-Protocol-Version header is absent" : `the body envelope names protocol version ${claimed} but the required MCP-Protocol-Version header is absent`, "standard-header-validation");
	}
	if (request.mcpMethodHeader === void 0) return crossCheckMismatch("method-header-missing", "(missing)", `the body names method ${method} but the required Mcp-Method header is absent`, "standard-header-validation");
	const source = mcpNameSource(method, route.message.params);
	if (source === void 0) return;
	const { field: sourceField, value: bodyValue } = source;
	if (request.mcpNameHeader === void 0) {
		if (bodyValue === void 0) return;
		return crossCheckMismatch("name-header-missing", "(missing)", `the body carries params.${sourceField}="${bodyValue}" but the required Mcp-Name header is absent`, "standard-header-validation");
	}
	const normalizedNameHeader = stripHttpOws(request.mcpNameHeader);
	const decoded = decodeMcpParamValue(normalizedNameHeader);
	if (decoded === void 0) return crossCheckMismatch("name-header-invalid-encoding", normalizedNameHeader, "the Mcp-Name header carries an invalid Base64 sentinel value", "standard-header-validation");
	if (bodyValue !== void 0 && decoded !== bodyValue) return crossCheckMismatch("name-header-mismatch", normalizedNameHeader, `the body carries params.${sourceField}="${bodyValue}" but the Mcp-Name header names "${decoded}"`, "standard-header-validation");
}
function isPlainObject$2(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function classificationForClaim(claimedVersion) {
	if (claimedVersion === void 0) return { era: "modern" };
	return {
		era: isModernProtocolVersion(claimedVersion) ? "modern" : "legacy",
		revision: claimedVersion
	};
}
/**
* Whether a request's params carry a per-request envelope claim that is both
* well-formed and names a modern protocol revision.
*
* Used by the `initialize` precedence rule: only such a claim overrides the
* `initialize` ⇒ legacy-handshake classification — a request carrying a valid
* modern envelope is a modern request regardless of its method name, and the
* modern era then answers `initialize` exactly like any other method it does
* not define (method-not-found). A malformed claim, or one naming a pre-2026
* revision, keeps the legacy-handshake routing unchanged.
*
* Exported on the core internal barrel for the stdio serving entry, which
* applies the same precedence rule to a connection's opening message; not
* public API.
*/
function carriesValidModernEnvelopeClaim(params) {
	if (!hasEnvelopeClaim(params)) return false;
	const claimedVersion = envelopeClaimVersion(params);
	if (claimedVersion === void 0 || !isModernProtocolVersion(claimedVersion)) return false;
	const meta = requestMetaOf(params);
	return meta !== void 0 && validateEnvelopeMeta(meta).length === 0;
}
function classifyBatch(body) {
	if (body.length === 0) return rejection("jsonrpc-shape", "empty-batch", 400, new ProtocolError(ProtocolErrorCode.InvalidRequest, "Bad Request: empty JSON-RPC batch"), true);
	for (const element of body) {
		if (hasEnvelopeClaim(isPlainObject$2(element) ? element["params"] : void 0)) return rejection("jsonrpc-shape", "batch-with-modern-element", 400, new ProtocolError(ProtocolErrorCode.InvalidRequest, "Bad Request: JSON-RPC batches may not contain requests for protocol revision 2026-07-28 or later"), true);
		if (!(isJSONRPCRequest(element) || isJSONRPCNotification(element) || isJSONRPCResultResponse(element) || isJSONRPCErrorResponse(element))) return rejection("jsonrpc-shape", "batch-with-invalid-element", 400, new ProtocolError(ProtocolErrorCode.InvalidRequest, "Bad Request: JSON-RPC batch contains an invalid message"), true);
	}
	return {
		kind: "legacy",
		reason: "batch"
	};
}
function classifyRequestBody(request, body) {
	const params = body.params;
	const method = body.method;
	const headerVersion = request.protocolVersionHeader;
	const headerNamesModern = headerVersion !== void 0 && isModernProtocolVersion(headerVersion);
	if (method === "initialize" && !carriesValidModernEnvelopeClaim(params)) {
		if (headerNamesModern) return crossCheckMismatch("initialize-with-modern-header", headerVersion, "an initialize request (legacy handshake) was sent with a modern MCP-Protocol-Version header");
		const requestedVersion = isPlainObject$2(params) && typeof params["protocolVersion"] === "string" ? params["protocolVersion"] : void 0;
		return {
			kind: "legacy",
			reason: "initialize",
			...requestedVersion !== void 0 && { requestedVersion }
		};
	}
	if (hasEnvelopeClaim(params)) {
		const meta = requestMetaOf(params);
		const firstIssue = (meta === void 0 ? [] : validateEnvelopeMeta(meta))[0];
		if (firstIssue !== void 0) return rejection("envelope", "envelope-invalid", 400, new ProtocolError(ProtocolErrorCode.InvalidParams, `Invalid _meta envelope for protocol revision 2026-07-28: ${firstIssue.key}: ${firstIssue.problem}`, { envelope: firstIssue }), true);
		const claimedVersion = envelopeClaimVersion(params);
		if (headerVersion !== void 0 && claimedVersion !== void 0 && headerVersion !== claimedVersion) return crossCheckMismatch("header-body-version-mismatch", headerVersion, `the body envelope names protocol version ${claimedVersion} but the MCP-Protocol-Version header names ${headerVersion}`);
		if (request.mcpMethodHeader !== void 0 && request.mcpMethodHeader !== method) return crossCheckMismatch("method-header-mismatch", request.mcpMethodHeader, `the body names method ${method} but the Mcp-Method header names ${request.mcpMethodHeader}`);
		return {
			kind: "modern",
			messageKind: "request",
			message: body,
			classification: classificationForClaim(claimedVersion)
		};
	}
	if (headerNamesModern) {
		const meta = requestMetaOf(params);
		const missingFromEnvelope = validateEnvelopeMeta(meta ?? {}).filter((issue) => issue.problem === "missing").map((issue) => issue.key);
		const missing = meta === void 0 ? ["_meta"] : missingFromEnvelope.length > 0 ? missingFromEnvelope : [_modelcontextprotocol_core_internal.PROTOCOL_VERSION_META_KEY];
		return rejection("envelope", "modern-header-without-claim", 400, new ProtocolError(ProtocolErrorCode.InvalidParams, `Invalid params: the MCP-Protocol-Version header names protocol revision ${headerVersion}, but the request is missing the required per-request envelope key(s): ${missing.join(", ")}`, { envelope: { missing } }), true);
	}
	return {
		kind: "legacy",
		reason: "no-claim",
		...headerVersion !== void 0 && { requestedVersion: headerVersion }
	};
}
function classifyNotificationBody(request, body) {
	const params = body.params;
	const method = body.method;
	const headerVersion = request.protocolVersionHeader;
	const headerNamesModern = headerVersion !== void 0 && isModernProtocolVersion(headerVersion);
	if (hasEnvelopeClaim(params)) {
		const claimedVersion = envelopeClaimVersion(params);
		if (claimedVersion === void 0) {
			const meta = requestMetaOf(params);
			const claimIssue = (meta === void 0 ? [] : validateEnvelopeMeta(meta)).find((issue) => issue.key === _modelcontextprotocol_core_internal.PROTOCOL_VERSION_META_KEY) ?? {
				key: _modelcontextprotocol_core_internal.PROTOCOL_VERSION_META_KEY,
				problem: "expected a protocol version string"
			};
			return rejection("envelope", "notification-envelope-invalid", 400, new ProtocolError(ProtocolErrorCode.InvalidParams, `Invalid _meta envelope for protocol revision 2026-07-28: ${claimIssue.key}: ${claimIssue.problem}`, { envelope: claimIssue }), true);
		}
		if (headerVersion !== void 0 && headerVersion !== claimedVersion) return crossCheckMismatch("notification-header-body-version-mismatch", headerVersion, `the notification envelope names protocol version ${claimedVersion} but the MCP-Protocol-Version header names ${headerVersion}`);
		const classification = classificationForClaim(claimedVersion);
		if (classification.era === "modern" && request.mcpMethodHeader !== void 0 && request.mcpMethodHeader !== method) return crossCheckMismatch("notification-method-header-mismatch", request.mcpMethodHeader, `the notification body names method ${method} but the Mcp-Method header names ${request.mcpMethodHeader}`);
		return {
			kind: "modern",
			messageKind: "notification",
			message: body,
			classification
		};
	}
	if (headerNamesModern) {
		if (request.mcpMethodHeader !== void 0 && request.mcpMethodHeader !== method) return crossCheckMismatch("notification-method-header-mismatch", request.mcpMethodHeader, `the notification body names method ${method} but the Mcp-Method header names ${request.mcpMethodHeader}`);
		return {
			kind: "modern",
			messageKind: "notification",
			message: body,
			classification: {
				era: "modern",
				revision: headerVersion
			}
		};
	}
	return {
		kind: "legacy",
		reason: "notification",
		...headerVersion !== void 0 && { requestedVersion: headerVersion }
	};
}
/**
* Classifies one inbound HTTP request for dual-era serving.
*
* The body-primary predicate, evaluated once at the entry boundary: see the
* module documentation for the rules. Returns a routing outcome (`legacy` or
* `modern`) or a ladder rejection; it never throws.
*/
function classifyInboundRequest(request) {
	request = {
		...request,
		...request.protocolVersionHeader !== void 0 && { protocolVersionHeader: stripHttpOws(request.protocolVersionHeader) },
		...request.mcpMethodHeader !== void 0 && { mcpMethodHeader: stripHttpOws(request.mcpMethodHeader) },
		...request.mcpNameHeader !== void 0 && { mcpNameHeader: stripHttpOws(request.mcpNameHeader) }
	};
	if (request.httpMethod.toUpperCase() !== "POST") return {
		kind: "legacy",
		reason: "http-method"
	};
	const body = request.body;
	if (Array.isArray(body)) return classifyBatch(body);
	if (isJSONRPCResultResponse(body) || isJSONRPCErrorResponse(body)) return {
		kind: "legacy",
		reason: "response"
	};
	if (isPlainObject$2(body) && isJSONRPCRequest(body)) return classifyRequestBody(request, body);
	if (isPlainObject$2(body) && isJSONRPCNotification(body)) return classifyNotificationBody(request, body);
	return rejection("jsonrpc-shape", "invalid-json-rpc-body", 400, new ProtocolError(ProtocolErrorCode.InvalidRequest, "Bad Request: the request body is not a valid JSON-RPC message"), true);
}
/**
* The rejection a modern-only endpoint (no legacy serving configured)
* answers a legacy-classified request with.
*
* - Envelope-less requests (including `initialize`) are answered with the
*   unsupported-protocol-version error carrying the endpoint's supported
*   versions and echoing the version the request named (when it named one —
*   `requested` is omitted rather than fabricated when the request named no
*   version at all), so a legacy client can discover what the endpoint serves
*   from the error alone.
* - Posted responses and batch arrays are invalid requests on the modern era.
* - Non-`POST` methods are not allowed.
* - Legacy-classified notifications return `undefined`: the caller answers
*   202 with no body and does not dispatch the notification (accept-and-drop).
*/
function modernOnlyStrictRejection(route, supportedVersions) {
	switch (route.reason) {
		case "http-method": return rejection("http-method", "modern-only-method-not-allowed", 405, new ProtocolError(-32e3, "Method not allowed."), true);
		case "batch": return rejection("jsonrpc-shape", "modern-only-batch-not-supported", 400, new ProtocolError(ProtocolErrorCode.InvalidRequest, "Bad Request: JSON-RPC batches are not supported by this endpoint"), true);
		case "response": return rejection("jsonrpc-shape", "modern-only-response-post", 400, new ProtocolError(ProtocolErrorCode.InvalidRequest, "Bad Request: JSON-RPC responses cannot be posted to this endpoint"), true);
		case "notification": return;
		case "initialize":
		case "no-claim": {
			const requested = route.requestedVersion;
			return rejection("era-classification", "modern-only-missing-envelope", 400, requested === void 0 ? new ProtocolError(ProtocolErrorCode.UnsupportedProtocolVersion, "Unsupported protocol version: the request did not name a protocol version", { supported: [...supportedVersions] }) : new UnsupportedProtocolVersionError({
				supported: [...supportedVersions],
				requested
			}), true);
		}
	}
}

//#endregion
//#region ../core-internal/src/util/schema.ts
/**
* Internal Zod schema utilities for protocol handling.
* These are used internally by the SDK for protocol message validation.
*/
/**
* Parses data against a Zod schema (synchronous).
* Returns a discriminated union with success/error.
*/
function parseSchema(schema, data) {
	return zod_v4.safeParse(schema, data);
}
/**
* Union of the declared shape keys across several Zod object schemas.
*/
function shapeKeys(schemas) {
	return new Set(schemas.flatMap((schema) => Object.keys(schema.shape)));
}

//#endregion
//#region ../core-internal/src/util/standardSchema.ts
/**
* Standard Schema utilities for user-provided schemas.
* Supports Zod v4, Valibot, ArkType, and other Standard Schema implementations.
* @see https://standardschema.dev
*/
function isStandardSchema(schema) {
	if (schema == null) return false;
	const schemaType = typeof schema;
	if (schemaType !== "object" && schemaType !== "function") return false;
	if (!("~standard" in schema)) return false;
	return typeof schema["~standard"]?.validate === "function";
}
let warnedZodFallback = false;
/** JSON Schema draft targeted by every conversion; shared so pattern references above stay in lockstep. */
const JSON_SCHEMA_CONVERSION_TARGET = "draft-2020-12";
/**
* Converts a StandardSchema to JSON Schema for use as an MCP tool/prompt schema.
*
* MCP requires `type: "object"` at the root of tool `inputSchema` and prompt
* argument schemas; `outputSchema` may have any JSON Schema root (SEP-2106).
* Zod's discriminated unions emit `{oneOf: [...]}` without a top-level `type`,
* so for `io: 'input'` this function defaults `type` to `"object"` when absent
* and throws on an explicit non-object `type` (e.g. `z.string()`). For
* `io: 'output'` a non-object root is returned as-is; the `"object"` default is
* applied only when the root is provably object-shaped.
*/
function standardSchemaToJsonSchema(schema, io = "input") {
	const std = schema["~standard"];
	let result;
	if (std.jsonSchema) result = std.jsonSchema[io]({ target: JSON_SCHEMA_CONVERSION_TARGET });
	else if (std.vendor === "zod") {
		if (!("_zod" in schema)) throw new Error("Schema appears to be from zod 3, which the SDK cannot convert to JSON Schema. Upgrade to zod >=4.2.0, or wrap your JSON Schema with fromJsonSchema().");
		if (!warnedZodFallback) {
			warnedZodFallback = true;
			console.warn("[mcp-sdk] Your zod version does not implement `~standard.jsonSchema` (added in zod 4.2.0). Falling back to z.toJSONSchema(). Upgrade to zod >=4.2.0 to silence this warning.");
		}
		result = zod_v4.toJSONSchema(schema, {
			target: JSON_SCHEMA_CONVERSION_TARGET,
			io
		});
	} else throw new Error(`Schema library "${std.vendor}" does not implement StandardJSONSchemaV1 (\`~standard.jsonSchema\`). Upgrade to a version that does, or wrap your JSON Schema with fromJsonSchema().`);
	if (io === "output") {
		if (result.type !== void 0) return result;
		return isProvablyObjectShapedRoot(result) ? {
			type: "object",
			...result
		} : result;
	}
	if (result.type !== void 0 && result.type !== "object") throw new Error(`MCP tool and prompt schemas must describe objects (got type: ${JSON.stringify(result.type)}). Wrap your schema in z.object({...}) or equivalent.`);
	return {
		type: "object",
		...result
	};
}
const LOCAL_DEFINITION_REF = /^#\/(\$defs|definitions)\/([^/~%]+)$/;
/**
* A typeless JSON Schema root is "provably object-shaped" when either it carries object keywords
* directly (`properties`/`patternProperties`/`additionalProperties`/`required`), or it is a
* composition (`oneOf`/`anyOf`/`allOf`) whose every member is itself `type:'object'` or recursively
* provably object-shaped (e.g. a nested `discriminatedUnion`). A `$ref` is followed one hop, to an
* entry of the root's `$defs`/`definitions` that is itself `type:'object'`. Used to
* decide whether stamping `type:'object'` is safe (redundant-but-valid) versus self-contradictory.
*/
function isProvablyObjectShapedRoot(schema, root = schema) {
	if ("properties" in schema || "patternProperties" in schema || "additionalProperties" in schema || "required" in schema) return true;
	const ref = typeof schema.$ref === "string" && LOCAL_DEFINITION_REF.exec(schema.$ref);
	if (ref && root[ref[1]]?.[ref[2]]?.type === "object") return true;
	for (const key of [
		"oneOf",
		"anyOf",
		"allOf"
	]) {
		const members = schema[key];
		if (Array.isArray(members) && members.length > 0) return members.every((m) => m !== null && typeof m === "object" && (m.type === "object" || isProvablyObjectShapedRoot(m, "$id" in m ? {} : root)));
	}
	return false;
}
function formatIssue(issue) {
	if (!issue.path?.length) return issue.message;
	return `${issue.path.map((p) => String(typeof p === "object" ? p.key : p)).join(".")}: ${issue.message}`;
}
async function validateStandardSchema(schema, data) {
	const result = await schema["~standard"].validate(data);
	if (result.issues && result.issues.length > 0) return {
		success: false,
		error: result.issues.map((i) => formatIssue(i)).join(", ")
	};
	return {
		success: true,
		data: result.value
	};
}
function zodEmittedPattern(schema) {
	const jsonSchema = zod_v4.toJSONSchema(schema, {
		target: JSON_SCHEMA_CONVERSION_TARGET,
		io: "input"
	});
	return typeof jsonSchema.pattern === "string" ? jsonSchema.pattern : void 0;
}
const DATETIME_FRACTION_DIGITS = /\\\.\\d\{(\d+)\}/;
function datetimeReferenceSchemas(pattern) {
	const fractionDigits = DATETIME_FRACTION_DIGITS.exec(pattern);
	const precisions = [
		void 0,
		-1,
		0
	];
	if (fractionDigits) precisions.push(Number(fractionDigits[1]));
	return [false, true].flatMap((local) => [false, true].flatMap((offset) => precisions.map((precision) => zod_v4.iso.datetime({
		local,
		offset,
		precision
	}))));
}
function referencePatternsForFormat(format, pattern) {
	let referenceSchemas;
	switch (format) {
		case "email":
			referenceSchemas = [zod_v4.email()];
			break;
		case "uri":
			referenceSchemas = [zod_v4.url()];
			break;
		case "date":
			referenceSchemas = [zod_v4.iso.date()];
			break;
		case "date-time":
			referenceSchemas = datetimeReferenceSchemas(pattern);
			break;
	}
	return new Set(referenceSchemas.map((schema) => zodEmittedPattern(schema)).filter((emitted) => emitted !== void 0));
}
/** Whether `pattern` is the library's own realization of `format` (droppable) rather than a user customization. */
function isLibraryFormatPattern(format, pattern, vendor) {
	if (vendor !== "zod") return true;
	return referencePatternsForFormat(format, pattern).has(pattern);
}
function promptArgumentsFromStandardSchema(schema) {
	const jsonSchema = standardSchemaToJsonSchema(schema, "input");
	const properties = jsonSchema.properties || {};
	const required = jsonSchema.required || [];
	return Object.entries(properties).map(([name, prop]) => ({
		name,
		description: prop?.description,
		required: required.includes(name)
	}));
}

//#endregion
//#region ../core-internal/src/shared/elicitation.ts
function isJsonObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function convertStandardElicitationSchema(schema) {
	try {
		return standardSchemaToJsonSchema(schema, "input");
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Elicitation requestedSchema must describe an object with flat primitive properties: ${detail}`);
	}
}
const ANNOTATION_ONLY_JSON_SCHEMA_KEYWORDS = new Set([
	"$comment",
	"deprecated",
	"description",
	"examples",
	"readOnly",
	"title",
	"writeOnly"
]);
function isAnnotationOnlyJsonSchemaKeyword(key) {
	return ANNOTATION_ONLY_JSON_SCHEMA_KEYWORDS.has(key) || key.startsWith("x-");
}
const ROOT_KEYS = new Set(["$schema", ...Object.keys(_modelcontextprotocol_core_internal.ElicitRequestFormParamsSchema.shape.requestedSchema.shape)]);
const PROPERTY_KEYS_BY_TYPE = {
	string: shapeKeys([
		_modelcontextprotocol_core_internal.StringSchemaSchema,
		_modelcontextprotocol_core_internal.UntitledSingleSelectEnumSchemaSchema,
		_modelcontextprotocol_core_internal.TitledSingleSelectEnumSchemaSchema,
		_modelcontextprotocol_core_internal.LegacyTitledEnumSchemaSchema
	]),
	number: shapeKeys([_modelcontextprotocol_core_internal.NumberSchemaSchema]),
	integer: shapeKeys([_modelcontextprotocol_core_internal.NumberSchemaSchema]),
	boolean: shapeKeys([_modelcontextprotocol_core_internal.BooleanSchemaSchema]),
	array: shapeKeys([_modelcontextprotocol_core_internal.UntitledMultiSelectEnumSchemaSchema, _modelcontextprotocol_core_internal.TitledMultiSelectEnumSchemaSchema])
};
const SUPPORTED_STRING_FORMATS = new Set(_modelcontextprotocol_core_internal.StringSchemaSchema.shape.format.unwrap().options);
/** Walks one property node: keeps grammar keys, drops the library format pattern, rejects unknown constraints. */
function walkProperty(node, path, vendor, unsupported) {
	if (!isJsonObject(node)) return node;
	const allowedKeys = typeof node.type === "string" && Object.hasOwn(PROPERTY_KEYS_BY_TYPE, node.type) ? PROPERTY_KEYS_BY_TYPE[node.type] : void 0;
	if (allowedKeys === void 0) return node;
	const pruned = {};
	for (const [key, value] of Object.entries(node)) if (allowedKeys.has(key) || isAnnotationOnlyJsonSchemaKeyword(key)) pruned[key] = value;
	else if (key === "pattern" && node.type === "string" && typeof node.format === "string") {
		if (!SUPPORTED_STRING_FORMATS.has(node.format)) pruned[key] = value;
		else if (typeof value !== "string" || !isLibraryFormatPattern(node.format, value, vendor)) unsupported.push(`${path}.${key}`);
	} else unsupported.push(`${path}.${key}`);
	return pruned;
}
/** Walks the schema root: keeps the spec root keys, drops annotations, rejects the rest. */
function walkRequestedSchema(converted, vendor) {
	const pruned = {};
	const unsupported = [];
	for (const [key, value] of Object.entries(converted)) if (key === "properties" && isJsonObject(value)) pruned[key] = Object.fromEntries(Object.entries(value).map(([name, node]) => [name, walkProperty(node, `properties.${name}`, vendor, unsupported)]));
	else if (ROOT_KEYS.has(key)) pruned[key] = value;
	else if (!isAnnotationOnlyJsonSchemaKeyword(key)) unsupported.push(key);
	if (unsupported.length > 0) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Elicitation requestedSchema contains unsupported JSON Schema constraint(s) after Standard Schema conversion: ${unsupported.join(", ")}`);
	return pruned;
}
/** Names the properties that fail value validation, instead of surfacing a raw union dump. */
function describeUnsupportedProperties(pruned, fallback) {
	if (!isJsonObject(pruned.properties)) return fallback;
	const offenders = Object.entries(pruned.properties).filter(([, node]) => !parseSchema(_modelcontextprotocol_core_internal.PrimitiveSchemaDefinitionSchema, node).success).map(([name]) => `properties.${name}`);
	return offenders.length > 0 ? offenders.join(", ") : fallback;
}
function findDroppedConstraintPaths(original, parsed, path = "") {
	if (Array.isArray(original) && Array.isArray(parsed)) return original.flatMap((item, index) => findDroppedConstraintPaths(item, parsed[index], `${path}[${index}]`));
	if (!isJsonObject(original) || !isJsonObject(parsed)) return [];
	return Object.entries(original).flatMap(([key, value]) => {
		const childPath = path ? `${path}.${key}` : key;
		if (!Object.prototype.hasOwnProperty.call(parsed, key)) return isAnnotationOnlyJsonSchemaKeyword(key) ? [] : [childPath];
		return findDroppedConstraintPaths(value, parsed[key], childPath);
	});
}
/** Converts an authoring-friendly elicitation input into its wire-ready form. */
function normalizeElicitInputParams(input) {
	if (!isStandardSchema(input.requestedSchema)) return {
		...input,
		mode: "form",
		requestedSchema: input.requestedSchema
	};
	const vendor = input.requestedSchema["~standard"].vendor;
	const pruned = walkRequestedSchema(convertStandardElicitationSchema(input.requestedSchema), vendor);
	const parsed = parseSchema(_modelcontextprotocol_core_internal.ElicitRequestFormParamsSchema.shape.requestedSchema, pruned);
	if (!parsed.success) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Elicitation requestedSchema only supports flat primitive properties (string, number, integer, boolean, and string enums): ${describeUnsupportedProperties(pruned, parsed.error.message)}`);
	const droppedConstraints = findDroppedConstraintPaths(pruned, parsed.data);
	if (droppedConstraints.length > 0) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Elicitation requestedSchema contains unsupported JSON Schema constraint(s) after Standard Schema conversion: ${droppedConstraints.join(", ")}`);
	const danglingRequired = (parsed.data.required ?? []).filter((key) => !Object.prototype.hasOwnProperty.call(parsed.data.properties, key));
	if (danglingRequired.length > 0) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Elicitation requestedSchema lists required properties that are not defined in properties: ${danglingRequired.join(", ")}`);
	return {
		...input,
		mode: "form",
		requestedSchema: parsed.data
	};
}

//#endregion
//#region ../core-internal/src/shared/inputRequired.ts
/**
* Authoring helpers for multi-round-trip requests (protocol revision
* 2026-07-28).
*
* A handler for one of the multi-round-trip methods (`tools/call`,
* `prompts/get`, `resources/read`) requests additional client input by
* returning an {@linkcode InputRequiredResult} instead of a final result. The
* helpers here build that return value and its embedded requests as NEUTRAL
* values; only the 2026-07-28 wire codec maps them to/from the wire. The
* 2025-era codec has no input-required vocabulary — on a 2025-era request the
* server's legacy shim (on by default) fulfils the embedded requests as real
* server→client requests and re-enters the handler, so the same return shape
* serves both eras; `ServerOptions.inputRequired.legacyShim: false` restores
* the pre-shim loud failure.
*
* There is no nominal brand: `resultType: 'input_required'` is the
* discriminator, and hand-built result literals are equally legal — the
* server seam re-checks the at-least-one rule for them.
*/
function buildInputRequired(spec) {
	const hasInputRequests = spec.inputRequests !== void 0 && Object.keys(spec.inputRequests).length > 0;
	const hasRequestState = typeof spec.requestState === "string";
	if (!hasInputRequests && !hasRequestState) throw new TypeError("inputRequired() requires at least one of inputRequests (with at least one entry) or requestState (spec: every InputRequiredResult MUST include at least one of the two)");
	return {
		resultType: "input_required",
		...spec.inputRequests !== void 0 && { inputRequests: spec.inputRequests },
		...spec.requestState !== void 0 && { requestState: spec.requestState }
	};
}
/**
* Builder for the input-required return value of multi-round-trip handlers,
* with per-kind constructors for the embedded requests
* (`inputRequired.elicit`, `inputRequired.elicitUrl`,
* `inputRequired.createMessage`, `inputRequired.listRoots`).
*
* @example Write-once tool requesting confirmation
* ```ts
* server.registerTool('deploy', { inputSchema: z.object({ env: z.string() }) }, async ({ env }, ctx) => {
*     const confirmationSchema = z.object({ confirm: z.boolean() });
*     const confirmed = acceptedContent(ctx.mcpReq.inputResponses, 'confirm', confirmationSchema);
*     if (confirmed?.confirm !== true) {
*         return inputRequired({
*             inputRequests: {
*                 confirm: inputRequired.elicit({
*                     message: `Deploy to ${env}?`,
*                     requestedSchema: confirmationSchema
*                 })
*             }
*         });
*     }
*     return { content: [{ type: 'text', text: `deployed to ${env}` }] };
* });
* ```
*/
const inputRequired = Object.assign(buildInputRequired, {
	elicit(params) {
		try {
			return {
				method: "elicitation/create",
				params: normalizeElicitInputParams(params)
			};
		} catch (error) {
			throw error instanceof ProtocolError ? new TypeError(error.message, { cause: error }) : error;
		}
	},
	elicitUrl(params) {
		return {
			method: "elicitation/create",
			params: {
				...params,
				mode: "url"
			}
		};
	},
	createMessage(params) {
		return {
			method: "sampling/createMessage",
			params
		};
	},
	listRoots() {
		return { method: "roots/list" };
	}
});
function acceptedContent(responses, key, schema) {
	const view = inputResponse(responses, key);
	if (view.kind !== "elicit" || view.action !== "accept" || view.content === void 0) return void 0;
	if (schema === void 0) return view.content;
	const outcome = schema["~standard"].validate(view.content);
	if (outcome instanceof Promise) throw new TypeError("acceptedContent(responses, key, schema) requires a synchronously-validating schema");
	return outcome.issues === void 0 ? outcome.value : void 0;
}
/**
* Reads one entry of a retried request's `inputResponses`
* (`ctx.mcpReq.inputResponses`) as a discriminated view, covering
* decline/cancel detection and the non-elicitation response kinds that
* {@linkcode acceptedContent} does not surface.
*
* The values arrive from the client and are not re-validated here — treat
* them as untrusted input (validate elicitation content with the
* schema-aware {@linkcode acceptedContent} overload where it matters).
*/
function inputResponse(responses, key) {
	if (responses === void 0 || typeof responses !== "object" || responses === null) return { kind: "missing" };
	const entry = responses[key];
	if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return { kind: "missing" };
	const candidate = entry;
	if (candidate["action"] === "accept" || candidate["action"] === "decline" || candidate["action"] === "cancel") {
		const content = candidate["content"];
		return {
			kind: "elicit",
			action: candidate["action"],
			...content !== null && typeof content === "object" && !Array.isArray(content) && { content }
		};
	}
	if (Array.isArray(candidate["roots"])) return {
		kind: "roots",
		roots: candidate["roots"]
	};
	if (typeof candidate["role"] === "string" && candidate["content"] !== void 0) return {
		kind: "sampling",
		result: candidate
	};
	return { kind: "missing" };
}

//#endregion
//#region ../core-internal/src/shared/inputRequiredDriver.ts
/**
* The multi-round-trip auto-fulfilment driver (protocol revision 2026-07-28).
*
* When a request to one of the multi-round-trip methods comes back as
* `input_required`, the driver fulfils the embedded input requests by
* dispatching them to the client's already-registered handlers (elicitation,
* sampling, roots — one generic engine, no per-feature API), then retries the
* original request with the collected `inputResponses` and a byte-exact echo
* of `requestState`, on a fresh request id, until the server returns a
* complete result or the round cap is exhausted.
*
* The driver is a LAYER OVER THE MANUAL PATH: each retry is issued with the
* same primitive a manual caller uses (`allowInputRequired` semantics — the
* retry hands back the next `input_required` payload instead of recursing),
* so the loop, the cap, and the pacing live in one place and disabling
* auto-fulfilment (`inputRequired.autoFulfill: false`) simply skips this
* module. Timeouts ride the EXISTING knobs: the per-leg `timeout` applies to
* every wire leg unchanged, and `maxTotalTimeout` bounds the whole flow by
* shrinking the budget passed to each leg — no new timer system.
*/
/**
* Fixed pacing applied before retrying a requestState-only (load-shedding)
* leg — a leg that carries no embedded input requests, so nothing slows the
* loop down naturally. Counted in the same round cap.
*/
const REQUEST_STATE_ONLY_LEG_PACING_MS = 250;
/**
* The message both multi-round-trip loops emit when the round cap is
* exhausted — the client driver as a typed error, the server-side legacy
* shim as its per-family failure. One formatter so the texts cannot drift
* (hosts and models read the tool-result copy verbatim).
*/
function inputRequiredRoundsExceededMessage(method, maxRounds) {
	return `Multi-round-trip request '${method}' still required input after ${maxRounds} rounds (inputRequired.maxRounds)`;
}
/**
* Abortable delay: resolves after `ms`, or rejects with the signal's reason
* (wrapped in an `SdkError` when it isn't already one) if the signal aborts
* first. Aborting after resolution is a no-op. Shared with the server-side
* legacy shim (the pacing semantics must match per era).
*/
function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason instanceof SdkError ? signal.reason : new SdkError(SdkErrorCode.RequestTimeout, String(signal.reason)));
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason instanceof SdkError ? signal.reason : new SdkError(SdkErrorCode.RequestTimeout, String(signal?.reason)));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
/**
* A per-round abort linked to the caller's signal: the embedded sibling
* dispatches share it, so the first failure (or a caller abort) cancels the
* others instead of leaving them running. Shared with the server-side legacy
* shim (the abort-linkage semantics must match per era).
*/
function linkedRoundAbort(outer) {
	const controller = new AbortController();
	const onOuterAbort = () => controller.abort(outer?.reason);
	outer?.addEventListener("abort", onOuterAbort, { once: true });
	if (outer?.aborted) controller.abort(outer.reason);
	return {
		signal: controller.signal,
		abort: (reason) => controller.abort(reason),
		dispose: () => outer?.removeEventListener("abort", onOuterAbort)
	};
}

//#endregion
//#region ../core-internal/src/types/specTypeSchema.ts
/**
* Explicit allowlist of protocol Zod schemas that correspond to a public spec type in `types.ts`.
*
* This intentionally excludes internal helper schemas exported from `schemas.ts` that have no
* matching public type (e.g. `ListChangedOptionsBaseSchema`, `BaseRequestParamsSchema`,
* `NotificationsParamsSchema`, `ClientTasksCapabilitySchema`, `ServerTasksCapabilitySchema`).
* Keeping the list explicit means new public spec types must be added here deliberately, and
* internals never leak into `SpecTypeName`.
*
* `ResourceTemplateSchema` is included; its public type is exported as `ResourceTemplateType`
* (the bare name collides with the server package's `ResourceTemplate` class), so
* `SpecTypes['ResourceTemplate']` is structurally equal to `ResourceTemplateType` rather than to
* a type literally named `ResourceTemplate`.
*/
const SPEC_SCHEMA_KEYS = [
	"AnnotationsSchema",
	"AudioContentSchema",
	"BaseMetadataSchema",
	"BlobResourceContentsSchema",
	"BooleanSchemaSchema",
	"CallToolRequestSchema",
	"CallToolRequestParamsSchema",
	"CallToolResultSchema",
	"CancelledNotificationSchema",
	"CancelledNotificationParamsSchema",
	"CancelTaskRequestSchema",
	"CancelTaskResultSchema",
	"ClientCapabilitiesSchema",
	"ClientNotificationSchema",
	"ClientRequestSchema",
	"ClientResultSchema",
	"CompatibilityCallToolResultSchema",
	"CompleteRequestSchema",
	"CompleteRequestParamsSchema",
	"CompleteResultSchema",
	"ContentBlockSchema",
	"CreateMessageRequestSchema",
	"CreateMessageRequestParamsSchema",
	"CreateMessageResultSchema",
	"CreateMessageResultWithToolsSchema",
	"CreateTaskResultSchema",
	"CursorSchema",
	"DiscoverRequestSchema",
	"DiscoverResultSchema",
	"ElicitationCompleteNotificationSchema",
	"ElicitationCompleteNotificationParamsSchema",
	"ElicitRequestSchema",
	"ElicitRequestFormParamsSchema",
	"ElicitRequestParamsSchema",
	"ElicitRequestURLParamsSchema",
	"ElicitResultSchema",
	"EmbeddedResourceSchema",
	"EmptyResultSchema",
	"EnumSchemaSchema",
	"GetPromptRequestSchema",
	"GetPromptRequestParamsSchema",
	"GetPromptResultSchema",
	"GetTaskPayloadRequestSchema",
	"GetTaskPayloadResultSchema",
	"GetTaskRequestSchema",
	"GetTaskResultSchema",
	"IconSchema",
	"IconsSchema",
	"ImageContentSchema",
	"ImplementationSchema",
	"InitializedNotificationSchema",
	"InitializeRequestSchema",
	"InitializeRequestParamsSchema",
	"InitializeResultSchema",
	"JSONArraySchema",
	"JSONObjectSchema",
	"JSONRPCErrorResponseSchema",
	"JSONRPCMessageSchema",
	"JSONRPCNotificationSchema",
	"JSONRPCRequestSchema",
	"JSONRPCResponseSchema",
	"JSONRPCResultResponseSchema",
	"JSONValueSchema",
	"LegacyTitledEnumSchemaSchema",
	"ListPromptsRequestSchema",
	"ListPromptsResultSchema",
	"ListResourcesRequestSchema",
	"ListResourcesResultSchema",
	"ListResourceTemplatesRequestSchema",
	"ListResourceTemplatesResultSchema",
	"ListRootsRequestSchema",
	"ListRootsResultSchema",
	"ListTasksRequestSchema",
	"ListTasksResultSchema",
	"ListToolsRequestSchema",
	"ListToolsResultSchema",
	"LoggingLevelSchema",
	"LoggingMessageNotificationSchema",
	"LoggingMessageNotificationParamsSchema",
	"ModelHintSchema",
	"ModelPreferencesSchema",
	"MultiSelectEnumSchemaSchema",
	"NotificationSchema",
	"NumberSchemaSchema",
	"PaginatedRequestSchema",
	"PaginatedRequestParamsSchema",
	"PaginatedResultSchema",
	"PingRequestSchema",
	"PrimitiveSchemaDefinitionSchema",
	"ProgressSchema",
	"ProgressNotificationSchema",
	"ProgressNotificationParamsSchema",
	"ProgressTokenSchema",
	"PromptSchema",
	"PromptArgumentSchema",
	"PromptListChangedNotificationSchema",
	"PromptMessageSchema",
	"PromptReferenceSchema",
	"ReadResourceRequestSchema",
	"ReadResourceRequestParamsSchema",
	"ReadResourceResultSchema",
	"RelatedTaskMetadataSchema",
	"RequestSchema",
	"RequestIdSchema",
	"RequestMetaSchema",
	"ResourceSchema",
	"ResourceContentsSchema",
	"ResourceLinkSchema",
	"ResourceListChangedNotificationSchema",
	"ResourceRequestParamsSchema",
	"ResourceTemplateSchema",
	"ResourceTemplateReferenceSchema",
	"ResourceUpdatedNotificationSchema",
	"ResourceUpdatedNotificationParamsSchema",
	"ResultMetaObjectSchema",
	"ResultSchema",
	"RoleSchema",
	"RootSchema",
	"RootsListChangedNotificationSchema",
	"SamplingContentSchema",
	"SamplingMessageSchema",
	"SamplingMessageContentBlockSchema",
	"ServerCapabilitiesSchema",
	"ServerNotificationSchema",
	"ServerRequestSchema",
	"ServerResultSchema",
	"SetLevelRequestSchema",
	"SetLevelRequestParamsSchema",
	"SingleSelectEnumSchemaSchema",
	"StringSchemaSchema",
	"SubscribeRequestSchema",
	"SubscribeRequestParamsSchema",
	"SubscriptionFilterSchema",
	"SubscriptionsAcknowledgedNotificationSchema",
	"SubscriptionsAcknowledgedNotificationParamsSchema",
	"SubscriptionsListenRequestSchema",
	"SubscriptionsListenRequestParamsSchema",
	"SubscriptionsListenResultSchema",
	"SubscriptionsListenResultMetaSchema",
	"TaskAugmentedRequestParamsSchema",
	"TaskCreationParamsSchema",
	"TaskMetadataSchema",
	"TaskSchema",
	"TaskStatusSchema",
	"TaskStatusNotificationSchema",
	"TaskStatusNotificationParamsSchema",
	"TextContentSchema",
	"TextResourceContentsSchema",
	"TitledMultiSelectEnumSchemaSchema",
	"TitledSingleSelectEnumSchemaSchema",
	"ToolSchema",
	"ToolAnnotationsSchema",
	"ToolChoiceSchema",
	"ToolExecutionSchema",
	"ToolListChangedNotificationSchema",
	"ToolResultContentSchema",
	"ToolUseContentSchema",
	"UnsubscribeRequestSchema",
	"UnsubscribeRequestParamsSchema",
	"UntitledMultiSelectEnumSchemaSchema",
	"UntitledSingleSelectEnumSchemaSchema"
];
const authSchemas = {
	IdJagTokenExchangeResponseSchema: _modelcontextprotocol_core_internal.IdJagTokenExchangeResponseSchema,
	OAuthClientInformationFullSchema: _modelcontextprotocol_core_internal.OAuthClientInformationFullSchema,
	OAuthClientInformationSchema: _modelcontextprotocol_core_internal.OAuthClientInformationSchema,
	OAuthClientMetadataSchema: _modelcontextprotocol_core_internal.OAuthClientMetadataSchema,
	OAuthClientRegistrationErrorSchema: _modelcontextprotocol_core_internal.OAuthClientRegistrationErrorSchema,
	OAuthErrorResponseSchema: _modelcontextprotocol_core_internal.OAuthErrorResponseSchema,
	OAuthMetadataSchema: _modelcontextprotocol_core_internal.OAuthMetadataSchema,
	OAuthProtectedResourceMetadataSchema: _modelcontextprotocol_core_internal.OAuthProtectedResourceMetadataSchema,
	OAuthTokenRevocationRequestSchema: _modelcontextprotocol_core_internal.OAuthTokenRevocationRequestSchema,
	OAuthTokensSchema: _modelcontextprotocol_core_internal.OAuthTokensSchema,
	OpenIdProviderDiscoveryMetadataSchema: _modelcontextprotocol_core_internal.OpenIdProviderDiscoveryMetadataSchema,
	OpenIdProviderMetadataSchema: _modelcontextprotocol_core_internal.OpenIdProviderMetadataSchema
};
const _specTypeSchemas = {};
const _isSpecType = {};
function register(key, schema) {
	const name = key.slice(0, -6);
	_specTypeSchemas[name] = schema;
	_isSpecType[name] = (v) => schema.safeParse(v).success;
}
for (const key of SPEC_SCHEMA_KEYS) register(key, schemas_exports[key]);
for (const [key, schema] of Object.entries(authSchemas)) register(key, schema);
/**
* Runtime validators for every MCP spec type, keyed by type name.
*
* Use this when you need to validate a spec-defined shape at a boundary the SDK does not own, for
* example an extension's custom-method payload that embeds a `CallToolResult`, or a value read from
* storage that should be a `Tool`.
*
* Each entry implements the Standard Schema interface, so it composes with any
* Standard-Schema-aware library. For a simple boolean check, use {@linkcode isSpecType} instead.
*
* @example
* ```ts source="./specTypeSchema.examples.ts#specTypeSchemas_basicUsage"
* const result = specTypeSchemas.CallToolResult['~standard'].validate(untrusted);
* if (result.issues === undefined) {
*     // result.value is CallToolResult
* }
* ```
*/
const specTypeSchemas = Object.freeze(_specTypeSchemas);
/**
* Type predicates for every MCP spec type, keyed by type name.
*
* Returns `true` if the value satisfies the schema's input type (`z.input<>`, before defaults and
* transforms are applied), and narrows to that input type. For schemas with `.default()` or
* `.preprocess()`, this may accept values that do not structurally match the named output type;
* for example `isSpecType.CallToolResult({})` is `true` because `content` has a default. Use
* `specTypeSchemas.X['~standard'].validate(value)` when you need the validated output value.
*
* Each guard is a standalone function, so it can be passed directly as a callback.
*
* @example
* ```ts source="./specTypeSchema.examples.ts#isSpecType_basicUsage"
* if (isSpecType.ContentBlock(value)) {
*     // value is ContentBlock
* }
*
* const blocks = mixed.filter(isSpecType.ContentBlock);
* ```
*/
const isSpecType = Object.freeze(_isSpecType);

//#endregion
//#region ../core-internal/src/wire/bootstrap.ts
function bootstrapOutboundCodec(method) {
	switch (method) {
		case "initialize":
		case "notifications/initialized": return codecForVersion(void 0);
		case "server/discover": return codecForVersion(MODERN_WIRE_REVISION);
		default: return;
	}
}

//#endregion
//#region ../core-internal/src/shared/protocol.ts
/**
* The default request timeout, in milliseconds.
*/
const DEFAULT_REQUEST_TIMEOUT_MSEC = 6e4;
/**
* The reserved per-request `_meta` envelope keys (protocol revision
* 2026-07-28). The protocol layer lifts these out of inbound `_meta` before
* handlers run and surfaces them at `ctx.mcpReq.envelope` — they are
* wire-level bookkeeping, not handler material.
*/
const RESERVED_ENVELOPE_META_KEYS = [
	_modelcontextprotocol_core_internal.PROTOCOL_VERSION_META_KEY,
	_modelcontextprotocol_core_internal.CLIENT_INFO_META_KEY,
	_modelcontextprotocol_core_internal.CLIENT_CAPABILITIES_META_KEY,
	_modelcontextprotocol_core_internal.LOG_LEVEL_META_KEY
];
/**
* Top-level params members carrying multi-round-trip driver material
* (protocol revision 2026-07-28). The spec reserves these names on
* client-initiated REQUESTS only — notification params keep them untouched
* (a vendor notification may legitimately use the same names).
*/
const RETRY_PARAMS_KEYS = ["inputResponses", "requestState"];
/**
* Lift wire-only material out of an inbound message so handlers see exactly
* the 2025-era shape, and surface it for the protocol layer (requests: via
* `ctx.mcpReq`). What counts as wire-only depends on the message kind: the
* reserved envelope `_meta` keys are reserved on every message, while the
* multi-round-trip retry fields (`inputResponses`/`requestState`) are
* reserved on client-initiated requests only — so notifications get only the
* envelope lift, and their top-level params stay untouched. Messages without
* wire-only material are returned unchanged (same reference).
*/
function liftWireOnlyMaterial(message, kind) {
	const params = message.params;
	if (!isPlainObject$1(params)) return {
		message,
		lifted: {}
	};
	const meta = params._meta;
	const envelopeKeys = isPlainObject$1(meta) ? RESERVED_ENVELOPE_META_KEYS.filter((key) => key in meta) : [];
	const retryKeys = kind === "request" ? RETRY_PARAMS_KEYS.filter((key) => key in params) : [];
	if (envelopeKeys.length === 0 && retryKeys.length === 0) return {
		message,
		lifted: {}
	};
	const lifted = {};
	const nextParams = { ...params };
	if (envelopeKeys.length > 0 && isPlainObject$1(meta)) {
		const envelope = {};
		const nextMeta = { ...meta };
		for (const key of envelopeKeys) {
			envelope[key] = meta[key];
			delete nextMeta[key];
		}
		lifted.envelope = envelope;
		if (Object.keys(nextMeta).length > 0) nextParams._meta = nextMeta;
		else delete nextParams._meta;
	}
	for (const key of retryKeys) {
		if (key === "inputResponses") lifted.inputResponses = nextParams[key];
		if (key === "requestState") lifted.requestState = nextParams[key];
		delete nextParams[key];
	}
	return {
		message: {
			...message,
			params: nextParams
		},
		lifted
	};
}
/**
* Standard Schema adapter over the era codec's `validateResult` function (the
* function-only WireCodec contract exposes no schema objects). Used by the
* spec-method `request()` overload so the request funnel keeps a single
* `StandardSchemaV1`-shaped validation seam for both spec and explicit-schema
* paths.
*
* Returns `undefined` when the method has no result entry on this era's
* registry — the caller maps that to the synchronous "pass a result schema"
* TypeError, exactly matching the pre-function-only behavior the
* typedMapAlignment suite pins (the result map deliberately excludes the
* `tasks/*` methods, so the spec-method overload refuses them up front).
*/
function codecResultValidator(codec, method) {
	const probe = codec.validateResult(method, void 0);
	if (!probe.ok && probe.reason === "not-in-era") return void 0;
	return { "~standard": {
		version: 1,
		vendor: "mcp-wire-codec",
		validate(value) {
			const outcome = codec.validateResult(method, value);
			if (outcome.ok) return { value: outcome.value };
			return { issues: [{ message: outcome.reason === "invalid" ? outcome.message : `not-in-era: ${method}` }] };
		}
	} };
}
/**
* Builds the `ctx.mcpReq.requestState` accessor for a resolved value. The
* `as T` below is the one place {@linkcode RequestStateAccessor}'s
* caller-asserted typing is implemented — no implementation can produce an
* arbitrary `T` from a runtime value honestly.
*/
function requestStateAccessor(value) {
	return () => value;
}
/** Shared no-state accessor: the common case allocates nothing per request. */
const NO_REQUEST_STATE = requestStateAccessor(void 0);
/**
* Returns a context whose `requestState` accessor reads the given value —
* how the server seam hands a verify hook's decoded payload (or the legacy
* shim's per-round echo) to the handler without mutating the original
* context.
*/
function withRequestStateValue(ctx, value) {
	return {
		...ctx,
		mcpReq: {
			...ctx.mcpReq,
			requestState: requestStateAccessor(value)
		}
	};
}
let writeNegotiatedProtocolVersion;
/**
* Package-internal write channel for a {@linkcode Protocol} instance's
* negotiated protocol version, for callers outside the class hierarchy:
* tests and the (future) modern-era server entry that marks a factory
* instance modern at binding time. Exported on the core internal barrel
* only — never public API.
*/
function setNegotiatedProtocolVersion(instance, version) {
	writeNegotiatedProtocolVersion(instance, version);
}
/**
* Implements MCP protocol framing on top of a pluggable transport, including
* features like request/response linking, notifications, and progress.
*
* `Protocol` is abstract; `Client` and `Server` are the concrete role-specific
* implementations most code should use.
*/
var Protocol = class {
	_transport;
	_requestMessageId = 0;
	_requestHandlers = /* @__PURE__ */ new Map();
	/** Methods registered with an explicit schema; the era gate in `_onrequest` reads it for the Tasks extension names. */
	_customSchemaRequestMethods = /* @__PURE__ */ new Set();
	_requestHandlerAbortControllers = /* @__PURE__ */ new Map();
	_notificationHandlers = /* @__PURE__ */ new Map();
	_responseHandlers = /* @__PURE__ */ new Map();
	_progressHandlers = /* @__PURE__ */ new Map();
	_timeoutInfo = /* @__PURE__ */ new Map();
	_pendingDebouncedNotifications = /* @__PURE__ */ new Set();
	/**
	* The protocol version negotiated for the current connection (`undefined`
	* before negotiation completes), which determines the wire era this
	* instance speaks. Set by the SDK's negotiation and initialize paths
	* (`Client.connect`, `Server._oninitialize`).
	*/
	_negotiatedProtocolVersion;
	static {
		writeNegotiatedProtocolVersion = (instance, version) => {
			instance._negotiatedProtocolVersion = version;
		};
	}
	_supportedProtocolVersions;
	/**
	* Callback for when the connection is closed for any reason.
	*
	* This is invoked when {@linkcode Protocol.close | close()} is called as well.
	*/
	onclose;
	/**
	* Callback for when an error occurs.
	*
	* Note that errors are not necessarily fatal; they are used for reporting any kind of exceptional condition out of band.
	*/
	onerror;
	/**
	* A handler to invoke for any request types that do not have their own handler installed.
	*/
	fallbackRequestHandler;
	/**
	* A handler to invoke for any notification types that do not have their own handler installed.
	*/
	fallbackNotificationHandler;
	constructor(_options) {
		this._options = _options;
		this._supportedProtocolVersions = _options?.supportedProtocolVersions ?? _modelcontextprotocol_core_internal.SUPPORTED_PROTOCOL_VERSIONS;
		this.setNotificationHandler("notifications/cancelled", (notification) => {
			this._oncancel(notification);
		});
		this.setNotificationHandler("notifications/progress", (notification) => {
			this._onprogress(notification);
		});
		this.setRequestHandler("ping", (_request) => ({}));
	}
	/**
	* Drop consult for inbound messages whose transport did not classify them
	* at the edge — long-lived channels such as stdio, where a role class may
	* need to decline traffic the negotiated era has no answer for (the
	* client-side inbound-request drop on modern-era connections: the
	* 2026-07-28 era has no server→client request channel, and on stdio the
	* client must never write JSON-RPC responses).
	*
	* Consulted ONLY when the transport supplied no
	* {@linkcode MessageExtraInfo.classification}: edge-classified traffic
	* never reaches the hook. Returning `'drop'` discards the message without
	* writing any response (requests are surfaced via `onerror`). The base
	* implementation returns `undefined`: unclassified traffic keeps today's
	* dispatch path unchanged. Era selection never happens here — era is
	* instance state, owned by the serving entry that constructed and
	* connected the instance.
	*/
	_shouldDropInbound(_message) {}
	/**
	* The per-request `_meta` envelope this instance attaches to every outgoing
	* request and notification, when one applies. The base implementation
	* returns `undefined` (no envelope — the 2025-era posture, so legacy-era
	* outbound traffic is byte-identical to a build without this seam).
	* `Client` overrides it on a connection that negotiated a modern (2026-07-28+)
	* era to return the reserved protocol-version / client-info /
	* client-capabilities keys. User-supplied `_meta` keys take precedence over
	* the auto-attached ones.
	*/
	_outboundMetaEnvelope() {}
	/**
	* Attach this instance's outbound `_meta` envelope (when one is configured)
	* to a request or notification. A no-op when the seam returns `undefined`
	* — the message returns by reference, so the legacy-era wire stays
	* byte-identical. User-supplied `_meta` keys are spread last so they win
	* over the auto-attached envelope keys.
	*/
	_envelopeOutbound(message) {
		const envelope = this._outboundMetaEnvelope();
		if (envelope === void 0) return message;
		const params = message.params ?? {};
		return {
			...message,
			params: {
				...params,
				_meta: {
					...envelope,
					...params._meta
				}
			}
		};
	}
	/**
	* Extension point for non-`complete` decoded results in the response
	* funnel: a result the wire codec discriminated into a kind other than
	* `'complete'` or `'invalid'` is handed here for the role class to
	* resolve. The base default surfaces it as a typed
	* {@linkcode SdkErrorCode.UnsupportedResultType} error (no retry).
	*
	* Intended consumers (named so the seam stays accountable):
	* - the `Client`'s multi-round-trip auto-fulfilment engine, which fulfils
	*   `'input_required'` results through the registered
	*   elicitation/sampling/roots handlers and retries via `flow.retry`;
	* - a future client-side terminal-result handler for
	*   `subscriptions/listen`, when the spec defines one.
	*
	* `Server` instances never receive `input_required` responses on their
	* outbound legs and leave the base behavior in place.
	*/
	_resolveNonCompleteResult(decoded, flow) {
		return Promise.reject(new SdkError(SdkErrorCode.UnsupportedResultType, `Unsupported result type '${decoded.kind}' for ${flow.request.method}`, {
			resultType: decoded.kind,
			method: flow.request.method
		}));
	}
	/**
	* Protected accessor for a registered request handler. Used by role
	* classes that dispatch synthesized requests through the same stored
	* handler chain (e.g. the `Client` fulfilling an embedded multi-round-trip
	* input request).
	*/
	_getRequestHandler(method) {
		return this._requestHandlers.get(method);
	}
	async _oncancel(notification) {
		if (notification.params.requestId === void 0) return;
		this._requestHandlerAbortControllers.get(notification.params.requestId)?.abort(notification.params.reason);
	}
	_setupTimeout(messageId, timeout, maxTotalTimeout, onTimeout, resetTimeoutOnProgress = false) {
		this._timeoutInfo.set(messageId, {
			timeoutId: setTimeout(onTimeout, timeout),
			startTime: Date.now(),
			timeout,
			maxTotalTimeout,
			resetTimeoutOnProgress,
			onTimeout
		});
	}
	_resetTimeout(messageId) {
		const info = this._timeoutInfo.get(messageId);
		if (!info) return false;
		const totalElapsed = Date.now() - info.startTime;
		if (info.maxTotalTimeout && totalElapsed >= info.maxTotalTimeout) {
			this._timeoutInfo.delete(messageId);
			throw new SdkError(SdkErrorCode.RequestTimeout, "Maximum total timeout exceeded", {
				maxTotalTimeout: info.maxTotalTimeout,
				totalElapsed
			});
		}
		clearTimeout(info.timeoutId);
		info.timeoutId = setTimeout(info.onTimeout, info.timeout);
		return true;
	}
	_cleanupTimeout(messageId) {
		const info = this._timeoutInfo.get(messageId);
		if (info) {
			clearTimeout(info.timeoutId);
			this._timeoutInfo.delete(messageId);
		}
	}
	/**
	* Attaches to the given transport, starts it, and starts listening for messages.
	*
	* The caller assumes ownership of the {@linkcode Transport}, replacing any callbacks that have already been set, and expects that it is the only user of the {@linkcode Transport} instance going forward.
	*/
	async connect(transport) {
		this._transport = transport;
		const _onclose = this.transport?.onclose;
		this._transport.onclose = () => {
			try {
				_onclose?.();
			} finally {
				this._onclose();
			}
		};
		const _onerror = this.transport?.onerror;
		this._transport.onerror = (error) => {
			_onerror?.(error);
			this._onerror(error);
		};
		const _onmessage = this._transport?.onmessage;
		this._transport.onmessage = (message, extra) => {
			_onmessage?.(message, extra);
			if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) this._onresponse(message);
			else if (isJSONRPCRequest(message)) this._onrequest(message, extra);
			else if (isJSONRPCNotification(message)) this._onnotification(message, extra);
			else this._onerror(/* @__PURE__ */ new Error(`Unknown message type: ${JSON.stringify(message)}`));
		};
		transport.setSupportedProtocolVersions?.(this._supportedProtocolVersions);
		await this._transport.start();
	}
	/**
	* Transport-close hook. Subclass overrides MUST call `super._onclose()`
	* after their own cleanup — base teardown (response-handler settlement,
	* timeout clearing, in-flight request abort) does not run otherwise.
	*/
	_onclose() {
		const responseHandlers = this._responseHandlers;
		this._responseHandlers = /* @__PURE__ */ new Map();
		this._progressHandlers.clear();
		this._pendingDebouncedNotifications.clear();
		for (const info of this._timeoutInfo.values()) clearTimeout(info.timeoutId);
		this._timeoutInfo.clear();
		const requestHandlerAbortControllers = this._requestHandlerAbortControllers;
		this._requestHandlerAbortControllers = /* @__PURE__ */ new Map();
		const error = new SdkError(SdkErrorCode.ConnectionClosed, "Connection closed");
		this._transport = void 0;
		try {
			this.onclose?.();
		} finally {
			for (const handler of responseHandlers.values()) handler(error);
			for (const controller of requestHandlerAbortControllers.values()) controller.abort(error);
		}
	}
	_onerror(error) {
		this.onerror?.(error);
	}
	/**
	* Inbound-notification dispatch. Subclass overrides MUST delegate
	* unmatched traffic to `super._onnotification(rawNotification, extra)` —
	* an override that consumes only what it owns and falls through to base
	* dispatch for everything else.
	*/
	_onnotification(rawNotification, extra) {
		const { message: notification } = liftWireOnlyMaterial(rawNotification, "notification");
		const codec = this._negotiatedWireCodec();
		if (extra?.classification === void 0 && this._shouldDropInbound(rawNotification) === "drop") return;
		if (extra?.classification !== void 0) {
			const classified = classifiedWireEra(extra.classification);
			if (classified !== codec.era) {
				this._onerror(/* @__PURE__ */ new Error(`Era mismatch on inbound notification '${notification.method}': classified as ${classified} but this instance serves ${codec.era}`));
				return;
			}
		}
		if (isSpecNotificationMethod(notification.method) && !codec.hasNotificationMethod(notification.method)) return;
		const handler = this._notificationHandlers.get(notification.method);
		const fallback = this.fallbackNotificationHandler;
		if (handler === void 0 && fallback === void 0) return;
		Promise.resolve().then(() => handler === void 0 ? fallback(notification) : handler(notification, codec)).catch((error) => this._onerror(/* @__PURE__ */ new Error(`Uncaught error in notification handler: ${error}`)));
	}
	_onrequest(rawRequest, extra) {
		const { message: request, lifted } = liftWireOnlyMaterial(rawRequest, "request");
		const codec = this._negotiatedWireCodec();
		if (extra?.classification === void 0 && this._shouldDropInbound(rawRequest) === "drop") {
			this._onerror(/* @__PURE__ */ new Error(`Dropped inbound request '${rawRequest.method}': not servable on this connection's protocol era`));
			return;
		}
		const capturedTransport = this._transport;
		const sendErrorResponse = (code, message, data) => {
			const errorResponse = {
				jsonrpc: "2.0",
				id: request.id,
				error: {
					code,
					message,
					...data !== void 0 && { data }
				}
			};
			capturedTransport?.send(errorResponse).catch((error) => this._onerror(/* @__PURE__ */ new Error(`Failed to send an error response: ${error}`)));
		};
		if (extra?.classification !== void 0) {
			const classified = classifiedWireEra(extra.classification);
			if (classified !== codec.era) {
				this._onerror(/* @__PURE__ */ new Error(`Era mismatch on inbound request '${request.method}': classified as ${classified} but this instance serves ${codec.era}`));
				const requested = extra.classification.revision ?? classified;
				sendErrorResponse(ProtocolErrorCode.UnsupportedProtocolVersion, `Unsupported protocol version: ${requested}`, {
					supported: this._supportedProtocolVersions,
					requested
				});
				return;
			}
		}
		if (isSpecRequestMethod(request.method) && !codec.hasRequestMethod(request.method) && !(isExtensionReusedRequestMethod(request.method) && this._customSchemaRequestMethods.has(request.method))) {
			sendErrorResponse(ProtocolErrorCode.MethodNotFound, "Method not found");
			return;
		}
		const handler = this._requestHandlers.get(request.method) ?? this.fallbackRequestHandler;
		if (handler === void 0) {
			sendErrorResponse(ProtocolErrorCode.MethodNotFound, "Method not found");
			return;
		}
		const envelopeError = codec.checkInboundEnvelope(lifted);
		if (envelopeError !== void 0) {
			sendErrorResponse(ProtocolErrorCode.InvalidParams, envelopeError);
			return;
		}
		const sendNotification = (notification, options) => this._notificationViaCodec(this._resolveOutboundCodec(notification.method), notification, {
			...options,
			relatedRequestId: request.id
		});
		const sendRequest = (r, resultSchema, options) => this._requestWithSchemaViaCodec(this._resolveOutboundCodec(r.method), r, resultSchema, {
			...options,
			relatedRequestId: request.id
		});
		const abortController = new AbortController();
		this._requestHandlerAbortControllers.set(request.id, abortController);
		const partitionedInputResponses = lifted.inputResponses === void 0 ? void 0 : partitionInputResponses(lifted.inputResponses);
		const baseCtx = {
			sessionId: capturedTransport?.sessionId,
			mcpReq: {
				id: request.id,
				method: request.method,
				_meta: request.params?._meta,
				...lifted.envelope !== void 0 && { envelope: lifted.envelope },
				...partitionedInputResponses !== void 0 && { inputResponses: partitionedInputResponses.accepted },
				...partitionedInputResponses !== void 0 && partitionedInputResponses.droppedKeys.length > 0 && { droppedInputResponseKeys: partitionedInputResponses.droppedKeys },
				requestState: lifted.requestState === void 0 ? NO_REQUEST_STATE : requestStateAccessor(lifted.requestState),
				signal: abortController.signal,
				send: ((r, schemaOrOptions, maybeOptions) => {
					const sendCodec = this._resolveOutboundCodec(r.method);
					this._assertOutboundRequestInEra(sendCodec, r.method);
					if (isStandardSchema(schemaOrOptions)) return sendRequest(r, schemaOrOptions, maybeOptions);
					const validate = codecResultValidator(sendCodec, r.method);
					if (validate === void 0) throw new TypeError(`'${r.method}' is not a spec method; pass a result schema as the second argument to ctx.mcpReq.send().`);
					return sendRequest(r, validate, schemaOrOptions);
				}),
				notify: sendNotification
			},
			http: extra?.authInfo ? { authInfo: extra.authInfo } : void 0
		};
		const ctx = this.buildContext(baseCtx, extra);
		Promise.resolve().then(() => handler(request, ctx)).then(async (result) => {
			if (abortController.signal.aborted) return;
			let encoded;
			try {
				encoded = codec.encodeResult(request.method, result, this._outboundServerInfo());
			} catch (error) {
				this._onerror(/* @__PURE__ */ new Error(`Failed to encode result for ${request.method}: ${error}`));
				sendErrorResponse(ProtocolErrorCode.InternalError, "Internal error");
				return;
			}
			const response = {
				result: encoded,
				jsonrpc: "2.0",
				id: request.id
			};
			await capturedTransport?.send(response);
		}, async (error) => {
			if (abortController.signal.aborted) return;
			const thrownCode = Number.isSafeInteger(error["code"]) ? error["code"] : ProtocolErrorCode.InternalError;
			const errorResponse = {
				jsonrpc: "2.0",
				id: request.id,
				error: {
					code: codec.encodeErrorCode(thrownCode),
					message: error.message ?? "Internal error",
					...error["data"] !== void 0 && { data: error["data"] }
				}
			};
			await capturedTransport?.send(errorResponse);
		}).catch((error) => this._onerror(/* @__PURE__ */ new Error(`Failed to send response: ${error}`))).finally(() => {
			if (this._requestHandlerAbortControllers.get(request.id) === abortController) this._requestHandlerAbortControllers.delete(request.id);
		});
	}
	_onprogress(notification) {
		const { progressToken, ...params } = notification.params;
		const messageId = Number(progressToken);
		const handler = this._progressHandlers.get(messageId);
		if (!handler) {
			this._onerror(/* @__PURE__ */ new Error(`Received a progress notification for an unknown token: ${JSON.stringify(notification)}`));
			return;
		}
		const responseHandler = this._responseHandlers.get(messageId);
		const timeoutInfo = this._timeoutInfo.get(messageId);
		if (timeoutInfo && responseHandler && timeoutInfo.resetTimeoutOnProgress) try {
			this._resetTimeout(messageId);
		} catch (error) {
			this._responseHandlers.delete(messageId);
			this._progressHandlers.delete(messageId);
			this._cleanupTimeout(messageId);
			responseHandler(error);
			return;
		}
		handler(params);
	}
	/**
	* Inbound-response dispatch. Subclass overrides MUST delegate unmatched
	* traffic to `super._onresponse(response)` — an override that consumes
	* only what it owns and falls through to base dispatch for everything
	* else.
	*/
	_onresponse(response) {
		const messageId = Number(response.id);
		const handler = this._responseHandlers.get(messageId);
		if (handler === void 0) {
			this._onerror(/* @__PURE__ */ new Error(`Received a response for an unknown message ID: ${JSON.stringify(response)}`));
			return;
		}
		this._responseHandlers.delete(messageId);
		this._cleanupTimeout(messageId);
		this._progressHandlers.delete(messageId);
		if (isJSONRPCResultResponse(response)) handler(response);
		else handler(ProtocolError.fromError(response.error.code, response.error.message, response.error.data));
	}
	get transport() {
		return this._transport;
	}
	/**
	* Closes the connection.
	*/
	async close() {
		await this._transport?.close();
	}
	request(request, schemaOrOptions, maybeOptions) {
		const codec = this._resolveOutboundCodec(request.method);
		if (isStandardSchema(schemaOrOptions)) {
			if (!isExtensionReusedRequestMethod(request.method)) this._assertOutboundRequestInEra(codec, request.method);
			return this._requestWithSchemaViaCodec(codec, request, schemaOrOptions, maybeOptions);
		}
		this._assertOutboundRequestInEra(codec, request.method);
		const validate = codecResultValidator(codec, request.method);
		if (validate === void 0) throw new TypeError(`'${request.method}' is not a spec method; pass a result schema as the second argument to request().`);
		return this._requestWithSchemaViaCodec(codec, request, validate, schemaOrOptions);
	}
	/**
	* The wire codec for this instance's negotiated era — the phase-2 truth:
	* everything an established connection sends and receives resolves
	* through it. Legacy until a version has been negotiated.
	*/
	_negotiatedWireCodec() {
		return codecForVersion(this._negotiatedProtocolVersion);
	}
	/**
	* Protected accessor for the instance's negotiated wire codec, for role
	* classes (Client/Server/McpServer) routing era-dependent behavior
	* through the codec's function-only surface — `samplingResultVariant`,
	* `outboundEnvelope`, `projectCallToolResult` — instead of branching on
	* the protocol version themselves.
	*/
	_wireCodec() {
		return this._negotiatedWireCodec();
	}
	/**
	* Outbound codec resolution: while the negotiated version is still unset
	* (the negotiation window), lifecycle messages are bootstrap-pinned BY
	* METHOD — they self-identify their era (`initialize` IS the legacy
	* handshake, `server/discover` IS the modern probe). Once a version has
	* been negotiated, the instance era is authoritative for everything — a
	* negotiated session never re-routes a method onto the other era.
	*/
	_resolveOutboundCodec(method) {
		if (this._negotiatedProtocolVersion === void 0) {
			const pinned = bootstrapOutboundCodec(method);
			if (pinned) return pinned;
		}
		return this._negotiatedWireCodec();
	}
	/**
	* Era gate for outbound requests — deletions are physical in BOTH
	* directions: sending a spec method that the resolved era does not define
	* dies locally with a typed error before anything reaches the transport.
	* Methods outside the spec universe are consumer-owned extension methods
	* and stay era-blind.
	*/
	_assertOutboundRequestInEra(codec, method) {
		if (isSpecRequestMethod(method) && !codec.hasRequestMethod(method)) throw new SdkError(SdkErrorCode.MethodNotSupportedByProtocolVersion, `Method '${method}' is not supported by the negotiated protocol version (wire era ${codec.era})`, {
			method,
			era: codec.era
		});
	}
	/**
	* Sends a request and waits for a response, using the provided schema for
	* validation instead of the era registry's method-keyed entry.
	*
	* This is the internal implementation used by SDK methods whose result
	* schema cannot be expressed as a method-keyed registry entry — the one
	* surviving case is `server.createMessage`, whose result schema depends
	* on the REQUEST params (tools vs no tools) — and by callers passing
	* explicit compatibility schemas. Spec methods are still era-gated here:
	* an explicit schema never smuggles a deleted method onto the wire.
	*/
	_requestWithSchema(request, resultSchema, options) {
		const codec = this._resolveOutboundCodec(request.method);
		this._assertOutboundRequestInEra(codec, request.method);
		return this._requestWithSchemaViaCodec(codec, request, resultSchema, options);
	}
	/**
	* The request funnel proper, keyed by the resolved era codec: the codec
	* owns result decoding (raw-first `resultType` discrimination — V-1 —
	* and the era's lift posture) before the schema validation step.
	*/
	_requestWithSchemaViaCodec(codec, request, resultSchema, options) {
		const { relatedRequestId, resumptionToken, onresumptiontoken, headers } = options ?? {};
		const flowStartedAt = Date.now();
		let onAbort;
		let cleanupMessageId;
		return new Promise((resolve, reject) => {
			const earlyReject = (error) => {
				reject(error);
			};
			if (!this._transport) {
				earlyReject(/* @__PURE__ */ new Error("Not connected"));
				return;
			}
			if (this._options?.enforceStrictCapabilities === true) try {
				this.assertCapabilityForMethod(request.method);
			} catch (error) {
				earlyReject(error);
				return;
			}
			if (options?.signal?.aborted) {
				const reason = options.signal.reason;
				throw reason instanceof SdkError ? reason : new SdkError(SdkErrorCode.RequestTimeout, String(reason));
			}
			const requestAbort = codec.era === MODERN_WIRE_REVISION && this._transport.hasPerRequestStream === true ? new AbortController() : void 0;
			const messageId = this._requestMessageId++;
			cleanupMessageId = messageId;
			const jsonrpcRequest = {
				...request,
				jsonrpc: "2.0",
				id: messageId
			};
			if (options?.onprogress) {
				this._progressHandlers.set(messageId, options.onprogress);
				jsonrpcRequest.params = {
					...request.params,
					_meta: {
						...request.params?._meta,
						progressToken: messageId
					}
				};
			}
			const outbound = this._envelopeOutbound(jsonrpcRequest);
			let responseReceived = false;
			const cancel = (reason) => {
				if (responseReceived) return;
				this._progressHandlers.delete(messageId);
				if (requestAbort === void 0) {
					if (request.method !== "initialize") this._transport?.send(this._envelopeOutbound({
						jsonrpc: "2.0",
						method: "notifications/cancelled",
						params: {
							requestId: messageId,
							reason: String(reason)
						}
					}), {
						relatedRequestId,
						resumptionToken,
						onresumptiontoken
					}).catch((error) => this._onerror(/* @__PURE__ */ new Error(`Failed to send cancellation: ${error}`)));
				} else requestAbort.abort();
				reject(reason instanceof SdkError ? reason : new SdkError(SdkErrorCode.RequestTimeout, String(reason)));
			};
			this._responseHandlers.set(messageId, (response) => {
				if (options?.signal?.aborted) return;
				responseReceived = true;
				if (response instanceof Error) return reject(response);
				let decoded;
				try {
					decoded = codec.decodeResult(request.method, response.result);
				} catch (error) {
					return reject(error instanceof Error ? error : new Error(String(error)));
				}
				if (decoded.kind === "invalid") return reject(decoded.error);
				if (decoded.kind === "input_required") {
					if (options?.allowInputRequired === true) return resolve(manualInputRequiredValue(decoded));
					const flow = {
						codec,
						request,
						resultSchema,
						options,
						flowStartedAt,
						retry: (params, legOptions) => this._requestWithSchemaViaCodec(codec, params === void 0 ? { method: request.method } : {
							method: request.method,
							params
						}, resultSchema, legOptions)
					};
					return resolve(this._resolveNonCompleteResult(decoded, flow));
				}
				const result = decoded.result;
				validateStandardSchema(resultSchema, result).then((parseResult) => {
					if (parseResult.success) resolve(parseResult.data);
					else reject(new SdkError(SdkErrorCode.InvalidResult, `Invalid result for ${request.method}: ${parseResult.error}`));
				}, reject);
			});
			onAbort = () => cancel(options?.signal?.reason);
			options?.signal?.addEventListener("abort", onAbort, { once: true });
			const timeout = options?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MSEC;
			const timeoutHandler = () => cancel(new SdkError(SdkErrorCode.RequestTimeout, "Request timed out", { timeout }));
			this._setupTimeout(messageId, timeout, options?.maxTotalTimeout, timeoutHandler, options?.resetTimeoutOnProgress ?? false);
			this._transport.send(outbound, {
				relatedRequestId,
				resumptionToken,
				onresumptiontoken,
				headers,
				requestSignal: requestAbort?.signal
			}).catch((error) => {
				this._progressHandlers.delete(messageId);
				reject(error);
			});
		}).finally(() => {
			if (onAbort) options?.signal?.removeEventListener("abort", onAbort);
			if (cleanupMessageId !== void 0) {
				this._responseHandlers.delete(cleanupMessageId);
				this._cleanupTimeout(cleanupMessageId);
			}
		});
	}
	/**
	* Emits a notification, which is a one-way message that does not expect a response.
	*/
	async notification(notification, options) {
		return await this._notificationViaCodec(this._resolveOutboundCodec(notification.method), notification, options);
	}
	/**
	* The notification funnel proper, keyed by the resolved era codec —
	* direct sends and related notifications (`ctx.mcpReq.notify`) alike
	* resolve through the instance's negotiated era at send time.
	*/
	async _notificationViaCodec(codec, notification, options) {
		if (!this._transport) throw new SdkError(SdkErrorCode.NotConnected, "Not connected");
		if (isSpecNotificationMethod(notification.method) && !codec.hasNotificationMethod(notification.method)) throw new SdkError(SdkErrorCode.MethodNotSupportedByProtocolVersion, `Notification '${notification.method}' is not supported by the negotiated protocol version (wire era ${codec.era})`, {
			method: notification.method,
			era: codec.era
		});
		this.assertNotificationCapability(notification.method);
		const jsonrpcNotification = this._envelopeOutbound({
			jsonrpc: "2.0",
			...notification
		});
		if ((this._options?.debouncedNotificationMethods ?? []).includes(notification.method) && !notification.params && options?.relatedRequestId === void 0) {
			if (this._pendingDebouncedNotifications.has(notification.method)) return;
			this._pendingDebouncedNotifications.add(notification.method);
			Promise.resolve().then(() => {
				this._pendingDebouncedNotifications.delete(notification.method);
				if (!this._transport) return;
				this._transport?.send(jsonrpcNotification, options).catch((error) => this._onerror(error));
			});
			return;
		}
		await this._transport.send(jsonrpcNotification, options);
	}
	setRequestHandler(method, schemasOrHandler, maybeHandler) {
		this.assertRequestHandlerCapability(method);
		let stored;
		if (typeof schemasOrHandler === "function") {
			if (!isSpecRequestMethod(method)) throw new TypeError(`'${method}' is not a spec request method; pass schemas as the second argument to setRequestHandler().`);
			stored = (request, ctx) => {
				const dispatchCodec = this._negotiatedWireCodec();
				let outcome = dispatchCodec.validateRequest(method, request);
				if (!outcome.ok && outcome.reason === "not-in-era") outcome = dispatchCodec.validateInputRequest(method, request);
				if (!outcome.ok) {
					if (outcome.reason === "not-in-era") throw new ProtocolError(ProtocolErrorCode.InternalError, `No wire schema for ${method} in the resolved era`);
					throw new Error(outcome.message);
				}
				return Promise.resolve(schemasOrHandler(outcome.value, ctx));
			};
		} else if (maybeHandler) stored = async (request, ctx) => {
			const parsed = await validateStandardSchema(schemasOrHandler.params, { ...request.params });
			if (!parsed.success) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Invalid params for ${method}: ${parsed.error}`);
			return maybeHandler(parsed.data, ctx);
		};
		else throw new TypeError("setRequestHandler: handler is required");
		if (typeof schemasOrHandler === "function") this._customSchemaRequestMethods.delete(method);
		else this._customSchemaRequestMethods.add(method);
		this._requestHandlers.set(method, this._wrapHandler(method, stored));
	}
	/**
	* Hook for subclasses to wrap a registered request handler with role-specific
	* validation or behavior (e.g. `Server` validates `tools/call` results, `Client`
	* validates `elicitation/create` mode and result). Runs for both the 2-arg and
	* 3-arg registration paths. The default implementation is identity.
	*
	* Subclasses overriding this hook avoid redeclaring `setRequestHandler`'s overload set.
	*/
	_wrapHandler(_method, handler) {
		return handler;
	}
	/**
	* Hook for subclasses to supply the implementation identity the 2026-era
	* encode seam stamps into outbound result `_meta` under
	* `io.modelcontextprotocol/serverInfo` (spec PR #3002: servers SHOULD
	* identify themselves on every response). The default is `undefined` — no
	* stamp. Only `Server` overrides this: the key identifies the software
	* producing a response, and the 2025-era codec never stamps anything
	* regardless (the never-stamp guarantee).
	*/
	_outboundServerInfo() {}
	/**
	* Removes the request handler for the given method.
	*/
	removeRequestHandler(method) {
		this._requestHandlers.delete(method);
		this._customSchemaRequestMethods.delete(method);
	}
	/**
	* Asserts that a request handler has not already been set for the given method, in preparation for a new one being automatically installed.
	*/
	assertCanSetRequestHandler(method) {
		if (this._requestHandlers.has(method)) throw new Error(`A request handler for ${method} already exists, which would be overridden`);
	}
	setNotificationHandler(method, schemasOrHandler, maybeHandler) {
		if (typeof schemasOrHandler === "function") {
			if (!isSpecNotificationMethod(method)) throw new TypeError(`'${method}' is not a spec notification method; pass schemas as the second argument to setNotificationHandler().`);
			this._notificationHandlers.set(method, (notification, codec) => {
				const outcome = codec.validateNotification(method, notification);
				if (!outcome.ok) {
					if (outcome.reason === "not-in-era") throw new ProtocolError(ProtocolErrorCode.InternalError, `No wire schema for ${method} in the resolved era`);
					throw new Error(outcome.message);
				}
				return Promise.resolve(schemasOrHandler(outcome.value));
			});
			return;
		}
		if (!maybeHandler) throw new TypeError("setNotificationHandler: handler is required");
		this._notificationHandlers.set(method, async (notification) => {
			const parsed = await validateStandardSchema(schemasOrHandler.params, { ...notification.params });
			if (!parsed.success) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Invalid params for notification ${method}: ${parsed.error}`);
			await maybeHandler(parsed.data, notification);
		});
	}
	/**
	* Removes the notification handler for the given method.
	*/
	removeNotificationHandler(method) {
		this._notificationHandlers.delete(method);
	}
};
function isPlainObject$1(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function mergeCapabilities(base, additional) {
	const result = { ...base };
	for (const key in additional) {
		const k = key;
		const addValue = additional[k];
		if (addValue === void 0) continue;
		const baseValue = result[k];
		result[k] = isPlainObject$1(baseValue) && isPlainObject$1(addValue) ? {
			...baseValue,
			...addValue
		} : addValue;
	}
	return result;
}

//#endregion
//#region ../core-internal/src/shared/inputRequiredEngine.ts
function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Splits a retried request's `inputResponses` map into the BARE response
* entries the spec defines and everything else. The spec's embedded responses
* are the bare result objects (an `ElicitResult`, `CreateMessageResult`, or
* `ListRootsResult`); a wrapped `{method, result}` envelope (a shape some
* peers emit) is never accepted as a response — its key is recorded so the
* handler can re-issue the corresponding input request.
*/
function partitionInputResponses(inputResponses) {
	const accepted = {};
	const droppedKeys = [];
	if (!isPlainObject(inputResponses)) return {
		accepted,
		droppedKeys
	};
	for (const [key, entry] of Object.entries(inputResponses)) {
		if (!isPlainObject(entry) || "method" in entry || "result" in entry) {
			droppedKeys.push(key);
			continue;
		}
		accepted[key] = entry;
	}
	return {
		accepted,
		droppedKeys
	};
}
/**
* Builds the manual-mode {@linkcode InputRequiredResult} value from the
* codec's decoded payload — what an `allowInputRequired: true` caller
* receives instead of the auto-fulfilled complete result.
*/
function manualInputRequiredValue(decoded) {
	return {
		resultType: "input_required",
		inputRequests: decoded.inputRequests,
		...decoded.requestState !== void 0 && { requestState: decoded.requestState },
		...decoded._meta !== void 0 && { _meta: decoded._meta }
	};
}

//#endregion
//#region ../../node_modules/.pnpm/content-type@1.0.5/node_modules/content-type/index.js
/*!
* content-type
* Copyright(c) 2015 Douglas Christopher Wilson
* MIT Licensed
*/
var require_content_type = /* @__PURE__ */ require_chunk.__commonJSMin(((exports) => {
	/**
	* RegExp to match *( ";" parameter ) in RFC 7231 sec 3.1.1.1
	*
	* parameter     = token "=" ( token / quoted-string )
	* token         = 1*tchar
	* tchar         = "!" / "#" / "$" / "%" / "&" / "'" / "*"
	*               / "+" / "-" / "." / "^" / "_" / "`" / "|" / "~"
	*               / DIGIT / ALPHA
	*               ; any VCHAR, except delimiters
	* quoted-string = DQUOTE *( qdtext / quoted-pair ) DQUOTE
	* qdtext        = HTAB / SP / %x21 / %x23-5B / %x5D-7E / obs-text
	* obs-text      = %x80-FF
	* quoted-pair   = "\" ( HTAB / SP / VCHAR / obs-text )
	*/
	var PARAM_REGEXP = /; *([!#$%&'*+.^_`|~0-9A-Za-z-]+) *= *("(?:[\u000b\u0020\u0021\u0023-\u005b\u005d-\u007e\u0080-\u00ff]|\\[\u000b\u0020-\u00ff])*"|[!#$%&'*+.^_`|~0-9A-Za-z-]+) */g;
	/**
	* RegExp to match quoted-pair in RFC 7230 sec 3.2.6
	*
	* quoted-pair = "\" ( HTAB / SP / VCHAR / obs-text )
	* obs-text    = %x80-FF
	*/
	var QESC_REGEXP = /\\([\u000b\u0020-\u00ff])/g;
	/**
	* RegExp to match type in RFC 7231 sec 3.1.1.1
	*
	* media-type = type "/" subtype
	* type       = token
	* subtype    = token
	*/
	var TYPE_REGEXP = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
	exports.parse = parse;
	/**
	* Parse media type to object.
	*
	* @param {string|object} string
	* @return {Object}
	* @public
	*/
	function parse(string) {
		if (!string) throw new TypeError("argument string is required");
		var header = typeof string === "object" ? getcontenttype(string) : string;
		if (typeof header !== "string") throw new TypeError("argument string is required to be a string");
		var index = header.indexOf(";");
		var type = index !== -1 ? header.slice(0, index).trim() : header.trim();
		if (!TYPE_REGEXP.test(type)) throw new TypeError("invalid media type");
		var obj = new ContentType(type.toLowerCase());
		if (index !== -1) {
			var key;
			var match;
			var value;
			PARAM_REGEXP.lastIndex = index;
			while (match = PARAM_REGEXP.exec(header)) {
				if (match.index !== index) throw new TypeError("invalid parameter format");
				index += match[0].length;
				key = match[1].toLowerCase();
				value = match[2];
				if (value.charCodeAt(0) === 34) {
					value = value.slice(1, -1);
					if (value.indexOf("\\") !== -1) value = value.replace(QESC_REGEXP, "$1");
				}
				obj.parameters[key] = value;
			}
			if (index !== header.length) throw new TypeError("invalid parameter format");
		}
		return obj;
	}
	/**
	* Get content-type from req/res objects.
	*
	* @param {object}
	* @return {Object}
	* @private
	*/
	function getcontenttype(obj) {
		var header;
		if (typeof obj.getHeader === "function") header = obj.getHeader("content-type");
		else if (typeof obj.headers === "object") header = obj.headers && obj.headers["content-type"];
		if (typeof header !== "string") throw new TypeError("content-type header is missing from object");
		return header;
	}
	/**
	* Class to represent a content type.
	* @private
	*/
	function ContentType(type) {
		this.parameters = Object.create(null);
		this.type = type;
	}
}));

//#endregion
//#region ../core-internal/src/shared/mediaType.ts
var import_content_type = /* @__PURE__ */ require_chunk.__toESM(require_content_type(), 1);
/**
* Extracts the media type (the lowercased `type/subtype` pair, without
* parameters) from a raw `Content-Type` header value, or `undefined` when the
* header is missing or empty.
*
* Content-Type comparisons must use the parsed media type, never a substring
* search of the raw header: a value like `text/plain; a=application/json`
* contains the substring `application/json` but its media type is
* `text/plain`, and case variants or parameters make naive string comparison
* wrong in both directions.
*
* "Essence" is the WHATWG MIME Sniffing standard's term for the bare
* `type/subtype` pair (https://mimesniff.spec.whatwg.org/#mime-type-essence);
* the Fetch standard's request classification is defined against it
* (https://fetch.spec.whatwg.org/#cors-safelisted-request-header).
*
* Parsing is RFC 9110 (`content-type` package) first. When the parameter
* section is malformed (`application/json;`, `application/json; charset=`),
* browsers and most HTTP stacks still derive the media type from the segment
* before the first `;` — the fallback matches that widely-implemented
* behavior, so a header whose media type is unambiguous is not rejected for
* a sloppy parameter section.
*/
function mediaTypeEssence(header) {
	if (!header) return;
	try {
		return import_content_type.parse(header).type;
	} catch {
		const essence = (header.split(";", 1)[0] ?? "").trim().toLowerCase();
		if (essence === "" || header.slice(essence.length).includes(",")) return;
		return essence;
	}
}
/**
* Whether a raw `Content-Type` header value denotes `application/json`.
* Parameters (for example `charset=utf-8`) are allowed and ignored; malformed
* parameter sections do not reject a header whose media type is unambiguously
* `application/json` (see `mediaTypeEssence` for the exact grammar).
*/
function isJsonContentType(header) {
	if (header === "application/json") return true;
	return mediaTypeEssence(header) === "application/json";
}

//#endregion
//#region ../core-internal/src/shared/metadataUtils.ts
/**
* Utilities for working with {@linkcode BaseMetadata} objects.
*/
/**
* Gets the display name for an object with {@linkcode BaseMetadata}.
* For tools, the precedence is: `title` → {@linkcode index.ToolAnnotations | annotations}.`title` → `name`
* For other objects: `title` → `name`
* This implements the spec requirement: "if no title is provided, name should be used for display purposes"
*/
function getDisplayName(metadata) {
	if (metadata.title !== void 0 && metadata.title !== "") return metadata.title;
	if ("annotations" in metadata && metadata.annotations?.title) return metadata.annotations.title;
	return metadata.name;
}

//#endregion
//#region ../core-internal/src/shared/stdio.ts
const STDIO_DEFAULT_MAX_BUFFER_SIZE = 10 * 1024 * 1024;
/**
* Buffers a continuous stdio stream into discrete JSON-RPC messages.
*/
var ReadBuffer = class {
	_buffer;
	_maxBufferSize;
	constructor(options) {
		this._maxBufferSize = options?.maxBufferSize ?? STDIO_DEFAULT_MAX_BUFFER_SIZE;
	}
	append(chunk) {
		if ((this._buffer?.length ?? 0) + chunk.length > this._maxBufferSize) {
			this.clear();
			throw new Error(`ReadBuffer exceeded maximum size of ${this._maxBufferSize} bytes`);
		}
		this._buffer = this._buffer ? Buffer.concat([this._buffer, chunk]) : chunk;
	}
	readMessage() {
		while (this._buffer) {
			const index = this._buffer.indexOf("\n");
			if (index === -1) return null;
			const line = this._buffer.toString("utf8", 0, index).replace(/\r$/, "");
			this._buffer = this._buffer.subarray(index + 1);
			try {
				return deserializeMessage(line);
			} catch (error) {
				if (error instanceof SyntaxError) continue;
				throw error;
			}
		}
		return null;
	}
	clear() {
		this._buffer = void 0;
	}
};
function deserializeMessage(line) {
	return _modelcontextprotocol_core_internal.JSONRPCMessageSchema.parse(JSON.parse(line));
}
function serializeMessage(message) {
	return JSON.stringify(message) + "\n";
}

//#endregion
//#region ../core-internal/src/shared/toolNameValidation.ts
/**
* Tool name validation utilities according to SEP: Specify Format for Tool Names
*
* Tool names SHOULD be between 1 and 128 characters in length (inclusive).
* Tool names are case-sensitive.
* Allowed characters: uppercase and lowercase ASCII letters (`A-Z`, `a-z`), digits
* (`0-9`), underscore (`_`), dash (`-`), and dot (`.`).
* Tool names SHOULD NOT contain spaces, commas, or other special characters.
*
* @see {@link https://github.com/modelcontextprotocol/modelcontextprotocol/issues/986 | SEP-986: Specify Format for Tool Names}
*/
/**
* Regular expression for valid tool names according to SEP-986 specification
*/
const TOOL_NAME_REGEX = /^[A-Za-z0-9._-]{1,128}$/;
/**
* Validates a tool name according to the SEP specification
* @param name - The tool name to validate
* @returns An object containing validation result and any warnings
*/
function validateToolName(name) {
	const warnings = [];
	if (name.length === 0) return {
		isValid: false,
		warnings: ["Tool name cannot be empty"]
	};
	if (name.length > 128) return {
		isValid: false,
		warnings: [`Tool name exceeds maximum length of 128 characters (current: ${name.length})`]
	};
	if (name.includes(" ")) warnings.push("Tool name contains spaces, which may cause parsing issues");
	if (name.includes(",")) warnings.push("Tool name contains commas, which may cause parsing issues");
	if (name.startsWith("-") || name.endsWith("-")) warnings.push("Tool name starts or ends with a dash, which may cause parsing issues in some contexts");
	if (name.startsWith(".") || name.endsWith(".")) warnings.push("Tool name starts or ends with a dot, which may cause parsing issues in some contexts");
	if (!TOOL_NAME_REGEX.test(name)) {
		const invalidChars = [...name].filter((char) => !/[A-Za-z0-9._-]/.test(char)).filter((char, index, arr) => arr.indexOf(char) === index);
		warnings.push(`Tool name contains invalid characters: ${invalidChars.map((c) => `"${c}"`).join(", ")}`, "Allowed characters are: A-Z, a-z, 0-9, underscore (_), dash (-), and dot (.)");
		return {
			isValid: false,
			warnings
		};
	}
	return {
		isValid: true,
		warnings
	};
}
/**
* Issues warnings for non-conforming tool names
* @param name - The tool name that triggered the warnings
* @param warnings - Array of warning messages
*/
function issueToolNameWarning(name, warnings) {
	if (warnings.length > 0) {
		console.warn(`Tool name validation warning for "${name}":`);
		for (const warning of warnings) console.warn(`  - ${warning}`);
		console.warn("Tool registration will proceed, but this may cause compatibility issues.");
		console.warn("Consider updating the tool name to conform to the MCP tool naming standard.");
		console.warn("See SEP: Specify Format for Tool Names (https://github.com/modelcontextprotocol/modelcontextprotocol/issues/986) for more details.");
	}
}
/**
* Validates a tool name and issues warnings for non-conforming names
* @param name - The tool name to validate
* @returns `true` if the name is valid, `false` otherwise
*/
function validateAndWarnToolName(name) {
	const result = validateToolName(name);
	issueToolNameWarning(name, result.warnings);
	return result.isValid;
}

//#endregion
//#region ../core-internal/src/shared/transport.ts
/**
* Normalizes `HeadersInit` to a plain `Record<string, string>` for manipulation.
* Handles `Headers` objects, arrays of tuples, and plain objects.
*/
function normalizeHeaders(headers) {
	if (!headers) return {};
	if (headers instanceof Headers) return Object.fromEntries(headers.entries());
	if (Array.isArray(headers)) return Object.fromEntries(headers);
	return { ...headers };
}
/**
* Creates a fetch function that includes base `RequestInit` options.
* This ensures requests inherit settings like credentials, mode, headers, etc. from the base init.
*
* @param baseFetch - The base fetch function to wrap (defaults to global `fetch`)
* @param baseInit - The base `RequestInit` to merge with each request
* @returns A wrapped fetch function that merges base options with call-specific options
*/
function createFetchWithInit(baseFetch = fetch, baseInit) {
	if (!baseInit) return baseFetch;
	return async (url, init) => {
		return baseFetch(url, {
			...baseInit,
			...init,
			headers: init?.headers ? {
				...normalizeHeaders(baseInit.headers),
				...normalizeHeaders(init.headers)
			} : baseInit.headers
		});
	};
}

//#endregion
//#region ../core-internal/src/shared/uriTemplate.ts
const MAX_TEMPLATE_LENGTH = 1e6;
const MAX_VARIABLE_LENGTH = 1e6;
const MAX_TEMPLATE_EXPRESSIONS = 1e4;
const MAX_REGEX_LENGTH = 1e6;
var UriTemplate = class UriTemplate {
	/**
	* Returns true if the given string contains any URI template expressions.
	* A template expression is a sequence of characters enclosed in curly braces,
	* like `{foo}` or `{?bar}`.
	*/
	static isTemplate(str) {
		return /\{[^}\s]+\}/.test(str);
	}
	static validateLength(str, max, context) {
		if (str.length > max) throw new Error(`${context} exceeds maximum length of ${max} characters (got ${str.length})`);
	}
	template;
	parts;
	get variableNames() {
		return this.parts.flatMap((part) => typeof part === "string" ? [] : part.names);
	}
	constructor(template) {
		UriTemplate.validateLength(template, MAX_TEMPLATE_LENGTH, "Template");
		this.template = template;
		this.parts = this.parse(template);
	}
	toString() {
		return this.template;
	}
	parse(template) {
		const parts = [];
		let currentText = "";
		let i = 0;
		let expressionCount = 0;
		while (i < template.length) if (template[i] === "{") {
			if (currentText) {
				parts.push(currentText);
				currentText = "";
			}
			const end = template.indexOf("}", i);
			if (end === -1) throw new Error("Unclosed template expression");
			expressionCount++;
			if (expressionCount > MAX_TEMPLATE_EXPRESSIONS) throw new Error(`Template contains too many expressions (max ${MAX_TEMPLATE_EXPRESSIONS})`);
			const expr = template.slice(i + 1, end);
			const operator = this.getOperator(expr);
			const exploded = expr.includes("*");
			const names = this.getNames(expr);
			const name = names[0];
			for (const name$1 of names) UriTemplate.validateLength(name$1, MAX_VARIABLE_LENGTH, "Variable name");
			parts.push({
				name,
				operator,
				names,
				exploded
			});
			i = end + 1;
		} else {
			currentText += template[i];
			i++;
		}
		if (currentText) parts.push(currentText);
		return parts;
	}
	getOperator(expr) {
		return [
			"+",
			"#",
			".",
			"/",
			"?",
			"&"
		].find((op) => expr.startsWith(op)) || "";
	}
	getNames(expr) {
		const operator = this.getOperator(expr);
		return expr.slice(operator.length).split(",").map((name) => name.replace("*", "").trim()).filter((name) => name.length > 0);
	}
	encodeValue(value, operator) {
		UriTemplate.validateLength(value, MAX_VARIABLE_LENGTH, "Variable value");
		if (operator === "+" || operator === "#") return encodeURI(value);
		return encodeURIComponent(value);
	}
	expandPart(part, variables) {
		if (part.operator === "?" || part.operator === "&") {
			const pairs = part.names.map((name) => {
				const value$1 = variables[name];
				if (value$1 === void 0) return "";
				return `${name}=${Array.isArray(value$1) ? value$1.map((v) => this.encodeValue(v, part.operator)).join(",") : this.encodeValue(value$1.toString(), part.operator)}`;
			}).filter((pair) => pair.length > 0);
			if (pairs.length === 0) return "";
			return (part.operator === "?" ? "?" : "&") + pairs.join("&");
		}
		if (part.names.length > 1) {
			const values = part.names.map((name) => variables[name]).filter((v) => v !== void 0);
			if (values.length === 0) return "";
			return values.map((v) => Array.isArray(v) ? v[0] : v).join(",");
		}
		const value = variables[part.name];
		if (value === void 0) return "";
		const encoded = (Array.isArray(value) ? value : [value]).map((v) => this.encodeValue(v, part.operator));
		switch (part.operator) {
			case "": return encoded.join(",");
			case "+": return encoded.join(",");
			case "#": return "#" + encoded.join(",");
			case ".": return "." + encoded.join(".");
			case "/": return "/" + encoded.join("/");
			default: return encoded.join(",");
		}
	}
	expand(variables) {
		let result = "";
		let hasQueryParam = false;
		for (const part of this.parts) {
			if (typeof part === "string") {
				result += part;
				continue;
			}
			const expanded = this.expandPart(part, variables);
			if (!expanded) continue;
			result += (part.operator === "?" || part.operator === "&") && hasQueryParam ? expanded.replace("?", "&") : expanded;
			if (part.operator === "?" || part.operator === "&") hasQueryParam = true;
		}
		return result;
	}
	escapeRegExp(str) {
		return str.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
	}
	partToRegExp(part) {
		const patterns = [];
		for (const name$1 of part.names) UriTemplate.validateLength(name$1, MAX_VARIABLE_LENGTH, "Variable name");
		if (part.operator === "?" || part.operator === "&") {
			for (let i = 0; i < part.names.length; i++) {
				const name$1 = part.names[i];
				const prefix = i === 0 ? "\\" + part.operator : "&";
				patterns.push({
					pattern: prefix + this.escapeRegExp(name$1) + "=([^&]+)",
					name: name$1
				});
			}
			return patterns;
		}
		let pattern;
		const name = part.name;
		switch (part.operator) {
			case "":
				pattern = part.exploded ? "([^/,]+(?:,[^/,]+)*)" : "([^/,]+)";
				break;
			case "+":
			case "#":
				pattern = "(.+)";
				break;
			case ".":
				pattern = String.raw`\.([^/,]+)`;
				break;
			case "/":
				pattern = "/" + (part.exploded ? "([^/,]+(?:,[^/,]+)*)" : "([^/,]+)");
				break;
			default: pattern = "([^/]+)";
		}
		patterns.push({
			pattern,
			name
		});
		return patterns;
	}
	match(uri) {
		UriTemplate.validateLength(uri, MAX_TEMPLATE_LENGTH, "URI");
		let pattern = "^";
		const names = [];
		for (const part of this.parts) if (typeof part === "string") pattern += this.escapeRegExp(part);
		else {
			const patterns = this.partToRegExp(part);
			for (const { pattern: partPattern, name } of patterns) {
				pattern += partPattern;
				names.push({
					name,
					exploded: part.exploded
				});
			}
		}
		pattern += "$";
		UriTemplate.validateLength(pattern, MAX_REGEX_LENGTH, "Generated regex pattern");
		const regex = new RegExp(pattern);
		const match = uri.match(regex);
		if (!match) return null;
		const result = {};
		for (const [i, name_] of names.entries()) {
			const { name, exploded } = name_;
			const value = match[i + 1];
			const cleanName = name.replace("*", "");
			result[cleanName] = exploded && value.includes(",") ? value.split(",") : value;
		}
		return result;
	}
};

//#endregion
//#region ../core-internal/src/util/inMemory.ts
/**
* In-memory transport for creating clients and servers that talk to each other within the same process.
*
* Intended for testing and development. For production in-process connections, use
* `StreamableHTTPClientTransport` against a local server URL.
*/
var InMemoryTransport = class InMemoryTransport {
	_otherTransport;
	_messageQueue = [];
	_closed = false;
	onclose;
	onerror;
	onmessage;
	sessionId;
	/**
	* Creates a pair of linked in-memory transports that can communicate with each other. One should be passed to a {@linkcode @modelcontextprotocol/client!client/client.Client | Client} and one to a {@linkcode @modelcontextprotocol/server!server/server.Server | Server}.
	*/
	static createLinkedPair() {
		const clientTransport = new InMemoryTransport();
		const serverTransport = new InMemoryTransport();
		clientTransport._otherTransport = serverTransport;
		serverTransport._otherTransport = clientTransport;
		return [clientTransport, serverTransport];
	}
	async start() {
		while (this._messageQueue.length > 0) {
			const queuedMessage = this._messageQueue.shift();
			this.onmessage?.(queuedMessage.message, queuedMessage.extra);
		}
	}
	async close() {
		if (this._closed) return;
		this._closed = true;
		const other = this._otherTransport;
		this._otherTransport = void 0;
		try {
			await other?.close();
		} finally {
			this.onclose?.();
		}
	}
	/**
	* Sends a message with optional auth info.
	* This is useful for testing authentication scenarios.
	*/
	async send(message, options) {
		if (!this._otherTransport) throw new SdkError(SdkErrorCode.NotConnected, "Not connected");
		if (this._otherTransport.onmessage) this._otherTransport.onmessage(message, { authInfo: options?.authInfo });
		else this._otherTransport._messageQueue.push({
			message,
			extra: { authInfo: options?.authInfo }
		});
	}
};

//#endregion
//#region ../core-internal/src/util/zodCompat.ts
/**
* Zod-specific helpers for the v1-compat raw-shape shorthand on
* `registerTool`/`registerPrompt`. Kept separate from `standardSchema.ts` so
* that file stays library-agnostic per the Standard Schema spec.
*/
function isZodV4Schema(v) {
	return typeof v === "object" && v !== null && "_zod" in v;
}
function looksLikeZodV3(v) {
	return typeof v === "object" && v !== null && !("_zod" in v) && "_def" in v && typeof v._def?.typeName === "string";
}
/**
* Detects a "raw shape" — a plain object whose values are Zod field schemas,
* e.g. `{ name: z.string() }`. Powers the auto-wrap in
* {@linkcode normalizeRawShapeSchema}, which wraps with `z.object()`, so only
* Zod values are supported.
*
* @internal
*/
function isZodRawShape(obj) {
	if (typeof obj !== "object" || obj === null) return false;
	if (isStandardSchema(obj)) return false;
	const proto = Object.getPrototypeOf(obj);
	if (proto !== Object.prototype && proto !== null) return false;
	return Object.values(obj).every((v) => isZodV4Schema(v));
}
/**
* Accepts either a {@linkcode StandardSchemaWithJSON} or a raw Zod shape
* `{ field: z.string() }` and returns a {@linkcode StandardSchemaWithJSON}.
* Raw shapes are wrapped with `z.object()` so the rest of the pipeline sees a
* uniform schema type; already-wrapped schemas pass through unchanged.
*
* @internal
*/
function normalizeRawShapeSchema(schema) {
	if (schema === void 0) return void 0;
	if (isZodRawShape(schema)) return zod_v4.object(schema);
	if (typeof schema === "object" && schema !== null && !isStandardSchema(schema) && Object.values(schema).some((v) => looksLikeZodV3(v))) throw new TypeError("Raw-shape inputSchema/outputSchema/argsSchema fields must be Zod v4 schemas. Got a Zod v3 field schema. Import from `zod/v4` (or upgrade your zod import), or wrap with `z.object({...})` yourself.");
	if (!isStandardSchema(schema)) throw new TypeError("inputSchema/outputSchema/argsSchema must be a Standard Schema (e.g. z.object({...})) or a raw Zod shape ({ field: z.string() }).");
	return schema;
}

//#endregion
//#region ../core-internal/src/wire/preload.ts
/**
* Explicit warm-up entry for the lazy wire-schema layers.
*
* The per-revision wire schemas are built lazily: each era's schema set sits
* behind a memoized factory (`buildSchemas2025`/`buildSchemas2026`), and the
* registry/codec lookup maps above those factories are memoized the same way.
* That laziness is the right default on process-per-invocation runtimes (CLI
* tools, dev servers), where module evaluation IS startup latency and most
* short-lived processes never validate a message on both eras.
*
* On platforms that bill request CPU but not module evaluation — isolate-based
* edge/serverless runtimes such as Cloudflare Workers — the trade inverts:
* module-scope work runs during isolate warm-up outside any request, while
* lazy construction lands inside the first request's billed (and latency
* budgeted) CPU. `preloadSchemas()` lets deployments on such platforms move
* the one-time construction cost back to module scope by calling it at module
* scope themselves. The packages' own workerd shims already do this, so
* Workers deployments get eager construction automatically.
*/
/**
* Eagerly builds every lazily-constructed wire-schema layer, so that no later
* validation pays schema-construction cost.
*
* Synchronous and idempotent: every layer is a memo, so the first call does
* all the work and subsequent calls return immediately. Reference identity is
* unaffected — this forces the same memos every lazy consumer pulls through.
*
* Call it at module scope on platforms that bill per-request CPU but not
* module evaluation (isolate-based edge/serverless runtimes), where deferring
* construction would move it into the first request of every fresh isolate:
*
* ```ts
* // from '@modelcontextprotocol/server' or '@modelcontextprotocol/client' —
* // each package bundles its own schema copy, so warm the one(s) you import.
* preloadSchemas(); // module scope — runs during isolate warm-up
* ```
*
* On Node CLIs and other process-per-invocation runtimes, prefer the lazy
* default — there, module-scope construction is pure added boot latency.
*/
function preloadSchemas() {
	buildSchemas2025();
	buildSchemas2026();
	warmRegistryMaps2025();
	warmInputSchemaMaps2026();
	warmWireResultSchemas2026();
}

//#endregion
//#region ../core-internal/src/validators/fromJsonSchema.ts
/**
* Wrap a raw JSON Schema object as a {@linkcode StandardSchemaWithJSON} so it can be
* passed to `registerTool` / `registerPrompt`. Use this when you already have JSON
* Schema (e.g. from TypeBox, or hand-written) and want to register it without going
* through a Standard Schema library.
*
* The callback arguments will be typed `unknown` (raw JSON Schema has no TypeScript
* types attached). Cast at the call site, or use the generic `fromJsonSchema<MyType>(...)`.
*
* @param schema - A JSON Schema object describing the expected shape
* @param validator - A validator provider. When importing `fromJsonSchema` from
*   `@modelcontextprotocol/server` or `@modelcontextprotocol/client`, a runtime-appropriate
*   default is provided automatically (AJV on Node.js, CfWorker on edge runtimes).
*
* @example
* ```ts source="./fromJsonSchema.examples.ts#fromJsonSchema_basicUsage"
* const inputSchema = fromJsonSchema<{ name: string }>(
*     { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
*     validator
* );
* // Use with server.registerTool('greet', { inputSchema }, handler)
* ```
*/
function fromJsonSchema(schema, validator) {
	const check = validator.getValidator(schema);
	return { "~standard": {
		version: 1,
		vendor: "mcp",
		jsonSchema: {
			input: () => schema,
			output: () => schema
		},
		validate: (data) => {
			const result = check(data);
			return result.valid ? { value: result.data } : { issues: [{ message: result.errorMessage }] };
		}
	} };
}

//#endregion
Object.defineProperty(exports, 'DEFAULT_REQUEST_TIMEOUT_MSEC', {
  enumerable: true,
  get: function () {
    return DEFAULT_REQUEST_TIMEOUT_MSEC;
  }
});
Object.defineProperty(exports, 'InMemoryTransport', {
  enumerable: true,
  get: function () {
    return InMemoryTransport;
  }
});
Object.defineProperty(exports, 'LADDER_ERROR_HTTP_STATUS', {
  enumerable: true,
  get: function () {
    return LADDER_ERROR_HTTP_STATUS;
  }
});
Object.defineProperty(exports, 'MODERN_WIRE_REVISION', {
  enumerable: true,
  get: function () {
    return MODERN_WIRE_REVISION;
  }
});
Object.defineProperty(exports, 'MissingRequiredClientCapabilityError', {
  enumerable: true,
  get: function () {
    return MissingRequiredClientCapabilityError;
  }
});
Object.defineProperty(exports, 'OAuthError', {
  enumerable: true,
  get: function () {
    return OAuthError;
  }
});
Object.defineProperty(exports, 'OAuthErrorCode', {
  enumerable: true,
  get: function () {
    return OAuthErrorCode;
  }
});
Object.defineProperty(exports, 'Protocol', {
  enumerable: true,
  get: function () {
    return Protocol;
  }
});
Object.defineProperty(exports, 'ProtocolError', {
  enumerable: true,
  get: function () {
    return ProtocolError;
  }
});
Object.defineProperty(exports, 'ProtocolErrorCode', {
  enumerable: true,
  get: function () {
    return ProtocolErrorCode;
  }
});
Object.defineProperty(exports, 'REQUEST_STATE_ONLY_LEG_PACING_MS', {
  enumerable: true,
  get: function () {
    return REQUEST_STATE_ONLY_LEG_PACING_MS;
  }
});
Object.defineProperty(exports, 'ReadBuffer', {
  enumerable: true,
  get: function () {
    return ReadBuffer;
  }
});
Object.defineProperty(exports, 'ResourceNotFoundError', {
  enumerable: true,
  get: function () {
    return ResourceNotFoundError;
  }
});
Object.defineProperty(exports, 'STDIO_DEFAULT_MAX_BUFFER_SIZE', {
  enumerable: true,
  get: function () {
    return STDIO_DEFAULT_MAX_BUFFER_SIZE;
  }
});
Object.defineProperty(exports, 'SUPPORTED_MODERN_PROTOCOL_VERSIONS', {
  enumerable: true,
  get: function () {
    return SUPPORTED_MODERN_PROTOCOL_VERSIONS;
  }
});
Object.defineProperty(exports, 'SdkError', {
  enumerable: true,
  get: function () {
    return SdkError;
  }
});
Object.defineProperty(exports, 'SdkErrorCode', {
  enumerable: true,
  get: function () {
    return SdkErrorCode;
  }
});
Object.defineProperty(exports, 'SdkHttpError', {
  enumerable: true,
  get: function () {
    return SdkHttpError;
  }
});
Object.defineProperty(exports, 'UnsupportedProtocolVersionError', {
  enumerable: true,
  get: function () {
    return UnsupportedProtocolVersionError;
  }
});
Object.defineProperty(exports, 'UriTemplate', {
  enumerable: true,
  get: function () {
    return UriTemplate;
  }
});
Object.defineProperty(exports, 'UrlElicitationRequiredError', {
  enumerable: true,
  get: function () {
    return UrlElicitationRequiredError;
  }
});
Object.defineProperty(exports, 'acceptedContent', {
  enumerable: true,
  get: function () {
    return acceptedContent;
  }
});
Object.defineProperty(exports, 'assertCompleteRequestPrompt', {
  enumerable: true,
  get: function () {
    return assertCompleteRequestPrompt;
  }
});
Object.defineProperty(exports, 'assertCompleteRequestResourceTemplate', {
  enumerable: true,
  get: function () {
    return assertCompleteRequestResourceTemplate;
  }
});
Object.defineProperty(exports, 'assertValidCacheHint', {
  enumerable: true,
  get: function () {
    return assertValidCacheHint;
  }
});
Object.defineProperty(exports, 'attachCacheHintFallback', {
  enumerable: true,
  get: function () {
    return attachCacheHintFallback;
  }
});
Object.defineProperty(exports, 'brandedHasInstance', {
  enumerable: true,
  get: function () {
    return brandedHasInstance;
  }
});
Object.defineProperty(exports, 'carriesValidModernEnvelopeClaim', {
  enumerable: true,
  get: function () {
    return carriesValidModernEnvelopeClaim;
  }
});
Object.defineProperty(exports, 'checkResourceAllowed', {
  enumerable: true,
  get: function () {
    return checkResourceAllowed;
  }
});
Object.defineProperty(exports, 'classifyInboundRequest', {
  enumerable: true,
  get: function () {
    return classifyInboundRequest;
  }
});
Object.defineProperty(exports, 'codecForVersion', {
  enumerable: true,
  get: function () {
    return codecForVersion;
  }
});
Object.defineProperty(exports, 'createFetchWithInit', {
  enumerable: true,
  get: function () {
    return createFetchWithInit;
  }
});
Object.defineProperty(exports, 'deserializeMessage', {
  enumerable: true,
  get: function () {
    return deserializeMessage;
  }
});
Object.defineProperty(exports, 'envelopeClaimVersion', {
  enumerable: true,
  get: function () {
    return envelopeClaimVersion;
  }
});
Object.defineProperty(exports, 'fromJsonSchema', {
  enumerable: true,
  get: function () {
    return fromJsonSchema;
  }
});
Object.defineProperty(exports, 'getDisplayName', {
  enumerable: true,
  get: function () {
    return getDisplayName;
  }
});
Object.defineProperty(exports, 'hasEnvelopeClaim', {
  enumerable: true,
  get: function () {
    return hasEnvelopeClaim;
  }
});
Object.defineProperty(exports, 'httpStatusForErrorCode', {
  enumerable: true,
  get: function () {
    return httpStatusForErrorCode;
  }
});
Object.defineProperty(exports, 'inputRequired', {
  enumerable: true,
  get: function () {
    return inputRequired;
  }
});
Object.defineProperty(exports, 'inputRequiredRoundsExceededMessage', {
  enumerable: true,
  get: function () {
    return inputRequiredRoundsExceededMessage;
  }
});
Object.defineProperty(exports, 'inputResponse', {
  enumerable: true,
  get: function () {
    return inputResponse;
  }
});
Object.defineProperty(exports, 'isCallToolResult', {
  enumerable: true,
  get: function () {
    return isCallToolResult;
  }
});
Object.defineProperty(exports, 'isInitializeRequest', {
  enumerable: true,
  get: function () {
    return isInitializeRequest;
  }
});
Object.defineProperty(exports, 'isInitializedNotification', {
  enumerable: true,
  get: function () {
    return isInitializedNotification;
  }
});
Object.defineProperty(exports, 'isInputRequiredResult', {
  enumerable: true,
  get: function () {
    return isInputRequiredResult;
  }
});
Object.defineProperty(exports, 'isJSONRPCErrorResponse', {
  enumerable: true,
  get: function () {
    return isJSONRPCErrorResponse;
  }
});
Object.defineProperty(exports, 'isJSONRPCNotification', {
  enumerable: true,
  get: function () {
    return isJSONRPCNotification;
  }
});
Object.defineProperty(exports, 'isJSONRPCRequest', {
  enumerable: true,
  get: function () {
    return isJSONRPCRequest;
  }
});
Object.defineProperty(exports, 'isJSONRPCResponse', {
  enumerable: true,
  get: function () {
    return isJSONRPCResponse;
  }
});
Object.defineProperty(exports, 'isJSONRPCResultResponse', {
  enumerable: true,
  get: function () {
    return isJSONRPCResultResponse;
  }
});
Object.defineProperty(exports, 'isJsonContentType', {
  enumerable: true,
  get: function () {
    return isJsonContentType;
  }
});
Object.defineProperty(exports, 'isModernProtocolVersion', {
  enumerable: true,
  get: function () {
    return isModernProtocolVersion;
  }
});
Object.defineProperty(exports, 'isSpecType', {
  enumerable: true,
  get: function () {
    return isSpecType;
  }
});
Object.defineProperty(exports, 'isTaskAugmentedRequestParams', {
  enumerable: true,
  get: function () {
    return isTaskAugmentedRequestParams;
  }
});
Object.defineProperty(exports, 'legacyProtocolVersions', {
  enumerable: true,
  get: function () {
    return legacyProtocolVersions;
  }
});
Object.defineProperty(exports, 'linkedRoundAbort', {
  enumerable: true,
  get: function () {
    return linkedRoundAbort;
  }
});
Object.defineProperty(exports, 'mediaTypeEssence', {
  enumerable: true,
  get: function () {
    return mediaTypeEssence;
  }
});
Object.defineProperty(exports, 'mergeCapabilities', {
  enumerable: true,
  get: function () {
    return mergeCapabilities;
  }
});
Object.defineProperty(exports, 'missingClientCapabilities', {
  enumerable: true,
  get: function () {
    return missingClientCapabilities;
  }
});
Object.defineProperty(exports, 'modernOnlyStrictRejection', {
  enumerable: true,
  get: function () {
    return modernOnlyStrictRejection;
  }
});
Object.defineProperty(exports, 'modernProtocolVersions', {
  enumerable: true,
  get: function () {
    return modernProtocolVersions;
  }
});
Object.defineProperty(exports, 'normalizeContentlessToolResult', {
  enumerable: true,
  get: function () {
    return normalizeContentlessToolResult;
  }
});
Object.defineProperty(exports, 'normalizeRawShapeSchema', {
  enumerable: true,
  get: function () {
    return normalizeRawShapeSchema;
  }
});
Object.defineProperty(exports, 'parseJSONRPCMessage', {
  enumerable: true,
  get: function () {
    return parseJSONRPCMessage;
  }
});
Object.defineProperty(exports, 'parseSchema', {
  enumerable: true,
  get: function () {
    return parseSchema;
  }
});
Object.defineProperty(exports, 'preloadSchemas', {
  enumerable: true,
  get: function () {
    return preloadSchemas;
  }
});
Object.defineProperty(exports, 'promptArgumentsFromStandardSchema', {
  enumerable: true,
  get: function () {
    return promptArgumentsFromStandardSchema;
  }
});
Object.defineProperty(exports, 'requestMetaOf', {
  enumerable: true,
  get: function () {
    return requestMetaOf;
  }
});
Object.defineProperty(exports, 'requestStateAccessor', {
  enumerable: true,
  get: function () {
    return requestStateAccessor;
  }
});
Object.defineProperty(exports, 'requiredClientCapabilitiesForInputRequest', {
  enumerable: true,
  get: function () {
    return requiredClientCapabilitiesForInputRequest;
  }
});
Object.defineProperty(exports, 'requiredClientCapabilitiesForRequest', {
  enumerable: true,
  get: function () {
    return requiredClientCapabilitiesForRequest;
  }
});
Object.defineProperty(exports, 'resourceUrlFromServerUrl', {
  enumerable: true,
  get: function () {
    return resourceUrlFromServerUrl;
  }
});
Object.defineProperty(exports, 'scanXMcpHeaderDeclarations', {
  enumerable: true,
  get: function () {
    return scanXMcpHeaderDeclarations;
  }
});
Object.defineProperty(exports, 'serializeMessage', {
  enumerable: true,
  get: function () {
    return serializeMessage;
  }
});
Object.defineProperty(exports, 'setNegotiatedProtocolVersion', {
  enumerable: true,
  get: function () {
    return setNegotiatedProtocolVersion;
  }
});
Object.defineProperty(exports, 'sleep', {
  enumerable: true,
  get: function () {
    return sleep;
  }
});
Object.defineProperty(exports, 'specTypeSchemas', {
  enumerable: true,
  get: function () {
    return specTypeSchemas;
  }
});
Object.defineProperty(exports, 'stampErrorBrands', {
  enumerable: true,
  get: function () {
    return stampErrorBrands;
  }
});
Object.defineProperty(exports, 'standardSchemaToJsonSchema', {
  enumerable: true,
  get: function () {
    return standardSchemaToJsonSchema;
  }
});
Object.defineProperty(exports, 'validateAndWarnToolName', {
  enumerable: true,
  get: function () {
    return validateAndWarnToolName;
  }
});
Object.defineProperty(exports, 'validateEnvelopeMeta', {
  enumerable: true,
  get: function () {
    return validateEnvelopeMeta;
  }
});
Object.defineProperty(exports, 'validateMcpParamHeaders', {
  enumerable: true,
  get: function () {
    return validateMcpParamHeaders;
  }
});
Object.defineProperty(exports, 'validateStandardRequestHeaders', {
  enumerable: true,
  get: function () {
    return validateStandardRequestHeaders;
  }
});
Object.defineProperty(exports, 'validateStandardSchema', {
  enumerable: true,
  get: function () {
    return validateStandardSchema;
  }
});
Object.defineProperty(exports, 'withRequestStateValue', {
  enumerable: true,
  get: function () {
    return withRequestStateValue;
  }
});
//# sourceMappingURL=src-BvE2tDzk.cjs.map