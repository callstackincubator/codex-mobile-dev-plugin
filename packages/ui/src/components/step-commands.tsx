import { useEffect, useId, useRef, useState } from "react";
import { ArrowDownIcon, ArrowDownToLineIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, CheckIcon, ChevronRightIcon, EyeIcon, EyeOffIcon, HandIcon, MousePointerClickIcon, PlusIcon, SparklesIcon, TextCursorInputIcon, TypeIcon, WandSparklesIcon, XIcon } from "lucide-react";
import { DEFAULT_ASSERTION_TIMEOUT_MS, stepIsAssertion, stepNeedsValue } from "@mobile-dev/shared/test-recording.ts";
import type { AgentParams, AgentStepKind, PinnedStepKind, RecordedStepKind, StepOffer, SwipeDirection, VisionMode } from "@mobile-dev/shared/test-recording.ts";
import { Branch } from "./cascading-menu";
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
  assertVisible: "Is Visible",
  assertNotVisible: "Is Not Visible",
  assertText: "Text Is",
  assertContainsText: "Text Contains",
  assertValue: "Field Value Is",
  assertEnabled: "Is Enabled",
  assertDisabled: "Is Disabled",
  assertSelected: "Is Selected",
  swipe: "Swipe",
  agentAct: "Agent action",
  agentAssert: "Agent check",
  agentWaitFor: "Agent wait",
};

export function OfferIcon({ kind }: { kind: RecordedStepKind }) {
  const Icon = kind === "agentAct" ? WandSparklesIcon
    : kind === "agentAssert" || kind === "agentWaitFor" ? SparklesIcon
      : kind === "swipe" ? HandIcon
        : kind === "fill" ? TextCursorInputIcon
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

/** Collects a command's text and, when requested, its wait budget. */
export function OfferValueForm({ offer, onSubmit, onCancel, initialTimeoutMs, includeTimeout = false, back = false }: {
  offer: StepOffer; onSubmit: (value?: string, timeoutMs?: number) => void; onCancel: () => void;
  initialTimeoutMs?: number; includeTimeout?: boolean; back?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const timeoutInput = useRef<HTMLInputElement>(null);
  useEffect(() => { (stepNeedsValue(offer.kind) ? input : timeoutInput).current?.focus(); }, [offer, includeTimeout]);
  const placeholder = offer.kind === "fill" ? "Text to enter" : "Text to expect";
  return <form className="flex flex-col gap-1.5" onSubmit={event => {
    event.preventDefault();
    const timeoutMs = includeTimeout ? Number(timeoutInput.current?.value) : undefined;
    if (includeTimeout && (!Number.isSafeInteger(timeoutMs) || timeoutMs! <= 0)) return;
    onSubmit(stepNeedsValue(offer.kind) ? input.current?.value ?? "" : undefined, timeoutMs);
  }}>
    {back ? <button type="button" className="flex items-center gap-1 rounded-lg px-2 py-1 text-left text-sm hover:bg-accent"
      onClick={onCancel} aria-label="Back to assertion options"><ArrowLeftIcon className="size-4" />Back</button>
      : <div className="flex items-center gap-2 px-2 py-1 text-sm font-medium">
        <OfferIcon kind={offer.kind} />
        <span>{OFFER_LABEL[offer.kind]}</span>
      </div>}
    {stepNeedsValue(offer.kind) && <div className="flex items-center gap-1.5">
      <input ref={input} type="text" defaultValue={offer.suggestedValue ?? ""} aria-label={placeholder} placeholder={placeholder}
        className="min-w-0 flex-1 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-sm"
        onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }} />
    </div>}
    {includeTimeout && <label className="flex items-center gap-2 text-xs text-muted-foreground">
      Timeout (ms)
      <input ref={timeoutInput} type="number" min="1" step="1" required
        defaultValue={initialTimeoutMs ?? DEFAULT_ASSERTION_TIMEOUT_MS} aria-label="Assertion timeout in milliseconds"
        className="min-w-0 flex-1 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-sm text-foreground"
        onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }} />
    </label>}
    <Button type="submit" size="sm" className="self-end">Add</Button>
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
export function StepCommandList({ commands, onChoose, renderRow, initialTimeoutMs }: {
  commands: readonly StepOffer[];
  onChoose: (kind: PinnedStepKind, value?: string, timeoutMs?: number) => void;
  initialTimeoutMs?: number;
  /** The element menu draws its own rows, so its tooltips and attributes stay as they were. */
  renderRow?: (offer: StepOffer, choose: (offer: StepOffer) => void) => React.ReactNode;
}) {
  const [asking, setAsking] = useState<StepOffer | undefined>();
  const choose = (offer: StepOffer) => {
    if (offer.needsValue) { setAsking(offer); return; }
    onChoose(offer.kind);
  };
  if (asking) return <OfferValueForm offer={asking} initialTimeoutMs={initialTimeoutMs} onCancel={() => setAsking(undefined)}
    onSubmit={(value, timeoutMs) => { setAsking(undefined); onChoose(asking.kind, value, timeoutMs); }} />;
  const row = (offer: StepOffer) => stepIsAssertion(offer.kind)
    ? <AssertionBranch key={`${offer.kind}:${offer.source}`} offer={offer} onChoose={onChoose} initialTimeoutMs={initialTimeoutMs} />
    : renderRow
    ? renderRow(offer, choose)
    : <MenuRow key={`${offer.kind}:${offer.source}`} title={offer.source} icon={<OfferIcon kind={offer.kind} />}
      attributes={{ "data-recorder-offer": offer.kind }} onClick={() => choose(offer)}>{OFFER_LABEL[offer.kind]}</MenuRow>;
  // The four swipes are one command chosen four ways, so they are one row with a branch rather
  // than four rows that read as four commands. Every other offer is a row of its own.
  const swipes = commands.filter(offer => offer.kind === "swipe");
  const actions = commands.filter(offer => !stepIsAssertion(offer.kind) && offer.kind !== "swipe");
  const assertions = commands.filter(offer => stepIsAssertion(offer.kind));
  return <>
    {(actions.length > 0 || swipes.length > 0) && <MenuGroup>Actions</MenuGroup>}
    {actions.map(row)}
    {swipes.length > 0 && <SwipeBranch swipes={swipes} onChoose={onChoose} />}
    {assertions.length > 0 && <MenuGroup>Assertions</MenuGroup>}
    {assertions.map(row)}
  </>;
}

