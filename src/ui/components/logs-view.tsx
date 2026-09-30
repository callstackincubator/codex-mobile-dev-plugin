import { ArrowDownToLineIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, CodeIcon, LayersIcon, ListXIcon, PaperclipIcon, PauseIcon, PlayIcon, RefreshCwIcon, SearchIcon, SlidersHorizontalIcon, SmartphoneIcon, TerminalIcon, UnlinkIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { LegendList, type LegendListRef, type LegendListRenderItemProps } from "@legendapp/list/react";
import type { StackedLog } from "../../shared/logs.ts";
import type { LogsPanel } from "../logs-panel.ts";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "./ui/empty";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "./ui/field";
import { Input } from "./ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Separator } from "./ui/separator";
import { Toggle } from "./ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

const rowKey = (log: StackedLog) => String(log.sequence);
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function LogsView({ panel }: { panel: LogsPanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const logs = useSyncExternalStore(panel.list.subscribe, panel.list.getSnapshot);
  const listRef = useRef<LegendListRef>(null);
  const selectedSequence = logs.selected?.sequence;
  const renderItem = useCallback(({ item }: LegendListRenderItemProps<StackedLog>) => <Button variant="ghost" type="button" data-log-row data-level={item.level} aria-pressed={item.sequence === selectedSequence}
    className="group/log-row grid h-9 w-full grid-cols-[62px_36px_40px_minmax(0,1fr)_28px] gap-2 rounded-none border-b px-3 text-left font-mono text-[11px] font-normal aria-pressed:bg-muted @max-[460px]:grid-cols-[36px_36px_minmax(0,1fr)_24px] @max-[460px]:gap-1.5"
    title={`${item.process ?? item.origin} · ${item.timestamp}\n${item.message}`} onClick={() => panel.list.select(item.sequence)}>
    <span className="text-[10px] text-muted-foreground @max-[460px]:hidden">{timeFormat.format(new Date(item.lastTimestamp))}</span>
    <span className="text-[10px] text-muted-foreground">{item.source === "js" ? "JS" : "Native"}</span>
    <span className="text-[10px] text-muted-foreground group-data-[level=error]/log-row:text-destructive">{item.level}</span>
    <span className="truncate">{item.message}</span>
    {item.count > 1 && <Badge variant="secondary" className="justify-self-end px-1" aria-label={`${item.count} occurrences`}>{item.count}</Badge>}
  </Button>, [panel, selectedSequence]);

  useEffect(() => {
    if (logs.follow && state.open && logs.filtered.length) void listRef.current?.scrollToEnd({ animated: false });
  }, [logs.filtered, logs.follow, state.open]);

  return <Collapsible open={state.open} onOpenChange={() => panel.toggle()} asChild>
    <section id="logs-drawer" data-open={state.open} className="@container min-w-0 shrink-0 border-t bg-background data-[open=true]:flex data-[open=true]:h-[clamp(240px,40dvh,520px)] data-[open=true]:max-h-[calc(100dvh-180px)] data-[open=true]:flex-col" aria-label="App logs">
      <header className="logs-heading flex min-h-11 shrink-0 items-center gap-2 py-2 pr-3 pl-1.5">
        <CollapsibleTrigger asChild><Button id="logs-toggle" variant="ghost" size="icon" aria-controls="logs-body" aria-label={state.open ? "Collapse logs" : "Expand logs"} title={state.open ? "Collapse logs" : "Expand logs"}>{state.open ? <ChevronDownIcon /> : <ChevronUpIcon />}</Button></CollapsibleTrigger>
        <TerminalIcon className="size-4" /><h2 className="text-xs font-semibold">Logs</h2><Badge variant="secondary" className="tabular-nums">{logs.buffered}</Badge>
        <span id="logs-status" className="ml-1 truncate text-[10px] text-muted-foreground @max-[460px]:hidden" role="status" title={state.statusMessage}>{state.status}</span>
        <div className="ml-auto flex shrink-0 gap-0.5">
          {logs.attachedKey && <Button variant="ghost" size="icon" title="Remove attached log" aria-label="Remove attached log" disabled={logs.attaching} onClick={() => void panel.list.attach(true)}><UnlinkIcon /></Button>}
          {state.open && <>
            <Button id="logs-pause" variant="ghost" size="icon" title={state.paused ? "Resume logs" : "Pause logs"} aria-label={state.paused ? "Resume logs" : "Pause logs"} aria-pressed={state.paused} onClick={() => panel.togglePause()}>{state.paused ? <PlayIcon /> : <PauseIcon />}</Button>
            <Button variant="ghost" size="icon" title="Clear logs" aria-label="Clear logs" onClick={() => panel.list.clear()}><ListXIcon /></Button>
            <Button variant={state.settings ? "secondary" : "ghost"} size="icon" title="Log sources" aria-label="Log sources" aria-expanded={state.settings} aria-controls="logs-settings" onClick={() => panel.toggleSettings()}><SlidersHorizontalIcon /></Button>
          </>}
        </div>
      </header>
      <CollapsibleContent id="logs-body" className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 pb-2.5 @max-[620px]:flex-col @max-[620px]:items-stretch">
          <InputGroup className="min-w-37.5 flex-1"><InputGroupInput aria-label="Search logs" type="search" placeholder="Search logs..." maxLength={512} value={logs.query} onChange={event => panel.list.search(event.target.value)} /><InputGroupAddon><SearchIcon /></InputGroupAddon></InputGroup>
          <div className="flex flex-wrap items-center gap-2 @max-[620px]:justify-between @max-[620px]:gap-1">
            <ToggleGroup type="multiple" size="sm" spacing={0} value={[...logs.sources]} onValueChange={values => panel.list.setFilters("sources", values)} aria-label="Sources">
              <ToggleGroupItem value="js"><CodeIcon />JS</ToggleGroupItem>
              <ToggleGroupItem value="native"><SmartphoneIcon />Native</ToggleGroupItem>
            </ToggleGroup>
            <Separator orientation="vertical" className="h-4" />
            <ToggleGroup type="multiple" size="sm" spacing={0} value={[...logs.levels]} onValueChange={values => panel.list.setFilters("levels", values)} aria-label="Levels">
              {(["info", "warn", "error", "debug"] as const).map(level => <ToggleGroupItem key={level} value={level} className="capitalize">{level}</ToggleGroupItem>)}
            </ToggleGroup>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex gap-0.5">
              <Toggle size="sm" pressed={logs.stacked} onPressedChange={value => panel.list.setStacked(value)} title="Group identical logs" aria-label="Group identical logs"><LayersIcon /></Toggle>
              <Toggle size="sm" pressed={logs.follow} onPressedChange={value => panel.list.setFollow(value)} title="Follow new logs" aria-label="Follow new logs"><ArrowDownToLineIcon /></Toggle>
            </div>
          </div>
        </div>
        <Collapsible open={state.settings} className="contents">
          <CollapsibleContent id="logs-settings" className="max-h-[52%] shrink-0 overflow-y-auto border-b bg-muted p-3">
            <form onSubmit={event => { event.preventDefault(); panel.connect(); }}>
              <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-xs font-medium">Log sources</h3><Button variant="outline" size="sm" type="button" disabled={!state.available || state.discovering} onClick={() => void panel.discover()}><RefreshCwIcon />{state.discovering ? "Finding..." : "Find sources"}</Button></div>
              <FieldGroup>
                <Field><FieldLabel htmlFor="logs-native">Native device</FieldLabel><NativeSelect id="logs-native" className="w-full" value={state.native} onChange={event => panel.configure({ native: event.target.value })}>
                  <NativeSelectOption value="ios">{state.selectedLabel}</NativeSelectOption><NativeSelectOption value="none">None</NativeSelectOption>
                  {state.android.map(device => <NativeSelectOption key={device.id} value={`android:${device.id}`}>Android · {device.name}</NativeSelectOption>)}
                </NativeSelect></Field>
                <Field><FieldLabel htmlFor="logs-process">App filter</FieldLabel><Input id="logs-process" placeholder="Process or Android package, empty for all" value={state.process} maxLength={256} onChange={event => panel.configure({ process: event.target.value })} /></Field>
                <Field><FieldLabel htmlFor="logs-metro-url">Metro URL</FieldLabel><Input id="logs-metro-url" type="url" value={state.metroUrl} maxLength={2048} spellCheck={false} onChange={event => panel.configure({ metroUrl: event.target.value })} /></Field>
                <Field><FieldLabel htmlFor="logs-metro-target">Metro app</FieldLabel><NativeSelect id="logs-metro-target" className="w-full" value={state.target} onChange={event => panel.configure({ target: event.target.value })}><NativeSelectOption value="">None</NativeSelectOption>
                  {state.metro.map(target => <NativeSelectOption key={target.id} value={target.id}>{target.appId ?? target.title}{target.deviceName ? ` · ${target.deviceName}` : ""} · {target.id}</NativeSelectOption>)}
                </NativeSelect></Field>
                <Field><Button type="submit" disabled={!state.available}>Connect sources</Button>{state.sourceNotice && <FieldDescription role="status" className="wrap-anywhere">{state.sourceNotice}</FieldDescription>}</Field>
              </FieldGroup>
            </form>
          </CollapsibleContent>
        </Collapsible>
        {state.error && <Alert id="logs-error" variant="destructive" className="shrink-0 rounded-none border-x-0 border-t-0"><AlertDescription className="wrap-anywhere">{state.error}</AlertDescription></Alert>}
        <div className="logs-content flex min-h-0 flex-1 max-[600px]:flex-col">
          <div id="logs-list" className="min-h-0 min-w-0 flex-1 overflow-hidden" aria-label="Log entries">
            <LegendList ref={listRef} data={logs.filtered} keyExtractor={rowKey} renderItem={renderItem} extraData={selectedSequence} estimatedItemSize={36} recycleItems
              maintainScrollAtEnd={logs.follow} maintainScrollAtEndThreshold={1} maintainVisibleContentPosition={{ data: !logs.follow, size: true }} style={{ height: "100%" }}
              ListEmptyComponent={<Empty><EmptyHeader><EmptyMedia variant="icon">{logs.query ? <SearchIcon /> : <TerminalIcon />}</EmptyMedia><EmptyTitle>{logs.buffered ? "No logs match these filters." : "Waiting for logs"}</EmptyTitle>{!logs.buffered && <EmptyDescription>Start an app or choose a source.</EmptyDescription>}</EmptyHeader></Empty>} />
          </div>
          {logs.selected && <aside id="log-detail" className="min-w-0 basis-[42%] overflow-y-auto border-l bg-muted p-3 max-[600px]:basis-[44%] max-[600px]:border-t max-[600px]:border-l-0" aria-label="Selected log">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><Badge variant="outline">{logs.selected.level}</Badge><span>{logs.selected.origin} · {logs.selected.count}×</span><Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => panel.list.select()} aria-label="Close log details"><XIcon /></Button></div>
            <pre className="my-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap wrap-anywhere select-text">{[logs.selected.message, logs.selected.stack].filter(Boolean).join("\n\n")}</pre>
            <Button id="log-attach" variant="outline" disabled={logs.attaching || logs.selectedAttached || !logs.canAttach} onClick={() => void panel.list.attach()} title={logs.canAttach ? "Include this log and stack trace with your next message" : "This host does not support log attachments"}>{logs.selectedAttached ? <CheckIcon /> : <PaperclipIcon />}{logs.selectedAttached ? "Attached to chat" : "Attach to chat"}</Button>
          </aside>}
        </div>
        {logs.attachmentStatus && <Alert role="status" className="shrink-0 rounded-none border-x-0 border-b-0"><AlertDescription>{logs.attachmentStatus}</AlertDescription></Alert>}
        <footer id="logs-footer" className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-t px-3 py-1.5 text-[10px] text-muted-foreground tabular-nums"><span>{logs.filtered.length} {logs.stacked ? "groups" : "logs"} · {logs.buffered} buffered</span>{logs.dropped > 0 && <span>{logs.dropped} older logs dropped before reading</span>}<span className="ml-auto">{logs.follow ? "Following" : "Scroll freely"}</span></footer>
      </CollapsibleContent>
    </section>
  </Collapsible>;
}
