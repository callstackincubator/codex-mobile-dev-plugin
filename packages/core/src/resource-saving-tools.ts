import { z } from "zod";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { errorMessage, udidSchema } from "@mobile-dev/shared/protocol.ts";
import type { ResourceSavingDevice } from "@mobile-dev/shared/resource-saving.ts";
import type { Baguette } from "./baguette.ts";
import { androidIdSchema, type ServeEmu } from "./serve-emu.ts";
import { ResourceSaving } from "./resource-saving.ts";
import { captureServerError } from "./telemetry.ts";

const targetSchema = z.discriminatedUnion("platform", [
  z.object({ platform: z.literal("ios"), id: udidSchema }).strict(),
  z.object({ platform: z.literal("android"), id: androidIdSchema }).strict(),
]);
type Target = z.infer<typeof targetSchema>;

export function registerResourceSavingTools(server: McpServer, baguette: Baguette, android: ServeEmu, saving = new ResourceSaving()) {
  baguette.resourceSaving = saving;
  android.resourceSaving = saving;
  const device = async (target: Target): Promise<ResourceSavingDevice> => {
    const found = target.platform === "ios" ? await baguette.device(target.id) : await android.device(target.id);
    if (found.kind === "physical") throw new ExpectedOperationError("invalid_input", "Resource saving is available only for simulators and emulators.");
    return { platform: target.platform, id: target.id, key: target.platform === "ios" ? target.id : found.name, state: found.state };
  };
  const guarded = (operation: "read" | "set", handler: (target: Target, enabled?: boolean) => Promise<object>) => async (input: { target: Target; enabled?: boolean }) => {
    try {
      const state = await handler(input.target, input.enabled);
      const text = JSON.stringify(state);
      return { content: [{ type: "text" as const, text }], structuredContent: { state } };
    } catch (error) {
      captureServerError(error, `resource_saving.${operation}`, { reportAs: new Error("Resource saving preference failed."), tags: { device_platform: input.target.platform } });
      return { isError: true, content: [{ type: "text" as const, text: errorMessage(error) }] };
    }
  };
  registerAppTool(server, "mobile_resource_saving", {
    title: "Read resource saving", description: "Read the selected virtual device's saved resource-saving preference. Enabled by default. Does not boot or optimize the device.",
    inputSchema: { target: targetSchema }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, guarded("read", async target => {
    const selected = await device(target);
    return saving.state(selected);
  }));
  registerAppTool(server, "mobile_set_resource_saving", {
    title: "Set resource saving", description: "Save resource saving for one existing simulator or emulator. The preference applies on the next start; it never restarts a running device.",
    inputSchema: { target: targetSchema, enabled: z.boolean() }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, guarded("set", async (target, enabled) => {
    const selected = await device(target);
    return saving.set(selected, enabled!);
  }));
}
