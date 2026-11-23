//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") {
		for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
			key = keys[i];
			if (!__hasOwnProp.call(to, key) && key !== except) {
				__defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
		}
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
let zod_v4 = require("zod/v4");
zod_v4 = __toESM(zod_v4);

//#region src/constants.ts
const LATEST_PROTOCOL_VERSION = "2025-11-25";
const DEFAULT_NEGOTIATED_PROTOCOL_VERSION = "2025-03-26";
const SUPPORTED_PROTOCOL_VERSIONS = [
	LATEST_PROTOCOL_VERSION,
	"2025-06-18",
	"2025-03-26",
	"2024-11-05",
	"2024-10-07"
];
/**
* `_meta` key associating a message with a 2025-11-25 task.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const RELATED_TASK_META_KEY = "io.modelcontextprotocol/related-task";
/**
* `_meta` key carrying the MCP protocol version governing a request.
*
* For the HTTP transport, the value must match the `MCP-Protocol-Version` header.
*/
const PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion";
/**
* `_meta` key identifying the client software making a request.
*
* Clients SHOULD include it on every request; the value is self-reported and
* intended for display, logging, and debugging — servers should not rely on
* it for behavior or security decisions.
*/
const CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo";
/**
* `_meta` key identifying the server software producing a response.
*
* Servers SHOULD include it on every response; the value is self-reported and
* intended for display, logging, and debugging — clients should not rely on
* it for behavior or security decisions.
*/
const SERVER_INFO_META_KEY = "io.modelcontextprotocol/serverInfo";
/**
* `_meta` key carrying the client's capabilities for a request.
*
* Capabilities are declared per request rather than once at initialization;
* servers must not infer capabilities from prior requests.
*/
const CLIENT_CAPABILITIES_META_KEY = "io.modelcontextprotocol/clientCapabilities";
/**
* `_meta` key carrying the JSON-RPC ID of the `subscriptions/listen` request
* that opened the stream a notification was delivered on.
*
* Stamped by the server on every notification delivered via a
* `subscriptions/listen` stream (including the leading
* `notifications/subscriptions/acknowledged`); on stdio, where all messages
* share one channel, clients use it to correlate notifications with their
* originating subscription. The value is the listen request's JSON-RPC ID
* verbatim.
*/
const SUBSCRIPTION_ID_META_KEY = "io.modelcontextprotocol/subscriptionId";
/**
* `_meta` key carrying the desired log level for a request.
*
* When absent, the server must not send `notifications/message` notifications
* for the request.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months.
*/
const LOG_LEVEL_META_KEY = "io.modelcontextprotocol/logLevel";
/**
* `_meta` key carrying W3C Trace Context for distributed tracing (SEP-414).
*
* When present, the value MUST follow the W3C `traceparent` header format,
* e.g. `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`.
*
* @see https://www.w3.org/TR/trace-context/#traceparent-header
*/
const TRACEPARENT_META_KEY = "traceparent";
/**
* `_meta` key carrying vendor-specific trace state for distributed tracing (SEP-414).
*
* When present, the value MUST follow the W3C `tracestate` header format,
* e.g. `vendor1=value1,vendor2=value2`.
*
* @see https://www.w3.org/TR/trace-context/#tracestate-header
*/
const TRACESTATE_META_KEY = "tracestate";
/**
* `_meta` key carrying cross-cutting propagation values for distributed tracing (SEP-414).
*
* When present, the value MUST follow the W3C Baggage header format,
* e.g. `userId=alice,serverRegion=us-east-1`.
*
* @see https://www.w3.org/TR/baggage/
*/
const BAGGAGE_META_KEY = "baggage";
const JSONRPC_VERSION = "2.0";
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

