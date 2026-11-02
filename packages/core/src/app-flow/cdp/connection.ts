/**
 * A persistent connection to the app under test's JS runtime, through Metro's debugger socket.
 *
 * This replaces one `agent-device cdp runtime eval` process per evaluation (~0.5s each, measured)
 * whose returned string **truncates at exactly 200 characters**, and the chunking protocol
 * `nav-state.ts` built to live with that. Here a command's reply never travels as an evaluation
 * result at all: the app calls a per-connection binding installed with `Runtime.addBinding`, and the
 * payload arrives as a `Runtime.bindingCalled` event with no length limit short of the socket's
 * `maxPayload`. The design follows `codex-mobile-dev-plugin/src/server/app-flow/connection.ts`; this
 * file is that module minus its presentation/portal orchestration, plus the reconnect it leaves to
 * its callers.
 *
 * ## Two layers, and where reconnect lives
 *
 * - `CdpLink` is **one socket and one installed agent**. It never recovers: when anything goes wrong
 *   (socket closed, the app reloaded, the agent vanished, three heartbeats missed) it fails every
 *   pending call with a typed `CdpConnectionLostError` and reports itself lost, once.
 * - `CdpConnection` owns a link and **replaces it** when it is lost.
 *
 * The reference fails the connection on `Runtime.executionContextsCleared` and leaves the retry to
 * a loop three layers up (`runs.ts`, backoff `min(500 * 2^min(attempt-1, 4), 5000)`). That works for
 * them because a reload ends a capture run. Our sweep **relaunches the app routinely** and has to
 * carry on, and every consumer of this transport would otherwise need its own copy of that loop. So
 * it lives here, in the layer that already knows the facts a retry needs:
 *
 * - **A relaunch changes the debugger URL.** Metro reassigns target ids across app restarts, so
 *   reconnecting to the old URL cannot work; each attempt calls `resolveTarget()` again, which is
 *   where `reidentifyTarget` (discovery.ts) matches the app by identity rather than by id.
 * - **The agent is gone and must be re-installed**, which is the link's own handshake.
 * - **The lease means the old agent expires by itself**, so there is nothing to clean up on the old
 *   socket: a reconnect is only ever "start again".
 *
 * What recovery deliberately does **not** do is retry the command that was in flight. After a
 * reload we cannot know whether it ran, and today's three commands are reads but the next ones
 * will not be. That command rejects with `CdpConnectionLostError`; the caller, which knows whether
 * its command is idempotent, decides. A command issued *while* recovery is running waits for it
 * (bounded by its own timeout) instead of failing, because that is the "relaunch mid-sweep" case.
 *
 * `reconnect()` is also public. After `maxReconnectAttempts` failed attempts the connection stops
 * trying and reports `failed`; the caller, which knows Metro is back or the app was started again,
 * re-arms it explicitly rather than having a background loop run forever against a dead Metro.
 *
 * ## Correlation: one counter, two kinds of id
 *
 * A single sequence feeds both kinds of request so ids never collide. **Positive ids** are plain CDP
 * calls (`Runtime.enable`, `Runtime.addBinding`, the install evaluate) and their result is the
 * message with that `id`. **Negative ids** are app commands. A command is itself a `Runtime.evaluate`
 * sent under its negative id, but the evaluate's own result is empty (the wrapper returns nothing);
 * the answer arrives later as `Runtime.bindingCalled` carrying the same id inside its JSON payload.
 * So `message.id > 0` resolves a CDP call, a binding event resolves a command, and a CDP-level
 * `error` or `result.exceptionDetails` on *either* kind rejects by `message.id`. That last rule is
 * what lets a Hermes compile failure of the command wrapper land on the right promise instead of
 * stranding it until its timeout.
 *
 * ## Surrogates (mandatory, not an optimisation)
 *
 * The reference documents a real bug: the debugger path re-encodes a raw non-BMP character (an
 * emoji) into two separate surrogate code units that Hermes cannot compile. So every evaluated
 * expression has every surrogate rewritten as a `\uXXXX` escape. That is only valid where the
 * character sits inside a string, regex, template or comment, which is the only place source
 * carries user text. Command values additionally go through `toWellFormed()` as they are
 * serialised, so a lone surrogate (which JSON would carry as an escape the app would then rebuild
 * into an unpaired unit) becomes U+FFFD at the boundary instead of travelling at all.
 *
 * ## Expiry in the app's own clock
 *
 * A command that waited in a socket buffer behind a busy JS thread can run long after the host gave
 * up on it, which for a navigation is the worst outcome (it happens, late, with nobody waiting). The
 * install handshake therefore returns the app's clock reading, the host computes
 * `appClock - installStarted`, and every command carries an absolute deadline in the **app's**
 * clock: the app drops it with `commandExpired` rather than running it. The offset is taken at the
 * *start* of the install round trip, so transit time only ever makes the deadline later than the
 * host's, never earlier: a fresh command cannot be expired by a slow handshake. Monotonic clocks on
 * both sides (`performance.now`) mean wall-clock skew cannot matter; the app falls back to
 * `Date.now` only when it has no `performance`, and the offset is then simply relative to that.
 *
 * ## Things that were changed from the reference, and why
 *
 * - **Teardown waits for its three trailing sends to be written** (bounded) before `terminate()`.
 *   The reference sends and terminates in the same tick; `terminate()` destroys the socket and can
 *   discard anything still buffered, which would leave the binding installed.
 * - **A malformed binding payload is dropped**, not fatal. The reference treats any parse failure
 *   as a dead connection; a frame of the wrong shape is a protocol surprise, not evidence the
 *   socket is gone, and the command it belonged to still has its own timeout. A malformed *frame*
 *   (not JSON at all) is still fatal, since the stream itself can no longer be trusted.
 * - **A `commandExpired` reply counts as a reply** for heartbeat purposes: the app answered, so it
 *   is alive and the link works.
 * - **`restore` carries no deadline.** The teardown command must not expire in a slow app.
 *
 * ## Limits worth knowing
 *
 * `maxPayload` is 2MB; a larger reply makes `ws` close the socket (1009), which surfaces here as a
 * lost link, not as a truncated result. The handshake and install timeouts below are not measured
 * against a real Hermes compile of the agent; they are the reference's 2s, widened for the install.
 */
