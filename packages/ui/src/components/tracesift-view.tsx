import { useEffect, useState, useSyncExternalStore, type DragEvent } from "react";
import { CheckCircle2Icon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon, CircleDotIcon, FileJson2Icon, FolderOpenIcon, HardDriveIcon, LoaderCircleIcon, MonitorSmartphoneIcon, PlayIcon, RocketIcon, SmartphoneIcon, UploadIcon } from "lucide-react";
import type { TraceSiftPanel } from "../tracesift-panel.ts";
import type { TraceSiftController, TraceSiftRunTarget } from "../tracesift-controller.ts";
import type { TraceSiftProfileType, TraceSiftRnTarget } from "@mobile-dev/shared/tracesift.ts";
import { TraceSiftCards } from "./tracesift-cards.tsx";
import { Button } from "./ui/button.tsx";
import { Tabs, TabsList, TabsTrigger } from "./ui/base-tabs.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";

const options: { value: Extract<TraceSiftProfileType, "cpu" | "react">; title: string; detail: string; accepts: string; drop: string }[] = [
  { value: "cpu", title: "JavaScript CPU", detail: "Find slow functions and heavy execution paths", accepts: ".json", drop: "Chrome Performance .json" },
  { value: "react", title: "React components", detail: "Find expensive commits, wasted re-renders and cascades", accepts: "React DevTools JSON", drop: "React DevTools profiling .json" },
];

/** Whether the "Before you record" details are collapsed. localStorage can be blocked, so this is best effort. */
const DETAILS_HIDDEN_KEY = "tracesift.detailsHidden";
function readDetailsHidden() { try { return globalThis.localStorage?.getItem(DETAILS_HIDDEN_KEY) === "1"; } catch { return false; } }
function writeDetailsHidden(hidden: boolean) { try { globalThis.localStorage?.setItem(DETAILS_HIDDEN_KEY, hidden ? "1" : "0"); } catch { /* Keep the in-memory value. */ } }

/**
 * Recording and uploading are two ways to reach the same cards, so they share
 * the one panel rather than stacking: only one is in use at a time, and the
 * second half of the page was easy to miss below the fold.
 */
type WorkMode = "record" | "upload";
const modes: { value: WorkMode; title: string; detail: string }[] = [
  { value: "record", title: "Record", detail: "Profile an app that is running now" },
  { value: "upload", title: "Upload", detail: "Analyze a profile you already have" },
];

type CaptureState = ReturnType<TraceSiftController["getSnapshot"]>["capture"];

// A dropped file arrives without a path and the local service reads from disk, so the pane asks the host for its own dialog.
function UploadPane({ controller, profileType, busy }: { controller: TraceSiftController; profileType: TraceSiftProfileType; busy: boolean }) {
  const [dragging, setDragging] = useState(false);
  const [dropNotice, setDropNotice] = useState("");
  const option = options.find(entry => entry.value === profileType) ?? options[0];

  const drop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    // Only some hosts expose a real path on the file; without one there is nothing to analyze.
    const path = (file as File & { path?: string }).path;
    if (typeof path === "string" && path !== "") { void controller.analyze(path, profileType); return; }
    setDropNotice(`${file.name} cannot be read from a drop here. Click to choose it from disk.`);
  };

  return <>
    <button
      type="button"
      className={`upload-pane${dragging && !busy ? " is-dragging" : ""}${busy ? " is-disabled" : ""}`}
      disabled={busy}
      onDragEnter={event => { event.preventDefault(); if (!busy) setDragging(true); }}
      onDragOver={event => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
      onClick={() => { setDropNotice(""); void controller.pickAndAnalyze(profileType); }}
    >
      <span className="upload-icon"><UploadIcon /></span>
      <span className="upload-title">Drop a {option.title} profile</span>
      <span className="upload-detail">{option.drop}</span>
      <span className="browse-button">Choose file</span>
    </button>
    {dropNotice && <p className="tracesift-notice" role="status">{dropNotice}</p>}
  </>;
}

/**
 * What the pane says a React Native target is, without claiming an engine the
 * inspector did not name.
 */
