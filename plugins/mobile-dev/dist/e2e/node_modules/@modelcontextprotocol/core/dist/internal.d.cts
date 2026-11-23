import { $ as InitializeRequestParamsSchema, $n as ToolSchema, $t as RequestIdSchema, A as DiscoverRequestSchema, An as SubscriptionFilterSchema, At as ModelPreferencesSchema, B as EmptyResultSchema, Bn as TaskSchema, Bt as ProgressNotificationParamsSchema, C as ContentBlockSchema, Cn as ServerTasksCapabilitySchema, Ct as ListTasksResultSchema, D as CreateMessageResultWithToolsSchema, Dn as StringSchemaSchema, Dt as LoggingMessageNotificationParamsSchema, E as CreateMessageResultSchema, En as SingleSelectEnumSchemaSchema, Et as LoggingLevelSchema, F as ElicitRequestURLParamsSchema, Fn as SubscriptionsListenResultMetaSchema, Ft as PaginatedRequestParamsSchema, G as GetTaskPayloadRequestSchema, Gn as TextResourceContentsSchema, Gt as PromptListChangedNotificationSchema, H as GetPromptRequestParamsSchema, Hn as TaskStatusNotificationSchema, Ht as ProgressSchema, I as ElicitResultSchema, In as SubscriptionsListenResultSchema, It as PaginatedRequestSchema, J as GetTaskResultSchema, Jn as ToolAnnotationsSchema, Jt as PromptSchema, K as GetTaskPayloadResultSchema, Kn as TitledMultiSelectEnumSchemaSchema, Kt as PromptMessageSchema, L as ElicitationCompleteNotificationParamsSchema, Ln as TaskAugmentedRequestParamsSchema, Lt as PaginatedResultSchema, M as ElicitRequestFormParamsSchema, Mn as SubscriptionsAcknowledgedNotificationSchema, Mt as NotificationSchema, N as ElicitRequestParamsSchema, Nn as SubscriptionsListenRequestParamsSchema, Nt as NotificationsParamsSchema, O as CreateTaskResultSchema, On as SubscribeRequestParamsSchema, Ot as LoggingMessageNotificationSchema, P as ElicitRequestSchema, Pn as SubscriptionsListenRequestSchema, Pt as NumberSchemaSchema, Q as ImplementationSchema, Qn as ToolResultContentSchema, Qt as RelatedTaskMetadataSchema, R as ElicitationCompleteNotificationSchema, Rn as TaskCreationParamsSchema, Rt as PingRequestSchema, S as CompleteResultSchema, Sn as ServerResultSchema, St as ListTasksRequestSchema, T as CreateMessageRequestSchema, Tn as SetLevelRequestSchema, Tt as ListToolsResultSchema, U as GetPromptRequestSchema, Un as TaskStatusSchema, Ut as ProgressTokenSchema, V as EnumSchemaSchema, Vn as TaskStatusNotificationParamsSchema, Vt as ProgressNotificationSchema, W as GetPromptResultSchema, Wn as TextContentSchema, Wt as PromptArgumentSchema, X as IconsSchema, Xn as ToolExecutionSchema, Xt as ReadResourceRequestSchema, Y as IconSchema, Yn as ToolChoiceSchema, Yt as ReadResourceRequestParamsSchema, Z as ImageContentSchema, Zn as ToolListChangedNotificationSchema, Zt as ReadResourceResultSchema, _ as ClientResultSchema, _n as SamplingMessageContentBlockSchema, _t as ListResourceTemplatesResultSchema, a as BlobResourceContentsSchema, an as ResourceRequestParamsSchema, ar as JSONArray, at as JSONRPCErrorResponseSchema, b as CompleteRequestParamsSchema, bn as ServerNotificationSchema, bt as ListRootsRequestSchema, c as CallToolRequestSchema, cn as ResourceTemplateSchema, ct as JSONRPCRequestSchema, d as CancelTaskResultSchema, dn as ResultMetaObjectSchema, dt as JSONValueSchema, en as RequestMetaSchema, er as ToolUseContentSchema, et as InitializeRequestSchema, f as CancelledNotificationParamsSchema, fn as ResultSchema, ft as LegacyTitledEnumSchemaSchema, g as ClientRequestSchema, gn as SamplingContentSchema, gt as ListResourceTemplatesRequestSchema, h as ClientNotificationSchema, hn as RootsListChangedNotificationSchema, ht as ListPromptsResultSchema, i as BaseRequestParamsSchema, in as ResourceListChangedNotificationSchema, ir as UntitledSingleSelectEnumSchemaSchema, it as JSONObjectSchema, j as DiscoverResultSchema, jn as SubscriptionsAcknowledgedNotificationParamsSchema, jt as MultiSelectEnumSchemaSchema, k as CursorSchema, kn as SubscribeRequestSchema, kt as ModelHintSchema, l as CallToolResultSchema, ln as ResourceUpdatedNotificationParamsSchema, lt as JSONRPCResponseSchema, m as ClientCapabilitiesSchema, mn as RootSchema, mt as ListPromptsRequestSchema, n as AudioContentSchema, nn as ResourceContentsSchema, nr as UnsubscribeRequestSchema, nt as InitializedNotificationSchema, o as BooleanSchemaSchema, on as ResourceSchema, or as JSONObject, ot as JSONRPCMessageSchema, p as CancelledNotificationSchema, pn as RoleSchema, pt as ListChangedOptionsBaseSchema, q as GetTaskRequestSchema, qn as TitledSingleSelectEnumSchemaSchema, qt as PromptReferenceSchema, r as BaseMetadataSchema, rn as ResourceLinkSchema, rr as UntitledMultiSelectEnumSchemaSchema, rt as JSONArraySchema, s as CallToolRequestParamsSchema, sn as ResourceTemplateReferenceSchema, sr as JSONValue, st as JSONRPCNotificationSchema, t as AnnotationsSchema, tn as RequestSchema, tr as UnsubscribeRequestParamsSchema, tt as InitializeResultSchema, u as CancelTaskRequestSchema, un as ResourceUpdatedNotificationSchema, ut as JSONRPCResultResponseSchema, v as ClientTasksCapabilitySchema, vn as SamplingMessageSchema, vt as ListResourcesRequestSchema, w as CreateMessageRequestParamsSchema, wn as SetLevelRequestParamsSchema, wt as ListToolsRequestSchema, x as CompleteRequestSchema, xn as ServerRequestSchema, xt as ListRootsResultSchema, y as CompatibilityCallToolResultSchema, yn as ServerCapabilitiesSchema, yt as ListResourcesResultSchema, z as EmbeddedResourceSchema, zn as TaskMetadataSchema, zt as PrimitiveSchemaDefinitionSchema } from "./schemas-CzwpZ9-S.cjs";
import { A as StoredOAuthTokens, C as OpenIdProviderDiscoveryMetadata, D as OptionalSafeUrlSchema, E as OpenIdProviderMetadataSchema, O as SafeUrlSchema, S as OAuthTokensSchema, T as OpenIdProviderMetadata, _ as OAuthProtectedResourceMetadata, a as OAuthClientInformationFull, b as OAuthTokenRevocationRequestSchema, c as OAuthClientInformationSchema, d as OAuthClientRegistrationError, f as OAuthClientRegistrationErrorSchema, g as OAuthMetadataSchema, h as OAuthMetadata, i as OAuthClientInformation, k as StoredOAuthClientInformation, l as OAuthClientMetadata, m as OAuthErrorResponseSchema, n as IdJagTokenExchangeResponse, o as OAuthClientInformationFullSchema, p as OAuthErrorResponse, r as IdJagTokenExchangeResponseSchema, s as OAuthClientInformationMixed, t as AuthorizationServerMetadata, u as OAuthClientMetadataSchema, v as OAuthProtectedResourceMetadataSchema, w as OpenIdProviderDiscoveryMetadataSchema, x as OAuthTokens, y as OAuthTokenRevocationRequest } from "./auth-CmOFayUJ.cjs";

