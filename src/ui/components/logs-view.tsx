import { ArrowDownToLineIcon, CheckIcon, LayersIcon, ListXIcon, PaperclipIcon, PauseIcon, PlayIcon, RefreshCwIcon, SearchIcon, SlidersHorizontalIcon, TerminalIcon, UnlinkIcon, XIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { LegendList, type LegendListRef, type LegendListRenderItemProps } from "@legendapp/list/react";
import type { StackedLog } from "../../shared/logs.ts";
import type { LogsPanel } from "../logs-panel.ts";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "./ui/empty";
import { Field, FieldLabel, FieldDescription } from "./ui/field";
import { Input } from "./ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Toggle } from "./ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "./ui/base-select";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable";
import { useMediaQuery } from "./use-media-query";

const rowKey = (log: StackedLog) => String(log.sequence);
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export const LogsView = memo(function LogsView({ panel }: { panel: LogsPanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const logs = useSyncExternalStore(panel.list.subscribe, panel.list.getSnapshot);
  const wide = useMediaQuery("(min-width: 900px)");
  const narrow = useMediaQuery("(max-width: 600px)");
  const detailVertical = narrow || (wide && document.documentElement.dataset.view === "workspace");
  const listRef = useRef<LegendListRef>(null);
  const selectedSequence = logs.selected?.sequence;
  const renderItem = useCallback(({ item }: LegendListRenderItemProps<StackedLog>) => <Toggle type="button" data-log-row data-level={item.level} pressed={item.sequence === selectedSequence}
    className="group/log-row grid h-9 w-full grid-cols-[62px_36px_40px_minmax(0,1fr)_28px] gap-2 rounded-none border-b px-3 text-left font-mono text-[11px] font-normal aria-pressed:bg-muted @max-[460px]:grid-cols-[36px_36px_minmax(0,1fr)_24px] @max-[460px]:gap-1.5"
    title={`${item.process ?? item.origin} · ${item.timestamp}\n${item.message}`} onPressedChange={pressed => panel.list.select(pressed ? item.sequence : undefined)}>
    <span className="text-[10px] text-muted-foreground @max-[460px]:hidden">{timeFormat.format(new Date(item.lastTimestamp))}</span>
    <span className="text-[10px] text-muted-foreground">{item.source === "js" ? "JS" : "Native"}</span>
    <span className="text-[10px] text-muted-foreground group-data-[level=error]/log-row:text-destructive">{item.level}</span>
    <span className="truncate">{item.message}</span>
    {item.count > 1 && <Badge variant="secondary" className="justify-self-end px-1" aria-label={`${item.count} occurrences`}>{item.count}</Badge>}
  </Toggle>, [panel, selectedSequence]);

  useEffect(() => {
    if (logs.follow && state.open && logs.filtered.length) void listRef.current?.scrollToEnd({ animated: false });
  }, [logs.filtered, logs.follow, state.open]);

  return <Collapsible open={state.open} onOpenChange={() => panel.toggle()} asChild>
    <section id="logs-drawer" data-open={state.open} className="@container flex h-full min-h-0 min-w-0 flex-col" role="tabpanel" aria-labelledby="tool-logs">
      {state.open && <header className="logs-toolbar flex h-[49px] shrink-0 items-center gap-1 overflow-x-auto border-b px-2">
        <span id="logs-status" className="sr-only" role="status">{state.status} · {logs.filtered.length} shown · {logs.buffered} buffered{logs.dropped > 0 ? ` · ${logs.dropped} older logs dropped` : ""}</span>
          <InputGroup className="h-7 min-w-16 flex-1"><InputGroupInput className="text-xs" aria-label="Search logs" type="search" placeholder="Search..." maxLength={512} value={logs.query} onChange={event => panel.list.search(event.target.value)} /><InputGroupAddon className="pl-2"><SearchIcon className="size-3.5" /></InputGroupAddon></InputGroup>

          <Toggle size="sm" className="size-7 shrink-0 p-0" pressed={logs.stacked} onPressedChange={value => panel.list.setStacked(value)} title="Group identical logs" aria-label="Group identical logs"><LayersIcon /></Toggle>
          <Toggle size="sm" className="size-7 shrink-0 p-0" pressed={logs.follow} onPressedChange={value => panel.list.setFollow(value)} title="Follow new logs" aria-label="Follow new logs"><ArrowDownToLineIcon /></Toggle>
          <Toggle id="logs-pause" size="sm" className="size-7 shrink-0 p-0" title={state.paused ? "Resume logs" : "Pause logs"} aria-label={state.paused ? "Resume logs" : "Pause logs"} pressed={state.paused} onPressedChange={() => panel.togglePause()}>{state.paused ? <PlayIcon /> : <PauseIcon />}</Toggle>
          <Button variant="ghost" size="icon-sm" className="shrink-0" title="Clear logs" aria-label="Clear logs" onClick={() => panel.list.clear()}><ListXIcon /></Button>
          <Popover open={state.settings} onOpenChange={open => { if (open !== state.settings) panel.toggleSettings(); }}>
            <PopoverTrigger asChild><Button variant="ghost" size="icon-sm" className="shrink-0" title="Log settings" aria-label="Log sources"><SlidersHorizontalIcon /></Button></PopoverTrigger>
            <PopoverContent id="logs-settings" align="end" className="w-[min(340px,calc(100vw-24px))] max-h-[min(560px,var(--radix-popover-content-available-height))] overflow-y-auto p-3" aria-label="Log settings">
              <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); panel.connect(); }}>
                <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">Show sources</span>
                  <ToggleGroup type="multiple" size="sm" variant="outline" value={[...logs.sources]} onValueChange={values => panel.list.setFilters("sources", values)} aria-label="Filter log sources">
                    <ToggleGroupItem value="js">JS</ToggleGroupItem><ToggleGroupItem value="native">Native</ToggleGroupItem>
                  </ToggleGroup>
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  <Field className="gap-1"><FieldLabel htmlFor="logs-native" className="text-xs">Device</FieldLabel><NativeSelect id="logs-native" className="w-full" value={state.native} onChange={event => panel.configure({ native: event.target.value })}>
                    <NativeSelectOption value="ios">{state.selectedLabel}</NativeSelectOption><NativeSelectOption value="none">None</NativeSelectOption>
                    {state.android.map(device => <NativeSelectOption key={device.id} value={`android:${device.id}`}>Android · {device.name}</NativeSelectOption>)}
                  </NativeSelect></Field>
                  <Field className="gap-1"><FieldLabel htmlFor="logs-process" className="text-xs">App filter</FieldLabel><Input id="logs-process" className="h-8 text-xs" placeholder="Process or Android package" value={state.process} maxLength={256} onChange={event => panel.configure({ process: event.target.value })} /><FieldDescription className="text-[11px]">Leave empty to include all apps.</FieldDescription></Field>
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  <Field className="gap-1"><FieldLabel htmlFor="logs-metro-url" className="text-xs">Server URL</FieldLabel><Input id="logs-metro-url" className="h-8 text-xs" type="url" value={state.metroUrl} maxLength={2048} spellCheck={false} onChange={event => panel.configure({ metroUrl: event.target.value })} /></Field>
                  <Field className="gap-1"><div className="flex items-center justify-between"><FieldLabel htmlFor="logs-metro-target" className="text-xs">App</FieldLabel><Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" type="button" disabled={!state.available || state.discovering} onClick={() => void panel.discover()}><RefreshCwIcon />{state.discovering ? "Finding..." : "Refresh"}</Button></div><NativeSelect id="logs-metro-target" className="w-full" value={state.target} onChange={event => panel.configure({ target: event.target.value })}><NativeSelectOption value="">None</NativeSelectOption>
                    {state.metro.map(target => <NativeSelectOption key={target.id} value={target.id}>{target.appId ?? target.title}{target.deviceName ? ` · ${target.deviceName}` : ""} · {target.id}</NativeSelectOption>)}
                  </NativeSelect></Field>
                </div>
                <Button type="submit" size="sm" className="w-full" disabled={!state.available}>Connect sources</Button>
              </form>
            </PopoverContent>
          </Popover>
          {logs.attachedKey && <Button variant="ghost" size="icon-sm" className="shrink-0" title="Remove attached log" aria-label="Remove attached log" disabled={logs.attaching} onClick={() => void panel.list.attach(true)}><UnlinkIcon /></Button>}
      </header>}
      <CollapsibleContent id="logs-body" className="flex min-h-0 flex-1 flex-col">
        {state.error && <Alert id="logs-error" variant="destructive" className="shrink-0 rounded-none border-x-0 border-t-0"><AlertDescription className="wrap-anywhere">{state.error}</AlertDescription></Alert>}
        <ResizablePanelGroup className="logs-content min-h-0 flex-1" orientation={detailVertical ? "vertical" : "horizontal"}>
          <ResizablePanel id="log-list-resizable" defaultSize="58%" minSize="30%">
          <div id="logs-list" className="h-full min-h-0 min-w-0 overflow-hidden" aria-label="Log entries">
            {logs.filtered.length ? <LegendList ref={listRef} data={logs.filtered} keyExtractor={rowKey} renderItem={renderItem} extraData={selectedSequence} estimatedItemSize={36} recycleItems
              maintainScrollAtEnd={logs.follow} maintainScrollAtEndThreshold={1} maintainVisibleContentPosition={{ data: !logs.follow, size: true }} style={{ height: "100%" }} /> : <Empty><EmptyHeader><EmptyMedia variant="icon">{logs.query ? <SearchIcon /> : <TerminalIcon />}</EmptyMedia><EmptyTitle>{logs.buffered ? "No logs match these filters." : "Waiting for logs"}</EmptyTitle>{!logs.buffered && <EmptyDescription>Start an app or choose a source.</EmptyDescription>}</EmptyHeader></Empty>}
          </div>
          </ResizablePanel>
          {logs.selected && <><ResizableHandle aria-label="Resize log list and details" /><ResizablePanel id="log-detail-resizable" defaultSize="42%" minSize="25%" maxSize="70%"><aside id="log-detail" className="h-full min-w-0 overflow-y-auto p-3" aria-label="Selected log">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><Badge variant="outline">{logs.selected.level}</Badge><span>{logs.selected.origin} · {logs.selected.count}×</span><Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => panel.list.select()} aria-label="Close log details"><XIcon /></Button></div>
            <pre className="my-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap wrap-anywhere select-text">{[logs.selected.message, logs.selected.stack].filter(Boolean).join("\n\n")}</pre>
            <Button id="log-attach" variant="outline" disabled={logs.attaching || logs.selectedAttached || !logs.canAttach} onClick={() => void panel.list.attach()} title={logs.canAttach ? "Include this log and stack trace with your next message" : "This host does not support log attachments"}>{logs.selectedAttached ? <CheckIcon /> : <PaperclipIcon />}{logs.selectedAttached ? "Attached to chat" : "Attach to chat"}</Button>
          </aside></ResizablePanel></>}
        </ResizablePanelGroup>
        {logs.attachmentStatus && <Alert role="status" className="shrink-0 rounded-none border-x-0 border-b-0"><AlertDescription>{logs.attachmentStatus}</AlertDescription></Alert>}
      </CollapsibleContent>
      {state.open && <footer id="logs-footer" className="flex h-11 shrink-0 items-center border-t px-2">
          <Select multiple value={[...logs.levels]} onValueChange={values => panel.list.setFilters("levels", values)}>
            <SelectTrigger size="sm" className="shrink-0 px-2 text-xs" aria-label="Filter log levels"><span>Levels{logs.levels.size !== 4 ? ` · ${logs.levels.size}` : ""}</span></SelectTrigger>
            <SelectContent side="top" align="end" alignItemWithTrigger={false}>{(["info", "warn", "error", "debug"] as const).map(level => <SelectItem key={level} value={level} className="capitalize">{level}</SelectItem>)}</SelectContent>
          </Select>
      </footer>}
    </section>
  </Collapsible>;
});
