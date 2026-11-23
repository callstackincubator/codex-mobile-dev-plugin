const require_schemas = require('./schemas-lGLjBX8n.cjs');
let zod_v4 = require("zod/v4");
zod_v4 = require_schemas.__toESM(zod_v4);

//#region src/auth.ts
/**
* Reusable URL validation that disallows `javascript:` scheme
*/
const SafeUrlSchema = zod_v4.url().superRefine((val, ctx) => {
	if (!URL.canParse(val)) {
		ctx.addIssue({
			code: zod_v4.ZodIssueCode.custom,
			message: "URL must be parseable",
			fatal: true
		});
		return zod_v4.NEVER;
	}
}).refine((url) => {
	const u = new URL(url);
	return u.protocol !== "javascript:" && u.protocol !== "data:" && u.protocol !== "vbscript:";
}, { message: "URL cannot use javascript:, data:, or vbscript: scheme" });
/**
* RFC 9728 OAuth Protected Resource Metadata
*/
const OAuthProtectedResourceMetadataSchema = zod_v4.looseObject({
	resource: zod_v4.string().url(),
	authorization_servers: zod_v4.array(SafeUrlSchema).optional(),
	jwks_uri: zod_v4.string().url().optional(),
	scopes_supported: zod_v4.array(zod_v4.string()).optional(),
	bearer_methods_supported: zod_v4.array(zod_v4.string()).optional(),
	resource_signing_alg_values_supported: zod_v4.array(zod_v4.string()).optional(),
	resource_name: zod_v4.string().optional(),
	resource_documentation: zod_v4.string().optional(),
	resource_policy_uri: zod_v4.string().url().optional(),
	resource_tos_uri: zod_v4.string().url().optional(),
	tls_client_certificate_bound_access_tokens: zod_v4.boolean().optional(),
	authorization_details_types_supported: zod_v4.array(zod_v4.string()).optional(),
	dpop_signing_alg_values_supported: zod_v4.array(zod_v4.string()).optional(),
	dpop_bound_access_tokens_required: zod_v4.boolean().optional()
});
/**
* RFC 8414 OAuth 2.0 Authorization Server Metadata
*/
const OAuthMetadataSchema = zod_v4.looseObject({
	issuer: zod_v4.string(),
	authorization_endpoint: SafeUrlSchema,
	token_endpoint: SafeUrlSchema,
	registration_endpoint: SafeUrlSchema.optional(),
	scopes_supported: zod_v4.array(zod_v4.string()).optional(),
	response_types_supported: zod_v4.array(zod_v4.string()),
	response_modes_supported: zod_v4.array(zod_v4.string()).optional(),
	grant_types_supported: zod_v4.array(zod_v4.string()).optional(),
	token_endpoint_auth_methods_supported: zod_v4.array(zod_v4.string()).optional(),
	token_endpoint_auth_signing_alg_values_supported: zod_v4.array(zod_v4.string()).optional(),
	service_documentation: SafeUrlSchema.optional(),
	revocation_endpoint: SafeUrlSchema.optional(),
	revocation_endpoint_auth_methods_supported: zod_v4.array(zod_v4.string()).optional(),
	revocation_endpoint_auth_signing_alg_values_supported: zod_v4.array(zod_v4.string()).optional(),
	introspection_endpoint: zod_v4.string().optional(),
	introspection_endpoint_auth_methods_supported: zod_v4.array(zod_v4.string()).optional(),
	introspection_endpoint_auth_signing_alg_values_supported: zod_v4.array(zod_v4.string()).optional(),
	code_challenge_methods_supported: zod_v4.array(zod_v4.string()).optional(),
	client_id_metadata_document_supported: zod_v4.boolean().optional(),
	authorization_response_iss_parameter_supported: zod_v4.boolean().optional().catch(void 0),
	dpop_signing_alg_values_supported: zod_v4.array(zod_v4.string()).optional()
});
/**
* OpenID Connect Discovery 1.0 Provider Metadata
*
* @see https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderMetadata
*/
const OpenIdProviderMetadataSchema = zod_v4.looseObject({
	issuer: zod_v4.string(),
	authorization_endpoint: SafeUrlSchema,
	token_endpoint: SafeUrlSchema,
	userinfo_endpoint: SafeUrlSchema.optional(),
	jwks_uri: SafeUrlSchema,
	registration_endpoint: SafeUrlSchema.optional(),
	scopes_supported: zod_v4.array(zod_v4.string()).optional(),
	response_types_supported: zod_v4.array(zod_v4.string()),
	response_modes_supported: zod_v4.array(zod_v4.string()).optional(),
	grant_types_supported: zod_v4.array(zod_v4.string()).optional(),
	acr_values_supported: zod_v4.array(zod_v4.string()).optional(),
	subject_types_supported: zod_v4.array(zod_v4.string()),
	id_token_signing_alg_values_supported: zod_v4.array(zod_v4.string()),
	id_token_encryption_alg_values_supported: zod_v4.array(zod_v4.string()).optional(),
	id_token_encryption_enc_values_supported: zod_v4.array(zod_v4.string()).optional(),
	userinfo_signing_alg_values_supported: zod_v4.array(zod_v4.string()).optional(),
	userinfo_encryption_alg_values_supported: zod_v4.array(zod_v4.string()).optional(),
	userinfo_encryption_enc_values_supported: zod_v4.array(zod_v4.string()).optional(),
	request_object_signing_alg_values_supported: zod_v4.array(zod_v4.string()).optional(),
	request_object_encryption_alg_values_supported: zod_v4.array(zod_v4.string()).optional(),
	request_object_encryption_enc_values_supported: zod_v4.array(zod_v4.string()).optional(),
	token_endpoint_auth_methods_supported: zod_v4.array(zod_v4.string()).optional(),
	token_endpoint_auth_signing_alg_values_supported: zod_v4.array(zod_v4.string()).optional(),
	display_values_supported: zod_v4.array(zod_v4.string()).optional(),
	claim_types_supported: zod_v4.array(zod_v4.string()).optional(),
	claims_supported: zod_v4.array(zod_v4.string()).optional(),
	service_documentation: zod_v4.string().optional(),
	claims_locales_supported: zod_v4.array(zod_v4.string()).optional(),
	ui_locales_supported: zod_v4.array(zod_v4.string()).optional(),
	claims_parameter_supported: zod_v4.boolean().optional(),
	request_parameter_supported: zod_v4.boolean().optional(),
	request_uri_parameter_supported: zod_v4.boolean().optional(),
	require_request_uri_registration: zod_v4.boolean().optional(),
	op_policy_uri: SafeUrlSchema.optional(),
	op_tos_uri: SafeUrlSchema.optional(),
	client_id_metadata_document_supported: zod_v4.boolean().optional(),
	authorization_response_iss_parameter_supported: zod_v4.boolean().optional().catch(void 0)
});
/**
* OpenID Connect Discovery metadata that may include OAuth 2.0 fields
* This schema represents the real-world scenario where OIDC providers
* return a mix of OpenID Connect and OAuth 2.0 metadata fields
*/
const OpenIdProviderDiscoveryMetadataSchema = zod_v4.object({
	...OpenIdProviderMetadataSchema.shape,
	...OAuthMetadataSchema.pick({ code_challenge_methods_supported: true }).shape
});
/**
* OAuth 2.1 token response
*/
const OAuthTokensSchema = zod_v4.object({
	access_token: zod_v4.string(),
	id_token: zod_v4.string().optional(),
	token_type: zod_v4.string(),
	expires_in: zod_v4.coerce.number().optional(),
	scope: zod_v4.string().optional(),
	refresh_token: zod_v4.string().optional(),
	issuer: zod_v4.string().optional().catch(void 0)
}).strip();
/**
* RFC 8693 §2.2.1 Token Exchange response for ID-JAG tokens.
*
* `token_type` is intentionally optional: per RFC 8693 §2.2.1 it is informational when
* the issued token is not an access token, and per RFC 6749 §5.1 it is case-insensitive,
* so strict checking rejects conformant IdPs.
*/
const IdJagTokenExchangeResponseSchema = zod_v4.object({
	issued_token_type: zod_v4.literal("urn:ietf:params:oauth:token-type:id-jag"),
	access_token: zod_v4.string(),
	token_type: zod_v4.string().optional(),
	expires_in: zod_v4.number().optional(),
	scope: zod_v4.string().optional()
}).strip();
/**
* OAuth 2.1 error response
*/
const OAuthErrorResponseSchema = zod_v4.object({
	error: zod_v4.string(),
	error_description: zod_v4.string().optional(),
	error_uri: zod_v4.string().optional()
});
/**
* Optional version of {@linkcode SafeUrlSchema} that allows empty string for backward compatibility on `tos_uri` and `logo_uri`
*/
const OptionalSafeUrlSchema = SafeUrlSchema.optional().or(zod_v4.literal("").transform(() => void 0));
/**
* RFC 7591 OAuth 2.0 Dynamic Client Registration metadata
*/
const OAuthClientMetadataSchema = zod_v4.object({
	redirect_uris: zod_v4.array(SafeUrlSchema),
	token_endpoint_auth_method: zod_v4.string().optional(),
	grant_types: zod_v4.array(zod_v4.string()).optional(),
	response_types: zod_v4.array(zod_v4.string()).optional(),
	application_type: zod_v4.string().optional(),
	client_name: zod_v4.string().optional(),
	client_uri: SafeUrlSchema.optional(),
	logo_uri: OptionalSafeUrlSchema,
	scope: zod_v4.string().optional(),
	contacts: zod_v4.array(zod_v4.string()).optional(),
	tos_uri: OptionalSafeUrlSchema,
	policy_uri: zod_v4.string().optional(),
	jwks_uri: SafeUrlSchema.optional(),
	jwks: zod_v4.any().optional(),
	software_id: zod_v4.string().optional(),
	software_version: zod_v4.string().optional(),
	software_statement: zod_v4.string().optional()
}).strip();
/**
* RFC 7591 OAuth 2.0 Dynamic Client Registration client information
*/
const OAuthClientInformationSchema = zod_v4.object({
	client_id: zod_v4.string(),
	client_secret: zod_v4.string().optional(),
	client_id_issued_at: zod_v4.number().optional(),
	client_secret_expires_at: zod_v4.number().optional(),
	issuer: zod_v4.string().optional().catch(void 0)
}).strip();
/**
* RFC 7591 OAuth 2.0 Dynamic Client Registration full response (client information plus metadata)
*/
const OAuthClientInformationFullSchema = OAuthClientMetadataSchema.merge(OAuthClientInformationSchema);
/**
* RFC 7591 OAuth 2.0 Dynamic Client Registration error response
*/
const OAuthClientRegistrationErrorSchema = zod_v4.object({
	error: zod_v4.string(),
	error_description: zod_v4.string().optional()
}).strip();
/**
* RFC 7009 OAuth 2.0 Token Revocation request
*/
const OAuthTokenRevocationRequestSchema = zod_v4.object({
	token: zod_v4.string(),
	token_type_hint: zod_v4.string().optional()
}).strip();

