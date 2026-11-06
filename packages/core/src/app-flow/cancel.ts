/** Throws if the sweep has been cancelled, so a long step can bail between its await points. */
export function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Cancelled')
}