function targetLabel(target: TraceSiftRnTarget) {
  const kind = target.deviceKind === "simulator" ? "Simulator" : target.deviceKind === "device" ? "Device" : target.deviceKind === "emulator" ? "Emulator" : "";
  const where = [kind, target.deviceName].filter(Boolean).join(" ");
  return [target.title, where].filter(Boolean).join(" — ");
}

const DEVICE_KINDS: Record<string, string> = { simulator: "Simulator", device: "Device", emulator: "Emulator" };

/** The device is what a row is chosen by, so it leads; the app id is the detail under it. */
function deviceTitle(target: TraceSiftRnTarget) {
  const kind = target.deviceKind ? DEVICE_KINDS[target.deviceKind] : undefined;
  return [target.deviceName, kind].filter(Boolean).join(" · ") || target.title;
}

/** The app on that device, and which build it is: a release build and a Metro one record differently. */
function appLine(target: TraceSiftRnTarget, metro: string) {
  const build = target.transport === "release"
    ? target.port ? `release build on port ${target.port}` : "release build"
    : metro ? `Metro on ${metro}` : "Metro";
  return [target.appId ?? target.title, build].filter(Boolean).join(" · ");
}

/**
 * Where a target was found, which is not a detail: it tells the person which
 * build they are about to profile, and the two answers behave differently.
 */
function targetWhere(target: TraceSiftRnTarget | undefined, metro: string) {
  if (target?.transport === "release") return target.port ? ` · release build on port ${target.port}` : " · release build";
  return metro ? ` · Metro on ${metro}` : "";
}

/**
 * Record the React Native app that is already running.
 *
 * A running React Native app can be recorded directly. The setup flow above
 * handles preparing and launching a profiling build when none is connected.
 */
function ReactNativePane({ controller, capture, busy }: { controller: TraceSiftController; capture: CaptureState; busy: boolean }) {
  const { step, targets, targetId, metro, loadingTargets } = capture;
  const recording = step === "recording" || step === "stopping";
  const working = step === "starting" || step === "stopping";
  const selected = targets.find(target => target.id === targetId) ?? targets[0];

  if (recording) {
    return <div className="capture-row">
      <p className="capture-status" role="status">
        Recording{selected ? ` ${targetLabel(selected)}` : ""}. Use the app, then stop.
      </p>
      <button type="button" className="capture-button is-recording" disabled={busy || step === "stopping"} onClick={() => void controller.stopCapture()}>
        {step === "stopping" ? "Writing the trace…" : "Stop and analyze"}
      </button>
    </div>;
  }

  if (!targets.length) {
    return <div className="capture-row capture-empty">
      <p className="capture-status" role="status">
        {loadingTargets
          ? "Looking for running apps…"
          : "Follow the steps above to prepare and run a profiling app, then refresh."}
      </p>
      <button type="button" className="capture-close" disabled={busy || loadingTargets} onClick={() => void controller.loadReactNativeTargets()}>
        {loadingTargets ? "Looking…" : "Refresh"}
      </button>
    </div>;
  }

  // One row per place the app is running, device first: the Hermes sampler is
  // process-global, so exactly one of them can be recorded at a time.
  return <div className="capture-pick">
    <div className="capture-devices" role="radiogroup" aria-label="Device to profile">
      {targets.map(target => {
        const chosen = target.id === selected?.id;
        return <button
          key={target.id}
          type="button"
          role="radio"
          aria-checked={chosen}
          data-capture-target={target.id}
          className={`capture-device${chosen ? " selected" : ""}`}
          disabled={busy || working}
          onClick={() => controller.setCaptureTarget(target.id)}
        >
          <span className="capture-device-mark" aria-hidden="true" />
          <span className="capture-device-text">
            <strong>{deviceTitle(target)}</strong>
            <small>{appLine(target, metro)}</small>
          </span>
        </button>;
      })}
    </div>
    <div className="capture-actions">
      <button type="button" className="capture-button" disabled={busy || working || !selected} onClick={() => void controller.startReactNativeCapture()}>
        {step === "starting" ? "Starting…" : "Start profile"}
      </button>
      <button type="button" className="capture-close" disabled={busy || working || loadingTargets} onClick={() => void controller.loadReactNativeTargets()}>
        {loadingTargets ? "Looking…" : "Refresh"}
      </button>
    </div>
  </div>;
}

