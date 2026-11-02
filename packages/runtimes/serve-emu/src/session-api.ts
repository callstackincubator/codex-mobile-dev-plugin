export const DEFAULT_SESSION_PAGE_LIMIT = 50;
export const MAX_SESSION_PAGE_LIMIT = 200;

function positiveSafeInteger(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

export function parseSessionPageQuery(
  searchParams: URLSearchParams,
): { limit: number; before?: number } {
  const rawLimit = searchParams.get("limit");
  const limit = rawLimit === null
    ? DEFAULT_SESSION_PAGE_LIMIT
    : positiveSafeInteger(rawLimit, "limit");
  if (limit > MAX_SESSION_PAGE_LIMIT) {
    throw new Error(`limit must be at most ${MAX_SESSION_PAGE_LIMIT}`);
  }

  const rawBefore = searchParams.get("before");
  return rawBefore === null
    ? { limit }
    : { limit, before: positiveSafeInteger(rawBefore, "before") };
}
