#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const GENERATED_README_NOTICE =
  "<!-- Generated from ../../README.md by scripts/sync-readme.ts. Do not edit directly. -->";

const ROOT_README_PATH = resolve(import.meta.dir, "../../../README.md");
const PACKAGE_README_PATH = resolve(import.meta.dir, "../README.md");

const PACKAGE_LINK_REWRITES = [
  ["packages/serve-emu/package.json", "package.json"],
  ["packages/serve-emu/CHANGELOG.md", "CHANGELOG.md"],
  ["packages/serve-emu/docs/protocol.md", "docs/protocol.md"],
  [
    "CONTRIBUTING.md",
    "https://github.com/jiunshinn/serve-emu/blob/main/CONTRIBUTING.md",
  ],
] as const;

const PACKAGE_LINK_LABEL_REWRITES = [
  ["packages/serve-emu/package.json", "package.json"],
  ["packages/serve-emu/CHANGELOG.md", "CHANGELOG.md"],
] as const;

const PACKAGE_TEXT_REWRITES = [
  ["`packages/serve-emu/vendor/`", "`vendor/`"],
] as const;

/** Render the package README from the canonical repository-root README. */
export function renderPackageReadme(rootReadme: string): string {
  let rendered = rootReadme.replace(/\s*$/, "\n");
  for (const [from, to] of PACKAGE_LINK_LABEL_REWRITES) {
    rendered = rendered.replaceAll(`\`${from}\`](${from})`, `\`${to}\`](${to})`);
  }
  for (const [from, to] of PACKAGE_LINK_REWRITES) {
    rendered = rendered.replaceAll(`](${from})`, `](${to})`);
  }
  for (const [from, to] of PACKAGE_TEXT_REWRITES) {
    rendered = rendered.replaceAll(from, to);
  }
  return `${GENERATED_README_NOTICE}\n\n${rendered}`;
}

/** Pure comparison helper used by the CLI and tests. */
export function checkPackageReadme(
  rootReadme: string,
  packageReadme: string,
): { current: boolean; expected: string } {
  const expected = renderPackageReadme(rootReadme);
  return { current: packageReadme === expected, expected };
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  if (
    args.length !== 1 ||
    (args[0] !== "--write" && args[0] !== "--check")
  ) {
    console.error("Usage: bun run scripts/sync-readme.ts <--write|--check>");
    process.exitCode = 2;
    return;
  }

  const rootReadme = await readFile(ROOT_README_PATH, "utf8");
  const expected = renderPackageReadme(rootReadme);

  if (args[0] === "--write") {
    await writeFile(PACKAGE_README_PATH, expected);
    console.log("Updated packages/serve-emu/README.md from README.md");
    return;
  }

  const packageReadme = await readFile(PACKAGE_README_PATH, "utf8");
  if (!checkPackageReadme(rootReadme, packageReadme).current) {
    console.error(
      "packages/serve-emu/README.md is stale; run `bun run scripts/sync-readme.ts --write` from packages/serve-emu",
    );
    process.exitCode = 1;
    return;
  }
  console.log("Package README is synchronized");
}

if (import.meta.main) {
  await main();
}
