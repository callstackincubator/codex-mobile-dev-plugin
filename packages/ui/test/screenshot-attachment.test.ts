import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { encodeScreenshotAttachment, SCREENSHOT_ATTACHMENT_MAX_BYTES } from "../src/screenshot-attachment.ts";

type Encoding = { width: number; height: number; quality: number; type: string };

function fixture(t: TestContext, encode: (options: Encoding) => Blob | Promise<Blob>, width = 1200, height = 2600) {
  let closed = 0;
  const canvases: Canvas[] = [];
  const attempts: Encoding[] = [];
  class Canvas {
    width: number;
    height: number;
    fillStyle = "";
    constructor(width: number, height: number) { this.width = width; this.height = height; canvases.push(this); }
    getContext() { return this; }
    fillRect() { assert.equal(this.fillStyle, "white"); }
    drawImage() {}
    async convertToBlob(options: { quality: number; type: string }) {
      const attempt = { width: this.width, height: this.height, ...options };
      attempts.push(attempt);
      return encode(attempt);
    }
  }
  const globals = {
    OffscreenCanvas: Canvas,
    createImageBitmap: async (image: Blob) => {
      assert.equal(image.type, "image/png");
      const bytes = await image.arrayBuffer();
      const source = Buffer.from(bytes).toString("hex");
      assert.equal(source, "010203");
      return { width, height, close() { closed++; } };
    },
  };
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  return { attempts, canvases, get closed() { return closed; } };
}

function jpeg(size: number) {
  const bytes = new Uint8Array(size);
  bytes.fill(255);
  return new Blob([bytes], { type: "image/jpeg" });
}

test("a full-resolution JPEG at the byte cap is valid for Codex and releases image resources", async t => {
  const f = fixture(t, () => jpeg(SCREENSHOT_ATTACHMENT_MAX_BYTES));
  const result = await encodeScreenshotAttachment("AQID");
  const bytes = Buffer.from(result.data, "base64");
  assert.equal(bytes.length, SCREENSHOT_ATTACHMENT_MAX_BYTES);
  assert.equal(result.mimeType, "image/jpeg");
  assert.deepEqual(f.attempts, [{ width: 1200, height: 2600, quality: 0.9, type: "image/jpeg" }]);
  const hostValidator = /^data:image\/(?:png|jpeg|webp|gif);base64,(?=.+)(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  const dataUrl = `data:${result.mimeType};base64,${result.data}`;
  assert.equal(hostValidator.test(dataUrl), true);
  assert.equal(f.closed, 1);
  assert.equal(f.canvases[0].width, 0);
  assert.equal(f.canvases[0].height, 0);
});

test("lower JPEG quality can meet the budget without reducing screen dimensions", async t => {
  const f = fixture(t, options => jpeg(options.quality === 0.9 ? SCREENSHOT_ATTACHMENT_MAX_BYTES + 1 : 100));
  const result = await encodeScreenshotAttachment("AQID");
  const bytes = Buffer.from(result.data, "base64");
  assert.equal(bytes.length, 100);
  const attempts = f.attempts.map(item => [item.width, item.height, item.quality]);
  assert.deepEqual(attempts, [[1200, 2600, 0.9], [1200, 2600, 0.75]]);
});

test("large noisy images shrink until they fit even when the encoder ignores quality", async t => {
  const f = fixture(t, options => jpeg(options.width * options.height * 3));
  const result = await encodeScreenshotAttachment("AQID");
  const bytes = Buffer.from(result.data, "base64");
  assert.ok(bytes.length <= SCREENSHOT_ATTACHMENT_MAX_BYTES);
  const last = f.attempts.at(-1)!;
  assert.ok(last.width < 1200);
  assert.ok(last.height < 2600);
  assert.ok(Math.abs(last.width / last.height - 1200 / 2600) < 0.01);
  assert.equal(f.closed, 1);
});

test("encoding errors release the bitmap and canvas without returning the PNG", async t => {
  const f = fixture(t, () => { throw new Error("Encoder failed"); });
  await assert.rejects(encodeScreenshotAttachment("AQID"), /Encoder failed/);
  assert.equal(f.closed, 1);
  assert.equal(f.canvases[0].width, 0);
  assert.equal(f.canvases[0].height, 0);
});

test("unsupported JPEG output and empty images are rejected", async t => {
  for (const output of [new Blob(["png"], { type: "image/png" }), new Blob([], { type: "image/jpeg" })]) {
    await t.test(output.type + output.size, async child => {
      const f = fixture(child, () => output);
      await assert.rejects(encodeScreenshotAttachment("AQID"), /JPEG encoding failed/);
      assert.equal(f.closed, 1);
    });
  }
});

test("an encoder that never respects the budget terminates at one pixel", async t => {
  const f = fixture(t, () => jpeg(SCREENSHOT_ATTACHMENT_MAX_BYTES + 1), 2, 1);
  await assert.rejects(encodeScreenshotAttachment("AQID"), /exceeds the chat image budget/);
  const attempts = f.attempts.map(item => [item.width, item.height]);
  assert.deepEqual(attempts, [[2, 1], [2, 1], [1, 1]]);
  assert.equal(f.closed, 1);
});
