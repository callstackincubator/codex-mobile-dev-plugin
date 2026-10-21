import { AlertTriangle, Clock, Loader2, MapIcon, Pause, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AppFlowBuildMode, ExplorationMode } from "../../shared/app-flow.ts";
import { FAST_MODE_AUTH_NOTICE } from "../../shared/app-flow.ts";
import type { AppFlowPanel, AppFlowSweepSummary } from "../app-flow-panel.ts";
import { AppFlowGraph } from "./app-flow-graph.tsx";
import { ToolbarSelect, type GraphView, type GraphViewOption } from "./app-flow-graph-shared.tsx";
import { captureTally, isResumable, uiStateCount } from "./app-flow-layout.ts";
import { AppFlowUiStatesGraph } from "./app-flow-ui-states-graph.tsx";
import { AppFlowProjectPicker } from "./app-flow-project-picker.tsx";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
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
/**
 * One sentence per reach mode, always shown under the sweep options. Each is what the sweep does
 * for a screen, not a promise about outcome: Fast drives the app's own runtime navigator only
 * (no probe URL, no auth-gate check); Auto and Thorough both try a deep link first and differ in
 * what they fall back to.
 */
export const EXPLORATION_NOTES: Record<ExplorationMode, string> = {
  fast: "Navigates with the app's own runtime navigator. It skips deep links and sign-in checks.",
  auto: "Tries a deep link to each screen first, then falls back to the app's runtime navigator.",
  thorough: "Tries a deep link to each screen first, then has the model explore the UI by hand. The exploration can be slow per screen.",
};
const EXPLORATION_OPTIONS: { value: ExplorationMode; label: string }[] = [
  { value: "fast", label: "Fast" }, { value: "auto", label: "Deep Link + Fast" }, { value: "thorough", label: "Deep Link + Explore" },
];
const VIEW_OPTIONS: GraphViewOption[] = [{ value: "flow", label: "Flow graph" }, { value: "ui-states", label: "UI states" }];
/** Compact trigger text for the sweep options popover, e.g. "Deep Link + Explore · 15 screens"; an empty or 0 limit reads "All screens". */
export function sweepOptionsSummary(exploration: ExplorationMode, screenLimit: string): string {
  const reach = EXPLORATION_OPTIONS.find(item => item.value === exploration)?.label ?? exploration;
  const limit = Number(screenLimit);
  return `${reach} · ${screenLimit && limit > 0 ? `${limit} screen${limit === 1 ? "" : "s"}` : "All screens"}`;
}
const CAPTURE_MODE_OPTIONS: { value: AppFlowBuildMode; label: string }[] = [
  { value: "structure-only", label: "Structure only" }, { value: "screen-ui-and-structure", label: "Screen UI + Structure" },
];


/** Per-project localStorage key for the "Capture UI states" switch. Stored as "on"/"off"; absent means off. */
const CAPTURE_UI_STATES_KEY = "app-flow-capture-ui-states";
function duration(milliseconds: number) { if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`; const seconds = Math.round(milliseconds / 1000); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`; }

