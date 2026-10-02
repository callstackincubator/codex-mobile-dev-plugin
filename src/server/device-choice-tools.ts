import * as Sentry from "@sentry/node";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OpenAIExtensions, OpenAIForm, OpenAIFormOption } from "@openai/mcp-extensions/server";
import { deviceChoiceInputSchema } from "../shared/device-choice.ts";
import type { DeviceChoice, DeviceChoiceInput, DeviceChoiceReference } from "../shared/device-choice.ts";
import type { PhysicalIosDevice } from "../shared/ios-devices.ts";
import type { SimulatorDevice, Status } from "../shared/protocol.ts";
import { errorMessage } from "../shared/protocol.ts";
import { captureServerError } from "./telemetry.ts";
import { SimulatorUnavailableError } from "./simulator-unavailable.ts";

export type DeviceChoiceSources = {
  simulators: () => Promise<Status>;
  android: () => Promise<Status>;
  physicalIos: () => Promise<PhysicalIosDevice[]>;
};

function phoneThumbnail(platform: "ios" | "android") {
  const color = platform === "ios" ? "#dbeafe" : "#dcfce7";
  const camera = platform === "ios"
    ? '<rect x="22" y="10" width="20" height="5" rx="2.5" fill="#18181b"/>'
    : '<circle cx="32" cy="12" r="2" fill="#18181b"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="100" viewBox="0 0 64 100"><rect x="9" y="2" width="46" height="96" rx="9" fill="#18181b"/><rect x="13" y="7" width="38" height="86" rx="5" fill="${color}"/>${camera}<rect x="18" y="28" width="28" height="22" rx="4" fill="#fff"/><rect x="18" y="56" width="20" height="4" rx="2" fill="#94a3b8"/><rect x="18" y="64" width="28" height="4" rx="2" fill="#94a3b8"/><rect x="24" y="86" width="16" height="2" rx="1" fill="#18181b"/></svg>`;
  const bytes = Buffer.from(svg);
  const encoded = bytes.toString("base64");
  return { src: `data:image/svg+xml;base64,${encoded}`, mimeType: "image/svg+xml" };
}

const thumbnails = { ios: phoneThumbnail("ios"), android: phoneThumbnail("android") };

export function deviceChoiceForm(input: DeviceChoiceInput, devices: DeviceChoice[]): OpenAIForm {
  const options: OpenAIFormOption[] = devices.map((device, index) => {
    const platform = device.platform === "ios" ? "iOS" : "Android";
    const kind = device.kind === "physical" ? "device" : device.kind;
    const details = [`${platform} ${kind}`];
    if (device.runtime && device.runtime !== platform) details.push(device.runtime);
    if (device.appName) details.push(device.appName);
    if (device.state === "Shutdown") details.push("Stopped");
    const description = details.join(" · ");
    return { const: `device-${index + 1}`, title: device.name, description, "x-openai-thumbnail": thumbnails[device.platform] };
  });
  if (input.selectionMode === "multiple") return {
    type: "object", required: ["devices"], properties: {
      devices: { type: "array", title: "Choose devices", description: input.context, minItems: 1, maxItems: devices.length, items: { anyOf: options } },
    },
  };
  return {
    type: "object", required: ["device"], properties: {
      device: { type: "string", title: "Choose a device", description: input.context, oneOf: options },
    },
  };
}

export async function resolveDeviceChoices(references: DeviceChoiceReference[], sources: DeviceChoiceSources): Promise<DeviceChoice[]> {
  const keys = new Set<string>();
  for (const reference of references) {
    const key = `${reference.platform}:${reference.deviceId}`;
    if (keys.has(key)) throw new SimulatorUnavailableError("Each candidate device must appear only once.");
    keys.add(key);
  }
  const reads: Promise<SimulatorDevice[]>[] = [];
  async function statusDevices(read: () => Promise<Status>) {
    const status = await read();
    if (status.connected === false) throw new SimulatorUnavailableError(status.error ?? "Device discovery is unavailable.");
    return status.devices;
  }
  const hasSimulators = references.some(device => device.platform === "ios" && device.kind === "simulator");
  const hasAndroid = references.some(device => device.platform === "android");
  const hasPhysicalIos = references.some(device => device.platform === "ios" && device.kind === "physical");
  if (hasSimulators) {
    const read = statusDevices(sources.simulators);
    reads.push(read);
  }
  if (hasAndroid) {
    const read = statusDevices(sources.android);
    reads.push(read);
  }
  if (hasPhysicalIos) {
    const read = sources.physicalIos();
    reads.push(read);
  }
  const lists = await Promise.all(reads);
  const discovered = lists.flat();
  return references.map(reference => {
    const device = discovered.find(candidate => {
      const platform = candidate.platform ?? "ios";
      const kind = candidate.kind ?? "simulator";
      return platform === reference.platform && kind === reference.kind && candidate.udid === reference.deviceId;
    });
    if (device === undefined) throw new SimulatorUnavailableError("A candidate device is no longer available. Refresh discovery before requesting a selection.");
    if (device.kind === "physical" && device.platform === "ios") {
      if (device.state !== "connected" || device.pairingState !== "paired") throw new SimulatorUnavailableError("Connect and pair the candidate iPhone or iPad before requesting a selection.");
    } else if (device.state !== "Booted" && device.state !== "Shutdown") {
      throw new SimulatorUnavailableError("A candidate device is offline or unauthorized. Reconnect it before requesting a selection.");
    }
    return { ...reference, name: device.name, runtime: device.runtime, state: device.state };
  });
}

