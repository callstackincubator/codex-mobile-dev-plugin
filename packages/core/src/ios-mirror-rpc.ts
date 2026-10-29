import { z } from "zod";
import { iosVideoBatchSchema } from "@mobile-dev/shared/ios-video.ts";
import type { ExpectedOutcome } from "@mobile-dev/shared/error-reporting.ts";

const id = z.number().int().positive();
export const mirrorRequestSchema = z.discriminatedUnion("method", [
  z.object({ id, method: z.literal("open"), udid: z.string().min(1).max(64) }),
  z.object({ id, method: z.literal("read") }),
  z.object({ id, method: z.literal("reset") }),
  z.object({ id, method: z.literal("close") }),
  z.object({ id, method: z.literal("touch"), generation: z.number().int().nonnegative(), samples: z.array(z.object({
    phase: z.number().int().min(0).max(2), x: z.number().finite(), y: z.number().finite(),
    width: z.number().finite().positive(), height: z.number().finite().positive(),
  })).min(1).max(64) }),
]);
export type MirrorRequest = z.infer<typeof mirrorRequestSchema>;
export type MirrorCommand = MirrorRequest extends infer Request ? Request extends MirrorRequest ? Omit<Request, "id"> : never : never;
const outcomes = ["session_expired", "session_closed", "cancelled", "device_unavailable", "app_unavailable", "resource_limit", "unsupported_platform", "invalid_input"] as const satisfies readonly ExpectedOutcome[];
export const mirrorReplySchema = z.object({
  id, result: z.union([z.null(), iosVideoBatchSchema]).optional(), error: z.string().max(4096).optional(), inputBusy: z.boolean().optional(),
  // Older services omit the outcome; their failures arrive unclassified.
  outcome: z.enum(outcomes).optional(),
});
export type MirrorReply = z.infer<typeof mirrorReplySchema>;
export const mirrorSocketPath = `/tmp/mobile-dev-ios-mirror-${process.getuid?.() ?? "local"}-v1.sock`;
export const maximumReplyBytes = 16 * 1024 * 1024;
