import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { baguetteEnvironment } from "../src/server/baguette-runtime.ts";
import { removeBaguetteToolchainRpaths } from "../scripts/baguette-rpaths.mjs";

const execute = promisify(execFile);
const spanLoadCommands = `Load command 1
          cmd LC_LOAD_DYLIB
         name @rpath/libswiftCompatibilitySpan.dylib (offset 24)
`;

async function fixture(t: { after(callback: () => Promise<void>): void }) {
  const temporary = tmpdir();
  const prefix = join(temporary, "baguette-runtime-");
  const root = await mkdtemp(prefix);
  t.after(() => rm(root, { recursive: true, force: true }));
  const developer = join(root, "Custom Xcode.app/Contents/Developer");
  const tools = join(developer, "usr/bin");
  await mkdir(tools, { recursive: true });
  const xcodebuild = join(tools, "xcodebuild");
  await writeFile(xcodebuild, "");
  await chmod(xcodebuild, 0o755);
  const libraries = join(developer, "Toolchains/XcodeDefault.xctoolchain/usr/lib/swift-6.2/macosx");
  await mkdir(libraries, { recursive: true });
  const library = join(libraries, "libswiftCompatibilitySpan.dylib");
  await writeFile(library, "test library");
  return { root, developer, libraries, library, xcodebuild };
}

test("Baguette discovers a custom selected Xcode and limits its loader environment to that toolchain", async t => {
  const f = await fixture(t);
  const previous = process.env.DYLD_LIBRARY_PATH;
  process.env.DYLD_LIBRARY_PATH = "/unrelated/toolchain";
  t.after(() => {
    if (previous === undefined) delete process.env.DYLD_LIBRARY_PATH;
    else process.env.DYLD_LIBRARY_PATH = previous;
  });
  const controller = new AbortController();
  let calls = 0;
  const environment = await baguetteEnvironment("/relocated plugin/Baguette", controller.signal, async (command, args, options) => {
    calls++;
    assert.equal(options.signal.aborted, false);
    if (command === "/usr/bin/xcode-select") {
      assert.deepEqual(args, ["--print-path"]);
      return { stdout: f.developer + "\n" };
    }
    if (command === "/usr/bin/otool") {
      assert.deepEqual(args, ["-l", "/relocated plugin/Baguette"]);
      return { stdout: spanLoadCommands };
    }
    assert.equal(command, "/usr/bin/xcrun");
    assert.deepEqual(args, ["swift-stdlib-tool", "--print", "--scan-executable", "/relocated plugin/Baguette", "--platform", "macosx"]);
    assert.equal(options.env?.DEVELOPER_DIR, f.developer);
    assert.equal(options.env?.DYLD_LIBRARY_PATH, undefined);
    return { stdout: `${f.library}\n${f.library}\n` };
  });
  assert.equal(calls, 3);
  assert.equal(environment.DEVELOPER_DIR, f.developer);
  assert.equal(environment.DYLD_LIBRARY_PATH, f.libraries);
  assert.equal(process.env.DYLD_LIBRARY_PATH, "/unrelated/toolchain");
});

test("Baguette rejects missing Xcode and Command Line Tools with actionable errors", async t => {
  const f = await fixture(t);
  await rm(f.xcodebuild);
  const controller = new AbortController();
  for (const selected of [undefined, f.developer]) {
    let calls = 0;
    const pending = baguetteEnvironment("Baguette", controller.signal, async () => {
      calls++;
      if (selected === undefined) throw new Error("private command output");
      return { stdout: selected };
    });
    await assert.rejects(pending, /requires a full Xcode installation.*Settings > Locations/);
    assert.equal(calls, 1);
  }
});

test("Baguette reports missing runtime libraries without leaking scanner diagnostics", async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  const pending = baguetteEnvironment("Baguette", controller.signal, async command => {
    if (command === "/usr/bin/xcode-select") return { stdout: f.developer };
    if (command === "/usr/bin/otool") return { stdout: spanLoadCommands };
    throw new Error("PRIVATE_PATH PRIVATE_OUTPUT");
  });
  await assert.rejects(pending, error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /cannot supply Baguette's required Swift runtime libraries/);
    assert.equal(error.message.includes("PRIVATE"), false);
    return true;
  });
});

