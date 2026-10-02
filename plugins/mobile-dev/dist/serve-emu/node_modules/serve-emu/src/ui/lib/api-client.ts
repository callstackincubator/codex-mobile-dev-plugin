import {
  isApiFailure,
  parseApiResponse,
  type ApiErrorCode,
  type ApiMethod,
  type ApiPath,
  type ApiRequest,
  type ApiResponse,
  type ApiSuccessResponse,
} from "../../shared/api-contracts";

export type { ApiSuccessResponse } from "../../shared/api-contracts";

export type ApiClientPath = Exclude<ApiPath, "/api/logcat">;

type RequestBodyOption<Body> = [Body] extends [undefined]
  ? { body?: undefined }
  : { body: Body };

export type ApiRequestOptions<
  P extends ApiClientPath,
  M extends ApiMethod<P>,
> = Omit<RequestInit, "body" | "method"> &
  { method: M } &
  RequestBodyOption<ApiRequest<P, M>>;

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type ApiClientErrorOptions = {
  status: number;
  code: ApiClientErrorCode;
  payload?: unknown;
  cause?: unknown;
};

export type ApiClientErrorCode =
  | ApiErrorCode
  | "invalid_response"
  | "legacy_error"
  | "http_error"
  | "network_error";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiClientErrorCode;
  readonly payload: unknown;

  constructor(message: string, options: ApiClientErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "ApiClientError";
    this.status = options.status;
    this.code = options.code;
    this.payload = options.payload;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(value: unknown): boolean {
  return isRecord(value) && value.name === "AbortError";
}

function legacyFailureMessage(value: unknown): string | null {
  if (!isRecord(value) || value.ok !== false || typeof value.error !== "string") return null;
  return value.error;
}

function requestBody(body: unknown, headers: Headers): BodyInit | undefined {
  if (body === undefined) return undefined;
  if (body instanceof FormData) return body;
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return JSON.stringify(body);
}

export function createApiClient(fetcher: FetchLike = globalThis.fetch) {
  return async function apiRequest<
    P extends ApiClientPath,
    M extends ApiMethod<P>,
  >(
    path: P,
    options: ApiRequestOptions<P, M>,
  ): Promise<ApiSuccessResponse<P, M>> {
    const { body, method, ...requestOptions } = options;
    const headers = new Headers(requestOptions.headers);
    let response: Response;
    try {
      response = await fetcher(path, {
        ...requestOptions,
        method,
        headers,
        body: requestBody(body, headers),
      });
    } catch (cause) {
      if (isAbortError(cause)) throw cause;
      throw new ApiClientError("Unable to reach the API", {
        status: 0,
        code: "network_error",
        cause,
      });
    }

    if (
      response.ok &&
      path === "/api/screenshot" &&
      response.headers.get("content-type")?.toLowerCase().startsWith("image/png")
    ) {
      try {
        return new Uint8Array(await response.arrayBuffer()) as ApiSuccessResponse<P, M>;
      } catch (cause) {
        throw new ApiClientError("Server returned an invalid image", {
          status: response.status,
          code: "invalid_response",
          cause,
        });
      }
    }

    let payload: unknown;
    try {
      payload = await response.json() as unknown;
    } catch (cause) {
      if (isAbortError(cause)) throw cause;
      throw new ApiClientError("Server returned invalid JSON", {
        status: response.status,
        code: "invalid_response",
        cause,
      });
    }

    // Keep the client usable during rolling upgrades from the original
    // `{ ok: false, error: string }` response shape.
    const legacyMessage = legacyFailureMessage(payload);
    if (legacyMessage !== null) {
      throw new ApiClientError(legacyMessage, {
        status: response.status,
        code: "legacy_error",
        payload,
      });
    }

    let parsed: ApiResponse<P, M>;
    try {
      parsed = parseApiResponse(path, method, payload);
    } catch (cause) {
      throw new ApiClientError("Server returned an invalid API response", {
        status: response.status,
        code: "invalid_response",
        payload,
        cause,
      });
    }

    if (isApiFailure(parsed)) {
      throw new ApiClientError(parsed.error.message, {
        status: response.status,
        code: parsed.error.code,
        payload: parsed,
      });
    }

    if (!response.ok) {
      throw new ApiClientError(
        response.statusText || `Request failed with HTTP ${response.status}`,
        {
          status: response.status,
          code: "http_error",
          payload,
        },
      );
    }

    return parsed as ApiSuccessResponse<P, M>;
  };
}

export const apiRequest = createApiClient();
