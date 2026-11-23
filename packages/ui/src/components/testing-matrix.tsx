import { useEffect, useSyncExternalStore } from "react";
import { LoaderCircleIcon, RefreshCwIcon, SmartphoneIcon, XIcon } from "lucide-react";
import { TestingNote } from "./testing-note";
import { platformLabel } from "../testing-panel.ts";
import type { TestingPanel } from "../testing-panel.ts";
import type { DeviceAppsStore } from "../device-apps.ts";
import { MAX_MATRIX_LIMIT, isTerminalLane, laneDuration, laneLabel, matrixFinished, matrixSummary } from "../testing-matrix.ts";
import type { MatrixDeviceOption, MatrixLane } from "../testing-matrix.ts";
import { formatRunDuration } from "../test-recorder.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";

/** One row of the checklist: a checkbox, the device, and what is true of it right now. */
function DeviceRow({ device, checked, busy, appMissing, onToggle }: { device: MatrixDeviceOption; checked: boolean; busy: boolean; appMissing: boolean; onToggle: (value: boolean) => void }) {
  const id = `matrix-${device.deviceId}`;
  return <li className="flex items-center gap-2 py-1.5" data-matrix-device={device.deviceId}>
    <input id={id} type="checkbox" className="size-3.5 shrink-0 accent-primary" checked={checked} disabled={busy || (appMissing && !checked)} onChange={event => onToggle(event.target.checked)} />
    <Label htmlFor={id} className="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm font-normal">
      <span className="truncate">{device.name}</span>
      {device.runtime && <span className="shrink-0 text-xs text-muted-foreground">{device.runtime}</span>}
    </Label>
    <span className="flex shrink-0 items-center gap-1">
      {busy && <Badge variant="outline">Busy</Badge>}
      <Badge variant="ghost" className={device.booted ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}>{device.booted ? "Booted" : "Off"}</Badge>
      {device.booted && device.installed !== undefined && <Badge variant="ghost" title={device.installed ? "The app is on this device." : "Not installed. It will be copied from another booted device that has it that has it."}
        className={device.installed ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}>{device.installed ? "Installed" : "App missing"}</Badge>}
    </span>
  </li>;
}

/**
 * The matrix checklist in the setup popover: tick devices to run the open test on all of them.
 * A project with its own e2e config gets it too: each lane runs the config's target for the device's platform.
 */
