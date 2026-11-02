/**
 * Shell quoting for the `agent-device …` lines persisted into `pathToReach`.
 *
 * Its own module because both `capture.ts` (which builds the boot/install/open/replay lines) and
 * `manual/commands.ts` (which builds the press/fill/scroll ones) need it, and neither should import
 * the other: the core capture module must not depend on a feature folder, and the manual recorder's
 * command builders must stay free of Electron so they can be tested under `node --test`.
 */
export function quoteCliArg(value: string): string {
  if (/^[A-Za-z0-9._:+/=@-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}
