import { z } from "zod";
import { statusSchema } from "./protocol.ts";
import { physicalIosDeviceSchema } from "./ios-devices.ts";
import { panelTargetSchema } from "./panel-target.ts";
import { deviceSettingsSchema } from "./device-settings.ts";
import { metroTargetSchema } from "./logs.ts";
import { cpuTargetSchema } from "./cpu.ts";

// The structured results the panels read from Mobile Dev's own tools. Each matches what core returns;
// resource batches are beside their domain types (logBatchSchema, cpuBatchSchema, displayFpsBatchSchema,
// androidVideoBatchSchema, iosVideoBatchSchema).

/** mobile_list_simulators, mobile_boot_simulator, the Android listings and the other calls that answer with a device listing. */
export const simulatorStatusResultSchema = statusSchema.extend({ panelTarget: panelTargetSchema.optional() });
export type SimulatorStatusResult = z.infer<typeof simulatorStatusResultSchema>;

/** mobile_list_ios_devices. */
export const physicalIosDevicesResultSchema = z.object({ physicalDevices: z.array(physicalIosDeviceSchema) });
export type PhysicalIosDevicesResult = z.infer<typeof physicalIosDevicesResultSchema>;

export const inputStatusSchema = z.object({ state: z.enum(["ready", "blocked", "unknown"]) });
export type InputStatus = z.infer<typeof inputStatusSchema>;

const screenRect = z.object({ width: z.number().positive(), height: z.number().positive() }).loose();
// Backends add their own identity and chrome fields; the panel reads only the screen's size.
const streamDefinitionSchema = z.object({ screen: z.object({ rect: screenRect }).loose() }).loose();

/**
 * mobile_stream_session, mobile_android_stream_session and mobile_ios_mirror_session. A physical iPhone's mirror
 * returns no definition; only simulators report input status.
 */
export const streamSessionResultSchema = z.object({
  definition: streamDefinitionSchema.optional(),
  inputStatus: inputStatusSchema.optional(),
  inputRepairMessage: z.string().optional(),
}).loose();
export type StreamSessionResult = z.infer<typeof streamSessionResultSchema>;

/** The `_meta` of a stream session result: the session, where its frames are read, and the device chrome when one exists. */
export const streamSessionMetaSchema = z.object({ sessionId: z.string(), frameUri: z.string(), bezel: z.unknown().optional() }).loose();
export type StreamSessionMeta = z.infer<typeof streamSessionMetaSchema>;

/** mobile_device_settings returns every setting; mobile_update_device_setting returns the ones the change touched. */
export const deviceSettingsResultSchema = z.object({ settings: deviceSettingsSchema.partial() });
export type DeviceSettingsResult = z.infer<typeof deviceSettingsResultSchema>;

/** mobile_log_sources. */
export const logSourcesResultSchema = z.object({
  android: z.array(z.object({ id: z.string(), name: z.string() })),
  metro: z.array(metroTargetSchema),
  errors: z.array(z.string()),
});
export type LogSourcesResult = z.infer<typeof logSourcesResultSchema>;

/** mobile_logs_session's `_meta`; the structured result repeats these after the options. */
export const logSessionResultSchema = z.object({ sessionId: z.string(), logsUri: z.string() }).loose();
export type LogSessionResult = z.infer<typeof logSessionResultSchema>;

/** mobile_cpu_session. */
export const cpuSessionResultSchema = z.object({ target: cpuTargetSchema, sessionId: z.string(), cpuUri: z.string() });
export type CpuSessionResult = z.infer<typeof cpuSessionResultSchema>;

/** mobile_display_fps_session. `timeOrigin` is the server's monotonic clock, in seconds. */
export const displayFpsSessionResultSchema = z.object({ sessionId: z.string(), timeOrigin: z.number(), fpsUri: z.string() });
export type DisplayFpsSessionResult = z.infer<typeof displayFpsSessionResultSchema>;
