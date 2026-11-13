import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ListIcon, LoaderCircleIcon } from "lucide-react";
import type { ScreenAnnotationsStore } from "../screen-annotations";
import { testRecorder } from "../test-recorder";
import { agentActSuggestion, stepIsAssertion } from "@mobile-dev/shared/test-recording.ts";
import type { StepOffer, StepTarget } from "@mobile-dev/shared/test-recording.ts";
import { AgenticBranch, AssertionBranch, MenuRow, OFFER_LABEL, OfferIcon, OfferValueForm, StepCommandList } from "./step-commands";
import { usePlacement, windowView as view } from "./cascading-menu";
import { MARGIN, placeBelow, placeBeside } from "../popover-placement";
import type { Box } from "../popover-placement";

/**
 * The element menu: what the runner can do with the element the outline is on.
 *
 * The selector is named once, then every row is a plain-language action the `e2e` runner can
 * express for it. The emitted code remains available as a tooltip and appears in the test preview
 * after the action is chosen. A row that needs a value — `fill` types it, the text matchers
 * compare with it — asks for one here instead of recording an empty string literal.
 *
 * The short list is what most steps are. Everything else the runner can express hangs off "All
 * commands" as a submenu of its own, opened by pointing at the row. Both are portals fitted to the
 * window: they may lie over the mirror, the toolbar or the panel's edge, and they are never cut
 * off by the stage that the element they are about happens to live in.
 */
