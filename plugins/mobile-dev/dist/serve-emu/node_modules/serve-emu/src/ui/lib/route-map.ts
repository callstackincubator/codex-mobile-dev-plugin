export type LocationPoint = {
  latitude: number;
  longitude: number;
  altitude?: number;
};

export type WorldPoint = {
  x: number;
  y: number;
};

export type ViewportSize = {
  width: number;
  height: number;
};

export type ProjectedRoutePoint = WorldPoint & {
  sourceIndex: number;
};

export type ProjectedDisplayRoute = {
  zoom: number;
  worldSize: number;
  sourcePointCount: number;
  points: readonly ProjectedRoutePoint[];
  svgPoints: string;
  anchorX: number;
  requestedTolerancePx: number;
  maxErrorPx: number;
  simplified: boolean;
  capped: boolean;
};

export type ProjectLocation = (location: LocationPoint, zoom: number) => WorldPoint;

export type DisplayRouteOptions = {
  /** Maximum screen-space error, in CSS pixels, before the hard point cap applies. */
  pixelTolerance?: number;
  /** Maximum number of coordinates retained in the display-only polyline. */
  maxDisplayPoints?: number;
  /** Primarily useful for profiling and deterministic tests. */
  project?: ProjectLocation;
};

export type RouteViewportTransform = {
  translateX: number;
  translateY: number;
};

export type RouteIdentity = string | number | symbol | object;

export type RouteProjectionCacheStats = {
  entries: number;
  hits: number;
  misses: number;
  projectedSourcePoints: number;
};

export const MAP_TILE_SIZE = 256;
export const WEB_MERCATOR_MAX_LATITUDE = 85.05112878;
export const DEFAULT_ROUTE_PIXEL_TOLERANCE = 0.75;
export const DEFAULT_MAX_DISPLAY_POINTS = 1_024;

const MAX_WEB_MERCATOR_ZOOM = 24;

type NormalizedDisplayRouteOptions = {
  pixelTolerance: number;
  maxDisplayPoints: number;
};

type Segment = {
  start: number;
  end: number;
  farthest: number;
  distanceSquared: number;
};

type CacheEntry = {
  routeIdentity: RouteIdentity;
  optionKey: string;
  route: ProjectedDisplayRoute;
  lastUsed: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function assertZoom(zoom: number): void {
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > MAX_WEB_MERCATOR_ZOOM) {
    throw new Error(`zoom must be an integer between 0 and ${MAX_WEB_MERCATOR_ZOOM}`);
  }
}

function normalizeOptions(options: DisplayRouteOptions = {}): NormalizedDisplayRouteOptions {
  const pixelTolerance = options.pixelTolerance ?? DEFAULT_ROUTE_PIXEL_TOLERANCE;
  const maxDisplayPoints = options.maxDisplayPoints ?? DEFAULT_MAX_DISPLAY_POINTS;

  if (!Number.isFinite(pixelTolerance) || pixelTolerance < 0) {
    throw new Error("pixelTolerance must be a finite non-negative number");
  }
  if (!Number.isSafeInteger(maxDisplayPoints) || maxDisplayPoints < 2) {
    throw new Error("maxDisplayPoints must be a safe integer of at least 2");
  }

  return { pixelTolerance, maxDisplayPoints };
}

export function worldSizeAtZoom(zoom: number): number {
  assertZoom(zoom);
  return MAP_TILE_SIZE * 2 ** zoom;
}

