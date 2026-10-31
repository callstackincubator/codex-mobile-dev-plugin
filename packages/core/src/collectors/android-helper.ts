import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const execute = promisify(execFile);
export const ANDROID_ABIS = ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"] as const;
const abiSchema = z.enum(ANDROID_ABIS);
export type AndroidAbi = z.infer<typeof abiSchema>;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const releaseSchema = z.object({ binaries: z.record(z.string(), z.object({ sha256: sha256Schema })) });
export type AdbCommand = (adb: string, args: string[], signal?: AbortSignal) => Promise<string>;
const adbCommand: AdbCommand = async (adb, args, signal) => {
  const result = await execute(adb, args, { signal, timeout: 10000, maxBuffer: 1024 * 1024 });
  return result.stdout;
};

/**
 * A bundled Android helper (`<abi>/<name>` beside `release.json`). It reads and
 * verifies each ABI's binary on first use and keeps the bytes, so sessions still
 * deploy after the plugin folder is replaced under a running server.
 */
export class AndroidHelper {
  readonly name: string;
  private readonly root: URL;
  private readonly label: string;
  private release?: Promise<z.infer<typeof releaseSchema>>;
  private readonly binaries = new Map<AndroidAbi, Promise<{ bytes: Buffer; sha256: string }>>();

  constructor(name: string, root: URL, label: string) {
    this.name = name;
    this.root = root;
    this.label = label;
  }

  binary(abi: AndroidAbi): Promise<{ bytes: Buffer; sha256: string }> {
    let binary = this.binaries.get(abi);
    if (binary === undefined) {
      binary = this.load(abi);
      this.binaries.set(abi, binary);
      // A missing or corrupted file can be repaired; retry on the next session.
      binary.catch(() => { if (this.binaries.get(abi) === binary) this.binaries.delete(abi); });
    }
    return binary;
  }

  private async load(abi: AndroidAbi) {
    this.release ??= this.readRelease();
    const release = await this.release.catch(error => { this.release = undefined; throw error; });
    const path = `${abi}/${this.name}`;
    const expected = release.binaries[path];
    if (expected === undefined) throw new Error(`The bundled ${this.label} is missing ${abi}.`);
    const bytes = await readFile(new URL(path, this.root));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== expected.sha256) throw new Error(`The bundled ${this.label} failed its integrity check for ${abi}.`);
    return { bytes, sha256 };
  }

  private async readRelease() {
    const text = await readFile(new URL("release.json", this.root), "utf8");
    const decoded: unknown = JSON.parse(text);
    return releaseSchema.parse(decoded);
  }

  /** Pushes the device's ABI build to /data/local/tmp and returns its path there. */
  async deploy(adb: string, deviceId: string, signal: AbortSignal, run: AdbCommand = adbCommand): Promise<string> {
    signal.throwIfAborted();
    const prefix = ["-s", deviceId];
    const rawAbi = await run(adb, [...prefix, "shell", "getprop", "ro.product.cpu.abi"], signal);
    const abi = abiSchema.parse(rawAbi.trim());
    const binary = await this.binary(abi);
    const remote = `/data/local/tmp/${this.name}-${binary.sha256}`;
    const token = randomBytes(8).toString("hex");
    const temporary = `${remote}-${token}`;
    const directory = await mkdtemp(join(tmpdir(), `${this.name}-`));
    const local = join(directory, this.name);
    try {
      await writeFile(local, binary.bytes, { mode: 0o600 });
      signal.throwIfAborted();
      await run(adb, [...prefix, "push", local, temporary], signal);
      // Atomic replacement also permits another session to execute the same binary.
      await run(adb, [...prefix, "shell", `chmod 700 ${temporary} && mv ${temporary} ${remote}`], signal);
    } catch (error) {
      await run(adb, [...prefix, "shell", "rm", "-f", temporary]).catch(() => {});
      throw error;
    } finally { await rm(directory, { recursive: true, force: true }); }
    return remote;
  }
}

const helpers = new Map<string, AndroidHelper>();

/** One helper per bundled folder, so every session shares its verified bytes. */
export function androidHelper(name: string, root: URL, label: string): AndroidHelper {
  const key = `${name}\0${root.href}`;
  let helper = helpers.get(key);
  if (helper === undefined) {
    helper = new AndroidHelper(name, root, label);
    helpers.set(key, helper);
  }
  return helper;
}
