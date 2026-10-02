import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Baguette } from "../src/server/baguette.ts";
import { compositeBezelGeometry } from "../src/shared/bezel.ts";
import { definitionSchema } from "../src/server/baguette.ts";
import { readBezel } from "../src/server/bezel.ts";
import { UDID, PNG } from "./fixtures.ts";

const geometry = { rect: { x: 18, y: 18, width: 400, height: 872 }, viewport: { width: 436, height: 908 }, clipRadius: 62 };

test("Apple bezel and mask pass through as PNG data with screen geometry", async t => {
  const server = createServer((request, response) => {
    if (request.url?.includes("bad.png")) response.end("invalid");
    else response.end(PNG);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const port = (server.address() as { port: number }).port;
  const backend = new Baguette(`http://127.0.0.1:${port}`);
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

test("bezel placement includes button margins on every side", () => {
  const composite = compositeBezelGeometry({ ...geometry, buttonMargins: { left: 4, right: 6, top: 8, bottom: 10 } });
  assert.deepEqual(composite?.viewport, { width: 446, height: 926 });
  assert.deepEqual(composite?.rect, { x: 22, y: 26, width: 400, height: 872 });
  assert.equal(compositeBezelGeometry({ ...geometry, buttonMargins: { left: -1 } }), undefined);
});
