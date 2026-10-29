import type { LogBatch, LogOptions } from "@mobile-dev/shared/logs.ts";
import { logOptionsSchema } from "@mobile-dev/shared/logs.ts";
import { LogBuffer } from "./log-buffer.ts";
import { startNativeLogs } from "./native-logs.ts";
import type { LogSink, StopLogSource } from "./native-logs.ts";
import { startMetroLogs } from "./metro-logs.ts";
import { SessionRegistry } from "./session-registry.ts";

type Session = { options: LogOptions; buffer: LogBuffer; stops: StopLogSource[] };
export type LogSources = { native: typeof startNativeLogs; metro: typeof startMetroLogs };

export class LogSessions {
  private readonly sessions = new SessionRegistry<Session>({
    limit: 8, name: "Log session",
    limitMessage: "Too many log streams. Close a log panel and retry.",
    expiredMessage: "This log session expired or closed. Reopen the log panel.",
    deviceId: session => session.options.native?.deviceId,
    stop: async session => {
      session.buffer.close();
      await Promise.allSettled(session.stops.map(stop => Promise.resolve().then(stop)));
    },
  });
  private readonly sources: LogSources;

  constructor(sources: LogSources = { native: startNativeLogs, metro: startMetroLogs }) { this.sources = sources; }

  open(input: LogOptions): string {
    const options = logOptionsSchema.parse(input);
    const session: Session = { options, buffer: new LogBuffer(), stops: [] };
    const id = this.sessions.add(session);
    const sink: LogSink = { log: entry => session.buffer.push(entry), status: status => session.buffer.status(status) };
    try {
      if (options.native) session.stops.push(this.sources.native(options.native, sink));
      if (options.metro) session.stops.push(this.sources.metro(options.metro, sink));
    } catch (error) { void this.closeSession(id); throw error; }
    return id;
  }

  keepAlive(id: string) { this.sessions.get(id); }

  async read(id: string, after: number, waitMs = 1000, signal?: AbortSignal): Promise<LogBatch> {
    return this.sessions.get(id).buffer.read(after, waitMs, signal);
  }

  closeSession(id: string) { return this.sessions.closeSession(id); }
  closeDevice(deviceId: string) { return this.sessions.closeDevice(deviceId); }
  close() { return this.sessions.close(); }
}
