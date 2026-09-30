import test from "node:test";
import assert from "node:assert/strict";
import { androidFrameGeometry } from "../src/ui/android-frame-geometry.ts";

test("Android nine-patch keeps the complete video ratio inside the available space", () => {
  for (const [width, height] of [[1080, 2400], [1080, 2424], [2400, 1080], [1600, 2560]]) {
    for (const [availableWidth, availableHeight] of [[350, 800], [900, 300]]) {
      const geometry = androidFrameGeometry(width, height, availableWidth, availableHeight);
      assert.ok(Math.abs(geometry.screenWidth / geometry.screenHeight - width / height) < 1e-10);
      assert.ok(geometry.frameWidth * geometry.scale <= availableWidth + 1e-10);
      assert.ok(geometry.frameHeight * geometry.scale <= availableHeight + 1e-10);
      assert.ok(geometry.frameWidth > geometry.screenWidth);
      assert.ok(geometry.frameHeight > geometry.screenHeight);
    }
  }
});
