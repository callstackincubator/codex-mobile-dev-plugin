import { readFile } from "node:fs/promises";
import { join } from "node:path";

export function telemetryBuildEnvironment(args = process.argv.slice(2)) {
  if (args.length === 0) return "development";
  if (args.length === 1 && args[0] === "--release") return "release";
  throw new Error("Use --release for a public release build, or omit it for development.");
}

export async function assertBuildEnvironment(directory, environment) {
  const configPath = join(directory, "telemetry-environment.json");
  const configText = await readFile(configPath, "utf8");
  const config = JSON.parse(configText);
  const htmlPath = join(directory, "app.html");
  const html = await readFile(htmlPath, "utf8");
  const marker = `name="mobile-dev-environment" content="${environment}"`;
  if (config?.environment !== environment || html.includes(marker) === false) {
    const command = environment === "release" ? "npm run build -- --release" : "npm run build";
    throw new Error(`The package requires a ${environment} build. Run ${command} first.`);
  }
}
