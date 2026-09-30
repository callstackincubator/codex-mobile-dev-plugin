type Interval = { startTime: number; duration: number };
type Script = {
  duration: number;
  invoker: string;
  sourceFunctionName: string;
  sourceCharPosition: number;
  windowAttribution: string;
  forcedStyleAndLayoutDuration: number;
};
type Task = Interval & { scope: string };
type Animation = Interval & { blockingDuration: number; scripts: Script[] };
type Response = Interval & { sequence: number | null };
type Decode = Interval & { phase: "jpegPrepare" | "bitmapDecode" };
type Entry = Interval & {
  entryType: string;
  name: string;
  blockingDuration?: number;
  scripts?: readonly Script[];
};

function retain<T>(items: T[], value: T) {
  if (items.length === 128) items.shift();
  items.push(value);
}

function overlap(interval: Interval, events: readonly Interval[]) {
  const end = interval.startTime + interval.duration;
  const intersections: { start: number; end: number }[] = [];
  for (const event of events) {
    const start = Math.max(interval.startTime, event.startTime);
    const clippedEnd = Math.min(end, event.startTime + event.duration);
    if (clippedEnd > start) intersections.push({ start, end: clippedEnd });
  }
  intersections.sort((a, b) => a.start - b.start);
  let total = 0;
  let previousEnd = interval.startTime;
  for (const intersection of intersections) {
    const start = Math.max(intersection.start, previousEnd);
    total += Math.max(0, intersection.end - start);
    previousEnd = Math.max(previousEnd, intersection.end);
  }
  return total;
}

function summary(values: number[]) {
  if (values.length === 0) return { count: 0, average: 0, p95: 0, max: 0 };
  values.sort((a, b) => a - b);
  const index = Math.ceil(values.length * .95) - 1;
  const total = values.reduce((sum, value) => sum + value, 0);
  return { count: values.length, average: total / values.length, p95: values[index], max: values[values.length - 1] };
}

export class BrowserProfile {
  private readonly tasks: Task[] = [];
  private readonly animations: Animation[] = [];
  private readonly lateTimers: Interval[] = [];
  private readonly responses: Response[] = [];
  private readonly currentTasks: Task[] = [];
  private readonly currentAnimations: Animation[] = [];
  private readonly decodes: Decode[] = [];
  private readonly timerDelays: number[] = [];
  private observer?: PerformanceObserver;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private visibilityEpoch = 0;
  private readonly visibilityChanged = () => { this.visibilityEpoch++; };
  private observerError: string | null = null;
  private hiddenTimerSamples = 0;
  private overflowedResponses = 0;
  private overflowedDecodes = 0;
  private readonly supported: readonly string[];

  constructor(supported?: readonly string[]) {
    this.supported = supported ?? (typeof PerformanceObserver === "undefined" ? [] : PerformanceObserver.supportedEntryTypes);
  }

  start() {
    if (this.running) return;
    this.running = true;
    document.addEventListener("visibilitychange", this.visibilityChanged);
    const entryTypes = ["longtask", "long-animation-frame"].filter(type => this.supported.includes(type));
    if (entryTypes.length > 0) {
      try {
        this.observer = new PerformanceObserver(list => {
          const entries = list.getEntries();
          this.recordEntries(entries);
        });
        this.observer.observe({ entryTypes });
      }
      catch (error) {
        this.observerError = error instanceof Error ? error.message : String(error);
        this.observer?.disconnect();
        this.observer = undefined;
      }
    }
    this.scheduleTimer();
  }

  private scheduleTimer() {
    const due = performance.now() + 16;
    const visibilityEpoch = this.visibilityEpoch;
    const visibility = document.visibilityState;
    this.timer = setTimeout(() => {
      if (this.running === false) return;
      const now = performance.now();
      const stayedVisible = visibility === "visible" && document.visibilityState === "visible" && visibilityEpoch === this.visibilityEpoch;
      this.timerFired(due, now, stayedVisible ? "visible" : "hidden");
      this.scheduleTimer();
    }, 16);
  }

