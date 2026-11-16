import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const runtime = "packages/runtimes/e2e";
execFileSync("npm", ["install", "--prefix", runtime, "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock-only=false"], { stdio: "inherit" });

const lock = await readFile(join(runtime, "package-lock.json"), "utf8");
const packages = JSON.parse(lock).packages;
const notices = [];
for (const [key, metadata] of Object.entries(packages)) {
  if (!key.startsWith("node_modules/")) continue;
  const name = key.slice("node_modules/".length);
  // Nested transitive packages are represented by another /node_modules/ segment. Their license
  // is still included, but the lock entry's path is the unambiguous package label.
  if (!name || name.includes("/node_modules/")) continue;
  const directory = join(runtime, key);
  const files = await readdir(directory).catch(() => []);
  for (const file of files.filter(name => /^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(name))) {
    const license = (await readFile(join(directory, file), "utf8"))
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map(line => line.trimEnd())
      .join("\n")
      .trimEnd();
    notices.push(`${name} ${metadata.version ?? "unknown"} (${file})\n\n${license}`);
  }
}
await writeFile(join(runtime, "THIRD_PARTY_NOTICES.txt"), notices.sort().join("\n\n====================\n\n") + "\n");
await writeFile(join(runtime, "release.json"), JSON.stringify({
  schemaVersion: 1,
  packages: Object.fromEntries(Object.keys(packages[""]?.dependencies ?? {}).sort().map(name => {
    const entry = packages[`node_modules/${name}`];
    return [name, { version: entry.version, resolved: entry.resolved, integrity: entry.integrity }];
  })),
  lockfileSHA256: createHash("sha256").update(lock).digest("hex"),
}, null, 2) + "\n");
console.log("Installed and indexed the pinned e2e Studio runtime.");
