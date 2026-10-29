import { CopyIcon, MessageCircleIcon, SearchIcon, TerminalIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { LegendList, type LegendListRef, type LegendListRenderItemProps } from "@legendapp/list/react";
import type { StackedLog } from "@mobile-dev/shared/logs.ts";
import type { LogsPanel } from "../logs-panel.ts";
import { chatActionLabel, levelIcon, logLine, logText } from "../log-text.ts";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from "./ui/context-menu";
import { LogDetails } from "./log-details";
import { LogsToolbar } from "./logs-toolbar";
import { BannerAlert } from "./banner-alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "./ui/empty";
import { Toggle } from "./ui/toggle";
import { Select, SelectContent, SelectItem, SelectTrigger } from "./ui/base-select";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable";
import { useCopy } from "./use-copy";
import { useFollowScroll } from "./use-follow-scroll";
import { useMediaQuery } from "./use-media-query";

const rowKey = (log: StackedLog) => String(log.sequence);
// User input controls following; estimated row heights must not gate it.
const followScrollThreshold = Number.POSITIVE_INFINITY;
const copyFailed = "Could not copy log";
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** `fullscreen` is a page that fills the host, where wide windows put log details below the list. */
export const LogsView = memo(function LogsView({ panel, fullscreen }: { panel: LogsPanel; fullscreen: boolean }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const logs = useSyncExternalStore(panel.list.subscribe, panel.list.getSnapshot);
  const wide = useMediaQuery("(min-width: 900px)");
  const narrow = useMediaQuery("(max-width: 600px)");
  const detailVertical = narrow || (wide && fullscreen);
  const listRef = useRef<LegendListRef>(null);
  const followScroll = useFollowScroll(listRef, panel, { open: state.open, follow: logs.follow });
  const { stopUserScroll } = followScroll;
  const selectedSequence = logs.selected?.sequence;
  const [copy, copyStatus] = useCopy({ copied: "Log copied", failed: copyFailed });
  const renderItem = useCallback(({ item }: LegendListRenderItemProps<StackedLog>) => {
    const Icon = levelIcon(item.level);
    const { message } = logText(item);
    return <ContextMenu><ContextMenuTrigger asChild><Toggle type="button" data-log-row data-level={item.level} pressed={item.sequence === selectedSequence}
      className="log-row relative grid h-auto min-h-7 w-full grid-cols-[14px_8ch_1px_minmax(0,1fr)] items-start gap-x-2 rounded-none border-b px-2 py-1 text-left font-mono text-xs leading-[18px] font-normal whitespace-normal"
      style={item.count > 1 ? { paddingRight: Math.max(36, String(item.count).length * 6 + 24) } : undefined}
      title={`${item.source === "js" ? "JS" : "Native"} · ${item.process ?? item.origin} · ${item.timestamp}\n${message}`} onPressedChange={pressed => panel.list.select(pressed ? item.sequence : undefined)}>
      <Icon className="log-severity mt-0.5 size-3.5" aria-label={item.level} />
      <span className="text-muted-foreground tabular-nums">{timeFormat.format(new Date(item.lastTimestamp))}</span>
      <span className="mt-0.5 h-3.5 w-px bg-muted-foreground/70" aria-hidden="true" />
      <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{logLine(item, message)}</span>
      {item.count > 1 && <Badge variant="outline" className="absolute top-1 right-2 h-5 min-w-5 rounded-full bg-secondary px-1 py-0 font-sans text-[10px] leading-none text-secondary-foreground tabular-nums" aria-label={`${item.count} occurrences`}>{item.count}</Badge>}
    </Toggle></ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void copy(`${logLine(item)}${item.stack ? `\n${item.stack}` : ""}`)}><CopyIcon />Copy</ContextMenuItem>
        <ContextMenuItem disabled={logs.sending || !logs.canSendMessage} onSelect={() => void panel.list.sendToChat(item)}>
          <MessageCircleIcon />{chatActionLabel(item.level)}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>;
  }, [panel, selectedSequence, logs.sending, logs.canSendMessage, copy]);
  const changeFollow = useCallback((follow: boolean) => { stopUserScroll(); panel.list.setFollow(follow); }, [panel, stopUserScroll]);

  useEffect(() => {
    if (state.open === false || logs.usesAge === false) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const updateVisibility = () => {
      clearInterval(timer);
      timer = undefined;
      if (document.visibilityState === "hidden") return;
      panel.list.refreshAge();
      timer = setInterval(() => panel.list.refreshAge(), 1000);
    };
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, [panel, state.open, logs.usesAge]);

  return <Collapsible open={state.open} onOpenChange={() => panel.toggle()} asChild>
    <section id="logs-drawer" data-open={state.open} className="@container flex h-full min-h-0 min-w-0 flex-col" role="tabpanel" aria-label="Logs">
      <span className="sr-only" role="status">{copyStatus}</span>
      {copyStatus === copyFailed && <BannerAlert>{copyStatus}</BannerAlert>}
      {state.open && <LogsToolbar panel={panel} state={state} logs={logs} onFollowChange={changeFollow} />}
      <CollapsibleContent id="logs-body" className="flex min-h-0 flex-1 flex-col">
        {logs.queryError && <BannerAlert id="logs-query-error">{logs.queryError}</BannerAlert>}
        {logs.chatError && <BannerAlert>{logs.chatError}</BannerAlert>}
        {state.error && <BannerAlert id="logs-error" textClassName="wrap-anywhere">{state.error}</BannerAlert>}
        <ResizablePanelGroup className="logs-content min-h-0 flex-1" orientation={detailVertical ? "vertical" : "horizontal"}>
          <ResizablePanel id="log-list-resizable" defaultSize="58%" minSize="30%">
          <div id="logs-list" className="h-full min-h-0 min-w-0 overflow-hidden" aria-label="Log entries" {...followScroll.handlers}>
            {logs.filtered.length ? <LegendList ref={listRef} tabIndex={0} data={logs.filtered} keyExtractor={rowKey} renderItem={renderItem} extraData={selectedSequence} estimatedItemSize={28} recycleItems
              initialScrollAtEnd={logs.follow} initialScrollOffset={panel.list.scrollOffset}
              maintainScrollAtEnd={logs.follow} maintainScrollAtEndThreshold={followScrollThreshold} maintainVisibleContentPosition={{ data: !logs.follow, size: true }} style={{ height: "100%" }} /> : <Empty><EmptyHeader><EmptyMedia variant="icon">{logs.query ? <SearchIcon /> : <TerminalIcon />}</EmptyMedia><EmptyTitle>{logs.buffered ? "No logs match these filters." : "Waiting for logs"}</EmptyTitle>{!logs.buffered && <EmptyDescription>Start an app or choose a source.</EmptyDescription>}</EmptyHeader></Empty>}
          </div>
          </ResizablePanel>
          {logs.selected && <><ResizableHandle aria-label="Resize log list and details" /><ResizablePanel id="log-detail-resizable" defaultSize="42%" minSize="25%" maxSize="70%"><LogDetails key={logs.selected.sequence} log={logs.selected} onClose={() => panel.list.select()}>
            <Button id="log-chat" variant="outline" disabled={logs.sending || !logs.canSendMessage} onClick={() => { if (logs.selected) void panel.list.sendToChat(logs.selected); }} title={logs.canSendMessage ? "Send this log and stack trace to chat" : "This host does not support chat messages"}><MessageCircleIcon />{chatActionLabel(logs.selected.level)}</Button>
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
