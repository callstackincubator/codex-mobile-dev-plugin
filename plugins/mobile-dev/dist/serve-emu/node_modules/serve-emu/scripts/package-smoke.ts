#!/usr/bin/env bun
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface PackFile {
  path: string;
}

interface PackReport {
  filename: string;
  files: PackFile[];
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const bunExecutable = process.execPath;

const REQUIRED_PACKAGE_FILES = [
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "dist/ui/index.html",
  "package.json",
  "scripts/fetch-scrcpy.ts",
  "src/cli.ts",
] as const;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function displayCommand(command: readonly string[]): string {
  return command.map((argument) => JSON.stringify(argument)).join(" ");
}

async function runCommand(
  command: string[],
  cwd: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<CommandResult> {
  const child = Bun.spawn(command, {
    cwd,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function runSuccessfully(command: string[], cwd: string): Promise<CommandResult> {
  const result = await runCommand(command, cwd);
  invariant(
    result.exitCode === 0,
    [
      `Command failed (${result.exitCode}): ${displayCommand(command)}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return result;
}

function parsePackReport(output: string, label: string): PackReport {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch (error) {
    throw new Error(`${label} did not return valid JSON: ${String(error)}`);
  }

  invariant(Array.isArray(value) && value.length === 1, `${label} must describe exactly one package`);
  const report = value[0] as Partial<PackReport>;
  invariant(typeof report.filename === "string", `${label} is missing its tarball filename`);
  invariant(Array.isArray(report.files), `${label} is missing its file manifest`);
  invariant(
    report.files.every(
      (file): file is PackFile =>
        typeof file === "object" && file !== null && typeof (file as Partial<PackFile>).path === "string",
    ),
    `${label} contains an invalid file manifest entry`,
  );
  return report as PackReport;
}

async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(currentDirectory: string): Promise<void> {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolutePath = join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(relative(packageRoot, absolutePath).split(sep).join("/"));
      }
    }
  }

  await visit(directory);
  return files;
}

async function requiredPackageFiles(): Promise<string[]> {
  const sourceFiles = await listFiles(join(packageRoot, "src"));
  const builtUiFiles = await listFiles(join(packageRoot, "dist", "ui"));
  return [...new Set([...REQUIRED_PACKAGE_FILES, ...sourceFiles, ...builtUiFiles])].sort();
}

function validateManifest(report: PackReport, requiredFiles: readonly string[], label: string): void {
  const manifest = new Set(report.files.map((file) => file.path));
  const missing = requiredFiles.filter((file) => !manifest.has(file));
  invariant(missing.length === 0, `${label} is missing required files:\n${missing.join("\n")}`);
}

function validateMatchingManifests(dryRun: PackReport, packed: PackReport): void {
  const dryRunFiles = dryRun.files.map((file) => file.path).sort();
  const packedFiles = packed.files.map((file) => file.path).sort();
  invariant(
    JSON.stringify(dryRunFiles) === JSON.stringify(packedFiles),
    "npm pack --dry-run and the real tarball reported different file manifests",
  );
}

async function expectImportFailure(specifier: string, consumerDirectory: string): Promise<void> {
  const result = await runCommand(
    [bunExecutable, "--eval", `await import(${JSON.stringify(specifier)})`],
    consumerDirectory,
  );
  invariant(result.exitCode !== 0, `Unsupported package import unexpectedly succeeded: ${specifier}`);
}

async function main(): Promise<void> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "serve-emu-package-smoke-"));

  try {
    const dryRunDirectory = join(temporaryRoot, "dry-run");
    const packDirectory = join(temporaryRoot, "packed");
    const consumerDirectory = join(temporaryRoot, "consumer");
    await Promise.all([
      mkdir(dryRunDirectory, { recursive: true }),
      mkdir(packDirectory, { recursive: true }),
      mkdir(consumerDirectory, { recursive: true }),
    ]);

    const requiredFiles = await requiredPackageFiles();
    const dryRunResult = await runSuccessfully(
      [
        npmExecutable,
        "pack",
        "--dry-run",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        dryRunDirectory,
      ],
      packageRoot,
    );
    const dryRunReport = parsePackReport(dryRunResult.stdout, "npm pack --dry-run");
    validateManifest(dryRunReport, requiredFiles, "npm pack --dry-run manifest");

    const packResult = await runSuccessfully(
      [npmExecutable, "pack", "--ignore-scripts", "--json", "--pack-destination", packDirectory],
      packageRoot,
    );
    const packReport = parsePackReport(packResult.stdout, "npm pack");
    validateManifest(packReport, requiredFiles, "packed tarball manifest");
    validateMatchingManifests(dryRunReport, packReport);

    invariant(
      basename(packReport.filename) === packReport.filename,
      `npm returned an unsafe tarball filename: ${packReport.filename}`,
    );
    const tarballPath = join(packDirectory, packReport.filename);
    const tarball = await stat(tarballPath);
    invariant(tarball.isFile() && tarball.size > 0, `npm did not create a non-empty tarball: ${tarballPath}`);

    await writeFile(
      join(consumerDirectory, "package.json"),
      `${JSON.stringify(
        {
          name: "serve-emu-package-smoke-consumer",
          private: true,
          type: "module",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await runSuccessfully(
      [bunExecutable, "install", "--ignore-scripts", "--no-progress", "--no-summary", tarballPath],
      consumerDirectory,
    );

    const installedManifest = JSON.parse(
      await readFile(
        join(consumerDirectory, "node_modules", "serve-emu", "package.json"),
        "utf8",
      ),
    ) as { exports?: unknown };
    invariant(
      typeof installedManifest.exports === "object" &&
        installedManifest.exports !== null &&
        !Array.isArray(installedManifest.exports) &&
        Object.keys(installedManifest.exports).length === 0,
      "Installed package does not contain the documented CLI-only export policy",
    );

    const cliResult = await runCommand(
      [bunExecutable, "run", "serve-emu", "--help"],
      consumerDirectory,
      { ...process.env, SERVE_EMU_UPDATE_CHECK: "0" },
    );
    invariant(
      cliResult.exitCode === 0 && cliResult.stdout.includes("Usage:") && cliResult.stdout.includes("serve-emu"),
      [
        "Installed serve-emu CLI did not print help successfully",
        cliResult.stdout.trim(),
        cliResult.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );

    await expectImportFailure("serve-emu", consumerDirectory);
    await expectImportFailure("serve-emu/src/adb.ts", consumerDirectory);

    console.log(`Package smoke test passed: ${packReport.filename} (${packReport.files.length} files)`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3 });
  }
}

await main();
