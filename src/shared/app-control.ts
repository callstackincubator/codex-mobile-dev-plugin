import { z } from "zod";

export const appPermissions = ["location", "photos", "camera", "microphone", "notifications", "contacts", "calendar", "reminders", "motion"] as const;
export type AppPermission = typeof appPermissions[number];
// simctl privacy has no camera or notification services; Android has no reminders or motion runtime permissions.
export const platformPermissions: Record<"ios" | "android", readonly AppPermission[]> = {
  ios: ["location", "photos", "microphone", "contacts", "calendar", "reminders", "motion"],
  android: ["location", "photos", "camera", "microphone", "notifications", "contacts", "calendar"],
};
export const permissionStates = ["allow", "deny", "ask"] as const;
export type PermissionState = typeof permissionStates[number];

export const bundleIdSchema = z.string().min(1).max(255).regex(/^[A-Za-z0-9_][A-Za-z0-9._-]*$/);
export const appUrlSchema = z.string().min(3).max(2048).regex(/^[A-Za-z][A-Za-z0-9+.-]*:\S+$/, "Expected a URL with a scheme, such as myapp://checkout.");
export const appTargetShape = {
  platform: z.enum(["ios", "android"]),
  deviceId: z.string().min(1).max(256),
};

const installedApp = z.object({ bundleId: bundleIdSchema, name: z.string() });
export const installedAppsSchema = z.object({ apps: z.array(installedApp), foregroundBundleId: bundleIdSchema.nullable(), runningBundleIds: z.array(bundleIdSchema).default([]) });
export type InstalledApp = z.infer<typeof installedApp>;
export type InstalledApps = z.infer<typeof installedAppsSchema>;

const permissionEntry = z.object({ permission: z.enum(appPermissions), state: z.enum(permissionStates).nullable() });
export const appPermissionsSchema = z.object({ permissions: z.array(permissionEntry) });
export type AppPermissionEntry = z.infer<typeof permissionEntry>;

export const appLinksSchema = z.object({ links: z.array(z.string().max(2048)) });

const appIcon = z.object({ icon: z.string().startsWith("data:image/png;base64,").max(256 * 1024).optional(), name: z.string().max(256).optional() });
export const appIconsSchema = z.object({ apps: z.record(z.string(), appIcon) });
export type AppIcon = z.infer<typeof appIcon>;
