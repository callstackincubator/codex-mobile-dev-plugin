import { spawn, type ChildProcessByStdio } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

type WorkerProcess = ChildProcessByStdio<Writable, Readable, null>;

function readLines(stream: Readable, onLine: (line: string) => void) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", chunk => {
    buffer += chunk;
    let idx = buffer.indexOf("\n");
    while (idx !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      if (line.length > 0) onLine(line);
      idx = buffer.indexOf("\n");
    }
  });
  stream.on("end", () => {
    const tail = buffer.replace(/\r$/, "");
    if (tail.length > 0) onLine(tail);
  });
}

function tryParseJson(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Keeps Antigravity's stdio MCP pipe open while swapping the underlying server
 * worker whenever files in `dist/` update, then emits list_changed notifications.
 */
export async function runHotReloadSupervisor(entryUrl: string): Promise<void> {
  const entryPath = fileURLToPath(entryUrl);
  const distDir = dirname(entryPath);
  const pinPath = join(distDir, "panel-runtime.json");

  let activeWorker: WorkerProcess | null = null;
  let savedInitialize: Record<string, unknown> | null = null;
  let hasInitialized = false;
  let reloading = false;
  let reloadQueued = false;
  let shuttingDown = false;
  let pendingLines: string[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher | undefined;
  let distIno: number | undefined;
  let currentStamp: string | null = null;

  async function readStamp(): Promise<string | null> {
    const serverStat = await stat(entryPath).catch(() => null);
    if (!serverStat) return null;
    const pinStat = await stat(pinPath).catch(() => null);
    const pinPart = pinStat ? `${pinStat.mtimeMs}:${pinStat.size}` : "none";
    return `${serverStat.ino}:${serverStat.mtimeMs}:${serverStat.size}|${pinPart}`;
  }

  function spawnWorker(): WorkerProcess {
    return spawn(process.execPath, [...process.execArgv, entryPath], {
      env: { ...process.env, MOBILE_DEV_SERVER_WORKER: "1" },
      stdio: ["pipe", "pipe", "inherit"],
    });
  }

  function attachActiveOutput(worker: WorkerProcess) {
    readLines(worker.stdout, line => {
      process.stdout.write(`${line}\n`);
    });
  }

  function flushPendingToActive() {
    if (!activeWorker?.stdin.writable || pendingLines.length === 0) return;
    const lines = pendingLines;
    pendingLines = [];
    for (const line of lines) {
      activeWorker.stdin.write(`${line}\n`);
    }
  }

  function attachCrashHandler(worker: WorkerProcess) {
    worker.once("exit", () => {
      if (shuttingDown) return;
      if (worker === activeWorker && !reloading) {
        activeWorker = null;
        setTimeout(() => {
          if (shuttingDown) return;
          if (savedInitialize !== null) {
            void reloadWorker();
          } else {
            const fresh = spawnWorker();
            activeWorker = fresh;
            attachActiveOutput(fresh);
            attachCrashHandler(fresh);
            flushPendingToActive();
          }
        }, 500).unref();
      }
    });
  }

  async function waitForEntry(): Promise<boolean> {
    for (let i = 0; i < 40; i++) {
      if (shuttingDown) return false;
      const entry = await stat(entryPath).catch(() => null);
      if (entry) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }

  async function warmupWorker(worker: WorkerProcess, initMessage: Record<string, unknown>): Promise<boolean> {
    return await new Promise<boolean>(resolve => {
      let settled = false;
      const bufferedAfterInit: string[] = [];
      let initDone = false;

      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (ok) {
          for (const extra of bufferedAfterInit) {
            process.stdout.write(`${extra}\n`);
          }
        }
        resolve(ok);
      };

      const timeout = setTimeout(() => finish(false), 15_000);
      timeout.unref();

      worker.once("exit", () => finish(false));
      worker.once("error", () => finish(false));

      readLines(worker.stdout, line => {
        if (settled) {
          process.stdout.write(`${line}\n`);
          return;
        }
        if (!initDone) {
          const msg = tryParseJson(line);
          if (msg && msg.id === "__mobile_dev_reload_init__") {
            initDone = true;
            finish(msg.error === undefined);
            return;
          }
        }
        if (initDone) {
          bufferedAfterInit.push(line);
        }
      });

      const syntheticInit = JSON.stringify({ ...initMessage, id: "__mobile_dev_reload_init__" });
      worker.stdin.write(`${syntheticInit}\n`);
    });
  }

  async function reloadWorker(): Promise<void> {
    if (shuttingDown || savedInitialize === null) return;
    if (reloading) {
      reloadQueued = true;
      return;
    }
    reloading = true;
    try {
      const ready = await waitForEntry();
      if (!ready || shuttingDown) return;

      const nextWorker = spawnWorker();
      const ok = await warmupWorker(nextWorker, savedInitialize);
      if (!ok || shuttingDown) {
        try { nextWorker.kill("SIGTERM"); } catch {}
        return;
      }

      if (hasInitialized) {
        nextWorker.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
      }

      const oldWorker = activeWorker;
      activeWorker = nextWorker;
      attachCrashHandler(nextWorker);
      reloading = false;
      flushPendingToActive();

      if (oldWorker) {
        try { oldWorker.stdin.end(); } catch {}
        setTimeout(() => {
          try { oldWorker.kill("SIGTERM"); } catch {}
        }, 5000).unref();
      }

      process.stdout.write('{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n');
      process.stdout.write('{"jsonrpc":"2.0","method":"notifications/resources/list_changed"}\n');
    } finally {
      reloading = false;
      flushPendingToActive();
      if (reloadQueued && !shuttingDown) {
        reloadQueued = false;
        void reloadWorker();
      }
    }
  }

  function scheduleReload() {
    if (shuttingDown || savedInitialize === null) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void reloadWorker();
    }, 800);
    debounceTimer.unref();
  }

  async function checkUpdates() {
    if (shuttingDown) return;
    const dirStat = await stat(distDir).catch(() => null);
    if (dirStat && dirStat.ino !== distIno) {
      distIno = dirStat.ino;
      attachWatcher();
    }
    const nextStamp = await readStamp();
    if (nextStamp !== null && nextStamp !== currentStamp) {
      currentStamp = nextStamp;
      scheduleReload();
    }
  }

  function attachWatcher() {
    watcher?.close();
    watcher = undefined;
    try {
      watcher = watch(distDir, (_event, filename) => {
        if (!filename || filename === "server.mjs" || filename === "panel-runtime.json") {
          void checkUpdates();
        }
      });
      watcher.on("error", () => {
        watcher?.close();
        watcher = undefined;
      });
    } catch {
      watcher = undefined;
    }
  }

  currentStamp = await readStamp();
  distIno = (await stat(distDir).catch(() => null))?.ino;
  attachWatcher();

  const initialWorker = spawnWorker();
  activeWorker = initialWorker;
  attachActiveOutput(initialWorker);
  attachCrashHandler(initialWorker);

  const pollTimer = setInterval(() => {
    void checkUpdates();
  }, 2500);
  pollTimer.unref();

  let resolveExit!: () => void;
  const done = new Promise<void>(resolve => { resolveExit = resolve; });

  function shutdown(signal?: NodeJS.Signals) {
    if (shuttingDown) return;
    shuttingDown = true;
    clearTimeout(debounceTimer);
    clearInterval(pollTimer);
    watcher?.close();
    const worker = activeWorker;
    if (!worker) {
      resolveExit();
      return;
    }
    const timer = setTimeout(() => {
      try { worker.kill("SIGKILL"); } catch {}
      resolveExit();
    }, 5000);
    timer.unref();
    worker.once("exit", () => {
      clearTimeout(timer);
      resolveExit();
    });
    try { worker.stdin.end(); } catch {}
    if (signal) {
      try { worker.kill(signal); } catch {}
    }
  }

  readLines(process.stdin, line => {
    if (shuttingDown) return;
    const msg = tryParseJson(line);
    if (msg?.method === "initialize" && msg.id !== undefined) {
      savedInitialize = msg;
    } else if (msg?.method === "notifications/initialized") {
      hasInitialized = true;
    }
    if (reloading || !activeWorker?.stdin.writable) {
      pendingLines.push(line);
      return;
    }
    activeWorker.stdin.write(`${line}\n`);
  });

  process.stdin.on("end", () => shutdown());
  process.stdin.on("close", () => shutdown());
  const onSigTerm = () => shutdown("SIGTERM");
  const onSigInt = () => shutdown("SIGINT");
  process.once("SIGTERM", onSigTerm);
  process.once("SIGINT", onSigInt);

  await done;
  process.off("SIGTERM", onSigTerm);
  process.off("SIGINT", onSigInt);
}
