import { z } from "zod";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { captureServerError, recordAppStorageOperation } from "../telemetry.ts";
import type { AppStorageOperation } from "../telemetry.ts";
import { ExpectedOperationError, expectedOutcome } from "@mobile-dev/shared/error-reporting.ts";
import { appTargetShape, bundleIdSchema } from "@mobile-dev/shared/app-control.ts";
import { storageLimits } from "@mobile-dev/shared/app-storage.ts";
import { systemCommands } from "../app-control/commands.ts";
import type { Commands } from "../app-control/commands.ts";
import type { AppDriver } from "../app-control/driver.ts";
import { createDrivers } from "../app-control/tools.ts";
import type { DriverFactory } from "../app-control/tools.ts";
import { AndroidContainer, SimulatorContainer } from "./container.ts";
import type { AppContainer } from "./container.ts";
import { clearStore, readStorage, readTable } from "./reader.ts";
import { previewFile } from "./preview.ts";

type Target = { platform: "ios" | "android"; deviceId: string };
export type ContainerFactory = (target: Target, bundleId: string) => Promise<AppContainer>;

export function createContainers(commands: Commands = systemCommands): ContainerFactory {
  return async ({ platform, deviceId }, bundleId) => platform === "android"
    ? new AndroidContainer(deviceId, bundleId, commands)
    : SimulatorContainer.open(deviceId, bundleId, commands);
}

const bundleId = bundleIdSchema.describe("App bundle ID or Android package name.");
const storeIdSchema = z.string().max(4096);
// Never relay device/SQLite diagnostics: even expected failures can contain paths,
// table names, SQL fragments, or values. Outcome categories retain useful recovery advice.
function safeStorageError(error: unknown): string {
  switch (expectedOutcome(error)) {
    case "invalid_input": return "The app, store, table, or requested fields are unavailable or invalid. Refresh the selected app storage and check the request.";
    case "unsupported_platform": return "App storage requires an iOS simulator or a debuggable Android app and the platform SDK. Physical iOS and Android release-build reads are unsupported.";
    case "device_unavailable": return "The selected device is unavailable. Check that it is booted, connected, and authorized.";
    case "cancelled": return "App storage operation cancelled.";
    default: return "App storage operation failed. Check the selected app and device, then retry.";
  }
}
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

