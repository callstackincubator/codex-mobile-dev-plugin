import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const runtime = "runtimes/serve-emu";
execFileSync("npm", ["ci", "--prefix", runtime, "--include=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { stdio: "inherit" });
const patchCommand = resolve(runtime, "node_modules/patch-package/index.js");
execFileSync(process.execPath, [patchCommand, "--error-on-fail"], { cwd: runtime, stdio: "inherit" });
execFileSync("npm", ["prune", "--prefix", runtime, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { stdio: "inherit" });
const server = await readFile("runtimes/serve-emu/node_modules/serve-emu/vendor/scrcpy-server-v4.0");
const serverHash = createHash("sha256");
serverHash.update(server);
const serverSHA256 = serverHash.digest("hex");
if (serverSHA256 !== "84924bd564a1eb6089c872c7521f968058977f91f5ff02514a8c74aff3210f3a") {
  throw new Error("The bundled scrcpy 4.0 server does not match its pinned SHA-256.");
}
console.log("Installed and patched serve-emu 0.0.6 and checked its bundled scrcpy 4.0 server.");
