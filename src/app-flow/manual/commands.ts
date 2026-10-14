/**
 * The literal `agent-device …` lines a manual recording falls back to when its recording cannot be
 * published as a `.ad` script.
 *
 * Pure, and deliberately free of any Electron or device import, so the round trip that actually
 * matters — that `reachStartScreen` can parse and execute every line this produces — is testable
 * under `node --test`. A fallback path nothing can replay is worth nothing.
 */
import type { ManualLocator } from './locators.ts'

export { quoteCliArg } from '../cli-args.ts'

/**
 * The command builders themselves now live in `../walk-commands.ts`, which the sweep's own
 * `pathToReach` emission shares — the manual recorder and the explorer write the same lines for
 * the same reasons, and keeping two spellings of `agent-device press` was how they would drift.
 * Re-exported from here so every existing import of this module is unchanged.
 */
export { fillCommand, pressCommand, pressPointCommand, scrollCommand } from '../walk-commands.ts'

/**
 * Whether a step survives a rebuild of the app.
 *
 * A `text=` locator breaks on any copy change and a coordinate breaks on any layout change, so the
 * panel marks both so the user can choose to re-record against something sturdier.
 */
export function isPortable(locator: ManualLocator | null): boolean {
  return locator !== null && locator.by !== 'text'
}
