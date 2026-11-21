import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isMissingFile } from "./install-integrity.ts";

async function readIni(path: string) {
  const contents = await readFile(path, "utf8");
  const properties = new Map<string, string>();
  for (const line of contents.split(/\r?\n/)) {
    const equals = line.indexOf("=");
    if (equals <= 0 || /^\s*[#;]/.test(line)) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim();
    if (properties.has(key) && properties.get(key) !== value) throw new Error("Ambiguous AVD configuration.");
    properties.set(key, value);
  }
  return properties;
}

function avdRoots() {
  const env = process.env;
  if (env.ANDROID_AVD_HOME) return [env.ANDROID_AVD_HOME];
  const roots = new Set<string>();
  for (const home of [env.ANDROID_USER_HOME, env.ANDROID_EMULATOR_HOME, env.ANDROID_PREFS_ROOT, env.ANDROID_SDK_HOME]) {
    if (home) roots.add(join(home, "avd"));
  }
  for (const home of [env.ANDROID_PREFS_ROOT, env.ANDROID_SDK_HOME, env.TEST_TMPDIR, env.USER_HOME, env.HOME, homedir()]) {
    if (home) roots.add(join(home, ".android", "avd"));
  }
  return [...roots];
}

// Emulator releases differ in lookup order when multiple SDK homes or both
// absolute and relative AVD paths exist. Only use an unambiguous match.
async function uniqueExistingPath(paths: string[]) {
  const matches = new Map<string, string>();
  for (const path of paths) {
    // Keep the registry path. A descriptor symlink's path.rel belongs to its
    // registry, even when the descriptor file itself lives elsewhere.
    try { matches.set(await realpath(path), path); }
    catch (error) { if (!isMissingFile(error)) throw error; }
  }
  return matches.size === 1 ? matches.values().next().value : undefined;
}

function profileRam(config: Map<string, string>, target: string | undefined) {
  const image = config.get("image.sysdir.1")?.replaceAll("\\", "/");
  const match = /^system-images\/android-(35|36|37)(?:\.\d+)?\/(default|google_apis|google_apis_playstore)\/x86_64\/?$/.exec(image ?? "");
  if (!match || config.get("image.sysdir.2")) return;
  const [, api, imageTag] = match;
  if (target && !new RegExp(`^android-${api}(?:\\.\\d+)?$`).test(target)) return;
  if (config.has("tag.id") && config.get("tag.id") !== imageTag) return;
  if (config.has("abi.type") && config.get("abi.type") !== "x86_64") return;
  const model = config.get("hw.device.name")?.toLowerCase().replaceAll(" ", "_");
  if (!/^(?:(?:small|medium)_phone|pixel(?:_xl|_\d+a?(?:_pro)?(?:_xl)?)?)$/.test(model ?? "")) return;
  if (config.get("hw.sensor.hinge") === "yes" || config.get("hw.sensor.roll") === "yes") return;

  const size = /^(\d+)([MG]?)$/i.exec(config.get("hw.ramSize") ?? "");
  if (!size) return;
  const configured = Number(size[1]) * (size[2].toUpperCase() === "G" ? 1024 : 1);
  if (!Number.isSafeInteger(configured)) return;
  // Use 4 GiB for newer phones and larger displays. The emulator can still
  // raise either target to meet the requirements of its own version and image.
  let ramMiB = 4096;
  if (api !== "37") {
    const width = Number(config.get("hw.lcd.width"));
    const height = Number(config.get("hw.lcd.height"));
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return;
    if (width * height < 3_000_000) ramMiB = 2560;
  }
  return configured > ramMiB ? ramMiB : undefined;
}

export async function windowsAvdRamMiB(name: string): Promise<number | undefined> {
  if (!/^[\w.-]+$/.test(name)) return;
  try {
    const descriptor = await uniqueExistingPath(avdRoots().map(root => join(root, `${name}.ini`)));
    if (!descriptor) return;
    const info = await readIni(descriptor);
    const paths: string[] = [];
    const absolute = info.get("path");
    const relative = info.get("path.rel");
    if (absolute && isAbsolute(absolute)) paths.push(absolute);
    if (relative && !isAbsolute(relative)) paths.push(resolve(dirname(descriptor), "..", relative.replaceAll("\\", "/")));
    const directory = await uniqueExistingPath(paths);
    if (directory) return profileRam(await readIni(join(directory, "config.ini")), info.get("target"));
  } catch {
    // Missing or unreadable metadata makes the optional profile unavailable.
  }
}
