import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { bezelGeometrySchema } from "@mobile-dev/shared/bezel.ts";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import type { Bezel } from "@mobile-dev/shared/bezel.ts";
import type { PhysicalIosDevice } from "@mobile-dev/shared/ios-devices.ts";
import { baguetteEnvironment } from "./baguette-runtime.ts";
import { captureServerError } from "./telemetry.ts";
import { isPng } from "./png.ts";

const execute = promisify(execFile);
type BezelCommand = (file: string, args: string[], options: { encoding: "buffer"; timeout: number; maxBuffer: number; env?: NodeJS.ProcessEnv }) => Promise<{ stdout: Buffer }>;
export type PhysicalIosBezelReader = (device: PhysicalIosDevice) => Promise<Bezel | undefined>;

const text = z.string();
const deviceTypeSchema = z.object({ name: text, modelIdentifier: text, bundlePath: text });
const deviceTypes = z.array(deviceTypeSchema);
const deviceTypesSchema = z.object({ devicetypes: deviceTypes });
const maskIdentifier = z.uuid();
const framebufferMask = maskIdentifier.optional();
const representedModelIdentifiers = z.array(text).default([]);
const profileSchema = z.object({ framebufferMask, representedModelIdentifiers });
const rectSchema = bezelGeometrySchema.shape.rect;
const viewportSchema = bezelGeometrySchema.shape.viewport;
const radiusSchema = bezelGeometrySchema.shape.clipRadius;
const layoutSchema = z.object({ screen: rectSchema, composite: viewportSchema, innerCornerRadius: radiusSchema });
const commandOptions = { encoding: "buffer", timeout: 15000, maxBuffer: 8 * 1024 * 1024 } satisfies Parameters<BezelCommand>[2];
const missingFrameRetryDelay = 5 * 60 * 1000;

function pngDataUri(bytes: Buffer): string {
  if (bytes.length > commandOptions.maxBuffer || isPng(bytes) === false) throw new Error("Invalid Apple device frame PNG.");
  const encoded = bytes.toString("base64");
  return `data:image/png;base64,${encoded}`;
}

async function readMask(identifier: string, run: BezelCommand): Promise<string> {
  const prefix = join(tmpdir(), "mobile-dev-device-mask-");
  const directory = await mkdtemp(prefix);
  try {
    const input = `/Library/Developer/DeviceKit/FramebufferMasks/${identifier}.pdf`;
    const output = join(directory, "mask.png");
    await run("/usr/bin/sips", ["-s", "format", "png", input, "--out", output], commandOptions);
    const bytes = await readFile(output);
    return pngDataUri(bytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function renderBezel(device: PhysicalIosDevice, run: BezelCommand, runtime: typeof baguetteEnvironment): Promise<Bezel> {
  const typesOutput = await run("/usr/bin/xcrun", ["simctl", "list", "devicetypes", "--json"], commandOptions);
  const typesJson = typesOutput.stdout.toString("utf8");
  const typesPayload = JSON.parse(typesJson);
  const types = deviceTypesSchema.parse(typesPayload);
  const family = device.productType.replace(/\d.*$/, "");
  const candidates = types.devicetypes.filter(type => type.modelIdentifier.startsWith(family));
  candidates.sort((a, b) => {
    const aPriority = Number(a.modelIdentifier === device.productType);
    const bPriority = Number(b.modelIdentifier === device.productType);
    return bPriority - aPriority;
  });
  let selected: { type: z.infer<typeof deviceTypeSchema>; profile: z.infer<typeof profileSchema> } | undefined;
  for (const type of candidates) {
    const profilePath = join(type.bundlePath, "Contents", "Resources", "profile.plist");
    const profileOutput = await run("/usr/bin/plutil", ["-convert", "json", "-o", "-", profilePath], commandOptions);
    const profileJson = profileOutput.stdout.toString("utf8");
    const profilePayload = JSON.parse(profileJson);
    const profile = profileSchema.parse(profilePayload);
    // A device type stands for its own model plus any variants it lists. Older Xcode profiles list none.
    if (type.modelIdentifier === device.productType || profile.representedModelIdentifiers.includes(device.productType)) {
      selected = { type, profile };
      break;
    }
  }
  // Without an installed device type the screen mirrors without a frame.
  if (selected === undefined) throw new ExpectedOperationError("unsupported_platform", "Xcode has no Apple device frame for this model.");
  const { type, profile } = selected;
  // Bundles, and the chunks they split into, sit in dist/ beside the helpers.
  const root = import.meta.url.endsWith(".mjs") ? "./baguette/" : "../../native/vendor/baguette/";
  const url = new URL(`${root}Baguette`, import.meta.url);
  const executable = fileURLToPath(url);
  const signal = AbortSignal.timeout(commandOptions.timeout);
  const environment = await runtime(executable, signal);
  const renderOptions = { ...commandOptions, env: environment };

  const layoutOutput = await run(executable, ["chrome", "layout", "--device-name", type.name], renderOptions);
  const layoutJson = layoutOutput.stdout.toString("utf8");
  const layoutPayload = JSON.parse(layoutJson);
  const layout = layoutSchema.parse(layoutPayload);
  // The CLI layout already includes button margins, unlike the simulator HTTP definition.
  const geometry = bezelGeometrySchema.parse({ rect: layout.screen, viewport: layout.composite, clipRadius: layout.innerCornerRadius });
  const imageOutput = await run(executable, ["chrome", "composite", "--device-name", type.name], renderOptions);
  const image = pngDataUri(imageOutput.stdout);
  const bezel: Bezel = { ...geometry, image };
  if (profile.framebufferMask !== undefined) bezel.mask = await readMask(profile.framebufferMask, run);
  return bezel;
}

export function createPhysicalIosBezelReader(run: BezelCommand = execute, runtime = baguetteEnvironment): PhysicalIosBezelReader {
  const cache = new Map<string, Promise<Bezel | undefined>>();
  async function read(device: PhysicalIosDevice): Promise<Bezel | undefined> {
    try {
      return await renderBezel(device, run, runtime);
    } catch (error) {
      // The frame is decoration, so a failed render mirrors without one. A missing device type only counts as expected.
      captureServerError(error, "ios-mirror.bezel");
    }
    // Reconnects reuse a missing frame until it is worth looking for again.
    setTimeout(() => cache.delete(device.productType), missingFrameRetryDelay).unref();
    return undefined;
  }
  return device => {
    const cached = cache.get(device.productType);
    if (cached !== undefined) return cached;
    const bezel = read(device);
    cache.set(device.productType, bezel);
    return bezel;
  };
}

export const readPhysicalIosBezel = createPhysicalIosBezelReader();
