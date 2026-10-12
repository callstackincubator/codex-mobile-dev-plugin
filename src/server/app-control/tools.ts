import { z } from "zod";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { androidIdSchema } from "../serve-emu.ts";
import { captureServerError } from "../telemetry.ts";
import { errorMessage, udidSchema } from "../../shared/protocol.ts";
import { ExpectedOperationError, expectedOutcome } from "../../shared/error-reporting.ts";
import { appPermissions, appTargetShape, appUrlSchema, bundleIdSchema, permissionStates, platformPermissions } from "../../shared/app-control.ts";
import { systemCommands } from "./commands.ts";
import type { Commands } from "./commands.ts";
import { AppDetailsCache, listApps } from "./driver.ts";
import type { AppDriver } from "./driver.ts";
import { SimulatorDriver } from "./simulator.ts";
import { AndroidDriver } from "./android.ts";

type Target = { platform: "ios" | "android"; deviceId: string };
export type DriverFactory = (target: Target) => AppDriver;

// Validates the target once; everything after this works with a single platform's driver.
export function createDrivers(commands: Commands = systemCommands): DriverFactory {
  const cache = new AppDetailsCache();
  return ({ platform, deviceId }) => {
    if (platform === "android") {
      if (!androidIdSchema.safeParse(deviceId).success || deviceId.startsWith("avd:")) throw new ExpectedOperationError("invalid_input", "Choose a running Android device serial.");
      return new AndroidDriver(deviceId, commands, cache);
    }
    if (!udidSchema.safeParse(deviceId).success) throw new ExpectedOperationError("invalid_input", "App tools support iOS simulators and Android devices. Pass an iOS simulator UDID.");
    if (process.platform !== "darwin") throw new ExpectedOperationError("unsupported_platform", "iOS simulators require macOS and Xcode.");
    return new SimulatorDriver(deviceId, commands, cache);
  };
}

type ToolConfig<Shape extends z.ZodRawShape> = { title: string; description: string; inputSchema: Shape; readOnly?: boolean; destructive?: boolean; panelOnly?: boolean };
type ToolInput<Shape extends z.ZodRawShape> = Target & z.infer<z.ZodObject<Shape>>;

const bundleId = bundleIdSchema.describe("App bundle ID or Android package name.");
const payloadSchema = z.record(z.string(), z.unknown()).refine(value => typeof value.aps === "object" && value.aps !== null, "Payload needs an aps object.");

export function registerAppControlTools(server: McpServer, driverFor: DriverFactory = createDrivers()) {
  function tool<Shape extends z.ZodRawShape>(name: string, action: string, config: ToolConfig<Shape>, handler: (driver: AppDriver, input: ToolInput<Shape>) => Promise<Record<string, unknown>>) {
    const inputSchema: z.ZodRawShape = { ...appTargetShape, ...config.inputSchema };
    registerAppTool(server, name, {
      title: config.title, description: config.description, inputSchema,
      annotations: { readOnlyHint: config.readOnly ?? false, destructiveHint: config.destructive ?? false, openWorldHint: false },
      _meta: { ui: { visibility: config.panelOnly ? ["app"] : ["app", "model"] } },
    }, async input => {
      // registerAppTool validated input against this exact shape; its generic callback type cannot express that.
      const parsed = input as ToolInput<Shape>;
      try {
        const result = await handler(driverFor(parsed), parsed);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        // Command output can contain app IDs, URLs, and device serials, so Sentry receives only the action.
        if (expectedOutcome(error) === undefined) captureServerError(new Error(`App ${action} command failed.`), `app_control.${action}`);
        return { isError: true, content: [{ type: "text" as const, text: errorMessage(error) }] };
      }
    });
  }

  tool("mobile_list_apps", "list", { title: "List installed apps", readOnly: true, inputSchema: {},
    description: "List user-installed apps on the selected iOS simulator or Android device. Returns bundle IDs, names, the foreground app, and running apps, foreground then most recent first." },
  listApps);
  tool("mobile_launch_app", "launch", { title: "Launch app", inputSchema: { bundleId },
    description: "Launch an installed app, restarting it if it is already running. Does not build; use the project's build tools first." },
  async (driver, input) => { await driver.launch(input.bundleId); return { launched: input.bundleId }; });
  tool("mobile_stop_app", "stop", { title: "Stop app", inputSchema: { bundleId }, description: "Terminate a running app on the device." },
    async (driver, input) => { await driver.stop(input.bundleId); return { stopped: input.bundleId }; });
  tool("mobile_install_app", "install", { title: "Install app", destructive: true,
    inputSchema: { path: z.string().min(1).max(4096).describe("Absolute path to a simulator .app bundle or an .apk.") },
    description: "Install or replace a built app on the device. Build it with the project's tools first." },
  async (driver, input) => ({ installed: true, ...await driver.install(input.path) }));
  tool("mobile_open_url", "open_url", { title: "Open URL", inputSchema: { url: appUrlSchema.describe("Deep link or web URL, such as myapp://checkout.") },
    description: "Open a deep link or URL on the device to jump straight to a screen." },
  async (driver, input) => { await driver.openUrl(input.url); return { opened: input.url }; });
  tool("mobile_app_icons", "icons", { title: "Read app icons", readOnly: true, panelOnly: true,
    inputSchema: { bundleIds: z.array(bundleIdSchema).max(200).optional() },
    description: "Read small PNG icons for installed apps, plus Android app labels." },
  async (driver, input) => ({ apps: await driver.details(input.bundleIds) }));
  tool("mobile_app_links", "links", { title: "Read app URL schemes", readOnly: true, panelOnly: true, inputSchema: { bundleId },
    description: "Read the URL schemes and Android link hosts an app declares, without SDK redirect schemes." },
  async (driver, input) => ({ links: await driver.links(input.bundleId) }));
  tool("mobile_app_permissions", "permissions", { title: "Read app permissions", readOnly: true, panelOnly: true, inputSchema: { bundleId },
    description: "Read supported app permissions. Android reports current states; iOS simulators report null." },
  async (driver, input) => ({ permissions: await driver.permissions(input.bundleId) }));
  tool("mobile_set_app_permission", "permission", { title: "Set app permission",
    inputSchema: { bundleId, permission: z.enum([...appPermissions, "all"]), state: z.enum(permissionStates).describe("allow grants, deny blocks, ask resets so the app prompts again.") },
    description: "Allow, deny, or reset an app permission without the system prompt. iOS simulators lack camera and notifications; Android lacks reminders and motion. Changes may restart the app." },
  async (driver, input) => {
    if (input.permission !== "all" && !platformPermissions[input.platform].includes(input.permission)) {
      throw new ExpectedOperationError("invalid_input", `${input.platform === "ios" ? "iOS simulators do" : "Android does"} not support the ${input.permission} permission here.`);
    }
    return { permissions: await driver.setPermission(input.bundleId, input.permission, input.state) };
  });
  tool("mobile_send_push", "push", { title: "Send test push",
    inputSchema: { bundleId, payload: payloadSchema.describe("APNs payload with an aps object, such as {\"aps\":{\"alert\":\"Hi\"}}.") },
    description: "Send a test push notification to an app on an iOS simulator." },
  async (driver, input) => { await driver.push(input.bundleId, input.payload); return { sent: true }; });
}
