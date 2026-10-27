import {
  SessionReplayConflictError,
  sessionReplayErrorStatus,
  type ReplayHandlers,
  type SessionRecorder,
} from "./session-recorder.ts";

type ReplayController = Pick<
  SessionRecorder,
  "startReplay" | "cancelAndWait" | "clear"
>;

export function sessionReplayErrorResponse(
  error: unknown,
  status = sessionReplayErrorStatus(error),
): Response {
  return Response.json(
    {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    },
    { status },
  );
}

export function startSessionReplayResponse(
  recorder: ReplayController,
  handlers: ReplayHandlers,
  multiplier: number,
  isCurrent: () => boolean = () => true,
): Response {
  if (!isCurrent()) {
    return sessionReplayErrorResponse(
      new SessionReplayConflictError(
        "device session changed before session replay start",
      ),
    );
  }
  try {
    const replay = recorder.startReplay(handlers, multiplier);
    return Response.json({ ok: true, session: replay.snapshot });
  } catch (error) {
    return sessionReplayErrorResponse(error);
  }
}

export async function stopSessionReplayResponse(
  recorder: ReplayController,
): Promise<Response> {
  try {
    return Response.json({
      ok: true,
      session: await recorder.cancelAndWait(),
    });
  } catch (error) {
    return sessionReplayErrorResponse(error);
  }
}

export function clearSessionReplayResponse(
  recorder: ReplayController,
): Response {
  try {
    return Response.json({ ok: true, session: recorder.clear() });
  } catch (error) {
    return sessionReplayErrorResponse(error);
  }
}
