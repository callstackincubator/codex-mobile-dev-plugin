import { z } from "zod";

export const PLUGIN_STORE_ID = "plugins_6ac4c117f76881918d3676e851fa4005";
export const PLUGIN_STORE_URL = `https://chatgpt.com/plugins/${PLUGIN_STORE_ID}`;
export const STORE_MIGRATION_VERSION = "0.1.167";

const versionTextSchema = z.string();
export const releaseVersionSchema = versionTextSchema.regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const statusSchema = z.enum(["disabled", "unavailable", "current", "available", "migration", "migrated"]);
const optionalVersionSchema = releaseVersionSchema.optional();
const booleanSchema = z.boolean();
const optionalBooleanSchema = booleanSchema.optional();
export const pluginUpdateSchema = z.object({
  status: statusSchema,
  currentVersion: releaseVersionSchema,
  latestVersion: optionalVersionSchema,
  storeInstalled: optionalBooleanSchema,
});
export type PluginUpdate = z.infer<typeof pluginUpdateSchema>;

export function compareReleaseVersions(left: string, right: string): number {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  for (let index = 0; index < 3; index++) {
    const leftNumber = BigInt(leftParts[index]);
    const rightNumber = BigInt(rightParts[index]);
    if (leftNumber !== rightNumber) return leftNumber > rightNumber ? 1 : -1;
  }
  return 0;
}
