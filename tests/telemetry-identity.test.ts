import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { loadTelemetryIdentity } from "../src/server/telemetry-identity.ts";
import { isAnonymousUserId, isTelemetrySessionId, validateTelemetryIdentity } from "../src/shared/telemetry-identity.ts";

const execute = promisify(execFile);

test("anonymous identity persists across restarts while server sessions change", async t => {
  const temporary = tmpdir();
  const prefix = join(temporary, "mobile-dev-identity-");
  const root = await mkdtemp(prefix);
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "telemetry");
  const first = loadTelemetryIdentity(directory);
  const second = loadTelemetryIdentity(directory);
  const validUser = isAnonymousUserId(first.userId);
  const validSession = isTelemetrySessionId(first.sessionId);
  assert.equal(validUser, true);
  assert.equal(validSession, true);
  assert.equal(second.userId, first.userId);
  assert.notEqual(second.sessionId, first.sessionId);
  const identityPath = join(directory, "anonymous-user-id");
  const saved = await readFile(identityPath, "utf8");
  assert.equal(saved, `${first.userId}\n`);
  const file = await stat(identityPath);
  const folder = await stat(directory);
  assert.equal(file.mode & 0o777, 0o600);
  assert.equal(folder.mode & 0o777, 0o700);
});

test("concurrent MCP processes publish one complete installation ID", async t => {
  const temporary = tmpdir();
  const prefix = join(temporary, "mobile-dev-identity-race-");
  const root = await mkdtemp(prefix);
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "telemetry");
  const moduleUrl = new URL("../src/server/telemetry-identity.ts", import.meta.url);
  const moduleLiteral = JSON.stringify(moduleUrl.href);
  const code = `import { loadTelemetryIdentity } from ${moduleLiteral}; const identity = loadTelemetryIdentity(process.argv[1]); console.log(JSON.stringify(identity));`;
  const jobs = Array.from({ length: 12 }, () => execute(process.execPath, ["--input-type=module", "-e", code, directory]));
  const results = await Promise.all(jobs);
  const users = new Set<string>();
  const sessions = new Set<string>();
  for (const result of results) {
    const parsed = JSON.parse(result.stdout);
    const identity = validateTelemetryIdentity(parsed.userId, parsed.sessionId);
    users.add(identity.userId);
    sessions.add(identity.sessionId);
  }
  assert.equal(users.size, 1);
  assert.equal(sessions.size, 12);
  const files = await readdir(directory);
  assert.deepEqual(files, ["anonymous-user-id"]);
});

test("invalid stored identifiers fail clearly without silently changing user counts", async t => {
  const temporary = tmpdir();
  const prefix = join(temporary, "mobile-dev-identity-invalid-");
  const directory = await mkdtemp(prefix);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "anonymous-user-id");
  await writeFile(path, "private-account-id");
  assert.throws(() => loadTelemetryIdentity(directory), /stored Sentry anonymous user ID is invalid/);
  const saved = await readFile(path, "utf8");
  assert.equal(saved, "private-account-id");
  assert.throws(() => validateTelemetryIdentity("alice@example.com", "chat-id"), /generated anonymous/);
});

test("server startup sets the same user and session on Node scope and both native launch paths", async t => {
  const root = process.cwd();
  const directory = join(root, ".local-dev");
  await mkdir(directory, { recursive: true });
  const prefix = join(directory, "identity-startup-");
  const output = await mkdtemp(prefix);
  t.after(() => rm(output, { recursive: true, force: true }));
  const probe = join(output, "probe.mjs");
  const config = join(output, "telemetry-environment.json");
  await writeFile(config, '{"environment":"development"}');
  const contents = `
    import "./src/server/instrument.ts";
    import * as Sentry from "@sentry/node";
    import { getTelemetryIdentity } from "./src/server/telemetry-identity.ts";
    import { nativeCollectorCommand } from "./src/server/native-telemetry.ts";
    const client = Sentry.getClient();
    const transport = client.getTransport();
    transport.send = async () => ({ statusCode: 200 });
    const scope = Sentry.getCurrentScope();
    const data = scope.getScopeData();
    const command = nativeCollectorCommand("/tmp/helper");
    const identity = getTelemetryIdentity();
    const reported = JSON.stringify({ identity, user: data.user, session: data.tags.telemetry_session,
      nativeUser: process.env.MOBILE_DEV_NATIVE_USER_ID, nativeSession: process.env.MOBILE_DEV_NATIVE_SESSION_ID, command });
    console.log(reported);
    await Sentry.close(0);
  `;
  await build({ stdin: { contents, resolveDir: root, loader: "ts" }, outfile: probe,
    bundle: true, format: "esm", platform: "node", target: "node22", external: ["@sentry/node"] });
  const env = { ...process.env, MOBILE_DEV_TELEMETRY: "on" };
  const runs: { userId: string; sessionId: string }[] = [];
  for (let index = 0; index < 2; index++) {
    const result = await execute(process.execPath, [probe], { env });
    const reported = JSON.parse(result.stdout);
    const identity = validateTelemetryIdentity(reported.identity.userId, reported.identity.sessionId);
    assert.deepEqual(reported.user, { id: identity.userId });
    assert.equal(reported.session, identity.sessionId);
    assert.equal(reported.nativeUser, identity.userId);
    assert.equal(reported.nativeSession, identity.sessionId);
    const userIncluded = reported.command.includes(`MOBILE_DEV_NATIVE_USER_ID='${identity.userId}'`);
    const sessionIncluded = reported.command.includes(`MOBILE_DEV_NATIVE_SESSION_ID='${identity.sessionId}'`);
    assert.ok(userIncluded);
    assert.ok(sessionIncluded);
    runs.push(identity);
  }
  assert.equal(runs[0].userId, runs[1].userId);
  assert.notEqual(runs[0].sessionId, runs[1].sessionId);
  const disabledEnv = { ...env, MOBILE_DEV_TELEMETRY: "off", MOBILE_DEV_NATIVE_USER_ID: "private-inherited", MOBILE_DEV_NATIVE_SESSION_ID: "private-thread" };
  const disabledResult = await execute(process.execPath, [probe], { env: disabledEnv });
  const disabled = JSON.parse(disabledResult.stdout);
  assert.deepEqual(disabled.user, {});
  assert.equal(disabled.identity, undefined);
  assert.equal(disabled.nativeUser, undefined);
  assert.equal(disabled.nativeSession, undefined);
  const disabledIncludesUser = disabled.command.includes("MOBILE_DEV_NATIVE_USER_ID");
  assert.equal(disabledIncludesUser, false);
});