import { randomUUID } from 'node:crypto'
import type { ClientOptions } from 'ws'
import { WebSocket } from 'ws'
import {
  AGENT_LEASE_MS,
  DEFAULT_AGENT_LIMITS,
  type AgentCommand,
  type AgentLimits,
  type HeartbeatReply
} from './agent-runtime.ts'
import { listMetroTargets, reidentifyTarget, type MetroCdpTarget } from './discovery.ts'
import { agentSource } from './runtime-source.ts'

/** Origin of the failure, so a caller can branch without string-matching messages. */
export type CdpErrorKind =
  'timeout' | 'command-expired' | 'runtime-unavailable' | 'evaluation-failed' | 'connection-lost'

export class CdpError extends Error {
  readonly kind: CdpErrorKind
  constructor(kind: CdpErrorKind, message: string) {
    super(message)
    this.name = new.target.name
    this.kind = kind
  }
}

/** The host gave up waiting. The command may still run in the app unless its deadline expires it. */
export class CdpTimeoutError extends CdpError {
  readonly operation: string
  readonly timeoutMs: number
  constructor(operation: string, timeoutMs: number) {
    super('timeout', `${operation} did not complete within ${timeoutMs}ms`)
    this.operation = operation
    this.timeoutMs = timeoutMs
  }
}

/** The app dropped the command because its in-app deadline had already passed. It did not run. */
export class CommandExpiredError extends CdpError {
  readonly operation: string
  constructor(operation: string) {
    super('command-expired', `${operation} reached the app after its deadline and was not run`)
    this.operation = operation
  }
}

/** No agent is installed at the key: the app reloaded, or the lease restored and removed it. */
export class RuntimeUnavailableError extends CdpError {
  readonly operation: string
  constructor(operation: string) {
    super('runtime-unavailable', `${operation}: the in-app agent is not installed`)
    this.operation = operation
  }
}