export function registerAppStorageTools(server: McpServer, commands: Commands = systemCommands, driverFor: DriverFactory = createDrivers(commands), containerFor: ContainerFactory = createContainers(commands)) {
  // Every operation opens the app's container on a validated device and reports one timing.
  async function run(operation: AppStorageOperation, { platform, deviceId, bundleId }: Target & { bundleId: string }, work: (container: AppContainer, driver: AppDriver) => Promise<Record<string, unknown>>) {
    const startedAt = performance.now();
    try {
      // Resolving the driver validates the device ID before any command runs.
      const driver = driverFor({ platform, deviceId });
      const result = await work(await containerFor({ platform, deviceId }, bundleId), driver);
      recordAppStorageOperation(operation, platform, "success", performance.now() - startedAt);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      recordAppStorageOperation(operation, platform, "failed", performance.now() - startedAt);
      // Paths, keys, and values can be personal, so Sentry receives only the operation.
      captureServerError(expectedOutcome(error) === undefined ? new Error(`App storage ${operation} failed.`) : error, `app_storage.${operation}`);
      return { isError: true, content: [{ type: "text" as const, text: safeStorageError(error) }] };
    }
  }

  registerAppTool(server, "mobile_app_storage", {
    title: "Read app storage",
    description: "Read an app's saved data (MMKV, AsyncStorage, UserDefaults, SharedPreferences, DataStore, SQLite, largest files) on iOS simulators and debuggable Android builds. MMKV types are guessed. Values under recognized sensitive keys, credential-like text and binary data are redacted before results reach the host or panel. Use store and keys to narrow the result; filtering is not a guarantee that arbitrary app data is non-sensitive. Use synthetic test data.",
    inputSchema: {
      ...appTargetShape, bundleId,
      store: storeIdSchema.optional().describe("Read only this store; other stores are not decoded or returned."),
      keys: z.array(z.string().min(1).max(4096)).min(1).max(100).optional().describe("Exact keys to return from the specified store. Requires store."),
      entries: z.number().int().min(1).max(storageLimits.maxEntries).optional(),
      valueLength: z.number().int().min(40).max(storageLimits.maxValueLength).optional(),
    },
    annotations: readOnly,
    _meta: { ui: { visibility: ["app", "model"] } },
  }, input => run("read", input, async container => {
    if (input.keys !== undefined && input.store === undefined) throw new ExpectedOperationError("invalid_input", "Key selection requires a store.");
    return readStorage(container, { bundleId: input.bundleId, entries: input.entries ?? storageLimits.entries, valueLength: input.valueLength ?? storageLimits.valueLength, run: commands.run, store: input.store, keys: input.keys });
  }));

  registerAppTool(server, "mobile_app_storage_table", {
    title: "Read a database table",
    description: "Read rows from a SQLite table listed by mobile_app_storage, a page at a time. Returns column names/types, total row count and filtered cells. Sensitive columns, credential-like values, sensitive key/value rows and blobs are redacted. Use columns and a small limit to minimize data returned; use synthetic test data.",
    inputSchema: {
      ...appTargetShape, bundleId,
      store: storeIdSchema.describe("A SQLite store ID from mobile_app_storage."),
      table: z.string().min(1).max(512).describe("A table name listed for that store."),
      columns: z.array(z.string().min(1).max(512)).min(1).max(100).optional().describe("Exact columns to return; unselected cells are not read except key/name labels used locally for credential filtering."),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(storageLimits.maxTableRows).optional().describe(`Rows to return; defaults to ${storageLimits.tableRows}.`),
    },
    annotations: readOnly,
    _meta: { ui: { visibility: ["app", "model"] } },
  }, input => run("table", input, container => readTable(container, input.store, input.table, {
    offset: input.offset ?? 0, limit: input.limit ?? storageLimits.tableRows, valueLength: storageLimits.tableValueLength, run: commands.run, columns: input.columns,
  })));

  registerAppTool(server, "mobile_app_storage_file", {
    title: "Read an app data file",
    description: "Read one file listed by mobile_app_storage, decoded by its contents: JSON, property lists (including binary and NSKeyedArchiver archives) as JSON, or text. Content is filtered like storage values: sensitive keys and credential-like text are redacted, and binary data is withheld. Use synthetic test data.",
    inputSchema: { ...appTargetShape, bundleId, path: z.string().min(1).max(4096).describe("A file path from mobile_app_storage's files list.") },
    annotations: readOnly,
    _meta: { ui: { visibility: ["app", "model"] } },
  }, input => run("file", input, container => previewFile(container, input.path, {
    maxBytes: storageLimits.previewBytes, maxLength: storageLimits.previewLength, run: commands.run,
  })));

  registerAppTool(server, "mobile_clear_app_storage", {
    title: "Clear app storage",
    description: "Stop the app, then delete one store listed by mobile_app_storage, or all of the app's saved data when store is omitted. Deleted data cannot be recovered. The app stays installed and is not relaunched; launch it again to test a fresh state.",
    inputSchema: { ...appTargetShape, bundleId, store: storeIdSchema.optional().describe("Store ID to clear. Omit to reset all app data.") },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ["app", "model"] } },
  }, input => run(input.store ? "clear" : "reset", input, async (container, driver) => {
    // A running app keeps values in memory and would write them back.
    await driver.stop(input.bundleId);
    if (input.store === undefined) {
      await container.reset();
      return { cleared: "all", stopped: true };
    }
    await clearStore(container, input.store);
    return { cleared: "store", stopped: true };
  }));
}
