import { ArrowDownToLineIcon, CircleHelpIcon, LayersIcon, ListXIcon, PauseIcon, PlayIcon, RefreshCwIcon, SearchIcon, SlidersHorizontalIcon, UnlinkIcon } from "lucide-react";
import type { LogsPanel } from "../logs-panel.ts";
import { Button } from "./ui/button";
import { Field, FieldLabel, FieldDescription } from "./ui/field";
import { Input } from "./ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { OptionSelect } from "./ui/option-select";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { Switch } from "./ui/switch";
import { Toggle } from "./ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

type LogsState = ReturnType<LogsPanel["getSnapshot"]>;
type LogListState = ReturnType<LogsPanel["list"]["getSnapshot"]>;

export function LogFilterHelp() {
  return <Popover>
    <PopoverTrigger asChild><Button variant="ghost" size="icon-sm" className="shrink-0" title="Log filter help" aria-label="Log filter help"><CircleHelpIcon /></Button></PopoverTrigger>
    <PopoverContent align="start" className="w-[min(360px,calc(100vw-24px))] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-3 text-xs" aria-label="Log filter help">
      <p className="mb-2 font-medium">Filter logs</p>
      <p className="mb-2 text-muted-foreground">Keywords match text and metadata. Use quotes for phrases. Without explicit operators or groups, repeated fields match any value.</p>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
        <code>level:error level:warn</code><span>Errors or warnings</span>
        <code>message:"request failed"</code><span>Message phrase</span>
        <code>app:com.example.app</code><span>App ID, exact match</span>
        <code>pid:123</code><span>Process ID, exact match</span>
        <code>age:5m</code><span>Last five minutes</span>
        <code>-message:noise</code><span>Exclude matches</span>
        <code>network &amp; (timeout | failed)</code><span>AND, OR, grouping</span>
        <code>message~:"error.*timeout"</code><span>Regex, case insensitive</span>
      </div>
      <p className="mt-3 text-muted-foreground">Fields: app, pid, level, message, age, source, origin, process, tag, subsystem, category, stack, timestamp. Age units: s, m, h, d. Spaces mean AND.</p>
    </PopoverContent>
  </Popover>;
}

export function LogSourceSettings({ panel, state, logs }: { panel: LogsPanel; state: LogsState; logs: LogListState }) {
  return <Popover open={state.settings} onOpenChange={open => { if (open !== state.settings) panel.toggleSettings(); }}>
    <PopoverTrigger asChild><Button variant="ghost" size="icon-sm" className="shrink-0" title="Log settings" aria-label="Log sources"><SlidersHorizontalIcon /></Button></PopoverTrigger>
    <PopoverContent id="logs-settings" align="end" className="w-[min(340px,calc(100vw-24px))] max-h-[min(560px,var(--radix-popover-content-available-height))] overflow-y-auto p-3" aria-label="Log settings">
      <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); panel.connect(); }}>
        <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">Show sources</span>
          <ToggleGroup type="multiple" size="sm" variant="outline" value={[...logs.sources]} onValueChange={values => panel.list.setFilters("sources", values)} aria-label="Filter log sources">
            <ToggleGroupItem value="js">JS</ToggleGroupItem><ToggleGroupItem value="native">Native</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <Field className="gap-1">
            <FieldLabel htmlFor="logs-native" className="text-xs">Device</FieldLabel>
            <OptionSelect id="logs-native" className="w-full" value={state.native} onChange={native => panel.configure({ native })}
              items={[{ value: "ios", label: state.selectedLabel }, { value: "none", label: "None" }, ...state.android.map(device => ({ value: `android:${device.id}`, label: `Android · ${device.name}` }))]} />
          </Field>
          <Field className="gap-1">
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="logs-follow-app" className="text-xs">Follow foreground app</FieldLabel>
              <Switch id="logs-follow-app" aria-label="Follow foreground app" checked={state.followApp} disabled={state.native !== "ios"} onCheckedChange={followApp => panel.configure({ followApp })} />
            </div>
            <FieldDescription className="text-[11px]">{state.appDiscoveryError || "Updates the app clause in the search bar. Edit or clear that clause to stop following."}</FieldDescription>
          </Field>
          <Field className="gap-1">
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="logs-hide-system" className="text-xs">Hide iOS system noise</FieldLabel>
              <Switch id="logs-hide-system" aria-label="Hide iOS system noise" checked={state.hideSystemLogs} disabled={state.native !== "ios" || state.selectedPlatform === "android"} onCheckedChange={hideSystemLogs => panel.configure({ hideSystemLogs })} />
            </div>
            <FieldDescription className="text-[11px]">Hides routine Apple framework logs. Errors and faults stay visible. Changing this starts a fresh log stream.</FieldDescription>
          </Field>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <Field className="gap-1">
            <FieldLabel htmlFor="logs-metro-url" className="text-xs">Server URL</FieldLabel>
            <Input id="logs-metro-url" className="h-8 text-xs" type="url" value={state.metroUrl} maxLength={2048} spellCheck={false} onChange={event => panel.configure({ metroUrl: event.target.value })} />
          </Field>
          <Field className="gap-1">
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="logs-metro-target" className="text-xs">App</FieldLabel>
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" type="button" disabled={!state.available || state.discovering} onClick={() => void panel.discover()}><RefreshCwIcon />{state.discovering ? "Finding..." : "Refresh"}</Button>
            </div>
            <OptionSelect id="logs-metro-target" className="w-full" value={state.target} onChange={target => panel.configure({ target })}
              items={[{ value: "", label: "None" }, ...state.metro.map(target => ({ value: target.id, label: `${target.appId ?? target.title}${target.deviceName ? ` · ${target.deviceName}` : ""} · ${target.id}` }))]} />
          </Field>
        </div>
        <Button type="submit" size="sm" className="w-full" disabled={!state.available}>Connect sources</Button>
      </form>
    </PopoverContent>
  </Popover>;
}

