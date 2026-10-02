import { ApiError } from "./api-error.ts";
import { readBodyBytes } from "./body.ts";

const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
export const MAX_APK_MULTIPART_BYTES = 512 * 1024 * 1024 + MULTIPART_OVERHEAD_BYTES;
export const MAX_MEDIA_MULTIPART_BYTES = 1024 * 1024 * 1024 + MULTIPART_OVERHEAD_BYTES;

/**
 * Bounds both declared and actually received multipart bytes before Bun builds
 * FormData/File objects. The dedicated streaming upload path can replace this
 * adapter without changing the domain route contract.
 */
export async function readMultipartFormData(
  request: Request,
  maxBytes: number,
): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new ApiError(
      400,
      "invalid_request",
      "Request body must be multipart/form-data",
    );
  }

  const bytes = await readBodyBytes(request, maxBytes);
  const headers = new Headers(request.headers);
  headers.set("Content-Length", String(bytes.byteLength));
  const boundedRequest = new Request(request.url, {
    method: request.method,
    headers,
    body: Uint8Array.from(bytes).buffer,
  });
  try {
    return await boundedRequest.formData();
  } catch (cause) {
    throw new ApiError(
      400,
      "invalid_request",
      "Request body must be valid multipart/form-data",
      { cause },
    );
  }
}