  timerFired(due: number, arrivedAt: number, visibility: string) {
    if (visibility !== "visible") { this.hiddenTimerSamples++; return; }
    const duration = Math.max(0, arrivedAt - due);
    retain(this.timerDelays, duration);
    if (duration > 0) retain(this.lateTimers, { startTime: due, duration });
  }

  recordEntries(entries: readonly Entry[]) {
    for (const entry of entries) {
      if (entry.entryType === "longtask") {
        const task = { startTime: entry.startTime, duration: entry.duration, scope: entry.name };
        retain(this.tasks, task);
        retain(this.currentTasks, task);
      } else if (entry.entryType === "long-animation-frame") {
        const scripts = entry.scripts ?? [];
        const sorted = [...scripts];
        sorted.sort((a, b) => b.duration - a.duration);
        const longest = sorted.slice(0, 3);
        const details = longest.map(script => ({
          duration: script.duration, invoker: script.invoker, sourceFunctionName: script.sourceFunctionName,
          sourceCharPosition: script.sourceCharPosition, windowAttribution: script.windowAttribution,
          forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration,
        }));
        const animation = { startTime: entry.startTime, duration: entry.duration, blockingDuration: entry.blockingDuration ?? 0, scripts: details };
        retain(this.animations, animation);
        retain(this.currentAnimations, animation);
      }
    }
  }

  response(serverPreparedAt: number, browserArrivedAt: number, sequence: number | null) {
    if (this.responses.length === 128) this.overflowedResponses++;
    retain(this.responses, {
      startTime: serverPreparedAt - performance.timeOrigin,
      duration: browserArrivedAt - serverPreparedAt,
      sequence,
    });
  }

  decode(phase: "jpegPrepare" | "bitmapDecode", startedAt: number, elapsed: number) {
    if (this.decodes.length === 128) this.overflowedDecodes++;
    retain(this.decodes, { startTime: startedAt, duration: elapsed, phase });
  }

  stats(visibility: string) {
    if (this.observer) {
      const entries = this.observer.takeRecords();
      this.recordEntries(entries);
    }
    this.responses.sort((a, b) => b.duration - a.duration);
    const responses = this.responses.slice(0, 3);
    const slowestResponses = responses.map(response => ({
      ...response,
      longTaskOverlapMs: overlap(response, this.tasks),
      longAnimationFrameOverlapMs: overlap(response, this.animations),
      timerLateOverlapMs: overlap(response, this.lateTimers),
    }));
    this.decodes.sort((a, b) => b.duration - a.duration);
    const decodes = this.decodes.slice(0, 3);
    const slowestDecodes = decodes.map(decode => ({
      ...decode,
      longTaskOverlapMs: overlap(decode, this.tasks),
      longAnimationFrameOverlapMs: overlap(decode, this.animations),
      timerLateOverlapMs: overlap(decode, this.lateTimers),
    }));
    const taskDurations = this.currentTasks.map(task => task.duration);
    const animationDurations = this.currentAnimations.map(animation => animation.duration);
    const longTasks = summary(taskDurations);
    const longAnimationFrames = summary(animationDurations);
    const timerLag = summary(this.timerDelays);
    this.currentTasks.sort((a, b) => b.duration - a.duration);
    this.currentAnimations.sort((a, b) => b.duration - a.duration);
    const result = {
      visibility,
      longTaskSupported: this.supported.includes("longtask"),
      longAnimationFrameSupported: this.supported.includes("long-animation-frame"),
      observerError: this.observerError,
      hiddenTimerSamples: this.hiddenTimerSamples,
      overflowedResponses: this.overflowedResponses,
      overflowedDecodes: this.overflowedDecodes,
      timerLag, longTasks, longAnimationFrames, slowestResponses, slowestDecodes,
      longestTasks: this.currentTasks.slice(0, 3), longestAnimations: this.currentAnimations.slice(0, 3),
    };
    this.responses.length = 0;
    this.currentTasks.length = 0;
    this.currentAnimations.length = 0;
    this.decodes.length = 0;
    this.timerDelays.length = 0;
    this.hiddenTimerSamples = 0;
    this.overflowedResponses = 0;
    this.overflowedDecodes = 0;
    return result;
  }

  stop() {
    this.running = false;
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = undefined;
    this.observer?.disconnect();
    this.observer = undefined;
  }
}
