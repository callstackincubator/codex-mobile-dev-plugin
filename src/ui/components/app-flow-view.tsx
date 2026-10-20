import { AlertTriangle, Clock, Loader2, MapIcon, Pause } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AppFlowBuildMode, DeepLinkJudgeMode, ExplorationMode } from "../../shared/app-flow.ts";
import { FAST_MODE_AUTH_NOTICE } from "../../shared/app-flow.ts";
import type { AppFlowPanel, AppFlowSweepSummary } from "../app-flow-panel.ts";
import { AppFlowGraph } from "./app-flow-graph.tsx";
import { captureTally, uiStateCount } from "./app-flow-layout.ts";
import { AppFlowUiStatesGraph } from "./app-flow-ui-states-graph.tsx";
import { AppFlowProjectPicker } from "./app-flow-project-picker.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { NativeSelect, NativeSelectOption } from "./ui/native-select.tsx";
import { Switch } from "./ui/switch.tsx";

function stored(key: string, fallback: string) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function write(key: string, value: string) { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* best effort */ } }
/**
 * The live counter beside the progress spinner. A run that walks no route queue (the standalone
 * `mobile_appflow_explore_ui` tool, started from chat) has a summary with `completed`/`total` of 0
 * — rendering that verbatim produced "0 / 0 screens" (and "· route 0 / 0"), which reads as a
 * stalled sweep. With no routes to report, only the capture tally is shown, and a run with neither
 * is left without a counter.
 */
export function progressTally(summary: AppFlowSweepSummary): string {
  const captures = summary.captured !== undefined
    ? summary.captureLimit !== undefined ? `${summary.captured} / ${summary.captureLimit} captured` : `${summary.captured} captured`
    : "";
  if (summary.total <= 0) return captures;
  const routes = `${summary.completed} / ${summary.total}`;
  return captures ? `${captures} · route ${routes}` : `${routes} screens`;
}
/** Per-project localStorage key for the "Capture UI states" switch. Stored as "on"/"off"; absent means off. */
const CAPTURE_UI_STATES_KEY = "app-flow-capture-ui-states";
function duration(milliseconds: number) { if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`; const seconds = Math.round(milliseconds / 1000); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`; }

