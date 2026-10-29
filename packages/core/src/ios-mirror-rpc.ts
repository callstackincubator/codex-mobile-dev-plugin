import { z } from "zod";
import { iosVideoBatchSchema } from "@mobile-dev/shared/ios-video.ts";
import { expectedOutcomes } from "@mobile-dev/shared/error-reporting.ts";

const id = z.number().int().positive();
// The service may run another plugin version's code, so touch phases keep their numeric wire form.
export const wireTouchPhases = ["down", "move", "up"] as const;
const wirePhase = z.number().int().min(0).max(2).transform(index => wireTouchPhases[index]);
export const mirrorRequestSchema = z.discriminatedUnion("method", [
  z.object({ id, method: z.literal("open"), udid: z.string().min(1).max(64) }),
  z.object({ id, method: z.literal("read") }),
  z.object({ id, method: z.literal("reset") }),
  z.object({ id, method: z.literal("close") }),
  z.object({ id, method: z.literal("touch"), generation: z.number().int().nonnegative(), samples: z.array(z.object({
    phase: wirePhase, x: z.number().finite(), y: z.number().finite(),
    width: z.number().finite().positive(), height: z.number().finite().positive(),
  })).min(1).max(64) }),
]);
export type MirrorRequest = z.infer<typeof mirrorRequestSchema>;
type WireRequest = z.input<typeof mirrorRequestSchema>;
/** A request as the client writes it to the socket. */
export type MirrorCommand = WireRequest extends infer Request ? Request extends WireRequest ? Omit<Request, "id"> : never : never;
export const mirrorReplySchema = z.object({ id, result: z.union([z.null(), iosVideoBatchSchema]).optional(), error: z.string().max(4096).optional(), inputBusy: z.boolean().optional(),
  // Lets the panel process apply the expected-error policy to device states the service saw.
  outcome: z.enum(expectedOutcomes).optional() });
export type MirrorReply = z.infer<typeof mirrorReplySchema>;
export const mirrorSocketPath = `/tmp/mobile-dev-ios-mirror-${process.getuid?.() ?? "local"}-v1.sock`;
export const maximumReplyBytes = 16 * 1024 * 1024;
