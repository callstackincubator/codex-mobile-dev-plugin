import test from "node:test";
import assert from "node:assert/strict";
import { screenRegions } from "../src/shared/screen-regions.ts";
import { componentAt } from "../src/shared/screen-annotations.ts";

function image(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  return { data, rect(x: number, y: number, w: number, h: number, rgb = [0, 100, 220]) {
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
      data.set([...rgb, 255], (row * width + col) * 4);
    }
  } };
}

test("pixel regions separate an image and button and map to device coordinates", () => {
  const { data, rect } = image(200, 440);
  rect(35, 110, 130, 90); rect(10, 220, 180, 24);
  const screen = { width: 400, height: 880 };
  const regions = screenRegions(data, 200, 440, screen);
  assert.equal(regions.length, 2);
  const photo = componentAt(regions, { x: 200, y: 300 }, screen);
  const button = componentAt(regions, { x: 200, y: 450 }, screen);
  assert.deepEqual(photo?.bounds, { x: 70, y: 220, width: 260, height: 180 });
  assert.deepEqual(button?.bounds, { x: 20, y: 440, width: 360, height: 48 });
  assert.equal(button?.source, "screen");
  assert.equal(componentAt(regions, { x: 200, y: 420 }, screen), undefined);
});

test("text words on the same row join without joining the next row", () => {
  const { data, rect } = image(200, 440);
  rect(20, 30, 25, 8, [40, 40, 40]); rect(50, 30, 40, 8, [40, 40, 40]);
  rect(20, 50, 60, 8, [40, 40, 40]);
  const regions = screenRegions(data, 200, 440, { width: 400, height: 880 });
  assert.equal(regions.length, 2);
  assert.deepEqual({ ...regions[0].bounds, y: Math.round(regions[0].bounds.y) }, { x: 40, y: 60, width: 140, height: 16 });
});

test("screen borders, empty images, and malformed buffers produce no giant highlight", () => {
  const { data, rect } = image(200, 440);
  rect(0, 0, 200, 2); rect(0, 438, 200, 2); rect(0, 0, 2, 440); rect(198, 0, 2, 440);
  assert.deepEqual(screenRegions(data, 200, 440, { width: 400, height: 880 }), []);
  assert.deepEqual(screenRegions(image(20, 40).data, 20, 40, { width: 20, height: 40 }), []);
  assert.deepEqual(screenRegions(new Uint8ClampedArray(3), 20, 40, { width: 20, height: 40 }), []);
  assert.deepEqual(screenRegions(data, 200, 440, { width: 0, height: 880 }), []);
});
