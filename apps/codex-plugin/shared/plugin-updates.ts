import { z } from "zod";
import { BUILD_VERSION_PATTERN, RELEASE_VERSION_PATTERN } from "@mobile-dev/shared/release-version.ts";

export { compareReleaseVersions } from "@mobile-dev/shared/release-version.ts";

export const PLUGIN_STORE_ID = "plugins_6ac4c117f76881918d3676e851fa4005";
export const PLUGIN_STORE_URL = `https://chatgpt.com/plugins/${PLUGIN_STORE_ID}`;
export const STORE_MIGRATION_VERSION = "0.1.167";

const versionTextSchema = z.string();
export const releaseVersionSchema = versionTextSchema.regex(RELEASE_VERSION_PATTERN);
// The running build can be a test deployment's prerelease, such as 0.1.172-test.1;
// published and store versions are always plain releases.
const buildVersionSchema = versionTextSchema.regex(BUILD_VERSION_PATTERN);
const statusSchema = z.enum(["disabled", "unavailable", "current", "available", "migration", "migrated"]);
const optionalVersionSchema = releaseVersionSchema.optional();
const booleanSchema = z.boolean();
const optionalBooleanSchema = booleanSchema.optional();
export const pluginUpdateSchema = z.object({
  status: statusSchema,
  currentVersion: buildVersionSchema,
  latestVersion: optionalVersionSchema,
  storeInstalled: optionalBooleanSchema,
});
export type PluginUpdate = z.infer<typeof pluginUpdateSchema>;
