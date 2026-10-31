import { z } from "zod";
import { PLUGIN_STORE_ID, releaseVersionSchema } from "../shared/plugin-updates.ts";
import { PluginUpdateError } from "./codex-cli.ts";

export const storeSummarySchema = z.object({ remotePluginId: z.literal(PLUGIN_STORE_ID), name: z.literal("mobile-dev"), version: releaseVersionSchema });
const storeResponseSchema = z.object({
  id: z.literal(PLUGIN_STORE_ID), name: z.literal("mobile-dev"), status: z.literal("ENABLED"), release: z.object({ version: releaseVersionSchema }),
});
/** The store's published Mobile Dev release. */
export type StorePlugin = z.infer<typeof storeSummarySchema>;
export type ReadStore = () => Promise<unknown>;

/** Reads the store's published release anonymously, without the Codex CLI or its authentication. */
export async function readPluginStore(options: { fetch?: typeof globalThis.fetch; signal?: AbortSignal } = {}): Promise<StorePlugin> {
  const request = options.fetch ?? globalThis.fetch;
  const timeout = AbortSignal.timeout(20000);
  const signal = options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal]);
  const url = `https://chatgpt.com/backend-api/ps/plugins/${PLUGIN_STORE_ID}`;
  let response: Response;
  try {
    response = await request(url, {
      headers: { Accept: "application/json", "OAI-Product-Sku": "codex" },
      credentials: "omit", redirect: "error", signal,
    });
  } catch {
    throw new PluginUpdateError("Could not read the Codex plugin store catalog.", "store-unavailable");
  }
  if (response.ok === false) {
    await response.body?.cancel();
    throw new PluginUpdateError("Could not read the Codex plugin store catalog.", "store-unavailable");
  }
  try {
    const data: unknown = await response.json();
    const plugin = storeResponseSchema.parse(data);
    return { remotePluginId: plugin.id, name: plugin.name, version: plugin.release.version };
  } catch {
    throw new PluginUpdateError("The plugin store returned an invalid update response.", "invalid-response");
  }
}
