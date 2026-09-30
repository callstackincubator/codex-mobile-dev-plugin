import { spawn, execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const runtime = fileURLToPath(new URL("./agent-device/", import.meta.url));
const cli = join(runtime, "node_modules/agent-device/bin/agent-device.mjs");
const stateDir = await mkdtemp(join(tmpdir(), "mobile-dev-agent-device-"));
// Use this package's config and daemon rather than an inherited global/cloud setup.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_DEVICE_")));
Object.assign(env, {
  AGENT_DEVICE_CONFIG: join(runtime, "config.json"),
  AGENT_DEVICE_STATE_DIR: stateDir,
  AGENT_DEVICE_NO_UPDATE_NOTIFIER: "1",
});
console.error(`[mobile-dev] agent-device state directory: ${stateDir}`);
const child = spawn(process.execPath, [cli, "mcp"], { cwd: stateDir, env, stdio: ["pipe", "inherit", "inherit"] });
const exited = new Promise(resolve => {
  child.once("exit", (code, signal) => resolve({ code, signal }));
  child.once("error", error => {
    console.error(`[mobile-dev] agent-device failed to start: ${error.message}`);
    resolve({ code: 1 });
  });
});

async function waitForExit(timeout) {
  let timer;
  try {
    return await Promise.race([exited.then(() => true), new Promise(resolve => {
      timer = setTimeout(() => resolve(false), timeout);
    })]);
  } finally { clearTimeout(timer); }
}

let closing;
function close(signal) {
  if (closing) return closing;
  closing = (async () => {
    process.stdin.unpipe(child.stdin);
    process.stdin.destroy();
    child.stdin.end();
    if (signal) child.kill(signal);
    if (!await waitForExit(1000)) child.kill("SIGTERM");
    if (!await waitForExit(1000)) child.kill("SIGKILL");
    try {
      // The CLI verifies the daemon's PID identity and cleans only its own runner leases.
      await promisify(execFile)(process.execPath, [cli, "daemon", "stop", "--state-dir", stateDir, "--clean"], {
        cwd: stateDir, env, timeout: 10000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      console.error(`[mobile-dev] agent-device cleanup failed: ${error.stderr?.trim() || error.message}`);
    }
    // Keep logs and artifacts readable after a chat closes. The OS manages this temp directory.
    process.exitCode = (await exited).code ?? 0;
  })();
  return closing;
}

process.stdin.pipe(child.stdin);
child.stdin.on("error", error => {
  if (error.code !== "EPIPE") console.error(`[mobile-dev] agent-device stdin: ${error.message}`);
  void close("SIGTERM");
});
process.stdin.once("end", () => { void close(); });
process.stdin.once("close", () => { void close(); });
process.on("SIGINT", () => { void close("SIGINT"); });
process.on("SIGTERM", () => { void close("SIGTERM"); });
void exited.then(() => close());
