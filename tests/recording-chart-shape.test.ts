import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

test("the chart tip follows path length through vertical changes and gaps", async () => {
  const built = await build({
    stdin: {
      contents: 'export { traceRecordingPoints } from "./src/ui/components/recording-chart-shape.tsx";',
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, format: "iife", globalName: "RecordingShapeTest", platform: "browser", jsx: "automatic",
  });
  const instantiate = new Function(`${built.outputFiles[0].text}; return RecordingShapeTest;`);
  const shape: Pick<typeof import("../src/ui/components/recording-chart-shape.tsx"), "traceRecordingPoints"> = instantiate();
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 20, y: 20 }];
  const start = shape.traceRecordingPoints(points, 0);
  const middle = shape.traceRecordingPoints(points, 0.5);
  const end = shape.traceRecordingPoints(points, 1);
  assert.deepEqual(start, []);
  assert.deepEqual(middle, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], "The tip draws the vertical section without moving points already drawn.");
  assert.equal(end, points, "The completed curve keeps the original measured coordinates.");

  const gap = { x: 15, y: null };
  const gapped = [{ x: 0, y: 0 }, { x: 10, y: 0 }, gap, { x: 20, y: 0 }, { x: 30, y: 0 }];
  const afterGap = shape.traceRecordingPoints(gapped, 0.75);
  assert.deepEqual(afterGap, [{ x: 0, y: 0 }, { x: 10, y: 0 }, gap, { x: 20, y: 0 }, { x: 25, y: 0 }], "Missing readings remain gaps and the following segment draws in sequence.");
});
