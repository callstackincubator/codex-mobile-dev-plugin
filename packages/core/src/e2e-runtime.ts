import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { downloadedPanelRuntime, panelRuntimeDirectory, panelRuntimePath, type PanelRuntimeRelease } from "./panel-runtime.ts";
import pinnedRuntime from "../../runtimes/e2e/package.json" with { type: "json" };

export let testingRuntimeDownload: ReturnType<typeof downloadedPanelRuntime> | undefined;

export function useDownloadedTestingRuntime(release: PanelRuntimeRelease) {
  const directory = panelRuntimeDirectory(process.env, "testing-runtime");
  testingRuntimeDownload = downloadedPanelRuntime(release, directory, true);
}

export type TestingRuntimeMode = "project" | "bundled";

export interface TestingRuntimeDescriptor {
  mode: TestingRuntimeMode;
  root: string;
  e2eVersion: string;
  mobileVersion: string;
  reason?: string;
}

const modulePath = fileURLToPath(import.meta.url);
const moduleDirectory = dirname(modulePath);

/** The runner a project run executes (`runnerBin`); its presence is what makes a project's own setup usable. */
export const PROJECT_CLI = "node_modules/.bin/e2e";

/** Resolves the E2E runtime from the source tree or the packaged host's runtime. */
export async function bundledE2eRoot(): Promise<string> {
  if (testingRuntimeDownload) {
    const directory = await testingRuntimeDownload.ensure();
    return join(directory, "e2e");
  }
  const configured = process.env.MOBILE_DEV_E2E_RUNTIME?.trim();
  const root = configured || (modulePath.endsWith(".ts")
    ? resolve(moduleDirectory, "../../runtimes/e2e")
    : await panelRuntimePath("e2e"));
  const manifest = join(root, "node_modules/e2e/package.json");
  if (existsSync(manifest)) return root;
  throw new ExpectedOperationError("app_unavailable", "The bundled e2e runtime is missing. Reinstall Mobile Dev.");
}

async function version(root: string, name: string): Promise<string> {
  const metadata = JSON.parse(await readFile(join(root, "node_modules", name, "package.json"), "utf8"));
  return typeof metadata.version === "string" ? metadata.version : "unknown";
}

export async function bundledRuntimeDescriptor(reason?: string): Promise<TestingRuntimeDescriptor> {
  // Project discovery also runs behind the device panel. Reading its metadata must stay offline.
  if (testingRuntimeDownload) {
    const root = join(testingRuntimeDownload.target, "e2e");
    return {
      mode: "bundled", root, reason,
      e2eVersion: pinnedRuntime.dependencies.e2e,
      mobileVersion: pinnedRuntime.dependencies["@e2e-dev/mobile"],
    };
  }
  const root = await bundledE2eRoot();
  return {
    mode: "bundled",
    root,
    e2eVersion: await version(root, "e2e"),
    mobileVersion: await version(root, "@e2e-dev/mobile"),
    ...(reason ? { reason } : {}),
  };
}

export async function projectRuntimeDescriptor(projectPath: string): Promise<TestingRuntimeDescriptor | undefined> {
  const root = projectPath;
  // A project with its own e2e setup is authoritative whatever its version: runs go through the
  // project's own CLI, exactly as `npx e2e run` would. Only the recorder's tree projection is
  // version-sensitive, and it falls back to the bundled one on its own (see `testing-device.ts`).
  if (!existsSync(join(root, PROJECT_CLI))) return;
  const [e2eVersion, mobileVersion] = await Promise.all([
    version(root, "e2e"),
    version(root, "@e2e-dev/mobile").catch(() => "unknown"),
  ]);
  return {
    mode: "project",
    root,
    e2eVersion,
    mobileVersion,
  };
}

export async function verifyBundledE2eRuntime(): Promise<void> {
  const root = await bundledE2eRoot();
  const lock = await readFile(join(root, "package-lock.json"), "utf8");
  const release = JSON.parse(await readFile(join(root, "release.json"), "utf8"));
  const actual = createHash("sha256").update(lock).digest("hex");
  if (release.lockfileSHA256 !== actual) throw new Error("Bundled e2e runtime lockfile integrity check failed.");
  for (const name of Object.keys(release.packages ?? {})) {
    const installed = await version(root, name);
    if (release.packages?.[name]?.version !== installed) throw new Error(`Bundled ${name} version does not match release metadata.`);
  }
}