export function MatrixDevices({ panel }: { panel: TestingPanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const enabled = panel.matrixEnabled;
  useEffect(() => { if (enabled) void panel.loadMatrixDevices(); }, [panel, enabled]);
  const apps = panel.matrixApps();
  const selected = new Set(state.matrixSelected);
  const toggle = (id: string, value: boolean) => panel.setMatrixSelection(value ? [...state.matrixSelected, id] : state.matrixSelected.filter(entry => entry !== id));
  if (!enabled) return <TestingNote data-matrix-disabled>Running on several devices is not available yet.</TestingNote>;
  const only = panel.matrixPlatform;
  const groups = ([["iOS", "ios"], ["Android", "android"]] as const)
    .filter(([, platform]) => !only || platform === only)
    .map(([label, platform]) => [label, state.matrixDevices.filter(device => device.platform === platform)] as const);
  const count = panel.matrixRunCount;
  return <div className="flex flex-col gap-3" data-testing-matrix>
    {groups.map(([label, devices]) => devices.length > 0 && <div key={label} className="flex flex-col">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <ul className="flex flex-col divide-y">{devices.map(device => <DeviceRow key={device.deviceId} device={device} checked={selected.has(device.deviceId)}
        busy={panel.matrixBusy(device.deviceId)} appMissing={!apps[device.platform]} onToggle={value => toggle(device.deviceId, value)} />)}</ul>
      {!apps[devices[0]!.platform] && <div className="pt-1"><TestingNote tone="warning">No {label} app id for this test, so these devices cannot run it.</TestingNote></div>}
    </div>)}
    {only && <TestingNote tone="warning" data-matrix-platform-only>This test was recorded on {platformLabel(only)} and doesn't have an {platformLabel(only === "ios" ? "android" : "ios")} target. To add one, open the app on an {platformLabel(only === "ios" ? "android" : "ios")} device in the mirror and choose Add {platformLabel(only === "ios" ? "android" : "ios")} app.</TestingNote>}
    {state.matrixDevices.length === 0 && <p className="text-xs text-muted-foreground">{state.matrixLoading ? "Looking for simulators and emulators…" : "No simulators or emulators found."}</p>}
    <div className="flex items-end justify-between gap-3">
      <div className="flex items-center gap-2"><Label htmlFor="testing-matrix-limit" className="text-xs text-muted-foreground">Run up to</Label>
        <Input id="testing-matrix-limit" type="number" min={1} max={MAX_MATRIX_LIMIT} className="h-8 w-16 text-xs" value={state.matrixLimit}
          onChange={event => panel.setMatrixLimit(Number(event.target.value))} />
        <span className="text-xs text-muted-foreground">at once</span></div>
      <Button type="button" size="xs" variant="ghost" disabled={state.matrixLoading} onClick={() => void panel.loadMatrixDevices()}>{state.matrixLoading ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}Refresh</Button>
    </div>
    <TestingNote>{count > state.matrixLimit ? `${count - state.matrixLimit} will queue until a slot frees. ` : ""}{state.runtimeMode === "project" ? "Devices that are off are booted, and a missing app is copied from another booted device that has it. Each device runs the config's target for its platform." : "Devices that are off are booted, and a missing app is copied from another booted device that has it."} Agent steps call the model once per device.</TestingNote>
  </div>;
}

const LANE_TONE: Record<MatrixLane["state"], string> = {
  queued: "bg-muted text-muted-foreground", booting: "bg-sky-500/10 text-sky-600 dark:text-sky-400", installing: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  running: "bg-sky-500/10 text-sky-600 dark:text-sky-400", passed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/10 text-destructive", error: "bg-destructive/10 text-destructive", cancelled: "bg-muted text-muted-foreground",
};

function LaneRow({ panel, lane, selected, mirrored, totalSteps }: { panel: TestingPanel; lane: MatrixLane; selected: boolean; mirrored: boolean; totalSteps?: number }) {
  const active = !isTerminalLane(lane.state);
  const duration = laneDuration(lane);
  return <li data-matrix-lane={lane.deviceId} data-lane-state={lane.state} data-lane-mirrored={mirrored}
    className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${mirrored ? "bg-primary/10 ring-1 ring-primary/40" : selected ? "bg-muted" : "hover:bg-muted/50"}`}>
    <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-pressed={selected} aria-current={mirrored ? "true" : undefined}
      title="Show this device's steps and mirror it." onClick={() => panel.openLane(lane.runId)}>
      <SmartphoneIcon className={`size-3.5 shrink-0 ${mirrored ? "text-primary" : "text-muted-foreground"}`} />
      <span className="min-w-0 flex-1 truncate text-sm">{lane.deviceName}</span>
      <Badge variant="ghost" className={LANE_TONE[lane.state]}>{active && lane.state !== "queued" && <LoaderCircleIcon className="animate-spin" />}{laneLabel(lane, totalSteps)}</Badge>
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{duration === undefined ? "" : formatRunDuration(duration)}</span>
    </button>
    <Button type="button" size="icon-xs" variant="ghost" aria-label={`Cancel ${lane.deviceName}`} disabled={!active} onClick={() => void panel.cancelMatrix(lane.deviceId)}><XIcon /></Button>
  </li>;
}

/**
 * One row per device while a matrix runs and after it ends. Clicking a row shows that device's steps
 * on the preview below; the summary says how many passed and failed.
 */
export function MatrixLanes({ panel, deviceApps, totalSteps }: { panel: TestingPanel; deviceApps: DeviceAppsStore; totalSteps?: number }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  // Every hook before the early return: a matrix appearing mid-session (an agent's run) must not
  // change the hook count, or React throws and the whole panel falls to its error boundary.
  const mirroredDevice = useSyncExternalStore(deviceApps.subscribe, () => deviceApps.getSnapshot().device?.udid);
  const matrix = state.matrix;
  if (!matrix) return null;
  const finished = matrixFinished(matrix);
  const selected = matrix.lanes.find(lane => lane.runId === state.selectedLane) ?? matrix.lanes[0];
  return <section className="flex flex-col gap-1 rounded-lg border p-2" aria-label="Devices" data-testing-lanes>
    <header className="flex items-center justify-between gap-2 px-2">
      <span className="text-xs font-medium" role="status">{matrixSummary(matrix)}</span>
      <span className="flex items-center gap-1">
        {!finished && <Button type="button" size="xs" variant="ghost" onClick={() => void panel.cancelMatrix()}>Cancel all</Button>}
        {finished && <Button type="button" size="xs" variant="ghost" onClick={() => panel.dismissMatrix()}>Dismiss</Button>}
      </span>
    </header>
    <ul className="flex flex-col">{matrix.lanes.map(lane => <LaneRow key={lane.runId} panel={panel} lane={lane} selected={lane.runId === selected?.runId} mirrored={lane.deviceId === mirroredDevice} {...(totalSteps === undefined ? {} : { totalSteps })} />)}</ul>
    {selected?.error && <p className="px-2 pt-1 text-xs text-destructive" role="alert">{selected.error}</p>}
  </section>;
}
