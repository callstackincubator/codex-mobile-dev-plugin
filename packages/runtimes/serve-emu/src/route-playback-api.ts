import {
  RoutePlaybackConflictError,
  routePlaybackErrorStatus,
  type RoutePlayback,
  type RoutePlaybackRequest,
  type RoutePlaybackSnapshot,
} from "./route-playback.ts";

type RouteStarter = Pick<RoutePlayback, "start">;

export function routePlaybackErrorResponse(
  error: unknown,
  status = routePlaybackErrorStatus(error),
): Response {
  return Response.json(
    {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    },
    { status },
  );
}

export async function startRoutePlaybackResponse(
  playback: RouteStarter,
  request: RoutePlaybackRequest,
  isCurrent: () => boolean = () => true,
): Promise<Response> {
  if (!isCurrent()) {
    return routePlaybackErrorResponse(
      new RoutePlaybackConflictError(
        "device session changed before route playback start",
      ),
    );
  }
  try {
    const route: RoutePlaybackSnapshot = await playback.start(request);
    return Response.json({ ok: true, route });
  } catch (error) {
    return routePlaybackErrorResponse(error);
  }
}
