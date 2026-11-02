import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const cli = require.resolve("@commitlint/cli/cli.js");
const configUrl = new URL("../commitlint.config.mjs", import.meta.url);
const config = fileURLToPath(configUrl);

export function lintCommit(message) {
  execFileSync(process.execPath, [cli, "--config", config], {
    input: message, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  });
}
