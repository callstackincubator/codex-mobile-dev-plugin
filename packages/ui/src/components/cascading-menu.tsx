import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MARGIN, placeBelow, placeBeside } from "../popover-placement";
import type { Box, Placement } from "../popover-placement";

/**
 * The cascading half of the Testing panel's menus: a branch opens *beside* the row it hangs off,
 * with the menu it came from still on screen.
 *
 * A branch that replaced what it was opened from read as navigation rather than as a menu — the
 * user lost the element they were acting on, and the only way back was a button put there for the
 * purpose. Beside is what a menu does, and it is also what makes a branch several levels deep
 * legible: the trail from the element to the command is all on screen at once.
 *
 * Everything that makes that work rather than merely look right lives here: hover intent, so a row
 * brushed past on the way somewhere else does not open; a safe path, so the pointer may travel
 * diagonally to the panel without crossing a row that would close it; and the keyboard, so the
 * branch is not reachable by pointer alone.
 */

/** The window every popover here is fitted into. See `popover-placement`. */
export const windowView = () => ({ width: window.innerWidth, height: window.innerHeight });

/** A portalled child branch keeps its parent open while the pointer is inside it. */
const BranchHoverContext = createContext<{ hold: () => void; leave: () => void } | null>(null);

export { MARGIN, placeBelow, placeBeside };

