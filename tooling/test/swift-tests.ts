import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

type SwiftTestOptions = { define: string; sanitizeThread?: boolean; timeout: number };

// Builds Swift Testing sources into one executable without SwiftPM, runs it and returns its output.
export async function runSwiftTests(directory: string, sources: string[], options: SwiftTestOptions): Promise<string> {
  const runnerPath = join(directory, "TestMain.swift");
  await writeFile(runnerPath, `import Darwin
import Testing
@main enum TestMain {
    static func main() async {
        let status: CInt = await Testing.__swiftPMEntryPoint()
        exit(status)
    }
}
`);
  const platformResult = await execute("xcrun", ["--sdk", "macosx", "--show-sdk-platform-path"]);
  const platform = platformResult.stdout.trim();
  const frameworks = join(platform, "Developer/Library/Frameworks");
  const compilerResult = await execute("xcrun", ["--find", "swiftc"]);
  const compiler = compilerResult.stdout.trim();
  const compilerDirectory = dirname(compiler);
  const testingMacros = join(compilerDirectory, "../lib/swift/host/plugins/testing/libTestingMacros.dylib");
  const binary = join(directory, "swift-tests");
  const sanitizer = options.sanitizeThread ? ["-sanitize=thread"] : [];
  await execute("xcrun", ["swiftc", "-swift-version", "6", "-g", "-parse-as-library",
    "-D", options.define, ...sanitizer, "-load-plugin-library", testingMacros,
    "-F", frameworks, "-Xlinker", "-rpath", "-Xlinker", frameworks, ...sources, runnerPath, "-o", binary], { timeout: 45000 });
  const env = { ...process.env, TSAN_OPTIONS: "halt_on_error=1" };
  const result = await execute(binary, [], { timeout: options.timeout, env });
  return result.stdout + result.stderr;
}
