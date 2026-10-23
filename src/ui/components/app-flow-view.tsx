import { AlertTriangle, Clock, Loader2, MapIcon, Pause, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AppFlowBuildMode } from "../../shared/app-flow.ts";
import type { AppFlowPanel, AppFlowSweepSummary } from "../app-flow-panel.ts";
import { countUiEvent } from "../telemetry.ts";
import { AppFlowGraph } from "./app-flow-graph.tsx";
import { ToolbarSelect, type GraphView, type GraphViewOption } from "./app-flow-graph-shared.tsx";
import { captureTally, isResumable, uiStateCount, unresolvedSummary } from "./app-flow-layout.ts";
import { AppFlowUiStatesGraph } from "./app-flow-ui-states-graph.tsx";
import { AppFlowProjectPicker } from "./app-flow-project-picker.tsx";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.tsx";
import { Button } from "./ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";
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
const VIEW_OPTIONS: GraphViewOption[] = [{ value: "flow", label: "Flow graph" }, { value: "ui-states", label: "UI states" }];
const CAPTURE_MODE_OPTIONS: { value: AppFlowBuildMode; label: string }[] = [
  { value: "structure-only", label: "Structure only" }, { value: "screen-ui-and-structure", label: "Screen UI + Structure" },
];


/** Per-project localStorage key for the "Capture UI states" switch. Stored as "on"/"off"; absent means off. */
const CAPTURE_UI_STATES_KEY = "app-flow-capture-ui-states";
function duration(milliseconds: number) { if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`; const seconds = Math.round(milliseconds / 1000); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`; }

