import { GdbConnection } from "./gdb.ts";
import { openSimulatorDebugserver } from "./simulator.ts";
import { CpuCounterSampler, parseCpuCounters, type CpuReading } from "./counters.ts";
export type { CpuReading } from "./counters.ts";

// debugserver's profiling timer passes the fractional microseconds to a
// nanosecond parameter. Whole-second intervals avoid excessive sampling.
const PROFILE_INTERVAL_US = 1_000_000;

function profilingCommand(enabled: boolean): string {
  const value = enabled ? 1 : 0;
  return `QSetEnableAsyncProfiling;enable:${value};interval_usec:${PROFILE_INTERVAL_US};scan_type:0x4e;`;
}

function profilingSignalResume(packet: string): string | null {
  // Darwin SIGPROF is 27 (0x1b). Hermes waits for its handler to finish each
  // sample, so suppressing this signal during resume or detach deadlocks JS.
  if (!/^[TS]1b/i.test(packet)) return null;
  const thread = /(?:^T1b|;)thread:([0-9a-f]+)(?:;|$)/i.exec(packet);
  if (!thread) throw new Error("Debugserver reported SIGPROF without its target thread.");
  // Deliver only to the interrupted thread; all other threads resume without
  // an injected signal. Keep the 64-bit thread ID in its original hex form.
  return `vCont;C1b:${thread[1]};c`;
}

export type CpuMonitor = {
  stop(): Promise<void>;
  closed: Promise<Error>;
};

export async function startIosCpuMonitor(options: {
  pid: number;
  signal: AbortSignal;
  onSample: (sample: CpuReading) => void;
}, openTransport = openSimulatorDebugserver): Promise<CpuMonitor> {
  if (!Number.isSafeInteger(options.pid) || options.pid <= 0) throw new Error("The selected iOS app is not running.");
  const transport = await openTransport(options.signal);
  let debuggerConnection: GdbConnection | undefined;
  let attached = false;
  let running = false;
  let stopping: Promise<void> | undefined;
  let end!: (error: Error) => void;
  const closed = new Promise<Error>((resolve) => { end = resolve; });

  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      try {
        if (debuggerConnection && attached) {
          do {
            while (running) {
              const response = await debuggerConnection.interrupt();
              const resume = profilingSignalResume(response);
              if (resume) {
                // SIGPROF can race our interrupt. Deliver it before interrupting
                // again; detaching at this stop would discard Hermes's sample.
                debuggerConnection.send(resume);
                continue;
              }
              if (!/^[TS]/.test(response)) throw new Error("Unexpected stop response during CPU monitor detach.");
              running = false;
            }
            const disable = profilingCommand(false);
            await debuggerConnection.expectOK(disable);
            // A queued signal may have resumed the app while awaiting OK.
          } while (running);
          await debuggerConnection.expectOK("D");
          attached = false;
        }
      } finally {
        debuggerConnection?.close();
        await transport.close();
      }
    })();
    return stopping;
  };

  try {
    const gdb = new GdbConnection(transport.socket);
    debuggerConnection = gdb;
    void gdb.closed.then((error) => { end(error); });
    void transport.exited.then(() => {
      if (stopping) return;
      gdb.close();
      const error = new Error("The iOS CPU monitor connection closed.");
      end(error);
    });
    gdb.onStop = (packet) => {
      const resume = profilingSignalResume(packet);
      if (resume) {
        running = true;
        gdb.send(resume);
        return;
      }
      running = false;
      attached = /^[TS]/.test(packet);
      const error = new Error("The app stopped or exited. CPU monitoring ended.");
      end(error);
      void stop().catch(() => {});
    };
    const sampler = new CpuCounterSampler();
    let firstSample!: () => void;
    const ready = new Promise<void>((resolve) => { firstSample = resolve; });
    gdb.onProfile = (profile) => {
      const counters = parseCpuCounters(profile);
      const sample = sampler.sample(counters);
      options.onSample(sample);
      firstSample();
    };
    await gdb.initialize();
    const hexPid = options.pid.toString(16);
    const result = await gdb.request(`vAttach;${hexPid}`, 10000);
    if (!/^[TS]/.test(result)) {
      throw new Error("Could not attach to the app. Use a development-signed build with get-task-allow, and detach Xcode/LLDB first.");
    }
    attached = true;
    options.signal.throwIfAborted();
    const enable = profilingCommand(true);
    await gdb.expectOK(enable);
    // An app already profiling at attach time can stop on SIGPROF instead of
    // the attach signal. Its first resume must preserve that sample as well.
    const resume = profilingSignalResume(result) ?? "c";
    running = true;
    gdb.send(resume);
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      startupTimer = setTimeout(() => {
        const error = new Error("This iOS debugserver did not produce live per-thread CPU counters.");
        reject(error);
      }, 5000);
    });
    const disconnected = closed.then((error) => { throw error; });
    try { await Promise.race([ready, timeout, disconnected]); }
    finally { clearTimeout(startupTimer); }
    options.signal.throwIfAborted();
    return { stop, closed };
  } catch (error) {
    try { await stop(); } catch { /* The pre-attach detach-on-error setting also protects a dropped connection. */ }
    throw error;
  }
}
