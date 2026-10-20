import { z } from "zod";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { captureServerError, recordAppStorageOperation } from "../telemetry.ts";
import { errorMessage } from "../../shared/protocol.ts";
import { expectedOutcome } from "../../shared/error-reporting.ts";
import { appTargetShape, bundleIdSchema } from "../../shared/app-control.ts";
import { storageLimits } from "../../shared/app-storage.ts";
import { systemCommands } from "../app-control/commands.ts";
import type { Commands } from "../app-control/commands.ts";
import type { AppDriver } from "../app-control/driver.ts";
import { createDrivers } from "../app-control/tools.ts";
import type { DriverFactory } from "../app-control/tools.ts";
import { AndroidContainer, SimulatorContainer } from "./container.ts";
import type { AppContainer } from "./container.ts";
import { clearStore, readStorage, readTable } from "./reader.ts";

type Target = { platform: "ios" | "android"; deviceId: string };
type Operation = "read" | "clear" | "reset" | "table";
export type ContainerFactory = (target: Target, bundleId: string) => Promise<AppContainer>;

export function createContainers(commands: Commands = systemCommands): ContainerFactory {
  return async ({ platform, deviceId }, bundleId) => platform === "android"
    ? new AndroidContainer(deviceId, bundleId, commands)
    : SimulatorContainer.open(deviceId, bundleId, commands);
}

const bundleId = bundleIdSchema.describe("App bundle ID or Android package name.");
const storeIdSchema = z.string().max(4096);
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

export function registerAppStorageTools(server: McpServer, commands: Commands = systemCommands, driverFor: DriverFactory = createDrivers(commands), containerFor: ContainerFactory = createContainers(commands)) {
  // Every operation opens the app's container on a validated device and reports one timing.
  async function run(operation: Operation, { platform, deviceId, bundleId }: Target & { bundleId: string }, work: (container: AppContainer, driver: AppDriver) => Promise<Record<string, unknown>>) {
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
      return { isError: true, content: [{ type: "text" as const, text: errorMessage(error) }] };
    }
  }

  registerAppTool(server, "mobile_app_storage", {
    title: "Read app storage",
    description: "Read an app's saved data (MMKV, AsyncStorage, UserDefaults, SharedPreferences, DataStore, SQLite, largest files) on iOS simulators and debuggable Android builds. MMKV types are guessed.",
    inputSchema: {
      ...appTargetShape, bundleId,
      store: storeIdSchema.optional().describe("A store ID to return alone."),
      entries: z.number().int().min(1).max(storageLimits.maxEntries).optional(),
      valueLength: z.number().int().min(40).max(storageLimits.maxValueLength).optional(),
    },
    annotations: readOnly,
    _meta: { ui: { visibility: ["app", "model"] } },
  }, input => run("read", input, async container => {
    const snapshot = await readStorage(container, { bundleId: input.bundleId, entries: input.entries ?? storageLimits.entries, valueLength: input.valueLength ?? storageLimits.valueLength, run: commands.run });
    return input.store ? { ...snapshot, stores: snapshot.stores.filter(store => store.id === input.store) } : snapshot;
  }));

  registerAppTool(server, "mobile_app_storage_table", {
    title: "Read a database table",
    description: "Read one page of rows from a SQLite table found by mobile_app_storage.",
    inputSchema: {
      ...appTargetShape, bundleId,
      store: storeIdSchema.describe("A SQLite store ID from mobile_app_storage."),
      table: z.string().min(1).max(512),
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(storageLimits.maxTableRows).optional(),
    },
    annotations: readOnly,
    // Panel-only: the shared model tool budget is full.
    _meta: { ui: { visibility: ["app"] } },
  }, input => run("table", input, container => readTable(container, input.store, input.table, {
    offset: input.offset ?? 0, limit: input.limit ?? storageLimits.tableRows, valueLength: storageLimits.tableValueLength, run: commands.run,
  })));

  registerAppTool(server, "mobile_clear_app_storage", {
    title: "Clear app storage",
    description: "Stop the app, then delete one store from mobile_app_storage, or all of the app's saved data when store is omitted. The app stays installed and is not relaunched.",
    inputSchema: { ...appTargetShape, bundleId, store: storeIdSchema.optional().describe("Store ID to clear. Omit to reset all app data.") },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    // Panel-only: the shared model tool budget is full, and clearing is a confirmed panel action.
    _meta: { ui: { visibility: ["app"] } },
  }, input => run(input.store ? "clear" : "reset", input, async (container, driver) => {
    // A running app keeps values in memory and would write them back.
    await driver.stop(input.bundleId);
    if (input.store === undefined) {
      await container.reset();
      return { cleared: "all", stopped: true };
    }
    return { cleared: (await clearStore(container, input.store)).name, stopped: true };
  }));
}