//#endregion
Object.defineProperty(exports, 'IdJagTokenExchangeResponseSchema', {
  enumerable: true,
  get: function () {
    return IdJagTokenExchangeResponseSchema;
  }
});
Object.defineProperty(exports, 'OAuthClientInformationFullSchema', {
  enumerable: true,
  get: function () {
    return OAuthClientInformationFullSchema;
  }
});
Object.defineProperty(exports, 'OAuthClientInformationSchema', {
  enumerable: true,
  get: function () {
    return OAuthClientInformationSchema;
  }
});
Object.defineProperty(exports, 'OAuthClientMetadataSchema', {
  enumerable: true,
  get: function () {
    return OAuthClientMetadataSchema;
  }
});
Object.defineProperty(exports, 'OAuthClientRegistrationErrorSchema', {
  enumerable: true,
  get: function () {
    return OAuthClientRegistrationErrorSchema;
  }
});
Object.defineProperty(exports, 'OAuthErrorResponseSchema', {
  enumerable: true,
  get: function () {
    return OAuthErrorResponseSchema;
  }
});
Object.defineProperty(exports, 'OAuthMetadataSchema', {
  enumerable: true,
  get: function () {
    return OAuthMetadataSchema;
  }
});
Object.defineProperty(exports, 'OAuthProtectedResourceMetadataSchema', {
  enumerable: true,
  get: function () {
    return OAuthProtectedResourceMetadataSchema;
  }
});
Object.defineProperty(exports, 'OAuthTokenRevocationRequestSchema', {
  enumerable: true,
  get: function () {
    return OAuthTokenRevocationRequestSchema;
  }
});
Object.defineProperty(exports, 'OAuthTokensSchema', {
  enumerable: true,
  get: function () {
    return OAuthTokensSchema;
  }
});
Object.defineProperty(exports, 'OpenIdProviderDiscoveryMetadataSchema', {
  enumerable: true,
  get: function () {
    return OpenIdProviderDiscoveryMetadataSchema;
  }
});
Object.defineProperty(exports, 'OpenIdProviderMetadataSchema', {
  enumerable: true,
  get: function () {
    return OpenIdProviderMetadataSchema;
  }
});
Object.defineProperty(exports, 'OptionalSafeUrlSchema', {
  enumerable: true,
  get: function () {
    return OptionalSafeUrlSchema;
  }
});
Object.defineProperty(exports, 'SafeUrlSchema', {
  enumerable: true,
  get: function () {
    return SafeUrlSchema;
  }
});
//# sourceMappingURL=auth-CV4m0LEJ.cjs.map