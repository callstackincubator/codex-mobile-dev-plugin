import { z } from "zod";

const bundleId = z.string().min(1).max(256);
const number = z.number();
const integer = number.int();
const positive = integer.positive();
const pid = positive.max(2147483647);
const nullableBundleId = bundleId.nullable();
const nullablePid = pid.nullable();
const foreground = z.boolean();
const optionalForeground = foreground.optional();
const app = z.object({ bundleId, pid, foreground: optionalForeground });
const apps = z.array(app);
const foregroundApp = z.object({ bundleId: nullableBundleId, pid: nullablePid });
const nullableForegroundApp = foregroundApp.nullable();
export const deviceAppsSchema = z.object({ apps, foregroundApp: nullableForegroundApp });
export type DeviceApp = z.infer<typeof app>;
export type DeviceApps = z.infer<typeof deviceAppsSchema>;
export type ForegroundApp = z.infer<typeof foregroundApp>;