/** Record a running React Native app. An already active browser session stays controllable until it ends. */
function CapturePane({ controller, busy }: { controller: TraceSiftController; busy: boolean }) {
  const { capture } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { step, source } = capture;
  const working = step === "launching" || step === "starting" || step === "stopping" || step === "closing";
  const legacyBrowserSession = source === "chrome" && step !== "idle";

  return <div className="capture-pane">
    {legacyBrowserSession
      ? <div className="capture-row">
        <p className="capture-status" role="status">{step === "recording" || step === "stopping"
          ? "Recording. Use the app, then stop."
          : "Chrome is open. Sign in or navigate, then start."}</p>
        {step === "recording" || step === "stopping"
          ? <button type="button" className="capture-button is-recording" disabled={busy || step === "stopping"} onClick={() => void controller.stopCapture()}>
            {step === "stopping" ? "Writing the trace…" : "Stop and analyze"}
          </button>
          : <button type="button" className="capture-button" disabled={busy || working} onClick={() => void controller.startCapture()}>
            {step === "starting" ? "Starting…" : "Start profile"}
          </button>}
        <button type="button" className="capture-close" disabled={busy || working || step === "recording"} onClick={() => void controller.closeCapture()}>
          {step === "closing" ? "Closing…" : "Close browser"}
        </button>
      </div>
      : <ReactNativePane controller={controller} capture={capture} busy={busy} />}
    {capture.error && <p className="tracesift-error" role="alert">{capture.error}</p>}
  </div>;
}

const folderName = (path: string) => path.split("/").filter(Boolean).at(-1) || path;

// A real phone gets the phone; a simulator or emulator gets the screen. An
// Android row is either, so it is told apart by adb's own serial.
const runTargetIcon = (target: TraceSiftRunTarget) =>
  target.kind === "device" || (target.kind === "android" && target.id !== undefined && !target.id.startsWith("emulator-"))
    ? <SmartphoneIcon />
    : <MonitorSmartphoneIcon />;

