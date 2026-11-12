import { useRef, useState, useSyncExternalStore } from "react";
import { BotIcon, CheckIcon, ChevronDownIcon, CircleIcon, CircleXIcon, CopyIcon, FilePlus2Icon, FlaskConicalIcon, FolderOpenIcon, GripVerticalIcon, HistoryIcon, LoaderCircleIcon, MoreHorizontalIcon, PlayIcon, SaveIcon, SquareIcon, Trash2Icon, UserIcon, XIcon } from "lucide-react";
import type { DeviceAppsStore } from "../device-apps.ts";
import type { TestingPanel } from "../testing-panel.ts";
import { formatRunDuration, testRecorder } from "../test-recorder.ts";
import type { TestRunView } from "../test-recorder.ts";
import { allStepOffers, isAgentStep, testFileSlug } from "@mobile-dev/shared/test-recording.ts";
import { draftLabel } from "@mobile-dev/shared/test-drafts.ts";
import type { RecordedStep } from "@mobile-dev/shared/test-recording.ts";
import { BackRow, MenuRow, OFFER_LABEL, OfferIcon, StepCommandList, useMenuStack } from "./step-commands.tsx";
import { CODE_TOKEN_CLASS, changedLines, highlightCode } from "../code-highlight.ts";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.tsx";
import { Button } from "./ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/base-select.tsx";

/**
 * The project selector: folders the panel has recorded against, plus the system folder picker for
 * any other one. The panel holds the choice and the server persists it.
 */
