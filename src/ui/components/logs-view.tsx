import { CopyIcon, MessageCircleIcon, ArrowDownToLineIcon, CircleAlertIcon, InfoIcon, TriangleAlertIcon, CheckIcon, LayersIcon, ListXIcon, PauseIcon, PlayIcon, RefreshCwIcon, SearchIcon, SlidersHorizontalIcon, TerminalIcon, UnlinkIcon, XIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LegendList, type LegendListRef, type LegendListRenderItemProps } from "@legendapp/list/react";
import type { StackedLog } from "../../shared/logs.ts";
import type { LogsPanel } from "../logs-panel.ts";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from "./ui/context-menu";
import { LogDetails } from "./log-details";
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
  const [copyStatus, setCopyStatus] = useState("");
  const copyLog = useCallback(async (log: StackedLog) => {
    const prefix = log.tag || log.process;
    const text = `${prefix ? `${prefix}: ` : ""}${log.message}${log.stack ? `\n${log.stack}` : ""}`;
    try { await navigator.clipboard.writeText(text); setCopyStatus("Log copied"); }
    catch { setCopyStatus("Could not copy log"); }
  }, []);
  const renderItem = useCallback(({ item }: LegendListRenderItemProps<StackedLog>) => {
    const Icon = item.level === "error" ? CircleAlertIcon : item.level === "warn" ? TriangleAlertIcon : InfoIcon;
    const prefix = item.tag || item.process;
    return <ContextMenu><ContextMenuTrigger asChild><Toggle type="button" data-log-row data-level={item.level} pressed={item.sequence === selectedSequence}
      className="log-row relative grid h-auto min-h-7 w-full grid-cols-[14px_8ch_1px_minmax(0,1fr)] items-start gap-x-2 rounded-none border-b px-2 py-1 text-left font-mono text-xs leading-[18px] font-normal whitespace-normal"
      style={item.count > 1 ? { paddingRight: Math.max(36, String(item.count).length * 6 + 24) } : undefined}
      title={`${item.source === "js" ? "JS" : "Native"} · ${item.process ?? item.origin} · ${item.timestamp}\n${item.message}`} onPressedChange={pressed => panel.list.select(pressed ? item.sequence : undefined)}>
      <Icon className="log-severity mt-0.5 size-3.5" aria-label={item.level} />
      <span className="text-muted-foreground tabular-nums">{timeFormat.format(new Date(item.lastTimestamp))}</span>
      <span className="mt-0.5 h-3.5 w-px bg-muted-foreground/70" aria-hidden="true" />
      <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{prefix && <span>{prefix}: </span>}{item.message}</span>
      {item.count > 1 && <Badge variant="outline" className="absolute top-1 right-2 h-5 min-w-5 rounded-full bg-secondary px-1 py-0 font-sans text-[10px] leading-none text-secondary-foreground tabular-nums" aria-label={`${item.count} occurrences`}>{item.count}</Badge>}
    </Toggle></ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => { setCopyStatus(""); void copyLog(item); }}><CopyIcon />Copy</ContextMenuItem>
        <ContextMenuItem disabled={logs.sending || !logs.canSendMessage} onSelect={() => void panel.list.sendToChat(item)}>
          <MessageCircleIcon />{item.level === "error" || item.level === "warn" ? "Fix in chat" : "Ask in chat"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>;
  }, [panel, selectedSequence, logs.sending, logs.canSendMessage, copyLog]);

  useEffect(() => {
    if (logs.follow && state.open && logs.filtered.length) void listRef.current?.scrollToEnd({ animated: false });
  }, [logs.filtered, logs.follow, state.open]);

  return <Collapsible open={state.open} onOpenChange={() => panel.toggle()} asChild>
    <section id="logs-drawer" data-open={state.open} className="@container flex h-full min-h-0 min-w-0 flex-col" role="tabpanel" aria-labelledby="tool-logs">
      <span className="sr-only" role="status">{copyStatus}</span>
      {copyStatus === "Could not copy log" && <Alert variant="destructive" className="shrink-0 rounded-none border-x-0 border-t-0"><AlertDescription>{copyStatus}</AlertDescription></Alert>}
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
        {logs.chatError && <Alert variant="destructive" className="shrink-0 rounded-none border-x-0 border-t-0"><AlertDescription>{logs.chatError}</AlertDescription></Alert>}
        {state.error && <Alert id="logs-error" variant="destructive" className="shrink-0 rounded-none border-x-0 border-t-0"><AlertDescription className="wrap-anywhere">{state.error}</AlertDescription></Alert>}
        <ResizablePanelGroup className="logs-content min-h-0 flex-1" orientation={detailVertical ? "vertical" : "horizontal"}>
          <ResizablePanel id="log-list-resizable" defaultSize="58%" minSize="30%">
          <div id="logs-list" className="h-full min-h-0 min-w-0 overflow-hidden" aria-label="Log entries">
            {logs.filtered.length ? <LegendList ref={listRef} data={logs.filtered} keyExtractor={rowKey} renderItem={renderItem} extraData={selectedSequence} estimatedItemSize={28} recycleItems
              maintainScrollAtEnd={logs.follow} maintainScrollAtEndThreshold={1} maintainVisibleContentPosition={{ data: !logs.follow, size: true }} style={{ height: "100%" }} /> : <Empty><EmptyHeader><EmptyMedia variant="icon">{logs.query ? <SearchIcon /> : <TerminalIcon />}</EmptyMedia><EmptyTitle>{logs.buffered ? "No logs match these filters." : "Waiting for logs"}</EmptyTitle>{!logs.buffered && <EmptyDescription>Start an app or choose a source.</EmptyDescription>}</EmptyHeader></Empty>}
          </div>
          </ResizablePanel>
          {logs.selected && <><ResizableHandle aria-label="Resize log list and details" /><ResizablePanel id="log-detail-resizable" defaultSize="42%" minSize="25%" maxSize="70%"><LogDetails key={logs.selected.sequence} log={logs.selected} onClose={() => panel.list.select()}>
            <Button id="log-chat" variant="outline" disabled={logs.sending || !logs.canSendMessage} onClick={() => { if (logs.selected) void panel.list.sendToChat(logs.selected); }} title={logs.canSendMessage ? "Send this log and stack trace to chat" : "This host does not support chat messages"}><MessageCircleIcon />{logs.selected.level === "error" || logs.selected.level === "warn" ? "Fix in chat" : "Ask in chat"}</Button>
          </LogDetails></ResizablePanel></>}
        </ResizablePanelGroup>
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
