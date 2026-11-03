import { useState, useSyncExternalStore, type DragEvent } from "react";
import { UploadIcon } from "lucide-react";
import type { TraceSiftPanel } from "../tracesift-panel.ts";
import type { TraceSiftController } from "../tracesift-controller.ts";
import type { TraceSiftProfileType } from "@mobile-dev/shared/tracesift.ts";
import { TraceSiftCards } from "./tracesift-cards.tsx";

const options: { value: Extract<TraceSiftProfileType, "cpu" | "react">; title: string; detail: string; accepts: string; drop: string }[] = [
  { value: "cpu", title: "JavaScript CPU", detail: "Find slow functions and heavy execution paths", accepts: ".json", drop: "Choose a Chrome Performance .json" },
  { value: "react", title: "React components", detail: "Find expensive commits, wasted re-renders and cascades", accepts: "React DevTools JSON", drop: "Choose a React DevTools profiling .json" },
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
      <span className="upload-title">{option.title} profile</span>
      <span className="upload-detail">{option.drop}</span>
      <span className="browse-button">Browse files</span>
    </button>
    {dropNotice && <p className="tracesift-notice" role="status">{dropNotice}</p>}
  </>;
}

/**
 * Record a running web app instead of reading a profile someone already has.
 *
 * Two presses, not one: Chrome opens first and the recording starts when the
 * person says so, because the state worth profiling is usually behind a sign-in
 * or a few clicks, and a trace that began at page load would be mostly the
 * sign-in. Stopping analyzes what was recorded and leaves the browser open for
 * the next one.
 */
function CapturePane({ controller, busy }: { controller: TraceSiftController; busy: boolean }) {
  const { capture } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { step } = capture;
  const working = step === "launching" || step === "starting" || step === "stopping" || step === "closing";
  const open = step !== "idle" && step !== "launching";

  return <div className="capture-pane">
    {!open
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
  const analyzing = state.analyzing;

  return <main className="tracesift-upload">
    <div className="results-header">
      <div className="intro">
        <span className="eyebrow">TraceSift</span>
        <h1 className="results-title">Analyze a profile</h1>
        <p>Profiles are read by the local TraceSift service. Nothing leaves this machine.</p>
      </div>
    </div>

    {!available && <p className="tracesift-error" role="status">This host cannot call the plugin's TraceSift tools.</p>}

    <div className="profile-row">
      <div className="workflow-label"><span>1</span><strong>Choose a profile type</strong></div>
      <div className="profile-options" role="radiogroup" aria-label="Profile type">
        {options.map(option => <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={profileType === option.value}
          disabled={Boolean(analyzing)}
          title={option.detail}
          className={`profile-chip${profileType === option.value ? " selected" : ""}`}
          onClick={() => setProfileType(option.value)}
        >
          {option.title}<em>{option.accepts}</em>
        </button>)}
      </div>
    </div>
    <p className="profile-detail">{options.find(option => option.value === profileType)?.detail}</p>

    <div className="workflow-label"><span>2</span><strong>Add your profile</strong><small>Processed locally, never uploaded.</small></div>
    {analyzing
      ? <p className="upload-analyzing" role="status">Analyzing {analyzing.name} with TraceSift…</p>
      : <UploadPane controller={controller} profileType={profileType} busy={!available} />}

    {/* Only for CPU: a React profile comes out of React DevTools, which this
        cannot drive. */}
    {!analyzing && profileType === "cpu" && <>
      <div className="workflow-label"><span>or</span><strong>Record a web app</strong><small>Opens Chrome on this machine.</small></div>
      <CapturePane controller={controller} busy={!available} />
    </>}

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
