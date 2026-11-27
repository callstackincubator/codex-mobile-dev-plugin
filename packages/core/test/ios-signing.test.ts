import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { errorHint, errorMessage } from "@mobile-dev/shared/protocol.ts";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { configuredTeamId, developmentIdentities, developmentTeams, ensureIosSigning, iosSigningEnv, iosSigningStatus, readSavedIosTeam, resolveIosTeam, saveIosTeam, teamNameFromSubject, resetIosSigning, projectStateDir, PROJECT_STATE_ROOT, restartStaleDaemons, resolveIosTeamId, runnerBundleId, teamFromSubject, withAgentDeviceHint } from "../src/ios-signing.ts";
import { AgentDeviceRuntime } from "../src/agent-device-runtime.ts";

/** A saved-choice file that never exists, so a team saved on this machine cannot leak into a test. */
const NO_SAVED = join(tmpdir(), "mobile-dev-no-saved-team", "none.json");
const none = async () => { throw new Error("no keychain"); };

test("the explicit setting wins over the project and keychain", async () => {
  assert.equal(await resolveIosTeamId({ env: { MOBILE_DEV_IOS_TEAM_ID: "abcde12345", AGENT_DEVICE_IOS_TEAM_ID: "ZZZZZ99999" }, run: none }), "ABCDE12345");
  assert.equal(await resolveIosTeamId({ env: { AGENT_DEVICE_IOS_TEAM_ID: "ZZZZZ99999" }, run: none }), "ZZZZZ99999");
  assert.equal(configuredTeamId({ MOBILE_DEV_IOS_TEAM_ID: "not a team" }), undefined);
});

test("the project's DEVELOPMENT_TEAM is used when every target agrees, and not when they differ", async () => {
  const root = await mkdtemp(join(tmpdir(), "signing-"));
  try {
    const pbx = (team: string) => `buildSettings = { DEVELOPMENT_TEAM = ${team}; };`;
    await mkdir(join(root, "ios", "App.xcodeproj"), { recursive: true });
    await writeFile(join(root, "ios", "App.xcodeproj", "project.pbxproj"), `${pbx("ABCDE12345")}${pbx('"ABCDE12345"')}`);
    assert.equal(await resolveIosTeamId({ env: {}, projectPath: root, run: none, savedTeamFile: NO_SAVED }), "ABCDE12345");
    await writeFile(join(root, "ios", "App.xcodeproj", "project.pbxproj"), `${pbx("ABCDE12345")}${pbx("FGHIJ67890")}`);
    await assert.rejects(resolveIosTeamId({ env: {}, projectPath: root, run: none, savedTeamFile: NO_SAVED }), /MOBILE_DEV_IOS_TEAM_ID/);
  } finally { await rm(root, { recursive: true, force: true }); }
  assert.deepEqual(developmentTeams("DEVELOPMENT_TEAM = \"\";"), []);
});

test("keychain identities parse, and a team is read from the certificate subject", () => {
  const output = [
    '  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Apple Development: Dev One (PERSONAL12)"',
    '  2) 89ABCDEF0123456789ABCDEF0123456789ABCDEF "Developer ID Application: Acme (ACMETEAM01)"',
    '     2 valid identities found',
  ].join("\n");
  assert.deepEqual(developmentIdentities(output), ["Apple Development: Dev One (PERSONAL12)"]);
  assert.equal(teamFromSubject("subject=UID=X,CN=Apple Development: A (B),OU=ABCDE12345,O=Acme,C=US"), "ABCDE12345");
});

test("one team behind the keychain identities is chosen, none or several is a message that says what to set", async () => {
  const keychain = (teams: string[]) => async (file: string, args: string[]) => {
    if (args[0] === "find-identity") return teams.map((_, index) => `${index + 1}) ${String(index).repeat(40)} "Apple Development: Dev ${index} (P${index})"`).join("\n");
    throw new Error("openssl is not available in the fake");
  };
  // The fake cannot produce a certificate subject, so no identity yields a team: the none case.
  await assert.rejects(resolveIosTeamId({ env: {}, run: keychain(["A"]), savedTeamFile: NO_SAVED }), (error: unknown) => error instanceof ExpectedOperationError && /signing team/.test(error.message) && /MOBILE_DEV_IOS_TEAM_ID/.test(error.message));
});

