import * as z from "zod/v4";

//#region src/auth.d.ts

/**
 * Reusable URL validation that disallows `javascript:` scheme
 */
declare const SafeUrlSchema: z.ZodURL;
/**
 * RFC 9728 OAuth Protected Resource Metadata
 */
declare const OAuthProtectedResourceMetadataSchema: z.ZodObject<{
  resource: z.ZodString;
  authorization_servers: z.ZodOptional<z.ZodArray<z.ZodURL>>;
  jwks_uri: z.ZodOptional<z.ZodString>;
  scopes_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  bearer_methods_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  resource_signing_alg_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  resource_name: z.ZodOptional<z.ZodString>;
  resource_documentation: z.ZodOptional<z.ZodString>;
  resource_policy_uri: z.ZodOptional<z.ZodString>;
  resource_tos_uri: z.ZodOptional<z.ZodString>;
  tls_client_certificate_bound_access_tokens: z.ZodOptional<z.ZodBoolean>;
  authorization_details_types_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  dpop_signing_alg_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  dpop_bound_access_tokens_required: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>;
/**
 * RFC 8414 OAuth 2.0 Authorization Server Metadata
 */
declare const OAuthMetadataSchema: z.ZodObject<{
  issuer: z.ZodString;
  authorization_endpoint: z.ZodURL;
  token_endpoint: z.ZodURL;
  registration_endpoint: z.ZodOptional<z.ZodURL>;
  scopes_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  response_types_supported: z.ZodArray<z.ZodString>;
  response_modes_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  grant_types_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  token_endpoint_auth_methods_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  token_endpoint_auth_signing_alg_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  service_documentation: z.ZodOptional<z.ZodURL>;
  revocation_endpoint: z.ZodOptional<z.ZodURL>;
  revocation_endpoint_auth_methods_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  revocation_endpoint_auth_signing_alg_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  introspection_endpoint: z.ZodOptional<z.ZodString>;
  introspection_endpoint_auth_methods_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  introspection_endpoint_auth_signing_alg_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  code_challenge_methods_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  client_id_metadata_document_supported: z.ZodOptional<z.ZodBoolean>;
  authorization_response_iss_parameter_supported: z.ZodCatch<z.ZodOptional<z.ZodBoolean>>;
  /**
   * RFC 9449 §5.1 (DPoP, SEP-1932): the JWS `alg` values this authorization server accepts for
   * DPoP proofs at the token endpoint. A server supporting DPoP MUST publish this field.
   */
  dpop_signing_alg_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$loose>;
/**
 * OpenID Connect Discovery 1.0 Provider Metadata
 *
 * @see https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderMetadata
 */
declare const OpenIdProviderMetadataSchema: z.ZodObject<{
  issuer: z.ZodString;
  authorization_endpoint: z.ZodURL;
  token_endpoint: z.ZodURL;
  userinfo_endpoint: z.ZodOptional<z.ZodURL>;
  jwks_uri: z.ZodURL;
  registration_endpoint: z.ZodOptional<z.ZodURL>;
  scopes_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  response_types_supported: z.ZodArray<z.ZodString>;
  response_modes_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  grant_types_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  acr_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  subject_types_supported: z.ZodArray<z.ZodString>;
  id_token_signing_alg_values_supported: z.ZodArray<z.ZodString>;
  id_token_encryption_alg_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  id_token_encryption_enc_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  userinfo_signing_alg_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  userinfo_encryption_alg_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  userinfo_encryption_enc_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  request_object_signing_alg_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  request_object_encryption_alg_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  request_object_encryption_enc_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  token_endpoint_auth_methods_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  token_endpoint_auth_signing_alg_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  display_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  claim_types_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  claims_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  service_documentation: z.ZodOptional<z.ZodString>;
  claims_locales_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  ui_locales_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  claims_parameter_supported: z.ZodOptional<z.ZodBoolean>;
  request_parameter_supported: z.ZodOptional<z.ZodBoolean>;
  request_uri_parameter_supported: z.ZodOptional<z.ZodBoolean>;
  require_request_uri_registration: z.ZodOptional<z.ZodBoolean>;
  op_policy_uri: z.ZodOptional<z.ZodURL>;
  op_tos_uri: z.ZodOptional<z.ZodURL>;
  client_id_metadata_document_supported: z.ZodOptional<z.ZodBoolean>;
  authorization_response_iss_parameter_supported: z.ZodCatch<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$loose>;
/**
 * OpenID Connect Discovery metadata that may include OAuth 2.0 fields
 * This schema represents the real-world scenario where OIDC providers
 * return a mix of OpenID Connect and OAuth 2.0 metadata fields
 */
declare const OpenIdProviderDiscoveryMetadataSchema: z.ZodObject<{
  code_challenge_methods_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  issuer: z.ZodString;
  authorization_endpoint: z.ZodURL;
  token_endpoint: z.ZodURL;
  userinfo_endpoint: z.ZodOptional<z.ZodURL>;
  jwks_uri: z.ZodURL;
  registration_endpoint: z.ZodOptional<z.ZodURL>;
  scopes_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  response_types_supported: z.ZodArray<z.ZodString>;
  response_modes_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  grant_types_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  acr_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  subject_types_supported: z.ZodArray<z.ZodString>;
  id_token_signing_alg_values_supported: z.ZodArray<z.ZodString>;
  id_token_encryption_alg_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  id_token_encryption_enc_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  userinfo_signing_alg_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  userinfo_encryption_alg_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  userinfo_encryption_enc_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  request_object_signing_alg_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  request_object_encryption_alg_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  request_object_encryption_enc_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  token_endpoint_auth_methods_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  token_endpoint_auth_signing_alg_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  display_values_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  claim_types_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  claims_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  service_documentation: z.ZodOptional<z.ZodString>;
  claims_locales_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  ui_locales_supported: z.ZodOptional<z.ZodArray<z.ZodString>>;
  claims_parameter_supported: z.ZodOptional<z.ZodBoolean>;
  request_parameter_supported: z.ZodOptional<z.ZodBoolean>;
  request_uri_parameter_supported: z.ZodOptional<z.ZodBoolean>;
  require_request_uri_registration: z.ZodOptional<z.ZodBoolean>;
  op_policy_uri: z.ZodOptional<z.ZodURL>;
  op_tos_uri: z.ZodOptional<z.ZodURL>;
  client_id_metadata_document_supported: z.ZodOptional<z.ZodBoolean>;
  authorization_response_iss_parameter_supported: z.ZodCatch<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$strip>;
/**
 * OAuth 2.1 token response
 */
declare const OAuthTokensSchema: z.ZodObject<{
  access_token: z.ZodString;
  id_token: z.ZodOptional<z.ZodString>;
  token_type: z.ZodString;
  expires_in: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
  scope: z.ZodOptional<z.ZodString>;
  refresh_token: z.ZodOptional<z.ZodString>;
  issuer: z.ZodCatch<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
/**
 * RFC 8693 §2.2.1 Token Exchange response for ID-JAG tokens.
 *
 * `token_type` is intentionally optional: per RFC 8693 §2.2.1 it is informational when
 * the issued token is not an access token, and per RFC 6749 §5.1 it is case-insensitive,
 * so strict checking rejects conformant IdPs.
 */
declare const IdJagTokenExchangeResponseSchema: z.ZodObject<{
  issued_token_type: z.ZodLiteral<"urn:ietf:params:oauth:token-type:id-jag">;
  access_token: z.ZodString;
  token_type: z.ZodOptional<z.ZodString>;
  expires_in: z.ZodOptional<z.ZodNumber>;
  scope: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type IdJagTokenExchangeResponse = z.infer<typeof IdJagTokenExchangeResponseSchema>;
/**
 * OAuth 2.1 error response
 */
declare const OAuthErrorResponseSchema: z.ZodObject<{
  error: z.ZodString;
  error_description: z.ZodOptional<z.ZodString>;
  error_uri: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * Optional version of {@linkcode SafeUrlSchema} that allows empty string for backward compatibility on `tos_uri` and `logo_uri`
 */
declare const OptionalSafeUrlSchema: z.ZodUnion<[z.ZodOptional<z.ZodURL>, z.ZodPipe<z.ZodLiteral<"">, z.ZodTransform<undefined, "">>]>;
/**
 * RFC 7591 OAuth 2.0 Dynamic Client Registration metadata
 */
declare const OAuthClientMetadataSchema: z.ZodObject<{
  redirect_uris: z.ZodArray<z.ZodURL>;
  token_endpoint_auth_method: z.ZodOptional<z.ZodString>;
  grant_types: z.ZodOptional<z.ZodArray<z.ZodString>>;
  response_types: z.ZodOptional<z.ZodArray<z.ZodString>>;
  application_type: z.ZodOptional<z.ZodString>;
  client_name: z.ZodOptional<z.ZodString>;
  client_uri: z.ZodOptional<z.ZodURL>;
  logo_uri: z.ZodUnion<[z.ZodOptional<z.ZodURL>, z.ZodPipe<z.ZodLiteral<"">, z.ZodTransform<undefined, "">>]>;
  scope: z.ZodOptional<z.ZodString>;
  contacts: z.ZodOptional<z.ZodArray<z.ZodString>>;
  tos_uri: z.ZodUnion<[z.ZodOptional<z.ZodURL>, z.ZodPipe<z.ZodLiteral<"">, z.ZodTransform<undefined, "">>]>;
  policy_uri: z.ZodOptional<z.ZodString>;
  jwks_uri: z.ZodOptional<z.ZodURL>;
  jwks: z.ZodOptional<z.ZodAny>;
  software_id: z.ZodOptional<z.ZodString>;
  software_version: z.ZodOptional<z.ZodString>;
  software_statement: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * RFC 7591 OAuth 2.0 Dynamic Client Registration client information
 */
declare const OAuthClientInformationSchema: z.ZodObject<{
  client_id: z.ZodString;
  client_secret: z.ZodOptional<z.ZodString>;
  client_id_issued_at: z.ZodOptional<z.ZodNumber>;
  client_secret_expires_at: z.ZodOptional<z.ZodNumber>;
  issuer: z.ZodCatch<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
/**
 * RFC 7591 OAuth 2.0 Dynamic Client Registration full response (client information plus metadata)
 */
declare const OAuthClientInformationFullSchema: z.ZodObject<{
  redirect_uris: z.ZodArray<z.ZodURL>;
  token_endpoint_auth_method: z.ZodOptional<z.ZodString>;
  grant_types: z.ZodOptional<z.ZodArray<z.ZodString>>;
  response_types: z.ZodOptional<z.ZodArray<z.ZodString>>;
  application_type: z.ZodOptional<z.ZodString>;
  client_name: z.ZodOptional<z.ZodString>;
  client_uri: z.ZodOptional<z.ZodURL>;
  logo_uri: z.ZodUnion<[z.ZodOptional<z.ZodURL>, z.ZodPipe<z.ZodLiteral<"">, z.ZodTransform<undefined, "">>]>;
  scope: z.ZodOptional<z.ZodString>;
  contacts: z.ZodOptional<z.ZodArray<z.ZodString>>;
  tos_uri: z.ZodUnion<[z.ZodOptional<z.ZodURL>, z.ZodPipe<z.ZodLiteral<"">, z.ZodTransform<undefined, "">>]>;
  policy_uri: z.ZodOptional<z.ZodString>;
  jwks_uri: z.ZodOptional<z.ZodURL>;
  jwks: z.ZodOptional<z.ZodAny>;
  software_id: z.ZodOptional<z.ZodString>;
  software_version: z.ZodOptional<z.ZodString>;
  software_statement: z.ZodOptional<z.ZodString>;
  client_id: z.ZodString;
  client_secret: z.ZodOptional<z.ZodString>;
  client_id_issued_at: z.ZodOptional<z.ZodNumber>;
  client_secret_expires_at: z.ZodOptional<z.ZodNumber>;
  issuer: z.ZodCatch<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
/**
 * RFC 7591 OAuth 2.0 Dynamic Client Registration error response
 */
declare const OAuthClientRegistrationErrorSchema: z.ZodObject<{
  error: z.ZodString;
  error_description: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * RFC 7009 OAuth 2.0 Token Revocation request
 */
declare const OAuthTokenRevocationRequestSchema: z.ZodObject<{
  token: z.ZodString;
  token_type_hint: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type OAuthMetadata = z.infer<typeof OAuthMetadataSchema>;
type OpenIdProviderMetadata = z.infer<typeof OpenIdProviderMetadataSchema>;
type OpenIdProviderDiscoveryMetadata = z.infer<typeof OpenIdProviderDiscoveryMetadataSchema>;
type OAuthTokens = z.infer<typeof OAuthTokensSchema>;
type OAuthErrorResponse = z.infer<typeof OAuthErrorResponseSchema>;
type OAuthClientMetadata = z.infer<typeof OAuthClientMetadataSchema>;
type OAuthClientInformation = z.infer<typeof OAuthClientInformationSchema>;
type OAuthClientInformationFull = z.infer<typeof OAuthClientInformationFullSchema>;
type OAuthClientInformationMixed = OAuthClientInformation | OAuthClientInformationFull;
/**
 * {@linkcode OAuthTokens} as persisted by an `OAuthClientProvider`. Adds an
 * SDK-stamped authorization-server `issuer` identifier so stored tokens are
 * bound to the AS that issued them. The `issuer` field is **not** part of the
 * RFC 6749 wire response; the client SDK writes it before calling `saveTokens`.
 */
type StoredOAuthTokens = OAuthTokens & {
  issuer?: string | undefined;
};
/**
 * {@linkcode OAuthClientInformationMixed} as persisted by an
 * `OAuthClientProvider`. Adds an SDK-stamped authorization-server `issuer`
 * identifier so stored client credentials are bound to the AS that issued them.
 * The `issuer` field is **not** part of the RFC 7591 wire response; the client SDK
 * writes it before calling `saveClientInformation`.
 */
type StoredOAuthClientInformation = OAuthClientInformationMixed & {
  issuer?: string | undefined;
};
type OAuthClientRegistrationError = z.infer<typeof OAuthClientRegistrationErrorSchema>;
type OAuthTokenRevocationRequest = z.infer<typeof OAuthTokenRevocationRequestSchema>;
type OAuthProtectedResourceMetadata = z.infer<typeof OAuthProtectedResourceMetadataSchema>;
type AuthorizationServerMetadata = OAuthMetadata | OpenIdProviderDiscoveryMetadata;
//#endregion
export { StoredOAuthTokens as A, OpenIdProviderDiscoveryMetadata as C, OptionalSafeUrlSchema as D, OpenIdProviderMetadataSchema as E, SafeUrlSchema as O, OAuthTokensSchema as S, OpenIdProviderMetadata as T, OAuthProtectedResourceMetadata as _, OAuthClientInformationFull as a, OAuthTokenRevocationRequestSchema as b, OAuthClientInformationSchema as c, OAuthClientRegistrationError as d, OAuthClientRegistrationErrorSchema as f, OAuthMetadataSchema as g, OAuthMetadata as h, OAuthClientInformation as i, StoredOAuthClientInformation as k, OAuthClientMetadata as l, OAuthErrorResponseSchema as m, IdJagTokenExchangeResponse as n, OAuthClientInformationFullSchema as o, OAuthErrorResponse as p, IdJagTokenExchangeResponseSchema as r, OAuthClientInformationMixed as s, AuthorizationServerMetadata as t, OAuthClientMetadataSchema as u, OAuthProtectedResourceMetadataSchema as v, OpenIdProviderDiscoveryMetadataSchema as w, OAuthTokens as x, OAuthTokenRevocationRequest as y };
//# sourceMappingURL=auth-B7cIpDZF.d.mts.map