import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { BotIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, CircleIcon, CircleXIcon, CopyIcon, FileCode2Icon, FilePlus2Icon, FlaskConicalIcon, FolderOpenIcon, GripVerticalIcon, HistoryIcon, LoaderCircleIcon, MoreHorizontalIcon, PlayIcon, SaveIcon, SquareIcon, Trash2Icon, UserIcon, XIcon } from "lucide-react";
import type { DeviceAppsStore } from "../device-apps.ts";
import type { TestingPanel } from "../testing-panel.ts";
import { OPEN_STEP, formatRunDuration, testRecorder } from "../test-recorder.ts";
import type { TestRunView } from "../test-recorder.ts";
import { allStepOffers, isAgentStep, testFileSlug } from "@mobile-dev/shared/test-recording.ts";
import { draftLabel } from "@mobile-dev/shared/test-drafts.ts";
import type { RecordedStep } from "@mobile-dev/shared/test-recording.ts";
import { MenuRow, OFFER_LABEL, OfferIcon, StepCommandList } from "./step-commands.tsx";
import { Branch } from "./cascading-menu.tsx";
import { CODE_TOKEN_CLASS, changedLines, highlightCode } from "../code-highlight.ts";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.tsx";
import { Button } from "./ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable.tsx";
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

/** A group header in the tests list: a disclosure that says how many rows it is holding. */
function ListGroup({ label, count, open, onToggle, attributes, children }: {
  label: string; count: number; open: boolean; onToggle: () => void;
  attributes?: Record<string, string>; children: React.ReactNode;
}) {
  return <div className="flex min-w-0 flex-col">
    <button type="button" {...attributes} aria-expanded={open}
      className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      onClick={onToggle}>
      {open ? <ChevronDownIcon className="size-3.5 shrink-0" /> : <ChevronRightIcon className="size-3.5 shrink-0" />}
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 tabular-nums">{count}</span>
    </button>
    {open && <div className="flex min-w-0 flex-col gap-1 pl-1">{children}</div>}
  </div>;
}

/**
 * The delete a row asks through: the trash icon, and the question in a popover beside it.
 *
 * Deleting a recording throws away steps nothing can replay, and deleting a stored test removes a
 * file from the user's repository; both used to happen on one click of an icon that sits beside
 * the row the user was reaching for. The question hangs off the icon rather than replacing the row
 * so the row it is about stays legible underneath it, and so the question has room to say what
 * will go and that it cannot be undone — which a row the width of a file name does not.
 */
