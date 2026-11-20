import { useState, useSyncExternalStore, type DragEvent } from "react";
import { CheckCircle2Icon, FileJson2Icon, HardDriveIcon, LoaderCircleIcon, PlayIcon, UploadIcon } from "lucide-react";
import type { TraceSiftPanel } from "../tracesift-panel.ts";
import type { TraceSiftController } from "../tracesift-controller.ts";
import type { TraceSiftProfileType } from "@mobile-dev/shared/tracesift.ts";
import { TraceSiftCards } from "./tracesift-cards.tsx";
import { Button } from "./ui/button.tsx";

const options: { value: Extract<TraceSiftProfileType, "cpu" | "react">; title: string; detail: string; accepts: string; drop: string }[] = [
  { value: "cpu", title: "JavaScript CPU", detail: "Find slow functions and heavy execution paths", accepts: ".json", drop: "Chrome Performance .json" },
  { value: "react", title: "React components", detail: "Find expensive commits, wasted re-renders and cascades", accepts: "React DevTools JSON", drop: "React DevTools profiling .json" },
];

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

function TraceSiftUpload({ controller, available }: { controller: TraceSiftController; available: boolean }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [profileType, setProfileType] = useState<TraceSiftProfileType>("cpu");
  const analyzing = state.analyzing;
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
          <h2 id="tracesift-before-heading">Before you add a profile</h2>
          <dl>
            <div><dt><HardDriveIcon /> Local processing</dt><dd>Profiles stay on this machine.</dd></div>
            <div><dt><FileJson2Icon /> Supported file</dt><dd>{profileOption.accepts}</dd></div>
            <div><dt><CheckCircle2Icon /> Profile type</dt><dd>{profileOption.title}</dd></div>
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
