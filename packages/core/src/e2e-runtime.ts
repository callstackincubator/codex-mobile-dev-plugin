import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";

export type TestingRuntimeMode = "project" | "bundled";

export interface TestingRuntimeDescriptor {
  mode: TestingRuntimeMode;
  root: string;
  e2eVersion: string;
  mobileVersion: string;
  reason?: string;
}

const sourceRuntime = resolve("packages/runtimes/e2e");

/** The shipped runtime beside server.mjs, with the source tree fallback used by unit tests. */
export function bundledE2eRoot(): string {
  const configured = process.env.MOBILE_DEV_E2E_RUNTIME?.trim();
  const besideServer = join(dirname(fileURLToPath(import.meta.url)), "e2e");
  for (const candidate of [configured, besideServer, sourceRuntime]) {
    if (candidate && existsSync(join(candidate, "node_modules/e2e/package.json"))) return candidate;
  }
  throw new ExpectedOperationError("app_unavailable", "The bundled e2e runtime is missing. Reinstall Mobile Dev.");
}

async function version(root: string, name: string): Promise<string> {
  const metadata = JSON.parse(await readFile(join(root, "node_modules", name, "package.json"), "utf8"));
  return typeof metadata.version === "string" ? metadata.version : "unknown";
}

export async function bundledRuntimeDescriptor(reason?: string): Promise<TestingRuntimeDescriptor> {
  const root = bundledE2eRoot();
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
  if (!existsSync(join(root, "node_modules/.bin/e2e"))
    || !existsSync(join(root, "node_modules/@e2e-dev/mobile/dist/nodes.js"))) return;
  const [e2eVersion, mobileVersion, bundled] = await Promise.all([
    version(root, "e2e"), version(root, "@e2e-dev/mobile"), bundledRuntimeDescriptor(),
  ]);
  const apiLine = (value: string) => value.split(".").slice(0, 2).join(".");
  // Studio imports the runner's public CLI and mobile projection. Keep the project authoritative
  // only on the API lines the shipped Studio was tested against; a newer or older local install
  // remains untouched and Studio falls back to its pinned runtime.
  if (apiLine(e2eVersion) !== apiLine(bundled.e2eVersion)
    || apiLine(mobileVersion) !== apiLine(bundled.mobileVersion)) return;
  return {
    mode: "project",
    root,
    e2eVersion,
    mobileVersion,
  };
}

export async function verifyBundledE2eRuntime(): Promise<void> {
  const root = bundledE2eRoot();
  const lock = await readFile(join(root, "package-lock.json"), "utf8");
  const release = JSON.parse(await readFile(join(root, "release.json"), "utf8"));
  const actual = createHash("sha256").update(lock).digest("hex");
  if (release.lockfileSHA256 !== actual) throw new Error("Bundled e2e runtime lockfile integrity check failed.");
  for (const name of Object.keys(release.packages ?? {})) {
    const installed = await version(root, name);
    if (release.packages?.[name]?.version !== installed) throw new Error(`Bundled ${name} version does not match release metadata.`);
  }
}