export function wrapLongitude(longitude: number): number {
  if (!Number.isFinite(longitude)) throw new Error("longitude must be finite");
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

/** Returns the wrapped world copy nearest a reference x coordinate. */
export function nearestWrappedWorldX(
  x: number,
  referenceX: number,
  worldSize: number,
): number {
  if (!Number.isFinite(x) || !Number.isFinite(referenceX)) {
    throw new Error("world x coordinates must be finite");
  }
  if (!Number.isFinite(worldSize) || worldSize <= 0) {
    throw new Error("worldSize must be a finite positive number");
  }
  return x + Math.round((referenceX - x) / worldSize) * worldSize;
}

export function projectLocation(location: LocationPoint, zoom: number): WorldPoint {
  if (!Number.isFinite(location.latitude)) throw new Error("latitude must be finite");
  const longitude = wrapLongitude(location.longitude);
  const latitude = clamp(
    location.latitude,
    -WEB_MERCATOR_MAX_LATITUDE,
    WEB_MERCATOR_MAX_LATITUDE,
  );
  const sinLatitude = Math.sin((latitude * Math.PI) / 180);
  const size = worldSizeAtZoom(zoom);
  return {
    x: ((longitude + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * size,
  };
}

export function unprojectLocation(point: WorldPoint, zoom: number): LocationPoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error("projected point coordinates must be finite");
  }
  const size = worldSizeAtZoom(zoom);
  const longitude = (point.x / size) * 360 - 180;
  const mercatorY = Math.PI - (2 * Math.PI * point.y) / size;
  return {
    latitude: clamp(
      (180 / Math.PI) * Math.atan(Math.sinh(mercatorY)),
      -WEB_MERCATOR_MAX_LATITUDE,
      WEB_MERCATOR_MAX_LATITUDE,
    ),
    longitude: wrapLongitude(longitude),
  };
}

function pointToSegmentDistanceSquared(
  point: WorldPoint,
  start: WorldPoint,
  end: WorldPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    const pointDx = point.x - start.x;
    const pointDy = point.y - start.y;
    return pointDx * pointDx + pointDy * pointDy;
  }

  const projection = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy),
    0,
    1,
  );
  const projectedX = start.x + projection * dx;
  const projectedY = start.y + projection * dy;
  const pointDx = point.x - projectedX;
  const pointDy = point.y - projectedY;
  return pointDx * pointDx + pointDy * pointDy;
}

function segmentFor(
  points: readonly ProjectedRoutePoint[],
  start: number,
  end: number,
): Segment | null {
  if (end - start < 2) return null;

  let farthest = start + 1;
  let distanceSquared = -1;
  for (let index = start + 1; index < end; index += 1) {
    const candidate = pointToSegmentDistanceSquared(points[index]!, points[start]!, points[end]!);
    if (candidate > distanceSquared) {
      distanceSquared = candidate;
      farthest = index;
    }
  }
  return { start, end, farthest, distanceSquared };
}

function segmentHasHigherPriority(left: Segment, right: Segment): boolean {
  if (left.distanceSquared !== right.distanceSquared) {
    return left.distanceSquared > right.distanceSquared;
  }
  if (left.start !== right.start) return left.start < right.start;
  return left.end < right.end;
}

class SegmentHeap {
  readonly #segments: Segment[] = [];

  peek(): Segment | undefined {
    return this.#segments[0];
  }

  push(segment: Segment | null): void {
    if (!segment) return;
    const segments = this.#segments;
    segments.push(segment);
    let index = segments.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!segmentHasHigherPriority(segments[index]!, segments[parent]!)) break;
      [segments[index], segments[parent]] = [segments[parent]!, segments[index]!];
      index = parent;
    }
  }

  pop(): Segment | undefined {
    const segments = this.#segments;
    const first = segments[0];
    const last = segments.pop();
    if (!first || segments.length === 0) return first;
    segments[0] = last!;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let highest = index;
      if (left < segments.length && segmentHasHigherPriority(segments[left]!, segments[highest]!)) {
        highest = left;
      }
      if (right < segments.length && segmentHasHigherPriority(segments[right]!, segments[highest]!)) {
        highest = right;
      }
      if (highest === index) break;
      [segments[index], segments[highest]] = [segments[highest]!, segments[index]!];
      index = highest;
    }
    return first;
  }
}

