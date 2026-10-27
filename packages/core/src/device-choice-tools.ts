import * as Sentry from "@sentry/node";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";
import { getUiCapability, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { OpenAIExtensions, OpenAIForm, OpenAIFormOption } from "@openai/mcp-extensions/server";
import { androidChoices, deviceChoiceInputSchema, DEVICES_URI, isRunningDevice, isSelectableDevice, physicalIosChoices, simulatorChoices } from "@mobile-dev/shared/device-choice.ts";
import type { DeviceChoice, DeviceChoiceInput, DeviceChoiceReference } from "@mobile-dev/shared/device-choice.ts";
import type { PhysicalIosDevice } from "@mobile-dev/shared/ios-devices.ts";
import type { Status } from "@mobile-dev/shared/protocol.ts";
import { errorMessage } from "@mobile-dev/shared/protocol.ts";
import { captureServerError } from "./telemetry.ts";
import { SimulatorUnavailableError } from "./simulator-unavailable.ts";
import { deviceChoiceThumbnails } from "./device-choice-thumbnails.ts";

export type DeviceChoiceSources = {
  simulators: () => Promise<Status>;
  android: () => Promise<Status>;
  physicalIos: () => Promise<PhysicalIosDevice[]>;
};
type DeviceChoiceMode = "form" | "card" | "browse";

const FORM_OPTION_LIMIT = 20;

export function deviceChoiceForm(input: DeviceChoiceInput, devices: DeviceChoice[]): OpenAIForm {
  const options: OpenAIFormOption[] = devices.map((device, index) => {
    const platform = device.platform === "ios" ? "iOS" : "Android";
    const kind = device.kind === "physical" ? "device" : device.kind;
    const details = [`${platform} ${kind}`];
    if (device.runtime && device.runtime !== platform) details.push(device.runtime);
    if (device.appName) details.push(device.appName);
    if (device.state === "Shutdown") details.push("Stopped");
    const description = details.join(" · ");
    return { const: `device-${index + 1}`, title: device.name, description, "x-openai-thumbnail": deviceChoiceThumbnails[device.platform] };
  });
  if (input.selectionMode === "multiple") return {
    type: "object", required: ["devices"], properties: {
      devices: { type: "array", description: input.context, minItems: 1, maxItems: devices.length, items: { anyOf: options } },
    },
  };
  return {
    type: "object", required: ["device"], properties: {
      device: { type: "string", description: input.context, oneOf: options },
    },
  };
}

async function statusDevices(read: () => Promise<Status>) {
  const status = await read();
  if (status.connected === false) throw new SimulatorUnavailableError(status.error ?? "Device discovery is unavailable.");
  return status;
}

export async function resolveDeviceChoices(references: DeviceChoiceReference[], sources: DeviceChoiceSources): Promise<DeviceChoice[]> {
  const keys = new Set<string>();
  for (const reference of references) {
    const key = `${reference.platform}:${reference.deviceId}`;
    if (keys.has(key)) throw new SimulatorUnavailableError("Each candidate device must appear only once.");
    keys.add(key);
  }
  const reads: Promise<DeviceChoice[]>[] = [];
  if (references.some(device => device.platform === "ios" && device.kind === "simulator")) reads.push(statusDevices(sources.simulators).then(simulatorChoices));
  if (references.some(device => device.platform === "android")) reads.push(statusDevices(sources.android).then(androidChoices));
  if (references.some(device => device.platform === "ios" && device.kind === "physical")) reads.push(sources.physicalIos().then(physicalIosChoices));
  const lists = await Promise.all(reads);
  const discovered = lists.flat();
  return references.map(reference => {
    const device = discovered.find(candidate => candidate.platform === reference.platform && candidate.kind === reference.kind && candidate.deviceId === reference.deviceId);
    if (device === undefined) throw new SimulatorUnavailableError("A candidate device is no longer available. Refresh discovery before requesting a selection.");
    if (isSelectableDevice(device) === false) {
      if (device.kind === "physical" && device.platform === "ios") throw new SimulatorUnavailableError("Connect and pair the candidate iPhone or iPad before requesting a selection.");
      throw new SimulatorUnavailableError("A candidate device is offline or unauthorized. Reconnect it before requesting a selection.");
    }
    return { ...reference, name: device.name, runtime: device.runtime, state: device.state, ...(device.transportType ? { transportType: device.transportType } : {}), ...(device.pairingState ? { pairingState: device.pairingState } : {}) };
  });
}

// Lists every device; one unavailable backend (no Android SDK, older Xcode) leaves the others listed.
export async function discoverDeviceChoices(sources: DeviceChoiceSources): Promise<{ devices: DeviceChoice[]; errors: string[] }> {
  const reads = await Promise.allSettled([
    statusDevices(sources.simulators).then(simulatorChoices),
    statusDevices(sources.android).then(androidChoices),
    sources.physicalIos().then(physicalIosChoices),
  ]);
  const devices: DeviceChoice[] = [];
  const errors: string[] = [];
  for (const read of reads) {
    if (read.status === "fulfilled") devices.push(...read.value);
    else errors.push(errorMessage(read.reason));
  }
  return { devices, errors };
}

export function supportsDeviceChoiceForms(capabilities: ClientCapabilities | undefined): boolean {
  const formCapability = capabilities?.extensions?.["openai/elicitation"];
  return typeof formCapability === "object" && formCapability !== null && "form" in formCapability;
}

// Codex renders app cards without advertising the standard extension; its form capability identifies it.
export function supportsDeviceCards(capabilities: ClientCapabilities | undefined): boolean {
  return getUiCapability(capabilities)?.mimeTypes?.includes(RESOURCE_MIME_TYPE) === true || supportsDeviceChoiceForms(capabilities);
}

function summary(devices: DeviceChoice[]) {
  const running = devices.filter(isRunningDevice).length;
  const physical = devices.filter(device => device.kind === "physical" && !isRunningDevice(device)).length;
  const parts = [`${running} running`];
  if (physical) parts.push(`${physical} disconnected physical`);
  parts.push(`${devices.length - running - physical} stopped`);
  return parts.join(", ");
}

export function registerDeviceChoiceTools(server: McpServer, extensions: Pick<OpenAIExtensions, "elicitInput">, sources: DeviceChoiceSources) {
  registerAppTool(server, "mobile_show_devices", {
    title: "Devices",
    description: "Show the user's iOS simulators, Android emulators and physical devices in an interactive card where they can boot, stop and pick devices. Use it whenever the user asks to list, show or see devices, or when a task has ambiguous targets. Omit devices to list everything discovered, or pass candidate IDs, platform and kind from mobile_list_simulators, mobile_list_ios_devices or mobile_list_android_devices. To ask the user to choose, set selectionMode (single or multiple) with a message explaining the task; context supplies operation details such as duration. Add appName only when you have verified the app is on that device. With a native request form the call waits: on action accept use only the returned devices; cancel/decline means do not perform the pending task. Otherwise the card shows the choice and the user replies in chat; wait for that reply before starting the task. Do not repeat the device list the card shows. This tool never boots devices, launches apps or starts recording; only the user can boot or stop a device from the card. For internal lookups use the list tools instead.",
    inputSchema: deviceChoiceInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { ui: { resourceUri: DEVICES_URI } },
  }, async (input: DeviceChoiceInput, extra): Promise<CallToolResult> => {
    const capabilities = server.server.getClientCapabilities();
    const cards = supportsDeviceCards(capabilities);
    let mode: DeviceChoiceMode = "browse";
    if (input.selectionMode !== undefined) mode = supportsDeviceChoiceForms(capabilities) ? "form" : "card";
    const attributes = { selection_mode: input.selectionMode ?? "none", mode };
    let stage: "prepare" | "request" | "validate" = "prepare";
    try {
      if (mode === "card" && cards === false) {
        Sentry.metrics.count("device_picker.result", 1, { attributes: { ...attributes, outcome: "unsupported" } });
        return { isError: true, content: [{ type: "text", text: "This host can show neither a native request form nor an app card. No device was selected; ask the user in chat and do not start the pending task until they choose." }] };
      }
      const startedAt = performance.now();
      let devices: DeviceChoice[];
      let errors: string[] = [];
      try {
        if (input.devices) devices = await resolveDeviceChoices(input.devices, sources);
        else {
          ({ devices, errors } = await discoverDeviceChoices(sources));
          if (mode !== "browse") devices = devices.filter(isSelectableDevice);
          // The native form offers a bounded list; running devices are the likeliest targets.
          if (mode === "form") devices = devices.sort((a, b) => Number(isRunningDevice(b)) - Number(isRunningDevice(a))).slice(0, FORM_OPTION_LIMIT);
          if (devices.length === 0 && errors.length > 0) throw new SimulatorUnavailableError(errors.join(" "));
        }
      } finally {
        const duration = performance.now() - startedAt;
        Sentry.metrics.distribution("device_picker.prepare", duration, { unit: "millisecond", attributes });
      }
      extra.signal.throwIfAborted();
      if (mode !== "form") {
        Sentry.metrics.count("device_picker.result", 1, { attributes: { ...attributes, outcome: "rendered" } });
        const data = { mode: mode === "card" ? "choose" : "browse", ...(input.selectionMode ? { selectionMode: input.selectionMode } : {}), ...(input.message ? { message: input.message } : {}), ...(input.context ? { context: input.context } : {}), devices, errors };
        let text = cards ? `Showing ${devices.length} devices in the Mobile Dev card (${summary(devices)}). Do not repeat the list.` : JSON.stringify(devices);
        if (errors.length) text += ` Some devices could not be listed: ${errors.join(" ")}`;
        if (mode === "card") text += " Wait for the user to choose in the card and reply in chat before starting the pending task.";
        return { content: [{ type: "text", text }], structuredContent: data };
      }
      if (devices.length === 0) throw new SimulatorUnavailableError("No device can be selected. Boot, connect or pair a device first.");
      const references: DeviceChoiceReference[] = devices.map(({ platform, kind, deviceId, appName }) => ({ platform, kind, deviceId, ...(appName ? { appName } : {}) }) as DeviceChoiceReference);
      const requestedSchema = deviceChoiceForm(input, devices);
      stage = "request";
      const answer = await extensions.elicitInput({ mode: "form", message: input.message!, requestedSchema }, { signal: extra.signal, timeout: 600_000 });
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
        selected.push(references[index]);
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
