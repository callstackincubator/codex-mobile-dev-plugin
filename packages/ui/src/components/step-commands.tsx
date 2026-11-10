import { useEffect, useRef, useState } from "react";
import { ArrowDownToLineIcon, ChevronRightIcon, EyeIcon, EyeOffIcon, MousePointerClickIcon, TextCursorInputIcon, TypeIcon } from "lucide-react";
import { stepIsAssertion } from "@mobile-dev/shared/test-recording.ts";
import type { RecordedStepKind, StepOffer } from "@mobile-dev/shared/test-recording.ts";
import { Button } from "./ui/button";

/**
 * The command vocabulary, shared by everything that offers a step.
 *
 * The mirror's element menu and the step list's own "Change command" both read from here, so a
 * command reads the same wherever it is chosen — and a kind the runner gains is named once.
 */
export const OFFER_LABEL: Record<RecordedStepKind, string> = {
  tap: "Tap",
  doubleTap: "Double tap",
  longPress: "Long press",
  fill: "Enter text",
  scrollUntilVisible: "Scroll into view",
  assertVisible: "Check visibility",
  assertNotVisible: "Check it is gone",
  assertText: "Check text is",
  assertContainsText: "Check text contains",
  assertValue: "Check field value",
  assertEnabled: "Check it is enabled",
  assertDisabled: "Check it is disabled",
  assertSelected: "Check it is selected",
};

export function OfferIcon({ kind }: { kind: RecordedStepKind }) {
  const Icon = kind === "fill" ? TextCursorInputIcon
    : kind === "assertText" || kind === "assertContainsText" || kind === "assertValue" ? TypeIcon
      : kind === "assertNotVisible" ? EyeOffIcon
        : stepIsAssertion(kind) ? EyeIcon
          : kind === "scrollUntilVisible" ? ArrowDownToLineIcon
            : MousePointerClickIcon;
  return <Icon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover/offer:text-accent-foreground group-focus-visible/offer:text-accent-foreground" />;
}

/** One row of a menu: an action to record, or the row a submenu hangs off. */
export function MenuRow({ children, title, onClick, onOpen, chevron, icon, attributes }: {
  children: React.ReactNode; title?: string; onClick: () => void; onOpen?: () => void;
  chevron?: boolean; icon?: React.ReactNode; attributes?: Record<string, string>;
}) {
  return <button
    type="button" role="menuitem" title={title} {...attributes}
    className="group/offer flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
    onClick={onClick}
    // A submenu opens by pointing at its row, as a menu's submenu does; the click and the keyboard
    // focus open it too, so it is not reachable by hover alone.
    onMouseEnter={onOpen}
    onFocus={onOpen}
  >
    {icon}
    <span className="min-w-0 flex-1 truncate font-medium">{children}</span>
    {chevron && <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />}
  </button>;
}

/** The heading over a group of rows, e.g. the element a selector names, or `Assertions`. */
export function MenuGroup({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{children}</p>;
}

/** The form a `needsValue` row asks through, so no step is recorded with an empty string literal. */
export function OfferValueForm({ offer, onSubmit, onCancel }: {
  offer: StepOffer; onSubmit: (value: string) => void; onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, [offer]);
  const placeholder = offer.kind === "fill" ? "Text to enter" : "Text to expect";
  return <form className="flex flex-col gap-1.5" onSubmit={event => { event.preventDefault(); onSubmit(input.current?.value ?? ""); }}>
    <div className="flex items-center gap-2 px-2 py-1 text-sm font-medium">
      <OfferIcon kind={offer.kind} />
      <span>{OFFER_LABEL[offer.kind]}</span>
    </div>
    <div className="flex items-center gap-1.5">
      <input ref={input} type="text" defaultValue={offer.suggestedValue ?? ""} aria-label={placeholder} placeholder={placeholder}
        className="min-w-0 flex-1 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-sm"
        onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }} />
      <Button type="submit" size="sm" className="shrink-0">Add</Button>
    </div>
  </form>;
}

/**
 * Every command the runner can express for one element, grouped into what acts on the app and what
 * only reads it.
 *
 * This is the whole of the "All commands" list, and it is a component rather than a snippet
 * because it is offered from two places now: over the mirror, where the element is under the
 * pointer, and from a recorded step's own menu, where the element is whatever that step named.
 * A row carrying text asks for it here, so neither caller has to own that form.
 */
export function StepCommandList({ commands, onChoose, renderRow }: {
  commands: readonly StepOffer[];
  onChoose: (kind: RecordedStepKind, value?: string) => void;
  /** The element menu draws its own rows, so its tooltips and attributes stay as they were. */
  renderRow?: (offer: StepOffer, choose: (offer: StepOffer) => void) => React.ReactNode;
}) {
  const [asking, setAsking] = useState<StepOffer | undefined>();
  const choose = (offer: StepOffer) => {
    if (offer.needsValue) { setAsking(offer); return; }
    onChoose(offer.kind);
  };
  if (asking) return <OfferValueForm offer={asking} onCancel={() => setAsking(undefined)}
    onSubmit={value => { setAsking(undefined); onChoose(asking.kind, value); }} />;
  const row = (offer: StepOffer) => renderRow
    ? renderRow(offer, choose)
    : <MenuRow key={`${offer.kind}:${offer.source}`} title={offer.source} icon={<OfferIcon kind={offer.kind} />}
      attributes={{ "data-recorder-offer": offer.kind }} onClick={() => choose(offer)}>{OFFER_LABEL[offer.kind]}</MenuRow>;
  const actions = commands.filter(offer => !stepIsAssertion(offer.kind));
  const assertions = commands.filter(offer => stepIsAssertion(offer.kind));
  return <>
    {actions.length > 0 && <MenuGroup>Actions</MenuGroup>}
    {actions.map(row)}
    {assertions.length > 0 && <MenuGroup>Assertions</MenuGroup>}
    {assertions.map(row)}
  </>;
}
