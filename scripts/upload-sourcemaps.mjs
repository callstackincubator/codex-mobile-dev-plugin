import SentryCli from "@sentry/cli";
import { access, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { SENTRY_RELEASE } from "../src/shared/telemetry.ts";

if (existsSync(".env.sentry-build-plugin")) {
  const contents = await readFile(".env.sentry-build-plugin", "utf8");
  const settings = parseEnv(contents);
  if (settings.SENTRY_AUTH_TOKEN) process.env.SENTRY_AUTH_TOKEN = settings.SENTRY_AUTH_TOKEN;
}
if (process.env.SENTRY_AUTH_TOKEN === undefined) throw new Error("Set SENTRY_AUTH_TOKEN to upload source maps to callstackincubator.");
const releases = new SentryCli(null, { org: "callstackincubator", silent: false });
await releases.execute(["releases", "new", SENTRY_RELEASE, "--project", "codex-mobile-dev-ui", "--project", "mobile-dev-server"], "rejectOnError");
for (const [project, directory] of [["codex-mobile-dev-ui", ".sentry/ui"], ["mobile-dev-server", ".sentry/server"]]) {
  await access(directory);
  const cli = new SentryCli(null, { org: "callstackincubator", project, silent: false });
  await cli.execute(["sourcemaps", "upload", "--release", SENTRY_RELEASE, "--validate", directory], "rejectOnError");
}
await releases.execute(["releases", "finalize", SENTRY_RELEASE], "rejectOnError");