function TestingProjectPicker({ panel }: { panel: TestingPanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const [open, setOpen] = useState(false);
  const selected = state.projects.find(project => project.path === state.projectPath);
  const label = state.projectPath
    ? selected?.name ?? state.projectPath.split("/").filter(Boolean).at(-1) ?? state.projectPath
    : "Choose a project";
  const choose = (projectPath: string) => { setOpen(false); void panel.chooseProject(projectPath); };
  return <div className="flex min-w-0 items-center gap-1">
    <Popover open={open} onOpenChange={value => { setOpen(value); if (value) void panel.refreshProjects(); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="min-w-0 max-w-72 justify-between gap-1.5 font-normal" aria-label="Testing project" title={state.projectPath || "Choose an e2e project"}>
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDownIcon className="shrink-0 transition-transform" style={{ transform: open ? "rotate(180deg)" : undefined }} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex max-h-(--radix-popover-content-available-height) w-max min-w-[min(var(--radix-popover-trigger-width),var(--radix-popover-content-available-width))] max-w-(--radix-popover-content-available-width) flex-col gap-1 overflow-y-auto p-1 [&_button:not(:disabled)]:cursor-pointer" aria-label="Testing project">
        {state.projects.map(project => <Button key={project.path} type="button" variant="ghost" data-testing-project-option={project.path} aria-pressed={project.path === state.projectPath}
          className="h-auto min-h-7 min-w-0 flex-1 justify-start rounded-md px-1.5 py-1 text-left font-normal" onClick={() => choose(project.path)}>
          <span className="flex min-w-0 items-center gap-2">
            <CheckIcon className={`size-3.5 shrink-0 ${project.path === state.projectPath ? "opacity-100" : "opacity-0"}`} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{project.name}</span>
              <span className="truncate text-xs text-muted-foreground">{project.path}</span>
            </span>
          </span>
        </Button>)}
        {state.projects.length === 0 && <p className="px-1.5 py-1 text-xs text-muted-foreground">No projects yet. Choose a folder holding an e2e.config.ts.</p>}
        <Button type="button" variant="ghost" data-testing-project-browse disabled={state.pickingProject} className="h-auto min-h-7 justify-start rounded-md px-1.5 py-1 text-left font-normal" onClick={() => { setOpen(false); void panel.pickProject(); }}>
          <FolderOpenIcon />Choose another folder…
        </Button>
      </PopoverContent>
    </Popover>
    {state.pickingProject && <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" role="status"><LoaderCircleIcon className="animate-spin" />Choose a folder…</span>}
  </div>;
}


/** How long ago a draft was last touched, short enough to sit under its name in a row. */
function sinceLabel(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * The unsaved recordings of this project.
 *
 * A flow lives in the panel document until Save writes it into the project, and the host rebuilds
 * that document whenever the user looks at another tool or another chat — so without this, a flow
 * they had not saved, or one their agent recorded while they were reading the chat, was simply
 * gone when they came back. The panel keeps what it is holding as it changes; this is how one is
 * reopened, swapped for another, or thrown away.
 *
 * It is only shown once there is something in it: an empty control for a feature that exists to
 * recover work is a row of chrome in the way of the work.
 */
function TestingDraftPicker({ panel }: { panel: TestingPanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const recorder = useSyncExternalStore(testRecorder.subscribe, testRecorder.getSnapshot);
  const [open, setOpen] = useState(false);
  const agentRecording = state.agent?.active === true;
  // The one on screen may not be in the list yet: the autosave is debounced, and the first keep of
  // a brand new flow lands a moment after the first step.
  if (state.drafts.length === 0 && !state.draftId) return null;
  const current = state.drafts.find(draft => draft.id === state.draftId);
  const label = current ? draftLabel(current) : recorder.steps.length > 0 ? draftLabel(recorder) : "Recordings";
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (value) void panel.refreshDrafts(); }}>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" size="sm" data-testing-drafts className="min-w-0 max-w-64 shrink-0 justify-between gap-1.5 font-normal"
        aria-label="Unsaved recordings" title="Recordings that have not been written into the project yet">
        <span className="flex min-w-0 items-center gap-1.5">
          {state.loadingDraft ? <LoaderCircleIcon className="shrink-0 animate-spin" /> : <HistoryIcon className="shrink-0" />}
          <span className="min-w-0 truncate">{label}</span>
        </span>
        <ChevronDownIcon className="shrink-0 transition-transform" style={{ transform: open ? "rotate(180deg)" : undefined }} />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="flex max-h-(--radix-popover-content-available-height) w-max min-w-[min(var(--radix-popover-trigger-width),var(--radix-popover-content-available-width))] max-w-(--radix-popover-content-available-width) flex-col gap-1 overflow-y-auto p-1 [&_button:not(:disabled)]:cursor-pointer" aria-label="Unsaved recordings">
      <p className="px-1.5 pt-1 text-xs text-muted-foreground">Not saved into the project yet.</p>
      {state.drafts.map(draft => {
        const selected = draft.id === state.draftId;
        return <span key={draft.id} className="flex min-w-0 items-center gap-1">
          <Button type="button" variant="ghost" data-testing-draft-option={draft.id} aria-pressed={selected} disabled={agentRecording}
            className="h-auto min-h-7 min-w-0 flex-1 justify-start rounded-md px-1.5 py-1 text-left font-normal"
            onClick={() => { setOpen(false); void panel.openDraft(draft.id); }}>
            <span className="flex min-w-0 items-center gap-2">
              <CheckIcon className={`size-3.5 shrink-0 ${selected ? "opacity-100" : "opacity-0"}`} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{draftLabel(draft)}</span>
                <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  {draft.origin === "agent" ? <BotIcon className="size-3 shrink-0" aria-label="Recorded by an agent" /> : <UserIcon className="size-3 shrink-0" aria-label="Recorded by you" />}
                  {draft.stepCount} step{draft.stepCount === 1 ? "" : "s"}
                  {sinceLabel(draft.updatedAt) ? ` · ${sinceLabel(draft.updatedAt)}` : ""}
                </span>
              </span>
            </span>
          </Button>
          <Button type="button" variant="ghost" size="sm" data-testing-draft-delete={draft.id} disabled={agentRecording && selected}
            className="size-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
            title={selected ? "Delete this recording and clear the panel" : "Delete this recording"}
            aria-label={`Delete ${draftLabel(draft)}`}
            onClick={() => void panel.deleteDraft(draft.id)}><Trash2Icon /></Button>
        </span>;
      })}
      {state.drafts.length === 0 && <p className="px-1.5 py-1 text-xs text-muted-foreground">Nothing kept for this project yet.</p>}
      <Button type="button" variant="ghost" data-testing-draft-new disabled={agentRecording}
        className="h-auto min-h-7 justify-start rounded-md border-t px-1.5 py-1 text-left font-normal"
        title="Keep what is on screen and start an empty flow."
        onClick={() => { setOpen(false); void panel.newRecording(); }}><FilePlus2Icon />New recording</Button>
    </PopoverContent>
  </Popover>;
}

/**
 * The Testing tool: choose an e2e project, launch its app on the mirrored device, then record a
 * deterministic test by tapping the mirror.
 *
 * Recording is not implemented yet — this is the project-and-launch skeleton. The design, including
 * how a tap becomes a selector and when the file is written, is in `docs/testing-panel.md`.
 */
export function TestingView({ panel, deviceApps }: { panel: TestingPanel; deviceApps: DeviceAppsStore }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const devices = useSyncExternalStore(deviceApps.subscribe, deviceApps.getSnapshot);
  const device = devices.device;
  const booted = device?.state === "Booted" || device?.state === "connected";
  const target = state.targets.find(entry => entry.name === state.targetName) ?? state.targets[0];
  const recordable = Boolean(booted && device && (device.platform ?? "ios") === "ios" && device.kind !== "physical");
  // Why the recorder cannot start yet, in the order the user has to fix them.
  const blocker = !state.projectPath ? "Choose a project to record against."
    : state.loadingProject ? ""
      : state.targets.length === 0 ? "No targets found in this project's e2e config."
        : !target?.bundleId ? `Target "${target?.name}" declares no bundleId, so there is no app to launch.`
          : !booted ? "Boot a simulator to record against it."
            : "";
  return <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4 [&_button:not(:disabled)]:cursor-pointer" aria-label="Testing">
    <header className="flex flex-wrap items-center gap-2 border-b pb-3">
      <TestingProjectPicker panel={panel} />
      {state.targets.length > 1 && <Select items={state.targets.map(entry => ({ value: entry.name, label: entry.name }))} value={state.targetName} onValueChange={value => { if (value) panel.selectTarget(value); }}>
        <SelectTrigger id="testing-target-select" size="sm" className="shrink-0" aria-label="Target"><SelectValue>{state.targetName || "Target"}</SelectValue></SelectTrigger>
        <SelectContent align="start"><SelectGroup>
          {state.targets.map(entry => <SelectItem key={entry.name} value={entry.name}>{entry.name}{entry.platform ? ` · ${entry.platform}` : ""}</SelectItem>)}
        </SelectGroup></SelectContent>
      </Select>}
      <TestingDraftPicker panel={panel} />
      {/* Before the controls, so the `ml-auto` below has one thing to push away from and the
          status does not end up marooned past the right edge of the group. */}
      {state.loadingProject && <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status"><LoaderCircleIcon className="animate-spin" />Reading config…</span>}
      <TestingControls panel={panel} recordable={recordable} udid={device?.udid ?? ""} />
    </header>

    {state.error && <Alert variant="destructive">
      <AlertTitle>Testing</AlertTitle>
      <AlertDescription>
        <span className="min-w-0 break-words">{state.error}</span>
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => panel.dismissError()}>Dismiss</Button>
      </AlertDescription>
    </Alert>}

    {blocker && !state.agent?.active && <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{blocker}</p>}

    <AgentRecordingBanner panel={panel} />

    <TestingRecorder panel={panel} recordable={recordable} udid={device?.udid ?? ""} />
  </section>;
}

/**
 * What the panel says while the user's own coding agent is writing the flow.
 *
 * The recording lives in the server and the panel polls it, so this is the one thing on screen
 * that says who is driving — and the Stop button is the reason it has to be: the user asked for
 * the recording and must be able to take the mirror back without going via their agent.
 *
 * Once the agent stops, the banner says what was recorded and that nothing has been saved. From
 * there it is an ordinary unsaved recording: the same step list, the same preview, the same Save.
 */
function AgentRecordingBanner({ panel }: { panel: TestingPanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const agent = state.agent;
  if (!agent || agent.status === "idle") return null;
  if (agent.active) return <div data-testing-agent-banner className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs" role="status">
    <BotIcon className="size-4 shrink-0 text-primary" aria-hidden />
    <span className="min-w-0 flex-1 break-words"><span className="font-medium">Agent is recording</span>{agent.goal ? ` — ${agent.goal}` : ""}</span>
    <span className="shrink-0 tabular-nums text-muted-foreground">{agent.steps} step{agent.steps === 1 ? "" : "s"}</span>
    <Button type="button" size="sm" variant="outline" data-testing-agent-stop className="shrink-0"
      title="Stop the agent's recording. The steps it has written stay here for you to adjust."
      onClick={() => void panel.stopAgent()}><SquareIcon />Stop</Button>
  </div>;
  // The handover. It says what is there and what has *not* happened, because "recorded" reads as
  // "saved" to anyone who did not watch it: nothing is in the project until the user saves it.
  return <p data-testing-agent-handover className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" role="status">
    {agent.status === "aborted" ? "The agent stopped recording" : "The agent finished recording"}
    {` ${agent.steps} step${agent.steps === 1 ? "" : "s"}`}{agent.note ? ` — ${agent.note}` : ""}.
    {" "}Nothing has been saved or run: adjust the steps below, then press Save.
  </p>;
}

/**
 * Launch, Record and Run test: the three things done to the app, as one control group.
 *
 * They are one row, one gap and one button size because they are read as one sequence — launch the
 * app, record against it, run what was recorded. Launch used to sit outside this group and be
 * pushed to the far end of the header by `sm:ml-auto`, which put the first step of that sequence
 * furthest from the other two and left it to wrap on its own in a narrow panel. It keeps the solid
 * variant: it is the one step that has to happen before the rest mean anything, and that is a
 * difference worth seeing — the height, padding, gap and icon treatment are the primitive's own
 * and are now identical across all three.
 */
function TestingControls({ panel, recordable, udid }: { panel: TestingPanel; recordable: boolean; udid: string }) {
  const state = useSyncExternalStore(testRecorder.subscribe, testRecorder.getSnapshot);
  const panelState = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const recording = state.recordingUdid === udid && udid !== "";
  // While an agent is recording, the device is its own: a launch would reset the app under the
  // flow, and Record would arm a second driver on one screen.
  const agentRecording = panelState.agent?.active === true;
  // `ml-auto` on the group, not on any button in it: the header is one flex row, so the free
  // space between what names the project and what acts on it belongs to the gap between them.
  // The group keeps its own gap and sizes, and on a header too narrow to hold both it wraps whole
  // onto the next line rather than crowding or clipping the picker.
  return <div data-testing-controls className="flex min-w-0 flex-wrap items-center gap-2 ml-auto">
    <Button type="button" size="sm" data-testing-launch disabled={!panel.canLaunch || agentRecording} onClick={() => void panel.launchApp()}>
      {panelState.launching ? <LoaderCircleIcon className="animate-spin" /> : <PlayIcon />}
      {panelState.appLaunched ? "Relaunch app" : "Launch app"}
    </Button>
    {agentRecording
      // The agent's own Stop is on the banner, where the goal it is recording for is: one Stop,
      // beside what it stops.
      ? null
      : recording
        ? <Button type="button" size="sm" variant="outline" data-testing-stop onClick={() => testRecorder.stop()}><SquareIcon />Stop</Button>
        : state.steps.length > 0
          ? <RecordMenu udid={udid} recordable={recordable} steps={state.steps.length} />
          : <Button type="button" size="sm" variant="outline" data-testing-record disabled={!recordable}
            onClick={() => testRecorder.start(udid)}><CircleIcon />Record</Button>}
    <Button type="button" size="sm" variant="outline" data-testing-run disabled={!panel.canRun}
      title="Save the test, then run it against this device. Recording stops: the runner needs the device to itself."
      onClick={() => void panel.runTest()}>
      {panelState.running ? <LoaderCircleIcon className="animate-spin" /> : <FlaskConicalIcon />}Run test
    </Button>
    {state.resolving && <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status"><LoaderCircleIcon className="animate-spin" />Reading the screen…</span>}
  </div>;
}

/**
 * What Record does when there are already steps.
 *
 * It used to decide on its own, from whether the recording was dirty: steps survived while they
 * were unsaved and were wiped the moment they had been saved — and saving stops the recording, so
 * the very next Record threw away the flow the user had just written. The condition was sound and
 * invisible, which is the worst a destructive default can be. The question is small enough to ask.
 *
 * Escape dismisses it without recording: a popover that starts something on the way out is one
 * nobody can back out of.
 */
function RecordMenu({ udid, recordable, steps }: { udid: string; recordable: boolean; steps: number }) {
  const [open, setOpen] = useState(false);
  const choose = (keepSteps: boolean) => { setOpen(false); testRecorder.start(udid, keepSteps); };
  const count = `${steps} step${steps === 1 ? "" : "s"}`;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button type="button" size="sm" variant="outline" data-testing-record disabled={!recordable}><CircleIcon />Record</Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="flex w-64 flex-col gap-1 p-1.5 [&_button:not(:disabled)]:cursor-pointer"
      role="menu" aria-label="Record">
      <p className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        This flow has {count}
      </p>
      <MenuRow icon={<PlayIcon className="size-4 shrink-0 text-muted-foreground" />} attributes={{ "data-testing-record-resume": "" }}
        title={`Keep the ${count} and record the next one after them`} onClick={() => choose(true)}>Resume</MenuRow>
      <MenuRow icon={<Trash2Icon className="size-4 shrink-0 text-muted-foreground" />} attributes={{ "data-testing-record-new": "" }}
        title={`Clear the ${count} and start a new flow`} onClick={() => choose(false)}>New</MenuRow>
    </PopoverContent>
  </Popover>;
}

/**
 * The emitted test, with the lines a step just added called out.
 *
 * The whole file is re-emitted on every change, so what is new has to be recovered by comparing
 * with what was shown last. That is held in a ref rather than state: it is derived from the
 * source and recomputing it during the render that shows the source keeps the two in step, where
 * an effect would flash the new lines unmarked for a frame. `generation` remounts the marked
 * lines so their animation runs again for the next step, instead of only on the first.
 */
function TestPreview({ source, run, highlightedLines }: { source: string; run?: TestRunView; highlightedLines?: { from: number; to: number } }) {
  const shown = useRef({ source: "", range: [0, 0] as [number, number], generation: 0 });
  if (shown.current.source !== source) {
    const previous = shown.current.source;
    shown.current = {
      source,
      // Nothing was on screen before, so nothing arrived: opening the panel is not a change.
      range: previous ? changedLines(previous.split("\n"), source.split("\n")) : [0, 0],
      generation: shown.current.generation + 1,
    };
  }
  const { range: [from, to], generation } = shown.current;
  // The preview is a well the panel contains, not a card sitting on it. The muted surface reads
  // as recessed in light mode, but in dark mode it is *lighter* than the panel behind it, so the
  // well is cut deeper there instead of being lifted out of the pane.
  return <pre data-testing-preview className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed dark:bg-black/15"><code>
    {source.split("\n").map((line, index) => {
      const added = index >= from && index < to;
      // The report's lines are 1-based, as the file's own line numbers are.
      const mark = run?.lines[index + 1];
      const highlighted = highlightedLines && index + 1 >= highlightedLines.from && index + 1 <= highlightedLines.to;
      return <span key={added ? `new-${generation}-${index}` : `line-${index}`} data-testing-preview-line={index + 1}
        className={`testing-preview-line${added ? " is-new" : ""}${highlighted ? " is-step-highlighted" : ""}`}>
        {/* Two columns: a fixed gutter and the code. That is why the code does not move when a run
            starts, and why a mark stays level with the first row of a line that wraps — the mark is
            a sibling of the whole line, not a character at the front of it.
            The run's own state is announced once, above the preview; a mark per line would read the
            whole file out. So the gutter is decoration, and `aria-hidden` throughout. */}
        {/* Only a tick fades. A failing mark is what says where the run broke, so it stays. */}
        <span className={`testing-run-mark${mark ? ` is-${mark}` : ""}${run?.fading && mark === "passed" ? " is-fading" : ""}`} aria-hidden>
          {mark === "running" ? <LoaderCircleIcon className="size-3 animate-spin" />
            : mark === "passed" ? <CheckIcon className="size-3" />
              : mark === "failed" ? <CircleXIcon className="size-3" /> : null}
        </span>
        <span className="testing-preview-code">
          {highlightCode(line).map((token, position) =>
            token.kind === "plain"
              ? <span key={position}>{token.text}</span>
              : <span key={position} className={CODE_TOKEN_CLASS[token.kind]}>{token.text}</span>)}
        </span>
      </span>;
    })}
  </code></pre>;
}

/**
 * The recorder: the steps taken so far and the test they emit. The taps themselves are captured on
 * the mirror canvas by the simulator panel, which holds the device connection; this is the readout
 * and the controls.
 */
function TestingRecorder({ panel, recordable, udid }: { panel: TestingPanel; recordable: boolean; udid: string }) {
  const state = useSyncExternalStore(testRecorder.subscribe, testRecorder.getSnapshot);
  const panelState = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const recording = state.recordingUdid === udid && udid !== "";
  // Not while the agent is still writing the flow: saving half of one is a file the user did not
  // ask for, and the agent is told to hand over rather than to save.
  const saveable = Boolean(panelState.projectPath) && state.steps.length > 0 && !panelState.saving && !panelState.agent?.active;
  const [hoveredStep, setHoveredStep] = useState<string>();
  const [focusedStep, setFocusedStep] = useState<string>();
  const highlightedStep = hoveredStep ?? focusedStep;
  const highlightedLines = testRecorder.emitted.spans.find(span => span.stepId === highlightedStep);
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    {!recordable && !recording && !panelState.agent?.active && <p className="text-xs text-muted-foreground">Recording needs a booted iOS simulator in the mirror.</p>}
    {panelState.agent?.active && <p className="text-xs text-muted-foreground">
      The mirror is the agent's while it records, so clicking it does nothing. Press Stop to take it back.
    </p>}
    {recording && !panelState.agent?.active && <p className="text-xs text-muted-foreground">
      Click the mirror to drive the app; nothing is recorded. Right-click an element for the steps it
      supports, and scroll over the outline to pick the element around it.
    </p>}

    {state.error && <Alert variant="destructive">
      <AlertTitle>Recorder</AlertTitle>
      <AlertDescription>
        <span className="min-w-0 break-words">{state.error}</span>
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => testRecorder.dismissError()}>Dismiss</Button>
      </AlertDescription>
    </Alert>}

    <div data-testing-recorder-workspace className="grid min-h-0 flex-1 gap-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section data-testing-preview-pane className="flex min-h-64 min-w-0 flex-col gap-1.5 rounded-lg border p-3 md:min-h-0">
        <p className="flex flex-wrap items-center gap-2 text-xs font-medium">
          <span>Preview</span>
          {state.run?.state === "running" && <span className="flex items-center gap-1 font-normal text-muted-foreground" role="status">
            <LoaderCircleIcon className="size-3 animate-spin" />Running
          </span>}
          {state.run?.state === "passed" && <span className="flex items-center gap-1 font-normal text-emerald-600 dark:text-emerald-400" role="status"><CheckIcon className="size-3" />Passed</span>}
          {state.run?.state === "failed" && <span className="flex min-w-0 items-center gap-1 break-words font-normal text-red-600 dark:text-red-400" role="status">
            <CircleXIcon className="size-3 shrink-0" />{state.run.error ?? "Failed"}
          </span>}
          {/* The runner's own number, beside its verdict and on a failure too: how long a run took
              before it gave up is part of reading it. It is not the panel's `ui.testing.run`
              timing, which includes spawning the CLI. */}
          {state.run && state.run.state !== "running" && state.run.durationMs !== undefined
            && <span data-testing-run-duration className="font-normal tabular-nums text-muted-foreground"
              title="How long the runner reported the run taking.">{formatRunDuration(state.run.durationMs)}</span>}
          {/* The verdict is still about a run that happened; the lines it marked have moved. */}
          {state.run?.stale && <span data-testing-run-stale className="font-normal text-muted-foreground"
            title="The steps changed after this run, so the line marks no longer point at the same steps.">· before your edits</span>}
        </p>
        {state.run?.output && <pre className="max-h-32 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[10px] whitespace-pre-wrap">{state.run.output}</pre>}
        <TestPreview source={testRecorder.source} run={state.run} highlightedLines={highlightedLines} />
      </section>

      <div data-testing-editor-pane className="flex min-h-0 min-w-0 flex-col gap-3 rounded-lg border p-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,5fr)]">
          <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium">
            <span>Test title</span>
            <input type="text" data-testing-title defaultValue={state.title} onBlur={event => testRecorder.setTitle(event.target.value)}
              className="min-w-0 rounded-md border bg-background px-2.5 py-1.5 font-normal" aria-label="Test title" />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium">
            <span>File name</span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex min-w-0 flex-1 items-center overflow-hidden rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring/50">
                <code className="shrink-0 border-r bg-muted/50 px-2.5 py-1.5 font-normal text-muted-foreground">tests/</code>
                <input type="text" data-testing-filename defaultValue={panelState.fileName} placeholder={`${testFileSlug(state.title)}.e2e.ts`}
                  onBlur={event => panel.setFileName(event.target.value)} className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 font-normal outline-none" aria-label="Test file name" />
              </span>
              <Button type="button" size="sm" data-testing-save disabled={!saveable} onClick={() => void panel.saveTest()}>
                {panelState.saving ? <LoaderCircleIcon className="animate-spin" /> : <SaveIcon />}Save
              </Button>
            </span>
          </label>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 border-t pt-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-medium">Steps</h2>
            {state.steps.length > 0 && <span className="text-xs text-muted-foreground">{state.steps.length}</span>}
            <Button type="button" size="sm" variant="ghost" className="ml-auto" data-testing-clear disabled={state.steps.length === 0} onClick={() => testRecorder.clearSteps()}><Trash2Icon />Clear</Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1"><StepList steps={state.steps}
            onHoverStep={setHoveredStep} onFocusStep={setFocusedStep} /></div>
        </div>

        {panelState.overwritePath && <Alert>
          <AlertTitle>Replace the existing file?</AlertTitle>
          <AlertDescription>
            <span className="min-w-0 break-words">{panelState.overwritePath} already exists.</span>
            <span className="flex gap-2">
              <Button type="button" size="sm" data-testing-overwrite onClick={() => void panel.saveTest(true)}>Replace</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => panel.cancelOverwrite()}>Cancel</Button>
            </span>
          </AlertDescription>
        </Alert>}

        {panelState.savedPath && !panel.dirty && <p className="text-xs text-muted-foreground" role="status">Saved to {panelState.savedPath}</p>}
        {panelState.savedPath && panel.dirty && <p className="text-xs text-amber-600" role="status">Unsaved steps since {panelState.savedPath} was written.</p>}
      </div>
    </div>
  </div>;
}

/**
 * The recorded steps, in the order the file emits them.
 *
 * Every row is editable in place: a step can be dragged to another position, copied, or pointed at
 * a different command while keeping the element it named. All three go through the recorder, so
 * the numbering, the ambiguous badge and the preview are recomputed from one list rather than kept
 * in step by hand.
 */
function StepList({ steps, onHoverStep, onFocusStep }: {
  steps: readonly RecordedStep[];
  onHoverStep: (stepId: string | undefined) => void;
  onFocusStep: (stepId: string | undefined) => void;
}) {
  // The row being dragged and the gap it would land in. Held here rather than in the recorder:
  // a drag that is abandoned must leave the recorded flow exactly as it was.
  const [dragging, setDragging] = useState<string | undefined>();
  const [over, setOver] = useState<number | undefined>();
  const drop = (index: number) => {
    if (dragging) testRecorder.moveStep(dragging, index);
    setDragging(undefined); setOver(undefined);
  };
  return <ol className="flex flex-col gap-1 text-xs">
    {steps.map((step, index) => <li
      key={step.id}
      draggable
      data-testing-step={step.id}
      className={`group/step flex items-center gap-2 rounded-md border px-2 py-1.5 ${dragging === step.id ? "opacity-50" : ""} ${over === index && dragging !== step.id ? "border-primary" : ""}`}
      onMouseEnter={() => onHoverStep(step.id)}
      onMouseLeave={() => onHoverStep(undefined)}
      onFocus={() => onFocusStep(step.id)}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFocusStep(undefined); }}
      onDragStart={event => { setDragging(step.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", step.id); }}
      onDragEnd={() => { setDragging(undefined); setOver(undefined); }}
      onDragOver={event => { if (!dragging) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(index); }}
      onDrop={event => { event.preventDefault(); drop(index); }}
    >
      <GripVerticalIcon aria-hidden className="size-3.5 shrink-0 cursor-grab text-muted-foreground opacity-40 group-hover/step:opacity-100" />
      <span className="w-4 shrink-0 text-right text-muted-foreground">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate" title={step.label}>{step.label}</span>
      {/* Both badges are about a locator, and an agent step has none: nothing was resolved, so
          nothing can be ambiguous or fall back to a coordinate. */}
      {!isAgentStep(step) && step.ambiguous && <span className="shrink-0 text-amber-600" title="This matched more than one element. Add a testID to pin it.">ambiguous</span>}
      {!isAgentStep(step) && step.selector.kind === "point" && <span className="shrink-0 text-amber-600" title="Nothing resolved here, so the test taps a coordinate.">coordinates</span>}
      {isAgentStep(step) && <span className="shrink-0 text-muted-foreground" title="Resolved by the agent at run time, not by a locator.">agent</span>}
      <StepMenu step={step} index={index} />
      <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove step ${index + 1}`} onClick={() => testRecorder.removeStep(step.id)}><XIcon /></Button>
    </li>)}
    {steps.length === 0 && <li className="rounded-lg border border-dashed px-3 py-5 text-center text-muted-foreground">No steps yet. Right-click an element in the mirror to add one.</li>}
  </ol>;
}

/**
 * One step's own menu, revealed by pointing at its row.
 *
 * "Change command" is the mirror's "All commands" list, offered against the element this step
 * already named: the commands are derived from what that element carried when it was recorded
 * (see `PinnedStep.target`), so a text field still offers `fill` and an element with text still
 * offers the text matchers, long after the screen has moved on.
 *
 * An agent step is offered Duplicate alone. It has no element to re-point — and converting it to a
 * pinned command would have to invent a locator, while converting a pinned step the other way
 * would throw away the one it was recorded for. Agentic is recorded over the mirror, where there
 * is a screen to describe.
 */
function StepMenu({ step, index }: { step: RecordedStep; index: number }) {
  const [open, setOpen] = useState(false);
  const { view, push, back, reset } = useMenuStack();
  const offers = isAgentStep(step) ? [] : allStepOffers(step.selector, step.target);
  const close = () => { setOpen(false); reset(); };
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (!value) reset(); }}>
    <PopoverTrigger asChild>
      <Button type="button" variant="ghost" size="icon-xs" data-testing-step-menu={step.id}
        aria-label={`Edit step ${index + 1}`}
        // Revealed by the hover, but never hidden from the keyboard: `focus-visible` keeps it
        // reachable by tabbing, where opacity alone would make it a control nobody can find.
        className={`shrink-0 opacity-0 transition-opacity group-hover/step:opacity-100 focus-visible:opacity-100 ${open ? "opacity-100" : ""}`}
        onMouseEnter={() => setOpen(true)}><MoreHorizontalIcon /></Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="flex w-60 max-h-(--radix-popover-content-available-height) flex-col gap-1 overflow-y-auto p-1.5 [&_button:not(:disabled)]:cursor-pointer"
      role="menu" aria-label={`Step ${index + 1}`} onMouseLeave={close}>
      {view === "commands"
        // The list replaces the menu rather than hanging beside it — the row it opens from is only
        // as wide as a step — so it carries its own way back; without one the menu was a dead end
        // that could only be left by dismissing it and pointing at the row again.
        ? <>
          <BackRow onClick={back} attributes={{ "data-testing-step-commands-back": step.id }} />
          <StepCommandList commands={offers} onChoose={(kind, value) => { close(); testRecorder.changeStepCommand(step.id, kind, value); }} />
        </>
        : <>
          <MenuRow icon={<CopyIcon className="size-4 shrink-0 text-muted-foreground" />} attributes={{ "data-testing-step-duplicate": step.id }}
            title="Add a copy of this step at the end of the list"
            onClick={() => { close(); testRecorder.duplicateStep(step.id); }}>Duplicate</MenuRow>
          {!isAgentStep(step) && <MenuRow chevron icon={<OfferIcon kind={step.kind} />} attributes={{ "data-testing-step-commands": step.id }}
            title={`Currently ${OFFER_LABEL[step.kind]}`}
            onOpen={() => push("commands")} onClick={() => push("commands")}>Change command</MenuRow>}
        </>}
    </PopoverContent>
  </Popover>;
}