/** The open logs' toolbar: search, filter help, grouping, following, pause, clear and sources. */
export function LogsToolbar({ panel, state, logs, onFollowChange }: { panel: LogsPanel; state: LogsState; logs: LogListState; onFollowChange: (follow: boolean) => void }) {
  return <header className="logs-toolbar panel-toolbar flex h-[49px] shrink-0 items-center gap-1 overflow-x-auto border-b px-2">
    <span id="logs-status" className="sr-only" role="status">{state.status} · {logs.filtered.length} shown · {logs.buffered} buffered{logs.dropped > 0 ? ` · ${logs.dropped} older logs dropped` : ""}</span>
    <InputGroup className="h-7 min-w-16 flex-1">
      <InputGroupInput className="text-xs" aria-label="Search logs" type="search" placeholder="Filter logs..." maxLength={512} autoComplete="off" spellCheck={false}
        aria-invalid={Boolean(logs.queryError)} aria-describedby={logs.queryError ? "logs-query-error" : undefined} value={logs.query} onChange={event => panel.search(event.target.value)} />
      <InputGroupAddon className="pl-2"><SearchIcon className="size-3.5" /></InputGroupAddon>
    </InputGroup>
    <LogFilterHelp />
    <Toggle size="sm" className="size-7 shrink-0 p-0" pressed={logs.stacked} onPressedChange={value => panel.list.setStacked(value)} title="Group identical logs" aria-label="Group identical logs"><LayersIcon /></Toggle>
    <Toggle size="sm" className="size-7 shrink-0 p-0" pressed={logs.follow} onPressedChange={onFollowChange} title="Follow new logs" aria-label="Follow new logs"><ArrowDownToLineIcon /></Toggle>
    <Toggle id="logs-pause" size="sm" className="size-7 shrink-0 p-0" title={state.paused ? "Resume logs" : "Pause logs"} aria-label={state.paused ? "Resume logs" : "Pause logs"} pressed={state.paused} onPressedChange={() => panel.togglePause()}>{state.paused ? <PlayIcon /> : <PauseIcon />}</Toggle>
    <Button variant="ghost" size="icon-sm" className="shrink-0" title="Clear logs" aria-label="Clear logs" onClick={() => panel.list.clear()}><ListXIcon /></Button>
    <LogSourceSettings panel={panel} state={state} logs={logs} />
    {logs.attachedKey && <Button variant="ghost" size="icon-sm" className="shrink-0" title="Remove attached log" aria-label="Remove attached log" disabled={logs.attaching} onClick={() => void panel.list.attach(true)}><UnlinkIcon /></Button>}
  </header>;
}