export function AppFlowView({ panel }: { panel: AppFlowPanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const [mode, setMode] = useState<AppFlowBuildMode>("structure-only");
  const [exploration, setExploration] = useState<ExplorationMode>("fast");
  const [screenLimit, setScreenLimit] = useState("10");
  const [captureUiStates, setCaptureUiStates] = useState(false);
  /**
   * Which canvas the body shows. Two graphs rather than one: a UI state is not somewhere a user
   * navigates to, so it has no place in the navigation map — see `AppFlowUiState`.
   */
  const [view, setView] = useState<GraphView>("flow");
  useEffect(() => {
    const projectPath = state.projectPath; if (!projectPath) return;
    const nextMode = stored(`app-flow-mode:${projectPath}`, "structure-only"); setMode(nextMode === "screen-ui-and-structure" ? nextMode : "structure-only");
    const nextExploration = stored(`app-flow-exploration:${projectPath}`, "fast"); setExploration(nextExploration === "auto" || nextExploration === "thorough" ? nextExploration : "fast");
    const limit = stored(`app-flow-screen-limit:${projectPath}`, "10"); setScreenLimit(/^\d+$/.test(limit) ? limit : "10");
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
  const resumable = isResumable(sweepStatus, tally);
  const uiStates = useMemo(() => uiStateCount(state.result?.nodes ?? []), [state.result]);
  // The count rides on the option label so the picker says how much the other canvas holds.
  const viewOptions = useMemo(() => VIEW_OPTIONS.map(option => option.value === "ui-states" && uiStates > 0 ? { ...option, label: `${option.label} · ${uiStates}` } : option), [uiStates]);
  const needsAgentStart = mode === "screen-ui-and-structure" && exploration !== "fast";
  const start = () => {
    if (!state.projectPath) return;
    write(`app-flow-mode:${state.projectPath}`, mode);
    const options = { mode, ...(mode === "screen-ui-and-structure" ? { screenLimit: screenLimit ? Number(screenLimit) : undefined, explorationMode: exploration,
      /* Always the screen-signal path: the judge is no longer a UI choice, so a sweep is deterministic. */
      deepLinkJudgeMode: "off" as const, captureUiStates } : {}) };
    /* Fast asks no model anything, so the server starts it with no decision provider and there is
       no `next_decision` loop for Codex to service. Routing it through the chat round trip only
       added a step that can fail or be declined, so it starts straight from the panel like a
       structure-only build. Every other sweep is model-driven end to end and still needs Codex. */
    if (needsAgentStart) void panel.requestAgentStart(options); else void panel.start(options);
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
          <PopoverTrigger asChild><Button variant="secondary" size="sm" className="min-w-0 max-w-56 justify-start" title={sweepOptionsSummary(exploration, screenLimit)}>
            <Settings2 aria-hidden /><span className="truncate">{sweepOptionsSummary(exploration, screenLimit)}</span></Button></PopoverTrigger>
          <PopoverContent align="end" aria-label="Sweep options" className="w-[320px] max-w-[calc(100vw-16px)] space-y-4 p-4 text-sm"
            onInteractOutside={event => { if (event.target instanceof Element && event.target.closest('[data-slot="select-content"]')) event.preventDefault(); }}>
            <div className="space-y-1.5"><label className="flex items-center justify-between gap-3">Reach by
              <ToolbarSelect label="App Flow exploration mode" value={exploration} items={EXPLORATION_OPTIONS} disabled={isRunning} describedBy="app-flow-exploration-note"
                onChange={value => { setExploration(value); if (state.projectPath) write(`app-flow-exploration:${state.projectPath}`, value); }} /></label>
              <p id="app-flow-exploration-note" className="text-xs text-muted-foreground">{EXPLORATION_NOTES[exploration]}</p></div>
            <div className="space-y-1.5"><label className="flex items-center gap-1.5">Explore
              <Input className="w-20" aria-label="Maximum screens to explore" aria-describedby="app-flow-screen-limit-help" type="number" min={0} value={screenLimit} disabled={isRunning}
                placeholder="All" onChange={event => { const value = event.target.value; if (value && Number(value) < 0) return; setScreenLimit(value); if (state.projectPath) write(`app-flow-screen-limit:${state.projectPath}`, value); }} /> screens</label>
              <p id="app-flow-screen-limit-help" className="text-xs text-muted-foreground">0 explores all screens</p></div>
            {/* Sweep-only: the states are opened while the sweep stands on each screen, so there is no
                run without a sweep to switch this on for. */}
            <div className="space-y-1.5"><label className="flex items-center justify-between gap-3">Capture UI states
              <Switch aria-label="Capture UI states" aria-describedby="app-flow-capture-ui-states-help" checked={captureUiStates} disabled={isRunning}
                onCheckedChange={value => { setCaptureUiStates(value); if (state.projectPath) write(`${CAPTURE_UI_STATES_KEY}:${state.projectPath}`, value ? "on" : "off"); }} /></label>
              <p id="app-flow-capture-ui-states-help" className="text-xs text-muted-foreground">Also open each screen’s sheets, modals and dialogs while the sweep is on it, and capture them</p></div>
          </PopoverContent>
        </Popover>}
        {state.result && <Button variant="destructive" size="sm" onClick={() => void panel.clear()} disabled={isRunning}>Clear app flow</Button>}
        {isRunning ? <><Button variant="secondary" size="sm" onClick={() => void panel.pause()} disabled={!state.runId}><Pause />Pause</Button>
          <Button variant="secondary" size="sm" onClick={() => void panel.cancel()} disabled={!state.runId}>Cancel</Button></>
          : <><Button variant="secondary" size="sm" onClick={() => void panel.launchApp()} disabled={!state.projectPath || state.launching}>
            {state.launching && <Loader2 className="animate-spin" />}{state.launching ? "Launching…" : "Launch App"}</Button>
            <Button size="sm" onClick={start} disabled={!state.projectPath || state.launching || state.agentStartPending || (needsAgentStart && !panel.canSendAgentStart)}>
              {state.agentStartPending ? "Asking Codex…" : isPaused || resumable ? "Resume" : state.result ? "Regenerate" : "Start"}</Button></>}
      </div>
      {/* Fast runs have no auth gate to park on, so the sign-in has to happen before Start/Resume. */}
      {mode === "screen-ui-and-structure" && exploration === "fast" && !isRunning && <AppFlowWarning title="Sign in before using Fast">{FAST_MODE_AUTH_NOTICE}</AppFlowWarning>}
      {needsAgentStart && !panel.canSendAgentStart && <AppFlowWarning title="Start this flow from chat">This host cannot send a follow-up message. Ask Codex in chat to start and service the App Flow decision loop.</AppFlowWarning>}
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
          disabled={!state.available || state.agentStartPending || (needsAgentStart && !panel.canSendAgentStart)}>Start Building App Flow</Button>} />
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
