import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { commandError, commandOutput } from "../app-control/commands.ts";
import type { Commands } from "../app-control/commands.ts";

export type ContainerFile = { path: string; bytes: number };

// One app's data directory. Paths are relative to it and use forward slashes.
export interface AppContainer {
  readonly platform: "ios" | "android";
  list(): Promise<ContainerFile[]>;
  read(path: string): Promise<Buffer>;
  remove(paths: string[]): Promise<void>;
  // The current UserDefaults domain as plist XML, including values cfprefsd has not written yet.
  preferences?(path: string): Promise<string>;
  forgetPreferences?(path: string): Promise<void>;
  // Removes everything the app stored, leaving it installed.
  reset(): Promise<void>;
}

// A container directory can hold caches with many files; listing stops here.
const maxContainerFiles = 20000;

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

function safePath(path: string) {
  if (path === "" || path.startsWith("/") || path.split("/").some(part => part === ".." || part === "")) throw new ExpectedOperationError("invalid_input", "The storage path is outside the app's data.");
  return path;
}

export class SimulatorContainer implements AppContainer {
  readonly platform = "ios";
  private readonly root: string;
  private readonly deviceId: string;
  private readonly commands: Commands;

  constructor(root: string, deviceId: string, commands: Commands) {
    this.root = root;
    this.deviceId = deviceId;
    this.commands = commands;
  }

  static async open(deviceId: string, bundleId: string, commands: Commands) {
    let output: string;
    try { output = await commands.run("xcrun", ["simctl", "get_app_container", deviceId, bundleId, "data"], { timeout: 15000 }); }
    catch (error) {
      if (/No such file or directory|not installed/i.test(commandOutput(error))) throw new ExpectedOperationError("invalid_input", `${bundleId} is not installed on this simulator.`);
      throw commandError(error, "Finding the app data");
    }
    return new SimulatorContainer(output.trim(), deviceId, commands);
  }

  async list() {
    const files: ContainerFile[] = [];
    const walk = async (directory: string) => {
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (files.length >= maxContainerFiles) return;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile()) {
          const info = await stat(path).catch(() => undefined);
          if (info) files.push({ path: relative(this.root, path).split(sep).join("/"), bytes: info.size });
        }
      }
    };
    await walk(this.root);
    return files;
  }

  async read(path: string) { return readFile(join(this.root, safePath(path))); }

  async remove(paths: string[]) {
    await Promise.all(paths.map(path => rm(join(this.root, safePath(path)), { recursive: true, force: true })));
  }

  private defaults(args: string[]) {
    return this.commands.run("xcrun", ["simctl", "spawn", this.deviceId, "defaults", ...args], { timeout: 15000, maxBuffer: 32 * 1024 * 1024 });
  }

  // `defaults` asks cfprefsd, which may hold writes the app made after the plist was last saved.
  async preferences(path: string) {
    const domain = join(this.root, safePath(path)).replace(/\.plist$/, "");
    try { return await this.defaults(["export", domain, "-"]); }
    catch { return this.commands.run("plutil", ["-convert", "xml1", "-o", "-", `${domain}.plist`], { timeout: 10000, maxBuffer: 32 * 1024 * 1024 }); }
  }

  // Deleting only the file would leave cfprefsd's cached copy, which the app would read and save again.
  async forgetPreferences(path: string) {
    const domain = join(this.root, safePath(path)).replace(/\.plist$/, "");
    await this.defaults(["delete", domain]).catch(() => "");
  }

  async reset() {
    const preferences = (await this.list()).filter(file => /^Library\/Preferences\/[^/]+\.plist$/.test(file.path));
    for (const file of preferences) await this.forgetPreferences(file.path);
    // The container keeps its top-level layout and metadata; everything the app created inside goes.
    for (const directory of ["Documents", "Library", "tmp"]) {
      const entries = await readdir(join(this.root, directory)).catch(() => []);
      await Promise.all(entries.map(entry => rm(join(this.root, directory, entry), { recursive: true, force: true })));
    }
    for (const directory of ["Documents", "Library/Caches", "Library/Preferences", "tmp"]) await mkdir(join(this.root, directory), { recursive: true });
  }
}

export class AndroidContainer implements AppContainer {
  readonly platform = "android";
  private readonly serial: string;
  private readonly bundleId: string;
  private readonly commands: Commands;

  constructor(serial: string, bundleId: string, commands: Commands) {
    this.serial = serial;
    this.bundleId = bundleId;
    this.commands = commands;
  }

  // run-as starts in the app's data directory with the app's user, so it only works for debuggable builds.
  private async runAs(action: string, command: string, timeout = 20000) {
    try { return await this.commands.run(await this.commands.adb(), ["-s", this.serial, "shell", `run-as ${this.bundleId} sh -c ${shellQuote(command)}`], { timeout, maxBuffer: 32 * 1024 * 1024 }); }
    catch (error) { throw runAsError(error, action, this.bundleId); }
  }

  async list() {
    // toybox stat prints size and name; `find` without -print0 because older toybox lacks it.
    const output = await this.runAs("Listing app data", `find . -type f -exec stat -c '%s %n' {} + 2>/dev/null | head -n ${maxContainerFiles}; true`, 30000);
    if (/^run-as:/m.test(output)) throw runAsError({ stdout: output }, "Listing app data", this.bundleId);
    return output.split("\n").flatMap(line => {
      const match = /^(\d+) \.\/(.+)$/.exec(line.trimEnd());
      return match ? [{ path: match[2], bytes: Number(match[1]) }] : [];
    });
  }

  async read(path: string) {
    const adb = await this.commands.adb();
    try { return await this.commands.readBinary(adb, ["-s", this.serial, "exec-out", `run-as ${this.bundleId} cat ${shellQuote(safePath(path))}`], { timeout: 30000 }); }
    catch (error) { throw runAsError(error, "Reading app data", this.bundleId); }
  }

  async remove(paths: string[]) {
    if (paths.length === 0) return;
    await this.runAs("Clearing app data", `rm -rf -- ${paths.map(path => shellQuote(safePath(path))).join(" ")}`);
  }

  // pm clear also stops the app and works for release builds.
  async reset() {
    let output: string;
    try { output = await this.commands.run(await this.commands.adb(), ["-s", this.serial, "shell", `pm clear ${this.bundleId}`], { timeout: 30000 }); }
    catch (error) { throw commandError(error, "Clearing app data"); }
    if (!/Success/.test(output)) throw new ExpectedOperationError("invalid_input", `Clearing app data failed: ${output.trim().split("\n")[0] || "pm clear did not succeed."}`);
  }
}

export function runAsError(error: unknown, action: string, bundleId: string): Error {
  const output = commandOutput(error);
  if (/not debuggable/.test(output)) return new ExpectedOperationError("unsupported_platform", `${bundleId} is a release build. Android only allows reading app data of debuggable builds; Reset app data still works.`);
  if (/unknown package|Unknown package|is unknown/.test(output)) return new ExpectedOperationError("invalid_input", `${bundleId} is not installed on this device.`);
  return commandError(error, action);
}