/** Assertion choices stay beside their command; only Add timeout opens an editor. */
export function AssertionBranch({ offer, onChoose, initialTimeoutMs }: {
  offer: StepOffer;
  onChoose: (kind: PinnedStepKind, value?: string, timeoutMs?: number) => void;
  initialTimeoutMs?: number;
}) {
  const [editor, setEditor] = useState<"default" | "timeout" | undefined>();
  const selectDefault = () => {
    if (stepNeedsValue(offer.kind)) { setEditor("default"); return; }
    onChoose(offer.kind);
  };
  return <Branch label={`${OFFER_LABEL[offer.kind]} options`} width={220} align="top" flip
    attributes={{ "data-recorder-assertion-panel": offer.kind }}
    renderRow={handlers => <div className="group/offer flex min-w-0 items-center rounded-lg transition-colors hover:bg-accent hover:text-accent-foreground focus-within:bg-accent focus-within:text-accent-foreground">
      <button type="button" role="menuitem" title={offer.source}
        data-recorder-offer={offer.kind}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm focus-visible:outline-none"
        onClick={() => { if (stepNeedsValue(offer.kind)) handlers.onClick(); selectDefault(); }}>
        <OfferIcon kind={offer.kind} />
        <span className="min-w-0 flex-1 truncate font-medium">{OFFER_LABEL[offer.kind]}</span>
      </button>
      <button type="button" aria-label={`${OFFER_LABEL[offer.kind]} options`}
        className="flex self-stretch items-center rounded-lg px-2.5 text-muted-foreground focus-visible:outline-none"
        onFocus={handlers.onOpen} onClick={handlers.onClick}>
        <ChevronRightIcon className="size-4" />
      </button>
    </div>}
  >
    {editor ? <OfferValueForm offer={offer} includeTimeout={editor === "timeout"} back
      initialTimeoutMs={initialTimeoutMs}
      onCancel={() => setEditor(undefined)}
      onSubmit={(value, timeoutMs) => onChoose(offer.kind, value, timeoutMs)} />
      : <>
        <MenuRow attributes={{ "data-recorder-assertion-default": offer.kind }} onClick={selectDefault}>Insert</MenuRow>
        <MenuRow attributes={{ "data-recorder-assertion-timeout": offer.kind }} onClick={() => setEditor("timeout")}>Add timeout</MenuRow>
      </>}
  </Branch>;
}

