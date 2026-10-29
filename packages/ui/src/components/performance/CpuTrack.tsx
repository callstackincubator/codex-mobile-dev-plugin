import { useCallback, useMemo, useState } from "react";
import { LegendList } from "@legendapp/list/react";
import { CpuIcon } from "lucide-react";
import type { CpuPhase, CpuSample } from "@mobile-dev/shared/cpu.ts";
import type { ThreadHistory, ThreadOrder, ZoomState } from "./types";
import { PerformanceAreaChart } from "./PerformanceAreaChart";
import { MetricTrack, summaryMetrics, trackMessage } from "./MetricTrack";
import { ThreadRow } from "./ThreadRow";
import { SIDEBAR_WIDTH, TRACK_HEIGHT } from "./constants";
import { createCpuSeries, formatCpu, orderCpuThreads, type CpuThreadSeries } from "./cpuSeries";
import { OptionSelect, type SelectOption } from "../ui/option-select";

type CpuTrackProps = {
  samples: CpuSample[];
  threadHistory: ReadonlyMap<string, ThreadHistory>;
  threadOrder: ThreadOrder;
  onThreadOrderChange: (order: ThreadOrder) => void;
  platform: "ios" | "android";
  phase: CpuPhase;
  error: string | null;
  scrollElement: HTMLDivElement | null;
  zoomState: ZoomState;
  onZoomChange: (state: ZoomState) => void;
  onZoomOut: () => void;
};

const THREAD_HEIGHT = TRACK_HEIGHT * 0.7;
const threadKey = (thread: CpuThreadSeries) => thread.id;
const threadHeight = () => THREAD_HEIGHT;
const threadOrders: SelectOption<ThreadOrder>[] = [{ value: "activity", label: "Activity" }, { value: "first-seen", label: "First seen" }];

export function CpuTrack({ samples, threadHistory, threadOrder, onThreadOrderChange, platform, phase, error, scrollElement, zoomState, onZoomChange, onZoomOut }: CpuTrackProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const series = useMemo(() => createCpuSeries(samples), [samples]);
  const threads = useMemo(() => orderCpuThreads(series.threads, threadHistory, threadOrder), [series.threads, threadHistory, threadOrder]);
  const renderThread = useCallback(({ item: thread }: { item: CpuThreadSeries }) => {
    const history = threadHistory.get(thread.id);
    if (history === undefined) throw new Error(`Missing display history for CPU thread ${thread.id}.`);
    return <ThreadRow threadName={thread.name} threadId={thread.id} threadNumber={history.number}
      platform={platform} data={thread.data} running={thread.running} zoomState={zoomState}
      onZoomChange={onZoomChange} onZoomOut={onZoomOut} height={THREAD_HEIGHT} />;
  }, [threadHistory, platform, zoomState, onZoomChange, onZoomOut]);
  const metrics = summaryMetrics({ current: formatCpu(series.current), average: formatCpu(series.average), maximum: formatCpu(series.maximum) },
    { label: "Threads", value: String(series.threadCount) });
  const message = trackMessage(phase, {
    idle: "Open an app on the selected device to measure CPU. 100% = one core.",
    connecting: "Connecting to the app’s CPU counters…",
    recording: series.current === null ? "Measuring CPU usage…" : undefined,
  }, error);
  const showMessage = samples.length < 2 || phase === "failed";

  return <>
    <MetricTrack label="CPU" icon={<CpuIcon className="w-4 h-4 text-blue-500" />} metrics={metrics}
      title="CPU usage: 100% equals one fully occupied core. Expand to see individual threads."
      expanded={isExpanded} onToggle={() => setIsExpanded(value => value === false)}
      message={showMessage ? message : undefined} alert={Boolean(error)}>
      <PerformanceAreaChart data={series.process} zoomState={zoomState} onZoomChange={onZoomChange} onZoomOut={onZoomOut} tooltipPostfix="%" />
    </MetricTrack>
    {isExpanded && <div className="flex border-b border-border bg-muted/30">
      <div className="sticky left-0 z-[60] flex shrink-0 items-center gap-2 border-r border-border bg-background p-2" style={{ width: SIDEBAR_WIDTH }}>
        <label htmlFor="cpu-thread-order" className="text-[10px] text-muted-foreground">Sort</label>
        <OptionSelect id="cpu-thread-order" aria-label="Thread order" size="sm" items={threadOrders} value={threadOrder} onChange={onThreadOrderChange}
          title="Activity: highest current CPU first; previously active threads stay above those with no recorded activity. First seen: stable recording order."
          className="min-w-0 flex-1 text-[11px]" />
      </div>
    </div>}
    {isExpanded && <LegendList data={threads} scrollElement={scrollElement} renderItem={renderThread} extraData={zoomState}
      keyExtractor={threadKey} getFixedItemSize={threadHeight} estimatedItemSize={THREAD_HEIGHT}
      drawDistance={THREAD_HEIGHT} maintainVisibleContentPosition={false} aria-label="CPU threads" />}
  </>;
}
