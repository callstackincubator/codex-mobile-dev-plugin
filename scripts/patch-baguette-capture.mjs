import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function replaceOnce(source, before, after, name) {
  if (source.split(before).length !== 2) {
    throw new Error(`The pinned Baguette ${name} integration point changed.`);
  }
  return source.replace(before, after);
}

export async function patchBaguetteCapture(source) {
  const simulatorPath = join(source, "Sources/Baguette/Infrastructure/Simulator/CoreSimulators.swift");
  const simulator = await readFile(simulatorPath, "utf8");
  await writeFile(simulatorPath, replaceOnce(simulator,
    "    static func developerDir() -> String {\n",
    `    // Frameworks stay loaded for this process, so keep their selected Xcode.
    // Device, display and framebuffer lookup must still run for each capture.
    private static let selectedDeveloperDirectory = resolveDeveloperDirectory()

    static func developerDir() -> String { selectedDeveloperDirectory }

    private static func resolveDeveloperDirectory() -> String {
`, "developer directory"));

  const serverPath = join(source, "Sources/Baguette/Infrastructure/Server/Server.swift");
  let server = await readFile(serverPath, "utf8");
  // Limit the edit to the raw screenshot route. Bezel composition has its own path.
  const start = server.indexOf("    private static func screenshot(\n");
  const end = server.indexOf("    private static func screenshotBezelPNG(\n", start);
  if (start < 0 || end < 0) throw new Error("The pinned Baguette screenshot route changed.");
  let route = server.slice(start, end);
  route = replaceOnce(route, `            captured = try await ScreenSnapshot.capture(
                screen: sim.screen(),
                quality: quality,
                scale: max(1, scale)
            )`, `            captured = try await captureScreenshot(
                screen: sim.screen(), quality: quality, scale: scale,
                format: format, options: options
            )`, "screenshot capture");
  route = replaceOnce(route, `        let bytes: Data
        switch recapture(
            captured, sourceFormat: .jpeg, format: format,
            options: options, quality: quality
        ) {
        case .unchanged:
            bytes = captured
        case .encoded(let encoded):
            bytes = encoded
        case .failed:
            return errorJSON("capture encoding failed", status: .internalServerError)
        }
`, "", "screenshot encoding");
  route = replaceOnce(route, "ByteBuffer(data: bytes)", "ByteBuffer(data: captured)", "screenshot response");
  server = server.slice(0, start) + route + server.slice(end);
  await writeFile(serverPath, server);
  await copyFile("native/baguette/Server+Screenshot.swift",
    join(source, "Sources/Baguette/Infrastructure/Server/Server+Screenshot.swift"));
  await copyFile("native/baguette/ServerScreenshotCaptureTests.swift",
    join(source, "Tests/BaguetteTests/Server/ServerScreenshotCaptureTests.swift"));
}
