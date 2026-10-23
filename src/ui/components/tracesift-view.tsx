/**
 * The TraceSift tool: perf-ai's upload pane until a profile is read, then the
 * same cards and explorer the inline card draws.
 */

import { useState, useSyncExternalStore, type DragEvent } from "react";
import { UploadIcon } from "lucide-react";
import type { TraceSiftPanel } from "../tracesift-panel.ts";
import type { TraceSiftController } from "../tracesift-controller.ts";
import type { TraceSiftProfileType } from "../../shared/tracesift.ts";
import { TraceSiftCards } from "./tracesift-cards.tsx";

const options: { value: Extract<TraceSiftProfileType, "cpu" | "react">; title: string; detail: string; accepts: string; drop: string }[] = [
  { value: "cpu", title: "JavaScript CPU", detail: "Find slow functions and heavy execution paths", accepts: ".json", drop: "Choose a Chrome Performance .json" },
  { value: "react", title: "React components", detail: "Find expensive commits, wasted re-renders and cascades", accepts: "React DevTools JSON", drop: "Choose a React DevTools profiling .json" },
];

/**
 * The drop zone. A dropped file reaches this frame without a path, and the local
 * TraceSift service reads profiles off disk, so the pane asks the host for its
 * own dialog instead and says so when a drop cannot be honored.
 */
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
    // Some hosts hand their frames a real path on the file; most do not, and
    // there is nothing to analyze without one.
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

    {state.error && <p className="tracesift-error" role="alert">{state.error}</p>}
  </main>;
}

export function TraceSiftView({ panel }: { panel: TraceSiftPanel }) {
  const { controller } = panel;
  const { available } = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  // One surface shows one thing: a reading replaces the pane that started it.
  if (state.analysis || state.explorer) return <TraceSiftCards controller={controller} onReset={controller.reset} />;
  return <TraceSiftUpload controller={controller} available={available} />;
}
