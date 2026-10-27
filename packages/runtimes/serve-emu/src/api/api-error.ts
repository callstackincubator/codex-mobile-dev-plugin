import type {
  ApiErrorCode,
  ApiFailure,
} from "../shared/api-contracts.ts";

export type { ApiErrorCode } from "../shared/api-contracts.ts";

export const API_ERROR_STATUS = {
  invalid_request: 400,
  invalid_json: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  internal_error: 500,
  downstream_failure: 502,
  service_unavailable: 503,
} as const satisfies Record<ApiErrorCode, number>;

export type ApiErrorStatus = (typeof API_ERROR_STATUS)[ApiErrorCode];

export type ApiErrorBody = ApiFailure;

export type ApiErrorOptions = {
  cause?: unknown;
  headers?: HeadersInit;
};

/**
 * An error that is safe to expose at the HTTP boundary.
 *
 * `message` must not contain command output, credentials, or other internal
 * details. Put the original error in `cause`; the router logs it for server
 * failures without returning it to the client.
 */
export class ApiError extends Error {
  readonly status: ApiErrorStatus;
  readonly code: ApiErrorCode;
  readonly headers: Headers;

  constructor(
    status: ApiErrorStatus,
    code: ApiErrorCode,
    message: string,
    options: ApiErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    const expectedStatus = API_ERROR_STATUS[code];
    if (status !== expectedStatus) {
      throw new TypeError(
        `API error code ${code} must use status ${expectedStatus}, not ${status}`,
      );
    }
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.headers = new Headers(options.headers);
  }
}

export function apiErrorBody(error: ApiError): ApiErrorBody {
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
    },
  };
}

export function apiErrorResponse(error: ApiError): Response {
  const headers = new Headers(error.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return Response.json(apiErrorBody(error), {
    status: error.status,
    headers,
  });
}

export function internalApiError(cause: unknown): ApiError {
  return new ApiError(500, "internal_error", "Internal server error", {
    cause,
  });
}