//#region src/constants.d.ts
declare const LATEST_PROTOCOL_VERSION = "2025-11-25";
declare const DEFAULT_NEGOTIATED_PROTOCOL_VERSION = "2025-03-26";
declare const SUPPORTED_PROTOCOL_VERSIONS: string[];
/**
 * `_meta` key associating a message with a 2025-11-25 task.
 *
 * @deprecated 2025-11-25 wire vocabulary with no SDK runtime; kept importable for interoperability only.
 */
declare const RELATED_TASK_META_KEY = "io.modelcontextprotocol/related-task";
/**
 * `_meta` key carrying the MCP protocol version governing a request.
 *
 * For the HTTP transport, the value must match the `MCP-Protocol-Version` header.
 */
declare const PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion";
/**
 * `_meta` key identifying the client software making a request.
 *
 * Clients SHOULD include it on every request; the value is self-reported and
 * intended for display, logging, and debugging — servers should not rely on
 * it for behavior or security decisions.
 */
declare const CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo";
/**
 * `_meta` key identifying the server software producing a response.
 *
 * Servers SHOULD include it on every response; the value is self-reported and
 * intended for display, logging, and debugging — clients should not rely on
 * it for behavior or security decisions.
 */
declare const SERVER_INFO_META_KEY = "io.modelcontextprotocol/serverInfo";
/**
 * `_meta` key carrying the client's capabilities for a request.
 *
 * Capabilities are declared per request rather than once at initialization;
 * servers must not infer capabilities from prior requests.
 */