export function registerDeviceChoiceTools(server: McpServer, extensions: Pick<OpenAIExtensions, "elicitInput">, sources: DeviceChoiceSources) {
  server.registerTool("mobile_choose_devices", {
    title: "Choose a device",
    description: "Ask the user which device(s) to use through a native inline request form when a mobile task has ambiguous targets. Discover candidates first with mobile_list_simulators, mobile_list_ios_devices or mobile_list_android_devices; pass their IDs, platform and kind. Add appName only when you have verified the app is on that device. message explains the task/question; context supplies operation details such as duration. selectionMode multiple permits selecting several. Wait for action accept, then use only returned devices. cancel/decline means do not perform the pending task. Does not boot devices, launch apps or start recording. Requires a host supporting OpenAI form elicitation.",
    inputSchema: deviceChoiceInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (input: DeviceChoiceInput, extra): Promise<CallToolResult> => {
    const attributes = { selection_mode: input.selectionMode };
    let stage: "prepare" | "request" | "validate" = "prepare";
    try {
      const capabilities = server.server.getClientCapabilities();
      const formCapability = capabilities?.extensions?.["openai/elicitation"];
      if (formCapability === undefined || typeof formCapability !== "object" || formCapability === null || "form" in formCapability === false) {
        Sentry.metrics.count("device_picker.result", 1, { attributes: { ...attributes, outcome: "unsupported" } });
        return { isError: true, content: [{ type: "text", text: "This host does not support OpenAI native request forms. No device was selected and the pending task must not start." }] };
      }
      const startedAt = performance.now();
      let devices: DeviceChoice[];
      try { devices = await resolveDeviceChoices(input.devices, sources); }
      finally {
        const duration = performance.now() - startedAt;
        Sentry.metrics.distribution("device_picker.prepare", duration, { unit: "millisecond", attributes });
      }
      extra.signal.throwIfAborted();
      const requestedSchema = deviceChoiceForm(input, devices);
      stage = "request";
      const answer = await extensions.elicitInput({ mode: "form", message: input.message, requestedSchema }, { signal: extra.signal, timeout: 600_000 });
      if (answer.action !== "accept") {
        Sentry.metrics.count("device_picker.result", 1, { attributes: { ...attributes, outcome: answer.action } });
        return { content: [{ type: "text", text: "Device selection cancelled. Do not start the pending task." }], structuredContent: { action: answer.action, devices: [] } };
      }
      stage = "validate";
      const submitted = input.selectionMode === "multiple" ? answer.content.devices : [answer.content.device];
      if (Array.isArray(submitted) === false || submitted.length === 0 || submitted.length > devices.length) throw new SimulatorUnavailableError("The device selection is invalid. Request a new selection.");
      const selected: DeviceChoiceReference[] = [];
      const selectedKeys = new Set<string>();
      for (const key of submitted) {
        if (typeof key !== "string" || selectedKeys.has(key)) throw new SimulatorUnavailableError("The device selection is invalid. Request a new selection.");
        selectedKeys.add(key);
        const index = devices.findIndex((_, candidateIndex) => key === `device-${candidateIndex + 1}`);
        if (index < 0) throw new SimulatorUnavailableError("The selected device was not offered. Request a new selection.");
        selected.push(input.devices[index]);
      }
      const current = await resolveDeviceChoices(selected, sources);
      extra.signal.throwIfAborted();
      Sentry.metrics.count("device_picker.result", 1, { attributes: { ...attributes, outcome: "accept" } });
      Sentry.metrics.distribution("device_picker.selected", current.length, { unit: "none", attributes });
      const data = { action: "accept", devices: current };
      const text = JSON.stringify(data);
      return { content: [{ type: "text", text }], structuredContent: data };
    } catch (error) {
      Sentry.metrics.count("device_picker.result", 1, { attributes: { ...attributes, outcome: extra.signal.aborted ? "cancel" : "failed" } });
      if (extra.signal.aborted === false && error instanceof SimulatorUnavailableError === false) {
        const report = new Error(`Device picker ${stage} failed.`);
        captureServerError(report, "device_picker.tool");
      }
      const message = errorMessage(error);
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  });
}
