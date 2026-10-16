/**
 * The app-flow sweep's runtime meters, in one place.
 *
 * These were three inline `Sentry.metrics.*` calls inside `orchestrator.ts`'s sweep closure, which
 * made them untestable and made the opt-out check something each call site had to remember. The
 * emitted shape is unchanged — same names, same `millisecond` unit, same
 * `surface: 'app-flow'` / `device_platform` attribution — so the series stay comparable across
 * releases; see `docs/telemetry.md`.
 *
 * Everything here is a bounded aggregate: one measurement per operation (a connect, a command, a
 * settle loop, a verification, a dispatch), never one per frame or per poll. Attributes are closed
 * sets chosen for low cardinality — an outcome, an operation name, a stop reason, a verdict. Route
 * names, node ids, parameter values, paths and device identifiers are deliberately absent, and
 * nothing from the per-run sweep log (`sweep-log.ts`) is sent here.
 */
import * as Sentry from '@sentry/node'

/** The sweep's telemetry opt-out, honoured for every metric in this module. */
export function telemetryEnabled(): boolean {
  return process.env.MOBILE_DEV_TELEMETRY !== 'off'
}

function baseAttributes(attributes: Record<string, string>): Record<string, string> {
  return { surface: 'app-flow', device_platform: 'ios', ...attributes }
}

/** A duration in milliseconds — `app_flow.runtime.{connect,command,settle,verify}`. */
export function recordRuntimeTiming(
  name: string,
  durationMs: number,
  attributes: Record<string, string> = {}
): void {
  if (!telemetryEnabled()) return
  Sentry.metrics.distribution(name, Math.max(0, durationMs), {
    unit: 'millisecond',
    attributes: baseAttributes(attributes)
  })
}

/** One occurrence — `app_flow.runtime.{state,navigate}`. */
export function recordRuntimeCount(name: string, attributes: Record<string, string> = {}): void {
  if (!telemetryEnabled()) return
  Sentry.metrics.count(name, 1, { attributes: baseAttributes(attributes) })
}
