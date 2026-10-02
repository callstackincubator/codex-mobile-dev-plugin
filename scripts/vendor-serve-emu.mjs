import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const runtime = "runtimes/serve-emu";
execFileSync("npm", ["ci", "--prefix", runtime, "--ignore-scripts", "--no-audit", "--no-fund"], { stdio: "inherit" });
const upstreamText = await readFile(`${runtime}/upstream.json`, "utf8");
const upstream = JSON.parse(upstreamText);
const server = await readFile(`${runtime}/vendor/scrcpy-server-v4.0`);
const serverHash = createHash("sha256");
serverHash.update(server);
const serverSHA256 = serverHash.digest("hex");
if (serverSHA256 !== upstream.scrcpySHA256) {
  throw new Error("The bundled scrcpy 4.0 server does not match its pinned SHA-256.");
}
console.log("Installed the Node.js dependencies for the serve-emu source fork and verified bundled scrcpy 4.0.");