/** The debugger rejected an evaluation (typically a compile error) or the app threw in it. */
export class CdpEvaluationError extends CdpError {
  readonly operation: string
  readonly detail?: string
  constructor(operation: string, detail?: string) {
    super(
      'evaluation-failed',
      `${operation} was rejected by the runtime${detail ? `: ${detail}` : ''}`
    )
    this.operation = operation
    this.detail = detail
  }
}

export type ConnectionLostReason =
  | 'socket'
  | 'reload'
  | 'heartbeat'
  | 'runtime-unavailable'
  | 'closed'
  | 'reconnecting'
  | 'exhausted'

/** The socket, the app's JS context, or the agent went away. Nothing about the call is known. */
export class CdpConnectionLostError extends CdpError {
  readonly reason: ConnectionLostReason
  constructor(reason: ConnectionLostReason) {
    super('connection-lost', `the debugger connection was lost (${reason})`)
    this.reason = reason
  }
}

/** Handshake: the reference's 2s per step. The install also compiles the agent, so it gets more. */
const HANDSHAKE_TIMEOUT_MS = 2_000
const INSTALL_TIMEOUT_MS = 5_000
const DEFAULT_COMMAND_TIMEOUT_MS = 1_500
const HEARTBEAT_INTERVAL_MS = 2_000
const HEARTBEAT_COMMAND_TIMEOUT_MS = 2_500
/** A reply this recent already proves the app is alive; do not queue a heartbeat behind real work. */
const HEARTBEAT_RECENT_REPLY_MS = 1_500
const HEARTBEAT_FAILURE_LIMIT = 3
const RESTORE_TIMEOUT_MS = 5_000
/** How long teardown waits for its trailing sends to reach the socket. */
const TEARDOWN_FLUSH_MS = 500
const SOCKET_HANDSHAKE_TIMEOUT_MS = 3_000
const SOCKET_MAX_PAYLOAD_BYTES = 2 * 1024 * 1024
const KEY_PREFIX = '__aiHarnessCdp_'

/**
 * `min(500 * 2^min(attempt-1, 4), 5000)` -- the reference's reconnect schedule, kept so the two
 * projects behave the same against the same Metro: 500, 1000, 2000, 4000, then 5000 forever.
 * `attempt` is 1-based.
 */
export function reconnectBackoffMs(attempt: number): number {
  return Math.min(500 * 2 ** Math.min(Math.max(attempt, 1) - 1, 4), 5_000)
}

/**
 * Rewrites every UTF-16 surrogate as a `\uXXXX` escape. See "Surrogates" in the file doc. Exported
 * for the tests, which assert on the wire bytes rather than on this function in isolation.
 */
