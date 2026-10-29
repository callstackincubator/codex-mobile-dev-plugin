import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { compositeBezelGeometry } from "../../shared/src/bezel.ts";
import { definitionSchema } from "../src/baguette.ts";
import { readBezel } from "../src/bezel.ts";
import { screenshotRequest } from "../src/png.ts";
import { deviceCommandTags } from "../../shared/src/device-command-diagnostics.ts";
import { UDID, PNG, attachedBaguette } from "../../test-support/fixtures.ts";

const geometry = { rect: { x: 18, y: 18, width: 400, height: 872 }, viewport: { width: 436, height: 908 }, clipRadius: 62 };

test("Apple bezel and mask pass through as PNG data with screen geometry", async t => {
  const server = createServer((request, response) => {
    if (request.url === "/simulators.json") response.end('{"running":[],"available":[]}');
    else if (request.url?.includes("bad.png")) response.end("invalid");
    else response.end(PNG);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const port = (server.address() as { port: number }).port;
  const backend = attachedBaguette(`http://127.0.0.1:${port}`);
  t.after(() => backend.dispose());
  await backend.start();
  const screen = { ...geometry, bezelImage: { rest: `/simulators/${UDID}/bezel.png` }, maskImage: `/simulators/${UDID}/screen-mask.png` };
  const bezel = await readBezel(backend, UDID, screen);
  assert.deepEqual(bezel, { ...geometry, image: `data:image/png;base64,${PNG.toString("base64")}`, mask: `data:image/png;base64,${PNG.toString("base64")}` });
  assert.equal(await readBezel(backend, UDID, { ...screen, bezelImage: { rest: "https://example.com/bezel.png" } }), undefined);
  assert.equal(await readBezel(backend, UDID, { ...screen, bezelImage: { rest: `/simulators/${UDID}/bad.png` } }), undefined);
  assert.equal(await readBezel(backend, UDID, { ...screen, rect: { ...geometry.rect, x: 1000 } }), undefined);
  assert.equal(await readBezel(backend, UDID, { rect: { width: 400, height: 872 } }), undefined);
  const withButtons = { ...screen, buttonMargins: { top: 0, left: 9, right: 9, bottom: 0 } };
  const parsedDefinition = definitionSchema.parse({ identity: { udid: UDID, name: "iPhone", model: "iPhone" }, screen: withButtons });
  const buttonBezel = await readBezel(backend, UDID, parsedDefinition.screen);
  assert.deepEqual(buttonBezel?.viewport, { width: 454, height: 908 });
  assert.deepEqual(buttonBezel?.rect, { x: 27, y: 18, width: 400, height: 872 });
  assert.equal(buttonBezel?.image, bezel?.image);
  const unmaskedDefinition = { identity: { udid: UDID, name: "iPhone", model: "iPhone" }, screen: { ...screen, maskImage: null } };
  const parsedUnmaskedDefinition = definitionSchema.parse(unmaskedDefinition);
  const unmaskedBezel = await readBezel(backend, UDID, parsedUnmaskedDefinition.screen);
  assert.equal(unmaskedBezel?.image, bezel?.image);
  assert.equal(unmaskedBezel?.mask, undefined);
  const missingMask = await readBezel(backend, UDID, { ...screen, maskImage: `/simulators/${UDID}/bad.png` });
  assert.equal(missingMask?.image, bezel?.image);
  assert.equal(missingMask?.mask, undefined);
});

test("backend byte reads keep their command and fixed messages, and stop at their size limit", async t => {
  const server = createServer((request, response) => {
    if (request.url === "/simulators.json") response.end('{"running":[],"available":[]}');
    else if (request.url?.includes("missing.png")) response.writeHead(500).end();
    else response.end(Buffer.alloc(64));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const backend = attachedBaguette(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  t.after(() => backend.dispose());
  await backend.start();
  assert.equal((await backend.fetchBytes(`/simulators/${UDID}/screenshot.png`, screenshotRequest("Baguette"))).length, 64);
  const failed = await backend.fetchBytes(`/simulators/${UDID}/missing.png`, screenshotRequest("Baguette")).catch((error: unknown) => error);
  assert.match(String(failed), /^Error: Screenshot failed with HTTP 500\.$/);
  assert.deepEqual(deviceCommandTags(failed), { device_command: "baguette_missing_png", device_command_failure: "http_status", device_command_status: "500" });
  const large = await backend.fetchBytes(`/simulators/${UDID}/screenshot.png`, { ...screenshotRequest("Baguette"), maxBytes: 16 }).catch((error: unknown) => error);
  assert.match(String(large), /^Error: Baguette returned an invalid or oversized PNG screenshot\.$/);
  assert.equal(deviceCommandTags(large).device_command_failure, "output_limit");
});

test("bezel placement includes button margins on every side", () => {
  const composite = compositeBezelGeometry({ ...geometry, buttonMargins: { left: 4, right: 6, top: 8, bottom: 10 } });
  assert.deepEqual(composite?.viewport, { width: 446, height: 926 });
  assert.deepEqual(composite?.rect, { x: 22, y: 26, width: 400, height: 872 });
  assert.equal(compositeBezelGeometry({ ...geometry, buttonMargins: { left: -1 } }), undefined);
});