test("signing is exported for the in-process client and the e2e runner, and a user's runner bundle id stays", async () => {
  const keys = ["MOBILE_DEV_IOS_TEAM_ID", "AGENT_DEVICE_IOS_TEAM_ID", "AGENT_DEVICE_IOS_BUNDLE_ID"] as const;
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    resetIosSigning();
    process.env.MOBILE_DEV_IOS_TEAM_ID = "ABCDE12345";
    await ensureIosSigning({ daemons: { stateDirs: [] }, savedTeamFile: NO_SAVED });
    assert.equal(process.env.AGENT_DEVICE_IOS_TEAM_ID, "ABCDE12345");
    assert.equal(process.env.AGENT_DEVICE_IOS_BUNDLE_ID, runnerBundleId("ABCDE12345"));
    process.env.MOBILE_DEV_IOS_TEAM_ID = "FGHIJ67890";
    await ensureIosSigning({ daemons: { stateDirs: [] }, savedTeamFile: NO_SAVED });
    assert.equal(process.env.AGENT_DEVICE_IOS_BUNDLE_ID, runnerBundleId("FGHIJ67890"), "a bundle id this module set follows the team");
    process.env.AGENT_DEVICE_IOS_BUNDLE_ID = "com.me.runner";
    await ensureIosSigning({ daemons: { stateDirs: [] }, savedTeamFile: NO_SAVED });
    assert.equal(process.env.AGENT_DEVICE_IOS_BUNDLE_ID, "com.me.runner");
    assert.deepEqual(iosSigningEnv("ABCDE12345", "com.me.runner"), { AGENT_DEVICE_IOS_TEAM_ID: "ABCDE12345", AGENT_DEVICE_IOS_BUNDLE_ID: "com.me.runner" });
  } finally {
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    resetIosSigning();
  }
});

test("the agent-device runtime keeps the signing variables and still drops its own", () => {
  const keys = ["AGENT_DEVICE_IOS_TEAM_ID", "AGENT_DEVICE_IOS_SIGNING_IDENTITY", "AGENT_DEVICE_DAEMON_BASE_URL"] as const;
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.AGENT_DEVICE_IOS_TEAM_ID = "ABCDE12345";
    process.env.AGENT_DEVICE_IOS_SIGNING_IDENTITY = "Apple Development";
    process.env.AGENT_DEVICE_DAEMON_BASE_URL = "http://elsewhere";
    const env = (new AgentDeviceRuntime() as unknown as { environment(directory: string): Record<string, string> }).environment("/state");
    assert.equal(env.AGENT_DEVICE_IOS_TEAM_ID, "ABCDE12345");
    assert.equal(env.AGENT_DEVICE_IOS_SIGNING_IDENTITY, "Apple Development");
    assert.equal(env.AGENT_DEVICE_DAEMON_BASE_URL, undefined);
    assert.equal(env.AGENT_DEVICE_STATE_DIR, "/state");
  } finally {
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});

test("agent-device's hint reaches the message with local paths removed, and a fixable failure is expected", () => {
  const failure = Object.assign(new Error("xcodebuild build-for-testing failed"), {
    details: { reason: "signing_no_development_team", hint: "Set AGENT_DEVICE_IOS_TEAM_ID. See /Users/someone/.agent-device/logs/build.log for details.", logPath: "/Users/someone/.agent-device/logs/build.log" },
  });
  assert.equal(errorHint(failure), "Set AGENT_DEVICE_IOS_TEAM_ID. See <path> for details.");
  const message = errorMessage(failure);
  assert.match(message, /^xcodebuild build-for-testing failed Set AGENT_DEVICE_IOS_TEAM_ID/);
  assert.doesNotMatch(message, /\/Users\/|logPath/);
  const reported = withAgentDeviceHint(failure, errorHint, errorMessage);
  assert.ok(reported instanceof ExpectedOperationError);
  assert.equal(reported.outcome, "invalid_input");
  assert.equal(withAgentDeviceHint(new Error("plain"), errorHint, errorMessage) instanceof ExpectedOperationError, false);
  assert.equal(errorMessage(new Error("plain")), "plain");
});

test("a daemon started without this team is stopped, one that carries it and a stranger are not", async () => {
  const signing = iosSigningEnv("ABCDE12345");
  const carried = Object.entries(signing).map(([key, value]) => `${key}=${value}`).join(" ");
  const files: Record<string, string> = { "/a/daemon.json": '{"pid":11}', "/b/daemon.json": '{"pid":22}', "/c/daemon.json": '{"pid":33}', "/d/daemon.json": "not json" };
  const processes: Record<number, string> = {
    11: "node agent-device/dist/src/internal/daemon.js PATH=/usr/bin",
    22: `node agent-device/dist/src/internal/daemon.js ${carried}`,
    33: "node some-other-server.js",
  };
  const killed: number[] = [];
  const stopped = await restartStaleDaemons(signing, {
    stateDirs: ["/a", "/b", "/c", "/d", "/missing"],
    readFile: async path => files[path] ?? Promise.reject(new Error("ENOENT")),
    processEnvironment: async pid => processes[pid] ?? Promise.reject(new Error("gone")),
    kill: pid => { killed.push(pid); },
  });
  assert.deepEqual(stopped, [11]);
  assert.deepEqual(killed, [11]);
});

