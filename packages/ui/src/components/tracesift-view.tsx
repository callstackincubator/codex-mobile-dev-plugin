import { useState, useSyncExternalStore, type DragEvent } from "react";
import { CheckCircle2Icon, FileJson2Icon, HardDriveIcon, LoaderCircleIcon, PlayIcon, UploadIcon } from "lucide-react";
import type { TraceSiftPanel } from "../tracesift-panel.ts";
import type { TraceSiftCaptureSource, TraceSiftController } from "../tracesift-controller.ts";
import type { TraceSiftProfileType, TraceSiftRnTarget } from "@mobile-dev/shared/tracesift.ts";
import { TraceSiftCards } from "./tracesift-cards.tsx";
import { Button } from "./ui/button.tsx";

const options: { value: Extract<TraceSiftProfileType, "cpu" | "react">; title: string; detail: string; accepts: string; drop: string }[] = [
  { value: "cpu", title: "JavaScript CPU", detail: "Find slow functions and heavy execution paths", accepts: ".json", drop: "Chrome Performance .json" },
  { value: "react", title: "React components", detail: "Find expensive commits, wasted re-renders and cascades", accepts: "React DevTools JSON", drop: "React DevTools profiling .json" },
];

/** React Native first: it is the one an agent can also drive, and the common case here. */
const sources: { value: TraceSiftCaptureSource; title: string }[] = [
  { value: "rn", title: "React Native" },
  { value: "chrome", title: "Web app" },
];

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
  return [target.title, target.deviceName].filter(Boolean).join(" — ");
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
 * One press, not the browser's two: nothing is launched and no window opens,
 * so there is no signed-in state to reach first. This never tells the person
 * to open anything — if no app is connected, the app is theirs to start and
 * the pane only offers to look again.
 */
function ReactNativePane({ controller, capture, busy }: { controller: TraceSiftController; capture: CaptureState; busy: boolean }) {
  const { step, targets, targetId, metro, targetsError, loadingTargets } = capture;
  const recording = step === "recording" || step === "stopping";
  const working = step === "starting" || step === "stopping";
  const selected = targets.find(target => target.id === targetId) ?? targets[0];
  const where = metro || "the Metro dev server";

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
    return <div className="capture-row">
      <p className="capture-status" role="status">
        {targetsError || (loadingTargets
          ? `Looking for apps on ${where} and for a release build…`
          : `No React Native app found. Start a debug build so it connects to ${where}, or a profiling build made with \`tracesift profile build\`, then refresh.`)}
      </p>
      <button type="button" className="capture-close" disabled={busy || loadingTargets} onClick={() => void controller.loadReactNativeTargets()}>
        {loadingTargets ? "Looking…" : "Refresh"}
      </button>
    </div>;
  }

  return <div className="capture-row">
    {targets.length > 1
      ? <select
        className="capture-target"
        aria-label="React Native app to record"
        value={selected?.id ?? ""}
        disabled={busy || working}
        onChange={event => controller.setCaptureTarget(event.target.value)}
      >
        {targets.map(target => <option key={target.id} value={target.id}>{targetLabel(target)}</option>)}
      </select>
      : <p className="capture-status">{selected ? targetLabel(selected) : ""}<small>{targetWhere(selected, metro)}</small></p>}
    <button type="button" className="capture-button" disabled={busy || working} onClick={() => void controller.startReactNativeCapture()}>
      {step === "starting" ? "Starting…" : "Start profile"}
    </button>
    <button type="button" className="capture-close" disabled={busy || working || loadingTargets} onClick={() => void controller.loadReactNativeTargets()}>
      {loadingTargets ? "Looking…" : "Refresh"}
    </button>
  </div>;
}

/**
 * Record a running app instead of reading a profile someone already has.
 *
 * The web route takes two presses: Chrome opens first and the recording starts
 * when the person says so, because the state worth profiling is usually behind
 * a sign-in or a few clicks, and a trace that began at page load would be
 * mostly the sign-in. React Native takes one, because the app is already
 * running. Stopping analyzes what was recorded either way.
 */
