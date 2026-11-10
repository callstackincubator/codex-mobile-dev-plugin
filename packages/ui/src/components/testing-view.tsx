import { useRef, useState, useSyncExternalStore } from "react";
import { CheckIcon, ChevronDownIcon, CircleIcon, CircleXIcon, CopyIcon, FlaskConicalIcon, FolderOpenIcon, GripVerticalIcon, LoaderCircleIcon, MoreHorizontalIcon, PlayIcon, SaveIcon, SquareIcon, Trash2Icon, XIcon } from "lucide-react";
import type { DeviceAppsStore } from "../device-apps.ts";
import type { TestingPanel } from "../testing-panel.ts";
import { testRecorder } from "../test-recorder.ts";
import type { TestRunView } from "../test-recorder.ts";
import { allStepOffers, isAgentStep, testFileSlug } from "@mobile-dev/shared/test-recording.ts";
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
      <TestingControls panel={panel} recordable={recordable} udid={device?.udid ?? ""} />
      <Button type="button" size="sm" className="sm:ml-auto" data-testing-launch disabled={!panel.canLaunch} onClick={() => void panel.launchApp()}>
        {state.launching ? <LoaderCircleIcon className="animate-spin" /> : <PlayIcon />}
        {state.appLaunched ? "Relaunch app" : "Launch app"}
      </Button>
      {state.loadingProject && <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status"><LoaderCircleIcon className="animate-spin" />Reading config…</span>}
    </header>

    {state.error && <Alert variant="destructive">
      <AlertTitle>Testing</AlertTitle>
      <AlertDescription>
        <span className="min-w-0 break-words">{state.error}</span>
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => panel.dismissError()}>Dismiss</Button>
      </AlertDescription>
    </Alert>}

    {blocker && <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{blocker}</p>}

    <TestingRecorder panel={panel} recordable={recordable} udid={device?.udid ?? ""} />
  </section>;
}

/** The recorder's primary actions live with the other app-level controls in the panel header. */
function TestingControls({ panel, recordable, udid }: { panel: TestingPanel; recordable: boolean; udid: string }) {
  const state = useSyncExternalStore(testRecorder.subscribe, testRecorder.getSnapshot);
  const panelState = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const recording = state.recordingUdid === udid && udid !== "";
  return <div data-testing-controls className="flex min-w-0 items-center gap-2">
    {recording
      ? <Button type="button" size="sm" variant="outline" data-testing-stop onClick={() => testRecorder.stop()}><SquareIcon />Stop</Button>
      : <Button type="button" size="sm" variant="outline" data-testing-record disabled={!recordable} onClick={() => testRecorder.start(udid, panel.dirty)}><CircleIcon />Record</Button>}
    <Button type="button" size="sm" variant="outline" data-testing-run disabled={!panel.canRun}
      title="Save the test, then run it against this device. Recording stops: the runner needs the device to itself."
      onClick={() => void panel.runTest()}>
      {panelState.running ? <LoaderCircleIcon className="animate-spin" /> : <FlaskConicalIcon />}Run test
    </Button>
    {state.resolving && <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status"><LoaderCircleIcon className="animate-spin" />Reading the screen…</span>}
  </div>;
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
  return <pre data-testing-preview className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed"><code>
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
        <span className={`testing-run-mark${mark ? ` is-${mark}` : ""}${run?.fading ? " is-fading" : ""}`} aria-hidden>
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
  const saveable = Boolean(panelState.projectPath) && state.steps.length > 0 && !panelState.saving;
  const [hoveredStep, setHoveredStep] = useState<string>();
  const [focusedStep, setFocusedStep] = useState<string>();
  const highlightedStep = hoveredStep ?? focusedStep;
  const highlightedLines = testRecorder.emitted.spans.find(span => span.stepId === highlightedStep);
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    {!recordable && !recording && <p className="text-xs text-muted-foreground">Recording needs a booted iOS simulator in the mirror.</p>}
    {recording && <p className="text-xs text-muted-foreground">
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
