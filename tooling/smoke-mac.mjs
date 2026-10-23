import { spawn, execFileSync } from "node:child_process";
import { access, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Launches the built Mac app, waits for its page to connect to the bundled
// server and draw, then quits it and checks the server stopped. Pass a path to
// keep the page snapshot. It never boots or changes a device.
const app = resolve("release/mac/Mobile Dev.app");
await access(`${app}/Contents/MacOS/MobileDev`);
const directory = await mkdtemp(join(tmpdir(), "mobile-dev-mac-smoke-"));
const snapshot = resolve(process.argv[2] ?? join(directory, "page.png"));
const child = spawn(`${app}/Contents/MacOS/MobileDev`, [], {
  env: { ...process.env, MOBILE_DEV_SMOKE_SNAPSHOT: snapshot }, stdio: "ignore",
});
const servers = () => {
  try { return execFileSync("pgrep", ["-f", `${app}/Contents/Resources/runtime/server.mjs`], { encoding: "utf8" }).trim().split("\n").filter(Boolean); }
  catch { return []; }
};
try {
  const deadline = Date.now() + 90_000;
  let size = 0;
  while (Date.now() < deadline) {
    size = await stat(snapshot).then(file => file.size, () => 0);
    if (size > 0) break;
    if (child.exitCode !== null) throw new Error(`The app exited with status ${child.exitCode} before its page connected.`);
    await delay(500);
  }
  if (size === 0) throw new Error("The page did not connect and draw within 90 seconds.");
  if (servers().length !== 1) throw new Error(`Expected one bundled server process, found ${servers().length}.`);
  console.log(`The page connected to the bundled server and drew (${Math.round(size / 1024)} KB snapshot: ${snapshot}).`);
} finally {
  child.kill("SIGTERM");
  await new Promise(done => child.exitCode !== null ? done() : child.once("exit", done));
  const deadline = Date.now() + 10_000;
  while (servers().length && Date.now() < deadline) await delay(250);
  if (process.argv[2] === undefined) await rm(directory, { recursive: true, force: true });
}
if (servers().length) throw new Error("The bundled server kept running after the app quit.");
console.log("Quitting the app stopped the bundled server.");
