import { randomBytes } from "node:crypto";
import { execText } from "./exec.ts";
import type {
  AppActionResponse,
  FileImportResponse,
} from "./shared/api-contracts.ts";

export type AppActionResult = AppActionResponse;
export type FileImportResult = FileImportResponse;

export type LocalUploadFile = {
  path: string;
  filename: string;
  mediaType: string;
  size: number;
};

export type AppManagementErrorCode =
  | "adb-failed"
  | "adb-timeout"
  | "adb-cleanup-failed";

export type AppManagementDependencies = {
  execText?: typeof execText;
  uploadId?: () => string;
};

export class AppManagementError extends Error {
  constructor(
    readonly code: AppManagementErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AppManagementError";
  }
}

const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const PERMISSION_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const ACTIVITY_RE = /^([A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+|\.?[A-Za-z][A-Za-z0-9_.$]*)(\/[A-Za-z0-9_.$]+)?$/;

function output(stdout: string, stderr: string): string {
  return `${stdout}${stderr}`.trim();
}

async function adb(
  serial: string,
  args: string[],
  timeout = 30_000,
  signal?: AbortSignal,
  runExec: typeof execText = execText,
): Promise<AppActionResult> {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The operation was aborted", "AbortError");
  }
  const result = await runExec("adb", ["-s", serial, ...args], {
    timeout,
    signal,
    lane: "background",
  });
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The operation was aborted", "AbortError");
  }
  const text = output(result.stdout, result.stderr);
  if (result.timedOut) {
    throw new AppManagementError(
      "adb-timeout",
      text || `adb ${args.join(" ")} timed out`,
      { cause: result.error },
    );
  }
  if (result.error) {
    throw new AppManagementError(
      "adb-failed",
      text || result.error.message || `adb ${args.join(" ")} failed`,
      { cause: result.error },
    );
  }
  if (result.status !== 0) {
    throw new AppManagementError(
      "adb-failed",
      text || `adb ${args.join(" ")} failed`,
    );
  }
  return { ok: true, output: text };
}

function adbHost(
  serial: string,
  args: string[],
  timeout = 30_000,
  signal?: AbortSignal,
  runExec: typeof execText = execText,
): Promise<AppActionResult> {
  return adb(serial, args, timeout, signal, runExec);
}

function validate(value: unknown, name: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value.trim())) {
    throw new Error(`${name} is invalid`);
  }
  return value.trim();
}

export function packageName(value: unknown): string {
  return validate(value, "packageName", PACKAGE_RE);
}

export function activityName(value: unknown): string {
  return validate(value, "activity", ACTIVITY_RE);
}

export function permissionName(value: unknown): string {
  return validate(value, "permission", PERMISSION_RE);
}

export async function installApk(
  serial: string,
  file: LocalUploadFile,
  signal?: AbortSignal,
  dependencies: AppManagementDependencies = {},
): Promise<AppActionResult> {
  if (!file.filename.toLowerCase().endsWith(".apk")) {
    throw new Error("APK file must end with .apk");
  }
  return adb(
    serial,
    ["install", "-r", file.path],
    120_000,
    signal,
    dependencies.execText,
  );
}

function safeFileName(name: string, fallback: string): string {
  const clean = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean && clean !== "." && clean !== ".." ? clean : fallback;
}

function mediaKind(file: LocalUploadFile): FileImportResult["kind"] {
  if (file.mediaType.startsWith("image/")) return "image";
  if (file.mediaType.startsWith("video/")) return "video";
  const lower = file.filename.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|heic|heif)$/.test(lower)) return "image";
  if (/\.(mp4|m4v|mov|webm|3gp|mkv)$/.test(lower)) return "video";
  return "file";
}

export async function importMediaFile(
  serial: string,
  file: LocalUploadFile,
  signal?: AbortSignal,
  dependencies: AppManagementDependencies = {},
): Promise<FileImportResult> {
  const uploadId =
    dependencies.uploadId?.() ?? randomBytes(6).toString("hex");
  const filename = safeFileName(file.filename, `upload-${uploadId}`);
  const kind = mediaKind(file);
  const remoteDir =
    kind === "image" ? "/sdcard/Pictures" : kind === "video" ? "/sdcard/Movies" : "/sdcard/Download";
  const remotePath = `${remoteDir}/${filename}`;
  const partialPath = `${remoteDir}/.serve-emu-${uploadId}-${filename}.part`;
  const runExec = dependencies.execText;
  let committed = false;
  let operationFailure: unknown;
  try {
    await adb(
      serial,
      ["shell", "mkdir", "-p", remoteDir],
      30_000,
      signal,
      runExec,
    );
    await adbHost(
      serial,
      ["push", file.path, partialPath],
      120_000,
      signal,
      runExec,
    );
    await adb(
      serial,
      ["shell", "mv", "-f", partialPath, remotePath],
      30_000,
      signal,
      runExec,
    );
    committed = true;
    await adb(serial, [
      "shell",
      "am",
      "broadcast",
      "-a",
      "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
      "-d",
      `file://${remotePath}`,
    ], 30_000, signal, runExec);
    return {
      ok: true,
      output: `Imported ${file.filename} to ${remotePath}`,
      path: remotePath,
      kind,
    };
  } catch (error) {
    operationFailure = error;
    throw error;
  } finally {
    if (!committed) {
      try {
        await adb(
          serial,
          ["shell", "rm", "-f", partialPath],
          5_000,
          undefined,
          runExec,
        );
      } catch (cleanupError) {
        throw new AppManagementError(
          "adb-cleanup-failed",
          `failed to remove partial upload ${partialPath}`,
          {
            cause: new AggregateError(
              [operationFailure, cleanupError].filter(
                (error) => error !== undefined,
              ),
            ),
          },
        );
      }
    }
  }
}

export function launchApp(
  serial: string,
  packageNameValue: string,
  activity?: string,
  dependencies: AppManagementDependencies = {},
): Promise<AppActionResult> {
  const pkg = packageName(packageNameValue);
  if (activity) {
    const act = activityName(activity);
    const component = act.includes("/") ? act : `${pkg}/${act}`;
    return adb(
      serial,
      ["shell", "am", "start", "-n", component],
      30_000,
      undefined,
      dependencies.execText,
    );
  }
  return adb(
    serial,
    [
      "shell",
      "monkey",
      "-p",
      pkg,
      "-c",
      "android.intent.category.LAUNCHER",
      "1",
    ],
    30_000,
    undefined,
    dependencies.execText,
  );
}

export function clearAppData(
  serial: string,
  packageNameValue: string,
  dependencies: AppManagementDependencies = {},
): Promise<AppActionResult> {
  return adb(
    serial,
    ["shell", "pm", "clear", packageName(packageNameValue)],
    30_000,
    undefined,
    dependencies.execText,
  );
}

export function forceStopApp(
  serial: string,
  packageNameValue: string,
  dependencies: AppManagementDependencies = {},
): Promise<AppActionResult> {
  return adb(
    serial,
    ["shell", "am", "force-stop", packageName(packageNameValue)],
    30_000,
    undefined,
    dependencies.execText,
  );
}

export function grantPermission(
  serial: string,
  packageNameValue: string,
  permissionValue: string,
  dependencies: AppManagementDependencies = {},
): Promise<AppActionResult> {
  return adb(
    serial,
    [
      "shell",
      "pm",
      "grant",
      packageName(packageNameValue),
      permissionName(permissionValue),
    ],
    30_000,
    undefined,
    dependencies.execText,
  );
}