function ElementMenu({ label, offers, commands, matches, element, width, anchor }: {
  label: string; offers: readonly StepOffer[]; commands: readonly StepOffer[];
  matches: number; element?: StepTarget; width: number; anchor: () => Box | undefined;
}) {
  const [asking, setAsking] = useState<StepOffer | undefined>();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const target = label.replace(/^Tap /, "");
  const placement = usePlacement(menu, () => {
    const rect = anchor();
    return rect && placeBelow(rect, { width, height: menu.current?.offsetHeight ?? 0 }, view());
  }, [anchor, width, asking]);
  const choose = (offer: StepOffer) => {
    if (offer.needsValue) { setAsking(offer); return; }
    void testRecorder.chooseOffer(offer.kind);
  };
  const offerRow = (offer: StepOffer) => <MenuRow
    key={`${offer.kind}:${offer.source}`}
    title={offer.source}
    icon={<OfferIcon kind={offer.kind} />}
    attributes={{ "data-recorder-offer": offer.kind }}
    onClick={() => choose(offer)}
  >{OFFER_LABEL[offer.kind]}</MenuRow>;
  return createPortal(<div
    ref={menu}
    data-element="recorder-menu" role="menu" aria-label="Element steps"
    className="pointer-events-auto fixed z-50 flex flex-col gap-1.5 overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg [&_button:not(:disabled)]:cursor-pointer"
    // Hidden until it has been measured, so it is never seen at the position it was measured from.
    style={{ left: placement?.left ?? 0, top: placement?.top ?? 0, width, maxHeight: placement?.maxHeight, visibility: placement ? "visible" : "hidden" }}
    onPointerDown={event => event.stopPropagation()}
    onContextMenu={event => event.preventDefault()}
  >
    <div className="min-w-0 px-2.5 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Selected element</p>
      <p className="truncate text-sm font-medium" title={target}>{target}</p>
      {matches > 1 && <p className="mt-1 text-[11px] leading-4 text-amber-600 dark:text-amber-500">
        {matches} matches · using this one by position. Add a testID for stability.
      </p>}
    </div>
    <div className="-mx-1.5 border-t" />
    {asking
      ? <OfferValueForm offer={asking} onCancel={() => setAsking(undefined)}
        onSubmit={(value, timeoutMs) => { setAsking(undefined); void testRecorder.chooseOffer(asking.kind, value, timeoutMs); }} />
      : <>
        {/* A coordinate gets the tap and nothing else, and silence about the other three rows reads
            as a broken menu. The step list flags the same thing once the step is recorded. */}
        {offers.length === 1 && offers[0]?.kind === "tap" && offers[0].source.startsWith("screen.tapAt")
          && <p className="px-2.5 pt-1 text-[11px] text-amber-600 dark:text-amber-500">
            Nothing here can be named. The coordinate can still be tapped or swiped, or describe the step under Agentic.
          </p>}
        {offers.map(offer => stepIsAssertion(offer.kind)
          ? <AssertionBranch key={`${offer.kind}:${offer.source}`} offer={offer}
            onChoose={(kind, value, timeoutMs) => void testRecorder.chooseOffer(kind, value, timeoutMs)} />
          : offerRow(offer))}
        <div className="-mx-1.5 border-t" />
        <div ref={row} className="flex flex-col" onMouseEnter={() => setOpen(true)}>
          <MenuRow
            chevron
            icon={<ListIcon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover/offer:text-accent-foreground" />}
            attributes={{ "data-recorder-panel": "commands" }}
            onOpen={() => setOpen(true)}
            onClick={() => setOpen(true)}
          >All commands</MenuRow>
        </div>
        {open && <CommandMenu
          commands={commands}
          // Narrower than the menu it hangs off: its rows are short, and every point it does not
          // take is a point of the menu behind it that a tight window leaves visible.
          width={Math.min(width, 220)}
          row={row}
          offerRow={offerRow}
          onClose={() => setOpen(false)}
        />}
        {/* The one branch that needs no selector, which is why it is here even when the element
            menu has nothing but a coordinate to offer. */}
        <AgenticBranch suggestion={agentActSuggestion(element)} onRecord={step => testRecorder.recordAgentStep(step)} />
      </>}
  </div>, document.body);
}

/**
 * The "All commands" submenu: a popover of its own, beside the row it hangs off.
 *
 * It always opens to the right, the side its chevron points at — see `placeBeside` for why there
 * is no flip to the left — and its bottom lines up with its row, growing upward since the row is
 * the last in the menu. Both are pushed back in if they would take it past an edge of the window.
 *
 * It is a portal rather than a child of the menu for two reasons: the menu scrolls once it is
 * taller than the window, and a scrolling box clips what hangs out of it; and the submenu has to
 * be free to lie outside the menu, the stage and the panel alike.
 */
function CommandMenu({ commands, width, row, offerRow, onClose }: {
  commands: readonly StepOffer[]; width: number; row: React.RefObject<HTMLDivElement | null>;
  offerRow: (offer: StepOffer) => React.ReactNode; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const placement = usePlacement(panel, () => {
    const anchor = row.current?.getBoundingClientRect();
    return anchor && placeBeside(anchor, { width, height: panel.current?.offsetHeight ?? 0 }, view());
  }, [row, width, commands]);

  // The row and this panel are one hover target with a gap between them, so leaving either one
  // only starts a close that entering the other cancels — otherwise crossing the gap closes it.
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hold = () => { if (leaving.current) clearTimeout(leaving.current); };
  const release = useCallback(() => {
    hold();
    const closeWhenBranchesLeave = () => {
      // Assertion choices are portalled beside this menu. Keep their parent mounted while the
      // pointer crosses into them, then close once the branch itself has gone.
      if (document.querySelector("[data-recorder-assertion-panel]")) {
        leaving.current = setTimeout(closeWhenBranchesLeave, 120);
      } else onClose();
    };
    leaving.current = setTimeout(closeWhenBranchesLeave, 120);
  }, [onClose]);
  useEffect(() => {
    const node = row.current;
    node?.addEventListener("mouseleave", release);
    node?.addEventListener("mouseenter", hold);
    return () => { hold(); node?.removeEventListener("mouseleave", release); node?.removeEventListener("mouseenter", hold); };
  }, [row, release]);
  return createPortal(<div
    ref={panel}
    data-element="recorder-commands" role="menu" aria-label="All commands"
    className="pointer-events-auto fixed z-50 flex flex-col gap-1.5 overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg [&_button:not(:disabled)]:cursor-pointer"
    style={{ left: placement?.left ?? 0, top: placement?.top ?? 0, width, maxHeight: placement?.maxHeight, visibility: placement ? "visible" : "hidden" }}
    onMouseEnter={hold}
    onMouseLeave={release}
    onPointerDown={event => event.stopPropagation()}
    onContextMenu={event => event.preventDefault()}
  >
    {/* The rows are the element menu's own, so a command reads and behaves the same in both. */}
    <StepCommandList commands={commands} onChoose={(kind, value, timeoutMs) => void testRecorder.chooseOffer(kind, value, timeoutMs)} renderRow={offer => offerRow(offer)} />
  </div>, document.body);
}

/**
 * The outline over the mirror while the Testing panel records: the element a tap would name, the
 * step it would add, and — on a right-click — the menu of every step that element supports.
 *
 * It borrows the annotation store's viewport — the canvas rectangle inside the stage, which the
 * simulator panel keeps current through every resize and bezel change — rather than measuring the
 * canvas again. The bounds themselves come from the recorder, in the same screen space it resolved
 * them in, so the outline cannot drift from what gets recorded, wherever in the workspace the
 * mirror sits.
 */
export function TestRecorderOverlay({ store }: { store: ScreenAnnotationsStore }) {
  const { viewport: v } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { hover, menu, preparing } = useSyncExternalStore(testRecorder.subscribe, testRecorder.getSnapshot);
  // State rather than a ref: the menu is a child, and a child's layout effect runs before the
  // parent's ref is attached, so a ref here is still null the first time the menu measures itself.
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  // The outline and the menu are drawn from whichever is there. A hover is dropped by anything that
  // invalidates the tree — an input, a frame, a slow read — and the menu, which the user asked for
  // explicitly, carries its own rectangle so it cannot be taken away with one.
  const anchor = hover ?? menu;
  const bounds = menu?.bounds;
  const screen = menu?.screen;
  // The menu is placed against the window, so it needs the element's rectangle in the window's own
  // coordinates: the stage's position plus the element's position inside it. It is read when the
  // menu measures itself rather than passed as numbers, so a panel that moves under an open menu —
  // a resize, a scroll, a pane dragged wider — moves the menu with it.
  const menuAnchor = useCallback(() => {
    const stage = host?.getBoundingClientRect();
    if (!stage || !bounds || !screen || !v.width || !v.height) return undefined;
    const left = stage.left + v.x + bounds.x / screen.width * v.width;
    const top = stage.top + v.y + bounds.y / screen.height * v.height;
    const width = bounds.width / screen.width * v.width;
    const height = bounds.height / screen.height * v.height;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }, [host, bounds, screen, v]);
  // The canvas closes the menu when it is clicked through, but the menu is no longer inside the
  // stage and the rest of the panel is not the canvas: a click anywhere else closes it too.
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-element=recorder-menu],[data-element=recorder-commands]")) return;
      testRecorder.closeMenu();
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [menu]);
  if (!v.width || !v.height) return null;
  // Record arms the recorder at once, but nothing on the mirror can be selected until the runner's
  // element tree has been read, and that takes a second or two. Without this the panel said
  // "Stop" while the first few clicks did nothing, which reads as a broken recorder rather than as
  // a wait. The overlay covers the canvas — not the whole stage — so it says *where* the wait is,
  // and it lets clicks through: the mirror still drives the app while the tree is being read.
  if (preparing) return <div className="pointer-events-none absolute inset-0 z-20" data-element="recorder-preparing">
    <div className="absolute flex items-center justify-center bg-background/60 backdrop-blur-[1px]"
      style={{ left: v.x, top: v.y, width: v.width, height: v.height }} role="status">
      <span className="flex items-center gap-2 rounded-md bg-background/90 px-3 py-1.5 text-xs font-medium shadow-sm">
        <LoaderCircleIcon className="size-3.5 animate-spin" />preparing...
      </span>
    </div>
  </div>;
  if (!anchor) return null;
  const rect = {
    left: v.x + anchor.bounds.x / anchor.screen.width * v.width,
    top: v.y + anchor.bounds.y / anchor.screen.height * v.height,
    width: anchor.bounds.width / anchor.screen.width * v.width,
    height: anchor.bounds.height / anchor.screen.height * v.height,
  };
  // Above the outline when there is room, inside its top edge when it is against the stage top.
  const above = rect.top > v.y + 22;
  return <div ref={setHost} className="pointer-events-none absolute inset-0 z-20" data-element="recorder-hover">
    <div className={`absolute border-2 border-solid ${anchor.ambiguous ? "border-amber-500 bg-amber-500/10" : "border-blue-500 bg-blue-500/10"}`} style={rect} />
    <span
      className={`absolute max-w-[min(18rem,100%)] truncate rounded px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm ${anchor.ambiguous ? "bg-amber-600" : "bg-blue-600"}`}
      style={{ left: Math.max(4, Math.min(rect.left, v.stageWidth - 16)), top: Math.max(2, above ? rect.top - 20 : rect.top + 2) }}
    >{anchor.label}{hover && hover.levels > 1 ? ` · ${hover.level + 1}/${hover.levels}` : ""}</span>
    {/* Anchored to the element, not to the pointer, so walking out with the wheel moves the menu
        with the element it is about. */}
    {menu && <ElementMenu
      label={menu.label}
      offers={menu.offers}
      commands={menu.commands}
      matches={menu.matches}
      element={menu.target}
      // Wide enough for a row to read as a sentence, narrow enough to leave the mirror visible.
      width={Math.max(180, Math.min(280, window.innerWidth - MARGIN * 2))}
      anchor={menuAnchor}
    />}
  </div>;
}
