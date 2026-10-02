export type AccessibilityBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type AccessibilityHitTarget = {
  id: string;
  bounds: AccessibilityBounds;
};

export type AccessibilityViewport = {
  width: number;
  height: number;
};

export type NormalizedPoint = {
  x: number;
  y: number;
};

/**
 * Finds the most specific accessibility node containing a normalized point.
 * The single minimum-area scan intentionally avoids allocating and sorting a
 * match array on the pointer-move hot path.
 */
export function findAccessibilityNodeAt<T extends AccessibilityHitTarget>(
  nodes: readonly T[],
  point: NormalizedPoint,
  viewport: AccessibilityViewport,
): T | null {
  const x = point.x * viewport.width;
  const y = point.y * viewport.height;
  let best: T | null = null;
  let bestArea = Number.POSITIVE_INFINITY;

  for (const node of nodes) {
    const bounds = node.bounds;
    if (
      x < bounds.left ||
      x > bounds.right ||
      y < bounds.top ||
      y > bounds.bottom
    ) {
      continue;
    }

    const area = (bounds.right - bounds.left) * (bounds.bottom - bounds.top);
    if (area < bestArea) {
      best = node;
      bestArea = area;
    }
  }

  return best;
}

export function measureAccessibilityViewport(
  nodes: readonly AccessibilityHitTarget[],
  fallback: AccessibilityViewport | null,
): AccessibilityViewport | null {
  if (nodes.length === 0) return fallback;

  let width = fallback?.width ?? 1;
  let height = fallback?.height ?? 1;
  for (const node of nodes) {
    width = Math.max(width, node.bounds.right);
    height = Math.max(height, node.bounds.bottom);
  }
  return { width, height };
}

type AnimationFrameRequest = (callback: (timestamp: number) => void) => number;
type AnimationFrameCancel = (handle: number) => void;

export type LatestAnimationFrameScheduler<T> = {
  schedule(value: T): void;
  flush(): void;
  cancel(): void;
  hasPending(): boolean;
};

/**
 * Coalesces any number of values into one callback per animation frame and
 * always delivers the latest value. Dependencies are injectable so the
 * scheduling contract can be verified without a browser.
 */
export function createLatestAnimationFrameScheduler<T>(
  handle: (value: T) => void,
  requestFrame: AnimationFrameRequest = requestAnimationFrame,
  cancelFrame: AnimationFrameCancel = cancelAnimationFrame,
): LatestAnimationFrameScheduler<T> {
  let frameHandle: number | null = null;
  let hasLatest = false;
  let latest: T;

  const deliver = () => {
    frameHandle = null;
    if (!hasLatest) return;
    const value = latest;
    hasLatest = false;
    handle(value);
  };

  return {
    schedule(value) {
      latest = value;
      hasLatest = true;
      if (frameHandle === null) frameHandle = requestFrame(deliver);
    },
    flush() {
      if (frameHandle !== null) {
        cancelFrame(frameHandle);
        frameHandle = null;
      }
      deliver();
    },
    cancel() {
      if (frameHandle !== null) cancelFrame(frameHandle);
      frameHandle = null;
      hasLatest = false;
    },
    hasPending() {
      return hasLatest;
    },
  };
}