test("each project's hardware runs keep their state in a folder of their own under the app's directory", () => {
  const a = projectStateDir("/work/app-a"), b = projectStateDir("/work/app-b");
  assert.equal(dirname(a), PROJECT_STATE_ROOT);
  assert.notEqual(a, b);
  assert.equal(projectStateDir("/work/app-a"), a, "the same project always gets the same folder");
  assert.equal(a.includes("app-a"), false, "the folder name does not carry the project's path");
});

test("a saved team slots between the environment and the project, and clears back to automatic", async () => {
  const root = await mkdtemp(join(tmpdir(), "signing-saved-"));
  try {
    const savedTeamFile = join(root, "nested", "ios-signing-team.json");
    await mkdir(join(root, "ios", "App.xcodeproj"), { recursive: true });
    await writeFile(join(root, "ios", "App.xcodeproj", "project.pbxproj"), "DEVELOPMENT_TEAM = PROJECT123;");
    assert.equal((await resolveIosTeam({ env: {}, projectPath: root, run: none, savedTeamFile })).source, "project");
    await saveIosTeam("userteam12", savedTeamFile);
    assert.equal(await readSavedIosTeam(savedTeamFile), "USERTEAM12");
    assert.deepEqual(await resolveIosTeam({ env: {}, projectPath: root, run: none, savedTeamFile }), { teamId: "USERTEAM12", source: "user" });
    assert.deepEqual(await resolveIosTeam({ env: { MOBILE_DEV_IOS_TEAM_ID: "ENVTEAM123" }, projectPath: root, run: none, savedTeamFile }), { teamId: "ENVTEAM123", source: "env", envVar: "MOBILE_DEV_IOS_TEAM_ID" });
    await saveIosTeam(undefined, savedTeamFile);
    assert.equal((await resolveIosTeam({ env: {}, projectPath: root, run: none, savedTeamFile })).source, "project");
    await assert.rejects(saveIosTeam("short", savedTeamFile), ExpectedOperationError);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a saved team resolves ambiguity between several keychain teams, and the error points at the picker", async () => {
  const root = await mkdtemp(join(tmpdir(), "signing-many-"));
  try {
    const savedTeamFile = join(root, "team.json");
    const run = async (file: string, args: string[]) => {
      if (args[0] === "find-identity") return '  1) 0123456789ABCDEF0123456789ABCDEF01234567 "Apple Development: A (AAA)"\n  2) 89ABCDEF0123456789ABCDEF0123456789ABCDEF "Apple Development: B (BBB)"\n';
      throw new Error("no certificate");
    };
    await assert.rejects(resolveIosTeam({ env: {}, run, savedTeamFile }), /E2E setup → Devices/);
    await saveIosTeam("ABCDE12345", savedTeamFile);
    assert.equal((await resolveIosTeam({ env: {}, run, savedTeamFile })).teamId, "ABCDE12345");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the team API lists names, the saved choice and the team in effect, or why none resolves", async () => {
  const root = await mkdtemp(join(tmpdir(), "signing-status-"));
  try {
    const savedTeamFile = join(root, "team.json");
    assert.equal(teamNameFromSubject("OU=ABCDE12345,O=Acme\\, Inc.,C=US"), "Acme, Inc.");
    const status = await iosSigningStatus({ env: {}, run: none, savedTeamFile });
    assert.deepEqual(status.teams, []);
    assert.equal(status.resolved, undefined);
    assert.match(status.error ?? "", /E2E setup/);
    await saveIosTeam("ABCDE12345", savedTeamFile);
    assert.deepEqual(await iosSigningStatus({ env: {}, run: none, savedTeamFile }), { teams: [], saved: "ABCDE12345", resolved: { id: "ABCDE12345", source: "user" } });
    const pinned = await iosSigningStatus({ env: { MOBILE_DEV_IOS_TEAM_ID: "ENVTEAM123" }, run: none, savedTeamFile });
    assert.deepEqual(pinned.resolved, { id: "ENVTEAM123", source: "env", envVar: "MOBILE_DEV_IOS_TEAM_ID" });
    const agentDevice = await iosSigningStatus({ env: { AGENT_DEVICE_IOS_TEAM_ID: "AGENTTEAM1" }, run: none, savedTeamFile });
    assert.deepEqual(agentDevice.resolved, { id: "AGENTTEAM1", source: "env", envVar: "AGENT_DEVICE_IOS_TEAM_ID" });
    assert.equal((await iosSigningStatus({ env: { MOBILE_DEV_IOS_TEAM_ID: "bad", AGENT_DEVICE_IOS_TEAM_ID: "AGENTTEAM1" }, run: none, savedTeamFile })).resolved?.envVar, "AGENT_DEVICE_IOS_TEAM_ID");
    assert.equal(pinned.saved, "ABCDE12345");
  } finally { await rm(root, { recursive: true, force: true }); }
});
