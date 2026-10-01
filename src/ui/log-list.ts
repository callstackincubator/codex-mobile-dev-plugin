import type { LogEntry, StackedLog } from "../shared/logs.ts";
import { logKey, stackLogs } from "../shared/logs.ts";
import type { PanelContext } from "./model-context.ts";
import { countUiEvent, recordUiTiming, setUiGauge, captureUiError } from "./telemetry.ts";

export class LogList {
  scrollOffset = 0;
  private entries: LogEntry[] = [];
  private selectedSequence?: number;
  private sequence = 0;
  private dropped = 0;
  private readonly listeners = new Set<() => void>();
  private sources = new Set(["js", "native"]);
  private levels = new Set(["info", "warn", "error", "debug"]);
  private query = "";
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
    const groups: StackedLog[] = this.stacked ? stackLogs(this.entries) : this.entries.map(log => ({ ...log, count: 1, lastTimestamp: log.timestamp }));
    const query = this.query.toLowerCase();
    const filtered = groups.filter(log => this.sources.has(log.source) && this.levels.has(log.level)
      && [log.message, log.stack, log.process, log.tag, log.subsystem, log.category, log.origin].filter(Boolean).join(" ").toLowerCase().includes(query));
    const selected = groups.find(log => log.sequence === this.selectedSequence);
    return { filtered, selected, buffered: this.entries.length, dropped: this.dropped, sources: this.sources, levels: this.levels,
      query: this.query, stacked: this.stacked, follow: this.follow, attaching: this.attaching, attachmentStatus: this.attachmentStatus,
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
    this.entries.push(...entries.map(entry => ({ ...entry, sequence: ++this.sequence })));
    if (this.entries.length > 2000) this.entries.splice(0, this.entries.length - 2000);
    let bytes = 0;
    let first = this.entries.length;
    while (first > 0) {
      const entry = this.entries[first - 1];
      bytes += entry.message.length + (entry.stack?.length ?? 0);
      if (bytes > 2 * 1024 * 1024) break;
      first--;
    }
    if (first) this.entries.splice(0, first);
    this.publish();
  }

  clear() { this.entries = []; this.selectedSequence = undefined; this.dropped = 0; this.scrollOffset = 0; this.publish(); }
  search(query: string) { countUiEvent("ui.logs.search"); this.query = query; this.publish(); }
  setFilters(kind: "sources" | "levels", values: string[]) { this[kind] = new Set(values); this.publish(); }
  setStacked(value: boolean) { this.stacked = value; this.publish(); }
  setFollow(value: boolean) { this.follow = value; this.publish(); }
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
