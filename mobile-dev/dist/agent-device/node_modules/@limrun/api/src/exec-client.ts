/**
 * Client for executing commands on limbuild server with streaming output.
 *
 * The interface is designed to be similar to Node.js's child_process.spawn()
 * for familiarity and ease of extension.
 */

import { createEventSource, type EventSourceClient, type EventSourceMessage } from 'eventsource-client';
import { nodeProxyTransport } from './internal/proxy-transport';

// =============================================================================
// Types
// =============================================================================

export type ExecRequest = {
  command: 'xcodebuild';
  xcodebuild?: {
    workspace?: string;
    project?: string;
    scheme?: string;
  };
  signedUploadUrl?: string;
  additionalMetadata?: {
    signedDownloadUrl?: string;
  };
};

export type ExecOptions = {
  apiUrl: string;
  token: string;
  log?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void;
};

export type ExecResult = {
  exitCode: number;
  execId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  signedDownloadUrl?: string;
};

type DataListener = (chunk: string) => void;
type CloseListener = () => void;
type ExitListener = (code: number) => void;

/**
 * A Readable-like stream interface, similar to Node.js stream.Readable.
 * Emits 'data' for each chunk and 'close' when the stream ends.
 */
export class ReadableStream {
  private dataListeners: DataListener[] = [];
  private closeListeners: CloseListener[] = [];
  private closed = false;

  on(event: 'data', listener: DataListener): this;
  on(event: 'close', listener: CloseListener): this;
  on(event: 'data' | 'close', listener: DataListener | CloseListener): this {
    if (event === 'data') {
      this.dataListeners.push(listener as DataListener);
    } else if (event === 'close') {
      this.closeListeners.push(listener as CloseListener);
    }
    return this;
  }

  /** @internal */
  emit(event: 'data', chunk: string): void;
  emit(event: 'close'): void;
  emit(event: 'data' | 'close', arg?: string): void {
    if (event === 'data' && typeof arg === 'string') {
      for (const l of this.dataListeners) l(arg);
    } else if (event === 'close' && !this.closed) {
      this.closed = true;
      for (const l of this.closeListeners) l();
    }
  }
}

/**
 * A ChildProcess-like object similar to Node.js's ChildProcess.
 *
 * Implements PromiseLike so it can be awaited directly.
 *
 * @example
 * // Stream-based (like Node.js spawn)
 * const proc = exec({ command: 'xcodebuild' }, options);
 * proc.command.on('data', (chunk) => console.log('[command]', chunk));
 * proc.stdout.on('data', (chunk) => process.stdout.write(chunk));
 * proc.stderr.on('data', (chunk) => process.stderr.write(chunk));
 * proc.on('exit', (code) => console.log(`Exited with code ${code}`));
 *
 * // Promise-based (can be awaited)
 * const { exitCode, status } = await proc;
 */
export class ExecChildProcess implements PromiseLike<ExecResult> {
  /** Command stream - emits the executed command and then closes */
  readonly command = new ReadableStream();

  /** Stdout stream - emits 'data' and 'close' events */
  readonly stdout = new ReadableStream();

  /** Stderr stream - emits 'data' and 'close' events */
  readonly stderr = new ReadableStream();

  /** The remote process/build identifier (similar to pid in Node.js) */
  execId: string | undefined;

  private readonly resultPromise: Promise<ExecResult>;
  private readonly exitListeners: ExitListener[] = [];
  private abortController = new AbortController();
  private sseConnection: EventSourceClient | null = null;
  private killed = false;
  private readonly options: ExecOptions;
  private readonly log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void;

  constructor(request: ExecRequest | Promise<ExecRequest>, options: ExecOptions) {
    this.options = options;
    this.log = options.log ?? (() => {});
    if (request instanceof Promise) {
      this.resultPromise = request.then((r) => this.run(r));
    } else {
      this.resultPromise = this.run(request);
    }
  }

