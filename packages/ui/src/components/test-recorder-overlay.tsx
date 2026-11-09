import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDownToLineIcon, EyeIcon, MousePointerClickIcon, TextCursorInputIcon } from "lucide-react";
import type { ScreenAnnotationsStore } from "../screen-annotations";
import { testRecorder } from "../test-recorder";
import type { RecordedStepKind, StepOffer } from "@mobile-dev/shared/test-recording.ts";
import { Button } from "./ui/button";

const OFFER_LABEL: Record<RecordedStepKind, string> = {
  tap: "Tap",
  longPress: "Long press",
  fill: "Enter text",
  scrollUntilVisible: "Scroll into view",
  assertVisible: "Check visibility",
  assertText: "Check text",
};

function OfferIcon({ kind }: { kind: RecordedStepKind }) {
  const Icon = kind === "fill" || kind === "assertText" ? TextCursorInputIcon
    : kind === "assertVisible" ? EyeIcon
      : kind === "scrollUntilVisible" ? ArrowDownToLineIcon
        : MousePointerClickIcon;
  return <Icon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover/offer:text-accent-foreground group-focus-visible/offer:text-accent-foreground" />;
}

/**
 * The element menu: what the runner can do with the element the outline is on.
 *
 * The selector is named once, then every row is a plain-language action the `e2e` runner can
 * express for it. The emitted code remains available as a tooltip and appears in the test preview
 * after the action is chosen. The `fill` row needs a value, so it asks for one here instead of
 * recording an empty string literal.
 */
function ElementMenu({ label, offers, matches, left, top, width }: { label: string; offers: readonly StepOffer[]; matches: number; left: number; top: number; width: number }) {
  const [asking, setAsking] = useState<StepOffer | undefined>();
  const input = useRef<HTMLInputElement>(null);
  const target = label.replace(/^Tap /, "");
  useEffect(() => { if (asking) input.current?.focus(); }, [asking]);
  const choose = (offer: StepOffer) => {
    if (offer.needsValue) { setAsking(offer); return; }
    void testRecorder.chooseOffer(offer.kind);
  };
  const submit = () => {
    if (!asking) return;
    void testRecorder.chooseOffer(asking.kind, input.current?.value ?? "");
    setAsking(undefined);
  };
  return <div
    data-element="recorder-menu" role="menu" aria-label="Element steps"
    className="pointer-events-auto absolute z-30 flex flex-col gap-1.5 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg [&_button:not(:disabled)]:cursor-pointer"
    style={{ left, top, width }}
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
      ? <form className="flex flex-col gap-1.5" onSubmit={event => { event.preventDefault(); submit(); }}>
        <div className="flex items-center gap-2 px-2 py-1 text-sm font-medium">
          <OfferIcon kind={asking.kind} />
          <span>{OFFER_LABEL[asking.kind]}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <input ref={input} type="text" defaultValue={asking.suggestedValue ?? ""} aria-label="Text to enter" placeholder="Text to enter"
            className="min-w-0 flex-1 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-sm"
            onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setAsking(undefined); } }} />
          <Button type="submit" size="sm" className="shrink-0">Add</Button>
        </div>
      </form>
      : <>
        {/* A coordinate gets the tap and nothing else, and silence about the other three rows reads
            as a broken menu. The step list flags the same thing once the step is recorded. */}
        {offers.length === 1 && offers[0]?.kind === "tap" && offers[0].source.startsWith("screen.tapAt")
          && <p className="px-2.5 pt-1 text-[11px] text-amber-600 dark:text-amber-500">
            Nothing here can be named, so only the coordinate can be acted on.
          </p>}
        {offers.map(offer => <button
        key={`${offer.kind}:${offer.source}`} type="button" role="menuitem" data-recorder-offer={offer.kind}
        title={offer.source}
        className="group/offer flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
        onClick={() => choose(offer)}
      >
        <OfferIcon kind={offer.kind} />
        <span className="min-w-0 flex-1 font-medium">{OFFER_LABEL[offer.kind]}</span>
      </button>)}
      </>}
  </div>;
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
  const { hover, menu } = useSyncExternalStore(testRecorder.subscribe, testRecorder.getSnapshot);
  // The outline and the menu are drawn from whichever is there. A hover is dropped by anything that
  // invalidates the tree — an input, a frame, a slow read — and the menu, which the user asked for
  // explicitly, carries its own rectangle so it cannot be taken away with one.
  const anchor = hover ?? menu;
  if (!anchor || !v.width || !v.height) return null;
  const { bounds, screen } = anchor;
  const rect = {
    left: v.x + bounds.x / screen.width * v.width,
    top: v.y + bounds.y / screen.height * v.height,
    width: bounds.width / screen.width * v.width,
    height: bounds.height / screen.height * v.height,
  };
  // Above the outline when there is room, inside its top edge when it is against the stage top.
  const above = rect.top > v.y + 22;
  return <div className="pointer-events-none absolute inset-0 z-20" data-element="recorder-hover">
    <div className={`absolute border-2 border-solid ${anchor.ambiguous ? "border-amber-500 bg-amber-500/10" : "border-blue-500 bg-blue-500/10"}`} style={rect} />
    <span
      className={`absolute max-w-[min(18rem,100%)] truncate rounded px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm ${anchor.ambiguous ? "bg-amber-600" : "bg-blue-600"}`}
      style={{ left: Math.max(4, Math.min(rect.left, v.stageWidth - 16)), top: Math.max(2, above ? rect.top - 20 : rect.top + 2) }}
    >{anchor.label}{hover && hover.levels > 1 ? ` · ${hover.level + 1}/${hover.levels}` : ""}</span>
    {/* Anchored to the element, not to the pointer, so walking out with the wheel moves the menu
        with the element it is about. Clamped to the stage so a menu on a bottom tab stays on screen. */}
    {menu && (() => {
      // The selector is named once above compact action rows, so the menu can stay out of the way
      // of the app while still using nearly all of a narrow stage.
      const width = Math.max(180, Math.min(320, v.stageWidth - 8));
      return <ElementMenu
        label={menu.label}
        offers={menu.offers}
        matches={menu.matches}
        width={width}
        left={Math.max(4, Math.min(rect.left + 8, v.stageWidth - width - 4))}
        top={Math.max(4, Math.min(rect.top + rect.height + 6, Math.max(4, v.stageHeight - 200)))}
      />;
    })()}
  </div>;
}
