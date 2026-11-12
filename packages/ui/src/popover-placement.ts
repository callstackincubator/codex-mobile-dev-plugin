/**
 * Where a popover goes, in the window's own coordinates.
 *
 * The Testing panel's element menu used to be positioned inside the stage — the box the mirror
 * sits in — which clips what it contains and is often shorter than the menu itself, so a menu on
 * a bottom tab was cut off rather than moved. Placement is against the window instead, and the
 * caller draws the popover in a portal so nothing between it and the window can clip it.
 *
 * It is kept apart from the component so the arithmetic can be checked against real numbers —
 * a short panel, a narrow one — rather than only through a DOM with no layout in it.
 */

/** A rectangle in the window's own coordinates, as `getBoundingClientRect` gives one. */
export type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };

/** The window a popover has to fit into. */
export type View = { width: number; height: number };

/** Where a popover ends up, and how tall it may be before it has to scroll. */
export type Placement = { left: number; top: number; maxHeight: number };

/** How close a popover may come to the edge of the window. */
export const MARGIN = 8;

/** How far a popover sits from the thing it hangs off. */
const GAP = 6;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high));

/**
 * Fits a popover that hangs below something: the element menu under the element it is about.
 *
 * Below when the window has room for it there, above when it does not, and pinned to the edge it
 * ran past when neither side fits — a popover against the bottom of the window still shows its
 * rows, where one left below the fold shows none. It is free to lie over whatever is behind it.
 */
export function placeBelow(anchor: Box, size: { width: number; height: number }, view: View): Placement {
  const maxHeight = Math.max(120, view.height - MARGIN * 2);
  const height = Math.min(size.height, maxHeight);
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - height;
  const top = below + height <= view.height - MARGIN ? below
    : above >= MARGIN ? above
      : clamp(view.height - MARGIN - height, MARGIN, Math.max(MARGIN, view.height - MARGIN - height));
  return {
    left: clamp(anchor.left, MARGIN, Math.max(MARGIN, view.width - size.width - MARGIN)),
    top,
    maxHeight,
  };
}

/**
 * Fits a submenu beside the row it hangs off.
 *
 * It always opens to the right, which is the side its chevron points at. There is no flip to the
 * left: the panel this runs in is often only a few hundred points wide, so "flip when it does not
 * fit" meant it opened on the left nearly always — pointing one way and opening the other. When
 * the right has no room the submenu is pushed in from the window's edge instead, overlapping the
 * menu it came from, which is what a cascading menu does in a tight window.
 *
 * Its bottom lines up with its row and it grows upward, since the row is the last in the menu.
 *
 * `flip` opts into opening on the left when the right has no room *and the left does*, which is
 * what a cascading branch several levels deep needs: by the third panel the right edge is reached
 * on any ordinary window, and overlapping the menu it came from hides the trail the user is
 * following. It stays opt-in because the narrow case above is still real — when neither side fits,
 * flipping would point one way and open the other, so the pushed-in placement is what happens.
 *
 * `align` is which of the row's edges the panel lines up with: `bottom` for a row at the end of a
 * menu, `top` for one in the middle of a list, where growing upward would hide the rows above it.
 *
 * `side: "left"` asks for the left outright, whether or not the right has room, for a branch whose
 * parent menu is itself against the right edge of the workspace. It falls back to the right only
 * when the left cannot hold the panel at all.
 */
export function placeBeside(
  row: Box,
  size: { width: number; height: number },
  view: View,
  options: { flip?: boolean; align?: "top" | "bottom"; side?: "left" | "right" } = {},
): Placement {
  const maxHeight = Math.max(120, view.height - MARGIN * 2);
  const height = Math.min(size.height, maxHeight);
  const rightmost = Math.max(MARGIN, view.width - size.width - MARGIN);
  const right = row.right + 4;
  const left = row.left - 4 - size.width;
  // `side: "left"` is a branch that opens on the left by design rather than because the right ran
  // out: the step list is the rightmost thing in the panel, so a submenu of a step row opens over
  // the preview — which is where there is room — instead of over the list it came from. It still
  // falls back to the right when the left has no room, because a submenu off the edge of the
  // window shows nothing at all.
  const chooseLeft = options.side === "left"
    ? left >= MARGIN
    : options.flip && right > rightmost && left >= MARGIN;
  return {
    left: chooseLeft ? left : clamp(right, MARGIN, rightmost),
    // Lined up with the chosen edge, then pushed back in if that would take it off either edge.
    top: clamp(options.align === "top" ? row.top : row.bottom - height, MARGIN,
      Math.max(MARGIN, view.height - MARGIN - height)),
    maxHeight,
  };
}