function CapturePane({ controller, busy }: { controller: TraceSiftController; busy: boolean }) {
  const { capture } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { step, source } = capture;
  const working = step === "launching" || step === "starting" || step === "stopping" || step === "closing";
  const open = step !== "idle" && step !== "launching";
  // Switching sources mid-recording would leave a live recorder with no
  // control pointed at it.
  const live = open || working;

  return <div className="capture-pane">
    <div className="capture-sources" role="radiogroup" aria-label="What to record">
      {sources.map(option => <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={source === option.value}
        disabled={busy || live}
        className={`profile-chip${source === option.value ? " selected" : ""}`}
        onClick={() => controller.setCaptureSource(option.value)}
      >
        {option.title}
      </button>)}
    </div>
    {source === "rn"
      ? <ReactNativePane controller={controller} capture={capture} busy={busy} />
      : !open
      ? <div className="capture-row">
        <input
          type="url"
          className="capture-url"
          placeholder="https://localhost:3000"
          aria-label="Web app address to record"
          value={capture.url}
          disabled={busy || working}
          onChange={event => controller.setCaptureUrl(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") void controller.launchCapture(); }}
        />
        <button type="button" className="capture-button" disabled={busy || working} onClick={() => void controller.launchCapture()}>
          {step === "launching" ? "Opening Chrome…" : "Launch web app"}
        </button>
      </div>
      : <div className="capture-row">
        <p className="capture-status" role="status">
          {step === "recording" || step === "stopping"
            ? "Recording. Use the app, then stop."
            : "Chrome is open. Sign in or navigate, then start."}
        </p>
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
      </div>}
    {capture.error && <p className="tracesift-error" role="alert">{capture.error}</p>}
  </div>;
}

function TraceSiftUpload({ controller, available }: { controller: TraceSiftController; available: boolean }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [profileType, setProfileType] = useState<TraceSiftProfileType>("cpu");
  const [mode, setMode] = useState<WorkMode>("record");
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
        <h1 className="results-title">Analyze a profile</h1>
        <p>Profiles are processed locally. Nothing leaves this machine.</p>
      </div>
    </div>

    <div className="tracesift-workspace">
      <section className={`tracesift-workflow${ready ? "" : " is-disabled"}`} aria-label="Profile analysis">
        {setup && <p className="tracesift-blocker" role="status">Finish setup to add a profile</p>}
        {!available && <p className="tracesift-error" role="status">This host cannot call the plugin's TraceSift tools.</p>}

        <div className="tracesift-modes" role="radiogroup" aria-label="How to add a profile">
          {modes.map(option => <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={mode === option.value}
            // Switching away mid-recording would strand a live recorder.
            disabled={!ready || Boolean(analyzing) || (capturing && option.value !== mode)}
            title={option.detail}
            className={`tracesift-mode${mode === option.value ? " selected" : ""}`}
            onClick={() => setMode(option.value)}
          >
            {option.title}
          </button>)}
        </div>

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
          <div className="workflow-label"><span>1</span><strong>Choose what to record</strong><small>JavaScript CPU, captured locally.</small></div>
          {analyzing
            ? <p className="upload-analyzing" role="status">Analyzing {analyzing.name} with TraceSift…</p>
            : <CapturePane controller={controller} busy={!ready} />}
          <p className="tracesift-notice">Source maps are generated automatically on iOS. On Android they are only produced if the app is configured for it.</p>
        </>}
      </section>

      <aside className="tracesift-inspector" aria-live="polite">
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
          <dl>
            <div><dt><HardDriveIcon /> Local processing</dt><dd>Profiles stay on this machine.</dd></div>
            {mode === "record"
              ? <>
                <div><dt><FileJson2Icon /> Captured</dt><dd>JavaScript CPU samples</dd></div>
                <div><dt><CheckCircle2Icon /> Needs</dt><dd>The app already running</dd></div>
              </>
              : <>
                <div><dt><FileJson2Icon /> Supported file</dt><dd>{profileOption.accepts}</dd></div>
                <div><dt><CheckCircle2Icon /> Profile type</dt><dd>{profileOption.title}</dd></div>
              </>}
          </dl>
          <a href="https://github.com/callstackincubator/tracesift" target="_blank" rel="noreferrer">Read about TraceSift</a>
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
