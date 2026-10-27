import { execText } from "./exec.ts";
import type { ForegroundApp } from "./shared/api-contracts.ts";

export type { ForegroundApp } from "./shared/api-contracts.ts";

async function adbShell(
  serial: string,
  args: string[],
  timeout = 4_000,
  runExec: typeof execText = execText,
): Promise<string> {
  const result = await runExec("adb", ["-s", serial, "shell", ...args], { timeout });
  if (result.status !== 0 || result.error) {
    throw new Error(
      (
        result.stderr ||
        result.error?.message ||
        result.stdout ||
        `adb shell ${args.join(" ")} failed`
      ).trim(),
      { cause: result.error ?? undefined },
    );
  }
  return result.stdout;
}

function firstMatch(text: string, patterns: RegExp[]): RegExpMatchArray | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match;
  }
  return null;
}

function parseComponent(value: string): { packageName: string; activity: string | null } | null {
  const clean = value.trim().replace(/^\{|\}$/g, "");
  const component = clean.split(/\s+/).find((part) => part.includes("/")) ?? clean;
  const [packageName, activityRaw] = component.split("/", 2);
  if (!packageName || !/^[A-Za-z0-9_.]+$/.test(packageName)) return null;
  const activity = activityRaw
    ? activityRaw.startsWith(".")
      ? `${packageName}${activityRaw}`
      : activityRaw
    : null;
  return { packageName, activity };
}

async function foregroundComponent(
  serial: string,
  runExec: typeof execText,
): Promise<{ packageName: string; activity: string | null } | null> {
  const windowDump = await adbShell(serial, ["dumpsys", "window"], 5_000, runExec);
  const windowMatch = firstMatch(windowDump, [
    /mCurrentFocus=Window\{[^}]*\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)\}/,
    /mFocusedApp=ActivityRecord\{[^}]*\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)\s/,
    /mInputMethodTarget=Window\{[^}]*\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)\}/,
  ]);
  if (windowMatch?.[1]) {
    const parsed = parseComponent(windowMatch[1]);
    if (parsed) return parsed;
  }

  const activityDump = await adbShell(
    serial,
    ["dumpsys", "activity", "activities"],
    5_000,
    runExec,
  );
  const activityMatch = firstMatch(activityDump, [
    /topResumedActivity=ActivityRecord\{[^}]*\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)\s/,
    /mResumedActivity: ActivityRecord\{[^}]*\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)\s/,
    /ResumedActivity: ActivityRecord\{[^}]*\s([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)\s/,
  ]);
  return activityMatch?.[1] ? parseComponent(activityMatch[1]) : null;
}

async function packagePid(
  serial: string,
  packageName: string,
  runExec: typeof execText,
): Promise<number | null> {
  try {
    const out = (await adbShell(serial, ["pidof", packageName], 2_000, runExec)).trim();
    const first = out.split(/\s+/)[0];
    const pid = first ? Number(first) : NaN;
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function packageDetails(
  serial: string,
  packageName: string,
  runExec: typeof execText,
) {
  try {
    const dump = await adbShell(
      serial,
      ["dumpsys", "package", packageName],
      5_000,
      runExec,
    );
    const versionName = dump.match(/versionName=([^\s]+)/)?.[1] ?? null;
    const versionCode = dump.match(/versionCode=(\d+)/)?.[1] ?? null;
    const label =
      dump.match(/application-label(?:-[a-zA-Z]+)?:'([^']+)'/)?.[1] ??
      dump.match(/labelRes=0x[0-9a-fA-F]+ nonLocalizedLabel=([^\n]+)/)?.[1]?.trim() ??
      null;
    const debuggable = /pkgFlags=\[[^\]]*\bDEBUGGABLE\b/.test(dump) || /\bDEBUGGABLE\b/.test(dump);
    return { label, versionName, versionCode, debuggable };
  } catch {
    return { label: null, versionName: null, versionCode: null, debuggable: null };
  }
}

export async function getForegroundApp(
  serial: string,
  runExec: typeof execText = execText,
): Promise<ForegroundApp> {
  const component = await foregroundComponent(serial, runExec);
  if (!component) {
    return {
      packageName: null,
      activity: null,
      pid: null,
      label: null,
      versionName: null,
      versionCode: null,
      debuggable: null,
    };
  }
  const [details, pid] = await Promise.all([
    packageDetails(serial, component.packageName, runExec),
    packagePid(serial, component.packageName, runExec),
  ]);
  return {
    packageName: component.packageName,
    activity: component.activity,
    pid,
    ...details,
  };
}
