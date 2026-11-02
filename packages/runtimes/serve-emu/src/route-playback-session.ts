import type { GeoFix } from "./location.ts";
import {
  RoutePlayback,
  RoutePlaybackDisposedError,
  type RoutePlaybackClock,
} from "./route-playback.ts";

type SessionRoutePlaybackOpts = {
  serial: string;
  generation: number;
  getGeneration: () => number;
  applyLocation: (
    serial: string,
    fix: GeoFix,
    signal: AbortSignal,
  ) => void | Promise<void>;
  onLocation: (fix: GeoFix & { appliedAt: string }) => void;
  clock?: RoutePlaybackClock;
};

export function createSessionRoutePlayback(
  opts: SessionRoutePlaybackOpts,
): RoutePlayback {
  const assertCurrentGeneration = () => {
    if (opts.generation !== opts.getGeneration()) {
      throw new RoutePlaybackDisposedError(
        "device session changed during route playback",
      );
    }
  };

  return new RoutePlayback({
    applyLocation: async (fix, signal) => {
      assertCurrentGeneration();
      await opts.applyLocation(opts.serial, fix, signal);
      assertCurrentGeneration();
    },
    onLocation: (fix) => {
      if (opts.generation === opts.getGeneration()) opts.onLocation(fix);
    },
    ...(opts.clock ? { clock: opts.clock } : {}),
  });
}
