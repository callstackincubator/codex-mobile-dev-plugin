import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { physicalIosDeviceSchema } from "@mobile-dev/shared/ios-devices.ts";
import type { PhysicalIosDevice } from "@mobile-dev/shared/ios-devices.ts";
import { errorMessage } from "@mobile-dev/shared/protocol.ts";
import { errorCategory, FailureEpisodes } from "@mobile-dev/shared/error-reporting.ts";
import { listNativeIosConnections } from "./ios-native-capture.ts";
import type { NativeIosConnection } from "./ios-native-capture.ts";
import { captureServerError } from "./telemetry.ts";

const execute = promisify(execFile);
type DeviceCommand = (file: string, args: string[], options: { encoding: "utf8"; timeout: number; maxBuffer: number; signal?: AbortSignal }) => Promise<{ stdout: string }>;
const text = z.string();
const identifier = z.uuid();
const physical = z.literal("physical");
const ios = z.literal("iOS");
const success = z.literal("success");
const number = z.number();
const jsonVersion = number.min(5, "Physical iOS discovery requires Xcode 27 or later (devicectl JSON version 5 or later).");
const hardware = z.object({ udid: text, marketingName: text, productType: text, reality: physical, platform: ios });
const state = z.object({ name: text });
const osVersionNumber = z.object({ stringValue: text });
const software = z.object({ osVersionNumber });
const transportType = text.optional();
const connection = z.object({ state: text, transportType, pairingState: text });
const properties = z.object({ hardware, state, software, connection });
const device = z.object({ identifier, properties });
const devices = z.array(device);
const info = z.object({ jsonVersion, outcome: success });
const result = z.object({ devices });
const response = z.object({ info, result });

function normalizedUdid(udid: string) {
  const compact = udid.replaceAll("-", "");
  return compact.toLowerCase();
}

export async function listIosDevices(signal?: AbortSignal, run: DeviceCommand = execute, listConnections = listNativeIosConnections): Promise<PhysicalIosDevice[]> {
  signal?.throwIfAborted();
  const args = ["devicectl", "list", "devices", "--quiet", "--timeout", "10", "--omit-deprecated-fields-in-json",
    "--filter", "properties.hardware.reality = 'physical' AND properties.hardware.platform = 'iOS'", "--json-output", "-"];
  const output = await run("/usr/bin/xcrun", args, { encoding: "utf8", timeout: 15000, maxBuffer: 4 * 1024 * 1024, signal });
  signal?.throwIfAborted();
  let payload: unknown;
  try { payload = JSON.parse(output.stdout); }
  catch { throw new SyntaxError("devicectl returned invalid device discovery JSON."); }
  const parsed = response.safeParse(payload);
  if (parsed.success === false) {
    const detail = z.prettifyError(parsed.error);
    throw new Error(`devicectl returned unsupported device discovery JSON. ${detail}`);
  }
  const knownDevices = parsed.data.result.devices;
  if (knownDevices.length === 0) return [];
  const connections = await listConnections();
  signal?.throwIfAborted();
  const transports = new Map<string, NativeIosConnection["transportType"]>();
  for (const connection of connections) {
    const udid = normalizedUdid(connection.udid);
    if (transports.get(udid) !== "wired") transports.set(udid, connection.transportType);
  }
  return knownDevices.map(({ identifier, properties }) => {
    const udid = normalizedUdid(properties.hardware.udid);
    const transport = transports.get(udid);
    const { connection } = properties;
    // CoreDevice's connection state tracks its tunnel, which can close while usbmuxd still reaches the phone.
    const disconnectedState = connection.state === "connected" ? "disconnected" : connection.state;
    return {
      udid: properties.hardware.udid,
      coreDeviceId: identifier,
      name: properties.state.name,
      model: properties.hardware.marketingName,
      productType: properties.hardware.productType,
      state: transport ? "connected" : disconnectedState,
      runtime: `iOS ${properties.software.osVersionNumber.stringValue}`,
      platform: "ios",
      kind: "physical",
      transportType: transport ?? connection.transportType,
      pairingState: connection.pairingState,
    };
  });
}

export function registerIosDeviceTools(server: McpServer, discover: () => Promise<PhysicalIosDevice[]> = listIosDevices) {
  const physicalDevices = z.array(physicalIosDeviceSchema);
  const failures = new FailureEpisodes();
  server.registerTool("mobile_list_ios_devices", {
    title: "List physical iOS devices",
    description: "Discover physical iPhones and iPads with Xcode 27 and macOS USB or Wi-Fi device discovery. Returns the hardware UDID, CoreDevice ID, transport, connection and pairing state. Includes remembered disconnected or unavailable devices. This does not open a developer tunnel or a screen stream.",
    inputSchema: {}, outputSchema: { physicalDevices },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => {
    try {
      const physicalDevices = await discover();
      const text = JSON.stringify(physicalDevices);
      failures.recover("physical_ios");
      return { content: [{ type: "text", text }], structuredContent: { physicalDevices } };
    } catch (error) {
      const category = errorCategory(error);
      const report = failures.shouldReport("physical_ios", category);
      captureServerError(error, "ios.devices.discovery", { report });
      const text = errorMessage(error);
      return { isError: true, content: [{ type: "text", text }] };
    }
  });
}
