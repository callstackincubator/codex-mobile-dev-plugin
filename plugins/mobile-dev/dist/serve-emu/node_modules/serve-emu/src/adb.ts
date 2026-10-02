import { spawn } from "node:child_process";
import { execBuffer, execText, type ExecResult } from "./exec.ts";

const ADB_QUERY_TIMEOUT_MS = 2_000;
const ADB_MUTATION_TIMEOUT_MS = 5_000;
const ADB_SCREENSHOT_TIMEOUT_MS = 8_000;

export type Device = { serial: string; state: string };
export type OrientationMode = "auto" | "portrait" | "landscape";
export type NightMode = "auto" | "dark" | "light";
export type OrientationStatus = {
  mode: "free" | "lock" | "unknown";
  rotation: number | null;
  orientation: OrientationMode | "unknown";
  raw: string;
};
export type FontScaleStatus = {
  scale: number;
  raw: string;
};
export type NightModeStatus = {
  mode: NightMode | "unknown";
  raw: string;
};
export type NetworkRadioStatus = "enabled" | "disabled" | "unknown";
export type NetworkStatus = {
  enabled: boolean | null;
  wifi: NetworkRadioStatus;
  mobileData: NetworkRadioStatus;
  raw: {
    wifi: string;
    mobileData: string;
  };
};

function execFailed(result: ExecResult<string | Buffer>): boolean {
  return result.status !== 0 || result.error !== null;
}

function execFailure(result: ExecResult<string | Buffer>): string {
  const stdout =
    typeof result.stdout === "string" ? result.stdout.trim() : "";
  return (
    result.stderr.trim() ||
    result.error?.message ||
    stdout ||
    "unknown error"
  );
}

export async function listAllDevices(
  runExec: typeof execText = execText,
): Promise<Device[]> {
  const r = await runExec("adb", ["devices"], { timeout: ADB_QUERY_TIMEOUT_MS });
  if (execFailed(r)) throw new Error(`adb devices failed: ${execFailure(r)}`);
  return r.stdout
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [serial, state] = l.split(/\s+/);
      return { serial, state };
    });
}

export async function listDevices(
  runExec: typeof execText = execText,
): Promise<Device[]> {
  return (await listAllDevices(runExec)).filter((d) => d.state === "device");
}

export async function pickDevice(
  explicit?: string,
  runExec: typeof execText = execText,
): Promise<string> {
  if (explicit) return explicit;
  const devices = await listDevices(runExec);
  if (devices.length === 0) throw new Error("No booted Android device found. Start an emulator or attach a device.");
  if (devices.length > 1)
    throw new Error(
      `Multiple devices online (${devices.map((d) => d.serial).join(", ")}). Pass -s <serial>.`,
    );
  return devices[0].serial;
}

export async function screencapPng(
  serial: string,
  runExec: typeof execBuffer = execBuffer,
): Promise<Buffer> {
  const r = await runExec("adb", ["-s", serial, "exec-out", "screencap", "-p"], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: ADB_SCREENSHOT_TIMEOUT_MS,
  });
  if (execFailed(r)) throw new Error(`screencap failed: ${execFailure(r)}`);
  return r.stdout;
}

export async function shell(
  serial: string,
  cmd: string[],
  runExec: typeof execText = execText,
): Promise<void> {
  const r = await runExec("adb", ["-s", serial, "shell", ...cmd], {
    timeout: ADB_MUTATION_TIMEOUT_MS,
  });
  if (execFailed(r)) {
    throw new Error(
      `adb shell ${cmd.join(" ")} failed: ${execFailure(r)}`,
    );
  }
}

export function shellSpawn(
  serial: string,
  cmd: string[],
  runSpawn: typeof spawn = spawn,
) {
  return runSpawn("adb", ["-s", serial, "shell", ...cmd]);
}

export async function getDeviceSize(
  serial: string,
  runExec: typeof execText = execText,
): Promise<{ width: number; height: number }> {
  const r = await runExec("adb", ["-s", serial, "shell", "wm", "size"], {
    timeout: ADB_QUERY_TIMEOUT_MS,
  });
  if (execFailed(r)) throw new Error(`wm size failed: ${execFailure(r)}`);
  const m = r.stdout.match(/(\d+)x(\d+)/);
  if (!m) throw new Error(`Could not parse wm size output: ${r.stdout}`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

function orientationFromRotation(mode: "free" | "lock" | "unknown", rotation: number | null): OrientationStatus["orientation"] {
  if (mode === "free") return "auto";
  if (rotation === 0 || rotation === 2) return "portrait";
  if (rotation === 1 || rotation === 3) return "landscape";
  return "unknown";
}

export async function getUserRotation(
  serial: string,
  runExec: typeof execText = execText,
): Promise<OrientationStatus> {
  const r = await runExec("adb", ["-s", serial, "shell", "cmd", "window", "user-rotation"], {
    timeout: ADB_QUERY_TIMEOUT_MS,
  });
  if (execFailed(r)) {
    throw new Error(
      `cmd window user-rotation failed: ${execFailure(r)}`,
    );
  }
  const raw = r.stdout.trim();
  const match = raw.match(/^(free|lock)(?:\s+(\d+))?$/);
  if (!match) {
    return { mode: "unknown", rotation: null, orientation: "unknown", raw };
  }
  const mode = match[1] as "free" | "lock";
  const rotation = match[2] === undefined ? null : Number(match[2]);
  return { mode, rotation, orientation: orientationFromRotation(mode, rotation), raw };
}

export async function setUserRotation(
  serial: string,
  orientation: OrientationMode,
  runExec: typeof execText = execText,
): Promise<OrientationStatus> {
  const args =
    orientation === "auto"
      ? ["cmd", "window", "user-rotation", "free"]
      : ["cmd", "window", "user-rotation", "lock", orientation === "portrait" ? "0" : "1"];
  const r = await runExec("adb", ["-s", serial, "shell", ...args], {
    timeout: ADB_MUTATION_TIMEOUT_MS,
  });
  if (execFailed(r)) {
    throw new Error(
      `adb shell ${args.join(" ")} failed: ${execFailure(r)}`,
    );
  }
  return getUserRotation(serial, runExec);
}

export async function getFontScale(
  serial: string,
  runExec: typeof execText = execText,
): Promise<FontScaleStatus> {
  const r = await runExec("adb", ["-s", serial, "shell", "settings", "get", "system", "font_scale"], {
    timeout: ADB_QUERY_TIMEOUT_MS,
  });
  if (execFailed(r)) {
    throw new Error(
      `settings get system font_scale failed: ${execFailure(r)}`,
    );
  }
  const raw = r.stdout.trim();
  const scale = Number(raw);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`Could not parse font_scale output: ${r.stdout}`);
  }
  return { scale, raw };
}

