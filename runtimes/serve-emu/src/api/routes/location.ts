import { SessionChangedError } from "../../device-session-context.ts";
import { parseGeoFix } from "../../location.ts";
import { routePlaybackErrorResponse } from "../../route-playback-api.ts";
import { parseRoutePlaybackRequest } from "../../route-playback.ts";
import type { ApiDependencies } from "../dependencies.ts";
import type { ApiRoute } from "../router.ts";

export function locationRoutes(): ApiRoute<ApiDependencies>[] {
  return [
    {
      method: "GET",
      path: "/api/location",
      handler: async ({ deps }) => {
        const { requestContext } = deps;
        return Response.json({
          generation: requestContext.generation,
          serial: requestContext.serial,
          emulator: /^emulator-\d+$/.test(requestContext.serial),
          location: requestContext.lastLocation,
        });
      },
    },
    {
      method: "POST",
      path: "/api/location",
      handler: async ({ request: req, deps }) => {
        const {
          requestContext,
          readJsonBody,
          MAX_JSON_BODY_BYTES,
          applyLocation,
          errorResponse,
        } = deps;
        try {
          const fix = parseGeoFix(
            await readJsonBody(req, MAX_JSON_BODY_BYTES, requestContext),
          );
          const location = await applyLocation(
            requestContext,
            fix,
            "rest:location",
          );
          return Response.json({ ok: true, location });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "GET",
      path: "/api/route",
      handler: async ({ deps }) => {
        const { requestContext } = deps;
        return Response.json(requestContext.route.snapshot());
      },
    },
    {
      method: "POST",
      path: "/api/route",
      handler: async ({ request: req, deps }) => {
        const {
          requestContext,
          readJsonBody,
          MAX_ROUTE_BODY_BYTES,
          errorResponse,
          sessions,
        } = deps;
        let route: ReturnType<typeof parseRoutePlaybackRequest>;
        try {
          route = parseRoutePlaybackRequest(
            await readJsonBody(req, MAX_ROUTE_BODY_BYTES, requestContext),
          );
        } catch (err) {
          return errorResponse(err, 400);
        }
        try {
          const start = requestContext.route.start(route);
          const snapshot = await requestContext.trackDrain(start);
          sessions.assertCurrent(requestContext);
          return Response.json({
            ok: true,
            route: snapshot,
          });
        } catch (err) {
          return err instanceof SessionChangedError
            ? errorResponse(err)
            : routePlaybackErrorResponse(err);
        }
      },
    },
    {
      method: "DELETE",
      path: "/api/route",
      handler: async ({ deps }) => {
        const { requestContext, sessions } = deps;
        sessions.assertCurrent(requestContext);
        return Response.json({
          ok: true,
          route: requestContext.route.stop(),
        });
      },
    },
    {
      method: "POST",
      path: "/api/route/control",
      handler: async ({ request: req, deps }) => {
        const {
          readJsonBody,
          MAX_JSON_BODY_BYTES,
          requestContext,
          errorResponse,
        } = deps;
        try {
          const payload = await readJsonBody(
            req,
            MAX_JSON_BODY_BYTES,
            requestContext,
          );
          if (
            typeof payload !== "object" ||
            payload === null ||
            Array.isArray(payload)
          ) {
            throw new Error("control payload must be an object");
          }
          const action = (payload as Record<string, unknown>).action;
          if (action === "pause")
            return Response.json({
              ok: true,
              route: requestContext.route.pause(),
            });
          if (action === "resume")
            return Response.json({
              ok: true,
              route: requestContext.route.resume(),
            });
          if (action === "stop")
            return Response.json({
              ok: true,
              route: requestContext.route.stop(),
            });
          throw new Error("action must be pause, resume, or stop");
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  ];
}