function projectRoutePoints(
  sourcePoints: readonly LocationPoint[],
  zoom: number,
  project: ProjectLocation,
): { points: ProjectedRoutePoint[]; anchorX: number } {
  const size = worldSizeAtZoom(zoom);
  const points: ProjectedRoutePoint[] = [];
  let previousX: number | undefined;
  let minimumX = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;

  for (let sourceIndex = 0; sourceIndex < sourcePoints.length; sourceIndex += 1) {
    const projected = project(sourcePoints[sourceIndex]!, zoom);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
      throw new Error(`route projection returned a non-finite coordinate at index ${sourceIndex}`);
    }

    // Use the nearest copy of the wrapped world to the previous waypoint. A route
    // from +179° to -179° therefore crosses two degrees, not the whole map.
    const x = previousX === undefined
      ? projected.x
      : nearestWrappedWorldX(projected.x, previousX, size);
    points.push({ x, y: projected.y, sourceIndex });
    previousX = x;
    minimumX = Math.min(minimumX, x);
    maximumX = Math.max(maximumX, x);
  }

  return {
    points,
    anchorX: points.length === 0 ? 0 : (minimumX + maximumX) / 2,
  };
}

function simplifyProjectedPoints(
  points: readonly ProjectedRoutePoint[],
  pixelTolerance: number,
  maxDisplayPoints: number,
): { points: ProjectedRoutePoint[]; maxErrorPx: number; capped: boolean } {
  if (points.length <= 1) {
    return { points: points.slice(), maxErrorPx: 0, capped: false };
  }

  const selected = new Uint8Array(points.length);
  selected[0] = 1;
  selected[points.length - 1] = 1;
  let selectedCount = 2;
  const heap = new SegmentHeap();
  heap.push(segmentFor(points, 0, points.length - 1));
  const toleranceSquared = pixelTolerance * pixelTolerance;

  // This is iterative, best-first Douglas-Peucker. When the hard cap is reached,
  // the globally largest remaining screen-space error is retained in maxErrorPx.
  while (
    selectedCount < maxDisplayPoints &&
    heap.peek() !== undefined &&
    heap.peek()!.distanceSquared > toleranceSquared
  ) {
    const segment = heap.pop()!;
    selected[segment.farthest] = 1;
    selectedCount += 1;
    heap.push(segmentFor(points, segment.start, segment.farthest));
    heap.push(segmentFor(points, segment.farthest, segment.end));
  }

  const remainingErrorSquared = heap.peek()?.distanceSquared ?? 0;
  const simplified: ProjectedRoutePoint[] = [];
  for (let index = 0; index < points.length; index += 1) {
    if (selected[index]) simplified.push(points[index]!);
  }
  return {
    points: simplified,
    maxErrorPx: Math.sqrt(Math.max(0, remainingErrorSquared)),
    capped: selectedCount >= maxDisplayPoints && remainingErrorSquared > toleranceSquared,
  };
}

/**
 * Produces display-only projected coordinates. The input sequence is never
 * mutated or truncated, so callers can retain it unchanged for route playback.
 */
export function simplifyRouteForDisplay(
  sourcePoints: readonly LocationPoint[],
  zoom: number,
  options: DisplayRouteOptions = {},
): ProjectedDisplayRoute {
  assertZoom(zoom);
  const normalized = normalizeOptions(options);
  const projected = projectRoutePoints(sourcePoints, zoom, options.project ?? projectLocation);
  const simplified = simplifyProjectedPoints(
    projected.points,
    normalized.pixelTolerance,
    normalized.maxDisplayPoints,
  );
  const displayPoints = simplified.points.map((point) => ({ ...point }));

  return {
    zoom,
    worldSize: worldSizeAtZoom(zoom),
    sourcePointCount: sourcePoints.length,
    points: displayPoints,
    svgPoints: displayPoints.map((point) => `${point.x},${point.y}`).join(" "),
    anchorX: projected.anchorX,
    requestedTolerancePx: normalized.pixelTolerance,
    maxErrorPx: simplified.maxErrorPx,
    simplified: displayPoints.length < sourcePoints.length,
    capped: simplified.capped,
  };
}

/**
 * Computes the only values that need to change while panning. Apply the result
 * as an SVG group/polyline translation around the cached route.svgPoints.
 */