const DIRECTION_ICON = { up: ArrowUpIcon, down: ArrowDownIcon, left: ArrowLeftIcon, right: ArrowRightIcon };

/**
 * The Swipe row and the four ways it can go.
 *
 * Each direction carries its own emitted code as a tooltip, which is where the two forms of the
 * command show themselves: scoped to the element the step names, or `screen.swipe` over the
 * viewport when the tap resolved to nothing nameable. That second form is why swipe is offered on
 * a bare point at all — it is about the viewport, not about anything in it.
 */
function SwipeBranch({ swipes, onChoose }: {
  swipes: readonly StepOffer[]; onChoose: (kind: PinnedStepKind, value?: string) => void;
}) {
  return <Branch
    label="Swipe" width={BRANCH_WIDTH} align="top" flip
    attributes={{ "data-element": "recorder-swipe" }}
    renderRow={handlers => <MenuRow
      chevron icon={<OfferIcon kind="swipe" />}
      attributes={{ "data-recorder-panel": "swipe" }}
      title={swipes[0]?.source.replace(/"(up|down|left|right)"/, "…")}
      onOpen={handlers.onOpen} onClick={handlers.onClick}
    >{OFFER_LABEL.swipe}</MenuRow>}
  >
    {swipes.map(offer => {
      const direction = (offer.suggestedValue ?? "up") as SwipeDirection;
      const Icon = DIRECTION_ICON[direction];
      return <MenuRow
        key={direction} title={offer.source}
        attributes={{ "data-recorder-swipe": direction }}
        icon={<Icon className="size-4 shrink-0 text-muted-foreground" />}
        onClick={() => onChoose("swipe", direction)}
      >{direction[0]!.toUpperCase()}{direction.slice(1)}</MenuRow>;
    })}
  </Branch>;
}

/** What `agent.assert`'s judge is shown, as three plain choices over `VisionMode`. */
const VISION_CHOICES: { value: VisionMode; label: string; hint: string }[] = [
  { value: false, label: "Off", hint: "Judge from the element tree alone. The runner's default." },
  { value: true, label: "On", hint: "Judge from the tree and a masked screenshot." },
  // 'only' is the one that can be refused outright: with no tree to fall back on, a screen the
  // runner cannot prove it redacted is denied with POLICY_DENIED rather than sent.
  { value: "only", label: "Screenshot only", hint: "Judge from the screenshot alone. Denied when the pixels cannot be proven redacted." },
];

const visionLabel = (value: VisionMode) => VISION_CHOICES.find(choice => choice.value === value)!.label;

/** How wide the agentic branches are: a list of two words, then forms that hold a sentence. */
const BRANCH_WIDTH = 190;
const FORM_WIDTH = 270;

/** One param the user is editing. Held as rows, not as the record, so a blank row can exist. */
type ParamRow = { id: string; key: string; value: string };

/**
 * The `params` editor: the values an `act` instruction refers to, as key and text rows.
 *
 * Text rows and nothing else. `AgentParams` admits numbers, booleans, nested objects, `Secret` and
 * `unique()`, but a type picker beside every row would cost more attention than it saves for the
 * common case, which is a handful of scalars — so the text decides the literal when the file is
 * written (see `paramValueSource`), and the shapes that carry a runtime meaning of their own stay
 * something the user writes in the file.
 */
