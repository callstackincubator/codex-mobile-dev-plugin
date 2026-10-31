import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Event } from "@sentry/node";
import { setErrorDiagnostic } from "@mobile-dev/shared/error-diagnostics.ts";

export type InstallIntegrity = "intact" | "removed" | "replaced";
export type BundledRuntime = "serve-emu" | "baguette";

// Bundled, the server file in dist/ (server.mjs or a chunk) beside the runtimes. Hosts can update or
// uninstall the plugin while its server runs, removing or replacing it.
const serverFile = fileURLToPath(import.meta.url);
const loaded = serverFileStats();

function serverFileStats() {
  try { return statSync(serverFile); }
  catch { return undefined; }
}

/** Whether the server still runs from the files it loaded, or an update or uninstall removed or replaced them. */
export function installIntegrity(): InstallIntegrity {
  const current = serverFileStats();
  if (current === undefined) return "removed";
  if (loaded === undefined || current.ino === loaded.ino && current.mtimeMs === loaded.mtimeMs) return "intact";
  return "replaced";
}

/** Whether a failed access or spawn found no file, rather than a file it could not use. */
export function isMissingFile(error: unknown): boolean {
  const code = error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
  return code === "ENOENT" || code === "ENOTDIR";
}

const labels: Record<BundledRuntime, string> = { "serve-emu": "Android streaming backend", baguette: "simulator backend" };

/**
 * A runtime missing beside the server. Its integrity is the server's, or `incomplete`
 * when the server's files are intact, so the installation it started from lacks the runtime.
 * Retrying cannot help until Mobile Dev restarts or is reinstalled.
 */
export class MissingRuntimeError extends Error {
  readonly runtime: BundledRuntime;
  readonly integrity: Exclude<InstallIntegrity, "intact"> | "incomplete";

  constructor(runtime: BundledRuntime) {
    const integrity = installIntegrity();
    super(integrity === "intact"
      ? `This Mobile Dev installation is missing its ${labels[runtime]}. Reinstall Mobile Dev, then restart the app running it.`
      : `Mobile Dev was updated or removed while it was running and cannot find its ${labels[runtime]}. Restart the app running Mobile Dev to load the installed version.`);
    this.runtime = runtime;
    this.integrity = integrity === "intact" ? "incomplete" : integrity;
    setErrorDiagnostic(this, "installIntegrity", { integrity: this.integrity, runtime });
  }
}

export { installIntegrityTags } from "@mobile-dev/shared/error-diagnostics.ts";

/** Tags every error event of a server whose files were removed or replaced, however it was captured. */
export function tagInstallIntegrity(event: Event): Event {
  if (event.type !== undefined) return event;
  const integrity = installIntegrity();
  if (integrity !== "intact") event.tags = { install_integrity: integrity, ...event.tags };
  return event;
}