/** Prepare a profiling build in order, then choose the device from the Run popover. */
function RunWithTraceSift({ controller, busy }: { controller: TraceSiftController; busy: boolean }) {
  const { run } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { setup } = run;
  const working = run.checking || run.installing || run.pickingProject;
  return <div className="tracesift-run-steps">
    <div className="tracesift-run-step">
      <span className="tracesift-step-index">1</span>
      <div className="tracesift-run-step-content"><strong>Select project</strong><small>Choose the React Native app to profile.</small></div>
      <Button type="button" variant="outline" size="sm" className="min-w-0 max-w-56 gap-1.5" data-project-picker
        aria-label="TraceSift project" title={run.projectPath || "Choose a React Native project"}
        disabled={busy || working || Boolean(run.building)} onClick={() => void controller.pickRunProject()}>
        {run.pickingProject ? <LoaderCircleIcon className="tracesift-command-spinner" /> : <FolderOpenIcon />}
        <span className="min-w-0 truncate">{run.projectPath ? folderName(run.projectPath) : "Choose project"}</span>
      </Button>
    </div>
    {run.checking && <p className="tracesift-run-progress" role="status"><LoaderCircleIcon className="tracesift-command-spinner" /> Checking the project…</p>}
    {setup && !setup.installed && <div className="tracesift-run-step">
      <span className="tracesift-step-index">2</span>
      <div className="tracesift-run-step-content"><strong>Install TraceSift profiler</strong><small><code>{setup.command}</code></small></div>
      <Button type="button" variant="outline" size="sm" disabled={busy || working || Boolean(run.building)} onClick={() => void controller.installRunProfiler()}>
        {run.installing ? <LoaderCircleIcon className="tracesift-command-spinner" /> : <PlayIcon />}
        {run.installing ? "Installing…" : "Install"}
      </Button>
    </div>}
    {run.projectPath && <div className="tracesift-run-step">
      <span className="tracesift-step-index">{setup?.installed ? "2" : "3"}</span>
      <div className="tracesift-run-step-content"><strong>Run with TraceSift</strong><small>Build and install on a connected device.</small></div>
      <Popover open={run.open} onOpenChange={open => { if (open) void controller.openRun(); else controller.closeRun(); }}>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" className="tracesift-primary-action" disabled={busy || working || !setup?.installed || Boolean(run.building)}>
            {run.building ? <LoaderCircleIcon className="tracesift-command-spinner" /> : <RocketIcon />}
            {run.building ? "Building…" : "Run with TraceSift"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="tracesift-run-popup flex w-96 max-w-(--radix-popover-content-available-width) flex-col gap-2 p-3" aria-label="Run with TraceSift">
          <p className="text-xs font-medium">Run on</p>
          {run.targets.length === 0 && <p className="text-xs text-muted-foreground">No iOS or Android target found. Connect a device or boot a simulator, then reopen this menu.</p>}
          {run.targets.map(target => <Button key={`${target.platform}:${target.id ?? target.kind}`} type="button" variant="ghost"
            className="h-auto min-h-7 justify-start gap-2 px-1.5 py-1 text-left font-normal" data-run-target={target.id ?? target.kind}
            disabled={Boolean(run.building)} onClick={() => void controller.buildForTarget(target)}>
            {runTargetIcon(target)}
            <span className="flex min-w-0 flex-col"><span className="truncate">{target.name}</span>
              <span className="truncate text-xs text-muted-foreground">{target.kind === "device" ? "Device" : target.kind === "simulator" ? "Simulator" : "Android"} · {target.note}</span></span>
          </Button>)}
          {setup?.platforms.includes("ios") && !run.targets.some(target => target.platform === "ios") && <p className="text-xs text-muted-foreground">No booted iOS simulator or connected iPhone.</p>}
        </PopoverContent>
      </Popover>
    </div>}
    {run.building && <p className="tracesift-run-progress" role="status"><LoaderCircleIcon className="tracesift-command-spinner" /> Building for {run.building.name}. This can take several minutes.</p>}
    {run.error && <p className="tracesift-error whitespace-pre-wrap break-words" role="alert">{run.error}</p>}
  </div>;
}

function TraceSiftUpload({ controller, available }: { controller: TraceSiftController; available: boolean }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => { void controller.loadRunProject().then(() => controller.checkRun()); }, [controller]);
  useEffect(() => {
    if (state.capture.source === "chrome" && state.capture.step === "idle") controller.setCaptureSource("rn");
  }, [controller, state.capture.source, state.capture.step]);
  const [profileType, setProfileType] = useState<TraceSiftProfileType>("cpu");
  const [mode, setMode] = useState<WorkMode>("record");
  const [detailsHidden, setDetailsHidden] = useState(readDetailsHidden);
  const [buildExpanded, setBuildExpanded] = useState(true);
  const [runningExpanded, setRunningExpanded] = useState(true);
  useEffect(() => {
    if (state.run.notice) { setBuildExpanded(false); setRunningExpanded(true); }
  }, [state.run.notice]);
  const toggleDetails = () => setDetailsHidden(hidden => { writeDetailsHidden(!hidden); return !hidden; });
  const analyzing = state.analyzing;
  const capturing = state.capture.step !== "idle";
  const ready = state.readiness?.status === "ready";
  const setup = state.readiness?.status === "setup_required" ? state.readiness : undefined;
  const setupBusy = state.setupAction !== undefined;

  const controlsDisabled = setupBusy || state.checkingReadiness;
  const profileOption = options.find(option => option.value === profileType) ?? options[0];
  const command = (step: number, title: string, text: string, action: "install" | "init", label: string) => <div className="tracesift-setup-step">
    <div className="tracesift-setup-step-label"><span>{step}</span><strong>{title}</strong></div>
    <div className="tracesift-command">
      <code>{text}</code>
      <Button
        type="button" size="icon-sm" variant="ghost"
        aria-label={label} title={label}
        disabled={controlsDisabled}
        onClick={() => void controller.runSetup(action)}
      >
        {state.setupAction === action ? <LoaderCircleIcon className="tracesift-command-spinner" /> : <PlayIcon />}
      </Button>
    </div>
  </div>;

  return <main className="tracesift-upload">
    <div className="results-header">
      <div className="intro">
        <span className="eyebrow">TraceSift</span>
        <h1 className="results-title">{mode === "record" ? "Record a profile" : "Analyze an existing profile"}</h1>
        <p>{mode === "record" ? "Capture JavaScript CPU activity from a running app." : "Choose a profile type, then add a local file."}</p>
      </div>
    </div>

    <div className="tracesift-workspace" data-inspector={detailsHidden ? "hidden" : "shown"}>
      <button
        type="button"
        className="tracesift-inspector-toggle"
        aria-expanded={!detailsHidden}
        aria-controls="tracesift-inspector"
        aria-label={detailsHidden ? "Show TraceSift metadata" : "Hide TraceSift metadata"}
        title={detailsHidden ? "Show TraceSift metadata" : "Hide TraceSift metadata"}
        onClick={toggleDetails}
      >
        {detailsHidden ? <ChevronLeftIcon /> : <ChevronRightIcon />}
      </button>
      <section className={`tracesift-workflow${ready ? "" : " is-disabled"}`} aria-label="Profile analysis">
        {setup && <p className="tracesift-blocker" role="status">Finish setup to add a profile</p>}
        {!available && <p className="tracesift-error" role="status">This host cannot call the plugin's TraceSift tools.</p>}

        <Tabs value={mode} onValueChange={value => setMode(value as WorkMode)}>
          <TabsList aria-label="How to add a profile" className="mx-auto h-11 w-full max-w-[720px]">
            {modes.map(option => <TabsTrigger
              key={option.value}
              value={option.value}
              // Switching away mid-recording would strand a live recorder.
              disabled={!ready || Boolean(analyzing) || (capturing && option.value !== mode)}
              title={option.detail}
              className="gap-2 text-sm font-semibold"
            >
              {option.value === "record" ? <CircleDotIcon /> : <UploadIcon />}
              {option.title}
            </TabsTrigger>)}
          </TabsList>
        </Tabs>

        {mode === "upload" ? <>
          <div className="workflow-label"><span>1</span><strong>Choose a profile type</strong></div>
          <div className="profile-options" role="radiogroup" aria-label="Profile type">
            {options.map(option => <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={profileType === option.value}
              disabled={!ready || Boolean(analyzing)}
              title={option.detail}
              className={`profile-chip${profileType === option.value ? " selected" : ""}`}
              onClick={() => setProfileType(option.value)}
            >
              <span><strong>{option.title}</strong><em>{option.accepts}</em></span>
              <small>{option.detail}</small>
            </button>)}
          </div>

          <div className="workflow-label"><span>2</span><strong>Add a profile</strong><small>Processed locally, never uploaded.</small></div>
          {analyzing
            ? <p className="upload-analyzing" role="status">Analyzing {analyzing.name} with TraceSift…</p>
            : <UploadPane controller={controller} profileType={profileType} busy={!ready} />}
        </> : <>
          {/* Recording yields JS CPU samples only: a React profile comes out of
              React DevTools, which this cannot drive. */}
          <div className="tracesift-record-intro"><span className="tracesift-rn-badge">React Native</span><span>JavaScript CPU · captured locally</span></div>
          <section className="tracesift-record-section">
            <button type="button" className="tracesift-record-section-toggle" aria-expanded={buildExpanded} aria-controls="tracesift-build-steps" onClick={() => { if (buildExpanded) controller.closeRun(); setBuildExpanded(value => !value); }}>
              <span className="workflow-label"><span>1</span><strong>Prepare a profiling build</strong>{state.run.building && <small>Building for {state.run.building.name}…</small>}</span>
              {buildExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
            </button>
            {buildExpanded && <div id="tracesift-build-steps" className="tracesift-record-section-body">
              <p className="tracesift-section-hint">Choose a project, install the profiler if needed, then build and run it.</p>
              <RunWithTraceSift controller={controller} busy={!ready || Boolean(analyzing)} />
            </div>}
          </section>
          <section className="tracesift-record-section">
            <button type="button" className="tracesift-record-section-toggle" aria-expanded={runningExpanded} aria-controls="tracesift-running-app" onClick={() => setRunningExpanded(value => !value)}>
              <span className="workflow-label"><span>2</span><strong>Select a running app</strong></span>
              {runningExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
            </button>
            {runningExpanded && <div id="tracesift-running-app" className="tracesift-record-section-body">
              {state.run.notice && <p className="tracesift-notice" role="status">{state.run.notice}</p>}
              {analyzing
                ? <p className="upload-analyzing" role="status">Analyzing {analyzing.name} with TraceSift…</p>
                : <CapturePane controller={controller} busy={!ready} />}
            </div>}
          </section>
          <p className="tracesift-notice">Source maps are generated automatically on iOS. On Android they are only produced if the app is configured for it.</p>
        </>}
      </section>

      <aside id="tracesift-inspector" className="tracesift-inspector" aria-live="polite" aria-hidden={detailsHidden}>
        {available && state.checkingReadiness && <div className="tracesift-inspector-status" role="status">
          <LoaderCircleIcon className="tracesift-command-spinner" /> Checking TraceSift setup…
        </div>}
        {available && !state.checkingReadiness && setup && <section className="tracesift-setup" aria-labelledby="tracesift-setup-heading">
          <div>
            <h2 id="tracesift-setup-heading">TraceSift setup</h2>
            <p className="tracesift-action-required">Action required</p>
          </div>
          <p>{setup.message}</p>
          <div className="tracesift-commands">
            {setup.reason === "missing_cli" && command(1, "Install TraceSift", "npm install -g @callstack/tracesift", "install", "Install the TraceSift CLI")}
            {(setup.reason === "missing_cli" || setup.reason === "needs_init") && command(2, "Initialize service", "tracesift init", "init", "Initialize TraceSift")}
          </div>
          {state.setupNotice && <p className="tracesift-notice" role="status">{state.setupNotice}</p>}
          <div className="tracesift-setup-actions">
            <Button type="button" size="sm" disabled={controlsDisabled} onClick={() => void controller.checkReadiness()}>Check again</Button>
            <a
              href="https://github.com/callstackincubator/tracesift#usage"
              target="_blank"
              rel="noreferrer"
              aria-disabled={controlsDisabled}
              tabIndex={controlsDisabled ? -1 : undefined}
              onClick={event => { if (controlsDisabled) event.preventDefault(); }}
            >Installation guide</a>
          </div>
        </section>}
        {available && !state.checkingReadiness && ready && <section className="tracesift-before" aria-labelledby="tracesift-before-heading">
          <p className="tracesift-ready" role="status"><CheckCircle2Icon /> TraceSift ready</p>
          <h2 id="tracesift-before-heading">{mode === "record" ? "Before you record" : "Before you add a profile"}</h2>
          <div id="tracesift-details"><dl>
            <div><dt><HardDriveIcon /> Local processing</dt><dd>Profiles stay on this machine.</dd></div>
            {mode === "record"
              ? <>
                <div><dt><FileJson2Icon /> Captured</dt><dd>JavaScript CPU samples</dd></div>
                <div><dt><CheckCircle2Icon /> Requires</dt><dd>A profileable running app</dd></div>
              </>
              : <>
                <div><dt><FileJson2Icon /> Supported file</dt><dd>{profileOption.accepts}</dd></div>
                <div><dt><CheckCircle2Icon /> Profile type</dt><dd>{profileOption.title}</dd></div>
              </>}
          </dl>
          <a href="https://github.com/callstackincubator/tracesift" target="_blank" rel="noreferrer">Read about TraceSift</a></div>
        </section>}
        {!available && <p className="tracesift-inspector-status">TraceSift tools unavailable</p>}
      </aside>
    </div>

    {state.setupNotice && !setup && <p className="tracesift-notice" role="status">{state.setupNotice}</p>}
    {state.error && <p className="tracesift-error" role="alert">{state.error}</p>}
  </main>;
}

export function TraceSiftView({ panel }: { panel: TraceSiftPanel }) {
  const { controller } = panel;
  const { available } = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  if (state.analysis || state.explorer) return <TraceSiftCards controller={controller} onReset={controller.reset} />;
  return <TraceSiftUpload controller={controller} available={available} />;
}