declare const CLIENT_CAPABILITIES_META_KEY = "io.modelcontextprotocol/clientCapabilities";
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
declare const SUBSCRIPTION_ID_META_KEY = "io.modelcontextprotocol/subscriptionId";
/**
 * `_meta` key carrying the desired log level for a request.
 *
 * When absent, the server must not send `notifications/message` notifications
 * for the request.
 *
 * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577); remains
 * in the specification for at least twelve months.
 */
declare const LOG_LEVEL_META_KEY = "io.modelcontextprotocol/logLevel";
/**
 * `_meta` key carrying W3C Trace Context for distributed tracing (SEP-414).
 *
 * When present, the value MUST follow the W3C `traceparent` header format,
 * e.g. `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`.
 *
 * @see https://www.w3.org/TR/trace-context/#traceparent-header
 */
declare const TRACEPARENT_META_KEY = "traceparent";
/**
 * `_meta` key carrying vendor-specific trace state for distributed tracing (SEP-414).
 *
 * When present, the value MUST follow the W3C `tracestate` header format,
 * e.g. `vendor1=value1,vendor2=value2`.
 *
 * @see https://www.w3.org/TR/trace-context/#tracestate-header
 */
declare const TRACESTATE_META_KEY = "tracestate";
/**
 * `_meta` key carrying cross-cutting propagation values for distributed tracing (SEP-414).
 *
 * When present, the value MUST follow the W3C Baggage header format,
 * e.g. `userId=alice,serverRegion=us-east-1`.
 *
 * @see https://www.w3.org/TR/baggage/
 */