export async function setFontScale(
  serial: string,
  scale: number,
  runExec: typeof execText = execText,
): Promise<FontScaleStatus> {
  if (!Number.isFinite(scale) || scale < 0.7 || scale > 2) {
    throw new Error("font scale must be between 0.7 and 2.0");
  }
  const normalized = scale.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  const args = ["settings", "put", "system", "font_scale", normalized];
  const r = await runExec("adb", ["-s", serial, "shell", ...args], {
    timeout: ADB_MUTATION_TIMEOUT_MS,
  });
  if (execFailed(r)) {
    throw new Error(
      `adb shell ${args.join(" ")} failed: ${execFailure(r)}`,
    );
  }
  return getFontScale(serial, runExec);
}

function nightModeFromRaw(raw: string): NightMode | "unknown" {
  const match = raw.match(/Night mode:\s*(\S+)/i);
  const value = (match?.[1] ?? raw).trim().toLowerCase();
  if (value === "yes") return "dark";
  if (value === "no") return "light";
  if (value === "auto") return "auto";
  return "unknown";
}

export async function getNightMode(
  serial: string,
  runExec: typeof execText = execText,
): Promise<NightModeStatus> {
  const r = await runExec("adb", ["-s", serial, "shell", "cmd", "uimode", "night"], {
    timeout: ADB_QUERY_TIMEOUT_MS,
  });
  if (execFailed(r)) {
    throw new Error(`cmd uimode night failed: ${execFailure(r)}`);
  }
  const raw = r.stdout.trim();
  return { mode: nightModeFromRaw(raw), raw };
}

export async function setNightMode(
  serial: string,
  mode: NightMode,
  runExec: typeof execText = execText,
): Promise<NightModeStatus> {
  const value = mode === "dark" ? "yes" : mode === "light" ? "no" : "auto";
  const args = ["cmd", "uimode", "night", value];
  const r = await runExec("adb", ["-s", serial, "shell", ...args], {
    timeout: ADB_MUTATION_TIMEOUT_MS,
  });
  if (execFailed(r)) {
    throw new Error(
      `adb shell ${args.join(" ")} failed: ${execFailure(r)}`,
    );
  }
  return getNightMode(serial, runExec);
}

async function globalSetting(
  serial: string,
  name: string,
  runExec: typeof execText = execText,
): Promise<string> {
  const r = await runExec(
    "adb",
    ["-s", serial, "shell", "settings", "get", "global", name],
    {
      timeout: ADB_QUERY_TIMEOUT_MS,
    },
  );
  if (execFailed(r)) {
    throw new Error(
      `settings get global ${name} failed: ${execFailure(r)}`,
      { cause: r.error ?? undefined },
    );
  }
  return r.stdout.trim();
}

function radioStatusFromSetting(raw: string): NetworkRadioStatus {
  if (raw === "1") return "enabled";
  if (raw === "0") return "disabled";
  return "unknown";
}

export async function getNetworkStatus(
  serial: string,
  runExec: typeof execText = execText,
): Promise<NetworkStatus> {
  const [wifiRaw, mobileDataRaw] = await Promise.all([
    globalSetting(serial, "wifi_on", runExec),
    globalSetting(serial, "mobile_data", runExec),
  ]);
  const wifi = radioStatusFromSetting(wifiRaw);
  const mobileData = radioStatusFromSetting(mobileDataRaw);
  const radios = [wifi, mobileData];
  const knownRadios = radios.filter((radio) => radio !== "unknown");
  const enabled = knownRadios.length === 0 ? null : knownRadios.some((radio) => radio === "enabled");
  return {
    enabled,
    wifi,
    mobileData,
    raw: {
      wifi: wifiRaw,
      mobileData: mobileDataRaw,
    },
  };
}

export async function setNetworkEnabled(
  serial: string,
  enabled: boolean,
  runExec: typeof execText = execText,
): Promise<NetworkStatus> {
  const action = enabled ? "enable" : "disable";
  for (const service of ["wifi", "data"]) {
    const args = ["svc", service, action];
    const r = await runExec("adb", ["-s", serial, "shell", ...args], {
      timeout: ADB_MUTATION_TIMEOUT_MS,
    });
    if (execFailed(r)) {
      throw new Error(
        `adb shell ${args.join(" ")} failed: ${execFailure(r)}`,
      );
    }
  }
  return getNetworkStatus(serial, runExec);
}