export function AppFlowView({ panel }: { panel: AppFlowPanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const [mode, setMode] = useState<AppFlowBuildMode>("structure-only");
  const [captureUiStates, setCaptureUiStates] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  /**
   * Which canvas the body shows. Two graphs rather than one: a UI state is not somewhere a user
   * navigates to, so it has no place in the navigation map — see `AppFlowUiState`.
   */
  const [view, setView] = useState<GraphView>("flow");
  useEffect(() => {
    const projectPath = state.projectPath; if (!projectPath) return;
    const nextMode = stored(`app-flow-mode:${projectPath}`, "structure-only"); setMode(nextMode === "screen-ui-and-structure" ? nextMode : "structure-only");
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
  const unresolved = useMemo(() => unresolvedSummary(state.result?.nodes ?? []), [state.result]);
  const canOfferAiCompletion = sweepStatus === "completed" && (tally?.unableToCapture ?? 0) > 0 && unresolved.aiEligible > 0;
  const resumable = isResumable(sweepStatus, tally);
  const uiStates = useMemo(() => uiStateCount(state.result?.nodes ?? []), [state.result]);
  // The count rides on the option label so the picker says how much the other canvas holds.
  const viewOptions = useMemo(() => VIEW_OPTIONS.map(option => option.value === "ui-states" && uiStates > 0 ? { ...option, label: `${option.label} · ${uiStates}` } : option), [uiStates]);
  const start = () => {
    if (!state.projectPath) return;
    write(`app-flow-mode:${state.projectPath}`, mode);
    void panel.start({ mode, ...(mode === "screen-ui-and-structure" ? {
      explorationMode: "adaptive" as const, deepLinkJudgeMode: "never" as const, captureUiStates
    } : {}) });
  };
  const exploreWithAi = () => {
    if (!state.projectPath || unresolved.aiEligible === 0) return;
    countUiEvent("ui.app_flow.ai_completion_start");
    void panel.requestAgentStart({ mode: "screen-ui-and-structure", explorationMode: "ai", deepLinkJudgeMode: "off", captureUiStates: false });
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
        <ToolbarSelect label="App Flow capture mode" value={mode} items={CAPTURE_MODE_OPTIONS} disabled={isRunning} onChange={setMode} />
        {mode === "screen-ui-and-structure" && <Popover>
          <PopoverTrigger asChild><Button variant="secondary" size="sm" className="min-w-0 max-w-56 justify-start" title="Capture options">
            <Settings2 aria-hidden /><span className="truncate">Capture options</span></Button></PopoverTrigger>
          <PopoverContent align="end" aria-label="Sweep options" className="w-[320px] max-w-[calc(100vw-16px)] space-y-4 p-4 text-sm"
            onInteractOutside={event => { if (event.target instanceof Element && event.target.closest('[data-slot="select-content"]')) event.preventDefault(); }}>
            <div className="space-y-1.5"><label className="flex items-center justify-between gap-3">Capture UI states
              <Switch aria-label="Capture UI states" aria-describedby="app-flow-capture-ui-states-help" checked={captureUiStates} disabled={isRunning}
                onCheckedChange={value => { setCaptureUiStates(value); if (state.projectPath) write(`${CAPTURE_UI_STATES_KEY}:${state.projectPath}`, value ? "on" : "off"); }} /></label>
              <p id="app-flow-capture-ui-states-help" className="text-xs text-muted-foreground">Also open each screen’s sheets, modals and dialogs during deterministic capture.</p></div>
          </PopoverContent>
        </Popover>}
        {/* Clearing deletes the whole stored flow — every capture, every recorded path — and the
            only way back is another sweep. It sat one misplaced click away from Regenerate, so it
            asks first; the confirm button is the destructive one, and dismissing is the default. */}
        {state.result && <Popover open={confirmClear} onOpenChange={setConfirmClear}>
          <PopoverTrigger asChild>
            <Button variant="destructive" size="sm" disabled={isRunning}>Clear app flow</Button>
          </PopoverTrigger>
          <PopoverContent align="end" aria-label="Confirm clearing the app flow" className="w-[300px] max-w-[calc(100vw-16px)] space-y-3 p-4 text-sm">
            <div><div className="font-medium">Clear this app flow?</div>
              <p className="mt-1 text-xs text-muted-foreground">{tally
                ? `${tally.captured} captured screen${tally.captured === 1 ? "" : "s"} and every recorded path are deleted.`
                : "The stored flow and every recorded path are deleted."}</p></div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirmClear(false)}>Cancel</Button>
              <Button variant="destructive" size="sm" onClick={() => { setConfirmClear(false); void panel.clear(); }}>Clear app flow</Button></div>
          </PopoverContent>
        </Popover>}
        {isRunning ? <><Button variant="secondary" size="sm" onClick={() => void panel.pause()} disabled={!state.runId}><Pause />Pause</Button>
          <Button variant="secondary" size="sm" onClick={() => void panel.cancel()} disabled={!state.runId}>Cancel</Button></>
          : <><Button variant="secondary" size="sm" onClick={() => void panel.launchApp()} disabled={!state.projectPath || state.launching}>
            {state.launching && <Loader2 className="animate-spin" />}{state.launching ? "Launching…" : "Launch App"}</Button>
            <Button size="sm" onClick={start} disabled={!state.projectPath || state.launching || state.agentStartPending}>
              {state.agentStartPending ? "Asking Codex…" : isPaused || resumable ? "Resume" : state.result ? "Regenerate" : "Start"}</Button></>}
      </div>
      {mode === "screen-ui-and-structure" && !isRunning && <AppFlowWarning title="Sign in before capture">The deterministic pass does not inspect sign-in state. Launch the app and finish signing in first.</AppFlowWarning>}
    </header>
    {isRunning && state.progress && <div className="flex items-center gap-3 border-b bg-muted/40 px-4 py-2"><Loader2 className="size-4 animate-spin" />
      <div className="min-w-0 flex-1"><div className="text-sm capitalize">{state.progress.phase}</div><div className="truncate text-xs text-muted-foreground">{state.progress.message}</div></div>
      {state.sweepSummary && progressTally(state.sweepSummary) && <span className="text-xs tabular-nums text-muted-foreground">{progressTally(state.sweepSummary)}</span>}</div>}
    {!isRunning && tally && <div className="flex items-center gap-3 border-b bg-muted/20 px-4 py-2"><MapIcon className="size-4" />
      <div className="min-w-0 flex-1"><div className="text-sm">{isPaused ? "Paused after" : sweepStatus === "stopped" || sweepStatus === "failed" ? "Stopped after" : "Captured"} {tally.captured} of {tally.total} screens</div>
        {tally.unableToCapture > 0 && <div className="text-xs text-muted-foreground">
          {unresolved.aiEligible > 0 && <span>{unresolved.aiEligible} can be explored with AI</span>}
          {unresolved.parameters > 0 && <span> · {unresolved.parameters} need route parameters</span>}
          {unresolved.authentication > 0 && <span> · {unresolved.authentication} need sign-in</span>}
          {unresolved.unavailable > 0 && <span> · {unresolved.unavailable} unavailable in this build</span>}
        </div>}
        {state.sweepSummary && <div className="truncate text-xs text-muted-foreground">Last step: {state.sweepSummary.message}</div>}</div>
      {canOfferAiCompletion && <Button size="sm" onClick={exploreWithAi} disabled={!panel.canSendAgentStart || state.agentStartPending}>
        {state.agentStartPending ? "Asking Codex…" : `Explore ${unresolved.aiEligible} with AI`}</Button>}</div>}
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
          disabled={!state.available || state.agentStartPending}>Start Building App Flow</Button>} />
      : state.result && view === "ui-states" ? <AppFlowUiStatesGraph panel={panel} projectId={state.projectId} nodes={state.result.nodes} projectPath={isRunning ? undefined : state.projectPath}
          view={view} viewOptions={viewOptions} onViewChange={setView} />
      : state.result ? <AppFlowGraph panel={panel} projectId={state.projectId} nodes={state.result.nodes} edges={state.result.edges}
          runtimeEdges={state.result.runtimeEdges} entryScreenIds={state.result.navigation?.entryScreenIds} projectPath={isRunning ? undefined : state.projectPath}
          view={view} viewOptions={viewOptions} onViewChange={setView} /> : null}</div>
  </section>;
}

function AppFlowWarning({ title, children }: { title: string; children: React.ReactNode }) {
  return <Alert className="w-full border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100">
    <AlertTriangle aria-hidden className="text-amber-600" />
    <AlertTitle>{title}</AlertTitle>
    <AlertDescription className="text-xs text-amber-900/80 dark:text-amber-100/80">{children}</AlertDescription>
  </Alert>;
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