//#endregion
//#region src/schemas.ts
const JSONValueSchema = zod_v4.lazy(() => zod_v4.union([
	zod_v4.string(),
	zod_v4.number(),
	zod_v4.boolean(),
	zod_v4.null(),
	zod_v4.record(zod_v4.string(), JSONValueSchema),
	zod_v4.array(JSONValueSchema)
]));
const JSONObjectSchema = zod_v4.record(zod_v4.string(), JSONValueSchema);
const JSONArraySchema = zod_v4.array(JSONValueSchema);
/**
* A progress token, used to associate progress notifications with the original request.
*/
const ProgressTokenSchema = zod_v4.union([zod_v4.string(), zod_v4.number().int()]);
/**
* An opaque token used to represent a cursor for pagination.
*/
const CursorSchema = zod_v4.string();
/** @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only. */
const TaskMetadataSchema = zod_v4.object({ ttl: zod_v4.number().optional() });
/**
* Metadata for associating messages with a task.
* Include this in the `_meta` field under the key `io.modelcontextprotocol/related-task`.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const RelatedTaskMetadataSchema = zod_v4.object({ taskId: zod_v4.string() });
const RequestMetaSchema = zod_v4.looseObject({
	progressToken: ProgressTokenSchema.optional(),
	[RELATED_TASK_META_KEY]: RelatedTaskMetadataSchema.optional()
});
/**
* Common params for any request.
*/
const BaseRequestParamsSchema = zod_v4.object({ _meta: RequestMetaSchema.optional() });
/**
* Common params for any task-augmented request.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const TaskAugmentedRequestParamsSchema = BaseRequestParamsSchema.extend({ task: TaskMetadataSchema.optional() });
const RequestSchema = zod_v4.object({
	method: zod_v4.string(),
	params: BaseRequestParamsSchema.loose().optional()
});
const NotificationsParamsSchema = zod_v4.object({ _meta: RequestMetaSchema.optional() });
const NotificationSchema = zod_v4.object({
	method: zod_v4.string(),
	params: NotificationsParamsSchema.loose().optional()
});
/**
* The contents of a result's `_meta` field (the 2026-07-28 `ResultMetaObject`).
* Loose — implementation-specific keys pass through.
*
* The serverInfo key identifies the server software producing the response
* (servers SHOULD include it on every response; the value is self-reported
* and intended for display, logging, and debugging). The getter defers the
* `ImplementationSchema` reference, which is declared later in this file.
*/
const ResultMetaObjectSchema = zod_v4.looseObject({ get [SERVER_INFO_META_KEY]() {
	return ImplementationSchema.optional().catch(void 0);
} });
const ResultSchema = zod_v4.looseObject({ _meta: ResultMetaObjectSchema.optional() });
/**
* A uniquely identifying ID for a request in JSON-RPC.
*/
const RequestIdSchema = zod_v4.union([zod_v4.string(), zod_v4.number().int()]);
/**
* A request that expects a response.
*/
const JSONRPCRequestSchema = zod_v4.object({
	jsonrpc: zod_v4.literal(JSONRPC_VERSION),
	id: RequestIdSchema,
	...RequestSchema.shape
}).strict();
/**
* A notification which does not expect a response.
*/
const JSONRPCNotificationSchema = zod_v4.object({
	jsonrpc: zod_v4.literal(JSONRPC_VERSION),
	...NotificationSchema.shape
}).strict();
/**
* A successful (non-error) response to a request.
*/
const JSONRPCResultResponseSchema = zod_v4.object({
	jsonrpc: zod_v4.literal(JSONRPC_VERSION),
	id: RequestIdSchema,
	result: ResultSchema
}).strict();
/**
* A response to a request that indicates an error occurred.
*/
const JSONRPCErrorResponseSchema = zod_v4.object({
	jsonrpc: zod_v4.literal(JSONRPC_VERSION),
	id: RequestIdSchema.optional(),
	error: zod_v4.object({
		code: zod_v4.number().int(),
		message: zod_v4.string(),
		data: zod_v4.unknown().optional()
	})
}).strict();
const JSONRPCMessageSchema = zod_v4.union([
	JSONRPCRequestSchema,
	JSONRPCNotificationSchema,
	JSONRPCResultResponseSchema,
	JSONRPCErrorResponseSchema
]);
const JSONRPCResponseSchema = zod_v4.union([JSONRPCResultResponseSchema, JSONRPCErrorResponseSchema]);
/**
* A response that indicates success but carries no data.
*/
const EmptyResultSchema = ResultSchema.strict();
const CancelledNotificationParamsSchema = NotificationsParamsSchema.extend({
	requestId: RequestIdSchema.optional(),
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
const CancelledNotificationSchema = NotificationSchema.extend({
	method: zod_v4.literal("notifications/cancelled"),
	params: CancelledNotificationParamsSchema
});
/**
* Icon schema for use in {@link Tool | tools}, {@link Prompt | prompts}, {@link Resource | resources}, and {@link Implementation | implementations}.
*/
const IconSchema = zod_v4.object({
	src: zod_v4.string(),
	mimeType: zod_v4.string().optional(),
	sizes: zod_v4.array(zod_v4.string()).optional(),
	theme: zod_v4.enum(["light", "dark"]).optional()
});
/**
* Base schema to add `icons` property.
*
*/
const IconsSchema = zod_v4.object({ icons: zod_v4.array(IconSchema).optional() });
/**
* Base metadata interface for common properties across {@link Resource | resources}, {@link Tool | tools}, {@link Prompt | prompts}, and {@link Implementation | implementations}.
*/
const BaseMetadataSchema = zod_v4.object({
	name: zod_v4.string(),
	title: zod_v4.string().optional()
});
/**
* Describes the name and version of an MCP implementation.
*/
const ImplementationSchema = BaseMetadataSchema.extend({
	...BaseMetadataSchema.shape,
	...IconsSchema.shape,
	version: zod_v4.string(),
	websiteUrl: zod_v4.string().optional(),
	description: zod_v4.string().optional()
});
const FormElicitationCapabilitySchema = zod_v4.intersection(zod_v4.object({ applyDefaults: zod_v4.boolean().optional() }), JSONObjectSchema);
const ElicitationCapabilitySchema = zod_v4.preprocess((value) => {
	if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return { form: {} };
	return value;
}, zod_v4.intersection(zod_v4.object({
	form: FormElicitationCapabilitySchema.optional(),
	url: JSONObjectSchema.optional()
}), JSONObjectSchema.optional()));
/**
* Task capabilities for clients, indicating which request types support task creation.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const ClientTasksCapabilitySchema = zod_v4.looseObject({
	list: JSONObjectSchema.optional(),
	cancel: JSONObjectSchema.optional(),
	requests: zod_v4.looseObject({
		sampling: zod_v4.looseObject({ createMessage: JSONObjectSchema.optional() }).optional(),
		elicitation: zod_v4.looseObject({ create: JSONObjectSchema.optional() }).optional()
	}).optional()
});
/**
* Task capabilities for servers, indicating which request types support task creation.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const ServerTasksCapabilitySchema = zod_v4.looseObject({
	list: JSONObjectSchema.optional(),
	cancel: JSONObjectSchema.optional(),
	requests: zod_v4.looseObject({ tools: zod_v4.looseObject({ call: JSONObjectSchema.optional() }).optional() }).optional()
});
/**
* Capabilities a client may support. Known capabilities are defined here, in this schema, but this is not a closed set: any client can define its own, additional capabilities.
*/
const ClientCapabilitiesSchema = zod_v4.object({
	experimental: zod_v4.record(zod_v4.string(), JSONObjectSchema).optional(),
	sampling: zod_v4.object({
		context: JSONObjectSchema.optional(),
		tools: JSONObjectSchema.optional()
	}).optional(),
	elicitation: ElicitationCapabilitySchema.optional(),
	roots: zod_v4.object({ listChanged: zod_v4.boolean().optional() }).optional(),
	tasks: ClientTasksCapabilitySchema.optional(),
	extensions: zod_v4.record(zod_v4.string(), JSONObjectSchema).optional()
});
const InitializeRequestParamsSchema = BaseRequestParamsSchema.extend({
	protocolVersion: zod_v4.string(),
	capabilities: ClientCapabilitiesSchema,
	clientInfo: ImplementationSchema
});
/**
* This request is sent from the client to the server when it first connects, asking it to begin initialization.
*/
const InitializeRequestSchema = RequestSchema.extend({
	method: zod_v4.literal("initialize"),
	params: InitializeRequestParamsSchema
});
/**
* Capabilities that a server may support. Known capabilities are defined here, in this schema, but this is not a closed set: any server can define its own, additional capabilities.
*/
const ServerCapabilitiesSchema = zod_v4.object({
	experimental: zod_v4.record(zod_v4.string(), JSONObjectSchema).optional(),
	logging: JSONObjectSchema.optional(),
	completions: JSONObjectSchema.optional(),
	prompts: zod_v4.object({ listChanged: zod_v4.boolean().optional() }).optional(),
	resources: zod_v4.object({
		subscribe: zod_v4.boolean().optional(),
		listChanged: zod_v4.boolean().optional()
	}).optional(),
	tools: zod_v4.object({ listChanged: zod_v4.boolean().optional() }).optional(),
	tasks: ServerTasksCapabilitySchema.optional(),
	extensions: zod_v4.record(zod_v4.string(), JSONObjectSchema).optional()
});
/**
* After receiving an initialize request from the client, the server sends this response.
*/
const InitializeResultSchema = ResultSchema.extend({
	protocolVersion: zod_v4.string(),
	capabilities: ServerCapabilitiesSchema,
	serverInfo: ImplementationSchema,
	instructions: zod_v4.string().optional()
});
/**
* This notification is sent from the client to the server after initialization has finished.
*/
const InitializedNotificationSchema = NotificationSchema.extend({
	method: zod_v4.literal("notifications/initialized"),
	params: NotificationsParamsSchema.optional()
});
/**
* A request from the client asking the server to advertise its supported protocol
* versions, capabilities, and other metadata (protocol revision 2026-07-28). Servers
* MUST implement `server/discover`. Clients MAY call it but are not required to —
* version negotiation can also happen inline via the per-request `_meta` envelope.
*/
const DiscoverRequestSchema = RequestSchema.extend({
	method: zod_v4.literal("server/discover"),
	params: BaseRequestParamsSchema.optional()
});
/**
* The result returned by the server for a `server/discover` request.
*/
const DiscoverResultSchema = ResultSchema.extend({
	supportedVersions: zod_v4.array(zod_v4.string()),
	capabilities: ServerCapabilitiesSchema,
	instructions: zod_v4.string().optional()
});
/**
* A ping, issued by either the server or the client, to check that the other party is still alive. The receiver must promptly respond, or else may be disconnected.
*/
const PingRequestSchema = RequestSchema.extend({
	method: zod_v4.literal("ping"),
	params: BaseRequestParamsSchema.optional()
});
const ProgressSchema = zod_v4.object({
	progress: zod_v4.number(),
	total: zod_v4.optional(zod_v4.number()),
	message: zod_v4.optional(zod_v4.string())
});
const ProgressNotificationParamsSchema = zod_v4.object({
	...NotificationsParamsSchema.shape,
	...ProgressSchema.shape,
	progressToken: ProgressTokenSchema
});
/**
* An out-of-band notification used to inform the receiver of a progress update for a long-running request.
*
* @category notifications/progress
*/
const ProgressNotificationSchema = NotificationSchema.extend({
	method: zod_v4.literal("notifications/progress"),
	params: ProgressNotificationParamsSchema
});
const PaginatedRequestParamsSchema = BaseRequestParamsSchema.extend({ cursor: CursorSchema.optional() });
const PaginatedRequestSchema = RequestSchema.extend({ params: PaginatedRequestParamsSchema.optional() });
const PaginatedResultSchema = ResultSchema.extend({ nextCursor: CursorSchema.optional() });
/**
* The contents of a specific resource or sub-resource.
*/
const ResourceContentsSchema = zod_v4.object({
	uri: zod_v4.string(),
	mimeType: zod_v4.optional(zod_v4.string()),
	_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
});
const TextResourceContentsSchema = ResourceContentsSchema.extend({ text: zod_v4.string() });
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
const BlobResourceContentsSchema = ResourceContentsSchema.extend({ blob: Base64Schema });
/**
* The sender or recipient of messages and data in a conversation.
*/
const RoleSchema = zod_v4.enum(["user", "assistant"]);
/**
* Optional annotations providing clients additional context about a resource.
*/
const AnnotationsSchema = zod_v4.object({
	audience: zod_v4.array(RoleSchema).optional(),
	priority: zod_v4.number().min(0).max(1).optional(),
	lastModified: zod_v4.iso.datetime({ offset: true }).optional()
});
/**
* A known resource that the server is capable of reading.
*/
const ResourceSchema = zod_v4.object({
	...BaseMetadataSchema.shape,
	...IconsSchema.shape,
	uri: zod_v4.string(),
	description: zod_v4.optional(zod_v4.string()),
	mimeType: zod_v4.optional(zod_v4.string()),
	size: zod_v4.optional(zod_v4.number()),
	annotations: AnnotationsSchema.optional(),
	_meta: zod_v4.optional(zod_v4.looseObject({}))
});
/**
* A template description for resources available on the server.
*/
const ResourceTemplateSchema = zod_v4.object({
	...BaseMetadataSchema.shape,
	...IconsSchema.shape,
	uriTemplate: zod_v4.string(),
	description: zod_v4.optional(zod_v4.string()),
	mimeType: zod_v4.optional(zod_v4.string()),
	annotations: AnnotationsSchema.optional(),
	_meta: zod_v4.optional(zod_v4.looseObject({}))
});
/**
* Sent from the client to request a list of resources the server has.
*/
const ListResourcesRequestSchema = PaginatedRequestSchema.extend({ method: zod_v4.literal("resources/list") });
/**
* The server's response to a {@linkcode ListResourcesRequest | resources/list} request from the client.
*/
const ListResourcesResultSchema = PaginatedResultSchema.extend({ resources: zod_v4.array(ResourceSchema) });
/**
* Sent from the client to request a list of resource templates the server has.
*/
const ListResourceTemplatesRequestSchema = PaginatedRequestSchema.extend({ method: zod_v4.literal("resources/templates/list") });
/**
* The server's response to a {@linkcode ListResourceTemplatesRequest | resources/templates/list} request from the client.
*/
const ListResourceTemplatesResultSchema = PaginatedResultSchema.extend({ resourceTemplates: zod_v4.array(ResourceTemplateSchema) });
const ResourceRequestParamsSchema = BaseRequestParamsSchema.extend({ uri: zod_v4.string() });
/**
* Parameters for a {@linkcode ReadResourceRequest | resources/read} request.
*/
const ReadResourceRequestParamsSchema = ResourceRequestParamsSchema;
/**
* Sent from the client to the server, to read a specific resource URI.
*/
const ReadResourceRequestSchema = RequestSchema.extend({
	method: zod_v4.literal("resources/read"),
	params: ReadResourceRequestParamsSchema
});
/**
* The server's response to a {@linkcode ReadResourceRequest | resources/read} request from the client.
*/
const ReadResourceResultSchema = ResultSchema.extend({ contents: zod_v4.array(zod_v4.union([TextResourceContentsSchema, BlobResourceContentsSchema])) });
/**
* An optional notification from the server to the client, informing it that the list of resources it can read from has changed. This may be issued by servers without any previous subscription from the client.
*/
const ResourceListChangedNotificationSchema = NotificationSchema.extend({
	method: zod_v4.literal("notifications/resources/list_changed"),
	params: NotificationsParamsSchema.optional()
});
const SubscribeRequestParamsSchema = ResourceRequestParamsSchema;
/**
* Sent from the client to request `resources/updated` notifications from the server whenever a particular resource changes.
*/
const SubscribeRequestSchema = RequestSchema.extend({
	method: zod_v4.literal("resources/subscribe"),
	params: SubscribeRequestParamsSchema
});
const UnsubscribeRequestParamsSchema = ResourceRequestParamsSchema;
/**
* Sent from the client to request cancellation of {@linkcode ResourceUpdatedNotification | resources/updated} notifications from the server. This should follow a previous {@linkcode SubscribeRequest | resources/subscribe} request.
*/
const UnsubscribeRequestSchema = RequestSchema.extend({
	method: zod_v4.literal("resources/unsubscribe"),
	params: UnsubscribeRequestParamsSchema
});
/**
* The set of notification types a client opts in to on a `subscriptions/listen`
* request. Each type is opt-in; the server MUST NOT send a notification type
* the client has not explicitly requested here.
*/
const SubscriptionFilterSchema = zod_v4.object({
	toolsListChanged: zod_v4.boolean().optional(),
	promptsListChanged: zod_v4.boolean().optional(),
	resourcesListChanged: zod_v4.boolean().optional(),
	resourceSubscriptions: zod_v4.array(zod_v4.string()).optional()
});
const SubscriptionsListenRequestParamsSchema = BaseRequestParamsSchema.extend({ notifications: SubscriptionFilterSchema });
/**
* Sent from the client to open a long-lived channel for receiving notifications
* outside the context of a specific request (protocol revision 2026-07-28).
* Replaces the previous HTTP GET endpoint and `resources/subscribe`.
*/
const SubscriptionsListenRequestSchema = RequestSchema.extend({
	method: zod_v4.literal("subscriptions/listen"),
	params: SubscriptionsListenRequestParamsSchema
});
const SubscriptionsAcknowledgedNotificationParamsSchema = NotificationsParamsSchema.extend({ notifications: SubscriptionFilterSchema });
/**
* Sent by the server as the first message on a `subscriptions/listen` stream
* to acknowledge that the subscription has been established and report which
* notification types it agreed to honor (protocol revision 2026-07-28).
*/
const SubscriptionsAcknowledgedNotificationSchema = NotificationSchema.extend({
	method: zod_v4.literal("notifications/subscriptions/acknowledged"),
	params: SubscriptionsAcknowledgedNotificationParamsSchema
});
/**
* `_meta` for a {@linkcode SubscriptionsListenResult}: the listen request's
* JSON-RPC ID under the canonical subscription-id key (mirroring the same key
* on every notification delivered on the stream). Extends
* {@linkcode ResultMetaObjectSchema}, so the optional serverInfo key is typed
* here too.
*/
const SubscriptionsListenResultMetaSchema = ResultMetaObjectSchema.extend({ [SUBSCRIPTION_ID_META_KEY]: RequestIdSchema });
/**
* The response to a `subscriptions/listen` request, signalling that the
* subscription has ended gracefully (for example, during server shutdown).
* Because the listen stream is long-lived, this result is sent only when the
* server tears the subscription down; an abrupt transport close carries no
* response. The result body is otherwise empty.
*/
const SubscriptionsListenResultSchema = ResultSchema.extend({ _meta: SubscriptionsListenResultMetaSchema });
/**
* Parameters for a {@linkcode ResourceUpdatedNotification | notifications/resources/updated} notification.
*/
const ResourceUpdatedNotificationParamsSchema = NotificationsParamsSchema.extend({ uri: zod_v4.string() });
/**
* A notification from the server to the client, informing it that a resource has changed and may need to be read again. This should only be sent if the client previously sent a {@linkcode SubscribeRequest | resources/subscribe} request.
*/
const ResourceUpdatedNotificationSchema = NotificationSchema.extend({
	method: zod_v4.literal("notifications/resources/updated"),
	params: ResourceUpdatedNotificationParamsSchema
});
/**
* Describes an argument that a prompt can accept.
*/
const PromptArgumentSchema = zod_v4.object({
	name: zod_v4.string(),
	description: zod_v4.optional(zod_v4.string()),
	required: zod_v4.optional(zod_v4.boolean())
});
/**
* A prompt or prompt template that the server offers.
*/
const PromptSchema = zod_v4.object({
	...BaseMetadataSchema.shape,
	...IconsSchema.shape,
	description: zod_v4.optional(zod_v4.string()),
	arguments: zod_v4.optional(zod_v4.array(PromptArgumentSchema)),
	_meta: zod_v4.optional(zod_v4.looseObject({}))
});
/**
* Sent from the client to request a list of prompts and prompt templates the server has.
*/
const ListPromptsRequestSchema = PaginatedRequestSchema.extend({ method: zod_v4.literal("prompts/list") });
/**
* The server's response to a {@linkcode ListPromptsRequest | prompts/list} request from the client.
*/
const ListPromptsResultSchema = PaginatedResultSchema.extend({ prompts: zod_v4.array(PromptSchema) });
/**
* Parameters for a {@linkcode GetPromptRequest | prompts/get} request.
*/
const GetPromptRequestParamsSchema = BaseRequestParamsSchema.extend({
	name: zod_v4.string(),
	arguments: zod_v4.record(zod_v4.string(), zod_v4.string()).optional()
});
/**
* Used by the client to get a prompt provided by the server.
*/
const GetPromptRequestSchema = RequestSchema.extend({
	method: zod_v4.literal("prompts/get"),
	params: GetPromptRequestParamsSchema
});
/**
* Text provided to or from an LLM.
*/
const TextContentSchema = zod_v4.object({
	type: zod_v4.literal("text"),
	text: zod_v4.string(),
	annotations: AnnotationsSchema.optional(),
	_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
});
/**
* An image provided to or from an LLM.
*/
const ImageContentSchema = zod_v4.object({
	type: zod_v4.literal("image"),
	data: Base64Schema,
	mimeType: zod_v4.string(),
	annotations: AnnotationsSchema.optional(),
	_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
});
/**
* Audio content provided to or from an LLM.
*/
const AudioContentSchema = zod_v4.object({
	type: zod_v4.literal("audio"),
	data: Base64Schema,
	mimeType: zod_v4.string(),
	annotations: AnnotationsSchema.optional(),
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
const ToolUseContentSchema = zod_v4.object({
	type: zod_v4.literal("tool_use"),
	name: zod_v4.string(),
	id: zod_v4.string(),
	input: zod_v4.record(zod_v4.string(), zod_v4.unknown()),
	_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
});
/**
* The contents of a resource, embedded into a prompt or tool call result.
*/
const EmbeddedResourceSchema = zod_v4.object({
	type: zod_v4.literal("resource"),
	resource: zod_v4.union([TextResourceContentsSchema, BlobResourceContentsSchema]),
	annotations: AnnotationsSchema.optional(),
	_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
});
/**
* A resource that the server is capable of reading, included in a prompt or tool call result.
*
* Note: resource links returned by tools are not guaranteed to appear in the results of {@linkcode ListResourcesRequest | resources/list} requests.
*/
const ResourceLinkSchema = ResourceSchema.extend({ type: zod_v4.literal("resource_link") });
/**
* A content block that can be used in prompts and tool results.
*/
const ContentBlockSchema = zod_v4.union([
	TextContentSchema,
	ImageContentSchema,
	AudioContentSchema,
	ResourceLinkSchema,
	EmbeddedResourceSchema
]);
/**
* Describes a message returned as part of a prompt.
*/
const PromptMessageSchema = zod_v4.object({
	role: RoleSchema,
	content: ContentBlockSchema
});
/**
* The server's response to a {@linkcode GetPromptRequest | prompts/get} request from the client.
*/
const GetPromptResultSchema = ResultSchema.extend({
	description: zod_v4.string().optional(),
	messages: zod_v4.array(PromptMessageSchema)
});
/**
* An optional notification from the server to the client, informing it that the list of prompts it offers has changed. This may be issued by servers without any previous subscription from the client.
*/
const PromptListChangedNotificationSchema = NotificationSchema.extend({
	method: zod_v4.literal("notifications/prompts/list_changed"),
	params: NotificationsParamsSchema.optional()
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
const ToolAnnotationsSchema = zod_v4.object({
	title: zod_v4.string().optional(),
	readOnlyHint: zod_v4.boolean().optional(),
	destructiveHint: zod_v4.boolean().optional(),
	idempotentHint: zod_v4.boolean().optional(),
	openWorldHint: zod_v4.boolean().optional()
});
/**
* Execution-related properties for a tool.
*/
const ToolExecutionSchema = zod_v4.object({ taskSupport: zod_v4.enum([
	"required",
	"optional",
	"forbidden"
]).optional() });
/**
* Definition for a tool the client can call.
*/
const ToolSchema = zod_v4.object({
	...BaseMetadataSchema.shape,
	...IconsSchema.shape,
	description: zod_v4.string().optional(),
	inputSchema: zod_v4.object({
		type: zod_v4.literal("object"),
		properties: zod_v4.record(zod_v4.string(), JSONValueSchema).optional(),
		required: zod_v4.array(zod_v4.string()).optional()
	}).catchall(zod_v4.unknown()),
	outputSchema: zod_v4.looseObject({ $schema: zod_v4.string().optional() }).optional(),
	annotations: ToolAnnotationsSchema.optional(),
	execution: ToolExecutionSchema.optional(),
	_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
});
/**
* Sent from the client to request a list of tools the server has.
*/
const ListToolsRequestSchema = PaginatedRequestSchema.extend({ method: zod_v4.literal("tools/list") });
/**
* The server's response to a {@linkcode ListToolsRequest | tools/list} request from the client.
*/
const ListToolsResultSchema = PaginatedResultSchema.extend({ tools: zod_v4.array(ToolSchema) });
/**
* The server's response to a tool call.
*/
const CallToolResultSchema = ResultSchema.extend({
	content: zod_v4.array(ContentBlockSchema).default([]),
	structuredContent: zod_v4.unknown().optional(),
	isError: zod_v4.boolean().optional()
});
/**
* {@linkcode CallToolResultSchema} extended with backwards compatibility to protocol version 2024-10-07.
*/
const CompatibilityCallToolResultSchema = CallToolResultSchema.or(ResultSchema.extend({ toolResult: zod_v4.unknown() }));
/**
* Parameters for a `tools/call` request.
*/
const CallToolRequestParamsSchema = TaskAugmentedRequestParamsSchema.extend({
	name: zod_v4.string(),
	arguments: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
});
/**
* Used by the client to invoke a tool provided by the server.
*/
const CallToolRequestSchema = RequestSchema.extend({
	method: zod_v4.literal("tools/call"),
	params: CallToolRequestParamsSchema
});
/**
* An optional notification from the server to the client, informing it that the list of tools it offers has changed. This may be issued by servers without any previous subscription from the client.
*/
const ToolListChangedNotificationSchema = NotificationSchema.extend({
	method: zod_v4.literal("notifications/tools/list_changed"),
	params: NotificationsParamsSchema.optional()
});
/**
* Base schema for list changed subscription options (without callback).
* Used internally for Zod validation of `autoRefresh` and `debounceMs`.
*/
const ListChangedOptionsBaseSchema = zod_v4.object({
	autoRefresh: zod_v4.boolean().default(true),
	debounceMs: zod_v4.number().int().nonnegative().default(300)
});
/**
* The severity of a log message.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to stderr logging
* (STDIO servers) or OpenTelemetry.
*/
const LoggingLevelSchema = zod_v4.enum([
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
const SetLevelRequestParamsSchema = BaseRequestParamsSchema.extend({ level: LoggingLevelSchema });
/**
* A request from the client to the server, to enable or adjust logging.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to stderr logging
* (STDIO servers) or OpenTelemetry.
*/
const SetLevelRequestSchema = RequestSchema.extend({
	method: zod_v4.literal("logging/setLevel"),
	params: SetLevelRequestParamsSchema
});
/**
* Parameters for a `notifications/message` notification.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to stderr logging
* (STDIO servers) or OpenTelemetry.
*/
const LoggingMessageNotificationParamsSchema = NotificationsParamsSchema.extend({
	level: LoggingLevelSchema,
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
const LoggingMessageNotificationSchema = NotificationSchema.extend({
	method: zod_v4.literal("notifications/message"),
	params: LoggingMessageNotificationParamsSchema
});
/**
* Hints to use for model selection.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to calling LLM
* provider APIs directly.
*/
const ModelHintSchema = zod_v4.object({ name: zod_v4.string().optional() });
/**
* The server's preferences for model selection, requested of the client during sampling.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to calling LLM
* provider APIs directly.
*/
const ModelPreferencesSchema = zod_v4.object({
	hints: zod_v4.array(ModelHintSchema).optional(),
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
const ToolChoiceSchema = zod_v4.object({ mode: zod_v4.enum([
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
const ToolResultContentSchema = zod_v4.object({
	type: zod_v4.literal("tool_result"),
	toolUseId: zod_v4.string().describe("The unique identifier for the corresponding tool call."),
	content: zod_v4.array(ContentBlockSchema),
	structuredContent: zod_v4.unknown().optional(),
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
const SamplingContentSchema = zod_v4.discriminatedUnion("type", [
	TextContentSchema,
	ImageContentSchema,
	AudioContentSchema
]);
/**
* Content block types allowed in sampling messages.
* This includes text, image, audio, tool use requests, and tool results.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to calling LLM
* provider APIs directly.
*/
const SamplingMessageContentBlockSchema = zod_v4.discriminatedUnion("type", [
	TextContentSchema,
	ImageContentSchema,
	AudioContentSchema,
	ToolUseContentSchema,
	ToolResultContentSchema
]);
/**
* Describes a message issued to or received from an LLM API.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to calling LLM
* provider APIs directly.
*/
const SamplingMessageSchema = zod_v4.object({
	role: RoleSchema,
	content: zod_v4.union([SamplingMessageContentBlockSchema, zod_v4.array(SamplingMessageContentBlockSchema)]),
	_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
});
/**
* Parameters for a `sampling/createMessage` request.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to calling LLM
* provider APIs directly.
*/
const CreateMessageRequestParamsSchema = TaskAugmentedRequestParamsSchema.extend({
	messages: zod_v4.array(SamplingMessageSchema),
	modelPreferences: ModelPreferencesSchema.optional(),
	systemPrompt: zod_v4.string().optional(),
	includeContext: zod_v4.enum([
		"none",
		"thisServer",
		"allServers"
	]).optional(),
	temperature: zod_v4.number().optional(),
	maxTokens: zod_v4.number().int(),
	stopSequences: zod_v4.array(zod_v4.string()).optional(),
	metadata: JSONObjectSchema.optional(),
	tools: zod_v4.array(ToolSchema).optional(),
	toolChoice: ToolChoiceSchema.optional()
});
/**
* A request from the server to sample an LLM via the client. The client has full discretion over which model to select. The client should also inform the user before beginning sampling, to allow them to inspect the request (human in the loop) and decide whether to approve it.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to calling LLM
* provider APIs directly.
*/
const CreateMessageRequestSchema = RequestSchema.extend({
	method: zod_v4.literal("sampling/createMessage"),
	params: CreateMessageRequestParamsSchema
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
const CreateMessageResultSchema = ResultSchema.extend({
	model: zod_v4.string(),
	stopReason: zod_v4.optional(zod_v4.enum([
		"endTurn",
		"stopSequence",
		"maxTokens"
	]).or(zod_v4.string())),
	role: RoleSchema,
	content: SamplingContentSchema
});
/**
* The client's response to a `sampling/create_message` request when tools were provided.
* This version supports array content for tool use flows.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to calling LLM
* provider APIs directly.
*/
const CreateMessageResultWithToolsSchema = ResultSchema.extend({
	model: zod_v4.string(),
	stopReason: zod_v4.optional(zod_v4.enum([
		"endTurn",
		"stopSequence",
		"maxTokens",
		"toolUse"
	]).or(zod_v4.string())),
	role: RoleSchema,
	content: zod_v4.union([SamplingMessageContentBlockSchema, zod_v4.array(SamplingMessageContentBlockSchema)])
});
/**
* Primitive schema definition for boolean fields.
*/
const BooleanSchemaSchema = zod_v4.object({
	type: zod_v4.literal("boolean"),
	title: zod_v4.string().optional(),
	description: zod_v4.string().optional(),
	default: zod_v4.boolean().optional()
});
/**
* Primitive schema definition for string fields.
*/
const StringSchemaSchema = zod_v4.object({
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
const NumberSchemaSchema = zod_v4.object({
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
const UntitledSingleSelectEnumSchemaSchema = zod_v4.object({
	type: zod_v4.literal("string"),
	title: zod_v4.string().optional(),
	description: zod_v4.string().optional(),
	enum: zod_v4.array(zod_v4.string()),
	default: zod_v4.string().optional()
});
/**
* Schema for single-selection enumeration with display titles for each option.
*/
const TitledSingleSelectEnumSchemaSchema = zod_v4.object({
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
const LegacyTitledEnumSchemaSchema = zod_v4.object({
	type: zod_v4.literal("string"),
	title: zod_v4.string().optional(),
	description: zod_v4.string().optional(),
	enum: zod_v4.array(zod_v4.string()),
	enumNames: zod_v4.array(zod_v4.string()).optional(),
	default: zod_v4.string().optional()
});
const SingleSelectEnumSchemaSchema = zod_v4.union([UntitledSingleSelectEnumSchemaSchema, TitledSingleSelectEnumSchemaSchema]);
/**
* Schema for multiple-selection enumeration without display titles for options.
*/
const UntitledMultiSelectEnumSchemaSchema = zod_v4.object({
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
const TitledMultiSelectEnumSchemaSchema = zod_v4.object({
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
const MultiSelectEnumSchemaSchema = zod_v4.union([UntitledMultiSelectEnumSchemaSchema, TitledMultiSelectEnumSchemaSchema]);
/**
* Primitive schema definition for enum fields.
*/
const EnumSchemaSchema = zod_v4.union([
	LegacyTitledEnumSchemaSchema,
	SingleSelectEnumSchemaSchema,
	MultiSelectEnumSchemaSchema
]);
/**
* Union of all primitive schema definitions.
*/
const PrimitiveSchemaDefinitionSchema = zod_v4.union([
	EnumSchemaSchema,
	BooleanSchemaSchema,
	StringSchemaSchema,
	NumberSchemaSchema
]);
/**
* Parameters for an `elicitation/create` request for form-based elicitation.
*/
const ElicitRequestFormParamsSchema = TaskAugmentedRequestParamsSchema.extend({
	mode: zod_v4.literal("form").optional(),
	message: zod_v4.string(),
	requestedSchema: zod_v4.object({
		type: zod_v4.literal("object"),
		properties: zod_v4.record(zod_v4.string(), PrimitiveSchemaDefinitionSchema),
		required: zod_v4.array(zod_v4.string()).optional()
	}).catchall(zod_v4.unknown())
});
/**
* Parameters for an {@linkcode ElicitRequest | elicitation/create} request for URL-based elicitation.
*/
const ElicitRequestURLParamsSchema = TaskAugmentedRequestParamsSchema.extend({
	mode: zod_v4.literal("url"),
	message: zod_v4.string(),
	elicitationId: zod_v4.string(),
	url: zod_v4.string().url()
});
/**
* The parameters for a request to elicit additional information from the user via the client.
*/
const ElicitRequestParamsSchema = zod_v4.union([ElicitRequestFormParamsSchema, ElicitRequestURLParamsSchema]);
/**
* A request from the server to elicit user input via the client.
* The client should present the message and form fields to the user (form mode)
* or navigate to a URL (URL mode).
*/
const ElicitRequestSchema = RequestSchema.extend({
	method: zod_v4.literal("elicitation/create"),
	params: ElicitRequestParamsSchema
});
/**
* Parameters for a {@linkcode ElicitationCompleteNotification | notifications/elicitation/complete} notification.
*
* @deprecated Removed from the spec by #2891 (2026-07-28). The client learns the outcome
* of an out-of-band interaction by retrying the original request; no server-initiated
* completion signal exists in the 2026-07-28 revision. Kept here for the 2025-era flow
* only. The 2026-07-28 wire codec excludes this notification.
* @category notifications/elicitation/complete
*/
const ElicitationCompleteNotificationParamsSchema = NotificationsParamsSchema.extend({ elicitationId: zod_v4.string() });
/**
* A notification from the server to the client, informing it of a completion of an out-of-band elicitation request.
*
* @deprecated Removed from the spec by #2891 (2026-07-28). The client learns the outcome
* of an out-of-band interaction by retrying the original request; no server-initiated
* completion signal exists in the 2026-07-28 revision. Kept here for the 2025-era flow
* only. The 2026-07-28 wire codec excludes this notification.
* @category notifications/elicitation/complete
*/
const ElicitationCompleteNotificationSchema = NotificationSchema.extend({
	method: zod_v4.literal("notifications/elicitation/complete"),
	params: ElicitationCompleteNotificationParamsSchema
});
/**
* The client's response to an {@linkcode ElicitRequest | elicitation/create} request from the server.
*/
const ElicitResultSchema = ResultSchema.extend({
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
const ResourceTemplateReferenceSchema = zod_v4.object({
	type: zod_v4.literal("ref/resource"),
	uri: zod_v4.string()
});
/**
* Identifies a prompt.
*/
const PromptReferenceSchema = zod_v4.object({
	type: zod_v4.literal("ref/prompt"),
	name: zod_v4.string()
});
/**
* Parameters for a {@linkcode CompleteRequest | completion/complete} request.
*/
const CompleteRequestParamsSchema = BaseRequestParamsSchema.extend({
	ref: zod_v4.union([PromptReferenceSchema, ResourceTemplateReferenceSchema]),
	argument: zod_v4.object({
		name: zod_v4.string(),
		value: zod_v4.string()
	}),
	context: zod_v4.object({ arguments: zod_v4.record(zod_v4.string(), zod_v4.string()).optional() }).optional()
});
/**
* A request from the client to the server, to ask for completion options.
*/
const CompleteRequestSchema = RequestSchema.extend({
	method: zod_v4.literal("completion/complete"),
	params: CompleteRequestParamsSchema
});
/**
* The server's response to a {@linkcode CompleteRequest | completion/complete} request
*/
const CompleteResultSchema = ResultSchema.extend({ completion: zod_v4.looseObject({
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
const RootSchema = zod_v4.object({
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
const ListRootsRequestSchema = RequestSchema.extend({
	method: zod_v4.literal("roots/list"),
	params: BaseRequestParamsSchema.optional()
});
/**
* The client's response to a `roots/list` request from the server.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to passing paths via
* tool parameters, resource URIs, or configuration.
*/
const ListRootsResultSchema = ResultSchema.extend({ roots: zod_v4.array(RootSchema) });
/**
* A notification from the client to the server, informing it that the list of roots has changed.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to passing paths via
* tool parameters, resource URIs, or configuration.
*/
const RootsListChangedNotificationSchema = NotificationSchema.extend({
	method: zod_v4.literal("notifications/roots/list_changed"),
	params: NotificationsParamsSchema.optional()
});
/**
* Task creation parameters, used to ask that the server create a task to represent a request.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const TaskCreationParamsSchema = zod_v4.looseObject({
	ttl: zod_v4.number().optional(),
	pollInterval: zod_v4.number().optional()
});
/**
* The status of a task.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const TaskStatusSchema = zod_v4.enum([
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
const TaskSchema = zod_v4.object({
	taskId: zod_v4.string(),
	status: TaskStatusSchema,
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
const CreateTaskResultSchema = ResultSchema.extend({ task: TaskSchema });
/**
* Parameters for task status notification.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const TaskStatusNotificationParamsSchema = NotificationsParamsSchema.merge(TaskSchema);
/**
* A notification sent when a task's status changes.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const TaskStatusNotificationSchema = NotificationSchema.extend({
	method: zod_v4.literal("notifications/tasks/status"),
	params: TaskStatusNotificationParamsSchema
});
/**
* A request to get the state of a specific task.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const GetTaskRequestSchema = RequestSchema.extend({
	method: zod_v4.literal("tasks/get"),
	params: BaseRequestParamsSchema.extend({ taskId: zod_v4.string() })
});
/**
* The response to a {@linkcode GetTaskRequest | tasks/get} request.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const GetTaskResultSchema = ResultSchema.merge(TaskSchema);
/**
* A request to get the result of a specific task.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const GetTaskPayloadRequestSchema = RequestSchema.extend({
	method: zod_v4.literal("tasks/result"),
	params: BaseRequestParamsSchema.extend({ taskId: zod_v4.string() })
});
/**
* The response to a `tasks/result` request.
* The structure matches the result type of the original request.
* For example, a {@linkcode CallToolRequest | tools/call} task would return the `CallToolResult` structure.
*
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const GetTaskPayloadResultSchema = ResultSchema.loose();
/**
* A request to list tasks.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const ListTasksRequestSchema = PaginatedRequestSchema.extend({ method: zod_v4.literal("tasks/list") });
/**
* The response to a {@linkcode ListTasksRequest | tasks/list} request.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const ListTasksResultSchema = PaginatedResultSchema.extend({ tasks: zod_v4.array(TaskSchema) });
/**
* A request to cancel a specific task.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const CancelTaskRequestSchema = RequestSchema.extend({
	method: zod_v4.literal("tasks/cancel"),
	params: BaseRequestParamsSchema.extend({ taskId: zod_v4.string() })
});
/**
* The response to a {@linkcode CancelTaskRequest | tasks/cancel} request.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const CancelTaskResultSchema = ResultSchema.merge(TaskSchema);
const ClientRequestSchema = zod_v4.union([
	PingRequestSchema,
	InitializeRequestSchema,
	DiscoverRequestSchema,
	CompleteRequestSchema,
	SetLevelRequestSchema,
	GetPromptRequestSchema,
	ListPromptsRequestSchema,
	ListResourcesRequestSchema,
	ListResourceTemplatesRequestSchema,
	ReadResourceRequestSchema,
	SubscribeRequestSchema,
	UnsubscribeRequestSchema,
	SubscriptionsListenRequestSchema,
	CallToolRequestSchema,
	ListToolsRequestSchema
]);
const ClientNotificationSchema = zod_v4.union([
	CancelledNotificationSchema,
	ProgressNotificationSchema,
	InitializedNotificationSchema,
	RootsListChangedNotificationSchema
]);
const ClientResultSchema = zod_v4.union([
	EmptyResultSchema,
	CreateMessageResultSchema,
	CreateMessageResultWithToolsSchema,
	ElicitResultSchema,
	ListRootsResultSchema
]);
const ServerRequestSchema = zod_v4.union([
	PingRequestSchema,
	CreateMessageRequestSchema,
	ElicitRequestSchema,
	ListRootsRequestSchema
]);
const ServerNotificationSchema = zod_v4.union([
	CancelledNotificationSchema,
	ProgressNotificationSchema,
	LoggingMessageNotificationSchema,
	ResourceUpdatedNotificationSchema,
	ResourceListChangedNotificationSchema,
	ToolListChangedNotificationSchema,
	PromptListChangedNotificationSchema,
	SubscriptionsAcknowledgedNotificationSchema,
	ElicitationCompleteNotificationSchema
]);
const ServerResultSchema = zod_v4.union([
	EmptyResultSchema,
	InitializeResultSchema,
	DiscoverResultSchema,
	CompleteResultSchema,
	GetPromptResultSchema,
	ListPromptsResultSchema,
	ListResourcesResultSchema,
	ListResourceTemplatesResultSchema,
	ReadResourceResultSchema,
	CallToolResultSchema,
	ListToolsResultSchema,
	SubscriptionsListenResultSchema
]);

//#endregion
Object.defineProperty(exports, 'AnnotationsSchema', {
  enumerable: true,
  get: function () {
    return AnnotationsSchema;
  }
});
Object.defineProperty(exports, 'AudioContentSchema', {
  enumerable: true,
  get: function () {
    return AudioContentSchema;
  }
});
Object.defineProperty(exports, 'BAGGAGE_META_KEY', {
  enumerable: true,
  get: function () {
    return BAGGAGE_META_KEY;
  }
});
Object.defineProperty(exports, 'BaseMetadataSchema', {
  enumerable: true,
  get: function () {
    return BaseMetadataSchema;
  }
});
Object.defineProperty(exports, 'BaseRequestParamsSchema', {
  enumerable: true,
  get: function () {
    return BaseRequestParamsSchema;
  }
});
Object.defineProperty(exports, 'BlobResourceContentsSchema', {
  enumerable: true,
  get: function () {
    return BlobResourceContentsSchema;
  }
});
Object.defineProperty(exports, 'BooleanSchemaSchema', {
  enumerable: true,
  get: function () {
    return BooleanSchemaSchema;
  }
});
Object.defineProperty(exports, 'CLIENT_CAPABILITIES_META_KEY', {
  enumerable: true,
  get: function () {
    return CLIENT_CAPABILITIES_META_KEY;
  }
});
Object.defineProperty(exports, 'CLIENT_INFO_META_KEY', {
  enumerable: true,
  get: function () {
    return CLIENT_INFO_META_KEY;
  }
});
Object.defineProperty(exports, 'CallToolRequestParamsSchema', {
  enumerable: true,
  get: function () {
    return CallToolRequestParamsSchema;
  }
});
Object.defineProperty(exports, 'CallToolRequestSchema', {
  enumerable: true,
  get: function () {
    return CallToolRequestSchema;
  }
});
Object.defineProperty(exports, 'CallToolResultSchema', {
  enumerable: true,
  get: function () {
    return CallToolResultSchema;
  }
});
Object.defineProperty(exports, 'CancelTaskRequestSchema', {
  enumerable: true,
  get: function () {
    return CancelTaskRequestSchema;
  }
});
Object.defineProperty(exports, 'CancelTaskResultSchema', {
  enumerable: true,
  get: function () {
    return CancelTaskResultSchema;
  }
});
Object.defineProperty(exports, 'CancelledNotificationParamsSchema', {
  enumerable: true,
  get: function () {
    return CancelledNotificationParamsSchema;
  }
});
Object.defineProperty(exports, 'CancelledNotificationSchema', {
  enumerable: true,
  get: function () {
    return CancelledNotificationSchema;
  }
});
Object.defineProperty(exports, 'ClientCapabilitiesSchema', {
  enumerable: true,
  get: function () {
    return ClientCapabilitiesSchema;
  }
});
Object.defineProperty(exports, 'ClientNotificationSchema', {
  enumerable: true,
  get: function () {
    return ClientNotificationSchema;
  }
});
Object.defineProperty(exports, 'ClientRequestSchema', {
  enumerable: true,
  get: function () {
    return ClientRequestSchema;
  }
});
Object.defineProperty(exports, 'ClientResultSchema', {
  enumerable: true,
  get: function () {
    return ClientResultSchema;
  }
});
Object.defineProperty(exports, 'ClientTasksCapabilitySchema', {
  enumerable: true,
  get: function () {
    return ClientTasksCapabilitySchema;
  }
});
Object.defineProperty(exports, 'CompatibilityCallToolResultSchema', {
  enumerable: true,
  get: function () {
    return CompatibilityCallToolResultSchema;
  }
});
Object.defineProperty(exports, 'CompleteRequestParamsSchema', {
  enumerable: true,
  get: function () {
    return CompleteRequestParamsSchema;
  }
});
Object.defineProperty(exports, 'CompleteRequestSchema', {
  enumerable: true,
  get: function () {
    return CompleteRequestSchema;
  }
});
Object.defineProperty(exports, 'CompleteResultSchema', {
  enumerable: true,
  get: function () {
    return CompleteResultSchema;
  }
});
Object.defineProperty(exports, 'ContentBlockSchema', {
  enumerable: true,
  get: function () {
    return ContentBlockSchema;
  }
});
Object.defineProperty(exports, 'CreateMessageRequestParamsSchema', {
  enumerable: true,
  get: function () {
    return CreateMessageRequestParamsSchema;
  }
});
Object.defineProperty(exports, 'CreateMessageRequestSchema', {
  enumerable: true,
  get: function () {
    return CreateMessageRequestSchema;
  }
});
Object.defineProperty(exports, 'CreateMessageResultSchema', {
  enumerable: true,
  get: function () {
    return CreateMessageResultSchema;
  }
});
Object.defineProperty(exports, 'CreateMessageResultWithToolsSchema', {
  enumerable: true,
  get: function () {
    return CreateMessageResultWithToolsSchema;
  }
});
Object.defineProperty(exports, 'CreateTaskResultSchema', {
  enumerable: true,
  get: function () {
    return CreateTaskResultSchema;
  }
});
Object.defineProperty(exports, 'CursorSchema', {
  enumerable: true,
  get: function () {
    return CursorSchema;
  }
});
Object.defineProperty(exports, 'DEFAULT_NEGOTIATED_PROTOCOL_VERSION', {
  enumerable: true,
  get: function () {
    return DEFAULT_NEGOTIATED_PROTOCOL_VERSION;
  }
});
Object.defineProperty(exports, 'DiscoverRequestSchema', {
  enumerable: true,
  get: function () {
    return DiscoverRequestSchema;
  }
});
Object.defineProperty(exports, 'DiscoverResultSchema', {
  enumerable: true,
  get: function () {
    return DiscoverResultSchema;
  }
});
Object.defineProperty(exports, 'ElicitRequestFormParamsSchema', {
  enumerable: true,
  get: function () {
    return ElicitRequestFormParamsSchema;
  }
});
Object.defineProperty(exports, 'ElicitRequestParamsSchema', {
  enumerable: true,
  get: function () {
    return ElicitRequestParamsSchema;
  }
});
Object.defineProperty(exports, 'ElicitRequestSchema', {
  enumerable: true,
  get: function () {
    return ElicitRequestSchema;
  }
});
Object.defineProperty(exports, 'ElicitRequestURLParamsSchema', {
  enumerable: true,
  get: function () {
    return ElicitRequestURLParamsSchema;
  }
});
Object.defineProperty(exports, 'ElicitResultSchema', {
  enumerable: true,
  get: function () {
    return ElicitResultSchema;
  }
});
Object.defineProperty(exports, 'ElicitationCompleteNotificationParamsSchema', {
  enumerable: true,
  get: function () {
    return ElicitationCompleteNotificationParamsSchema;
  }
});
Object.defineProperty(exports, 'ElicitationCompleteNotificationSchema', {
  enumerable: true,
  get: function () {
    return ElicitationCompleteNotificationSchema;
  }
});
Object.defineProperty(exports, 'EmbeddedResourceSchema', {
  enumerable: true,
  get: function () {
    return EmbeddedResourceSchema;
  }
});
Object.defineProperty(exports, 'EmptyResultSchema', {
  enumerable: true,
  get: function () {
    return EmptyResultSchema;
  }
});
Object.defineProperty(exports, 'EnumSchemaSchema', {
  enumerable: true,
  get: function () {
    return EnumSchemaSchema;
  }
});
Object.defineProperty(exports, 'GetPromptRequestParamsSchema', {
  enumerable: true,
  get: function () {
    return GetPromptRequestParamsSchema;
  }
});
Object.defineProperty(exports, 'GetPromptRequestSchema', {
  enumerable: true,
  get: function () {
    return GetPromptRequestSchema;
  }
});
Object.defineProperty(exports, 'GetPromptResultSchema', {
  enumerable: true,
  get: function () {
    return GetPromptResultSchema;
  }
});
Object.defineProperty(exports, 'GetTaskPayloadRequestSchema', {
  enumerable: true,
  get: function () {
    return GetTaskPayloadRequestSchema;
  }
});
Object.defineProperty(exports, 'GetTaskPayloadResultSchema', {
  enumerable: true,
  get: function () {
    return GetTaskPayloadResultSchema;
  }
});
Object.defineProperty(exports, 'GetTaskRequestSchema', {
  enumerable: true,
  get: function () {
    return GetTaskRequestSchema;
  }
});
Object.defineProperty(exports, 'GetTaskResultSchema', {
  enumerable: true,
  get: function () {
    return GetTaskResultSchema;
  }
});
Object.defineProperty(exports, 'INTERNAL_ERROR', {
  enumerable: true,
  get: function () {
    return INTERNAL_ERROR;
  }
});
Object.defineProperty(exports, 'INVALID_PARAMS', {
  enumerable: true,
  get: function () {
    return INVALID_PARAMS;
  }
});
Object.defineProperty(exports, 'INVALID_REQUEST', {
  enumerable: true,
  get: function () {
    return INVALID_REQUEST;
  }
});
Object.defineProperty(exports, 'IconSchema', {
  enumerable: true,
  get: function () {
    return IconSchema;
  }
});
Object.defineProperty(exports, 'IconsSchema', {
  enumerable: true,
  get: function () {
    return IconsSchema;
  }
});
Object.defineProperty(exports, 'ImageContentSchema', {
  enumerable: true,
  get: function () {
    return ImageContentSchema;
  }
});
Object.defineProperty(exports, 'ImplementationSchema', {
  enumerable: true,
  get: function () {
    return ImplementationSchema;
  }
});
Object.defineProperty(exports, 'InitializeRequestParamsSchema', {
  enumerable: true,
  get: function () {
    return InitializeRequestParamsSchema;
  }
});
Object.defineProperty(exports, 'InitializeRequestSchema', {
  enumerable: true,
  get: function () {
    return InitializeRequestSchema;
  }
});
Object.defineProperty(exports, 'InitializeResultSchema', {
  enumerable: true,
  get: function () {
    return InitializeResultSchema;
  }
});
Object.defineProperty(exports, 'InitializedNotificationSchema', {
  enumerable: true,
  get: function () {
    return InitializedNotificationSchema;
  }
});
Object.defineProperty(exports, 'JSONArraySchema', {
  enumerable: true,
  get: function () {
    return JSONArraySchema;
  }
});
Object.defineProperty(exports, 'JSONObjectSchema', {
  enumerable: true,
  get: function () {
    return JSONObjectSchema;
  }
});
Object.defineProperty(exports, 'JSONRPCErrorResponseSchema', {
  enumerable: true,
  get: function () {
    return JSONRPCErrorResponseSchema;
  }
});
Object.defineProperty(exports, 'JSONRPCMessageSchema', {
  enumerable: true,
  get: function () {
    return JSONRPCMessageSchema;
  }
});
Object.defineProperty(exports, 'JSONRPCNotificationSchema', {
  enumerable: true,
  get: function () {
    return JSONRPCNotificationSchema;
  }
});
Object.defineProperty(exports, 'JSONRPCRequestSchema', {
  enumerable: true,
  get: function () {
    return JSONRPCRequestSchema;
  }
});
Object.defineProperty(exports, 'JSONRPCResponseSchema', {
  enumerable: true,
  get: function () {
    return JSONRPCResponseSchema;
  }
});
Object.defineProperty(exports, 'JSONRPCResultResponseSchema', {
  enumerable: true,
  get: function () {
    return JSONRPCResultResponseSchema;
  }
});
Object.defineProperty(exports, 'JSONRPC_VERSION', {
  enumerable: true,
  get: function () {
    return JSONRPC_VERSION;
  }
});
Object.defineProperty(exports, 'JSONValueSchema', {
  enumerable: true,
  get: function () {
    return JSONValueSchema;
  }
});
Object.defineProperty(exports, 'LATEST_PROTOCOL_VERSION', {
  enumerable: true,
  get: function () {
    return LATEST_PROTOCOL_VERSION;
  }
});
Object.defineProperty(exports, 'LOG_LEVEL_META_KEY', {
  enumerable: true,
  get: function () {
    return LOG_LEVEL_META_KEY;
  }
});
Object.defineProperty(exports, 'LegacyTitledEnumSchemaSchema', {
  enumerable: true,
  get: function () {
    return LegacyTitledEnumSchemaSchema;
  }
});
Object.defineProperty(exports, 'ListChangedOptionsBaseSchema', {
  enumerable: true,
  get: function () {
    return ListChangedOptionsBaseSchema;
  }
});
Object.defineProperty(exports, 'ListPromptsRequestSchema', {
  enumerable: true,
  get: function () {
    return ListPromptsRequestSchema;
  }
});
Object.defineProperty(exports, 'ListPromptsResultSchema', {
  enumerable: true,
  get: function () {
    return ListPromptsResultSchema;
  }
});
Object.defineProperty(exports, 'ListResourceTemplatesRequestSchema', {
  enumerable: true,
  get: function () {
    return ListResourceTemplatesRequestSchema;
  }
});
Object.defineProperty(exports, 'ListResourceTemplatesResultSchema', {
  enumerable: true,
  get: function () {
    return ListResourceTemplatesResultSchema;
  }
});
Object.defineProperty(exports, 'ListResourcesRequestSchema', {
  enumerable: true,
  get: function () {
    return ListResourcesRequestSchema;
  }
});
Object.defineProperty(exports, 'ListResourcesResultSchema', {
  enumerable: true,
  get: function () {
    return ListResourcesResultSchema;
  }
});
Object.defineProperty(exports, 'ListRootsRequestSchema', {
  enumerable: true,
  get: function () {
    return ListRootsRequestSchema;
  }
});
Object.defineProperty(exports, 'ListRootsResultSchema', {
  enumerable: true,
  get: function () {
    return ListRootsResultSchema;
  }
});
Object.defineProperty(exports, 'ListTasksRequestSchema', {
  enumerable: true,
  get: function () {
    return ListTasksRequestSchema;
  }
});
Object.defineProperty(exports, 'ListTasksResultSchema', {
  enumerable: true,
  get: function () {
    return ListTasksResultSchema;
  }
});
Object.defineProperty(exports, 'ListToolsRequestSchema', {
  enumerable: true,
  get: function () {
    return ListToolsRequestSchema;
  }
});
Object.defineProperty(exports, 'ListToolsResultSchema', {
  enumerable: true,
  get: function () {
    return ListToolsResultSchema;
  }
});
Object.defineProperty(exports, 'LoggingLevelSchema', {
  enumerable: true,
  get: function () {
    return LoggingLevelSchema;
  }
});
Object.defineProperty(exports, 'LoggingMessageNotificationParamsSchema', {
  enumerable: true,
  get: function () {
    return LoggingMessageNotificationParamsSchema;
  }
});
Object.defineProperty(exports, 'LoggingMessageNotificationSchema', {
  enumerable: true,
  get: function () {
    return LoggingMessageNotificationSchema;
  }
});
Object.defineProperty(exports, 'METHOD_NOT_FOUND', {
  enumerable: true,
  get: function () {
    return METHOD_NOT_FOUND;
  }
});
Object.defineProperty(exports, 'ModelHintSchema', {
  enumerable: true,
  get: function () {
    return ModelHintSchema;
  }
});
Object.defineProperty(exports, 'ModelPreferencesSchema', {
  enumerable: true,
  get: function () {
    return ModelPreferencesSchema;
  }
});
Object.defineProperty(exports, 'MultiSelectEnumSchemaSchema', {
  enumerable: true,
  get: function () {
    return MultiSelectEnumSchemaSchema;
  }
});
Object.defineProperty(exports, 'NotificationSchema', {
  enumerable: true,
  get: function () {
    return NotificationSchema;
  }
});
Object.defineProperty(exports, 'NotificationsParamsSchema', {
  enumerable: true,
  get: function () {
    return NotificationsParamsSchema;
  }
});
Object.defineProperty(exports, 'NumberSchemaSchema', {
  enumerable: true,
  get: function () {
    return NumberSchemaSchema;
  }
});
Object.defineProperty(exports, 'PARSE_ERROR', {
  enumerable: true,
  get: function () {
    return PARSE_ERROR;
  }
});
Object.defineProperty(exports, 'PROTOCOL_VERSION_META_KEY', {
  enumerable: true,
  get: function () {
    return PROTOCOL_VERSION_META_KEY;
  }
});
Object.defineProperty(exports, 'PaginatedRequestParamsSchema', {
  enumerable: true,
  get: function () {
    return PaginatedRequestParamsSchema;
  }
});
Object.defineProperty(exports, 'PaginatedRequestSchema', {
  enumerable: true,
  get: function () {
    return PaginatedRequestSchema;
  }
});
Object.defineProperty(exports, 'PaginatedResultSchema', {
  enumerable: true,
  get: function () {
    return PaginatedResultSchema;
  }
});
Object.defineProperty(exports, 'PingRequestSchema', {
  enumerable: true,
  get: function () {
    return PingRequestSchema;
  }
});
Object.defineProperty(exports, 'PrimitiveSchemaDefinitionSchema', {
  enumerable: true,
  get: function () {
    return PrimitiveSchemaDefinitionSchema;
  }
});
Object.defineProperty(exports, 'ProgressNotificationParamsSchema', {
  enumerable: true,
  get: function () {
    return ProgressNotificationParamsSchema;
  }
});
Object.defineProperty(exports, 'ProgressNotificationSchema', {
  enumerable: true,
  get: function () {
    return ProgressNotificationSchema;
  }
});
Object.defineProperty(exports, 'ProgressSchema', {
  enumerable: true,
  get: function () {
    return ProgressSchema;
  }
});
Object.defineProperty(exports, 'ProgressTokenSchema', {
  enumerable: true,
  get: function () {
    return ProgressTokenSchema;
  }
});
Object.defineProperty(exports, 'PromptArgumentSchema', {
  enumerable: true,
  get: function () {
    return PromptArgumentSchema;
  }
});
Object.defineProperty(exports, 'PromptListChangedNotificationSchema', {
  enumerable: true,
  get: function () {
    return PromptListChangedNotificationSchema;
  }
});
Object.defineProperty(exports, 'PromptMessageSchema', {
  enumerable: true,
  get: function () {
    return PromptMessageSchema;
  }
});
Object.defineProperty(exports, 'PromptReferenceSchema', {
  enumerable: true,
  get: function () {
    return PromptReferenceSchema;
  }
});
Object.defineProperty(exports, 'PromptSchema', {
  enumerable: true,
  get: function () {
    return PromptSchema;
  }
});
Object.defineProperty(exports, 'RELATED_TASK_META_KEY', {
  enumerable: true,
  get: function () {
    return RELATED_TASK_META_KEY;
  }
});
Object.defineProperty(exports, 'ReadResourceRequestParamsSchema', {
  enumerable: true,
  get: function () {
    return ReadResourceRequestParamsSchema;
  }
});
Object.defineProperty(exports, 'ReadResourceRequestSchema', {
  enumerable: true,
  get: function () {
    return ReadResourceRequestSchema;
  }
});
Object.defineProperty(exports, 'ReadResourceResultSchema', {
  enumerable: true,
  get: function () {
    return ReadResourceResultSchema;
  }
});
Object.defineProperty(exports, 'RelatedTaskMetadataSchema', {
  enumerable: true,
  get: function () {
    return RelatedTaskMetadataSchema;
  }
});
Object.defineProperty(exports, 'RequestIdSchema', {
  enumerable: true,
  get: function () {
    return RequestIdSchema;
  }
});
Object.defineProperty(exports, 'RequestMetaSchema', {
  enumerable: true,
  get: function () {
    return RequestMetaSchema;
  }
});
Object.defineProperty(exports, 'RequestSchema', {
  enumerable: true,
  get: function () {
    return RequestSchema;
  }
});
Object.defineProperty(exports, 'ResourceContentsSchema', {
  enumerable: true,
  get: function () {
    return ResourceContentsSchema;
  }
});
Object.defineProperty(exports, 'ResourceLinkSchema', {
  enumerable: true,
  get: function () {
    return ResourceLinkSchema;
  }
});
Object.defineProperty(exports, 'ResourceListChangedNotificationSchema', {
  enumerable: true,
  get: function () {
    return ResourceListChangedNotificationSchema;
  }
});
Object.defineProperty(exports, 'ResourceRequestParamsSchema', {
  enumerable: true,
  get: function () {
    return ResourceRequestParamsSchema;
  }
});
Object.defineProperty(exports, 'ResourceSchema', {
  enumerable: true,
  get: function () {
    return ResourceSchema;
  }
});
Object.defineProperty(exports, 'ResourceTemplateReferenceSchema', {
  enumerable: true,
  get: function () {
    return ResourceTemplateReferenceSchema;
  }
});
Object.defineProperty(exports, 'ResourceTemplateSchema', {
  enumerable: true,
  get: function () {
    return ResourceTemplateSchema;
  }
});
Object.defineProperty(exports, 'ResourceUpdatedNotificationParamsSchema', {
  enumerable: true,
  get: function () {
    return ResourceUpdatedNotificationParamsSchema;
  }
});
Object.defineProperty(exports, 'ResourceUpdatedNotificationSchema', {
  enumerable: true,
  get: function () {
    return ResourceUpdatedNotificationSchema;
  }
});
Object.defineProperty(exports, 'ResultMetaObjectSchema', {
  enumerable: true,
  get: function () {
    return ResultMetaObjectSchema;
  }
});
Object.defineProperty(exports, 'ResultSchema', {
  enumerable: true,
  get: function () {
    return ResultSchema;
  }
});
Object.defineProperty(exports, 'RoleSchema', {
  enumerable: true,
  get: function () {
    return RoleSchema;
  }
});
Object.defineProperty(exports, 'RootSchema', {
  enumerable: true,
  get: function () {
    return RootSchema;
  }
});
Object.defineProperty(exports, 'RootsListChangedNotificationSchema', {
  enumerable: true,
  get: function () {
    return RootsListChangedNotificationSchema;
  }
});
Object.defineProperty(exports, 'SERVER_INFO_META_KEY', {
  enumerable: true,
  get: function () {
    return SERVER_INFO_META_KEY;
  }
});
Object.defineProperty(exports, 'SUBSCRIPTION_ID_META_KEY', {
  enumerable: true,
  get: function () {
    return SUBSCRIPTION_ID_META_KEY;
  }
});
Object.defineProperty(exports, 'SUPPORTED_PROTOCOL_VERSIONS', {
  enumerable: true,
  get: function () {
    return SUPPORTED_PROTOCOL_VERSIONS;
  }
});
Object.defineProperty(exports, 'SamplingContentSchema', {
  enumerable: true,
  get: function () {
    return SamplingContentSchema;
  }
});
Object.defineProperty(exports, 'SamplingMessageContentBlockSchema', {
  enumerable: true,
  get: function () {
    return SamplingMessageContentBlockSchema;
  }
});
Object.defineProperty(exports, 'SamplingMessageSchema', {
  enumerable: true,
  get: function () {
    return SamplingMessageSchema;
  }
});
Object.defineProperty(exports, 'ServerCapabilitiesSchema', {
  enumerable: true,
  get: function () {
    return ServerCapabilitiesSchema;
  }
});
Object.defineProperty(exports, 'ServerNotificationSchema', {
  enumerable: true,
  get: function () {
    return ServerNotificationSchema;
  }
});
Object.defineProperty(exports, 'ServerRequestSchema', {
  enumerable: true,
  get: function () {
    return ServerRequestSchema;
  }
});
Object.defineProperty(exports, 'ServerResultSchema', {
  enumerable: true,
  get: function () {
    return ServerResultSchema;
  }
});
Object.defineProperty(exports, 'ServerTasksCapabilitySchema', {
  enumerable: true,
  get: function () {
    return ServerTasksCapabilitySchema;
  }
});
Object.defineProperty(exports, 'SetLevelRequestParamsSchema', {
  enumerable: true,
  get: function () {
    return SetLevelRequestParamsSchema;
  }
});
Object.defineProperty(exports, 'SetLevelRequestSchema', {
  enumerable: true,
  get: function () {
    return SetLevelRequestSchema;
  }
});
Object.defineProperty(exports, 'SingleSelectEnumSchemaSchema', {
  enumerable: true,
  get: function () {
    return SingleSelectEnumSchemaSchema;
  }
});
Object.defineProperty(exports, 'StringSchemaSchema', {
  enumerable: true,
  get: function () {
    return StringSchemaSchema;
  }
});
Object.defineProperty(exports, 'SubscribeRequestParamsSchema', {
  enumerable: true,
  get: function () {
    return SubscribeRequestParamsSchema;
  }
});
Object.defineProperty(exports, 'SubscribeRequestSchema', {
  enumerable: true,
  get: function () {
    return SubscribeRequestSchema;
  }
});
Object.defineProperty(exports, 'SubscriptionFilterSchema', {
  enumerable: true,
  get: function () {
    return SubscriptionFilterSchema;
  }
});
Object.defineProperty(exports, 'SubscriptionsAcknowledgedNotificationParamsSchema', {
  enumerable: true,
  get: function () {
    return SubscriptionsAcknowledgedNotificationParamsSchema;
  }
});
Object.defineProperty(exports, 'SubscriptionsAcknowledgedNotificationSchema', {
  enumerable: true,
  get: function () {
    return SubscriptionsAcknowledgedNotificationSchema;
  }
});
Object.defineProperty(exports, 'SubscriptionsListenRequestParamsSchema', {
  enumerable: true,
  get: function () {
    return SubscriptionsListenRequestParamsSchema;
  }
});
Object.defineProperty(exports, 'SubscriptionsListenRequestSchema', {
  enumerable: true,
  get: function () {
    return SubscriptionsListenRequestSchema;
  }
});
Object.defineProperty(exports, 'SubscriptionsListenResultMetaSchema', {
  enumerable: true,
  get: function () {
    return SubscriptionsListenResultMetaSchema;
  }
});
Object.defineProperty(exports, 'SubscriptionsListenResultSchema', {
  enumerable: true,
  get: function () {
    return SubscriptionsListenResultSchema;
  }
});
Object.defineProperty(exports, 'TRACEPARENT_META_KEY', {
  enumerable: true,
  get: function () {
    return TRACEPARENT_META_KEY;
  }
});
Object.defineProperty(exports, 'TRACESTATE_META_KEY', {
  enumerable: true,
  get: function () {
    return TRACESTATE_META_KEY;
  }
});
Object.defineProperty(exports, 'TaskAugmentedRequestParamsSchema', {
  enumerable: true,
  get: function () {
    return TaskAugmentedRequestParamsSchema;
  }
});
Object.defineProperty(exports, 'TaskCreationParamsSchema', {
  enumerable: true,
  get: function () {
    return TaskCreationParamsSchema;
  }
});
Object.defineProperty(exports, 'TaskMetadataSchema', {
  enumerable: true,
  get: function () {
    return TaskMetadataSchema;
  }
});
Object.defineProperty(exports, 'TaskSchema', {
  enumerable: true,
  get: function () {
    return TaskSchema;
  }
});
Object.defineProperty(exports, 'TaskStatusNotificationParamsSchema', {
  enumerable: true,
  get: function () {
    return TaskStatusNotificationParamsSchema;
  }
});
Object.defineProperty(exports, 'TaskStatusNotificationSchema', {
  enumerable: true,
  get: function () {
    return TaskStatusNotificationSchema;
  }
});
Object.defineProperty(exports, 'TaskStatusSchema', {
  enumerable: true,
  get: function () {
    return TaskStatusSchema;
  }
});
Object.defineProperty(exports, 'TextContentSchema', {
  enumerable: true,
  get: function () {
    return TextContentSchema;
  }
});
Object.defineProperty(exports, 'TextResourceContentsSchema', {
  enumerable: true,
  get: function () {
    return TextResourceContentsSchema;
  }
});
Object.defineProperty(exports, 'TitledMultiSelectEnumSchemaSchema', {
  enumerable: true,
  get: function () {
    return TitledMultiSelectEnumSchemaSchema;
  }
});
Object.defineProperty(exports, 'TitledSingleSelectEnumSchemaSchema', {
  enumerable: true,
  get: function () {
    return TitledSingleSelectEnumSchemaSchema;
  }
});
Object.defineProperty(exports, 'ToolAnnotationsSchema', {
  enumerable: true,
  get: function () {
    return ToolAnnotationsSchema;
  }
});
Object.defineProperty(exports, 'ToolChoiceSchema', {
  enumerable: true,
  get: function () {
    return ToolChoiceSchema;
  }
});
Object.defineProperty(exports, 'ToolExecutionSchema', {
  enumerable: true,
  get: function () {
    return ToolExecutionSchema;
  }
});
Object.defineProperty(exports, 'ToolListChangedNotificationSchema', {
  enumerable: true,
  get: function () {
    return ToolListChangedNotificationSchema;
  }
});
Object.defineProperty(exports, 'ToolResultContentSchema', {
  enumerable: true,
  get: function () {
    return ToolResultContentSchema;
  }
});
Object.defineProperty(exports, 'ToolSchema', {
  enumerable: true,
  get: function () {
    return ToolSchema;
  }
});
Object.defineProperty(exports, 'ToolUseContentSchema', {
  enumerable: true,
  get: function () {
    return ToolUseContentSchema;
  }
});
Object.defineProperty(exports, 'UnsubscribeRequestParamsSchema', {
  enumerable: true,
  get: function () {
    return UnsubscribeRequestParamsSchema;
  }
});
Object.defineProperty(exports, 'UnsubscribeRequestSchema', {
  enumerable: true,
  get: function () {
    return UnsubscribeRequestSchema;
  }
});
Object.defineProperty(exports, 'UntitledMultiSelectEnumSchemaSchema', {
  enumerable: true,
  get: function () {
    return UntitledMultiSelectEnumSchemaSchema;
  }
});
Object.defineProperty(exports, 'UntitledSingleSelectEnumSchemaSchema', {
  enumerable: true,
  get: function () {
    return UntitledSingleSelectEnumSchemaSchema;
  }
});
Object.defineProperty(exports, '__toESM', {
  enumerable: true,
  get: function () {
    return __toESM;
  }
});
//# sourceMappingURL=schemas-lGLjBX8n.cjs.map