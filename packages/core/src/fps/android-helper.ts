import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const execute = promisify(execFile);
const abiSchema = z.enum(["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]);
const checksumString = z.string();
const checksum = checksumString.regex(/^[a-f0-9]{64}$/);
const binary = z.object({ sha256: checksum });
const binaries = z.record(abiSchema, binary);
const releaseSchema = z.object({ binaries });

export async function deployFpsHelper(adb: string, deviceId: string, signal: AbortSignal, root: URL) {
  const settings = { signal, timeout: 10000, maxBuffer: 1024 * 1024 };
  const prefix = ["-s", deviceId];
  const raw = await execute(adb, [...prefix, "shell", "getprop", "ro.product.cpu.abi"], settings);
  const name = raw.stdout.trim();
  const abi = abiSchema.parse(name);
  const manifest = new URL("release.json", root);
  const text = await readFile(manifest, "utf8");
  const decoded = JSON.parse(text);
  const release = releaseSchema.parse(decoded);
  const path = new URL(`${abi}/mobile-dev-fps`, root);
  const bytes = await readFile(path);
  const hash = createHash("sha256");
  hash.update(bytes);
  const sha256 = hash.digest("hex");
  if (sha256 !== release.binaries[abi].sha256) throw new Error("The bundled Android FPS helper failed its integrity check.");
  const remote = `/data/local/tmp/mobile-dev-fps-${sha256}`;
  const temporaryRoot = tmpdir();
  const temporaryPrefix = join(temporaryRoot, "mobile-dev-fps-");
  const directory = await mkdtemp(temporaryPrefix);
  const local = join(directory, "mobile-dev-fps");
  const token = randomBytes(8);
  const id = token.toString("hex");
  const temporary = `${remote}-${id}`;
  try {
    await writeFile(local, bytes);
    await execute(adb, [...prefix, "push", local, temporary], settings);
    await execute(adb, [...prefix, "shell", `chmod 700 ${temporary} && mv ${temporary} ${remote}`], settings);
  } catch (error) {
    await execute(adb, [...prefix, "shell", "rm", "-f", temporary], { timeout: 3000 }).catch(() => {});
    throw error;
  } finally { await rm(directory, { recursive: true, force: true }); }
  return remote;
}
