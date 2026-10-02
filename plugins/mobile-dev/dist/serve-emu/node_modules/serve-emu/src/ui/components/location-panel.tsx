import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PointerEvent } from "react";
import {
  MAP_TILE_SIZE,
  RouteProjectionCache,
  nearestWrappedWorldX,
  projectLocation,
  routeViewportTransform,
  unprojectLocation,
  worldSizeAtZoom,
  wrapLongitude,
  type LocationPoint,
} from "../lib/route-map";
import { DEFAULT_MAX_ROUTE_FILE_BYTES } from "../lib/route-parser";
import type {
  RouteParserWorkerCommand,
  RouteParserWorkerResponse,
} from "../lib/route-parser-worker";

type Point = { x: number; y: number };
type Tile = { key: string; x: number; y: number; left: number; top: number; wrappedX: number };
type MapDrag = {
  pointerId: number;
  start: Point;
  center: Point;
  zoom: number;
  dx: number;
  dy: number;
  moved: boolean;
};
type RouteSnapshot = {
  status: "idle" | "running" | "paused" | "completed" | "error" | "closed";
  waypointCount: number;
  totalMeters: number;
  progressMeters: number;
  speedKph: number;
  multiplier: number;
  loop: boolean;
  lastError: string | null;
  currentLocation: (LocationPoint & { appliedAt: string }) | null;
};

const TILE_SIZE = MAP_TILE_SIZE;
const TILE_OVERSCAN = 1;
const MIN_ZOOM = 2;
const MAX_ZOOM = 18;
const DEFAULT_LOCATION: LocationPoint = { latitude: 37.5665, longitude: 126.978 };
const DEFAULT_SIZE = { width: 320, height: 220 };

const PRESETS: (LocationPoint & { label: string })[] = [
  { label: "Seoul", latitude: 37.5665, longitude: 126.978 },
  { label: "London", latitude: 51.5072, longitude: -0.1276 },
  { label: "SF", latitude: 37.7749, longitude: -122.4194 },
];

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function formatCoord(n: number): string {
  return n.toFixed(6);
}

function normalizedTileX(x: number, zoom: number): number {
  const count = 2 ** zoom;
  return ((x % count) + count) % count;
}

