import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { build } from "esbuild";

const execute = promisify(execFile);

async function probe(moduleUrl: URL, closeExport: string) {
  const script = `
    import assert from "node:assert/strict";
    import { createServer } from "node:http";
    import { Socket } from "node:net";
    const originalFetch = globalThis.fetch;
    const originalResponse = globalThis.Response;
    const originalFormData = globalThis.FormData;
    let tosCalls = 0;
    Socket.prototype.setTypeOfService = function () {
      tosCalls += 1;
      const error = new Error("setTypeOfService EINVAL");
      error.code = "EINVAL";
      throw error;
    };
    const runtime = await import(${JSON.stringify(moduleUrl.href)});
    const close = runtime[${JSON.stringify(closeExport)}];
    assert.equal(globalThis.fetch, originalFetch);
    assert.equal(globalThis.Response, originalResponse);
    assert.equal(globalThis.FormData, originalFormData);
    let pendingStarted;
    let pendingReady = new Promise(resolve => { pendingStarted = resolve; });
    const server = createServer(async (request, response) => {
      if (request.url === "/reset") {
        request.socket.resetAndDestroy();
        return;
      }
      if (request.url === "/pending") {
        pendingStarted();
        return;
      }
      if (request.url === "/redirect") {
        response.writeHead(302, { location: "/ok" });
        response.end();
        return;
      }
      if (request.method === "POST") {
        let body = "";
        for await (const chunk of request) body += chunk;
        response.end(body);
        return;
      }
      response.end("ok");
    });
    server.listen(0, "127.0.0.1");
    await new Promise(resolve => { server.once("listening", resolve); });
    const address = server.address();
    const base = "http://127.0.0.1:" + address.port;
    try {
      const response = await fetch(base + "/ok");
      assert.ok(response instanceof originalResponse);
      const body = await response.text();
      assert.equal(body, "ok");
      assert.equal(tosCalls, 0, "Default requests must not set socket QoS.");
      const post = await fetch(base, { method: "POST", body: "hello" });
      const posted = await post.text();
      assert.equal(posted, "hello");
      const form = new FormData();
      form.set("field", "value");
      const multipart = await fetch(base, { method: "POST", body: form });
      const multipartBody = await multipart.text();
      assert.match(multipartBody, /name="field"/);
      assert.match(multipartBody, /value/);
      const redirect = await fetch(base + "/redirect");
      const redirected = await redirect.text();
      assert.equal(redirected, "ok");
      const forbiddenRedirect = fetch(base + "/redirect", { redirect: "error" });
      await assert.rejects(forbiddenRedirect, TypeError);
      const reset = fetch(base + "/reset");
      await assert.rejects(reset, TypeError);
      const controller = new AbortController();
      const pending = fetch(base + "/pending", { signal: controller.signal });
      const aborted = assert.rejects(pending, { name: "AbortError" });
      await pendingReady;
      controller.abort();
      await aborted;
      pendingReady = new Promise(resolve => { pendingStarted = resolve; });
      const shutdownRequest = fetch(base + "/pending");
      const shutdownRejected = assert.rejects(shutdownRequest, TypeError);
      await pendingReady;
      await close();
      await shutdownRejected;
      await close();
      const afterClose = fetch(base);
      await assert.rejects(afterClose, TypeError);
      console.log("HTTP runtime checks passed");
    } finally {
      await close();
      server.closeAllConnections();
      server.close();
    }
  `;
  const result = await execute(process.execPath, ["--input-type=module", "--eval", script], {
    env: { ...process.env, MOBILE_DEV_TELEMETRY: "off" }, timeout: 15000,
  });
  const output = result.stdout.trim();
  assert.equal(output, "HTTP runtime checks passed");
  assert.equal(result.stderr, "");
}

test("server startup prevents socket QoS crashes and preserves fetch behavior and shutdown", async () => {
  const instrument = new URL("../src/server/instrument.ts", import.meta.url);
  const telemetry = new URL("../src/server/telemetry.ts", import.meta.url);
  // The startup import selects the dispatcher before any outgoing request.
  const contents = `import ${JSON.stringify(instrument.href)}; export { closeServerTelemetry } from ${JSON.stringify(telemetry.href)};`;
  const encoded = encodeURIComponent(contents);
  const startup = new URL(`data:text/javascript,${encoded}`);
  await probe(startup, "closeServerTelemetry");
});

test("the bundled dispatcher works without dependencies beside the generated module", async t => {
  const temporary = tmpdir();
  const prefix = join(temporary, "mobile-dev-http-runtime-");
  const directory = await mkdtemp(prefix);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourceUrl = new URL("../src/server/http-runtime.ts", import.meta.url);
  const source = fileURLToPath(sourceUrl);
  const outfile = join(directory, "runtime.mjs");
  await build({
    entryPoints: [source], outfile, bundle: true, format: "esm", platform: "node", target: "node22.19",
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  const bundled = pathToFileURL(outfile);
  await probe(bundled, "closeHttpRuntime");
});
