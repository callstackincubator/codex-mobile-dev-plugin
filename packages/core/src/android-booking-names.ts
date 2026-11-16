import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { androidBookingNameSchema } from "@mobile-dev/shared/android-devices.ts";
import type { AndroidBookingNames } from "@mobile-dev/shared/android-devices.ts";
import type { SimulatorDevice } from "@mobile-dev/shared/protocol.ts";

const bookingLabelSchema = z.object({
  name: androidBookingNameSchema,
  pid: z.number().int().positive(),
});

async function readBookingName(directory: string, device: SimulatorDevice) {
  if (device.kind !== "physical" || device.platform !== "android" || device.state !== "Booted") return;
  if (device.model !== "ADC" && device.model?.startsWith("ADC ") !== true) return;
  const match = /^127\.0\.0\.1:([1-9]\d{0,4})$/.exec(device.udid);
  if (!match || Number(match[1]) > 65535) return;
  const path = join(directory, `${match[1]}.json`);
  try {
    const contents = await readFile(path, "utf8");
    const data: unknown = JSON.parse(contents);
    const label = bookingLabelSchema.parse(data);
    process.kill(label.pid, 0);
    return label.name;
  } catch {
    return;
  }
}

export async function androidBookingNames(devices: SimulatorDevice[]): Promise<AndroidBookingNames> {
  const directory = join(homedir(), ".local", "state", "agent-device-cloud", "adb-labels");
  const names: AndroidBookingNames = {};
  await Promise.all(devices.map(async device => {
    const name = await readBookingName(directory, device);
    if (name !== undefined) names[device.udid] = name;
  }));
  return names;
}
