import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { assertBuildEnvironment, telemetryBuildEnvironment } from "../scripts/telemetry-build.mjs";

const execute = promisify(execFile);

test("local builds and packages require an explicit release flag", async t => {
  assert.equal(telemetryBuildEnvironment([]), "development");
  assert.equal(telemetryBuildEnvironment(["--release"]), "release");
  assert.throws(() => telemetryBuildEnvironment(["--relese"]), /Use --release/);
  await mkdir(".local-dev", { recursive: true });
  const directory = await mkdtemp(".local-dev/telemetry-package-test-");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, "telemetry-environment.json");
  const htmlPath = join(directory, "app.html");
  for (const environment of ["development", "release"]) {
    const config = JSON.stringify({ environment });
    await writeFile(configPath, config);
    const html = `<meta name="mobile-dev-environment" content="${environment}">`;
    await writeFile(htmlPath, html);
    await assertBuildEnvironment(directory, environment);
    const other = environment === "development" ? "release" : "development";
    const mismatched = assertBuildEnvironment(directory, other);
    await assert.rejects(mismatched, /The package requires/);
    const staleHtml = `<meta name="mobile-dev-environment" content="${other}">`;
    await writeFile(htmlPath, staleHtml);
    const stale = assertBuildEnvironment(directory, environment);
    await assert.rejects(stale, /The package requires/);
  }
});

test("packaged Node and native telemetry share the explicit build environment", async t => {
  await mkdir(".local-dev", { recursive: true });
  const directory = await mkdtemp(".local-dev/telemetry-runtime-test-");
  t.after(() => rm(directory, { recursive: true, force: true }));
  const probe = join(directory, "probe.mjs");
  const configPath = join(directory, "telemetry-environment.json");
  const contents = `
    import "./src/server/instrument.ts";
    import * as Sentry from "@sentry/node";
    import { nativeCollectorCommand } from "./src/server/native-telemetry.ts";
    const client = Sentry.getClient();
    const options = client.getOptions();
    const command = nativeCollectorCommand("/tmp/collector");
    console.log(JSON.stringify({ environment: options.environment, native: process.env.MOBILE_DEV_NATIVE_ENVIRONMENT, command, enabled: options.enabled }));
    await Sentry.close(0);
  `;
  await build({
    stdin: { contents, resolveDir: process.cwd(), loader: "ts" },
    outfile: probe, bundle: true, format: "esm", platform: "node", target: "node22",
    external: ["@sentry/node"],
  });
  for (const environment of ["development", "release"]) {
    const config = JSON.stringify({ environment });
    await writeFile(configPath, config);
    for (const override of [undefined, "development", "release"]) {
      const env: NodeJS.ProcessEnv = { ...process.env, MOBILE_DEV_TELEMETRY: "off" };
      delete env.MOBILE_DEV_ENVIRONMENT;
      if (override !== undefined) env.MOBILE_DEV_ENVIRONMENT = override;
      const result = await execute(process.execPath, [probe], { env });
      const reported = JSON.parse(result.stdout);
      const expected = override ?? environment;
      assert.equal(reported.environment, expected);
      assert.equal(reported.native, expected);
      assert.equal(reported.enabled, false);
      const expectedCommand = `MOBILE_DEV_NATIVE_ENVIRONMENT='${expected}'`;
      const matches = reported.command.includes(expectedCommand);
      assert.equal(matches, true);
    }
  }
  await writeFile(configPath, '{"environment":"typo"}');
  const disabled = { ...process.env, MOBILE_DEV_TELEMETRY: "off" };
  const invalid = execute(process.execPath, [probe], { env: disabled });
  await assert.rejects(invalid, /Sentry environment must be/);
  await rm(configPath);
  const missing = execute(process.execPath, [probe], { env: disabled });
  await assert.rejects(missing, /ENOENT/);
});
