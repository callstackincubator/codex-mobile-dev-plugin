import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { foregroundSimulatorPid, foregroundPhysicalPid } from "../src/server/device-apps/foreground.ts";
import { getDiscoveryCommandDiagnostic } from "../src/shared/device-apps-command-diagnostics.ts";
import { deviceAppsDiagnostic } from "../src/shared/device-apps-diagnostics.ts";
import { assertBuildEnvironment, telemetryBuildEnvironment } from "./telemetry-build.mjs";

const environment = telemetryBuildEnvironment();
await assertBuildEnvironment("dist", environment);
process.env.MOBILE_DEV_TELEMETRY = "off";
const simulator = new URL("../dist/baguette/Baguette", import.meta.url);
const physical = new URL("../dist/ios-fps/mobile-dev-ios-fps", import.meta.url);
const missing = randomUUID();
const scenarios = [
  { command: "ios_simulator_foreground", run: () => foregroundSimulatorPid(missing, undefined, simulator) },
  { command: "ios_physical_foreground", run: () => foregroundPhysicalPid("00000000-0000000000000000", undefined, physical) },
];
for (const scenario of scenarios) {
  let failed = false;
  try { await scenario.run(); }
  catch (error) {
    failed = true;
    const diagnostic = getDiscoveryCommandDiagnostic(error);
    assert.ok(diagnostic);
    assert.equal(diagnostic.command, scenario.command);
    assert.equal(diagnostic.cause, "device_not_found");
    assert.equal(diagnostic.termination, "exit");
    assert.equal(diagnostic.exit_status, 1);
    assert.ok(diagnostic.elapsed_ms >= 0);
    const stage = deviceAppsDiagnostic(error, "foreground", "ios");
    assert.equal(stage.failure, "command_failed");
    const encoded = JSON.stringify(diagnostic);
    const includesIdentifier = encoded.includes(missing);
    const includesPath = encoded.includes("/Users/");
    assert.equal(includesIdentifier, false);
    assert.equal(includesPath, false);
  }
  assert.equal(failed, true);
}
console.log(`Packaged foreground helper diagnostics passed (${environment}); telemetry disabled.`);
