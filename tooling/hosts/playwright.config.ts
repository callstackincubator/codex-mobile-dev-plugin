import { defineConfig } from "@playwright/test";
import type { Target } from "./profiles.ts";

// Run `npm run build:hosts` first. Visual baselines are rendered in the pinned
// Playwright Linux image; update them with `npm run test:visual:docker -- --update-snapshots`.
export default defineConfig<{ target: Target }>({
  testDir: ".",
  testMatch: /\.spec\.ts$/,
  outputDir: "../../test-results/hosts",
  snapshotPathTemplate: "screenshots/{projectName}/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["github"], ["html", { open: "never", outputFolder: "../../playwright-report" }]] : "list",
  use: {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { animations: "disabled", caret: "hide", scale: "css", maxDiffPixelRatio: 0.001 },
  },
  // The Mac app's tests are tagged @mac; the other targets are MCP Apps hosts.
  // Visual baselines exist for Codex, the target on main, so only it runs @visual.
  projects: [
    { name: "codex", use: { target: "codex" }, grepInvert: /@mac|@browser/ },
    { name: "claude", use: { target: "claude" }, grepInvert: /@mac|@browser|@visual/ },
    { name: "browser", use: { target: "claude" }, grep: /@browser/ },
    { name: "mac", use: { target: "mac" }, grep: /@mac/, grepInvert: /@visual/ },
  ],
});