export function AppFlowView({ panel }: { panel: AppFlowPanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const [mode, setMode] = useState<AppFlowBuildMode>("structure-only");
  const [exploration, setExploration] = useState<ExplorationMode>("auto");
  const [deepLinkJudge, setDeepLinkJudge] = useState<DeepLinkJudgeMode>("on");
  const [screenLimit, setScreenLimit] = useState("");
  const [captureUiStates, setCaptureUiStates] = useState(false);
  /**
   * Which canvas the body shows. Two graphs rather than one: a UI state is not somewhere a user
   * navigates to, so it has no place in the navigation map — see `AppFlowUiState`.
   */
  const [view, setView] = useState<"flow" | "ui-states">("flow");
  useEffect(() => {
    const projectPath = state.projectPath; if (!projectPath) return;
    const nextMode = stored(`app-flow-mode:${projectPath}`, "structure-only"); setMode(nextMode === "screen-ui-and-structure" ? nextMode : "structure-only");
    const nextExploration = stored(`app-flow-exploration:${projectPath}`, "auto"); setExploration(nextExploration === "fast" || nextExploration === "thorough" ? nextExploration : "auto");
    setDeepLinkJudge(stored(`app-flow-deep-link-judge:${projectPath}`, "on") === "off" ? "off" : "on");
    const limit = stored(`app-flow-screen-limit:${projectPath}`, ""); setScreenLimit(/^\d+$/.test(limit) && Number(limit) >= 1 ? limit : "");
    setCaptureUiStates(stored(`${CAPTURE_UI_STATES_KEY}:${projectPath}`, "off") === "on");
  }, [state.projectPath]);
  const isRunning = state.state === "running" || state.state === "needs-user-action";
  const sweepStatus = state.result?.manifest.sweepStatus;
  const isPaused = state.state === "suspended" || sweepStatus === "paused";
  /* The headline counts screenshots, not sweep attempts: the sweep summary's `completed` is the
     queue index, so a route that ended as "Unresolved route parameters" with no screenshot still
     advanced it. The summary keeps driving the live chip and the "Last step:" line below. */
  const tally = useMemo(() => { const nodes = state.result?.nodes ?? []; const counts = captureTally(nodes);
    return counts.total ? counts : null; }, [state.result]);
  const uiStates = useMemo(() => uiStateCount(state.result?.nodes ?? []), [state.result]);
  const start = () => {
    if (!state.projectPath) return;
    write(`app-flow-mode:${state.projectPath}`, mode);
    const options = { mode, ...(mode === "screen-ui-and-structure" ? { screenLimit: screenLimit ? Number(screenLimit) : undefined, explorationMode: exploration,
      deepLinkJudgeMode: deepLinkJudge, captureUiStates } : {}) };
    if (mode === "screen-ui-and-structure") void panel.requestAgentStart(options); else void panel.start(options);
  };
  const empty = !state.result && !isRunning;
  return <section className="flex h-full min-h-0 flex-col" aria-label="App Flow">
    <header className="flex flex-wrap items-start gap-3 border-b p-3">
      <div className="min-w-52 flex-1"><h2 className="text-base font-medium">App Flow</h2>
        <div className="mt-1 flex items-center gap-2">
          <AppFlowProjectPicker panel={panel} />
          {state.result?.manifest.durationMs !== undefined && <span className="flex items-center gap-1 text-xs text-muted-foreground" title={state.result.manifest.cumulativeDurationMs !== undefined && state.result.manifest.cumulativeDurationMs > state.result.manifest.durationMs ? "Total across resumed runs" : undefined}><Clock className="size-3" />{duration(state.result.manifest.cumulativeDurationMs ?? state.result.manifest.durationMs)}</span>}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {state.result && <NativeSelect aria-label="App Flow view" size="sm" value={view} onChange={event => setView(event.target.value as "flow" | "ui-states")}>
          <NativeSelectOption value="flow">Flow graph</NativeSelectOption>
          <NativeSelectOption value="ui-states">UI states{uiStates > 0 ? ` · ${uiStates}` : ""}</NativeSelectOption>
        </NativeSelect>}
        <NativeSelect aria-label="App Flow capture mode" size="sm" value={mode} disabled={isRunning} onChange={event => setMode(event.target.value as AppFlowBuildMode)}>
          <NativeSelectOption value="structure-only">Structure only</NativeSelectOption><NativeSelectOption value="screen-ui-and-structure">Screen UI + Structure</NativeSelectOption>
        </NativeSelect>
        {isRunning ? <><Button variant="secondary" size="sm" onClick={() => void panel.pause()} disabled={!state.runId}><Pause />Pause</Button>
          <Button variant="secondary" size="sm" onClick={() => void panel.cancel()} disabled={!state.runId}>Cancel</Button></>
          : <><Button variant="secondary" size="sm" onClick={() => void panel.launchApp()} disabled={!state.projectPath || state.launching}>
            {state.launching && <Loader2 className="animate-spin" />}{state.launching ? "Launching…" : "Launch App"}</Button>
            <Button size="sm" onClick={start} disabled={!state.projectPath || state.launching || state.agentStartPending || (mode === "screen-ui-and-structure" && !panel.canSendAgentStart)}>
              {state.agentStartPending ? "Asking Codex…" : isPaused ? "Resume" : state.result ? "Regenerate" : "Start"}</Button></>}
      </div>
      {mode === "screen-ui-and-structure" && <div className="flex w-full flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
        <label className="flex items-center gap-1">Reach by <NativeSelect size="sm" aria-label="App Flow exploration mode" value={exploration} disabled={isRunning} onChange={event => { const value = event.target.value as ExplorationMode; setExploration(value); if (state.projectPath) write(`app-flow-exploration:${state.projectPath}`, value); }}>
          <NativeSelectOption value="auto">Auto · Deep Link → Fast</NativeSelectOption><NativeSelectOption value="fast">Fast</NativeSelectOption><NativeSelectOption value="thorough">Thorough · Deep Link → Exploration</NativeSelectOption></NativeSelect></label>
        {exploration !== "fast" && <label className="flex items-center gap-1">Deep-link check <NativeSelect size="sm" aria-label="App Flow deep-link judge" value={deepLinkJudge} disabled={isRunning} onChange={event => { const value = event.target.value as DeepLinkJudgeMode; setDeepLinkJudge(value); if (state.projectPath) write(`app-flow-deep-link-judge:${state.projectPath}`, value); }}>
          <NativeSelectOption value="on">Judge</NativeSelectOption><NativeSelectOption value="off">Screen signal</NativeSelectOption></NativeSelect></label>
        }
        <label className="flex items-center gap-1">Explore <Input className="w-20" aria-label="Maximum screens to explore" type="number" min={1} value={screenLimit} disabled={isRunning}
          placeholder="No limit" onChange={event => { const value = event.target.value; if (value && Number(value) < 1) return; setScreenLimit(value); if (state.projectPath) write(`app-flow-screen-limit:${state.projectPath}`, value); }} /> screens</label>
        {/* Sweep-only: the states are opened while the sweep stands on each screen, so there is no
            run without a sweep to switch this on for. */}
        <label className="flex items-center gap-1.5" title="Also open each screen’s sheets, modals and dialogs while the sweep is on it, and capture them">Capture UI states
          <Switch aria-label="Capture UI states" checked={captureUiStates} disabled={isRunning}
            onCheckedChange={value => { setCaptureUiStates(value); if (state.projectPath) write(`${CAPTURE_UI_STATES_KEY}:${state.projectPath}`, value ? "on" : "off"); }} /></label>
      </div>}
      {/* Fast runs have no auth gate to park on, so the sign-in has to happen before Start/Resume. */}
      {mode === "screen-ui-and-structure" && exploration === "fast" && !isRunning && <p className="w-full text-xs text-amber-600">{FAST_MODE_AUTH_NOTICE}</p>}
      {mode === "screen-ui-and-structure" && !panel.canSendAgentStart && <p className="w-full text-xs text-amber-600">This host cannot send a follow-up message. Ask Codex in chat to start and service the App Flow decision loop.</p>}
    </header>
    {isRunning && state.progress && <div className="flex items-center gap-3 border-b bg-muted/40 px-4 py-2"><Loader2 className="size-4 animate-spin" />
      <div className="min-w-0 flex-1"><div className="text-sm capitalize">{state.progress.phase}</div><div className="truncate text-xs text-muted-foreground">{state.progress.message}</div></div>
      {state.sweepSummary && progressTally(state.sweepSummary) && <span className="text-xs tabular-nums text-muted-foreground">{progressTally(state.sweepSummary)}</span>}</div>}
    {!isRunning && tally && <div className="flex items-center gap-3 border-b bg-muted/20 px-4 py-2"><MapIcon className="size-4" />
      <div className="min-w-0 flex-1"><div className="text-sm">{isPaused ? "Paused after" : sweepStatus === "stopped" || sweepStatus === "failed" ? "Stopped after" : "Captured"} {tally.captured} of {tally.total} screens
        {tally.unableToCapture > 0 && <span className="text-muted-foreground" title={tally.reasons.length ? tally.reasons.join(" · ") : undefined}> · Unable to capture {tally.unableToCapture} screen{tally.unableToCapture === 1 ? "" : "s"}</span>}</div>
        {state.sweepSummary && <div className="truncate text-xs text-muted-foreground">Last step: {state.sweepSummary.message}</div>}</div></div>}
    {state.prompt && <div className="flex flex-wrap items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3"><AlertTriangle className="size-4 text-amber-600" />
      <div className="min-w-48 flex-1"><div className="text-sm font-medium">{state.prompt.kind === "auth" ? "Complete auth in the simulator" : "The app needs your help"}</div>
        <div className="text-xs text-muted-foreground">{state.prompt.detail} · {state.prompt.remaining} screen{state.prompt.remaining === 1 ? "" : "s"} waiting.</div></div>
      {state.prompt.screenshot && state.projectId && <PromptScreenshot panel={panel} projectId={state.projectId} path={state.prompt.screenshot} />}
      <Button variant="secondary" size="sm" onClick={() => void panel.resolvePrompt("stop")}>Stop the flow</Button>
      {state.prompt.kind === "review" && <Button variant="secondary" size="sm" onClick={() => void panel.resolvePrompt("override")}>Continue anyway</Button>}
      <Button size="sm" onClick={() => void panel.resolvePrompt("continue")}>Continue</Button></div>}
    {state.error && <div role="alert" className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">{state.error}</div>}
    <div className="min-h-0 flex-1 overflow-hidden">{!state.projectPath ? <Empty title="Choose a project" detail="Pick the React Native project folder to build or view its flow."
      action={<Button onClick={() => void panel.pickProject()} disabled={state.pickingProject}>{state.pickingProject ? <Loader2 className="animate-spin" /> : null}{state.pickingProject ? "Waiting for the folder…" : "Choose project folder"}</Button>} />
      : empty ? <Empty title="No app flow yet" detail="Build a visual map of every screen and navigation edge in this app." action={<Button onClick={start}
          disabled={!state.available || state.agentStartPending || (mode === "screen-ui-and-structure" && !panel.canSendAgentStart)}>Start Building App Flow</Button>} />
      : state.result && view === "ui-states" ? <AppFlowUiStatesGraph panel={panel} projectId={state.projectId} nodes={state.result.nodes} projectPath={isRunning ? undefined : state.projectPath} />
      : state.result ? <AppFlowGraph panel={panel} projectId={state.projectId} nodes={state.result.nodes} edges={state.result.edges}
          runtimeEdges={state.result.runtimeEdges} entryScreenIds={state.result.navigation?.entryScreenIds} projectPath={isRunning ? undefined : state.projectPath} /> : null}</div>
  </section>;
}

function Empty({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return <div className="flex h-full min-h-60 flex-col items-center justify-center gap-3 p-6 text-center"><MapIcon className="size-10 text-muted-foreground" />
    <div><h3 className="text-base font-medium">{title}</h3><p className="text-sm text-muted-foreground">{detail}</p></div>{action}</div>;
}

function PromptScreenshot({ panel, projectId, path }: { panel: AppFlowPanel; projectId: string; path: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { let active = true; void panel.screenshot(projectId, path).then(value => { if (active) setSrc(value); }, () => {}); return () => { active = false; }; }, [panel, projectId, path]);
  return src ? <img src={src} alt="The screen the build stopped on" className="h-24 rounded border object-contain" /> : null;
}
