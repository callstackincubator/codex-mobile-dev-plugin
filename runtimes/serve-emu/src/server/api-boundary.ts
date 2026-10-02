export const MAX_JSON_BODY_BYTES = 8 * 1024;
export const MAX_ROUTE_BODY_BYTES = 2 * 1024 * 1024;

export type ApiErrorCode =
  | "invalid_json"
  | "not_found"
  | "method_not_allowed"
  | "payload_too_large";

export class ApiBoundaryError extends Error {
  constructor(
    readonly status: 400 | 404 | 405 | 413,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiBoundaryError";
  }
}

export const API_ROUTE_METHODS = {
  "/api": ["GET"],
  "/api/devices": ["GET"],
  "/api/device-grid": ["GET"],
  "/api/devices/select": ["POST"],
  "/api/avds/start": ["POST"],
  "/api/avds/stop": ["POST"],
  "/api/orientation": ["GET", "POST"],
  "/api/night-mode": ["GET", "POST"],
  "/api/font-scale": ["GET", "POST"],
  "/api/network": ["GET", "POST"],
  "/api/logcat": ["GET"],
  "/api/screenshot": ["GET", "POST"],
  "/api/foreground": ["GET"],
  "/api/accessibility": ["GET"],
  "/api/accessibility/tap": ["POST"],
  "/api/tap": ["POST"],
  "/api/swipe": ["POST"],
  "/api/text": ["POST"],
  "/api/key": ["POST"],
  "/api/session": ["GET", "DELETE"],
  "/api/session/replay": ["POST"],
  "/api/session/replay/stop": ["POST"],
  "/api/apps/install": ["POST"],
  "/api/files/import": ["POST"],
  "/api/apps/launch": ["POST"],
  "/api/apps/clear": ["POST"],
  "/api/apps/force-stop": ["POST"],
  "/api/apps/grant": ["POST"],
  "/api/location": ["GET", "POST"],
  "/api/route": ["GET", "POST", "DELETE"],
  "/api/route/control": ["POST"],
} as const satisfies Record<string, readonly string[]>;

export type ApiPath = keyof typeof API_ROUTE_METHODS;

export function apiFailure(
  error: ApiBoundaryError,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code: error.code, message: error.message },
    }),
    { status: error.status, headers: responseHeaders },
  );
}

export function apiErrorResponse(error: unknown): Response {
  if (error instanceof ApiBoundaryError) return apiFailure(error);
  return Response.json(
    {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    },
    { status: 400 },
  );
}

export async function withApiErrorBoundary(
  handler: () => Response | Promise<Response>,
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * Enforces the complete API path/method surface before business routing. A
 * null result means the request may continue to its route handler.
 */
export function apiMethodGate(pathname: string, method: string): Response | null {
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return null;
  const allowed = API_ROUTE_METHODS[pathname as ApiPath];
  if (!allowed) {
    return apiFailure(
      new ApiBoundaryError(404, "not_found", "API route not found"),
    );
  }
  if ((allowed as readonly string[]).includes(method)) return null;
  return apiFailure(
    new ApiBoundaryError(
      405,
      "method_not_allowed",
      `Method ${method} is not allowed for ${pathname}`,
    ),
    { Allow: allowed.join(", ") },
  );
}

export async function readBodyBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("maxBytes must be a non-negative safe integer");
  }
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new ApiBoundaryError(400, "invalid_json", "Invalid Content-Length");
    }
    if (bytes > maxBytes) {
      throw new ApiBoundaryError(
        413,
        "payload_too_large",
        "Request body is too large",
      );
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {}
        throw new ApiBoundaryError(
          413,
          "payload_too_large",
          "Request body is too large",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readJsonBody(
  request: Request,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  const bytes = await readBodyBytes(request, maxBytes);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new ApiBoundaryError(400, "invalid_json", "Request body is not valid JSON");
  }
}
