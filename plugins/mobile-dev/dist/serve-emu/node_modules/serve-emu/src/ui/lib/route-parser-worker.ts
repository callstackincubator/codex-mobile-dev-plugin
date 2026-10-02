import {
  DEFAULT_MAX_ROUTE_FILE_BYTES,
  RouteParseError,
  parseRouteText,
  type RouteParseLimits,
  type RouteParseErrorCode,
  type RouteParseProgress,
  type RouteParseResult,
} from "./route-parser";

export type RouteParseRequestId = string | number;

export type RouteFileLike = {
  readonly name: string;
  readonly size: number;
  text(): Promise<string>;
};

export type RouteParserWorkerCommand =
  | {
    type: "parse";
    requestId: RouteParseRequestId;
    file: RouteFileLike;
    limits?: Partial<RouteParseLimits>;
    maxFileBytes?: number;
  }
  | { type: "cancel"; requestId?: RouteParseRequestId };

export type RouteParserWorkerResponse =
  | {
    type: "accepted";
    requestId: RouteParseRequestId;
    fileName: string;
    totalBytes: number;
  }
  | {
    type: "progress";
    requestId: RouteParseRequestId;
    stage: "reading" | "parsing";
    bytesRead: number;
    totalBytes: number;
    processed: number;
    waypoints: number;
  }
  | { type: "result"; requestId: RouteParseRequestId; result: RouteParseResult }
  | {
    type: "error";
    requestId: RouteParseRequestId;
    error: { code: RouteParseErrorCode; message: string };
  }
  | {
    type: "cancelled";
    requestId: RouteParseRequestId;
    reason: "cancelled" | "superseded";
  };

type ActiveParse = {
  requestId: RouteParseRequestId;
  abortController: AbortController;
  cancelNotified: boolean;
};

function boundedFileLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_ROUTE_FILE_BYTES;
  if (!Number.isSafeInteger(value) || value < 1) return DEFAULT_MAX_ROUTE_FILE_BYTES;
  return Math.min(value, DEFAULT_MAX_ROUTE_FILE_BYTES);
}

export class RouteParserWorkerController {
  readonly #post: (response: RouteParserWorkerResponse) => void;
  #active: ActiveParse | null = null;

  constructor(post: (response: RouteParserWorkerResponse) => void) {
    this.#post = post;
  }

  handle(command: RouteParserWorkerCommand): Promise<void> {
    if (command.type === "cancel") {
      const active = this.#active;
      if (active && (command.requestId === undefined || command.requestId === active.requestId)) {
        this.#cancel(active, "cancelled");
      }
      return Promise.resolve();
    }
    return this.#parse(command);
  }

  #cancel(active: ActiveParse, reason: "cancelled" | "superseded"): void {
    if (!active.abortController.signal.aborted) active.abortController.abort(reason);
    if (!active.cancelNotified) {
      active.cancelNotified = true;
      this.#post({ type: "cancelled", requestId: active.requestId, reason });
    }
    if (this.#active === active) this.#active = null;
  }

  async #parse(command: Extract<RouteParserWorkerCommand, { type: "parse" }>): Promise<void> {
    if (this.#active) this.#cancel(this.#active, "superseded");
    const active: ActiveParse = {
      requestId: command.requestId,
      abortController: new AbortController(),
      cancelNotified: false,
    };
    this.#active = active;
    const totalBytes = Number.isSafeInteger(command.file.size) && command.file.size >= 0
      ? command.file.size
      : Number.POSITIVE_INFINITY;
    this.#post({
      type: "accepted",
      requestId: command.requestId,
      fileName: command.file.name,
      totalBytes,
    });

    try {
      const maxFileBytes = boundedFileLimit(command.maxFileBytes);
      if (totalBytes > maxFileBytes) {
        throw new RouteParseError(
          "file-too-large",
          `route file exceeds the ${maxFileBytes} byte limit`,
        );
      }
      this.#post({
        type: "progress",
        requestId: command.requestId,
        stage: "reading",
        bytesRead: 0,
        totalBytes,
        processed: 0,
        waypoints: 0,
      });
      const text = await command.file.text();
      if (active.abortController.signal.aborted || this.#active !== active) return;
      this.#post({
        type: "progress",
        requestId: command.requestId,
        stage: "reading",
        bytesRead: totalBytes,
        totalBytes,
        processed: 0,
        waypoints: 0,
      });
      const result = await parseRouteText(text, command.file.name, {
        limits: command.limits,
        signal: active.abortController.signal,
        onProgress: (progress: RouteParseProgress) => {
          if (active.abortController.signal.aborted || this.#active !== active) return;
          this.#post({
            type: "progress",
            requestId: command.requestId,
            stage: progress.stage,
            bytesRead: totalBytes,
            totalBytes,
            processed: progress.processed,
            waypoints: progress.waypoints,
          });
        },
      });
      if (active.abortController.signal.aborted || this.#active !== active) return;
      this.#post({ type: "result", requestId: command.requestId, result });
    } catch (error) {
      if (active.abortController.signal.aborted) {
        if (!active.cancelNotified) this.#cancel(active, "cancelled");
        return;
      }
      const routeError = error instanceof RouteParseError
        ? error
        : new RouteParseError("invalid-route", error instanceof Error ? error.message : String(error));
      this.#post({
        type: "error",
        requestId: command.requestId,
        error: { code: routeError.code, message: routeError.message },
      });
    } finally {
      if (this.#active === active) this.#active = null;
    }
  }
}

type WorkerPort = {
  postMessage(message: RouteParserWorkerResponse): void;
  addEventListener(type: "message", listener: (event: MessageEvent<RouteParserWorkerCommand>) => void): void;
};

// Avoid installing a handler when tests import this module or when the types
// are accidentally imported as values by the window bundle.
const maybeWorkerPort = globalThis as unknown as Partial<WorkerPort> & { document?: unknown };
if (
  maybeWorkerPort.document === undefined &&
  typeof maybeWorkerPort.postMessage === "function" &&
  typeof maybeWorkerPort.addEventListener === "function"
) {
  const workerPort = maybeWorkerPort as WorkerPort;
  const controller = new RouteParserWorkerController((response) => workerPort.postMessage(response));
  workerPort.addEventListener("message", (event) => {
    void controller.handle(event.data);
  });
}
