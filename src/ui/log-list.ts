import type { LogEntry, StackedLog } from "../shared/logs.ts";
import { logKey, stackLogs } from "../shared/logs.ts";
import type { PanelContext } from "./model-context.ts";
import { countUiEvent, recordUiTiming, setUiGauge, captureUiError } from "./telemetry.ts";
import { compileLogQuery } from "./log-query.ts";
import type { DeviceApp, ForegroundApp } from "../shared/device-apps.ts";

export class LogList {
  scrollOffset = 0;
  private entries: LogEntry[] = [];
  private appIds = new Map<number, string>();
  private selectedSequence?: number;
  private sequence = 0;
  private dropped = 0;
  private readonly listeners = new Set<() => void>();
  private sources = new Set(["js", "native"]);
  private levels = new Set(["info", "warn", "error", "debug"]);
  private query = "";
  private compiledQuery = compileLogQuery("");
  private stacked = true;
  private follow = true;
  private attaching = false;
  private sending = false;
  private chatError = "";
  private attachmentStatus = "";
  private snapshot: ReturnType<LogList["makeSnapshot"]>;

  private readonly context: PanelContext;

  constructor(context: PanelContext) {
    this.context = context;
    this.snapshot = this.makeSnapshot();
    this.context.onChange = () => this.publish();
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;

  private makeSnapshot() {
    const now = Date.now();
    const matches = this.entries.filter(log => this.sources.has(log.source) && this.levels.has(log.level) && this.compiledQuery.match(log, now));
    const filtered: StackedLog[] = this.stacked ? stackLogs(matches) : matches.map(log => ({ ...log, count: 1, lastTimestamp: log.timestamp }));
    const selectedEntry = this.entries.find(log => log.sequence === this.selectedSequence);
    let selected: StackedLog | undefined;
    if (selectedEntry) {
      const selectedKey = logKey(selectedEntry);
      const occurrences = this.stacked ? this.entries.filter(log => logKey(log) === selectedKey) : [selectedEntry];
      const [group] = stackLogs(occurrences);
      selected = { ...group, sequence: selectedEntry.sequence };
    }
    return { filtered, selected, buffered: this.entries.length, dropped: this.dropped, sources: this.sources, levels: this.levels,
      query: this.query, queryError: this.compiledQuery.error, usesAge: this.compiledQuery.usesAge,
      stacked: this.stacked, follow: this.follow, attaching: this.attaching, attachmentStatus: this.attachmentStatus,
      attachedKey: this.context.attachedKey, canAttach: this.context.canAttach,
      sending: this.sending, chatError: this.chatError, canSendMessage: this.context.canSendMessage,
      selectedAttached: !!selected && this.context.attachedKey === logKey(selected) };
  }

  private publish() {
    const startedAt = performance.now();
    this.snapshot = this.makeSnapshot();
    const elapsed = performance.now() - startedAt;
    recordUiTiming("ui.logs.filter", elapsed);
    setUiGauge("ui.logs.buffered_rows", this.entries.length);
    setUiGauge("ui.logs.filtered_rows", this.snapshot.filtered.length);
    for (const listener of this.listeners) listener();
  }

  append(entries: LogEntry[], dropped: number) {
    if (!entries.length && !dropped) return;
    countUiEvent("ui.logs.received", entries.length);
    countUiEvent("ui.logs.dropped", dropped);
    this.dropped += dropped;
    const startedAt = performance.now();
    for (const entry of entries) {
      const appId = entry.appId ?? (entry.origin === "metro" || entry.pid === undefined ? undefined : this.appIds.get(entry.pid));
      this.entries.push({ ...entry, ...(appId ? { appId } : {}), sequence: ++this.sequence });
    }
    const elapsed = performance.now() - startedAt;
    recordUiTiming("ui.logs.app_identity", elapsed);
    // Share spare capacity, but evict from the busier source first.
    const histories = {
      js: { entries: [] as LogEntry[], first: 0, bytes: 0 },
      native: { entries: [] as LogEntry[], first: 0, bytes: 0 },
    };
    let bytes = 0;
    for (const entry of this.entries) {
      const history = histories[entry.source];
      const size = entry.message.length + (entry.stack?.length ?? 0);
      history.entries.push(entry); history.bytes += size; bytes += size;
    }
    let retained = this.entries.length;
    while (retained > 2000 || bytes > 2 * 1024 * 1024) {
      const { js, native } = histories;
      const difference = retained > 2000
        ? (js.entries.length - js.first) - (native.entries.length - native.first)
        : js.bytes - native.bytes;
      const evictJs = difference > 0 || (difference === 0
        && (js.entries[js.first]?.sequence ?? Infinity) < (native.entries[native.first]?.sequence ?? Infinity));
      const history = evictJs ? js : native;
      const entry = history.entries[history.first++];
      const size = entry.message.length + (entry.stack?.length ?? 0);
      history.bytes -= size; bytes -= size; retained--;
    }
    const evicted = this.entries.length - retained;
    if (evicted) {
      this.entries = this.entries.filter(entry => entry.sequence >= (histories[entry.source].entries[histories[entry.source].first]?.sequence ?? Infinity));
      countUiEvent("ui.logs.evicted", evicted);
    }
    recordUiTiming("ui.logs.retention", performance.now() - startedAt);
    this.publish();
  }

  setApps(apps: readonly DeviceApp[], foreground: ForegroundApp | null) {
    const startedAt = performance.now();
    const identities = new Map<number, string>();
    for (const app of apps) identities.set(app.pid, app.bundleId);
    if (foreground?.pid != null && foreground.bundleId) identities.set(foreground.pid, foreground.bundleId);
    let unchanged = identities.size === this.appIds.size;
    for (const [pid, bundleId] of identities) {
      const previous = this.appIds.get(pid);
      if (previous !== bundleId) { unchanged = false; break; }
    }
    if (unchanged) return;
    this.appIds = identities;
    let changed = false;
    for (let index = 0; index < this.entries.length; index++) {
      const entry = this.entries[index];
      if (entry.appId !== undefined || entry.pid === undefined || entry.origin === "metro") continue;
      const appId = identities.get(entry.pid);
      if (appId === undefined) continue;
      this.entries[index] = { ...entry, appId };
      changed = true;
    }
    const elapsed = performance.now() - startedAt;
    recordUiTiming("ui.logs.app_identity", elapsed);
    if (changed) this.publish();
  }

  clear() { this.entries = []; this.selectedSequence = undefined; this.dropped = 0; this.scrollOffset = 0; this.publish(); }
  search(query: string) {
    countUiEvent("ui.logs.search");
    this.query = query;
    const startedAt = performance.now();
    this.compiledQuery = compileLogQuery(query);
    const elapsed = performance.now() - startedAt;
    recordUiTiming("ui.logs.query_parse", elapsed);
    this.publish();
  }
  refreshAge() { if (this.compiledQuery.usesAge) this.publish(); }
  setFilters(kind: "sources" | "levels", values: string[]) { this[kind] = new Set(values); this.publish(); }
  setStacked(value: boolean) { this.stacked = value; this.publish(); }
  setFollow(value: boolean) {
    if (this.follow === value) return;
    this.follow = value;
    this.publish();
  }
  updateScroll(offset: number, contentHeight: number, viewportHeight: number, userInitiated: boolean) {
    const previousOffset = this.scrollOffset;
    this.scrollOffset = offset;
    if (!userInitiated) return;
    const distanceFromBottom = contentHeight - viewportHeight - offset;
    if (distanceFromBottom <= 1) this.setFollow(true);
    else if (offset < previousOffset) this.setFollow(false);
  }
  select(sequence?: number) {
    this.selectedSequence = sequence;
    if (sequence !== undefined) this.follow = false;
    this.attachmentStatus = "";
    this.publish();
  }

  async attach(remove = false) {
    const selected = this.snapshot.selected;
    if (this.attaching || (!remove && !selected) || !this.context.canAttach) return;
    this.attaching = true; this.publish();
    try {
      await this.context.attach(remove ? undefined : selected);
      const action = remove ? "ui.logs.attachment_removed" : "ui.logs.attached";
      countUiEvent(action);
      this.attachmentStatus = remove || !this.context.attachedKey ? "Attachment removed." : "Attached to your next chat message.";
    } catch (error) { captureUiError(error, "logs.attach"); this.attachmentStatus = error instanceof Error ? error.message : String(error); }
    finally { this.attaching = false; this.publish(); }
  }

  async sendToChat(log: StackedLog) {
    if (this.sending || !this.context.canSendMessage) return;
    this.sending = true; this.chatError = ""; this.publish();
    try { await this.context.sendLogToChat(log); countUiEvent("ui.logs.sent_to_chat"); }
    catch (error) { captureUiError(error, "logs.send_to_chat"); this.chatError = error instanceof Error ? error.message : String(error); }
    finally { this.sending = false; this.publish(); }
  }
}
