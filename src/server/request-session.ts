import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { ExpectedOperationError } from "../shared/error-reporting.ts";
import { captureServerError, registerRequestSessionResponse } from "./telemetry.ts";

export type ServerRequestContext = RequestHandlerExtra<ServerRequest, ServerNotification>;

export async function openRequestSession(signal: AbortSignal, open: () => Promise<string>, close: (id: string) => void | Promise<void>): Promise<string> {
  signal.throwIfAborted();
  const id = await open();
  async function closeCancelledSession() {
    try { await close(id); }
    catch (error) { captureServerError(error, "stream.cancel_cleanup"); }
  }
  if (signal.aborted) {
    await closeCancelledSession();
    throw new ExpectedOperationError("cancelled", "Stream opening cancelled.");
  }
  const cancel = () => {
    void closeCancelledSession();
  };
  signal.addEventListener("abort", cancel, { once: true });
  // Response delivery ends request ownership before the client can cancel its signal.
  registerRequestSessionResponse(() => { signal.removeEventListener("abort", cancel); }, closeCancelledSession);
  return id;
}
