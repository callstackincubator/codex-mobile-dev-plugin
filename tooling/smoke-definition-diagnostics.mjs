import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) env[key] = value;
}
env.MOBILE_DEV_TELEMETRY = "off";
const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/server.mjs"], env, stderr: "pipe" });
transport.stderr?.resume();
const client = new Client({ name: "definition-diagnostics-smoke", version: "1" });
try {
  await client.connect(transport);
  const result = await client.callTool({ name: "mobile_list_simulators", arguments: {} });
  assert.equal(result.isError, undefined, "The packaged backend must start.");
  const status = result.structuredContent;
  assert.equal(status.connected, true);
  const missing = randomUUID();
  const missingUrl = new URL(`/simulators/${missing}/definition.json`, status.baseUrl);
  const response = await fetch(missingUrl);
  assert.equal(response.status, 404);
  const body = await response.json();
  const diagnostic = body.definition_diagnostic;
  assert.equal(diagnostic.schema, "1");
  assert.equal(diagnostic.stage, "simulator_lookup");
  assert.equal(diagnostic.failure, "missing");
  assert.equal(diagnostic.model, "unknown");
  assert.match(diagnostic.xcode_version, /^\d{1,2}(?:\.\d{1,2}){0,2}$/);
  const encoded = JSON.stringify(diagnostic);
  const containsIdentifier = encoded.includes(missing);
  assert.equal(containsIdentifier, false);
  const booted = status.devices.find(device => device.state === "Booted" && device.name === "iPhone 17");
  if (booted !== undefined) {
    const primaryUrl = new URL(`/simulators/${booted.udid}/definition.json`, status.baseUrl);
    const primary = await fetch(primaryUrl);
    assert.equal(primary.status, 200);
    const secondaryUrl = new URL(`/simulators/${booted.udid}/definition.json?panel=secondary`, status.baseUrl);
    const secondary = await fetch(secondaryUrl);
    assert.equal(secondary.status, 404);
    const secondaryBody = await secondary.json();
    assert.equal(secondaryBody.definition_diagnostic.stage, "panel_lookup");
    assert.equal(secondaryBody.definition_diagnostic.model, "iPhone 17");
    assert.equal(secondaryBody.definition_diagnostic.state, "Booted");
    assert.equal(secondaryBody.definition_diagnostic.panel, "secondary");
    console.log("Packaged Baguette: valid definition succeeds; missing simulator and missing panel report distinct diagnostic stages.");
  } else {
    console.log("Packaged Baguette: missing simulator reports a structured diagnostic; no booted iPhone 17 was available for the panel check.");
  }
} finally {
  await client.close();
}