  /** Implement PromiseLike so this object can be awaited */
  then<TResult1 = ExecResult, TResult2 = never>(
    onfulfilled?: ((value: ExecResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.resultPromise.then(onfulfilled, onrejected);
  }

  /** Catch errors */
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<ExecResult | TResult> {
    return this.resultPromise.catch(onrejected);
  }

  /** Finally handler */
  finally(onfinally?: (() => void) | null): Promise<ExecResult> {
    return this.resultPromise.finally(onfinally);
  }

  /** Listen for process events */
  on(event: 'exit', listener: ExitListener): this {
    if (event === 'exit') {
      this.exitListeners.push(listener);
    }
    return this;
  }

  /** Send a signal to terminate the process */
  async kill(): Promise<void> {
    this.killed = true;
    this.abortController.abort();
    if (this.sseConnection) {
      this.sseConnection.close();
      this.sseConnection = null;
    }
    if (!this.execId) {
      this.log('warn', 'Failed to cancel build: execId is not set');
      return;
    }
    try {
      await nodeProxyTransport.fetch(`${this.options.apiUrl}/exec/${this.execId}/cancel`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.token}`,
        },
      });
      this.log('info', 'Build cancelled');
    } catch (err) {
      this.log('warn', `Failed to cancel build: ${err}`);
    }
  }

  private async run(request: ExecRequest): Promise<ExecResult> {
    const { log } = this;
    const { apiUrl, token } = this.options;

    // 1. Trigger the build via POST /exec
    let execRes: Response;
    try {
      execRes = await nodeProxyTransport.fetch(`${apiUrl}/exec`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(request),
        signal: this.abortController.signal,
      });
    } catch (err) {
      if (this.killed) {
        this.command.emit('close');
        this.stdout.emit('close');
        this.stderr.emit('close');
        for (const listener of this.exitListeners) {
          listener(-1);
        }
        return { exitCode: -1, execId: '', status: 'CANCELLED' };
      }
      throw err;
    }

    if (!execRes.ok) {
      const text = await execRes.text();
      throw new Error(`exec failed: ${execRes.status} ${text}`);
    }

    const execData = (await execRes.json()) as { execId: string };
    this.execId = execData.execId;
    log('debug', `Build started: ${this.execId}`);

    // 2. Stream logs via SSE and wait for exit code
    const eventsUrl = `${apiUrl}/exec/${this.execId}/events`;

    const timeoutMs = 3600 * 1000; // 1 hour max
    let exitCode: number;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      exitCode = await Promise.race([
        this.connectSSE(eventsUrl),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('SSE timeout')), timeoutMs);
        }),
      ]);
    } catch {
      if (this.killed) {
        log('debug', 'Build killed');
        exitCode = -1;
      } else {
        log('warn', 'SSE completion timeout');
        exitCode = 1;
      }
    } finally {
      clearTimeout(timeoutId);
      if (this.sseConnection) {
        this.sseConnection.close();
        this.sseConnection = null;
      }
    }

    // Emit close events on streams
    this.command.emit('close');
    this.stdout.emit('close');
    this.stderr.emit('close');

    // Emit exit event
    for (const listener of this.exitListeners) {
      listener(exitCode);
    }

    // Determine status from exit code
    const status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' =
      exitCode === 0 ? 'SUCCEEDED'
      : exitCode === -1 ? 'CANCELLED'
      : 'FAILED';

    const result: ExecResult = {
      exitCode,
      execId: this.execId!,
      status,
      ...(request.additionalMetadata ?? {}),
    };

    this.log('debug', `Build finished: ${result.status} (exit ${result.exitCode})`);
    return result;
  }

  /**
   * Opens an SSE connection and routes streamed events to the exposed command/stdout/stderr streams.
   * Resolves with the exit code when an 'exitCode' event arrives.
   * Rejects when the abort signal fires (kill or cleanup).
   */
  private connectSSE(eventsUrl: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      if (this.abortController.signal.aborted) {
        reject(new Error('killed'));
        return;
      }

      try {
        const eventSource = createEventSource({
          url: eventsUrl,
          fetch: nodeProxyTransport.fetch,
          headers: { Authorization: `Bearer ${this.options.token}` },
          onMessage: (message: EventSourceMessage) => {
            const data = typeof message.data === 'string' ? message.data : String(message.data ?? '');
            const eventType = message.event;
            if (eventType === 'command') {
              this.command.emit('data', data);
            } else if (eventType === 'stdout') {
              this.stdout.emit('data', data);
            } else if (eventType === 'stderr') {
              this.stderr.emit('data', data);
            } else if (eventType === 'exitCode') {
              const exitCode = parseInt(data, 10);
              if (Number.isNaN(exitCode)) {
                this.log('warn', `SSE exitCode event has invalid data: ${data}`);
                return;
              }
              this.log('debug', `Build completed via SSE: exitCode=${exitCode}`);
              resolve(exitCode);
            }
          },
          onDisconnect: () => {
            if (!this.killed) {
              this.log('warn', 'SSE disconnected');
            }
          },
        });
        this.sseConnection = eventSource;

        this.abortController.signal.addEventListener('abort', () => reject(new Error('killed')), {
          once: true,
        });
      } catch (err) {
        if (!this.killed) {
          this.log('warn', `SSE setup failed: ${err}`);
        }
        reject(err);
      }
    });
  }
}

/**
 * Execute a command on the limbuild server.
 * Returns a ChildProcess-like object with stdout/stderr streams.
 *
 * @example
 * const proc = exec({ command: 'xcodebuild' }, { apiUrl: '...', token: '...' });
 *
 * // Stream output
 * proc.command.on('data', (chunk) => console.log('[command]', chunk));
 * proc.stdout.on('data', (chunk) => console.log('[stdout]', chunk));
 * proc.stderr.on('data', (chunk) => console.error('[stderr]', chunk));
 *
 * // Wait for completion
 * const { exitCode, status } = await proc;
 */
export function exec(request: ExecRequest | Promise<ExecRequest>, options: ExecOptions): ExecChildProcess {
  return new ExecChildProcess(request, options);
}
