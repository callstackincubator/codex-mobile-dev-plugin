import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

execFileSync("npm", ["ci", "--prefix", "runtimes/serve-emu", "--ignore-scripts", "--no-audit", "--no-fund"], { stdio: "inherit" });
const server = await readFile("runtimes/serve-emu/node_modules/serve-emu/vendor/scrcpy-server-v4.0");
if (createHash("sha256").update(server).digest("hex") !== "84924bd564a1eb6089c872c7521f968058977f91f5ff02514a8c74aff3210f3a") {
  throw new Error("The bundled scrcpy 4.0 server does not match its pinned SHA-256.");
}
console.log("Installed serve-emu 0.0.6 and checked its bundled scrcpy 4.0 server.");
