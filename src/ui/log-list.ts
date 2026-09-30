import type { LogEntry, StackedLog } from "../shared/logs.ts";
import { logKey, stackLogs } from "../shared/logs.ts";
import type { PanelContext } from "./model-context.ts";

function element<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(id) as T; }

export class LogList {
  private entries: LogEntry[] = [];
  private selectedSequence?: number;
  private selected?: StackedLog;
  private readonly sources = new Set(["js", "native"]);
  private readonly levels = new Set(["info", "warn", "error", "debug"]);
  private stacked = true;
  private follow = true;
  private attaching = false;
  private dropped = 0;
  private sequence = 0;
  private readonly list = element("logs-list");
  private readonly context: PanelContext;

  constructor(context: PanelContext) {
    this.context = context;
    document.querySelectorAll<HTMLButtonElement>("[data-log-source], [data-log-level]").forEach(button => {
      button.addEventListener("click", () => {
        const set = button.dataset.logSource ? this.sources : this.levels;
        const value = button.dataset.logSource ?? button.dataset.logLevel!;
        if (set.has(value)) set.delete(value); else set.add(value);
        button.setAttribute("aria-pressed", String(set.has(value))); this.render();
      });
    });
    element("logs-search").addEventListener("input", () => this.render());
    element("logs-stack").addEventListener("click", () => { this.stacked = !this.stacked; element("logs-stack").setAttribute("aria-pressed", String(this.stacked)); this.render(); });
    element("logs-follow").addEventListener("click", () => { this.follow = !this.follow; element("logs-follow").setAttribute("aria-pressed", String(this.follow)); if (this.follow) this.list.scrollTop = this.list.scrollHeight; });
    element("log-detail-close").addEventListener("click", () => { this.selectedSequence = undefined; this.render(); });
    element("log-attach").addEventListener("click", () => { void this.attach(); });
    element("logs-remove-attachment").addEventListener("click", () => { void this.attach(true); });
    this.context.onChange = () => this.renderDetail();
  }

  append(entries: LogEntry[], dropped: number) {
    if (!entries.length && !dropped) return;
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
    this.render();
  }

  clear() { this.entries = []; this.selectedSequence = undefined; this.dropped = 0; this.sequence = 0; this.render(); }

  render() {
    const scrollTop = this.list.scrollTop;
    const focused = document.activeElement instanceof HTMLElement && this.list.contains(document.activeElement)
      ? document.activeElement.dataset.sequence : undefined;
    const groups = this.stacked ? stackLogs(this.entries) : this.entries.map(log => ({ ...log, count: 1, lastTimestamp: log.timestamp }));
    const query = element<HTMLInputElement>("logs-search").value.toLowerCase();
    const filtered = groups.filter(log => this.sources.has(log.source) && this.levels.has(log.level)
      && [log.message, log.stack, log.process, log.tag, log.subsystem, log.category, log.origin].filter(Boolean).join(" ").toLowerCase().includes(query));
    this.selected = groups.find(log => log.sequence === this.selectedSequence);
    const rows = filtered.slice(-500).map(log => {
      const row = document.createElement("button"); row.className = "log-row cursor-interaction"; row.dataset.level = log.level; row.dataset.sequence = String(log.sequence);
      row.setAttribute("aria-pressed", String(log.sequence === this.selectedSequence));
      row.title = `${log.process ?? log.origin} · ${log.timestamp}\n${log.message}`;
      const fields = [
        ["log-time", new Date(log.lastTimestamp).toLocaleTimeString([], { hour12: false })],
        ["log-origin", log.source === "js" ? "JS" : "Native"], ["log-level", log.level], ["log-message", log.message],
      ];
      for (const [className, text] of fields) { const field = document.createElement("span"); field.className = className; field.textContent = text; row.append(field); }
      const count = document.createElement("span"); count.className = "log-repeat"; count.textContent = log.count > 1 ? String(log.count) : "";
      count.hidden = log.count <= 1; count.setAttribute("aria-label", `${log.count} occurrences`); row.append(count);
      row.addEventListener("click", () => { this.selectedSequence = log.sequence; element("log-attach-status").textContent = ""; this.render(); });
      return row;
    });
    if (!rows.length) { const empty = document.createElement("p"); empty.className = "logs-empty"; empty.textContent = this.entries.length ? "No logs match these filters." : "Waiting for logs. Start an app or choose a source."; this.list.replaceChildren(empty); }
    else this.list.replaceChildren(...rows);
    if (focused) rows.find(row => row.dataset.sequence === focused)?.focus({ preventScroll: true });
    element("logs-count").textContent = String(this.entries.length);
    element("logs-footer").textContent = `${filtered.length} ${this.stacked ? "groups" : "logs"} · ${this.entries.length} buffered${filtered.length > 500 ? " · Showing the latest 500" : ""}${this.dropped ? ` · ${this.dropped} older logs dropped before reading` : ""}`;
    this.list.scrollTop = this.follow ? this.list.scrollHeight : scrollTop;
    this.renderDetail();
  }

  private renderDetail() {
    const log = this.selected;
    element("log-detail").hidden = !log;
    element("logs-remove-attachment").hidden = !this.context.attachedKey;
    if (!log) return;
    const attached = this.context.attachedKey === logKey(log);
    element("log-detail-label").textContent = `${log.origin} · ${log.level} · ${log.count}×`;
    element("log-detail-message").textContent = [log.message, log.stack].filter(Boolean).join("\n\n");
    const attach = element<HTMLButtonElement>("log-attach");
    attach.textContent = attached ? "Attached to chat" : "Attach to chat";
    attach.disabled = this.attaching || attached || !this.context.canAttach;
    attach.title = this.context.canAttach ? "Include this log and stack trace with your next message" : "This host does not support log attachments";
    element<HTMLButtonElement>("logs-remove-attachment").disabled = this.attaching;
  }

  private async attach(remove = false) {
    if (this.attaching || (!remove && !this.selected)) return;
    this.attaching = true; this.renderDetail();
    try {
      await this.context.attach(remove ? undefined : this.selected);
      element("log-attach-status").textContent = remove || !this.context.attachedKey ? "Attachment removed." : "Attached. Ask the agent to fix this log in your next message.";
    } catch (error) { element("log-attach-status").textContent = error instanceof Error ? error.message : String(error); }
    finally { this.attaching = false; this.renderDetail(); }
  }
}