declare const BAGGAGE_META_KEY = "baggage";
declare const JSONRPC_VERSION = "2.0";
declare const PARSE_ERROR = -32700;
declare const INVALID_REQUEST = -32600;
declare const METHOD_NOT_FOUND = -32601;
declare const INVALID_PARAMS = -32602;
declare const INTERNAL_ERROR = -32603;
//#endregion
export { AnnotationsSchema, AudioContentSchema, AuthorizationServerMetadata, BAGGAGE_META_KEY, BaseMetadataSchema, BaseRequestParamsSchema, BlobResourceContentsSchema, BooleanSchemaSchema, CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY, CallToolRequestParamsSchema, CallToolRequestSchema, CallToolResultSchema, CancelTaskRequestSchema, CancelTaskResultSchema, CancelledNotificationParamsSchema, CancelledNotificationSchema, ClientCapabilitiesSchema, ClientNotificationSchema, ClientRequestSchema, ClientResultSchema, ClientTasksCapabilitySchema, CompatibilityCallToolResultSchema, CompleteRequestParamsSchema, CompleteRequestSchema, CompleteResultSchema, ContentBlockSchema, CreateMessageRequestParamsSchema, CreateMessageRequestSchema, CreateMessageResultSchema, CreateMessageResultWithToolsSchema, CreateTaskResultSchema, CursorSchema, DEFAULT_NEGOTIATED_PROTOCOL_VERSION, DiscoverRequestSchema, DiscoverResultSchema, ElicitRequestFormParamsSchema, ElicitRequestParamsSchema, ElicitRequestSchema, ElicitRequestURLParamsSchema, ElicitResultSchema, ElicitationCompleteNotificationParamsSchema, ElicitationCompleteNotificationSchema, EmbeddedResourceSchema, EmptyResultSchema, EnumSchemaSchema, GetPromptRequestParamsSchema, GetPromptRequestSchema, GetPromptResultSchema, GetTaskPayloadRequestSchema, GetTaskPayloadResultSchema, GetTaskRequestSchema, GetTaskResultSchema, INTERNAL_ERROR, INVALID_PARAMS, INVALID_REQUEST, IconSchema, IconsSchema, IdJagTokenExchangeResponse, IdJagTokenExchangeResponseSchema, ImageContentSchema, ImplementationSchema, InitializeRequestParamsSchema, InitializeRequestSchema, InitializeResultSchema, InitializedNotificationSchema, type JSONArray, JSONArraySchema, type JSONObject, JSONObjectSchema, JSONRPCErrorResponseSchema, JSONRPCMessageSchema, JSONRPCNotificationSchema, JSONRPCRequestSchema, JSONRPCResponseSchema, JSONRPCResultResponseSchema, JSONRPC_VERSION, type JSONValue, JSONValueSchema, LATEST_PROTOCOL_VERSION, LOG_LEVEL_META_KEY, LegacyTitledEnumSchemaSchema, ListChangedOptionsBaseSchema, ListPromptsRequestSchema, ListPromptsResultSchema, ListResourceTemplatesRequestSchema, ListResourceTemplatesResultSchema, ListResourcesRequestSchema, ListResourcesResultSchema, ListRootsRequestSchema, ListRootsResultSchema, ListTasksRequestSchema, ListTasksResultSchema, ListToolsRequestSchema, ListToolsResultSchema, LoggingLevelSchema, LoggingMessageNotificationParamsSchema, LoggingMessageNotificationSchema, METHOD_NOT_FOUND, ModelHintSchema, ModelPreferencesSchema, MultiSelectEnumSchemaSchema, NotificationSchema, NotificationsParamsSchema, NumberSchemaSchema, OAuthClientInformation, OAuthClientInformationFull, OAuthClientInformationFullSchema, OAuthClientInformationMixed, OAuthClientInformationSchema, OAuthClientMetadata, OAuthClientMetadataSchema, OAuthClientRegistrationError, OAuthClientRegistrationErrorSchema, OAuthErrorResponse, OAuthErrorResponseSchema, OAuthMetadata, OAuthMetadataSchema, OAuthProtectedResourceMetadata, OAuthProtectedResourceMetadataSchema, OAuthTokenRevocationRequest, OAuthTokenRevocationRequestSchema, OAuthTokens, OAuthTokensSchema, OpenIdProviderDiscoveryMetadata, OpenIdProviderDiscoveryMetadataSchema, OpenIdProviderMetadata, OpenIdProviderMetadataSchema, OptionalSafeUrlSchema, PARSE_ERROR, PROTOCOL_VERSION_META_KEY, PaginatedRequestParamsSchema, PaginatedRequestSchema, PaginatedResultSchema, PingRequestSchema, PrimitiveSchemaDefinitionSchema, ProgressNotificationParamsSchema, ProgressNotificationSchema, ProgressSchema, ProgressTokenSchema, PromptArgumentSchema, PromptListChangedNotificationSchema, PromptMessageSchema, PromptReferenceSchema, PromptSchema, RELATED_TASK_META_KEY, ReadResourceRequestParamsSchema, ReadResourceRequestSchema, ReadResourceResultSchema, RelatedTaskMetadataSchema, RequestIdSchema, RequestMetaSchema, RequestSchema, ResourceContentsSchema, ResourceLinkSchema, ResourceListChangedNotificationSchema, ResourceRequestParamsSchema, ResourceSchema, ResourceTemplateReferenceSchema, ResourceTemplateSchema, ResourceUpdatedNotificationParamsSchema, ResourceUpdatedNotificationSchema, ResultMetaObjectSchema, ResultSchema, RoleSchema, RootSchema, RootsListChangedNotificationSchema, SERVER_INFO_META_KEY, SUBSCRIPTION_ID_META_KEY, SUPPORTED_PROTOCOL_VERSIONS, SafeUrlSchema, SamplingContentSchema, SamplingMessageContentBlockSchema, SamplingMessageSchema, ServerCapabilitiesSchema, ServerNotificationSchema, ServerRequestSchema, ServerResultSchema, ServerTasksCapabilitySchema, SetLevelRequestParamsSchema, SetLevelRequestSchema, SingleSelectEnumSchemaSchema, StoredOAuthClientInformation, StoredOAuthTokens, StringSchemaSchema, SubscribeRequestParamsSchema, SubscribeRequestSchema, SubscriptionFilterSchema, SubscriptionsAcknowledgedNotificationParamsSchema, SubscriptionsAcknowledgedNotificationSchema, SubscriptionsListenRequestParamsSchema, SubscriptionsListenRequestSchema, SubscriptionsListenResultMetaSchema, SubscriptionsListenResultSchema, TRACEPARENT_META_KEY, TRACESTATE_META_KEY, TaskAugmentedRequestParamsSchema, TaskCreationParamsSchema, TaskMetadataSchema, TaskSchema, TaskStatusNotificationParamsSchema, TaskStatusNotificationSchema, TaskStatusSchema, TextContentSchema, TextResourceContentsSchema, TitledMultiSelectEnumSchemaSchema, TitledSingleSelectEnumSchemaSchema, ToolAnnotationsSchema, ToolChoiceSchema, ToolExecutionSchema, ToolListChangedNotificationSchema, ToolResultContentSchema, ToolSchema, ToolUseContentSchema, UnsubscribeRequestParamsSchema, UnsubscribeRequestSchema, UntitledMultiSelectEnumSchemaSchema, UntitledSingleSelectEnumSchemaSchema };
//# sourceMappingURL=internal.d.cts.map