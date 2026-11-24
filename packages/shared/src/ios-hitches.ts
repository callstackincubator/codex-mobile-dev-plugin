import { z } from "zod";

export const iosHitchSchema = z.object({
  time: z.number().finite().nonnegative(),
  lateMs: z.number().finite().positive(),
  refreshIntervalMs: z.number().finite().positive(),
});
export type IosHitch = z.infer<typeof iosHitchSchema>;
export const iosHitchesSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("finished"), end: z.number().finite().positive(), events: z.array(iosHitchSchema) }),
  z.object({ status: z.literal("unavailable"), error: z.string() }),
]);
export type IosHitches = z.infer<typeof iosHitchesSchema>;
export const hitchStatsSchema = z.object({ count: z.number().int().nonnegative(), lateMs: z.number().finite().nonnegative() });

export function summarizeIosHitches(capture: IosHitches | undefined, start: number, end: number) {
  if (capture?.status !== "finished" || start >= capture.end) return null;
  let count = 0;
  let lateMs = 0;
  let accountedFrom = end;
  // Visit presentations backwards so overlapping late intervals count each instant only once.
  for (let index = capture.events.length - 1; index >= 0; index--) {
    const event = capture.events[index];
    if (event.time < start) break;
    if (event.time < end) count++;
    const from = Math.max(start, event.time - event.lateMs / 1000);
    const to = Math.min(accountedFrom, event.time);
    if (to <= from) continue;
    lateMs += (to - from) * 1000;
    accountedFrom = from;
  }
  return { count, lateMs };
}