test("Baguette checks every discovered library and rejects other toolchains", async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  const missing = join(f.libraries, "libswiftMissing.dylib");
  for (const output of [missing, "/other/Xcode.app/Contents/Developer/Toolchains/libswiftCompatibilitySpan.dylib"]) {
    const pending = baguetteEnvironment("Baguette", controller.signal, async command => {
      if (command === "/usr/bin/otool") return { stdout: spanLoadCommands };
      const stdout = command === "/usr/bin/xcode-select" ? f.developer : output;
      return { stdout };
    });
    await assert.rejects(pending, /cannot supply Baguette's required Swift runtime libraries/);
  }
});

test("Baguette rejects a scanner that silently omits a required compatibility library", async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  const pending = baguetteEnvironment("Baguette", controller.signal, async command => {
    if (command === "/usr/bin/xcode-select") return { stdout: f.developer };
    if (command === "/usr/bin/otool") return { stdout: spanLoadCommands };
    return { stdout: "" };
  });
  await assert.rejects(pending, /cannot supply Baguette's required Swift runtime libraries/);
});

test("Baguette supports a binary with no additional Swift runtime libraries", async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  const environment = await baguetteEnvironment("Baguette", controller.signal, async command => {
    const stdout = command === "/usr/bin/xcode-select" ? f.developer : "";
    return { stdout };
  });
  assert.equal(environment.DYLD_LIBRARY_PATH, undefined);
});

test("Baguette discovery stops when the plugin closes", async () => {
  const controller = new AbortController();
  const pending = baguetteEnvironment("Baguette", controller.signal, async (_command, _args, options) => {
    controller.abort();
    options.signal.throwIfAborted();
    return { stdout: "" };
  });
  await assert.rejects(pending, { name: "AbortError" });
  let calls = 0;
  const cancelled = baguetteEnvironment("Baguette", controller.signal, async () => {
    calls++;
    return { stdout: "" };
  });
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.equal(calls, 0);
});

test("a relocated Baguette loads the selected Xcode library after its build-toolchain rpath is removed", {
  skip: process.platform !== "darwin" || process.arch !== "arm64", timeout: 15000,
}, async t => {
  const temporary = tmpdir();
  const prefix = join(temporary, "baguette-relocated-");
  const root = await mkdtemp(prefix);
  t.after(() => rm(root, { recursive: true, force: true }));
  const binary = join(root, "Baguette");
  await copyFile("vendor/baguette/Baguette", binary);
  await removeBaguetteToolchainRpaths(binary);
  const commands = await execute("otool", ["-l", binary]);
  const blocks = commands.stdout.split("Load command");
  const rpaths = blocks.filter(block => block.includes("LC_RPATH"));
  for (const rpath of rpaths) assert.equal(rpath.includes("/Toolchains/"), false);
  const selection = await execute("/usr/bin/xcode-select", ["--print-path"]);
  const developer = selection.stdout.trim();
  const customDeveloper = join(root, "My Custom Xcode/Developer");
  const customParent = join(root, "My Custom Xcode");
  await mkdir(customParent);
  await symlink(developer, customDeveloper);
  const previous = process.env.DEVELOPER_DIR;
  process.env.DEVELOPER_DIR = customDeveloper;
  t.after(() => {
    if (previous === undefined) delete process.env.DEVELOPER_DIR;
    else process.env.DEVELOPER_DIR = previous;
  });
  const controller = new AbortController();
  const environment = await baguetteEnvironment(binary, controller.signal);
  assert.equal(environment.DEVELOPER_DIR, customDeveloper);
  assert.ok(environment.DYLD_LIBRARY_PATH);
  environment.MOBILE_DEV_TELEMETRY = "off";
  environment.DYLD_PRINT_LIBRARIES = "1";
  const help = await execute(binary, ["--help"], { env: environment });
  assert.match(help.stdout, /USAGE:/);
  assert.match(help.stderr, /Toolchains\/.*libswiftCompatibilitySpan\.dylib/);
  await execute("codesign", ["--verify", binary]);
});
