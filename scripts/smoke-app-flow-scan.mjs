import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Run the packaged scanner, stopping at an empty inspector before any device access. */
export async function verifyPackagedFlowScan(client, sourceFolder) {
  const temporary = sourceFolder ? undefined : await mkdtemp(join(tmpdir(), "mobile-dev-scan-"));
  const projectRoot = sourceFolder ?? temporary;
  const inspector = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end("[]");
  });
  try {
    if (temporary) await writeFile(join(temporary, "App.tsx"), 'export function App() { return <Stack.Navigator><Stack.Screen name="PackagedScreen" component={Home} /></Stack.Navigator>; }');
    inspector.listen(0, "127.0.0.1"); await once(inspector, "listening");
    const metroUrl = `http://127.0.0.1:${inspector.address().port}`;
    const started = await client.callTool({ name: "mobile_app_flow", arguments: { action: "start", options: {
      projectRoot, metroUrl, targetId: "absent-test-target", deviceId: "00000000-0000-0000-0000-000000000000", platform: "ios", useAi: false,
    } } });
    assert.ok(!started.isError, JSON.stringify(started.content));
    let run = started.structuredContent.run;
    const deadline = Date.now() + 10000;
    while (!["complete", "failed", "stopped"].includes(run.phase) && Date.now() < deadline) {
      await delay(25);
      const result = await client.callTool({ name: "mobile_read_app_flow", arguments: { runId: run.id } });
      run = result.structuredContent.run;
    }
    assert.equal(run.phase, "failed", "The scan must finish at the empty inspector.");
    assert.match(run.error ?? "", /selected Metro app is no longer connected/, run.error);
    assert.ok(run.files > 0 && run.scanMs > 0, "The packaged scanner must finish reading the source files.");
    // Reachability needs a mounted app. Publishing the raw registration catalog
    // here would expose duplicate screens and edges before that filtering runs.
    assert.deepEqual(run.nodes, []);
    assert.deepEqual(run.edges, []);
    console.log(`Packaged App Flow scanner: ${run.files} files, ${Math.round(run.scanMs)} ms. Unverified routes stayed hidden; no device navigation attempted.`);
    return run.id;
  } finally {
    inspector.closeAllConnections();
    await new Promise(resolve => inspector.close(resolve));
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
