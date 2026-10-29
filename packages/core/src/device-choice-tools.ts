import * as Sentry from "@sentry/node";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ClientCapabilities, ElicitRequestFormParams, ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import type { OpenAIExtensions, OpenAIForm, OpenAIFormOption } from "@openai/mcp-extensions/server";
import { androidChoices, deviceChoiceInputSchema, isRunningDevice, isSelectableDevice, physicalIosChoices, simulatorChoices } from "@mobile-dev/shared/device-choice.ts";
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
/** The native request form a host renders: OpenAI's extension (Codex) or MCP's own elicitation. */
export type DeviceChoiceForm = "openai" | "mcp";

const FORM_OPTION_LIMIT = 20;

function deviceDetails(device: DeviceChoice) {
  const platform = device.platform === "ios" ? "iOS" : "Android";
  const kind = device.kind === "physical" ? "device" : device.kind;
  const details = [`${platform} ${kind}`];
  if (device.runtime && device.runtime !== platform) details.push(device.runtime);
  if (device.appName) details.push(device.appName);
  if (device.state === "Shutdown") details.push("Stopped");
  return details.join(" · ");
}

/** A form offering the devices as `options`: one device, or several when the input asks for them. */
function choiceForm<Option extends { const: string; title: string }>(input: DeviceChoiceInput, options: Option[], labels?: { device: string; devices: string }) {
  const description = input.context === undefined ? {} : { description: input.context };
  const [key, field] = input.selectionMode === "multiple"
    ? ["devices", { type: "array" as const, ...labels && { title: labels.devices }, ...description, minItems: 1, maxItems: options.length, items: { anyOf: options } }] as const
    : ["device", { type: "string" as const, ...labels && { title: labels.device }, ...description, oneOf: options }] as const;
  return { type: "object" as const, required: [key], properties: { [key]: field } };
}

/** OpenAI's form shows each device with its details and a phone thumbnail. */
export function deviceChoiceForm(input: DeviceChoiceInput, devices: DeviceChoice[]): OpenAIForm {
  return choiceForm(input, devices.map((device, index): OpenAIFormOption => ({
    const: `device-${index + 1}`, title: device.name, description: deviceDetails(device), "x-openai-thumbnail": deviceChoiceThumbnails[device.platform],
  })));
}

/** MCP's titled options carry only a title, so it includes the device's details. */
export function mcpDeviceChoiceForm(input: DeviceChoiceInput, devices: DeviceChoice[]): ElicitRequestFormParams["requestedSchema"] {
  return choiceForm(input, devices.map((device, index) => ({ const: `device-${index + 1}`, title: `${device.name} (${deviceDetails(device)})` })),
    { device: "Device", devices: "Devices" });
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

/** The native form the client renders, preferring OpenAI's, which shows thumbnails. */
export function deviceChoiceFormSupport(capabilities: ClientCapabilities | undefined): DeviceChoiceForm | undefined {
  const openai = capabilities?.extensions?.["openai/elicitation"];
  if (typeof openai === "object" && openai !== null && "form" in openai) return "openai";
  // The SDK reads an empty elicitation capability as forms, as MCP specifies.
  if (capabilities?.elicitation?.form !== undefined) return "mcp";
}

/** Asks the user to choose task devices in the host's native form; listed only for hosts that render one. */
export function registerDeviceChoiceTools(server: McpServer, extensions: Pick<OpenAIExtensions, "elicitInput">, sources: DeviceChoiceSources, form: DeviceChoiceForm) {
  server.registerTool("mobile_choose_devices", {
    title: "Choose devices",
    description: "Ask the user to choose the devices for a task in a native form when the target is ambiguous, for example which device to run or profile on. Set selectionMode single or multiple and a message explaining the task; context supplies operation details such as duration. Omit devices to offer every selectable device, running ones first, or pass candidates with platform, kind and deviceId from a device list. Add appName only when you have verified the app is on that device. The call waits for the user: on action accept use only the returned devices; cancel or decline means do not perform the pending task. It never boots devices, launches apps or starts recording.",
    inputSchema: deviceChoiceInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (input: DeviceChoiceInput, extra): Promise<CallToolResult> => {
    const attributes = { selection_mode: input.selectionMode, form };
    let stage: "prepare" | "request" | "validate" = "prepare";
    try {
      const startedAt = performance.now();
      let devices: DeviceChoice[];
      try {
        if (input.devices) devices = await resolveDeviceChoices(input.devices, sources);
        else {
          const discovered = await discoverDeviceChoices(sources);
          // The form offers a bounded list; running devices are the likeliest targets.
          devices = discovered.devices.filter(isSelectableDevice).sort((a, b) => Number(isRunningDevice(b)) - Number(isRunningDevice(a))).slice(0, FORM_OPTION_LIMIT);
          if (devices.length === 0 && discovered.errors.length > 0) throw new SimulatorUnavailableError(discovered.errors.join(" "));
        }
      } finally {
        const duration = performance.now() - startedAt;
        Sentry.metrics.distribution("device_picker.prepare", duration, { unit: "millisecond", attributes });
      }
      extra.signal.throwIfAborted();
      if (devices.length === 0) throw new SimulatorUnavailableError("No device can be selected. Boot, connect or pair a device first.");
      const references: DeviceChoiceReference[] = devices.map(({ platform, kind, deviceId, appName }) => ({ platform, kind, deviceId, ...(appName ? { appName } : {}) }) as DeviceChoiceReference);
      stage = "request";
      const options = { signal: extra.signal, timeout: 600_000 };
      const answer: ElicitResult = form === "openai"
        ? await extensions.elicitInput({ mode: "form", message: input.message, requestedSchema: deviceChoiceForm(input, devices) }, options)
        : await server.server.elicitInput({ message: input.message, requestedSchema: mcpDeviceChoiceForm(input, devices) }, options);
      if (answer.action !== "accept") {
        Sentry.metrics.count("device_picker.result", 1, { attributes: { ...attributes, outcome: answer.action } });
        return { content: [{ type: "text", text: "Device selection cancelled. Do not start the pending task." }], structuredContent: { action: answer.action, devices: [] } };
      }
      stage = "validate";
      const submitted = input.selectionMode === "multiple" ? answer.content?.devices : [answer.content?.device];
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
      return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
    } catch (error) {
      Sentry.metrics.count("device_picker.result", 1, { attributes: { ...attributes, outcome: extra.signal.aborted ? "cancel" : "failed" } });
      if (extra.signal.aborted === false && error instanceof SimulatorUnavailableError === false) {
        const report = new Error(`Device picker ${stage} failed.`);
        captureServerError(report, "device_picker.tool");
      }
      return { isError: true, content: [{ type: "text", text: errorMessage(error) }] };
    }
  });
}
