import test from "node:test";
import assert from "node:assert/strict";
import { panelPlacement } from "../src/panel-placement.ts";

test("MOBILE_DEV_PANEL overrides a server's panel placement only with a known placement", t => {
  const error = t.mock.method(console, "error", () => {});
  const warnings = () => {
    const lines = error.mock.calls.map(call => String(call.arguments[0]));
    error.mock.resetCalls();
    return lines;
  };
  for (const fallback of ["inline", "browser"] as const) {
    assert.equal(panelPlacement(fallback, {}), fallback);
    assert.equal(panelPlacement(fallback, { MOBILE_DEV_PANEL: "" }), fallback);
    assert.equal(panelPlacement(fallback, { MOBILE_DEV_PANEL: "browser" }), "browser");
    assert.equal(panelPlacement(fallback, { MOBILE_DEV_PANEL: "inline" }), "inline");
    assert.equal(panelPlacement(fallback, { MOBILE_DEV_PANEL: " Browser\n" }), "browser");
    assert.equal(panelPlacement(fallback, { MOBILE_DEV_PANEL: "INLINE" }), "inline");
    assert.deepEqual(warnings(), []);
    assert.equal(panelPlacement(fallback, { MOBILE_DEV_PANEL: "sidebar" }), fallback);
    const [warning, ...more] = warnings();
    assert.deepEqual(more, []);
    assert.match(warning, /MOBILE_DEV_PANEL="sidebar"/);
    assert.match(warning, /"inline" or "browser"/);
  }
});
