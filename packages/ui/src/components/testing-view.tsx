import { useState, useSyncExternalStore } from "react";
import { CheckIcon, ChevronDownIcon, CircleIcon, EyeIcon, FolderOpenIcon, LoaderCircleIcon, PlayIcon, SaveIcon, SquareIcon, Trash2Icon, XIcon } from "lucide-react";
import type { DeviceAppsStore } from "../device-apps.ts";
import type { TestingPanel } from "../testing-panel.ts";
import { testRecorder } from "../test-recorder.ts";
import { testFileSlug } from "@mobile-dev/shared/test-recording.ts";
import { CODE_TOKEN_CLASS, highlightCode } from "../code-highlight.ts";
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
      <PopoverContent align="start" className="flex max-h-(--radix-popover-content-available-height) w-max min-w-[min(var(--radix-popover-trigger-width),var(--radix-popover-content-available-width))] max-w-(--radix-popover-content-available-width) flex-col gap-1 overflow-y-auto p-1" aria-label="Testing project">
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
  // Why the recorder cannot start yet, in the order the user has to fix them.
  const blocker = !state.projectPath ? "Choose a project to record against."
    : state.loadingProject ? ""
      : state.targets.length === 0 ? "No targets found in this project's e2e config."
        : !target?.bundleId ? `Target "${target?.name}" declares no bundleId, so there is no app to launch.`
          : !booted ? "Boot a simulator to record against it."
            : "";
  return <section className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3" aria-label="Testing">
    <header className="flex flex-wrap items-center gap-2">
      <TestingProjectPicker panel={panel} />
      {state.targets.length > 1 && <Select items={state.targets.map(entry => ({ value: entry.name, label: entry.name }))} value={state.targetName} onValueChange={value => { if (value) panel.selectTarget(value); }}>
        <SelectTrigger id="testing-target-select" size="sm" className="shrink-0" aria-label="Target"><SelectValue>{state.targetName || "Target"}</SelectValue></SelectTrigger>
        <SelectContent align="start"><SelectGroup>
          {state.targets.map(entry => <SelectItem key={entry.name} value={entry.name}>{entry.name}{entry.platform ? ` · ${entry.platform}` : ""}</SelectItem>)}
        </SelectGroup></SelectContent>
      </Select>}
      <Button type="button" size="sm" data-testing-launch disabled={!panel.canLaunch} onClick={() => void panel.launchApp()}>
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

    {state.projectPath && <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      <dt className="text-muted-foreground">Project</dt><dd className="truncate" title={state.projectPath}>{state.projectPath}</dd>
      {state.configPath && <><dt className="text-muted-foreground">Config</dt><dd className="truncate" title={state.configPath}>{state.configPath.split("/").at(-1)}</dd></>}
      {target && <><dt className="text-muted-foreground">Target</dt><dd className="truncate">{target.name}{target.platform ? ` · ${target.platform}` : ""}</dd></>}
      {target?.bundleId && <><dt className="text-muted-foreground">Bundle ID</dt><dd className="truncate">{target.bundleId}</dd></>}
      <dt className="text-muted-foreground">Device</dt><dd className="truncate">{device ? `${device.name ?? device.udid}${booted ? "" : " · not booted"}` : "None selected"}</dd>
    </dl>}

    {blocker && <p className="text-xs text-muted-foreground">{blocker}</p>}

    <TestingRecorder panel={panel} recordable={Boolean(booted && device && (device.platform ?? "ios") === "ios" && device.kind !== "physical")} udid={device?.udid ?? ""} />
  </section>;
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
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="flex flex-wrap items-center gap-2">
      {recording
        ? <Button type="button" size="sm" variant="outline" data-testing-stop onClick={() => testRecorder.stop()}><SquareIcon />Stop</Button>
        : <Button type="button" size="sm" variant="outline" data-testing-record disabled={!recordable} onClick={() => testRecorder.start(udid, panel.dirty)}><CircleIcon />Record</Button>}
      <Button type="button" size="sm" variant={state.assertMode ? "default" : "ghost"} data-testing-assert disabled={!recording}
        title="The next tap asserts that the element is visible instead of tapping it"
        onClick={() => testRecorder.setAssertMode(!state.assertMode)}><EyeIcon />Assert</Button>
      <Button type="button" size="sm" variant="ghost" data-testing-clear disabled={state.steps.length === 0} onClick={() => testRecorder.clearSteps()}><Trash2Icon />Clear</Button>
      {state.resolving && <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status"><LoaderCircleIcon className="animate-spin" />Reading the screen…</span>}
    </div>

    {!recordable && !recording && <p className="text-xs text-muted-foreground">Recording needs a booted iOS simulator in the mirror.</p>}
    {recording && <p className="text-xs text-muted-foreground">
      {state.assertMode ? "The next tap records an assertion and is not sent to the app." : "Tap the mirror. Each tap becomes a step."}
      {" Scroll over the outline to pick the element around it."}
    </p>}

    {state.error && <Alert variant="destructive">
      <AlertTitle>Recorder</AlertTitle>
      <AlertDescription>
        <span className="min-w-0 break-words">{state.error}</span>
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => testRecorder.dismissError()}>Dismiss</Button>
      </AlertDescription>
    </Alert>}

    <label className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Title</span>
      <input type="text" data-testing-title defaultValue={state.title} onBlur={event => testRecorder.setTitle(event.target.value)}
        className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1" aria-label="Test title" />
    </label>

    <ol className="flex flex-col gap-1 text-xs">
      {state.steps.map((step, index) => <li key={step.id} className="flex items-center gap-2 rounded-md border px-2 py-1" data-testing-step={step.id}>
        <span className="w-4 shrink-0 text-right text-muted-foreground">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate" title={step.label}>{step.label}</span>
        {step.ambiguous && <span className="shrink-0 text-amber-600" title="This matched more than one element. Add a testID to pin it.">ambiguous</span>}
        {step.selector.kind === "point" && <span className="shrink-0 text-amber-600" title="Nothing resolved here, so the test taps a coordinate.">coordinates</span>}
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove step ${index + 1}`} onClick={() => testRecorder.removeStep(step.id)}><XIcon /></Button>
      </li>)}
      {state.steps.length === 0 && <li className="text-muted-foreground">No steps yet.</li>}
    </ol>

    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">File</span>
      <code className="shrink-0 text-muted-foreground">tests/</code>
      <input type="text" data-testing-filename defaultValue={panelState.fileName} placeholder={`${testFileSlug(state.title)}.e2e.ts`}
        onBlur={event => panel.setFileName(event.target.value)} className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1" aria-label="Test file name" />
      <Button type="button" size="sm" data-testing-save disabled={!saveable} onClick={() => void panel.saveTest()}>
        {panelState.saving ? <LoaderCircleIcon className="animate-spin" /> : <SaveIcon />}Save
      </Button>
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

    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <p className="text-xs text-muted-foreground">Preview</p>
      <pre data-testing-preview className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed"><code>
        {highlightCode(testRecorder.source).map((token, index) =>
          token.kind === "plain"
            ? token.text
            : <span key={index} className={CODE_TOKEN_CLASS[token.kind]}>{token.text}</span>)}
      </code></pre>
    </div>
  </div>;
}
