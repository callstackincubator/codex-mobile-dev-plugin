import * as z from "zod/v4";

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
const JSONValueSchema = z.lazy(() => z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.null(),
	z.record(z.string(), JSONValueSchema),
	z.array(JSONValueSchema)
]));
const JSONObjectSchema = z.record(z.string(), JSONValueSchema);
const JSONArraySchema = z.array(JSONValueSchema);
/**
* A progress token, used to associate progress notifications with the original request.
*/
const ProgressTokenSchema = z.union([z.string(), z.number().int()]);
/**
* An opaque token used to represent a cursor for pagination.
*/
const CursorSchema = z.string();
/** @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only. */
const TaskMetadataSchema = z.object({ ttl: z.number().optional() });
/**
* Metadata for associating messages with a task.
* Include this in the `_meta` field under the key `io.modelcontextprotocol/related-task`.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const RelatedTaskMetadataSchema = z.object({ taskId: z.string() });
const RequestMetaSchema = z.looseObject({
	progressToken: ProgressTokenSchema.optional(),
	[RELATED_TASK_META_KEY]: RelatedTaskMetadataSchema.optional()
});
/**
* Common params for any request.
*/
const BaseRequestParamsSchema = z.object({ _meta: RequestMetaSchema.optional() });
/**
* Common params for any task-augmented request.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const TaskAugmentedRequestParamsSchema = BaseRequestParamsSchema.extend({ task: TaskMetadataSchema.optional() });
const RequestSchema = z.object({
	method: z.string(),
	params: BaseRequestParamsSchema.loose().optional()
});
const NotificationsParamsSchema = z.object({ _meta: RequestMetaSchema.optional() });
const NotificationSchema = z.object({
	method: z.string(),
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
const ResultMetaObjectSchema = z.looseObject({ get [SERVER_INFO_META_KEY]() {
	return ImplementationSchema.optional().catch(void 0);
} });
const ResultSchema = z.looseObject({ _meta: ResultMetaObjectSchema.optional() });
/**
* A uniquely identifying ID for a request in JSON-RPC.
*/
const RequestIdSchema = z.union([z.string(), z.number().int()]);
/**
* A request that expects a response.
*/
const JSONRPCRequestSchema = z.object({
	jsonrpc: z.literal(JSONRPC_VERSION),
	id: RequestIdSchema,
	...RequestSchema.shape
}).strict();
/**
* A notification which does not expect a response.
*/
const JSONRPCNotificationSchema = z.object({
	jsonrpc: z.literal(JSONRPC_VERSION),
	...NotificationSchema.shape
}).strict();
/**
* A successful (non-error) response to a request.
*/
const JSONRPCResultResponseSchema = z.object({
	jsonrpc: z.literal(JSONRPC_VERSION),
	id: RequestIdSchema,
	result: ResultSchema
}).strict();
/**
* A response to a request that indicates an error occurred.
*/
const JSONRPCErrorResponseSchema = z.object({
	jsonrpc: z.literal(JSONRPC_VERSION),
	id: RequestIdSchema.optional(),
	error: z.object({
		code: z.number().int(),
		message: z.string(),
		data: z.unknown().optional()
	})
}).strict();
const JSONRPCMessageSchema = z.union([
	JSONRPCRequestSchema,
	JSONRPCNotificationSchema,
	JSONRPCResultResponseSchema,
	JSONRPCErrorResponseSchema
]);
const JSONRPCResponseSchema = z.union([JSONRPCResultResponseSchema, JSONRPCErrorResponseSchema]);
/**
* A response that indicates success but carries no data.
*/
const EmptyResultSchema = ResultSchema.strict();
const CancelledNotificationParamsSchema = NotificationsParamsSchema.extend({
	requestId: RequestIdSchema.optional(),
	reason: z.string().optional()
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
	method: z.literal("notifications/cancelled"),
	params: CancelledNotificationParamsSchema
});
/**
* Icon schema for use in {@link Tool | tools}, {@link Prompt | prompts}, {@link Resource | resources}, and {@link Implementation | implementations}.
*/
const IconSchema = z.object({
	src: z.string(),
	mimeType: z.string().optional(),
	sizes: z.array(z.string()).optional(),
	theme: z.enum(["light", "dark"]).optional()
});
/**
* Base schema to add `icons` property.
*
*/
const IconsSchema = z.object({ icons: z.array(IconSchema).optional() });
/**
* Base metadata interface for common properties across {@link Resource | resources}, {@link Tool | tools}, {@link Prompt | prompts}, and {@link Implementation | implementations}.
*/
const BaseMetadataSchema = z.object({
	name: z.string(),
	title: z.string().optional()
});
/**
* Describes the name and version of an MCP implementation.
*/
const ImplementationSchema = BaseMetadataSchema.extend({
	...BaseMetadataSchema.shape,
	...IconsSchema.shape,
	version: z.string(),
	websiteUrl: z.string().optional(),
	description: z.string().optional()
});
const FormElicitationCapabilitySchema = z.intersection(z.object({ applyDefaults: z.boolean().optional() }), JSONObjectSchema);
const ElicitationCapabilitySchema = z.preprocess((value) => {
	if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return { form: {} };
	return value;
}, z.intersection(z.object({
	form: FormElicitationCapabilitySchema.optional(),
	url: JSONObjectSchema.optional()
}), JSONObjectSchema.optional()));
/**
* Task capabilities for clients, indicating which request types support task creation.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const ClientTasksCapabilitySchema = z.looseObject({
	list: JSONObjectSchema.optional(),
	cancel: JSONObjectSchema.optional(),
	requests: z.looseObject({
		sampling: z.looseObject({ createMessage: JSONObjectSchema.optional() }).optional(),
		elicitation: z.looseObject({ create: JSONObjectSchema.optional() }).optional()
	}).optional()
});
/**
* Task capabilities for servers, indicating which request types support task creation.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const ServerTasksCapabilitySchema = z.looseObject({
	list: JSONObjectSchema.optional(),
	cancel: JSONObjectSchema.optional(),
	requests: z.looseObject({ tools: z.looseObject({ call: JSONObjectSchema.optional() }).optional() }).optional()
});
/**
* Capabilities a client may support. Known capabilities are defined here, in this schema, but this is not a closed set: any client can define its own, additional capabilities.
*/
const ClientCapabilitiesSchema = z.object({
	experimental: z.record(z.string(), JSONObjectSchema).optional(),
	sampling: z.object({
		context: JSONObjectSchema.optional(),
		tools: JSONObjectSchema.optional()
	}).optional(),
	elicitation: ElicitationCapabilitySchema.optional(),
	roots: z.object({ listChanged: z.boolean().optional() }).optional(),
	tasks: ClientTasksCapabilitySchema.optional(),
	extensions: z.record(z.string(), JSONObjectSchema).optional()
});
const InitializeRequestParamsSchema = BaseRequestParamsSchema.extend({
	protocolVersion: z.string(),
	capabilities: ClientCapabilitiesSchema,
	clientInfo: ImplementationSchema
});
/**
* This request is sent from the client to the server when it first connects, asking it to begin initialization.
*/
const InitializeRequestSchema = RequestSchema.extend({
	method: z.literal("initialize"),
	params: InitializeRequestParamsSchema
});
/**
* Capabilities that a server may support. Known capabilities are defined here, in this schema, but this is not a closed set: any server can define its own, additional capabilities.
*/
const ServerCapabilitiesSchema = z.object({
	experimental: z.record(z.string(), JSONObjectSchema).optional(),
	logging: JSONObjectSchema.optional(),
	completions: JSONObjectSchema.optional(),
	prompts: z.object({ listChanged: z.boolean().optional() }).optional(),
	resources: z.object({
		subscribe: z.boolean().optional(),
		listChanged: z.boolean().optional()
	}).optional(),
	tools: z.object({ listChanged: z.boolean().optional() }).optional(),
	tasks: ServerTasksCapabilitySchema.optional(),
	extensions: z.record(z.string(), JSONObjectSchema).optional()
});
/**
* After receiving an initialize request from the client, the server sends this response.
*/
const InitializeResultSchema = ResultSchema.extend({
	protocolVersion: z.string(),
	capabilities: ServerCapabilitiesSchema,
	serverInfo: ImplementationSchema,
	instructions: z.string().optional()
});
/**
* This notification is sent from the client to the server after initialization has finished.
*/
const InitializedNotificationSchema = NotificationSchema.extend({
	method: z.literal("notifications/initialized"),
	params: NotificationsParamsSchema.optional()
});
/**
* A request from the client asking the server to advertise its supported protocol
* versions, capabilities, and other metadata (protocol revision 2026-07-28). Servers
* MUST implement `server/discover`. Clients MAY call it but are not required to —
* version negotiation can also happen inline via the per-request `_meta` envelope.
*/
const DiscoverRequestSchema = RequestSchema.extend({
	method: z.literal("server/discover"),
	params: BaseRequestParamsSchema.optional()
});
/**
* The result returned by the server for a `server/discover` request.
*/
const DiscoverResultSchema = ResultSchema.extend({
	supportedVersions: z.array(z.string()),
	capabilities: ServerCapabilitiesSchema,
	instructions: z.string().optional()
});
/**
* A ping, issued by either the server or the client, to check that the other party is still alive. The receiver must promptly respond, or else may be disconnected.
*/
const PingRequestSchema = RequestSchema.extend({
	method: z.literal("ping"),
	params: BaseRequestParamsSchema.optional()
});
const ProgressSchema = z.object({
	progress: z.number(),
	total: z.optional(z.number()),
	message: z.optional(z.string())
});
const ProgressNotificationParamsSchema = z.object({
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
	method: z.literal("notifications/progress"),
	params: ProgressNotificationParamsSchema
});
const PaginatedRequestParamsSchema = BaseRequestParamsSchema.extend({ cursor: CursorSchema.optional() });
const PaginatedRequestSchema = RequestSchema.extend({ params: PaginatedRequestParamsSchema.optional() });
const PaginatedResultSchema = ResultSchema.extend({ nextCursor: CursorSchema.optional() });
/**
* The contents of a specific resource or sub-resource.
*/
const ResourceContentsSchema = z.object({
	uri: z.string(),
	mimeType: z.optional(z.string()),
	_meta: z.record(z.string(), z.unknown()).optional()
});
const TextResourceContentsSchema = ResourceContentsSchema.extend({ text: z.string() });
/**
* A Zod schema for validating Base64 strings that is more performant and
* robust for very large inputs than the default regex-based check. It avoids
* stack overflows by using the native `atob` function for validation.
*/
const Base64Schema = z.string().refine((val) => {
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
const RoleSchema = z.enum(["user", "assistant"]);
/**
* Optional annotations providing clients additional context about a resource.
*/
const AnnotationsSchema = z.object({
	audience: z.array(RoleSchema).optional(),
	priority: z.number().min(0).max(1).optional(),
	lastModified: z.iso.datetime({ offset: true }).optional()
});
/**
* A known resource that the server is capable of reading.
*/
const ResourceSchema = z.object({
	...BaseMetadataSchema.shape,
	...IconsSchema.shape,
	uri: z.string(),
	description: z.optional(z.string()),
	mimeType: z.optional(z.string()),
	size: z.optional(z.number()),
	annotations: AnnotationsSchema.optional(),
	_meta: z.optional(z.looseObject({}))
});
/**
* A template description for resources available on the server.
*/
const ResourceTemplateSchema = z.object({
	...BaseMetadataSchema.shape,
	...IconsSchema.shape,
	uriTemplate: z.string(),
	description: z.optional(z.string()),
	mimeType: z.optional(z.string()),
	annotations: AnnotationsSchema.optional(),
	_meta: z.optional(z.looseObject({}))
});
/**
* Sent from the client to request a list of resources the server has.
*/
const ListResourcesRequestSchema = PaginatedRequestSchema.extend({ method: z.literal("resources/list") });
/**
* The server's response to a {@linkcode ListResourcesRequest | resources/list} request from the client.
*/
const ListResourcesResultSchema = PaginatedResultSchema.extend({ resources: z.array(ResourceSchema) });
/**
* Sent from the client to request a list of resource templates the server has.
*/
const ListResourceTemplatesRequestSchema = PaginatedRequestSchema.extend({ method: z.literal("resources/templates/list") });
/**
* The server's response to a {@linkcode ListResourceTemplatesRequest | resources/templates/list} request from the client.
*/
const ListResourceTemplatesResultSchema = PaginatedResultSchema.extend({ resourceTemplates: z.array(ResourceTemplateSchema) });
const ResourceRequestParamsSchema = BaseRequestParamsSchema.extend({ uri: z.string() });
/**
* Parameters for a {@linkcode ReadResourceRequest | resources/read} request.
*/
const ReadResourceRequestParamsSchema = ResourceRequestParamsSchema;
/**
* Sent from the client to the server, to read a specific resource URI.
*/
const ReadResourceRequestSchema = RequestSchema.extend({
	method: z.literal("resources/read"),
	params: ReadResourceRequestParamsSchema
});
/**
* The server's response to a {@linkcode ReadResourceRequest | resources/read} request from the client.
*/
const ReadResourceResultSchema = ResultSchema.extend({ contents: z.array(z.union([TextResourceContentsSchema, BlobResourceContentsSchema])) });
/**
* An optional notification from the server to the client, informing it that the list of resources it can read from has changed. This may be issued by servers without any previous subscription from the client.
*/
const ResourceListChangedNotificationSchema = NotificationSchema.extend({
	method: z.literal("notifications/resources/list_changed"),
	params: NotificationsParamsSchema.optional()
});
const SubscribeRequestParamsSchema = ResourceRequestParamsSchema;
/**
* Sent from the client to request `resources/updated` notifications from the server whenever a particular resource changes.
*/
const SubscribeRequestSchema = RequestSchema.extend({
	method: z.literal("resources/subscribe"),
	params: SubscribeRequestParamsSchema
});
const UnsubscribeRequestParamsSchema = ResourceRequestParamsSchema;
/**
* Sent from the client to request cancellation of {@linkcode ResourceUpdatedNotification | resources/updated} notifications from the server. This should follow a previous {@linkcode SubscribeRequest | resources/subscribe} request.
*/
const UnsubscribeRequestSchema = RequestSchema.extend({
	method: z.literal("resources/unsubscribe"),
	params: UnsubscribeRequestParamsSchema
});
/**
* The set of notification types a client opts in to on a `subscriptions/listen`
* request. Each type is opt-in; the server MUST NOT send a notification type
* the client has not explicitly requested here.
*/
const SubscriptionFilterSchema = z.object({
	toolsListChanged: z.boolean().optional(),
	promptsListChanged: z.boolean().optional(),
	resourcesListChanged: z.boolean().optional(),
	resourceSubscriptions: z.array(z.string()).optional()
});
const SubscriptionsListenRequestParamsSchema = BaseRequestParamsSchema.extend({ notifications: SubscriptionFilterSchema });
/**
* Sent from the client to open a long-lived channel for receiving notifications
* outside the context of a specific request (protocol revision 2026-07-28).
* Replaces the previous HTTP GET endpoint and `resources/subscribe`.
*/
const SubscriptionsListenRequestSchema = RequestSchema.extend({
	method: z.literal("subscriptions/listen"),
	params: SubscriptionsListenRequestParamsSchema
});
const SubscriptionsAcknowledgedNotificationParamsSchema = NotificationsParamsSchema.extend({ notifications: SubscriptionFilterSchema });
/**
* Sent by the server as the first message on a `subscriptions/listen` stream
* to acknowledge that the subscription has been established and report which
* notification types it agreed to honor (protocol revision 2026-07-28).
*/
const SubscriptionsAcknowledgedNotificationSchema = NotificationSchema.extend({
	method: z.literal("notifications/subscriptions/acknowledged"),
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
const ResourceUpdatedNotificationParamsSchema = NotificationsParamsSchema.extend({ uri: z.string() });
/**
* A notification from the server to the client, informing it that a resource has changed and may need to be read again. This should only be sent if the client previously sent a {@linkcode SubscribeRequest | resources/subscribe} request.
*/
const ResourceUpdatedNotificationSchema = NotificationSchema.extend({
	method: z.literal("notifications/resources/updated"),
	params: ResourceUpdatedNotificationParamsSchema
});
/**
* Describes an argument that a prompt can accept.
*/
const PromptArgumentSchema = z.object({
	name: z.string(),
	description: z.optional(z.string()),
	required: z.optional(z.boolean())
});
/**
* A prompt or prompt template that the server offers.
*/
const PromptSchema = z.object({
	...BaseMetadataSchema.shape,
	...IconsSchema.shape,
	description: z.optional(z.string()),
	arguments: z.optional(z.array(PromptArgumentSchema)),
	_meta: z.optional(z.looseObject({}))
});
/**
* Sent from the client to request a list of prompts and prompt templates the server has.
*/
const ListPromptsRequestSchema = PaginatedRequestSchema.extend({ method: z.literal("prompts/list") });
/**
* The server's response to a {@linkcode ListPromptsRequest | prompts/list} request from the client.
*/
const ListPromptsResultSchema = PaginatedResultSchema.extend({ prompts: z.array(PromptSchema) });
/**
* Parameters for a {@linkcode GetPromptRequest | prompts/get} request.
*/
const GetPromptRequestParamsSchema = BaseRequestParamsSchema.extend({
	name: z.string(),
	arguments: z.record(z.string(), z.string()).optional()
});
/**
* Used by the client to get a prompt provided by the server.
*/
const GetPromptRequestSchema = RequestSchema.extend({
	method: z.literal("prompts/get"),
	params: GetPromptRequestParamsSchema
});
/**
* Text provided to or from an LLM.
*/
const TextContentSchema = z.object({
	type: z.literal("text"),
	text: z.string(),
	annotations: AnnotationsSchema.optional(),
	_meta: z.record(z.string(), z.unknown()).optional()
});
/**
* An image provided to or from an LLM.
*/
const ImageContentSchema = z.object({
	type: z.literal("image"),
	data: Base64Schema,
	mimeType: z.string(),
	annotations: AnnotationsSchema.optional(),
	_meta: z.record(z.string(), z.unknown()).optional()
});
/**
* Audio content provided to or from an LLM.
*/
const AudioContentSchema = z.object({
	type: z.literal("audio"),
	data: Base64Schema,
	mimeType: z.string(),
	annotations: AnnotationsSchema.optional(),
	_meta: z.record(z.string(), z.unknown()).optional()
});
/**
* A tool call request from an assistant (LLM).
* Represents the assistant's request to use a tool.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to calling LLM
* provider APIs directly.
*/
const ToolUseContentSchema = z.object({
	type: z.literal("tool_use"),
	name: z.string(),
	id: z.string(),
	input: z.record(z.string(), z.unknown()),
	_meta: z.record(z.string(), z.unknown()).optional()
});
/**
* The contents of a resource, embedded into a prompt or tool call result.
*/
const EmbeddedResourceSchema = z.object({
	type: z.literal("resource"),
	resource: z.union([TextResourceContentsSchema, BlobResourceContentsSchema]),
	annotations: AnnotationsSchema.optional(),
	_meta: z.record(z.string(), z.unknown()).optional()
});
/**
* A resource that the server is capable of reading, included in a prompt or tool call result.
*
* Note: resource links returned by tools are not guaranteed to appear in the results of {@linkcode ListResourcesRequest | resources/list} requests.
*/
const ResourceLinkSchema = ResourceSchema.extend({ type: z.literal("resource_link") });
/**
* A content block that can be used in prompts and tool results.
*/
const ContentBlockSchema = z.union([
	TextContentSchema,
	ImageContentSchema,
	AudioContentSchema,
	ResourceLinkSchema,
	EmbeddedResourceSchema
]);
/**
* Describes a message returned as part of a prompt.
*/
const PromptMessageSchema = z.object({
	role: RoleSchema,
	content: ContentBlockSchema
});
/**
* The server's response to a {@linkcode GetPromptRequest | prompts/get} request from the client.
*/
const GetPromptResultSchema = ResultSchema.extend({
	description: z.string().optional(),
	messages: z.array(PromptMessageSchema)
});
/**
* An optional notification from the server to the client, informing it that the list of prompts it offers has changed. This may be issued by servers without any previous subscription from the client.
*/
const PromptListChangedNotificationSchema = NotificationSchema.extend({
	method: z.literal("notifications/prompts/list_changed"),
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
const ToolAnnotationsSchema = z.object({
	title: z.string().optional(),
	readOnlyHint: z.boolean().optional(),
	destructiveHint: z.boolean().optional(),
	idempotentHint: z.boolean().optional(),
	openWorldHint: z.boolean().optional()
});
/**
* Execution-related properties for a tool.
*/
const ToolExecutionSchema = z.object({ taskSupport: z.enum([
	"required",
	"optional",
	"forbidden"
]).optional() });
/**
* Definition for a tool the client can call.
*/
const ToolSchema = z.object({
	...BaseMetadataSchema.shape,
	...IconsSchema.shape,
	description: z.string().optional(),
	inputSchema: z.object({
		type: z.literal("object"),
		properties: z.record(z.string(), JSONValueSchema).optional(),
		required: z.array(z.string()).optional()
	}).catchall(z.unknown()),
	outputSchema: z.looseObject({ $schema: z.string().optional() }).optional(),
	annotations: ToolAnnotationsSchema.optional(),
	execution: ToolExecutionSchema.optional(),
	_meta: z.record(z.string(), z.unknown()).optional()
});
/**
* Sent from the client to request a list of tools the server has.
*/
const ListToolsRequestSchema = PaginatedRequestSchema.extend({ method: z.literal("tools/list") });
/**
* The server's response to a {@linkcode ListToolsRequest | tools/list} request from the client.
*/
const ListToolsResultSchema = PaginatedResultSchema.extend({ tools: z.array(ToolSchema) });
/**
* The server's response to a tool call.
*/
const CallToolResultSchema = ResultSchema.extend({
	content: z.array(ContentBlockSchema).default([]),
	structuredContent: z.unknown().optional(),
	isError: z.boolean().optional()
});
/**
* {@linkcode CallToolResultSchema} extended with backwards compatibility to protocol version 2024-10-07.
*/
const CompatibilityCallToolResultSchema = CallToolResultSchema.or(ResultSchema.extend({ toolResult: z.unknown() }));
/**
* Parameters for a `tools/call` request.
*/
const CallToolRequestParamsSchema = TaskAugmentedRequestParamsSchema.extend({
	name: z.string(),
	arguments: z.record(z.string(), z.unknown()).optional()
});
/**
* Used by the client to invoke a tool provided by the server.
*/
const CallToolRequestSchema = RequestSchema.extend({
	method: z.literal("tools/call"),
	params: CallToolRequestParamsSchema
});
/**
* An optional notification from the server to the client, informing it that the list of tools it offers has changed. This may be issued by servers without any previous subscription from the client.
*/
const ToolListChangedNotificationSchema = NotificationSchema.extend({
	method: z.literal("notifications/tools/list_changed"),
	params: NotificationsParamsSchema.optional()
});
/**
* Base schema for list changed subscription options (without callback).
* Used internally for Zod validation of `autoRefresh` and `debounceMs`.
*/
const ListChangedOptionsBaseSchema = z.object({
	autoRefresh: z.boolean().default(true),
	debounceMs: z.number().int().nonnegative().default(300)
});
/**
* The severity of a log message.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to stderr logging
* (STDIO servers) or OpenTelemetry.
*/
const LoggingLevelSchema = z.enum([
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
	method: z.literal("logging/setLevel"),
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
	logger: z.string().optional(),
	data: z.unknown()
});
/**
* Notification of a log message passed from server to client. If no `logging/setLevel` request has been sent from the client, the server MAY decide which messages to send automatically.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to stderr logging
* (STDIO servers) or OpenTelemetry.
*/
const LoggingMessageNotificationSchema = NotificationSchema.extend({
	method: z.literal("notifications/message"),
	params: LoggingMessageNotificationParamsSchema
});
/**
* Hints to use for model selection.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to calling LLM
* provider APIs directly.
*/
const ModelHintSchema = z.object({ name: z.string().optional() });
/**
* The server's preferences for model selection, requested of the client during sampling.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to calling LLM
* provider APIs directly.
*/
const ModelPreferencesSchema = z.object({
	hints: z.array(ModelHintSchema).optional(),
	costPriority: z.number().min(0).max(1).optional(),
	speedPriority: z.number().min(0).max(1).optional(),
	intelligencePriority: z.number().min(0).max(1).optional()
});
/**
* Controls tool usage behavior in sampling requests.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to calling LLM
* provider APIs directly.
*/
const ToolChoiceSchema = z.object({ mode: z.enum([
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
const ToolResultContentSchema = z.object({
	type: z.literal("tool_result"),
	toolUseId: z.string().describe("The unique identifier for the corresponding tool call."),
	content: z.array(ContentBlockSchema),
	structuredContent: z.unknown().optional(),
	isError: z.boolean().optional(),
	_meta: z.record(z.string(), z.unknown()).optional()
});
/**
* Basic content types for sampling responses (without tool use).
* Used for backwards-compatible {@linkcode CreateMessageResult} when tools are not used.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to calling LLM
* provider APIs directly.
*/
const SamplingContentSchema = z.discriminatedUnion("type", [
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
const SamplingMessageContentBlockSchema = z.discriminatedUnion("type", [
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
const SamplingMessageSchema = z.object({
	role: RoleSchema,
	content: z.union([SamplingMessageContentBlockSchema, z.array(SamplingMessageContentBlockSchema)]),
	_meta: z.record(z.string(), z.unknown()).optional()
});
/**
* Parameters for a `sampling/createMessage` request.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to calling LLM
* provider APIs directly.
*/
const CreateMessageRequestParamsSchema = TaskAugmentedRequestParamsSchema.extend({
	messages: z.array(SamplingMessageSchema),
	modelPreferences: ModelPreferencesSchema.optional(),
	systemPrompt: z.string().optional(),
	includeContext: z.enum([
		"none",
		"thisServer",
		"allServers"
	]).optional(),
	temperature: z.number().optional(),
	maxTokens: z.number().int(),
	stopSequences: z.array(z.string()).optional(),
	metadata: JSONObjectSchema.optional(),
	tools: z.array(ToolSchema).optional(),
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
	method: z.literal("sampling/createMessage"),
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
	model: z.string(),
	stopReason: z.optional(z.enum([
		"endTurn",
		"stopSequence",
		"maxTokens"
	]).or(z.string())),
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
	model: z.string(),
	stopReason: z.optional(z.enum([
		"endTurn",
		"stopSequence",
		"maxTokens",
		"toolUse"
	]).or(z.string())),
	role: RoleSchema,
	content: z.union([SamplingMessageContentBlockSchema, z.array(SamplingMessageContentBlockSchema)])
});
/**
* Primitive schema definition for boolean fields.
*/
const BooleanSchemaSchema = z.object({
	type: z.literal("boolean"),
	title: z.string().optional(),
	description: z.string().optional(),
	default: z.boolean().optional()
});
/**
* Primitive schema definition for string fields.
*/
const StringSchemaSchema = z.object({
	type: z.literal("string"),
	title: z.string().optional(),
	description: z.string().optional(),
	minLength: z.number().optional(),
	maxLength: z.number().optional(),
	format: z.enum([
		"email",
		"uri",
		"date",
		"date-time"
	]).optional(),
	default: z.string().optional()
});
/**
* Primitive schema definition for number fields.
*/
const NumberSchemaSchema = z.object({
	type: z.enum(["number", "integer"]),
	title: z.string().optional(),
	description: z.string().optional(),
	minimum: z.number().optional(),
	maximum: z.number().optional(),
	default: z.number().optional()
});
/**
* Schema for single-selection enumeration without display titles for options.
*/
const UntitledSingleSelectEnumSchemaSchema = z.object({
	type: z.literal("string"),
	title: z.string().optional(),
	description: z.string().optional(),
	enum: z.array(z.string()),
	default: z.string().optional()
});
/**
* Schema for single-selection enumeration with display titles for each option.
*/
const TitledSingleSelectEnumSchemaSchema = z.object({
	type: z.literal("string"),
	title: z.string().optional(),
	description: z.string().optional(),
	oneOf: z.array(z.object({
		const: z.string(),
		title: z.string()
	})),
	default: z.string().optional()
});
/**
* Use {@linkcode TitledSingleSelectEnumSchema} instead.
* This interface will be removed in a future version.
*/
const LegacyTitledEnumSchemaSchema = z.object({
	type: z.literal("string"),
	title: z.string().optional(),
	description: z.string().optional(),
	enum: z.array(z.string()),
	enumNames: z.array(z.string()).optional(),
	default: z.string().optional()
});
const SingleSelectEnumSchemaSchema = z.union([UntitledSingleSelectEnumSchemaSchema, TitledSingleSelectEnumSchemaSchema]);
/**
* Schema for multiple-selection enumeration without display titles for options.
*/
const UntitledMultiSelectEnumSchemaSchema = z.object({
	type: z.literal("array"),
	title: z.string().optional(),
	description: z.string().optional(),
	minItems: z.number().optional(),
	maxItems: z.number().optional(),
	items: z.object({
		type: z.literal("string"),
		enum: z.array(z.string())
	}),
	default: z.array(z.string()).optional()
});
/**
* Schema for multiple-selection enumeration with display titles for each option.
*/
const TitledMultiSelectEnumSchemaSchema = z.object({
	type: z.literal("array"),
	title: z.string().optional(),
	description: z.string().optional(),
	minItems: z.number().optional(),
	maxItems: z.number().optional(),
	items: z.object({ anyOf: z.array(z.object({
		const: z.string(),
		title: z.string()
	})) }),
	default: z.array(z.string()).optional()
});
/**
* Combined schema for multiple-selection enumeration
*/
const MultiSelectEnumSchemaSchema = z.union([UntitledMultiSelectEnumSchemaSchema, TitledMultiSelectEnumSchemaSchema]);
/**
* Primitive schema definition for enum fields.
*/
const EnumSchemaSchema = z.union([
	LegacyTitledEnumSchemaSchema,
	SingleSelectEnumSchemaSchema,
	MultiSelectEnumSchemaSchema
]);
/**
* Union of all primitive schema definitions.
*/
const PrimitiveSchemaDefinitionSchema = z.union([
	EnumSchemaSchema,
	BooleanSchemaSchema,
	StringSchemaSchema,
	NumberSchemaSchema
]);
/**
* Parameters for an `elicitation/create` request for form-based elicitation.
*/
const ElicitRequestFormParamsSchema = TaskAugmentedRequestParamsSchema.extend({
	mode: z.literal("form").optional(),
	message: z.string(),
	requestedSchema: z.object({
		type: z.literal("object"),
		properties: z.record(z.string(), PrimitiveSchemaDefinitionSchema),
		required: z.array(z.string()).optional()
	}).catchall(z.unknown())
});
/**
* Parameters for an {@linkcode ElicitRequest | elicitation/create} request for URL-based elicitation.
*/
const ElicitRequestURLParamsSchema = TaskAugmentedRequestParamsSchema.extend({
	mode: z.literal("url"),
	message: z.string(),
	elicitationId: z.string(),
	url: z.string().url()
});
/**
* The parameters for a request to elicit additional information from the user via the client.
*/
const ElicitRequestParamsSchema = z.union([ElicitRequestFormParamsSchema, ElicitRequestURLParamsSchema]);
/**
* A request from the server to elicit user input via the client.
* The client should present the message and form fields to the user (form mode)
* or navigate to a URL (URL mode).
*/
const ElicitRequestSchema = RequestSchema.extend({
	method: z.literal("elicitation/create"),
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
const ElicitationCompleteNotificationParamsSchema = NotificationsParamsSchema.extend({ elicitationId: z.string() });
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
	method: z.literal("notifications/elicitation/complete"),
	params: ElicitationCompleteNotificationParamsSchema
});
/**
* The client's response to an {@linkcode ElicitRequest | elicitation/create} request from the server.
*/
const ElicitResultSchema = ResultSchema.extend({
	action: z.enum([
		"accept",
		"decline",
		"cancel"
	]),
	content: z.preprocess((val) => val === null ? void 0 : val, z.record(z.string(), z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.array(z.string())
	])).optional())
});
/**
* A reference to a resource or resource template definition.
*/
const ResourceTemplateReferenceSchema = z.object({
	type: z.literal("ref/resource"),
	uri: z.string()
});
/**
* Identifies a prompt.
*/
const PromptReferenceSchema = z.object({
	type: z.literal("ref/prompt"),
	name: z.string()
});
/**
* Parameters for a {@linkcode CompleteRequest | completion/complete} request.
*/
const CompleteRequestParamsSchema = BaseRequestParamsSchema.extend({
	ref: z.union([PromptReferenceSchema, ResourceTemplateReferenceSchema]),
	argument: z.object({
		name: z.string(),
		value: z.string()
	}),
	context: z.object({ arguments: z.record(z.string(), z.string()).optional() }).optional()
});
/**
* A request from the client to the server, to ask for completion options.
*/
const CompleteRequestSchema = RequestSchema.extend({
	method: z.literal("completion/complete"),
	params: CompleteRequestParamsSchema
});
/**
* The server's response to a {@linkcode CompleteRequest | completion/complete} request
*/
const CompleteResultSchema = ResultSchema.extend({ completion: z.looseObject({
	values: z.array(z.string()).max(100),
	total: z.optional(z.number().int()),
	hasMore: z.optional(z.boolean())
}) });
/**
* Represents a root directory or file that the server can operate on.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to passing paths via
* tool parameters, resource URIs, or configuration.
*/
const RootSchema = z.object({
	uri: z.string().startsWith("file://"),
	name: z.string().optional(),
	_meta: z.record(z.string(), z.unknown()).optional()
});
/**
* Sent from the server to request a list of root URIs from the client.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to passing paths via
* tool parameters, resource URIs, or configuration.
*/
const ListRootsRequestSchema = RequestSchema.extend({
	method: z.literal("roots/list"),
	params: BaseRequestParamsSchema.optional()
});
/**
* The client's response to a `roots/list` request from the server.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to passing paths via
* tool parameters, resource URIs, or configuration.
*/
const ListRootsResultSchema = ResultSchema.extend({ roots: z.array(RootSchema) });
/**
* A notification from the client to the server, informing it that the list of roots has changed.
*
* @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
* in the specification for at least twelve months. Migrate to passing paths via
* tool parameters, resource URIs, or configuration.
*/
const RootsListChangedNotificationSchema = NotificationSchema.extend({
	method: z.literal("notifications/roots/list_changed"),
	params: NotificationsParamsSchema.optional()
});
/**
* Task creation parameters, used to ask that the server create a task to represent a request.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const TaskCreationParamsSchema = z.looseObject({
	ttl: z.number().optional(),
	pollInterval: z.number().optional()
});
/**
* The status of a task.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const TaskStatusSchema = z.enum([
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
const TaskSchema = z.object({
	taskId: z.string(),
	status: TaskStatusSchema,
	ttl: z.union([z.number(), z.null()]),
	createdAt: z.string(),
	lastUpdatedAt: z.string(),
	pollInterval: z.optional(z.number()),
	statusMessage: z.optional(z.string())
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
	method: z.literal("notifications/tasks/status"),
	params: TaskStatusNotificationParamsSchema
});
/**
* A request to get the state of a specific task.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const GetTaskRequestSchema = RequestSchema.extend({
	method: z.literal("tasks/get"),
	params: BaseRequestParamsSchema.extend({ taskId: z.string() })
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
	method: z.literal("tasks/result"),
	params: BaseRequestParamsSchema.extend({ taskId: z.string() })
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
const ListTasksRequestSchema = PaginatedRequestSchema.extend({ method: z.literal("tasks/list") });
/**
* The response to a {@linkcode ListTasksRequest | tasks/list} request.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const ListTasksResultSchema = PaginatedResultSchema.extend({ tasks: z.array(TaskSchema) });
/**
* A request to cancel a specific task.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const CancelTaskRequestSchema = RequestSchema.extend({
	method: z.literal("tasks/cancel"),
	params: BaseRequestParamsSchema.extend({ taskId: z.string() })
});
/**
* The response to a {@linkcode CancelTaskRequest | tasks/cancel} request.
*
* @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
*/
const CancelTaskResultSchema = ResultSchema.merge(TaskSchema);
const ClientRequestSchema = z.union([
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
const ClientNotificationSchema = z.union([
	CancelledNotificationSchema,
	ProgressNotificationSchema,
	InitializedNotificationSchema,
	RootsListChangedNotificationSchema
]);
const ClientResultSchema = z.union([
	EmptyResultSchema,
	CreateMessageResultSchema,
	CreateMessageResultWithToolsSchema,
	ElicitResultSchema,
	ListRootsResultSchema
]);
const ServerRequestSchema = z.union([
	PingRequestSchema,
	CreateMessageRequestSchema,
	ElicitRequestSchema,
	ListRootsRequestSchema
]);
const ServerNotificationSchema = z.union([
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
const ServerResultSchema = z.union([
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
export { InitializeRequestParamsSchema as $, ToolSchema as $n, RequestIdSchema as $t, DiscoverRequestSchema as A, SubscriptionFilterSchema as An, ModelPreferencesSchema as At, EmptyResultSchema as B, TaskSchema as Bn, ProgressNotificationParamsSchema as Bt, ContentBlockSchema as C, ServerTasksCapabilitySchema as Cn, TRACESTATE_META_KEY as Cr, ListTasksResultSchema as Ct, CreateMessageResultWithToolsSchema as D, StringSchemaSchema as Dn, LoggingMessageNotificationParamsSchema as Dt, CreateMessageResultSchema as E, SingleSelectEnumSchemaSchema as En, LoggingLevelSchema as Et, ElicitRequestURLParamsSchema as F, SubscriptionsListenResultMetaSchema as Fn, PaginatedRequestParamsSchema as Ft, GetTaskPayloadRequestSchema as G, TextResourceContentsSchema as Gn, PromptListChangedNotificationSchema as Gt, GetPromptRequestParamsSchema as H, TaskStatusNotificationSchema as Hn, ProgressSchema as Ht, ElicitResultSchema as I, SubscriptionsListenResultSchema as In, PaginatedRequestSchema as It, GetTaskResultSchema as J, ToolAnnotationsSchema as Jn, PromptSchema as Jt, GetTaskPayloadResultSchema as K, TitledMultiSelectEnumSchemaSchema as Kn, PromptMessageSchema as Kt, ElicitationCompleteNotificationParamsSchema as L, TaskAugmentedRequestParamsSchema as Ln, PaginatedResultSchema as Lt, ElicitRequestFormParamsSchema as M, SubscriptionsAcknowledgedNotificationSchema as Mn, NotificationSchema as Mt, ElicitRequestParamsSchema as N, SubscriptionsListenRequestParamsSchema as Nn, NotificationsParamsSchema as Nt, CreateTaskResultSchema as O, SubscribeRequestParamsSchema as On, LoggingMessageNotificationSchema as Ot, ElicitRequestSchema as P, SubscriptionsListenRequestSchema as Pn, NumberSchemaSchema as Pt, ImplementationSchema as Q, ToolResultContentSchema as Qn, RelatedTaskMetadataSchema as Qt, ElicitationCompleteNotificationSchema as R, TaskCreationParamsSchema as Rn, PingRequestSchema as Rt, CompleteResultSchema as S, ServerResultSchema as Sn, TRACEPARENT_META_KEY as Sr, ListTasksRequestSchema as St, CreateMessageRequestSchema as T, SetLevelRequestSchema as Tn, ListToolsResultSchema as Tt, GetPromptRequestSchema as U, TaskStatusSchema as Un, ProgressTokenSchema as Ut, EnumSchemaSchema as V, TaskStatusNotificationParamsSchema as Vn, ProgressNotificationSchema as Vt, GetPromptResultSchema as W, TextContentSchema as Wn, PromptArgumentSchema as Wt, IconsSchema as X, ToolExecutionSchema as Xn, ReadResourceRequestSchema as Xt, IconSchema as Y, ToolChoiceSchema as Yn, ReadResourceRequestParamsSchema as Yt, ImageContentSchema as Z, ToolListChangedNotificationSchema as Zn, ReadResourceResultSchema as Zt, ClientResultSchema as _, SamplingMessageContentBlockSchema as _n, PROTOCOL_VERSION_META_KEY as _r, ListResourceTemplatesResultSchema as _t, BlobResourceContentsSchema as a, ResourceRequestParamsSchema as an, BAGGAGE_META_KEY as ar, JSONRPCErrorResponseSchema as at, CompleteRequestParamsSchema as b, ServerNotificationSchema as bn, SUBSCRIPTION_ID_META_KEY as br, ListRootsRequestSchema as bt, CallToolRequestSchema as c, ResourceTemplateSchema as cn, DEFAULT_NEGOTIATED_PROTOCOL_VERSION as cr, JSONRPCRequestSchema as ct, CancelTaskResultSchema as d, ResultMetaObjectSchema as dn, INVALID_REQUEST as dr, JSONValueSchema as dt, RequestMetaSchema as en, ToolUseContentSchema as er, InitializeRequestSchema as et, CancelledNotificationParamsSchema as f, ResultSchema as fn, JSONRPC_VERSION as fr, LegacyTitledEnumSchemaSchema as ft, ClientRequestSchema as g, SamplingContentSchema as gn, PARSE_ERROR as gr, ListResourceTemplatesRequestSchema as gt, ClientNotificationSchema as h, RootsListChangedNotificationSchema as hn, METHOD_NOT_FOUND as hr, ListPromptsResultSchema as ht, BaseRequestParamsSchema as i, ResourceListChangedNotificationSchema as in, UntitledSingleSelectEnumSchemaSchema as ir, JSONObjectSchema as it, DiscoverResultSchema as j, SubscriptionsAcknowledgedNotificationParamsSchema as jn, MultiSelectEnumSchemaSchema as jt, CursorSchema as k, SubscribeRequestSchema as kn, ModelHintSchema as kt, CallToolResultSchema as l, ResourceUpdatedNotificationParamsSchema as ln, INTERNAL_ERROR as lr, JSONRPCResponseSchema as lt, ClientCapabilitiesSchema as m, RootSchema as mn, LOG_LEVEL_META_KEY as mr, ListPromptsRequestSchema as mt, AudioContentSchema as n, ResourceContentsSchema as nn, UnsubscribeRequestSchema as nr, InitializedNotificationSchema as nt, BooleanSchemaSchema as o, ResourceSchema as on, CLIENT_CAPABILITIES_META_KEY as or, JSONRPCMessageSchema as ot, CancelledNotificationSchema as p, RoleSchema as pn, LATEST_PROTOCOL_VERSION as pr, ListChangedOptionsBaseSchema as pt, GetTaskRequestSchema as q, TitledSingleSelectEnumSchemaSchema as qn, PromptReferenceSchema as qt, BaseMetadataSchema as r, ResourceLinkSchema as rn, UntitledMultiSelectEnumSchemaSchema as rr, JSONArraySchema as rt, CallToolRequestParamsSchema as s, ResourceTemplateReferenceSchema as sn, CLIENT_INFO_META_KEY as sr, JSONRPCNotificationSchema as st, AnnotationsSchema as t, RequestSchema as tn, UnsubscribeRequestParamsSchema as tr, InitializeResultSchema as tt, CancelTaskRequestSchema as u, ResourceUpdatedNotificationSchema as un, INVALID_PARAMS as ur, JSONRPCResultResponseSchema as ut, ClientTasksCapabilitySchema as v, SamplingMessageSchema as vn, RELATED_TASK_META_KEY as vr, ListResourcesRequestSchema as vt, CreateMessageRequestParamsSchema as w, SetLevelRequestParamsSchema as wn, ListToolsRequestSchema as wt, CompleteRequestSchema as x, ServerRequestSchema as xn, SUPPORTED_PROTOCOL_VERSIONS as xr, ListRootsResultSchema as xt, CompatibilityCallToolResultSchema as y, ServerCapabilitiesSchema as yn, SERVER_INFO_META_KEY as yr, ListResourcesResultSchema as yt, EmbeddedResourceSchema as z, TaskMetadataSchema as zn, PrimitiveSchemaDefinitionSchema as zt };
//# sourceMappingURL=schemas-DscsoNZN.mjs.map