export function routeViewportTransform(
  route: ProjectedDisplayRoute,
  centerWorld: WorldPoint,
  viewport: ViewportSize,
): RouteViewportTransform {
  if (!Number.isFinite(centerWorld.x) || !Number.isFinite(centerWorld.y)) {
    throw new Error("centerWorld coordinates must be finite");
  }
  if (!Number.isFinite(viewport.width) || viewport.width <= 0) {
    throw new Error("viewport width must be a finite positive number");
  }
  if (!Number.isFinite(viewport.height) || viewport.height <= 0) {
    throw new Error("viewport height must be a finite positive number");
  }

  const wrappedWorldOffset =
    Math.round((centerWorld.x - route.anchorX) / route.worldSize) * route.worldSize;
  return {
    translateX: wrappedWorldOffset + viewport.width / 2 - centerWorld.x,
    translateY: viewport.height / 2 - centerWorld.y,
  };
}

export class RouteProjectionCache {
  readonly #maxEntries: number;
  readonly #project: ProjectLocation;
  readonly #buckets = new Map<RouteIdentity, Map<string, CacheEntry>>();
  #entryCount = 0;
  #clock = 0;
  #hits = 0;
  #misses = 0;
  #projectedSourcePoints = 0;

  constructor(options: { maxEntries?: number; project?: ProjectLocation } = {}) {
    const maxEntries = options.maxEntries ?? 8;
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new Error("maxEntries must be a positive safe integer");
    }
    this.#maxEntries = maxEntries;
    this.#project = options.project ?? projectLocation;
  }

  get(
    routeIdentity: RouteIdentity,
    sourcePoints: readonly LocationPoint[],
    zoom: number,
    options: Omit<DisplayRouteOptions, "project"> = {},
  ): ProjectedDisplayRoute {
    assertZoom(zoom);
    const normalized = normalizeOptions(options);
    const optionKey = `${zoom}:${normalized.pixelTolerance}:${normalized.maxDisplayPoints}`;
    const existing = this.#buckets.get(routeIdentity)?.get(optionKey);
    if (existing) {
      existing.lastUsed = ++this.#clock;
      this.#hits += 1;
      return existing.route;
    }

    this.#misses += 1;
    const route = simplifyRouteForDisplay(sourcePoints, zoom, {
      ...normalized,
      project: this.#project,
    });
    this.#projectedSourcePoints += sourcePoints.length;
    let bucket = this.#buckets.get(routeIdentity);
    if (!bucket) {
      bucket = new Map();
      this.#buckets.set(routeIdentity, bucket);
    }
    bucket.set(optionKey, {
      routeIdentity,
      optionKey,
      route,
      lastUsed: ++this.#clock,
    });
    this.#entryCount += 1;
    this.#evictLeastRecentlyUsed();
    return route;
  }

  delete(routeIdentity: RouteIdentity): boolean {
    const bucket = this.#buckets.get(routeIdentity);
    if (!bucket) return false;
    this.#entryCount -= bucket.size;
    return this.#buckets.delete(routeIdentity);
  }

  clear(): void {
    this.#buckets.clear();
    this.#entryCount = 0;
  }

  stats(): RouteProjectionCacheStats {
    return {
      entries: this.#entryCount,
      hits: this.#hits,
      misses: this.#misses,
      projectedSourcePoints: this.#projectedSourcePoints,
    };
  }

  #evictLeastRecentlyUsed(): void {
    while (this.#entryCount > this.#maxEntries) {
      let oldest: CacheEntry | undefined;
      for (const bucket of this.#buckets.values()) {
        for (const entry of bucket.values()) {
          if (!oldest || entry.lastUsed < oldest.lastUsed) oldest = entry;
        }
      }
      if (!oldest) return;
      const bucket = this.#buckets.get(oldest.routeIdentity)!;
      bucket.delete(oldest.optionKey);
      this.#entryCount -= 1;
      if (bucket.size === 0) this.#buckets.delete(oldest.routeIdentity);
    }
  }
}
