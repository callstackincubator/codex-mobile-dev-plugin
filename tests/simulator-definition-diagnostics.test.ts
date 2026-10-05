import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { Baguette } from "../src/server/baguette.ts";
import { definitionDiagnosticTags, getDefinitionDiagnostic, parseDefinitionDiagnostic } from "../src/shared/simulator-definition-diagnostics.ts";
import baguetteRelease from "../vendor/baguette-release.json" with { type: "json" };
const UDID = "B5C969F6-58A4-4C31-AB12-FB9E56D681DE";

const diagnostic = {
  schema: "1", stage: "profile_read", failure: "missing", model: "iPhone 17", runtime: "iOS 27.0",
  state: "Booted", panel: "primary", xcode_version: "27.0", backend_version: baguetteRelease.version,
  backend_source: baguetteRelease.rebuild.sourceCommit,
};

test("definition diagnostics reject raw errors, renamed models, paths, identifiers and unknown values", () => {
  const parsed = parseDefinitionDiagnostic({ error: "PRIVATE_RESPONSE", definition_diagnostic: {
    schema: "1", stage: "PRIVATE_STAGE", failure: "PRIVATE_FAILURE", model: "PRIVATE_DEVICE_NAME",
    runtime: "/Users/private/runtime", state: UDID, panel: "PRIVATE_PANEL", xcode_version: "PRIVATE_XCODE",
    backend_version: "PRIVATE_VERSION", backend_source: "PRIVATE_SOURCE", logs: "PRIVATE_LOGS",
  } });
  assert.deepEqual(parsed, {
    stage: "response", failure: "unclassified", model: "unknown", runtime: "unknown", state: "unknown",
    panel: "unknown", xcodeVersion: "unknown", backendVersion: "unknown", backendSource: "unknown",
    deviceBefore: "unknown", deviceAfter: "unknown", backendMode: "external", cachedFailure: "unknown",
  });
  const renamed = parseDefinitionDiagnostic({ definition_diagnostic: { ...diagnostic, model: "iPhone 17 PRIVATE_SUFFIX" } });
  assert.equal(renamed.model, "unknown");
  const unsupported = parseDefinitionDiagnostic({ definition_diagnostic: { ...diagnostic, schema: "2" } });
  assert.equal(unsupported.stage, "response");
});

for (const after of ["Booted", "Shutdown", "missing", "unreachable"]) {
  test(`a definition 404 preserves its cause and records device state after failure: ${after}`, async t => {
    let failed = false;
    const requests: string[] = [];
    const server = createServer((request, response) => {
      const path = request.url ?? "";
      requests.push(path);
      response.setHeader("Content-Type", "application/json");
      if (path === "/simulators.json") {
        if (failed && after === "unreachable") { response.writeHead(503).end(); return; }
        const state = failed ? after : "Booted";
        const devices = state === "missing" ? [] : [{ udid: UDID, name: "PRIVATE_RENAMED_DEVICE", runtime: "iOS 27.0", state }];
        const listing = JSON.stringify({ running: devices, available: [] });
        response.end(listing);
        return;
      }
      failed = true;
      const body = JSON.stringify({ error: `PRIVATE_RESPONSE ${UDID}`, definition_diagnostic: diagnostic });
      response.writeHead(404);
      response.end(body);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const backend = new Baguette(`http://127.0.0.1:${address.port}`);
    t.after(() => { backend.dispose(); server.closeAllConnections(); server.close(); });
    let failure: unknown;
    try { await backend.definition(UDID); }
    catch (error) { failure = error; }
    assert.ok(failure instanceof Error);
    assert.match(failure.message, /Baguette returned HTTP 404/);
    const tags = definitionDiagnosticTags(failure);
    assert.equal(tags.definition_stage, "profile_read");
    assert.equal(tags.definition_failure, "missing");
    assert.equal(tags.definition_model, "iPhone 17");
    assert.equal(tags.definition_device_before, "Booted");
    assert.equal(tags.definition_device_after, after);
    assert.equal(tags.definition_backend_source, "pinned");
    assert.equal(tags.definition_backend_mode, "external");
    const encoded = JSON.stringify(tags);
    const hasPrivateContent = encoded.includes("PRIVATE_");
    assert.equal(hasPrivateContent, false);
    const hasIdentifier = encoded.includes(UDID);
    assert.equal(hasIdentifier, false);
    const definitions = requests.filter(path => path.endsWith("definition.json"));
    assert.equal(definitions.length, 1);
  });
}

test("oversized, malformed and stalled 404 bodies preserve the HTTP error without leaking payloads", async t => {
  const server = createServer((request, response) => {
    response.writeHead(404, { "Content-Type": "application/json" });
    if (request.url?.includes("oversized")) {
      const body = "PRIVATE_BODY".repeat(1000);
      response.end(body);
    }
    else if (request.url?.includes("stalled")) response.write('{"private":');
    else response.end("PRIVATE_NON_JSON");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const backend = new Baguette(`http://127.0.0.1:${address.port}`);
  t.after(() => { backend.dispose(); server.closeAllConnections(); server.close(); });
  for (const model of ["oversized", "malformed", "stalled"]) {
    let failure: unknown;
    try { await backend.json(`/simulators/${model}/definition.json`, {}, 50); }
    catch (error) { failure = error; }
    assert.ok(failure instanceof Error);
    assert.match(failure.message, /HTTP 404/);
    const parsed = getDefinitionDiagnostic(failure);
    assert.equal(parsed?.failure, "unclassified");
    const encoded = JSON.stringify(parsed);
    const hasPrivateContent = encoded.includes("PRIVATE_");
    assert.equal(hasPrivateContent, false);
  }
  let other: unknown;
  try { await backend.json("/other"); }
  catch (error) { other = error; }
  assert.equal(getDefinitionDiagnostic(other), undefined);
});