function ParamsEditor({ rows, onChange }: { rows: ParamRow[]; onChange: (rows: ParamRow[]) => void }) {
  const prefix = useId();
  const set = (id: string, field: "key" | "value", next: string) =>
    onChange(rows.map(row => row.id === id ? { ...row, [field]: next } : row));
  return <div className="flex flex-col gap-1">
    <MenuGroup>Params</MenuGroup>
    {rows.map((row, index) => <div key={row.id} className="flex items-center gap-1" data-recorder-param={String(index)}>
      <input
        type="text" value={row.key} aria-label={`Param ${index + 1} name`} placeholder="name"
        data-recorder-param-key={String(index)}
        className="w-20 min-w-0 shrink-0 rounded-lg border bg-muted/40 px-2 py-1 text-xs"
        onChange={event => set(row.id, "key", event.target.value)} />
      <input
        type="text" value={row.value} aria-label={`Param ${index + 1} value`} placeholder="value"
        data-recorder-param-value={String(index)}
        className="min-w-0 flex-1 rounded-lg border bg-muted/40 px-2 py-1 text-xs"
        onChange={event => set(row.id, "value", event.target.value)} />
      <Button type="button" variant="ghost" size="icon-xs" className="shrink-0"
        aria-label={`Remove param ${index + 1}`} data-recorder-param-remove={String(index)}
        onClick={() => onChange(rows.filter(entry => entry.id !== row.id))}><XIcon /></Button>
    </div>)}
    <MenuRow icon={<PlusIcon className="size-4 shrink-0 text-muted-foreground" />}
      attributes={{ "data-recorder-param-add": "" }}
      title="A value the instruction refers to, passed to the agent rather than written into it"
      onClick={() => onChange([...rows, { id: `${prefix}-${rows.length}-${Date.now()}`, key: "", value: "" }])}
    >Add param</MenuRow>
  </div>;
}

/**
 * The rows as the step records them: in order, blank keys dropped, the last of a repeated key
 * winning — which is the only thing an object literal can mean. See `AgentParams`.
 */
function toParams(rows: ParamRow[]): AgentParams | undefined {
  const params: AgentParams = {};
  for (const row of rows) if (row.key.trim() !== "") params[row.key.trim()] = row.value;
  return Object.keys(params).length > 0 ? params : undefined;
}

