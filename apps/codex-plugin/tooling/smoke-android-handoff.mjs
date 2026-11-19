import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function jsonLines(text) {
  const lines = text.split("\n");
  const populated = lines.filter(Boolean);
  return populated.map(line => JSON.parse(line));
}

const temporary = tmpdir();
const prefix = join(temporary, "mobile-dev-android-handoff-");
const workspace = await mkdtemp(prefix);
try {
  const port = randomInt(20000, 65000);
  const serial = `127.0.0.1:${port}`;
  const fixture = new URL("./fixtures/android-handoff.ts", import.meta.url);
  const serverPath = fileURLToPath(fixture);
  const serverArgs = JSON.stringify([serverPath, serial]);
  const serverEnv = `{ HOME = ${JSON.stringify(workspace)}, MOBILE_DEV_TELEMETRY = "off" }`;
  const skillPath = new URL("../../../packages/skills/mobile-dev/SKILL.md", import.meta.url);
  const skill = await readFile(skillPath, "utf8");
  const context = `The macOS chat host displays MCP panels alongside the chat. Previous terminal results:
$ adc connect
Connected to Pixel 9.
$ command -v scrcpy
/opt/homebrew/bin/scrcpy

${skill}`;
  const args = [
    "exec", "--ephemeral", "--ignore-user-config", "--skip-git-repo-check", "--json",
    "--sandbox", "read-only", "--cd", workspace,
    "--disable", "shell_tool", "--disable", "unified_exec", "--disable", "plugins", "--disable", "apps",
    "--disable", "code_mode", "-c", "project_doc_max_bytes=0",
    "-c", `developer_instructions=${JSON.stringify(context)}`,
    "-c", `mcp_servers.mobile-dev.command=${JSON.stringify(process.execPath)}`,
    "-c", `mcp_servers.mobile-dev.args=${serverArgs}`,
    "-c", `mcp_servers.mobile-dev.env=${serverEnv}`,
    "-c", 'mcp_servers.mobile-dev.tools.exec_command.approval_mode="approve"',
    "Mach mir das Gerät auf, ich melde mich an.",
  ];
  const cli = process.env.CODEX_CLI_PATH ?? "codex";
  const run = spawnSync(cli, args, {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000, maxBuffer: 4 * 1024 * 1024,
  });
  if (run.error) throw run.error;
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const events = jsonLines(run.stdout);
  const finished = events.some(event => event.type === "turn.completed");
  assert.ok(finished, run.stdout);
  const probes = new Set(["command -v scrcpy", "which scrcpy", "scrcpy --version"]);
  const viewerCommand = /\b(?:scrcpy|osascript|Terminal|iTerm2?)\b|\badc["']?\s+mirror\b|\bopen\s+[^;&|\n]*\.(?:command|scpt)\b/i;
  const mobile = [];
  // Codex reports attempted calls even when an approval prevents MCP dispatch.
  for (const { type, item } of events) {
    if (!item) continue;
    assert.notEqual(item.type, "command_execution", "The agent used the real shell outside the fixture.");
    if (item.type !== "mcp_tool_call") continue;
    if (item.tool === "exec_command") {
      const command = item.arguments.cmd.trim();
      if (viewerCommand.test(command)) {
        const probe = probes.has(command);
        assert.ok(probe, `Unexpected viewer command: ${command}`);
      }
    } else if (type === "item.completed") {
      mobile.push(item);
    }
  }
  const names = mobile.map(call => call.tool);
  assert.deepEqual(names, ["mobile_list_android_devices", "mobile_open_simulator"]);
  const [listed, opened] = mobile;
  assert.equal(listed.status, "completed");
  assert.equal(opened.status, "completed");
  const devices = listed.result.structured_content.devices;
  const connected = devices.find(device => device.udid === serial);
  assert.equal(connected?.state, "Booted");
  const target = opened.arguments;
  assert.equal(target.platform, "android");
  assert.equal(target.deviceId, connected.udid);
  if (target.kind !== undefined) assert.equal(target.kind, connected.kind);
  const panelTarget = opened.result.structured_content.panelTarget;
  assert.deepEqual(panelTarget, target);
  const reply = events.findLast(event => event.type === "item.completed" && event.item.type === "agent_message");
  assert.ok(reply, "Expected the agent to hand the panel to the user.");
  assert.match(reply.item.text, /anmeld|melde dich|einlogg|logge? dich|(?:sign|log)[ -]?in/i);
  console.log(`${listed.tool} → ${opened.tool}`, panelTarget);
  console.log(reply.item.text);
} finally {
  await rm(workspace, { recursive: true, force: true });
}
