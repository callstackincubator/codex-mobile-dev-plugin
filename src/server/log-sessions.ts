import { ExpectedOperationError } from "../shared/error-reporting.ts";
import { randomBytes } from "node:crypto";
import type { CrashWatchTarget, LogBatch, LogOptions } from "../shared/logs.ts";
import { crashWatchTargetSchema, expiredLogSessionMessage, logOptionsSchema } from "../shared/logs.ts";
import { LogBuffer } from "./log-buffer.ts";
import { crashWatchFor, startCrashWatch } from "./crash-reports.ts";
import { startNativeLogs } from "./native-logs.ts";
import type { LogSink, StopLogSource } from "./native-logs.ts";
import { startMetroLogs } from "./metro-logs.ts";

type Session = { buffer: LogBuffer; stops: StopLogSource[]; expires: number; waitMs: number };
export type LogSources = { native: typeof startNativeLogs; metro: typeof startMetroLogs; crashes: typeof startCrashWatch };

export class LogSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly closing = new Set<Promise<void>>();
  private disposed = false;
  private readonly expiry: NodeJS.Timeout;
  private readonly sources: LogSources;

  constructor(sources: LogSources = { native: startNativeLogs, metro: startMetroLogs, crashes: startCrashWatch }) {
    this.sources = sources;
    this.expiry = setInterval(() => {
      for (const [id, session] of this.sessions) if (session.expires < Date.now()) void this.closeSession(id);
    }, 10000);
    this.expiry.unref();
  }

  open(input: LogOptions): string {
    const options = logOptionsSchema.parse(input);
    const crashes = options.native && crashWatchFor(options.native);
    return this.start(1000, sink => [
      ...(options.native ? [this.sources.native(options.native, sink)] : []),
      ...(crashes ? [this.sources.crashes(crashes.target, crash => { if (crashes.includes(crash)) sink.log(crash); })] : []),
      ...(options.metro ? [this.sources.metro(options.metro, sink)] : []),
    ]);
  }

  /** Crash sessions carry few records, so reads wait longer before returning empty. */
  openCrashes(input: CrashWatchTarget): string {
    const target = crashWatchTargetSchema.parse(input);
    return this.start(20000, sink => [this.sources.crashes(target, sink.log)]);
  }

  private start(waitMs: number, sources: (sink: LogSink) => StopLogSource[]): string {
    if (this.disposed) throw new Error("The plugin server has closed.");
    if (this.sessions.size >= 8) throw new Error("Too many log streams. Close a log panel and retry.");
    const session: Session = { buffer: new LogBuffer(), stops: [], expires: Date.now() + 5 * 60 * 1000, waitMs };
    const id = randomBytes(32).toString("hex");
    this.sessions.set(id, session);
    const sink: LogSink = { log: entry => session.buffer.push(entry), status: status => session.buffer.status(status) };
    try { session.stops.push(...sources(sink)); }
    catch (error) { void this.closeSession(id); throw error; }
    return id;
  }

  private touch(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) throw new ExpectedOperationError("session_expired", `${expiredLogSessionMessage} Reopen the log panel.`);
    session.expires = Date.now() + 5 * 60 * 1000;
    return session;
  }

  keepAlive(id: string) { this.touch(id); }

  async read(id: string, after: number, waitMs?: number): Promise<LogBatch> {
    const session = this.touch(id);
    return session.buffer.read(after, waitMs ?? session.waitMs);
  }

  async closeSession(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id); session.buffer.close();
    const closing = Promise.allSettled(session.stops.map(stop => Promise.resolve().then(stop))).then(() => {});
    this.closing.add(closing);
    try { await closing; } finally { this.closing.delete(closing); }
  }

  async close() {
    this.disposed = true; clearInterval(this.expiry);
    await Promise.all([...this.sessions.keys()].map(id => this.closeSession(id)));
    await Promise.all(this.closing);
  }
}
