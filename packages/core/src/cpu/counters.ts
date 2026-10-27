export type ThreadCounter = { id: string; name: string; cpuTimeUs: bigint };
export type CpuCounters = {
  timestampUs: bigint;
  retiredCpuTimeUs: bigint;
  memoryBytes: number;
  threads: ThreadCounter[];
};
export type CpuReading = {
  timestampUs: bigint;
  intervalUs: number;
  cpuPercent: number | null;
  memoryBytes: number;
  threads: Array<{ id: string; name: string; cpuPercent: number | null }>;
};

function counter(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error("Invalid CPU time counter from debugserver.");
  return BigInt(value);
}

export function parseCpuCounters(profile: string): CpuCounters {
  let timestampUs: bigint | undefined;
  let retiredCpuTimeUs: bigint | undefined;
  let memoryBytes: number | undefined;
  const threads: ThreadCounter[] = [];
  const ids = new Set<string>();
  let thread: Partial<ThreadCounter> | null = null;
  const finishThread = () => {
    if (!thread) return;
    if (!thread.id || thread.cpuTimeUs === undefined) throw new Error("Incomplete per-thread CPU counters.");
    if (ids.has(thread.id)) throw new Error("Duplicate thread ID in CPU counters.");
    ids.add(thread.id);
    threads.push({ id: thread.id, name: thread.name ?? "", cpuTimeUs: thread.cpuTimeUs });
  };
  const fields = profile.split(";");
  for (const field of fields) {
    const separator = field.indexOf(":");
    if (separator < 0) continue;
    const key = field.slice(0, separator);
    const value = field.slice(separator + 1);
    switch (key) {
      case "elapsed_usec": timestampUs = counter(value); break;
      case "task_used_usec": retiredCpuTimeUs = counter(value); break;
      case "phys_footprint": {
        if (!/^\d+$/.test(value)) throw new Error("Invalid memory footprint from debugserver.");
        memoryBytes = Number(value);
        if (Number.isSafeInteger(memoryBytes) === false) throw new Error("Memory footprint exceeds the supported byte range.");
        break;
      }
      case "thread_used_id": {
        finishThread();
        if (!/^[\da-f]+$/i.test(value)) throw new Error("Invalid CPU thread ID.");
        const id = BigInt(`0x${value}`);
        thread = { id: id.toString(16) };
        break;
      }
      case "thread_used_usec": {
        if (!thread) throw new Error("Thread CPU time has no thread ID.");
        thread.cpuTimeUs = counter(value);
        break;
      }
      case "thread_used_name": {
        if (!thread || !/^(?:[\da-f]{2})*$/i.test(value)) throw new Error("Invalid CPU thread name.");
        const bytes = Buffer.from(value, "hex");
        thread.name = bytes.toString("utf8");
        break;
      }
    }
  }
  finishThread();
  if (timestampUs === undefined || retiredCpuTimeUs === undefined || threads.length === 0) {
    throw new Error("Debugserver did not return process and per-thread CPU counters.");
  }
  if (memoryBytes === undefined) throw new Error("Debugserver did not return the app's physical memory footprint.");
  return { timestampUs, retiredCpuTimeUs, memoryBytes, threads };
}

function processTime(profile: CpuCounters): bigint {
  // TASK_BASIC_INFO contains terminated-thread CPU time. Include live threads
  // to retain a monotonic process total across worker-thread exits.
  let total = profile.retiredCpuTimeUs;
  for (const thread of profile.threads) total += thread.cpuTimeUs;
  return total;
}

function percentage(current: bigint, previous: bigint, intervalUs: number): number | null {
  if (current < previous) return null;
  const elapsed = Number(current - previous);
  return elapsed / intervalUs * 100;
}

export class CpuCounterSampler {
  private previous: CpuCounters | null = null;

  sample(profile: CpuCounters): CpuReading {
    const previous = this.previous;
    this.previous = profile;
    const delta = previous ? profile.timestampUs - previous.timestampUs : 0n;
    // The device stamps these records with gettimeofday. Clock changes and
    // long disconnections start a fresh baseline instead of producing spikes.
    const validInterval = delta > 0n && delta <= 10_000_000n;
    const intervalUs = validInterval ? Number(delta) : 0;
    const previousThreads = new Map<string, ThreadCounter>();
    if (previous && validInterval) {
      for (const thread of previous.threads) previousThreads.set(thread.id, thread);
    }
    let cpuPercent: number | null = null;
    if (previous && validInterval) {
      const currentTime = processTime(profile);
      const previousTime = processTime(previous);
      cpuPercent = percentage(currentTime, previousTime, intervalUs);
    }
    const threads = profile.threads.map((thread) => {
      const earlier = previousThreads.get(thread.id);
      const usage = earlier ? percentage(thread.cpuTimeUs, earlier.cpuTimeUs, intervalUs) : null;
      return { id: thread.id, name: thread.name, cpuPercent: usage };
    });
    return { timestampUs: profile.timestampUs, intervalUs, cpuPercent, memoryBytes: profile.memoryBytes, threads };
  }
}
