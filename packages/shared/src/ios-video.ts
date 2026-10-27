import { z } from "zod";

const encoded = z.string().max(8 * 1024 * 1024);
export const iosVideoBatchSchema = z.object({
  generation: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative(),
  dropped: z.number().int().nonnegative(),
  configuration: z.object({
    revision: z.number().int().positive(), width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192),
    codec: z.string().regex(/^hvc1\.[ABC]?\d+\.[A-F0-9]+\.[LH]\d+(?:\.[A-F0-9]+)*$/), description: encoded,
  }).optional(),
  frames: z.array(z.object({ sequence: z.number().int().positive(), data: encoded, timestamp: z.number().finite().nonnegative(), key: z.boolean() })).max(8),
});
export type IosVideoBatch = z.infer<typeof iosVideoBatchSchema>;
