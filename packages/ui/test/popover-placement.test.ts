import test from "node:test";
import assert from "node:assert/strict";
import { MARGIN, placeBelow, placeBeside } from "../src/popover-placement.ts";
import type { Box } from "../src/popover-placement.ts";

/** A rectangle the way the DOM reports one. */
const box = (left: number, top: number, width: number, height: number): Box =>
  ({ left, top, width, height, right: left + width, bottom: top + height });

const MENU = { width: 280, height: 230 };
/** The command list: thirteen rows and two headings. */
const COMMANDS = { width: 220, height: 520 };

test("a menu hangs below the element it is about when the window has room", () => {
  const element = box(120, 300, 94, 54);
  const placed = placeBelow(element, MENU, { width: 1200, height: 900 });
  assert.deepEqual({ left: placed.left, top: placed.top }, { left: 120, top: 360 });
});

test("a menu with no room below it goes above the element rather than off the window", () => {
  // The case the panel actually fails on: a tab at the bottom of a short panel. The old placement
  // guessed a fixed 200px of menu and let the rest run past the bottom, where the stage clipped it.
  const tab = box(240, 540, 94, 54);
  const placed = placeBelow(tab, MENU, { width: 687, height: 640 });
  assert.equal(placed.top, 540 - 6 - 230, "above the element, its own height up from it");
  assert.ok(placed.top >= MARGIN && placed.top + MENU.height <= 640 - MARGIN, "wholly inside the window");
});

test("a menu that fits neither way is pinned to the window instead of being cut off", () => {
  const element = box(40, 150, 94, 54);
  const placed = placeBelow(element, MENU, { width: 500, height: 300 });
  assert.equal(placed.top, 300 - MARGIN - 230);
  assert.ok(placed.top >= MARGIN);
  // Taller than the window: it scrolls, which is the only honest answer.
  const tall = placeBelow(element, { width: 280, height: 1000 }, { width: 500, height: 300 });
  assert.equal(tall.maxHeight, 300 - MARGIN * 2);
  assert.equal(tall.top, MARGIN);
});

test("a menu is pushed in from the edges it would cross", () => {
  const view = { width: 400, height: 900 };
  assert.equal(placeBelow(box(380, 100, 20, 20), MENU, view).left, 400 - 280 - MARGIN);
  assert.equal(placeBelow(box(-40, 100, 20, 20), MENU, view).left, MARGIN);
});

test("a submenu opens to the right, which is where its chevron points", () => {
  const row = box(290, 500, 280, 36);
  const roomy = placeBeside(row, COMMANDS, { width: 1200, height: 900 });
  assert.equal(roomy.left, 570 + 4, "beside the row it hangs off");
  assert.equal(roomy.top, 536 - 520, "bottom-aligned with the row, growing upward");

  // The panel the recorder actually runs in is a few hundred points wide, so "flip when it does
  // not fit" meant it opened on the left nearly always — a chevron pointing one way and a panel
  // opening the other. It is pushed in from the window's edge instead.
  const tight = placeBeside(row, COMMANDS, { width: 687, height: 640 });
  assert.equal(tight.left, 687 - 220 - MARGIN);
  assert.ok(tight.left > row.left, "still to the right of the row, overlapping the menu it came from");
});

test("a submenu taller than the room above its row is pushed down, not off the window", () => {
  const row = box(100, 240, 280, 36);
  const placed = placeBeside(row, COMMANDS, { width: 1200, height: 640 });
  assert.equal(placed.top, MARGIN, "its top stops at the window, and the rest of it scrolls");
  assert.equal(placed.maxHeight, 640 - MARGIN * 2);
});

test("a cascading branch flips to the left, but only when the left has room", () => {
  const row = box(290, 500, 280, 36);
  const panel = { width: 220, height: 200 };
  // Room on the right: the branch opens there, as its chevron says it will.
  assert.equal(placeBeside(row, panel, { width: 1200, height: 900 }, { flip: true }).left, 574);
  // No room on the right, room on the left: it flips rather than lying over the menu it came from,
  // which by the third panel of a cascade is the trail the user is following.
  assert.equal(placeBeside(row, panel, { width: 687, height: 640 }, { flip: true }).left, 290 - 4 - 220);
  // Neither side fits, so it is pushed in from the edge — flipping here would point one way and
  // open the other, which is the case `placeBeside` refuses by default.
  const narrow = placeBeside(box(20, 500, 180, 36), panel, { width: 300, height: 640 }, { flip: true });
  assert.equal(narrow.left, 300 - 220 - MARGIN);
  // Opting out is still the default, and still what the "All commands" submenu does.
  assert.equal(placeBeside(row, panel, { width: 687, height: 640 }).left, 687 - 220 - MARGIN);
});

test("a branch beside a row in the middle of a list lines up with its top", () => {
  const row = box(100, 240, 280, 36);
  const panel = { width: 220, height: 200 };
  assert.equal(placeBeside(row, panel, { width: 1200, height: 900 }, { align: "top" }).top, 240);
  assert.equal(placeBeside(row, panel, { width: 1200, height: 900 }).top, 276 - 200, "bottom is still the default");
});

test("a branch asked for the left opens there even when the right has room", () => {
  const row = box(600, 500, 240, 36);
  const panel = { width: 230, height: 200 };
  // The step list is the rightmost pane in the Testing workspace, so its submenu opens over the
  // preview rather than over the window's edge — whether or not the right would have fitted.
  assert.equal(placeBeside(row, panel, { width: 1600, height: 900 }, { side: "left" }).left, 600 - 4 - 230);
  // The default is unchanged: no `side`, and the right is where it goes.
  assert.equal(placeBeside(row, panel, { width: 1600, height: 900 }).left, 840 + 4);
  // With no room on the left either, the right is better than off the edge of the window.
  assert.equal(placeBeside(box(10, 500, 120, 36), panel, { width: 1600, height: 900 }, { side: "left" }).left, 134);
});