/** Re-fits a popover whenever its own size, its anchor or the window changes. */
export function usePlacement(
  element: React.RefObject<HTMLElement | null>,
  place: () => Placement | undefined,
  deps: unknown[],
): Placement | undefined {
  const [placement, setPlacement] = useState<Placement>();
  const measure = useCallback(() => {
    const next = place();
    // The same numbers mean the same position, and writing them again would re-run this effect.
    setPlacement(current => current && next && current.left === next.left && current.top === next.top
      && current.maxHeight === next.maxHeight ? current : next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useLayoutEffect(() => {
    measure();
    const node = element.current;
    // A row that opens a form, a list that loads: the popover's own height is what decides whether
    // it still fits, so it is watched rather than measured once.
    const observer = typeof ResizeObserver === "function" && node ? new ResizeObserver(() => measure()) : undefined;
    if (node) observer?.observe(node);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [element, measure]);
  return placement;
}

/** How long a row must be pointed at before its branch opens. */
const OPEN_MS = 90;
/** How long the branch survives the pointer leaving it, when the pointer is not heading for it. */
const CLOSE_MS = 140;
/** The same, when the pointer is travelling towards the open panel. See `aimsAt`. */
const SAFE_MS = 500;
/** How far past the panel's own edges the safe path still counts, for a hurried diagonal. */
const SAFE_SLACK = 28;

/**
 * Whether the pointer's last movement is heading into the open panel.
 *
 * This is the "safe path" a cascading menu needs. The panel sits to one side of its row, so the
 * pointer travelling to it crosses whatever rows lie between — and each of those is a row that
 * would otherwise take the branch away mid-journey. Rather than tracking a triangle, the movement
 * is extended to the panel's near edge: if it arrives within the panel's own span, the pointer is
 * on its way there and the branch is held open long enough to get there.
 */
function aimsAt(from: { x: number; y: number }, to: { x: number; y: number }, panel: DOMRect | undefined): boolean {
  if (!panel) return false;
  const dx = to.x - from.x;
  if (dx === 0) return false;
  // The near edge is whichever side the panel actually opened on.
  const edge = to.x <= panel.left ? panel.left : to.x >= panel.right ? panel.right : undefined;
  if (edge === undefined) return true;
  const steps = (edge - to.x) / dx;
  if (steps < 0) return false;
  const y = to.y + (to.y - from.y) * steps;
  return y >= panel.top - SAFE_SLACK && y <= panel.bottom + SAFE_SLACK;
}

/**
 * The open/close logic one branch shares between its row and its panel.
 *
 * Returned as handlers rather than wired to the DOM here, because the row belongs to the menu that
 * owns it and the panel is a portal somewhere else entirely; the two are one hover target with a
 * gap and a stack of other rows between them.
 */
export function useBranch(panel: React.RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const trail = useRef<{ from: { x: number; y: number }; to: { x: number; y: number } }>(undefined);
  const stop = useCallback(() => { if (timer.current) { clearTimeout(timer.current); timer.current = undefined; } }, []);
  useEffect(() => stop, [stop]);

  // The pointer is followed only while the branch is open, which is the only time its direction
  // decides anything.
  useEffect(() => {
    if (!open) { trail.current = undefined; return; }
    const move = (event: PointerEvent) => {
      const to = { x: event.clientX, y: event.clientY };
      trail.current = { from: trail.current?.to ?? to, to };
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [open]);

  // `stop` first, so entering either half of an open branch cancels a close already in flight.
  const enter = useCallback(() => {
    stop();
    timer.current = setTimeout(() => setOpen(true), OPEN_MS);
  }, [stop]);
  const hold = useCallback(() => { stop(); setOpen(true); }, [stop]);
  const leave = useCallback(() => {
    stop();
    const heading = trail.current && aimsAt(trail.current.from, trail.current.to, panel.current?.getBoundingClientRect());
    timer.current = setTimeout(() => setOpen(false), heading ? SAFE_MS : CLOSE_MS);
  }, [panel, stop]);
  const close = useCallback(() => { stop(); setOpen(false); }, [stop]);
  return { open, enter, hold, leave, close, openNow: hold };
}

/** The first thing inside a panel that the keyboard can land on. */
function focusFirst(node: HTMLElement | null) {
  node?.querySelector<HTMLElement>("input, button, [tabindex]:not([tabindex='-1'])")?.focus();
}

/**
 * One branch's panel: a portal beside the row it hangs off.
 *
 * A portal rather than a child of the menu for two reasons that have not changed: a menu taller
 * than the window scrolls, and a scrolling box clips what hangs out of it; and a branch has to be
 * free to lie outside the menu, the stage and the panel alike.
 */
export function BranchPanel({ panelRef, row, width, label, align, flip, side, children, attributes, onHold, onLeave, onClose }: {
  /** The panel's own node, which the branch measures for its safe path. */
  panelRef: React.RefObject<HTMLDivElement | null>;
  row: React.RefObject<HTMLElement | null>;
  width: number;
  label: string;
  align?: "top" | "bottom";
  flip?: boolean;
  /** Which side the branch opens on by design; see `placeBeside`. */
  side?: "left" | "right";
  children: React.ReactNode;
  attributes?: Record<string, string>;
  onHold: () => void;
  onLeave: () => void;
  /** Dismisses the branch and hands the keyboard back to the row that opened it. */
  onClose: () => void;
}) {
  const panel = panelRef;
  const parent = useContext(BranchHoverContext);
  const placement = usePlacement(panel, () => {
    const anchor = row.current?.getBoundingClientRect();
    return anchor && placeBeside(anchor, { width, height: panel.current?.offsetHeight ?? 0 }, windowView(),
      { ...(flip === undefined ? {} : { flip }), ...(align === undefined ? {} : { align }), ...(side === undefined ? {} : { side }) });
  }, [row, width, align, flip, side, children]);
  // Opened from the keyboard, the branch is useless until the keyboard is in it. Opened by the
  // pointer this is harmless: the element focused is the one the pointer is already over.
  useEffect(() => { if (document.activeElement === row.current) focusFirst(panel.current); }, [row]);
  return createPortal(<BranchHoverContext.Provider value={{ hold: onHold, leave: onLeave }}><div
    ref={panel}
    role="menu" aria-label={label} {...attributes}
    className="pointer-events-auto fixed z-50 flex flex-col gap-1.5 overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg [&_button:not(:disabled)]:cursor-pointer"
    style={{ left: placement?.left ?? 0, top: placement?.top ?? 0, width, maxHeight: placement?.maxHeight, visibility: placement ? "visible" : "hidden" }}
    onMouseEnter={() => { onHold(); parent?.hold(); }}
    onMouseLeave={() => { onLeave(); parent?.leave(); }}
    onPointerDown={event => event.stopPropagation()}
    onContextMenu={event => event.preventDefault()}
    // Left is back out of a branch, as it is in every cascading menu, and Escape is the same door.
    onKeyDown={event => {
      if (event.key !== "Escape" && event.key !== "ArrowLeft") return;
      // A text field owns its own arrows; only Escape leaves from inside one.
      if (event.key === "ArrowLeft" && (event.target as HTMLElement).tagName === "INPUT") return;
      event.stopPropagation();
      onClose();
      row.current?.focus();
    }}
  >{children}</div></BranchHoverContext.Provider>, document.body);
}

/**
 * A row and the branch it opens, as one thing.
 *
 * The row renders through `renderRow` so each menu keeps its own row component, its tooltips and
 * its test attributes; everything about *when* the branch is open is here, so it behaves the same
 * in the mirror's menu as in any other.
 */
export function Branch({ label, width, align, flip, side, renderRow, children, attributes }: {
  label: string;
  width: number;
  align?: "top" | "bottom";
  flip?: boolean;
  /** Which side the branch opens on by design; see `placeBeside`. */
  side?: "left" | "right";
  renderRow: (handlers: { onOpen: () => void; onClick: () => void }) => React.ReactNode;
  children: React.ReactNode;
  attributes?: Record<string, string>;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const { open, enter, hold, leave, close, openNow } = useBranch(panel);
  return <>
    <div
      ref={row}
      className="flex flex-col"
      onMouseEnter={enter}
      onMouseLeave={leave}
      // A branch opens on hover, but hover is not the only way in: the click and the keyboard open
      // it too, and Right is the arrow that means "into this branch".
      onKeyDown={event => {
        if (event.key !== "ArrowRight") return;
        event.preventDefault();
        openNow();
      }}
    >{renderRow({ onOpen: enter, onClick: hold })}</div>
    {open && <BranchPanel panelRef={panel} row={row} width={width} label={label}
      {...(align === undefined ? {} : { align })} {...(flip === undefined ? {} : { flip })} {...(side === undefined ? {} : { side })}
      {...(attributes === undefined ? {} : { attributes })}
      onHold={hold} onLeave={leave} onClose={close}>{children}</BranchPanel>}
  </>;
}

export type { Box };