function tileUrl(tile: Tile, zoom: number): string {
  return `https://tile.openstreetmap.org/${zoom}/${tile.wrappedX}/${tile.y}.png`;
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MiB`;
}

export function LocationPanel() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapWorldRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<MapDrag | null>(null);
  const dragFrameRef = useRef(0);
  const routeWorkerRef = useRef<Worker | null>(null);
  const routeRequestRef = useRef(0);
  const routePollGenerationRef = useRef(0);
  const routePollAbortRef = useRef<AbortController | null>(null);
  const routeMutationCountRef = useRef(0);
  const routeProjectionCache = useMemo(() => new RouteProjectionCache(), []);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [zoom, setZoom] = useState(12);
  const [center, setCenter] = useState<LocationPoint>(DEFAULT_LOCATION);
  const [draft, setDraft] = useState<LocationPoint>(DEFAULT_LOCATION);
  const [latText, setLatText] = useState(formatCoord(DEFAULT_LOCATION.latitude));
  const [lngText, setLngText] = useState(formatCoord(DEFAULT_LOCATION.longitude));
  const [status, setStatus] = useState("Ready");
  const [routePoints, setRoutePoints] = useState<LocationPoint[]>([]);
  const [routeStatus, setRouteStatus] = useState<RouteSnapshot | null>(null);
  const [speedKph, setSpeedKph] = useState("30");
  const [multiplier, setMultiplier] = useState("1");
  const [loop, setLoop] = useState(false);
  const [followRoute, setFollowRoute] = useState(true);
  const [routeParsing, setRouteParsing] = useState(false);

  const syncDraft = useCallback((next: LocationPoint, recenter = false) => {
    const normalized = {
      latitude: clamp(next.latitude, -85.05112878, 85.05112878),
      longitude: wrapLongitude(next.longitude),
    };
    setDraft(normalized);
    setLatText(formatCoord(normalized.latitude));
    setLngText(formatCoord(normalized.longitude));
    if (recenter) setCenter(normalized);
  }, []);

  const invalidateRoutePoll = useCallback(() => {
    routePollGenerationRef.current += 1;
    routePollAbortRef.current?.abort();
  }, []);

  const beginRouteMutation = useCallback(() => {
    routeMutationCountRef.current += 1;
    invalidateRoutePoll();
  }, [invalidateRoutePoll]);

  const endRouteMutation = useCallback(() => {
    routeMutationCountRef.current = Math.max(
      0,
      routeMutationCountRef.current - 1,
    );
    invalidateRoutePoll();
  }, [invalidateRoutePoll]);

  useEffect(() => {
    const node = mapRef.current;
    if (!node) return;
    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setSize({
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    fetch("/api/location")
      .then((r) => r.json())
      .then((data: { location?: LocationPoint | null }) => {
        if (data.location) syncDraft(data.location, true);
      })
      .catch(() => {});
  }, [syncDraft]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    const syncRoute = async () => {
      if (routeMutationCountRef.current > 0) {
        if (!cancelled) timer = setTimeout(syncRoute, 1_000);
        return;
      }
      controller = new AbortController();
      routePollAbortRef.current = controller;
      const generation = routePollGenerationRef.current;
      try {
        const response = await fetch("/api/route", {
          signal: controller.signal,
        });
        const route = await response.json() as RouteSnapshot;
        if (
          cancelled ||
          generation !== routePollGenerationRef.current ||
          routeMutationCountRef.current > 0
        ) {
          return;
        }
        setRouteStatus(route);
        if (route.currentLocation) {
          syncDraft(
            route.currentLocation,
            followRoute &&
              route.status === "running" &&
              dragRef.current === null,
          );
        }
        if (route.lastError) setStatus(route.lastError);
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          // Route state is auxiliary to video/input controls, so keep the last
          // good snapshot and retry rather than surfacing transient poll noise.
        }
      } finally {
        if (routePollAbortRef.current === controller) {
          routePollAbortRef.current = null;
        }
        controller = null;
        if (!cancelled) timer = setTimeout(syncRoute, 1_000);
      }
    };
    void syncRoute();
    return () => {
      cancelled = true;
      controller?.abort();
      if (routePollAbortRef.current === controller) {
        routePollAbortRef.current = null;
      }
      if (timer) clearTimeout(timer);
    };
  }, [followRoute, syncDraft]);

  const centerPixel = useMemo(
    () => projectLocation(center, zoom),
    [center, zoom],
  );
  const draftPixel = useMemo(
    () => projectLocation(draft, zoom),
    [draft, zoom],
  );

  const tiles = useMemo<Tile[]>(() => {
    const maxTile = 2 ** zoom - 1;
    const leftWorld = centerPixel.x - size.width / 2;
    const topWorld = centerPixel.y - size.height / 2;
    const startX = Math.floor(leftWorld / TILE_SIZE) - TILE_OVERSCAN;
    const endX =
      Math.floor((leftWorld + size.width) / TILE_SIZE) + TILE_OVERSCAN;
    const startY = clamp(
      Math.floor(topWorld / TILE_SIZE) - TILE_OVERSCAN,
      0,
      maxTile,
    );
    const endY = clamp(
      Math.floor((topWorld + size.height) / TILE_SIZE) + TILE_OVERSCAN,
      0,
      maxTile,
    );
    const out: Tile[] = [];
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        out.push({
          key: `${zoom}-${x}-${y}`,
          x,
          y,
          wrappedX: normalizedTileX(x, zoom),
          left: x * TILE_SIZE - leftWorld,
          top: y * TILE_SIZE - topWorld,
        });
      }
    }
    return out;
  }, [centerPixel, size.height, size.width, zoom]);

  const locationFromClient = (clientX: number, clientY: number): LocationPoint | null => {
    const node = mapRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return unprojectLocation(
      {
        x: centerPixel.x + clientX - rect.left - rect.width / 2,
        y: centerPixel.y + clientY - rect.top - rect.height / 2,
      },
      zoom,
    );
  };

  const markerWorldX = nearestWrappedWorldX(
    draftPixel.x,
    centerPixel.x,
    worldSizeAtZoom(zoom),
  );
  const markerLeft = markerWorldX - centerPixel.x + size.width / 2;
  const markerTop = draftPixel.y - centerPixel.y + size.height / 2;

  useLayoutEffect(() => {
    if (!dragRef.current && mapWorldRef.current) {
      mapWorldRef.current.style.transform = "";
    }
  }, [centerPixel.x, centerPixel.y]);

  useEffect(() => {
    return () => {
      if (dragFrameRef.current) {
        cancelAnimationFrame(dragFrameRef.current);
      }
      routeRequestRef.current += 1;
      routeWorkerRef.current?.terminate();
      routeWorkerRef.current = null;
    };
  }, []);
  const displayRoute = useMemo(
    () => routePoints.length > 0
      ? routeProjectionCache.get(routePoints, routePoints, zoom)
      : null,
    [routePoints, routeProjectionCache, zoom],
  );
  const displayTransform = useMemo(
    () => displayRoute
      ? routeViewportTransform(displayRoute, centerPixel, size)
      : null,
    [centerPixel, displayRoute, size],
  );
  const progress =
    routeStatus && routeStatus.totalMeters > 0
      ? Math.min(100, Math.round((routeStatus.progressMeters / routeStatus.totalMeters) * 100))
      : 0;

  const applyLocation = async (location = draft) => {
    setStatus("Setting...");
    try {
      const res = await fetch("/api/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude: location.latitude,
          longitude: location.longitude,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "location update failed");
      setStatus(`Applied ${formatCoord(location.latitude)}, ${formatCoord(location.longitude)}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const applyText = () => {
    const latitude = Number(latText);
    const longitude = Number(lngText);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setStatus("Coordinates must be numbers");
      return;
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      setStatus("Coordinates are out of range");
      return;
    }
    const next = { latitude, longitude };
    syncDraft(next, true);
    void applyLocation(next);
  };

  const cancelRouteFile = () => {
    routeRequestRef.current += 1;
    routeWorkerRef.current?.terminate();
    routeWorkerRef.current = null;
    setRouteParsing(false);
    setStatus("Route load cancelled");
    if (fileRef.current) fileRef.current.value = "";
  };

  const readRouteFile = (file: File) => {
    const requestId = ++routeRequestRef.current;
    routeWorkerRef.current?.terminate();
    routeWorkerRef.current = null;
    setRouteParsing(false);

    // This check intentionally runs before the File crosses the worker
    // boundary; the worker repeats it before calling File.text().
    if (file.size > DEFAULT_MAX_ROUTE_FILE_BYTES) {
      setStatus(
        `Route file exceeds ${formatMegabytes(DEFAULT_MAX_ROUTE_FILE_BYTES)}`,
      );
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (typeof Worker !== "function") {
      setStatus("Route parsing requires Web Worker support");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    setRouteParsing(true);
    setStatus(`Loading ${file.name} in worker...`);
    let worker: Worker;
    try {
      worker = new Worker(
        new URL("../lib/route-parser-worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch (error) {
      setRouteParsing(false);
      setStatus(error instanceof Error ? error.message : "Worker start failed");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    routeWorkerRef.current = worker;

    const finish = () => {
      if (routeWorkerRef.current === worker) {
        routeWorkerRef.current = null;
      }
      worker.terminate();
      setRouteParsing(false);
    };
    worker.addEventListener(
      "message",
      (event: MessageEvent<RouteParserWorkerResponse>) => {
        const message = event.data;
        if (
          requestId !== routeRequestRef.current ||
          message.requestId !== requestId ||
          routeWorkerRef.current !== worker
        ) {
          return;
        }
        if (message.type === "accepted") {
          setStatus(`Reading ${message.fileName}...`);
        } else if (message.type === "progress") {
          setStatus(
            message.stage === "reading"
              ? `Reading route ${message.bytesRead === message.totalBytes ? "100%" : "..."}`
              : `Parsing route... ${message.waypoints} waypoints`,
          );
        } else if (message.type === "result") {
          const points = message.result.points;
          routeProjectionCache.clear();
          setRoutePoints(points);
          syncDraft(points[0]!, true);
          setStatus(
            `Loaded ${points.length} ${message.result.format.toUpperCase()} waypoints`,
          );
          finish();
        } else if (message.type === "error") {
          setStatus(message.error.message);
          finish();
        } else if (message.type === "cancelled") {
          setStatus("Route load cancelled");
          finish();
        }
      },
    );
    worker.addEventListener("error", (event) => {
      if (
        requestId !== routeRequestRef.current ||
        routeWorkerRef.current !== worker
      ) {
        return;
      }
      event.preventDefault();
      setStatus(event.message || "Route worker failed");
      finish();
    });
    worker.addEventListener("messageerror", () => {
      if (
        requestId !== routeRequestRef.current ||
        routeWorkerRef.current !== worker
      ) {
        return;
      }
      setStatus("Route worker response could not be decoded");
      finish();
    });
    const command: RouteParserWorkerCommand = {
      type: "parse",
      requestId,
      file,
    };
    try {
      worker.postMessage(command);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Route file could not be sent",
      );
      finish();
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const startRoute = async () => {
    if (routePoints.length < 1) {
      setStatus("Load a route first");
      return;
    }
    const speed = Number(speedKph);
    const rate = Number(multiplier);
    if (!Number.isFinite(speed) || speed <= 0) {
      setStatus("Speed must be positive");
      return;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      setStatus("Rate must be positive");
      return;
    }
    beginRouteMutation();
    setStatus("Starting route...");
    try {
      const res = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waypoints: routePoints,
          speedKph: speed,
          multiplier: rate,
          intervalMs: 1000,
          loop,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; route?: RouteSnapshot };
      if (!res.ok || !data.ok || !data.route) throw new Error(data.error || "route start failed");
      setRouteStatus(data.route);
      setStatus("Route running");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      endRouteMutation();
    }
  };

  const controlRoute = async (action: "pause" | "resume" | "stop") => {
    beginRouteMutation();
    try {
      const res = await fetch("/api/route/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; route?: RouteSnapshot };
      if (!res.ok || !data.ok || !data.route) throw new Error(data.error || "route control failed");
      setRouteStatus(data.route);
      setStatus(action === "stop" ? "Route stopped" : `Route ${data.route.status}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      endRouteMutation();
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (dragRef.current) return;
    e.preventDefault();
    mapRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      center: centerPixel,
      zoom,
      dx: 0,
      dy: 0,
      moved: false,
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const coalesced = typeof e.nativeEvent.getCoalescedEvents === "function"
      ? e.nativeEvent.getCoalescedEvents()
      : [];
    const latest = coalesced[coalesced.length - 1] ?? e;
    drag.dx = latest.clientX - drag.start.x;
    drag.dy = latest.clientY - drag.start.y;
    if (Math.abs(drag.dx) + Math.abs(drag.dy) > 4 && !drag.moved) {
      drag.moved = true;
    }
    if (!drag.moved) return;
    if (!dragFrameRef.current) {
      dragFrameRef.current = requestAnimationFrame(() => {
        dragFrameRef.current = 0;
        const active = dragRef.current;
        if (!active || !mapWorldRef.current) return;
        setFollowRoute(false);
        mapWorldRef.current.style.transform =
          `translate3d(${active.dx}px, ${active.dy}px, 0)`;
      });
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.dx = e.clientX - drag.start.x;
    drag.dy = e.clientY - drag.start.y;
    if (Math.abs(drag.dx) + Math.abs(drag.dy) > 4) drag.moved = true;
    if (drag.moved) setFollowRoute(false);
    dragRef.current = null;
    if (dragFrameRef.current) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = 0;
    }
    try {
      mapRef.current?.releasePointerCapture(e.pointerId);
    } catch {}
    if (drag.moved) {
      if (mapWorldRef.current) mapWorldRef.current.style.transform = "";
      setCenter(
        unprojectLocation(
          { x: drag.center.x - drag.dx, y: drag.center.y - drag.dy },
          drag.zoom,
        ),
      );
      return;
    }
    const next = locationFromClient(e.clientX, e.clientY);
    if (next) syncDraft(next);
  };

  const cancelPointer = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    if (dragFrameRef.current) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = 0;
    }
    if (mapWorldRef.current) mapWorldRef.current.style.transform = "";
  };

  return (
    <aside className="location-panel">
      <div className="panel-heading">
        <h2>Location</h2>
        <div className="location-status">{status}</div>
      </div>
      <div
        className="map"
        ref={mapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={cancelPointer}
        onLostPointerCapture={cancelPointer}
      >
        <div className="map-world" ref={mapWorldRef}>
          {tiles.map((tile) => (
            <img
              alt=""
              className="map-tile"
              decoding="async"
              draggable={false}
              key={tile.key}
              loading="lazy"
              src={tileUrl(tile, zoom)}
              style={{
                left: tile.left,
                top: tile.top,
              }}
            />
          ))}
          {displayRoute && displayTransform && (
            <svg
              className="route-overlay"
              viewBox={`0 0 ${size.width} ${size.height}`}
            >
              <polyline
                points={displayRoute.svgPoints}
                transform={
                  `translate(${displayTransform.translateX} ${displayTransform.translateY})`
                }
              />
            </svg>
          )}
          <div
            className="map-marker"
            style={{
              transform: `translate(${markerLeft}px, ${markerTop}px)`,
            }}
          />
        </div>
        <div className="map-attribution">© OpenStreetMap</div>
      </div>
      <div className="map-controls">
        <button onClick={() => setZoom((z) => clamp(z + 1, MIN_ZOOM, MAX_ZOOM))}>+</button>
        <button onClick={() => setZoom((z) => clamp(z - 1, MIN_ZOOM, MAX_ZOOM))}>-</button>
        <button onClick={() => setCenter(draft)}>Center</button>
      </div>
      <div className="coordinate-grid">
        <label>
          Lat
          <input
            inputMode="decimal"
            onChange={(e) => setLatText(e.currentTarget.value)}
            value={latText}
          />
        </label>
        <label>
          Lng
          <input
            inputMode="decimal"
            onChange={(e) => setLngText(e.currentTarget.value)}
            value={lngText}
          />
        </label>
      </div>
      <div className="preset-row">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => {
              syncDraft(preset, true);
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <button className="primary-action" onClick={applyText}>
        Set Location
      </button>
      <section className="route-panel">
        <div className="panel-heading">
          <h2>Route</h2>
          <div className="location-status">{routeStatus?.status ?? "idle"} {progress}%</div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".gpx,.geojson,.json,.kml,application/json,application/geo+json"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file) void readRouteFile(file);
          }}
        />
        <button disabled={!routeParsing} onClick={cancelRouteFile}>
          Cancel load
        </button>
        <div className="route-meta">
          {routePoints.length} pts
          {displayRoute && displayRoute.points.length < routePoints.length
            ? ` • ${displayRoute.points.length} drawn`
            : ""}
          {routeStatus ? ` • ${formatDistance(routeStatus.progressMeters)} / ${formatDistance(routeStatus.totalMeters)}` : ""}
        </div>
        <div className="coordinate-grid">
          <label>
            km/h
            <input
              inputMode="decimal"
              onChange={(e) => setSpeedKph(e.currentTarget.value)}
              value={speedKph}
            />
          </label>
          <label>
            Rate
            <input
              inputMode="decimal"
              onChange={(e) => setMultiplier(e.currentTarget.value)}
              value={multiplier}
            />
          </label>
        </div>
        <label className="toggle-row">
          <input
            checked={loop}
            onChange={(e) => setLoop(e.currentTarget.checked)}
            type="checkbox"
          />
          Loop
        </label>
        <label className="toggle-row">
          <input
            checked={followRoute}
            onChange={(e) => {
              const follow = e.currentTarget.checked;
              setFollowRoute(follow);
              if (follow) {
                setCenter(routeStatus?.currentLocation ?? draft);
              }
            }}
            type="checkbox"
          />
          Follow route (panning turns this off)
        </label>
        <div className="route-actions">
          <button onClick={startRoute}>Play</button>
          <button
            onClick={() => {
              void controlRoute(routeStatus?.status === "paused" ? "resume" : "pause");
            }}
          >
            {routeStatus?.status === "paused" ? "Resume" : "Pause"}
          </button>
          <button
            onClick={() => {
              void controlRoute("stop");
            }}
          >
            Stop
          </button>
        </div>
      </section>
    </aside>
  );
}
