import { z } from "zod";

/** Ordered at tool-call time, so scrolling back to an old view cannot make it newest. */
export const workspaceInstanceSchema = z.object({
  scope: z.string().uuid(), sequence: z.number().int().positive(),
});
export type WorkspaceInstance = z.infer<typeof workspaceInstanceSchema>;
