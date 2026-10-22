/**
 * Builds `native/swift-appflow-parse` and stages the binary under `vendor/`.
 *
 * This is the prepare step behind the parser's invocation contract. `src/app-flow/swift-parse.ts`
 * can build the parser on demand, which is what the POC relies on; running it here instead puts the
 * ~130 s cold build somewhere a human chose, and leaves the binary exactly where a shipped build
 * would put it. That is deliberate: moving from "build on the user's machine" to "ship a prebuilt
 * binary" is then a packaging change, because the consumer already prefers `vendor/` over `.build/`.
 *
 * `release.json` records what the binary was built from. The useful field is the swift-syntax
 * version: the parser pins a major that tracks a Swift release, and a mismatch with the installed
 * toolchain is the one failure this build actually has.
 */
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageDir = resolve("native/swift-appflow-parse");
const output = resolve("vendor/swift-appflow-parse");

if (process.platform !== "darwin") throw new Error("Build the SwiftUI screen parser on a Mac with Xcode.");

let swift;
try { swift = execFileSync("xcrun", ["--find", "swift"], { encoding: "utf8" }).trim(); }
catch { throw new Error("No Swift toolchain found. Install Xcode and run `xcode-select --switch /Applications/Xcode.app`."); }
const swiftVersion = execFileSync(swift, ["--version"], { encoding: "utf8" }).split("\n")[0].trim();

console.log(`Building the SwiftUI screen parser with ${swiftVersion}…`);
execFileSync("swift", ["build", "-c", "release"], { cwd: packageDir, stdio: "inherit" });

const binary = `${packageDir}/.build/release/swift-appflow-parse`;
// The contract's own answer, asked of the binary that was just built rather than read off a
// constant here: a `release.json` claiming a version the binary does not report would be worse
// than no `release.json` at all.
const contract = JSON.parse(execFileSync(binary, ["--version"], { encoding: "utf8" }));

let swiftSyntax = null;
try {
  const resolved = JSON.parse(await readFile(`${packageDir}/Package.resolved`, "utf8"));
  const pins = resolved.pins ?? resolved.object?.pins ?? [];
  const pin = pins.find(entry => (entry.identity ?? entry.package ?? "").toLowerCase().includes("swift-syntax"));
  swiftSyntax = pin?.state?.version ?? pin?.state?.revision ?? null;
} catch {
  // A tree that has never resolved has no pin file; the build above would have failed first.
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await copyFile(binary, `${output}/swift-appflow-parse`);
await writeFile(`${output}/release.json`, `${JSON.stringify({
  tool: contract.tool,
  contractVersion: contract.contractVersion,
  builtWith: swiftVersion,
  swiftSyntax
}, null, 2)}\n`);

console.log(`Staged ${output}/swift-appflow-parse (contract ${contract.contractVersion}, swift-syntax ${swiftSyntax ?? "unknown"}).`);