function ConfirmDelete({ question, label, title, disabled, busy, attributes, onConfirm }: {
  /** What is about to go, as the sentence the popover opens with. */
  question: string;
  /** The trash button's own accessible name, e.g. `Delete flow.e2e.ts`. */
  label: string;
  title: string;
  disabled?: boolean;
  busy?: boolean;
  attributes?: Record<string, string>;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button type="button" variant="ghost" size="sm" disabled={disabled || busy} {...attributes}
        className="size-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
        title={title} aria-label={label}>
        {busy ? <LoaderCircleIcon className="animate-spin" /> : <Trash2Icon />}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="flex w-64 flex-col gap-2 p-2.5 [&_button:not(:disabled)]:cursor-pointer"
      role="alertdialog" aria-label={question}>
      <p className="min-w-0 break-words text-xs">{question}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button type="button" size="sm" variant="destructive" data-confirm-delete=""
          onClick={() => { setOpen(false); onConfirm(); }}>Delete</Button>
      </div>
    </PopoverContent>
  </Popover>;
}

/**
 * The flows of this project: the ones that are not stored yet, and the tests the project holds.
 *
 * A flow lives in the panel document until Save writes it into the project, and the host rebuilds
 * that document whenever the user looks at another tool or another chat — so without the first
 * group, a flow they had not saved, or one their agent recorded while they were reading the chat,
 * was simply gone when they came back.
 *
 * The second group is here because saving used to have the same effect for the opposite reason:
 * the draft is deleted once the file exists, so the test the user had just saved left the list.
 * Now it moves — out of **Not stored** and into the project's own tests, which are read from the
 * folder so a test written by hand or by an agent is listed beside the recorded ones. That group
 * starts collapsed: it is the archive, and what is being worked on is above it.
 */
function TestingDraftPicker({ panel }: { panel: TestingPanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const recorder = useSyncExternalStore(testRecorder.subscribe, testRecorder.getSnapshot);
  const [open, setOpen] = useState(false);
  const [unstoredOpen, setUnstoredOpen] = useState(true);
  const [storedOpen, setStoredOpen] = useState(false);
  const agentRecording = state.agent?.active === true;
  // The one on screen may not be in the list yet: the autosave is debounced, and the first keep of
  // a brand new flow lands a moment after the first step.
  if (state.drafts.length === 0 && !state.draftId && state.tests.length === 0) return null;
  const current = state.drafts.find(draft => draft.id === state.draftId);
  const label = current ? draftLabel(current) : recorder.steps.length > 0 ? draftLabel(recorder) : "Tests";
  return <Popover open={open} onOpenChange={value => {
    setOpen(value);
    if (value) { void panel.refreshDrafts(); void panel.refreshTests(); }
  }}>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" size="sm" data-testing-drafts className="min-w-0 max-w-64 shrink-0 justify-between gap-1.5 font-normal"
        aria-label="Recordings and tests" title="What has not been stored yet, and the tests this project holds">
        <span className="flex min-w-0 items-center gap-1.5">
          {state.loadingDraft ? <LoaderCircleIcon className="shrink-0 animate-spin" /> : <HistoryIcon className="shrink-0" />}
          <span className="min-w-0 truncate">{label}</span>
        </span>
        <ChevronDownIcon className="shrink-0 transition-transform" style={{ transform: open ? "rotate(180deg)" : undefined }} />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="flex max-h-(--radix-popover-content-available-height) w-max min-w-[min(var(--radix-popover-trigger-width),var(--radix-popover-content-available-width))] max-w-(--radix-popover-content-available-width) flex-col gap-1 overflow-y-auto p-1 [&_button:not(:disabled)]:cursor-pointer" aria-label="Recordings and tests">
      <ListGroup label="Not stored" count={state.drafts.length} open={unstoredOpen}
        attributes={{ "data-testing-group": "unstored" }} onToggle={() => setUnstoredOpen(value => !value)}>
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
            <ConfirmDelete attributes={{ "data-testing-draft-delete": draft.id }} disabled={agentRecording && selected}
              title={selected ? "Delete this recording and clear the panel" : "Delete this recording"}
              label={`Delete ${draftLabel(draft)}`}
              question={selected
                ? `Delete “${draftLabel(draft)}” and clear the panel? Its ${draft.stepCount} step${draft.stepCount === 1 ? "" : "s"} cannot be brought back.`
                : `Delete “${draftLabel(draft)}”? Its ${draft.stepCount} step${draft.stepCount === 1 ? "" : "s"} cannot be brought back.`}
              onConfirm={() => void panel.deleteDraft(draft.id)} />
          </span>;
        })}
        {state.drafts.length === 0 && <p className="px-1.5 py-1 text-xs text-muted-foreground">Everything recorded here has been saved into the project.</p>}
        <Button type="button" variant="ghost" data-testing-draft-new disabled={agentRecording}
          className="h-auto min-h-7 justify-start rounded-md px-1.5 py-1 text-left font-normal"
          title="Keep what is on screen and start an empty flow."
          onClick={() => { setOpen(false); void panel.newRecording(); }}><FilePlus2Icon />New recording</Button>
      </ListGroup>

      <div className="-mx-1 border-t" />

      <ListGroup label="In the project" count={state.tests.length} open={storedOpen}
        attributes={{ "data-testing-group": "stored" }} onToggle={() => setStoredOpen(value => !value)}>
        {state.tests.map(stored => {
          return <span key={stored.relativePath} className="flex min-w-0 items-center gap-1" data-testing-test={stored.relativePath}>
            <span className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1" title={stored.relativePath}>
              <FileCode2Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{stored.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {stored.relativePath}{sinceLabel(stored.updatedAt) ? ` · ${sinceLabel(stored.updatedAt)}` : ""}
                </span>
              </span>
            </span>
            <ConfirmDelete attributes={{ "data-testing-test-delete": stored.relativePath }}
              busy={state.deletingTest === stored.relativePath}
              title="Delete this test from the project" label={`Delete ${stored.name}`}
              question={`Delete ${stored.relativePath} from the project? The file is removed and cannot be brought back from here.`}
              onConfirm={() => void panel.deleteTest(stored.relativePath)} />
          </span>;
        })}
        {state.tests.length === 0 && <p className="px-1.5 py-1 text-xs text-muted-foreground">No tests in this project's tests/ folder yet.</p>}
      </ListGroup>
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
function TestPreview({ source, run, highlightedLines, playUntil, onPlayUntil }: {
  source: string; run?: TestRunView; highlightedLines?: { from: number; to: number };
  /** Which step each line belongs to, so a line can be run up to. Empty when nothing can be run. */
  playUntil?: ReadonlyMap<number, { stepId: string; label: string }>;
  onPlayUntil?: (stepId: string) => void;
}) {
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
      // Play until here. Only on a line the runner executes: the imports, the comments and the
      // closing brace are not somewhere a run can stop, so they are not offered as one.
      const play = onPlayUntil ? playUntil?.get(index + 1) : undefined;
      return <span key={added ? `new-${generation}-${index}` : `line-${index}`} data-testing-preview-line={index + 1}
        className={`testing-preview-line${added ? " is-new" : ""}${highlighted ? " is-step-highlighted" : ""}`}>
        {/* Two columns: a fixed gutter and the code. That is why the code does not move when a run
            starts, and why a mark stays level with the first row of a line that wraps — the mark is
            a sibling of the whole line, not a character at the front of it.
            The run's own state is announced once, above the preview; a mark per line would read the
            whole file out. So the gutter is decoration, and `aria-hidden` throughout. */}
        {/* Only a tick fades. A failing mark is what says where the run broke, so it stays. */}
        {/* The file's own line numbers. They are what the runner's report, an error and this panel
            all point at, so reading one off the preview should not mean counting rows. Decoration
            like the mark beside them — announced nowhere — and outside the selection, so copying
            the preview gives the code and not a column of numbers with it. */}
        <span className="testing-preview-number" aria-hidden>{index + 1}</span>
        <span className={`testing-run-mark${mark ? ` is-${mark}` : ""}${run?.fading && mark === "passed" ? " is-fading" : ""}`} aria-hidden>
          {mark === "running" ? <LoaderCircleIcon className="size-3 animate-spin" />
            : mark === "passed" ? <CheckIcon className="size-3" />
              : mark === "failed" ? <CircleXIcon className="size-3" /> : null}
        </span>
        {/* The gutter holds one thing at a time: hovering a line swaps its mark for the play that
            runs the flow up to it, and the mark comes back when the pointer leaves. It is a real
            button rather than a click target on the line, so it is reachable by keyboard and says
            what it does — the mark beside it is decoration, this is not. */}
        {play && <button type="button" data-testing-play-until={index + 1} className="testing-play-until"
          title={`Run the test up to and including ${play.label}, and no further`}
          aria-label={`Run the test up to ${play.label}, line ${index + 1}`}
          onClick={() => onPlayUntil?.(play.stepId)}><PlayIcon className="size-3" /></button>}
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
  /**
   * The highlight goes the moment the pointer leaves the row, and a row that has already been left
   * cannot take it from the one the pointer is on now.
   *
   * What made leaving a step *re-light* its lines was never the clearing — it was the preview's
   * own arrival animation being cancelled while the line was highlighted and restarted when it no
   * longer was; see `.is-step-highlighted` in `style.css`. With that gone, clearing on the row's
   * own leave is exactly right. The guard stays because the browser dispatches the leave of one
   * row and the enter of the next together, and the order is not guaranteed to be the one the eye
   * follows: clearing only when the id still matches means the row under the pointer wins
   * whichever event lands last.
   */
  const hoverStep = useCallback((stepId: string | undefined) => setHoveredStep(stepId), []);
  const unhoverStep = useCallback((stepId: string) =>
    setHoveredStep(current => current === stepId ? undefined : current), []);
  const highlightedStep = hoveredStep ?? focusedStep;
  const spans = testRecorder.emitted.spans;
  const highlightedLines = spans.find(span => span.stepId === highlightedStep);
  /**
   * Which step each line of the preview came from, so a line can offer to run the flow up to it.
   *
   * Only the awaited calls, which are the lines the runner reports a step for. A step can carry a
   * TODO comment above its call, and a comment is not somewhere a run can stop: a play beside one
   * would promise a line the runner never executes. The gutter marks exactly these lines too, so
   * what offers to be run and what comes back marked are the same set.
   *
   * Nothing is built while a run is in flight — the gutter is the run's own then, and a second run
   * cannot start anyway.
   *
   * Built on every render, like the spans it reads: both are one pass over the steps, and the
   * file is re-emitted whenever those change, so there is nothing a memo could hold on to.
   */
  const playUntil = new Map<number, { stepId: string; label: string }>();
  if (state.run?.state !== "running") {
    // The app opening is the first thing the runner does and the first thing a flow breaks on, so
    // it is somewhere a run can stop too — the one line of the header that is a call at all.
    const open = testRecorder.emitted.calls[0];
    if (open !== undefined) playUntil.set(open, { stepId: OPEN_STEP, label: "the app opening" });
    for (const [index, span] of spans.entries()) {
      const step = state.steps[index];
      const label = step ? `step ${index + 1} (${step.label})` : `step ${index + 1}`;
      for (const line of span.calls) playUntil.set(line, { stepId: span.stepId, label });
    }
  }
  const playUntilStep = useCallback((stepId: string) => { void panel.runTest({ untilStepId: stepId }); }, [panel]);
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

    {/* The preview and the step list are dragged apart rather than fixed at 3fr/2fr: how much of
        the pane each deserves depends on the flow being written — a long file to read, or a long
        list to reorder — and that changes while one test is being recorded. The defaults are the
        panel's own share of the workspace: with the mirror at 25%, these are the 45% and 30% the
        preview and the steps get.
        A row at every width, with no stacked form. Stacking gave each pane 60% and 40% of the
        *height* left over under the mirror, which is how the three panes ended up at 60/22/16
        instead of 25/45/30; the panes have their own minimum widths, and the workspace keeps the
        mirror beside them wherever there is width for a row. */}
    <ResizablePanelGroup id="testing-workspace-panels" orientation="horizontal"
      data-testing-recorder-workspace className="min-h-0 flex-1 gap-3"
      aria-label="Preview and steps">
      <ResizablePanel id="testing-preview-resizable" defaultSize="60%" minSize="20%" maxSize="85%">
        <section data-testing-preview-pane className="flex h-full min-h-0 min-w-0 flex-col gap-1.5 overflow-hidden rounded-lg border p-3">
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
            {/* A verdict about part of the flow must not read as a verdict about the test: the run
                was asked to stop at a step, so what it passed is everything up to that line. */}
            {state.run?.untilLine !== undefined && <span data-testing-run-until className="font-normal text-muted-foreground"
              title="This run stops at the step you played to; the steps below it are not run.">· to line {state.run.untilLine}</span>}
            {/* The verdict is still about a run that happened; the lines it marked have moved. */}
            {state.run?.stale && <span data-testing-run-stale className="font-normal text-muted-foreground"
              title="The steps changed after this run, so the line marks no longer point at the same steps.">· before your edits</span>}
          </p>
          {state.run?.output && <pre className="max-h-32 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[10px] whitespace-pre-wrap">{state.run.output}</pre>}
          <TestPreview source={testRecorder.source} run={state.run} highlightedLines={highlightedLines}
            playUntil={playUntil} onPlayUntil={panel.canRun ? playUntilStep : undefined} />
        </section>
      </ResizablePanel>

      <ResizableHandle withHandle aria-label="Resize the preview and the steps" />

      <ResizablePanel id="testing-steps-resizable" defaultSize="40%" minSize="15%" maxSize="80%">
        <div data-testing-editor-pane className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden rounded-lg border p-3">
          <TestDescription panel={panel} saveable={saveable} />

          <div className="flex min-h-0 flex-1 flex-col gap-2 border-t pt-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-medium">Steps</h2>
              {state.steps.length > 0 && <span className="text-xs text-muted-foreground">{state.steps.length}</span>}
              <ClearStepsButton steps={state.steps.length} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1"><StepList steps={state.steps}
              onHoverStep={hoverStep} onUnhoverStep={unhoverStep} onFocusStep={setFocusedStep} /></div>
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
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>;
}

/**
 * What the test is called and where it is written, as one collapsible section.
 *
 * The two fields and Save used to sit permanently above the step list, taking a third of a pane
 * that is mostly used for the steps: they are touched once per recording — at the end — while the
 * list beside them is touched on every tap. Folded away they are one row, and the row says what is
 * inside it, so nothing is hidden from someone who has not opened it yet. It opens itself when
 * there is something to save and nothing has been written yet, which is exactly the moment the
 * fields are wanted.
 */
function TestDescription({ panel, saveable }: { panel: TestingPanel; saveable: boolean }) {
  const state = useSyncExternalStore(testRecorder.subscribe, testRecorder.getSnapshot);
  const panelState = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const [open, setOpen] = useState(false);
  return <section className="flex min-w-0 flex-col" aria-label="Test Description">
    <button type="button" data-testing-description-toggle aria-expanded={open}
      className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-left text-xs font-medium hover:bg-accent hover:text-accent-foreground"
      onClick={() => setOpen(value => !value)}>
      {open ? <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className="shrink-0">Test Description</span>
      {/* Closed, the row is the readout: the name the flow will be saved under, clipped at a width
          of its own so it degrades the same way wherever the pane ends. The file name is *not*
          here — at the width this pane actually gets, a name and a path side by side were two
          truncated strings reading as neither. The path is one click away, in the File name field
          below, which is where it is edited anyway. */}
      <span data-testing-description-title className="ml-auto min-w-0 max-w-[24ch] truncate font-normal text-muted-foreground"
        title={state.title.trim() || "Untitled flow"}>
        {state.title.trim() || "Untitled flow"}
      </span>
    </button>
    {open && <div data-testing-description className="grid gap-3 pt-2 lg:grid-cols-[minmax(0,3fr)_minmax(0,5fr)]">
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
    </div>}
  </section>;
}

/**
 * Clear, as an icon that asks first.
 *
 * It throws away every step of the flow on screen, and there is no undo: the steps are the whole
 * of what was recorded. It used to be one unguarded click of a button labelled "Clear", sitting at
 * the end of the same row as the step count. Now it is the icon alone, tinted like the destructive
 * thing it is, and the question names how much is about to go.
 */
function ClearStepsButton({ steps }: { steps: number }) {
  const [open, setOpen] = useState(false);
  const count = `${steps} step${steps === 1 ? "" : "s"}`;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button type="button" size="icon-xs" variant="ghost" data-testing-clear disabled={steps === 0}
        className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
        aria-label="Clear test" title="Clear every step of this test"><Trash2Icon /></Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="flex w-60 flex-col gap-2 p-2.5" role="alertdialog" aria-label="Clear test">
      <p className="text-xs">Clear all {count}? The recording cannot be brought back.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button type="button" size="sm" variant="destructive" data-testing-clear-confirm
          onClick={() => { setOpen(false); testRecorder.clearSteps(); }}>Clear</Button>
      </div>
    </PopoverContent>
  </Popover>;
}

/**
 * The recorded steps, in the order the file emits them.
 *
 * Every row is editable in place: a step can be dragged to another position, copied, or pointed at
 * a different command while keeping the element it named. All three go through the recorder, so
 * the numbering, the ambiguous badge and the preview are recomputed from one list rather than kept
 * in step by hand.
 */
function StepList({ steps, onHoverStep, onUnhoverStep, onFocusStep }: {
  steps: readonly RecordedStep[];
  onHoverStep: (stepId: string | undefined) => void;
  /** Clears the highlight, but only if this row is still the one holding it. */
  onUnhoverStep: (stepId: string) => void;
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
  // The rows own the highlight between them; the list adds nothing. An unconditional clear here
  // fires for the list *and* every ancestor leave, which is one more way for the highlight to be
  // taken from the row the pointer is actually on.
  return <ol className="flex flex-col gap-1 text-xs">
    {steps.map((step, index) => <li
      key={step.id}
      draggable
      data-testing-step={step.id}
      className={`group/step flex items-center gap-2 rounded-md border px-2 py-1.5 ${dragging === step.id ? "opacity-50" : ""} ${over === index && dragging !== step.id ? "border-primary" : ""}`}
      onMouseEnter={() => onHoverStep(step.id)}
      onMouseLeave={() => onUnhoverStep(step.id)}
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

/** How wide the step's command branch is: a list of short command names. */
const STEP_COMMANDS_WIDTH = 230;

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
  const offers = isAgentStep(step) ? [] : allStepOffers(step.selector, step.target);
  const close = () => setOpen(false);
  return <Popover open={open} onOpenChange={setOpen}>
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
      <MenuRow icon={<CopyIcon className="size-4 shrink-0 text-muted-foreground" />} attributes={{ "data-testing-step-duplicate": step.id }}
        title="Add a copy of this step at the end of the list"
        onClick={() => { close(); testRecorder.duplicateStep(step.id); }}>Duplicate</MenuRow>
      {/* The command list hangs *beside* this menu rather than replacing it, as every other
          cascading menu in the panel does. Replacing it took the step away from under the user and
          needed a Back row to undo itself; the branch keeps the row it came from on screen, so the
          trail from the step to the command reads in one glance. It opens on the left because the
          step list is the rightmost pane in the workspace: to the right is the window's edge, and
          to the left is the preview, which is where there is room for it. */}
      {!isAgentStep(step) && <Branch
        label={`Change command for step ${index + 1}`} width={STEP_COMMANDS_WIDTH} align="top" side="left"
        attributes={{ "data-element": "testing-step-commands", "data-testing-step-commands-panel": step.id }}
        renderRow={handlers => <MenuRow chevron icon={<OfferIcon kind={step.kind} />}
          attributes={{ "data-testing-step-commands": step.id }}
          title={`Currently ${OFFER_LABEL[step.kind]}`}
          onOpen={handlers.onOpen} onClick={handlers.onClick}>Change command</MenuRow>}
      >
        <StepCommandList commands={offers} onChoose={(kind, value) => { close(); testRecorder.changeStepCommand(step.id, kind, value); }} />
      </Branch>}
    </PopoverContent>
  </Popover>;
}
