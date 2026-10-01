import SentryCli from "@sentry/cli";
import { access, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { SENTRY_RELEASE } from "../src/shared/telemetry.ts";

if (existsSync(".env.sentry-build-plugin")) {
  const contents = await readFile(".env.sentry-build-plugin", "utf8");
  const settings = parseEnv(contents);
  if (settings.SENTRY_AUTH_TOKEN) process.env.SENTRY_AUTH_TOKEN = settings.SENTRY_AUTH_TOKEN;
  if (settings.SENTRY_ORG) process.env.SENTRY_ORG = settings.SENTRY_ORG;
}
if (process.env.SENTRY_AUTH_TOKEN === undefined) throw new Error("Set SENTRY_AUTH_TOKEN to upload source maps and native symbols.");
const org = process.env.SENTRY_ORG?.trim();
if (org === undefined || org.length === 0) throw new Error("Set SENTRY_ORG to the Sentry organization slug in .env.sentry-build-plugin or the environment.");
const releases = new SentryCli(null, { org, silent: false });
for (const directory of [".sentry/ui", ".sentry/server", ".sentry/native"]) await access(directory);
await releases.execute(["releases", "new", SENTRY_RELEASE, "--project", "codex-mobile-dev-ui", "--project", "codex-mobile-dev-server", "--project", "codex-mobile-dev-native"], "rejectOnError");
for (const [project, directory] of [["codex-mobile-dev-ui", ".sentry/ui"], ["codex-mobile-dev-server", ".sentry/server"]]) {
  await access(directory);
  const cli = new SentryCli(null, { org, project, silent: false });
  await cli.execute(["sourcemaps", "upload", "--release", SENTRY_RELEASE, "--validate", directory], "rejectOnError");
}
const native = new SentryCli(null, { org, project: "codex-mobile-dev-native", silent: false });
await native.execute(["debug-files", "upload", ".sentry/native"], "rejectOnError");
await releases.execute(["releases", "finalize", SENTRY_RELEASE], "rejectOnError");
