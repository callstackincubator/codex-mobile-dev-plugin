import { SessionChangedError } from "../../device-session-context.ts";
import { HttpBodyError } from "../../request-body.ts";
import { parseSessionPageQuery } from "../../session-api.ts";
import {
  parseSessionReplayMultiplier,
  SessionReplayConflictError,
} from "../../session-recorder.ts";
import {
  clearSessionReplayResponse,
  sessionReplayErrorResponse,
  startSessionReplayResponse,
  stopSessionReplayResponse,
} from "../../session-replay-api.ts";
import { createSessionReplayHandlers } from "../../session-replay-session.ts";
import type { ApiDependencies } from "../dependencies.ts";
import type { ApiRoute } from "../router.ts";

export function sessionRoutes(): ApiRoute<ApiDependencies>[] {
  return [
    {
      method: "GET",
      path: "/api/session",
      handler: async ({ url, deps }) => {
        const { responseMetrics, requestContext, errorResponse } = deps;
        try {
          return responseMetrics.response(
            "sessionPage",
            requestContext.recorder.page(
              parseSessionPageQuery(url.searchParams),
            ),
          );
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "DELETE",
      path: "/api/session",
      handler: async ({ deps }) => {
        const { requestContext, errorResponse, sessions } = deps;
        try {
          sessions.assertCurrent(requestContext);
          return clearSessionReplayResponse(requestContext.recorder);
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "GET",
      path: "/api/session/export",
      handler: async ({ deps }) => {
        const { responseMetrics, requestContext } = deps;
        return responseMetrics.response(
          "sessionExport",
          requestContext.recorder.export(),
        );
      },
    },
    {
      method: "POST",
      path: "/api/session/replay",
      handler: async ({ request: req, deps }) => {
        const {
          requestContext,
          readJsonBody,
          MAX_JSON_BODY_BYTES,
          errorResponse,
          sessions,
          enqueueGesture,
          setLocation,
        } = deps;
        const replayRecorder = requestContext.recorder;
        const replayAdmissionEpoch = replayRecorder.replayAdmissionEpoch;
        let multiplier: number;
        try {
          const payload = await readJsonBody(
            req,
            MAX_JSON_BODY_BYTES,
            requestContext,
          );
          multiplier = parseSessionReplayMultiplier(payload);
        } catch (err) {
          return err instanceof SessionChangedError ||
            err instanceof HttpBodyError
            ? errorResponse(err)
            : sessionReplayErrorResponse(err, 400);
        }
        const isCurrentReplaySession = () =>
          replayAdmissionEpoch === replayRecorder.replayAdmissionEpoch &&
          replayRecorder === requestContext.recorder &&
          sessions.isCurrent(requestContext);
        const handlers = createSessionReplayHandlers({
          generation: requestContext.generation,
          getGeneration: () => sessions.current.generation,
          dispatchGesture: (gesture) =>
            enqueueGesture(
              requestContext,
              gesture,
              "session:replay",
              false,
            ).completion.then(() => {}),
          setLocation: async (fix, signal) => {
            requestContext.route.stop();
            await setLocation(requestContext.serial, fix, signal);
            if (!isCurrentReplaySession()) {
              throw new SessionReplayConflictError(
                "device session changed during session replay",
              );
            }
            requestContext.lastLocation = {
              ...fix,
              appliedAt: new Date().toISOString(),
            };
          },
        });
        return startSessionReplayResponse(
          replayRecorder,
          handlers,
          multiplier,
          isCurrentReplaySession,
        );
      },
    },
    {
      method: "POST",
      path: "/api/session/replay/stop",
      handler: async ({ deps }) => {
        const { requestContext, sessions } = deps;
        const stoppedRecorder = requestContext.recorder;
        const response = await stopSessionReplayResponse(stoppedRecorder);
        if (!sessions.isCurrent(requestContext)) {
          return sessionReplayErrorResponse(
            new SessionReplayConflictError(
              "device session changed while stopping session replay",
            ),
          );
        }
        return response;
      },
    },
  ];
}
