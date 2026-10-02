export type FixedVirtualRange = {
  start: number;
  end: number;
  totalHeight: number;
};

type FixedVirtualRangeOptions = {
  itemCount: number;
  scrollTop: number;
  rowHeight: number;
  viewportHeight: number;
  overscan: number;
};

export type FixedVirtualNavigationKey =
  | "ArrowDown"
  | "ArrowUp"
  | "Home"
  | "End"
  | "PageDown"
  | "PageUp";

/**
 * Returns the half-open item range needed for a fixed-height scroll viewport.
 * Runtime work is constant regardless of the total number of items.
 */
export function getFixedVirtualRange({
  itemCount,
  scrollTop,
  rowHeight,
  viewportHeight,
  overscan,
}: FixedVirtualRangeOptions): FixedVirtualRange {
  const count = Math.max(0, Math.floor(itemCount));
  if (count === 0) return { start: 0, end: 0, totalHeight: 0 };
  if (rowHeight <= 0 || viewportHeight <= 0) {
    throw new RangeError("rowHeight and viewportHeight must be positive");
  }

  const totalHeight = count * rowHeight;
  const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
  const normalizedScrollTop = Number.isNaN(scrollTop) ? 0 : scrollTop;
  const boundedScrollTop = Math.min(maxScrollTop, Math.max(0, normalizedScrollTop));
  const firstVisible = Math.floor(boundedScrollTop / rowHeight);
  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  const extra = Math.max(0, Math.floor(overscan));

  return {
    start: Math.max(0, firstVisible - extra),
    end: Math.min(count, firstVisible + visibleCount + extra),
    totalHeight,
  };
}

export function getFixedNavigationIndex(
  key: string,
  currentIndex: number,
  itemCount: number,
  pageSize: number,
): number | null {
  const count = Math.max(0, Math.floor(itemCount));
  if (count === 0) return null;
  const current = Math.min(count - 1, Math.max(0, Math.floor(currentIndex)));
  const page = Math.max(1, Math.floor(pageSize));
  let next: number;

  switch (key as FixedVirtualNavigationKey) {
    case "ArrowDown":
      next = current + 1;
      break;
    case "ArrowUp":
      next = current - 1;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = count - 1;
      break;
    case "PageDown":
      next = current + page;
      break;
    case "PageUp":
      next = current - page;
      break;
    default:
      return null;
  }

  return Math.min(count - 1, Math.max(0, next));
}

type FixedScrollForIndexOptions = {
  index: number;
  itemCount: number;
  scrollTop: number;
  rowHeight: number;
  viewportHeight: number;
};

export function getFixedScrollTopForIndex({
  index,
  itemCount,
  scrollTop,
  rowHeight,
  viewportHeight,
}: FixedScrollForIndexOptions): number {
  const count = Math.max(0, Math.floor(itemCount));
  if (count === 0) return 0;
  if (rowHeight <= 0 || viewportHeight <= 0) {
    throw new RangeError("rowHeight and viewportHeight must be positive");
  }

  const boundedIndex = Math.min(count - 1, Math.max(0, Math.floor(index)));
  const maxScrollTop = Math.max(0, count * rowHeight - viewportHeight);
  const current = Math.min(
    maxScrollTop,
    Math.max(0, Number.isNaN(scrollTop) ? 0 : scrollTop),
  );
  const rowTop = boundedIndex * rowHeight;
  const rowBottom = rowTop + rowHeight;

  if (rowTop < current) return rowTop;
  if (rowBottom > current + viewportHeight) {
    return Math.min(maxScrollTop, rowBottom - viewportHeight);
  }
  return current;
}

type FixedRovingIndexOptions = Omit<FixedScrollForIndexOptions, "index"> & {
  preferredIndex: number;
};

export function getFixedRovingIndex({
  preferredIndex,
  itemCount,
  scrollTop,
  rowHeight,
  viewportHeight,
}: FixedRovingIndexOptions): number {
  const count = Math.max(0, Math.floor(itemCount));
  if (count === 0) return -1;
  if (rowHeight <= 0 || viewportHeight <= 0) {
    throw new RangeError("rowHeight and viewportHeight must be positive");
  }

  const maxScrollTop = Math.max(0, count * rowHeight - viewportHeight);
  const current = Math.min(
    maxScrollTop,
    Math.max(0, Number.isNaN(scrollTop) ? 0 : scrollTop),
  );
  const firstVisible = Math.min(count - 1, Math.floor(current / rowHeight));
  const lastVisible = Math.min(
    count - 1,
    Math.max(firstVisible, Math.ceil((current + viewportHeight) / rowHeight) - 1),
  );
  const preferred = Math.min(count - 1, Math.max(0, Math.floor(preferredIndex)));

  return preferred >= firstVisible && preferred <= lastVisible ? preferred : firstVisible;
}