export function escapeSurrogates(source: string): string {
  return source.replace(
    /[\ud800-\udfff]/g,
    (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`
  )
}

/** `JSON.stringify` replacer: every string leaves the host well formed. */
const wellFormed = (_key: string, value: unknown): unknown =>
  typeof value === 'string' ? escapeSurrogates(value) : value

/**
 * The expression that reads the app's clock, spelled out in ES5 because the command wrapper and the
 * install handshake are compiled by the same debugger evaluator as the agent (see the syntax
 * constraint in `agent-runtime.ts`). Both sides of the offset must use the same expression.
 */
const APP_CLOCK_EXPR =
  "(typeof performance!=='undefined'&&performance&&typeof performance.now==='function'?performance.now():Date.now())"

/** The slice of the `ws` socket the link uses, so tests can supply a fake. */
export interface CdpSocket {
  readyState: number
  send(data: string, callback?: (error?: Error) => void): void
  terminate(): void
  on(event: 'message', listener: (data: { toString(): string }) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close', listener: () => void): unknown
  once(event: 'open', listener: () => void): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
  once(event: 'close', listener: () => void): unknown
}

export type CdpSocketFactory = (url: string, options: ClientOptions) => CdpSocket

const defaultSocketFactory: CdpSocketFactory = (url, options) =>
  new WebSocket(url, options) as unknown as CdpSocket

const OPEN = 1

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: NodeJS.Timeout
  operation: string
}

export interface CdpLinkOptions {
  /** Shared by every link of one `CdpConnection`, so a re-install restores the agent it replaces. */
  key?: string
  leaseMs?: number
  limits?: AgentLimits
  createSocket?: CdpSocketFactory
  heartbeatIntervalMs?: number
  heartbeatRecentReplyMs?: number
  heartbeatTimeoutMs?: number
  now?: () => number
  /** Called once if the link dies of its own accord. Not called after `close()`. */
  onLost?: (error: CdpConnectionLostError) => void
}

/**
 * One socket and one installed agent. See "Two layers" in the file doc.
 */
export class CdpLink {
  private readonly socket: CdpSocket
  private readonly key: string
  private readonly binding: string
  private readonly leaseMs: number
  private readonly limits: AgentLimits
  private readonly now: () => number
  private readonly heartbeatIntervalMs: number
  private readonly heartbeatRecentReplyMs: number
  private readonly heartbeatTimeoutMs: number
  private readonly onLost?: (error: CdpConnectionLostError) => void
  private readonly pending = new Map<number, Pending>()
  /** ONE counter for both id kinds: positive for CDP calls, negated for app commands. */
  private sequence = 0
  private dead = false
  private closing?: Promise<void>
  private heartbeat?: NodeJS.Timeout
  private heartbeatInFlight = false
  private heartbeatFailures = 0
  private lastReply = Number.NEGATIVE_INFINITY
  private appClockOffset?: number
  /** Resolves once the handshake has installed the agent; rejects if any step fails. */
  readonly ready: Promise<void>

  constructor(url: string, options: CdpLinkOptions = {}) {
    this.key = options.key ?? `${KEY_PREFIX}${randomUUID().replaceAll('-', '')}`
    // Unguessable per link: the page can enumerate its own globals, and a forged reply could
    // otherwise resolve a pending command. Prefixed by the key so the next install can sweep it.
    this.binding = `${this.key}_reply_${randomUUID().replaceAll('-', '')}`
    this.leaseMs = options.leaseMs ?? AGENT_LEASE_MS
    this.limits = options.limits ?? DEFAULT_AGENT_LIMITS
    this.now = options.now ?? (() => performance.now())
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
    this.heartbeatRecentReplyMs = options.heartbeatRecentReplyMs ?? HEARTBEAT_RECENT_REPLY_MS
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? HEARTBEAT_COMMAND_TIMEOUT_MS
    this.onLost = options.onLost

    // Metro's own origin, as its inspector proxy expects from a debugger front end. Node's global
    // WebSocket cannot set it, nor `maxPayload`, which is why this uses `ws`.
    const origin = new URL(url)
    origin.protocol = 'http:'
    this.socket = (options.createSocket ?? defaultSocketFactory)(url, {
      origin: origin.origin,
      handshakeTimeout: SOCKET_HANDSHAKE_TIMEOUT_MS,
      maxPayload: SOCKET_MAX_PAYLOAD_BYTES,
      followRedirects: false
    })

    const opened = new Promise<void>((resolve, reject) => {
      this.socket.once('open', () => resolve())
      this.socket.once('error', () => reject(new CdpConnectionLostError('socket')))
      this.socket.once('close', () => reject(new CdpConnectionLostError('socket')))
    })
    this.socket.on('message', (data) => this.onMessage(data.toString()))
    this.socket.on('error', () => this.fail(new CdpConnectionLostError('socket')))
    this.socket.on('close', () => this.fail(new CdpConnectionLostError('socket')))
    this.ready = opened.then(() => this.install())
    // The caller observes `ready`; an unobserved rejection must not crash the process.
    this.ready.catch(() => undefined)
  }

  private async install(): Promise<void> {
    await this.send('Runtime.enable', {}, HANDSHAKE_TIMEOUT_MS, 'runtime-enable')
    await this.send(
      'Runtime.addBinding',
      { name: this.binding },
      HANDSHAKE_TIMEOUT_MS,
      'add-binding'
    )
    // The agent's constructor path is the only thing here that can throw inside the app, and it
    // does so on purpose (no timers, so no watchdog). That surfaces as `exceptionDetails`.
    const keyPrefix = `${this.key}_reply_`
    const expression =
      `(function(){var __name=function(value){return value};` +
      // A previous connection's reply global is dead weight and, worse, still a callable.
      `var names=Object.keys(globalThis);for(var i=0;i<names.length;i++){` +
      `if(names[i].indexOf(${JSON.stringify(keyPrefix)})===0&&names[i]!==${JSON.stringify(this.binding)})` +
      `{try{delete globalThis[names[i]]}catch(error){}}}` +
      `(${agentSource()})(${JSON.stringify(this.key)},${this.leaseMs},${JSON.stringify(this.limits)});` +
      `return {clock:${APP_CLOCK_EXPR}}})()`
    const installStarted = this.now()
    const installed = (await this.send(
      'Runtime.evaluate',
      { expression, silent: true, returnByValue: true, objectGroup: this.key },
      INSTALL_TIMEOUT_MS,
      'install'
    )) as { result?: { value?: { clock?: unknown } } } | undefined
    const appClock = installed?.result?.value?.clock
    if (typeof appClock === 'number' && Number.isFinite(appClock)) {
      this.appClockOffset = appClock - installStarted
    }
    if (this.dead || this.closing) return
    this.heartbeat = setInterval(() => this.beat(), this.heartbeatIntervalMs)
    this.heartbeat.unref()
  }

  /**
   * Skipped when one is already in flight, or when a real reply landed recently: every command
   * renews the app's lease, so a recent reply is proof of life and a heartbeat queued behind real
   * work would only add a traversal's worth of latency to it. Three failures in a row with no reply
   * in between closes the link; a reply that arrives while a heartbeat is outstanding clears the
   * count, which is why failure is judged against when the heartbeat was *sent*.
   */
  private beat(): void {
    if (this.heartbeatInFlight || this.now() - this.lastReply < this.heartbeatRecentReplyMs) return
    this.heartbeatInFlight = true
    const sentAt = this.now()
    this.invoke({ type: 'heartbeat' }, this.heartbeatTimeoutMs)
      .catch(() => {
        if (this.lastReply < sentAt && ++this.heartbeatFailures >= HEARTBEAT_FAILURE_LIMIT) {
          this.fail(new CdpConnectionLostError('heartbeat'))
        }
      })
      .finally(() => {
        this.heartbeatInFlight = false
      })
  }

  private onMessage(text: string): void {
    let message: {
      id?: number
      method?: string
      params?: { name?: string; payload?: string }
      result?: { exceptionDetails?: { text?: string; exception?: { description?: string } } }
      error?: { message?: string }
    }
    try {
      message = JSON.parse(text)
    } catch {
      this.fail(new CdpConnectionLostError('socket'))
      return
    }
    if (
      message.method === 'Runtime.executionContextsCleared' ||
      message.method === 'Runtime.executionContextDestroyed'
    ) {
      // The app reloaded: the agent, the binding and every pending reply are gone with it.
      this.fail(new CdpConnectionLostError('reload'))
      return
    }
    if (message.method === 'Runtime.bindingCalled') {
      if (message.params?.name !== this.binding) return
      let value: { id?: unknown; result?: unknown }
      try {
        value = JSON.parse(message.params.payload ?? '')
      } catch {
        return
      }
      if (typeof value.id === 'number') this.settleReply(value.id, value.result)
      return
    }
    if (typeof message.id !== 'number' || message.id === 0) return
    const details = message.result?.exceptionDetails
    if (message.error || details) {
      const detail = details?.exception?.description ?? details?.text ?? message.error?.message
      const operation = this.pending.get(message.id)?.operation ?? 'other'
      this.finish(message.id, undefined, new CdpEvaluationError(operation, detail))
      return
    }
    // A negative id's own evaluate result is empty by design; the answer comes as a binding event.
    if (message.id > 0) this.finish(message.id, message.result)
  }

  private settleReply(id: number, result: unknown): void {
    const pending = this.pending.get(id)
    if (!pending) return
    const reply = result as { commandExpired?: boolean; runtimeUnavailable?: boolean } | null
    if (reply && reply.runtimeUnavailable) {
      this.finish(id, undefined, new RuntimeUnavailableError(pending.operation))
      // No agent means nothing here can work again; hand the decision to whoever can reinstall.
      this.fail(new CdpConnectionLostError('runtime-unavailable'))
      return
    }
    this.lastReply = this.now()
    this.heartbeatFailures = 0
    if (reply && reply.commandExpired) {
      this.finish(id, undefined, new CommandExpiredError(pending.operation))
      return
    }
    this.finish(id, result)
  }

  private finish(id: number, value?: unknown, error?: Error): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    if (error) pending.reject(error)
    else pending.resolve(value)
  }

  /** Marks the link dead, fails everything pending, and tells the owner, exactly once. */
  private fail(error: CdpConnectionLostError): void {
    if (this.dead) return
    this.dead = true
    clearInterval(this.heartbeat)
    for (const id of [...this.pending.keys()]) this.finish(id, undefined, error)
    if (!this.closing) {
      this.socket.terminate()
      this.onLost?.(error)
    }
  }

  private send(
    method: string,
    params: unknown,
    timeoutMs: number,
    operation: string,
    id: number = ++this.sequence
  ): Promise<unknown> {
    if (this.dead || this.socket.readyState !== OPEN) {
      return Promise.reject(new CdpConnectionLostError(this.dead ? 'closed' : 'socket'))
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.finish(id, undefined, new CdpTimeoutError(operation, timeoutMs)),
        timeoutMs
      )
      this.pending.set(id, { resolve, reject, timer, operation })
      const safe =
        method === 'Runtime.evaluate' &&
        typeof (params as { expression?: unknown }).expression === 'string'
          ? {
              ...(params as object),
              expression: escapeSurrogates((params as { expression: string }).expression)
            }
          : params
      this.socket.send(JSON.stringify({ id, method, params: safe }), (error) => {
        if (error) this.finish(id, undefined, new CdpConnectionLostError('socket'))
      })
    })
  }

  /**
   * Runs one agent command. Resolves with the agent's reply, or rejects with a typed `CdpError`.
   * `timeoutMs` bounds both the host's wait and, through the embedded deadline, the app's willingness
   * to start the command at all.
   */
  async invoke<T = unknown>(
    command: AgentCommand,
    timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS
  ): Promise<T> {
    await this.ready
    const id = -++this.sequence
    // `restore` must run even in a slow app, so it is the one command with no deadline.
    const deadline =
      this.appClockOffset === undefined || command.type === 'restore'
        ? undefined
        : this.now() + timeoutMs + this.appClockOffset
    const reply =
      `var reply=function(result){var send=globalThis[${JSON.stringify(this.binding)}];` +
      `if(typeof send==='function')send(JSON.stringify({id:${id},result:result===undefined?null:result}))};`
    const expression =
      `(function(){var runtime=globalThis[${JSON.stringify(this.key)}];${reply}` +
      (deadline === undefined
        ? ''
        : `if(${APP_CLOCK_EXPR}>${deadline}){reply({commandExpired:true});return}`) +
      `if(!runtime||typeof runtime.invoke!=='function'){reply({runtimeUnavailable:true});return}` +
      `runtime.invoke(${JSON.stringify(JSON.stringify(command, wellFormed))},reply)})()`
    const result = await this.send(
      'Runtime.evaluate',
      { expression, silent: true, returnByValue: true, objectGroup: this.key },
      timeoutMs,
      command.type,
      id
    )
    if (command.type === 'heartbeat' && (result as HeartbeatReply | null)?.alive !== true) {
      throw new CdpEvaluationError('heartbeat', 'invalid response')
    }
    return result as T
  }

  /**
   * Idempotent teardown, in this order: stop the heartbeat; ask the agent to restore itself
   * (best effort, bounded; the lease restores it anyway if this fails); remove the binding, delete
   * its global, release the object group; fail whatever is still pending; terminate the socket.
   * Every call after the first returns the first's promise.
   */
  close(options: { restore?: boolean } = {}): Promise<void> {
    return (this.closing ??= this.dispose(options.restore !== false))
  }

  private async dispose(restore: boolean): Promise<void> {
    clearInterval(this.heartbeat)
    if (restore && !this.dead && this.socket.readyState === OPEN) {
      let timer: NodeJS.Timeout | undefined
      try {
        await Promise.race([
          this.ready.then(() => this.invoke({ type: 'restore' }, RESTORE_TIMEOUT_MS)),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, RESTORE_TIMEOUT_MS + 500)
          })
        ])
      } catch {
        // The in-app watchdog restores after the host goes quiet; teardown must not hang on it.
      } finally {
        clearTimeout(timer)
      }
    }
    if (this.socket.readyState === OPEN) {
      const writes = [
        { method: 'Runtime.removeBinding', params: { name: this.binding } },
        {
          method: 'Runtime.evaluate',
          params: {
            expression: `delete globalThis[${JSON.stringify(this.binding)}]`,
            silent: true,
            returnByValue: true
          }
        },
        { method: 'Runtime.releaseObjectGroup', params: { objectGroup: this.key } }
      ].map(
        (call) =>
          new Promise<void>((resolve) => {
            try {
              this.socket.send(JSON.stringify({ id: ++this.sequence, ...call }), () => resolve())
            } catch {
              resolve()
            }
          })
      )
      let flush: NodeJS.Timeout | undefined
      await Promise.race([
        Promise.all(writes),
        new Promise<void>((resolve) => {
          flush = setTimeout(resolve, TEARDOWN_FLUSH_MS)
        })
      ])
      clearTimeout(flush)
    }
    this.fail(new CdpConnectionLostError('closed'))
    this.socket.terminate()
  }
}

export type ConnectionState = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'failed' | 'closed'

export interface CdpConnectionOptions {
  /**
   * Yields the debugger URL to connect to, **freshly each call**: a relaunched app is a new Metro
   * target with a new URL. See `createTargetResolver` for the discovery-backed implementation.
   */
  resolveTarget: () => Promise<{ webSocketDebuggerUrl: string }>
  /** Stable across this connection's links; defaults to a random one. */
  sessionId?: string
  leaseMs?: number
  limits?: AgentLimits
  createSocket?: CdpSocketFactory
  heartbeatIntervalMs?: number
  heartbeatRecentReplyMs?: number
  heartbeatTimeoutMs?: number
  /** Failed reconnect attempts tolerated before the state becomes `failed`. Default 10. */
  maxReconnectAttempts?: number
  /** Injected so tests do not wait out the real backoff. */
  sleep?: (ms: number) => Promise<void>
  backoffMs?: (attempt: number) => number
  log?: (message: string) => void
  onStateChange?: (state: ConnectionState) => void
}

/**
 * Builds a `resolveTarget` that follows an app across Metro restarts and relaunches: it lists the
 * targets on `metroPort` and re-identifies the one first attached, by app plus device rather than
 * by id (`reidentifyTarget`). Throws when no single target matches, which the connection treats as
 * a failed attempt and retries: right after a relaunch the new target is often not registered yet.
 */
export function createTargetResolver(
  metroPort: number,
  initial: MetroCdpTarget,
  options: { list?: typeof listMetroTargets } = {}
): () => Promise<MetroCdpTarget> {
  const list = options.list ?? listMetroTargets
  let current = initial
  return async () => {
    const targets = await list(metroPort)
    const match = reidentifyTarget(targets, current.id, current)
    if (!match) throw new Error(`no Metro target matches the app on port ${metroPort}`)
    current = match
    return match
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The connection the rest of the app uses. See "Two layers" in the file doc for what it recovers
 * from, what it does not retry, and why.
 */
export class CdpConnection {
  private link?: CdpLink
  private recovery?: Promise<void>
  private currentState: ConnectionState = 'idle'
  private readonly key: string
  private readonly sleep: (ms: number) => Promise<void>
  private readonly backoffMs: (attempt: number) => number
  private readonly maxAttempts: number
  private readonly options: CdpConnectionOptions

  constructor(options: CdpConnectionOptions) {
    this.options = options
    this.key = `${KEY_PREFIX}${(options.sessionId ?? randomUUID()).replaceAll('-', '')}`
    this.sleep = options.sleep ?? defaultSleep
    this.backoffMs = options.backoffMs ?? reconnectBackoffMs
    this.maxAttempts = options.maxReconnectAttempts ?? 10
  }

  get state(): ConnectionState {
    return this.currentState
  }

  private setState(state: ConnectionState): void {
    if (this.currentState === state) return
    this.currentState = state
    this.options.onStateChange?.(state)
  }

  /** The first connection. One attempt, and it throws: whether to carry on without us is the caller's call. */
  async connect(): Promise<void> {
    if (this.currentState !== 'idle')
      throw new Error(`cannot connect from state ${this.currentState}`)
    this.setState('connecting')
    try {
      await this.openLink()
      this.setState('ready')
    } catch (error) {
      // `close()` may have landed while `openLink` was in flight; 'closed' is terminal, so a
      // failed first attempt must not reopen the connection for another `connect()`.
      if ((this.currentState as ConnectionState) !== 'closed') this.setState('idle')
      throw error
    }
  }

  private async openLink(): Promise<void> {
    const target = await this.options.resolveTarget()
    const link = new CdpLink(target.webSocketDebuggerUrl, {
      key: this.key,
      leaseMs: this.options.leaseMs,
      limits: this.options.limits,
      createSocket: this.options.createSocket,
      heartbeatIntervalMs: this.options.heartbeatIntervalMs,
      heartbeatRecentReplyMs: this.options.heartbeatRecentReplyMs,
      heartbeatTimeoutMs: this.options.heartbeatTimeoutMs,
      onLost: (error) => {
        // A link that dies before its handshake completes is reported by `ready`, not here.
        if (this.link === link && this.currentState === 'ready') this.recover(error)
      }
    })
    try {
      await link.ready
    } catch (error) {
      await link.close({ restore: false }).catch(() => undefined)
      throw error
    }
    if (this.currentState === 'closed') {
      await link.close()
      throw new CdpConnectionLostError('closed')
    }
    this.link = link
  }

  private recover(cause: CdpConnectionLostError): void {
    if (this.recovery || this.currentState === 'closed') return
    this.options.log?.(`link lost (${cause.reason}); reconnecting`)
    this.recovery = this.runRecovery().finally(() => {
      this.recovery = undefined
    })
    // Callers observe recovery through `invoke`/`reconnect`; this keeps it from being unhandled.
    this.recovery.catch(() => undefined)
  }

  private async runRecovery(): Promise<void> {
    this.setState('reconnecting')
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      await this.sleep(this.backoffMs(attempt))
      if (this.currentState === 'closed') throw new CdpConnectionLostError('closed')
      try {
        await this.openLink()
        this.setState('ready')
        return
      } catch (error) {
        this.options.log?.(
          `reconnect attempt ${attempt}/${this.maxAttempts} failed: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    this.setState('failed')
    throw new CdpConnectionLostError('exhausted')
  }

  /**
   * Replaces the link now, from any state but `closed`. Used after `failed`, or by a caller that
   * knows it just relaunched the app and does not want to wait for the heartbeat to notice.
   * Resolves when a fresh link is installed; rejects with `CdpConnectionLostError('exhausted')`.
   */
  async reconnect(): Promise<void> {
    if (this.currentState === 'closed') throw new CdpConnectionLostError('closed')
    if (this.recovery) return this.recovery
    const old = this.link
    this.link = undefined
    if (old) await old.close({ restore: false }).catch(() => undefined)
    this.recover(new CdpConnectionLostError('reconnecting'))
    return this.recovery
  }

  /**
   * Runs one agent command. While a reconnect is in progress it waits for it, up to `timeoutMs`
   * from now, rather than failing; a command already in flight when the link died has been rejected
   * and is never replayed. See the file doc.
   */
  async invoke<T = unknown>(
    command: AgentCommand,
    timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS
  ): Promise<T> {
    if (this.currentState === 'closed') throw new CdpConnectionLostError('closed')
    if (this.currentState === 'failed') throw new CdpConnectionLostError('exhausted')
    if (this.recovery) {
      let timer: NodeJS.Timeout | undefined
      try {
        await Promise.race([
          this.recovery,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new CdpConnectionLostError('reconnecting')), timeoutMs)
          })
        ])
      } finally {
        clearTimeout(timer)
      }
    }
    if (!this.link) throw new CdpConnectionLostError('socket')
    return this.link.invoke<T>(command, timeoutMs)
  }

  /** Tears the link down (restoring the app) and stops any recovery. Idempotent. */
  async close(): Promise<void> {
    if (this.currentState === 'closed') return
    this.setState('closed')
    const link = this.link
    this.link = undefined
    await link?.close()
  }
}
