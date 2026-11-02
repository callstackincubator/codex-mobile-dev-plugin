import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import typescriptRuntime, { resetTypeScriptRuntime, resolveTypeScript, setTypeScriptProject } from "../src/app-flow/typescript-runtime.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  resetTypeScriptRuntime();
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

/** A project directory, optionally carrying its own stand-in for the compiler. */
async function project(compiler?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mobile-dev-ts-runtime-"));
  temporaryRoots.push(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
  if (compiler !== undefined) {
    const installed = join(root, "node_modules", "typescript");
    await mkdir(installed, { recursive: true });
    await writeFile(join(installed, "package.json"), JSON.stringify({ name: "typescript", version: "5.9.3", main: "index.js" }));
    await writeFile(join(installed, "index.js"), compiler);
  }
  return root;
}

describe("App Flow TypeScript runtime", () => {
  it("parses with the compiler installed in the project being read", async () => {
    setTypeScriptProject(await project("module.exports = { marker: 'from-project' };"));
    assert.equal((typescriptRuntime as unknown as { marker: string }).marker, "from-project");
  });

  it("keeps the resolved compiler rather than reloading it for the next project", async () => {
    setTypeScriptProject(await project("module.exports = { marker: 'first' };"));
    assert.equal((typescriptRuntime as unknown as { marker: string }).marker, "first");
    setTypeScriptProject(await project("module.exports = { marker: 'second' };"));
    assert.equal((typescriptRuntime as unknown as { marker: string }).marker, "first");
  });

  it("falls back to the copy beside the sources, which is how the tests themselves parse", () => {
    assert.equal(typeof typescriptRuntime.createSourceFile, "function");
    assert.equal(typeof typescriptRuntime.isIdentifier, "function");
  });

  it("reports an installable fix when neither the project nor the bundle has a compiler", async () => {
    const root = await project();
    // Both bases are empty fixtures, so nothing resolves and the error path is the only outcome.
    let error: unknown;
    try {
      resolveTypeScript(root, join(root, "package.json"));
    } catch (thrown) {
      error = thrown;
    }
    assert.ok(error instanceof ExpectedOperationError);
    assert.equal(error.outcome, "invalid_input");
    assert.match(error.message, new RegExp(`${root}[\\s\\S]*npm install --save-dev typescript`));
  });

  it("prefers the project copy over the one the bundle would otherwise fall back to", async () => {
    const root = await project("module.exports = { marker: 'project-wins' };");
    const fallback = await project("module.exports = { marker: 'fallback' };");
    const compiler = resolveTypeScript(root, join(fallback, "package.json")) as unknown as { marker: string };
    assert.equal(compiler.marker, "project-wins");
  });
});
