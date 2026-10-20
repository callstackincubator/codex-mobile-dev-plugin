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
import { createDrivers } from "../app-control/tools.ts";
import type { DriverFactory } from "../app-control/tools.ts";
import { AndroidContainer, SimulatorContainer } from "./container.ts";
import type { AppContainer } from "./container.ts";
import { clearStore, readStorage } from "./reader.ts";

type Target = { platform: "ios" | "android"; deviceId: string };
export type ContainerFactory = (target: Target, bundleId: string) => Promise<AppContainer>;

export function createContainers(commands: Commands = systemCommands): ContainerFactory {
  return async ({ platform, deviceId }, bundleId) => platform === "android"
    ? new AndroidContainer(deviceId, bundleId, commands)
    : SimulatorContainer.open(deviceId, bundleId, commands);
}

const bundleId = bundleIdSchema.describe("App bundle ID or Android package name.");

export function registerAppStorageTools(server: McpServer, commands: Commands = systemCommands, driverFor: DriverFactory = createDrivers(commands), containerFor: ContainerFactory = createContainers(commands)) {
  async function run(operation: "read" | "clear" | "reset", target: Target, work: () => Promise<Record<string, unknown>>) {
    const startedAt = performance.now();
    try {
      const result = await work();
      recordAppStorageOperation(operation, target.platform, "success", performance.now() - startedAt);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      recordAppStorageOperation(operation, target.platform, "failed", performance.now() - startedAt);
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
      store: z.string().max(4096).optional().describe("A store ID to return alone."),
      entries: z.number().int().min(1).max(storageLimits.maxEntries).optional(),
      valueLength: z.number().int().min(40).max(storageLimits.maxValueLength).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ["app", "model"] } },
  }, async input => {
    const target = { platform: input.platform, deviceId: input.deviceId };
    return run("read", target, async () => {
      driverFor(target);
      const container = await containerFor(target, input.bundleId);
      const snapshot = await readStorage(container, { bundleId: input.bundleId, entries: input.entries ?? storageLimits.entries, valueLength: input.valueLength ?? storageLimits.valueLength, run: commands.run });
      return input.store ? { ...snapshot, stores: snapshot.stores.filter(store => store.id === input.store) } : snapshot;
    });
  });

  registerAppTool(server, "mobile_clear_app_storage", {
    title: "Clear app storage",
    description: "Stop the app, then delete one store from mobile_app_storage, or all of the app's saved data when store is omitted. The app stays installed and is not relaunched.",
    inputSchema: { ...appTargetShape, bundleId, store: z.string().max(4096).optional().describe("Store ID to clear. Omit to reset all app data.") },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    // Panel-only: the shared model tool budget is full, and clearing is a confirmed panel action.
    _meta: { ui: { visibility: ["app"] } },
  }, async input => {
    const target = { platform: input.platform, deviceId: input.deviceId };
    return run(input.store ? "clear" : "reset", target, async () => {
      const driver = driverFor(target);
      const container = await containerFor(target, input.bundleId);
      // A running app keeps values in memory and would write them back.
      await driver.stop(input.bundleId);
      if (input.store === undefined) {
        await container.reset();
        return { cleared: "all", stopped: true };
      }
      const store = await clearStore(container, input.store);
      return { cleared: store.name, stopped: true };
    });
  });
}
