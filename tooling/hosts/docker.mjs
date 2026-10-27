import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Runs the visual tests in the Playwright Linux image CI uses, so baselines made on
// a Mac match CI's fonts and rendering. Arguments pass through to Playwright, for
// example `--update-snapshots`. Linux dependencies live in a Docker volume, apart
// from the checkout's macOS node_modules.
const { version } = JSON.parse(readFileSync("node_modules/@playwright/test/package.json", "utf8"));
const script = [
  "npm ci --no-audit --no-fund",
  "npm run build:hosts",
  `npx playwright test -c tooling/hosts --grep @visual ${process.argv.slice(2).map(arg => `'${arg.replaceAll("'", "'\\''")}'`).join(" ")}`,
].join(" && ");
execFileSync("docker", [
  "run", "--rm", "--ipc=host", "-e", "HUSKY=0",
  "-v", `${process.cwd()}:/work`, "-v", "mobile-dev-playwright-modules:/work/node_modules", "-w", "/work",
  `mcr.microsoft.com/playwright:v${version}-noble`, "bash", "-c", script,
], { stdio: "inherit" });