/** The sentence field both agent forms are built around. */
function InstructionField({ kind, value, onChange }: {
  kind: AgentStepKind; value: string; onChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  return <input
    ref={input} type="text" value={value} data-recorder-agentic-input={kind}
    aria-label={kind === "agentAct" ? "What the agent should do" : "What should be true"}
    placeholder={kind === "agentAct" ? 'tap the "Explore" tab' : "the cart shows two items"}
    className="min-w-0 rounded-lg border bg-muted/40 px-2.5 py-1.5 text-sm"
    onChange={event => onChange(event.target.value)} />;
}

function FormHeading({ kind }: { kind: AgentStepKind }) {
  return <div className="flex items-center gap-2 px-2 py-1 text-sm font-medium">
    <OfferIcon kind={kind} />
    <span>{OFFER_LABEL[kind]}</span>
  </div>;
}

/**
 * The Agentic branch: Act and Assert, each opening its own form beside it.
 *
 * Neither call takes a locator — `agent.act(instruction)` and `agent.assert(assertion)` are a
 * sentence and nothing else — so the element the user right-clicked only writes the first draft of
 * that sentence and is then forgotten. That is why this is offered where nothing can be named at
 * all: describing the thing is the step, and a coordinate is not.
 */
export function AgenticBranch({ suggestion, onRecord }: {
  /** The sentence the Act field starts from; see `agentActSuggestion`. */
  suggestion: string;
  onRecord: (step:
    | { kind: "agentAct"; instruction: string; params?: AgentParams }
    | { kind: "agentAssert" | "agentWaitFor"; instruction: string; vision?: VisionMode }) => void;
}) {
  return <Branch
    label="Agentic" width={BRANCH_WIDTH} align="top" flip
    attributes={{ "data-element": "recorder-agentic" }}
    renderRow={handlers => <MenuRow
      chevron icon={<OfferIcon kind="agentAct" />}
      attributes={{ "data-recorder-panel": "agentic" }}
      title="Describe the step and let the agent resolve it at run time"
      onOpen={handlers.onOpen} onClick={handlers.onClick}
    >Agentic</MenuRow>}
  >
    <Branch
      label="Act" width={FORM_WIDTH} align="top" flip
      attributes={{ "data-element": "recorder-agentic-act" }}
      renderRow={handlers => <MenuRow
        chevron icon={<OfferIcon kind="agentAct" />}
        attributes={{ "data-recorder-agentic": "agentAct" }}
        title="agent.act(…) — the agent carries out an instruction"
        onOpen={handlers.onOpen} onClick={handlers.onClick}
      >Act</MenuRow>}
    ><ActForm suggestion={suggestion} onRecord={onRecord} /></Branch>
    <Branch
      label="Assert" width={FORM_WIDTH} align="top" flip
      attributes={{ "data-element": "recorder-agentic-assert" }}
      renderRow={handlers => <MenuRow
        chevron icon={<OfferIcon kind="agentAssert" />}
        attributes={{ "data-recorder-agentic": "agentAssert" }}
        title="agent.assert(…) — the agent judges whether something holds"
        onOpen={handlers.onOpen} onClick={handlers.onClick}
      >Assert</MenuRow>}
    ><JudgementForm kind="agentAssert" onRecord={onRecord} /></Branch>
    <Branch
      label="Wait for" width={FORM_WIDTH} align="top" flip
      attributes={{ "data-element": "recorder-agentic-waitfor" }}
      renderRow={handlers => <MenuRow
        chevron icon={<OfferIcon kind="agentWaitFor" />}
        attributes={{ "data-recorder-agentic": "agentWaitFor" }}
        title="agent.waitFor(…) — the agent judges on a loop until it holds"
        onOpen={handlers.onOpen} onClick={handlers.onClick}
      >Wait for</MenuRow>}
    ><JudgementForm kind="agentWaitFor" onRecord={onRecord} /></Branch>
  </Branch>;
}

function ActForm({ suggestion, onRecord }: {
  suggestion: string;
  onRecord: (step: { kind: "agentAct"; instruction: string; params?: AgentParams }) => void;
}) {
  const [instruction, setInstruction] = useState(suggestion);
  const [rows, setRows] = useState<ParamRow[]>([]);
  const params = toParams(rows);
  return <form className="flex flex-col gap-1.5" onSubmit={event => {
    event.preventDefault();
    // No params means no options object at all, so the line stays `agent.act("…")`.
    onRecord({ kind: "agentAct", instruction, ...(params ? { params } : {}) });
  }}>
    <FormHeading kind="agentAct" />
    <InstructionField kind="agentAct" value={instruction} onChange={setInstruction} />
    <ParamsEditor rows={rows} onChange={setRows} />
    <div className="flex justify-end"><Button type="submit" size="sm" className="shrink-0">Add</Button></div>
  </form>;
}

/**
 * The form behind both judgements.
 *
 * `assert` judges once and `waitFor` judges on a loop, but what the user supplies is the same
 * sentence and the same choice of what the judge is shown, so they share a form. `waitFor`'s own
 * `interval` and `maxModelCalls` are budgets rather than a description of the condition, and like
 * `act`'s they stay something the user sets in the file.
 */
function JudgementForm({ kind, onRecord }: {
  kind: "agentAssert" | "agentWaitFor";
  onRecord: (step: { kind: "agentAssert" | "agentWaitFor"; instruction: string; vision?: VisionMode }) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [vision, setVision] = useState<VisionMode>(false);
  return <form className="flex flex-col gap-1.5" onSubmit={event => {
    event.preventDefault();
    onRecord({ kind, instruction, ...(vision ? { vision } : {}) });
  }}>
    <FormHeading kind={kind} />
    <InstructionField kind={kind} value={instruction} onChange={setInstruction} />
    <Branch
      label="Vision" width={BRANCH_WIDTH} align="top" flip
      attributes={{ "data-element": "recorder-vision" }}
      renderRow={handlers => <MenuRow
        chevron icon={<EyeIcon className="size-4 shrink-0 text-muted-foreground" />}
        attributes={{ "data-recorder-panel": "vision" }}
        title="What the judge is shown"
        onOpen={handlers.onOpen} onClick={handlers.onClick}
      >Vision: {visionLabel(vision)}</MenuRow>}
    >
      {VISION_CHOICES.map(choice => <MenuRow
        key={String(choice.value)} title={choice.hint}
        attributes={{ "data-recorder-vision": String(choice.value) }}
        icon={<CheckIcon className={`size-4 shrink-0 ${choice.value === vision ? "text-foreground" : "opacity-0"}`} />}
        onClick={() => setVision(choice.value)}
      >{choice.label}</MenuRow>)}
    </Branch>
    <div className="flex justify-end"><Button type="submit" size="sm" className="shrink-0">Add</Button></div>
  </form>;
}
