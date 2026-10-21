/**
 * Validates the arrival judge's raw JSON response into an `ArrivalVerdict`.
 *
 * Extracted verbatim from the inline check `verifyCurrentTarget` used to run in `orchestrator.ts`
 * (formerly around orchestrator.ts:893-907) — the shape and the rules are unchanged, only pulled out
 * so a strategy under `reach/` can validate a judge response without importing anything from
 * `orchestrator.ts`. No device or Electron import here — see `reach/types.ts`'s doc comment.
 */
import type { ArrivalVerdict } from './types.ts'

/**
 * `value` is whatever `parseSubAgentJson` found in the model's response — untyped, possibly missing
 * fields, possibly the wrong shape entirely if the model ignored the schema. Returns null rather
 * than throwing so a caller can retry (the arrival judge is allowed two attempts specifically to
 * absorb one malformed response) instead of a single bad reply ending the whole attempt.
 */
export function parseArrivalVerdict(value: unknown): ArrivalVerdict | null {
  if (!value || typeof value !== 'object') return null
  const parsed = value as Record<string, unknown>
  if (
    ['match', 'mismatch', 'uncertain'].includes(String(parsed.verdict)) &&
    (parsed.status === null ||
      parsed.status === 'ok' ||
      parsed.status === 'empty-state' ||
      parsed.status === 'not-found') &&
    typeof parsed.reason === 'string' &&
    (parsed.key === undefined || typeof parsed.key === 'string') &&
    (parsed.info === undefined || typeof parsed.info === 'string')
  ) {
    return parsed as unknown as ArrivalVerdict
  }
  return null
}
