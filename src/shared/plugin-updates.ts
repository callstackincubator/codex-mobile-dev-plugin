import { z } from "zod";

const versionTextSchema = z.string();
export const releaseVersionSchema = versionTextSchema.regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const statusSchema = z.enum(["disabled", "unavailable", "current", "available", "updated"]);
const optionalVersionSchema = releaseVersionSchema.optional();
export const pluginUpdateSchema = z.object({
  status: statusSchema,
  currentVersion: releaseVersionSchema,
  latestVersion: optionalVersionSchema,
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

export function pluginReleaseUrl(version: string): string {
  return `https://github.com/callstackincubator/codex-mobile-dev-plugin/releases/tag/v${version}`;
}
