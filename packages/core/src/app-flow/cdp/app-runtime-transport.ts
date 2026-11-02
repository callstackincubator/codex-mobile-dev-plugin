/**
 * One persistent connection to the app's own JS runtime, as a `RenderTransport`.
 *
 * This is the handshake the Fast sweep grew for itself — select an unambiguous Metro target for
 * this device, open a `CdpConnection` to it, and latch the failure so a run never re-pays for a
 * handshake that already lost. It lives here rather than inside `orchestrator.ts` because it has a
 * second caller now: runtime replay (`runtime-replay.ts`), which puts the app on one screen by
 * dispatching through the navigator exactly as the sweep's render rung does.
 *
 * Duplicating it instead would mean two components disagreeing about whether the runtime is
 * reachable — and about what to tell the user when it is not — which is precisely what the
 * `CreateReachPortsOptions.renderTransport` comment warns against. It also keeps one set of
 * `app_flow.runtime.*` meters: the connect timing, the per-command timing and the connection-state
 * count are emitted here, so a replay's runtime cost lands in the same series as a sweep's and the
 * two stay comparable across releases (see `docs/telemetry.md`).
 *
 * Nothing product-identifying is measured. The attributes are the closed sets the sweep already
 * sent — `outcome`, `operation`, `state` — and the handshake's own failure text is scrubbed by
 * `describeTransportFailure` before it goes anywhere near a log line, never to telemetry.
 */
import type { AgentCommand, NavigateReply, NavStateReply, ReadinessReply } from './agent-runtime.ts'
import { CdpConnection, createTargetResolver } from './connection.ts'
import { listMetroTargets, type MetroCdpTarget } from './discovery.ts'
import type { NavRoute } from '../nav-state.ts'
import type { RenderTransport } from '../reach/adapters.ts'
import type { RenderAvailability } from '../reach/ports.ts'
import { recordRuntimeCount, recordRuntimeTiming } from '../runtime-telemetry.ts'

/** How long a structured agent command may take before it is abandoned. The sweep's own number. */
const COMMAND_TIMEOUT_MS = 5_000

/**
 * A handshake failure in words safe to show and to log.
 *
 * It is carried on `RenderAvailability` into a rung's skip note, a replay's error line and the
 * local run log, so it is scrubbed the way every other product string here is: absolute paths are
 * replaced (an error from a spawned tool can carry the project's location), and the message is
 * bounded so a stack-shaped `Error.message` cannot turn one skip note into a page. Nothing here
 * reaches telemetry — the `app_flow.runtime.connect` timing carries the `outcome` attribute and
 * nothing more.
 */
export function describeTransportFailure(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error)).trim()
  const scrubbed = raw
    .replace(/(?:\/[\w.@~-]+){2,}/g, '<path>')
    .replace(/\s+/g, ' ')
    .trim()
  if (!scrubbed) return 'The runtime handshake failed without a message.'
  return scrubbed.length > 200 ? `${scrubbed.slice(0, 197)}...` : scrubbed
}

export interface AppRuntimeTransportOptions {
  /** The dev server this device was opened against; its target list is what we search. */
  metroPort: number
  /** Narrows the target list to this device, so a second booted simulator cannot be adopted. */
  deviceId: string
  deviceName?: string | null
  /** The parsed app name, used to disambiguate when the device offers several targets. */
  appName: string | null
  /** Distinguishes this connection's links in the debugger; `fast-<projectId>` for a sweep. */
  sessionId: string
  signal?: AbortSignal
  /** Prefix for this transport's console lines — the caller's own `[app-flow…]` tag. */
  logLabel?: string
  /**
   * Told once, on the first `ready()` that resolves either way. The sweep uses it to set
   * `ParamStore.navState`, so one failed handshake is not retried for every later node.
   */
  onAvailability?: (availability: 'ready' | 'unavailable') => void
}

/**
 * The transport plus the connection underneath it.
 *
 * Callers that only navigate use `transport`. The sweep also issues commands of its own (`links`)
 * and hands the raw connection to the UI-state session, which is what `connection`, `state` and
 * `invoke` are for — they delegate, so there is still exactly one connection per handle.
 */
export interface AppRuntimeTransport {
  readonly transport: RenderTransport
  /** The live connection, or null before the first successful `ready()` and after `close()`. */
  readonly connection: CdpConnection | null
  /** `'idle'` until a connection exists; otherwise the connection's own state. */
  readonly state: CdpConnection['state'] | 'idle'
  invoke<T>(command: AgentCommand, timeoutMs?: number): Promise<T>
  close(): Promise<void>
}

export function createAppRuntimeTransport(
  options: AppRuntimeTransportOptions
): AppRuntimeTransport {
  const label = options.logLabel ?? '[app-flow]'
  let connection: CdpConnection | null = null
  let target: MetroCdpTarget | null = null
  let unavailable = false
  /**
   * Why the handshake failed, kept beside the latch so every later caller is told the same thing
   * the first one was. Two failures are otherwise indistinguishable here — no Metro runtime to
   * attach to, and a runtime that refused the agent — and a sweep that skipped all nine of its
   * nodes never said which. See `RenderAvailability`.
   */
  let unavailableReason = ''

  const timing = (name: string, started: number, attributes: Record<string, string> = {}): void => {
    recordRuntimeTiming(name, performance.now() - started, attributes)
  }

  const transport: RenderTransport = {
    async ready(): Promise<RenderAvailability> {
      if (connection?.state === 'ready') return { ok: true }
      if (unavailable) return { ok: false, reason: unavailableReason }
      const started = performance.now()
      try {
        const targets = await listMetroTargets(options.metroPort, { signal: options.signal })
        const normalize = (value: string | null | undefined): string =>
          (value ?? '').toLowerCase().replace(/[^a-z\d]/g, '')
        const app = normalize(options.appName)
        const candidates = targets.filter((entry) => entry.supportsMultipleDebuggers)
        const deviceCandidates = candidates.filter(
          (entry) =>
            entry.deviceId === options.deviceId ||
            (!!entry.deviceName &&
              normalize(entry.deviceName) === normalize(options.deviceName ?? null))
        )
        target =
          deviceCandidates.find(
            (entry) => !app || normalize(entry.title) === app || normalize(entry.appId) === app
          ) ?? (deviceCandidates.length === 1 ? deviceCandidates[0]! : null)
        if (!target) throw new Error('No unambiguous Metro runtime supports Fast capture.')
        connection = new CdpConnection({
          resolveTarget: createTargetResolver(options.metroPort, target),
          sessionId: options.sessionId,
          log: (message) => console.log(`${label} fast runtime — ${message}`),
          onStateChange: (state) => {
            recordRuntimeCount('app_flow.runtime.state', { state })
          }
        })
        await connection.connect()
        options.onAvailability?.('ready')
        return { ok: true }
      } catch (error) {
        unavailable = true
        unavailableReason = describeTransportFailure(error)
        options.onAvailability?.('unavailable')
        console.log(`${label} fast runtime unavailable — ${unavailableReason}`)
        return { ok: false, reason: unavailableReason }
      } finally {
        timing('app_flow.runtime.connect', started, {
          outcome: connection?.state === 'ready' ? 'ready' : 'unavailable'
        })
      }
    },
    async navigate(route, params, expoPath, candidates): Promise<NavigateReply> {
      const started = performance.now()
      try {
        return await connection!.invoke<NavigateReply>(
          { type: 'navigate', route, params, expoPath, candidates },
          COMMAND_TIMEOUT_MS
        )
      } finally {
        timing('app_flow.runtime.command', started, { operation: 'navigate' })
      }
    },
    async readiness(route, params): Promise<ReadinessReply> {
      const started = performance.now()
      try {
        return await connection!.invoke<ReadinessReply>(
          { type: 'readiness', route, expectedParams: params },
          COMMAND_TIMEOUT_MS
        )
      } finally {
        timing('app_flow.runtime.command', started, { operation: 'readiness' })
      }
    },
    // Same `app_flow.runtime.command` wrapper, name, unit and attribute shape as its two siblings
    // above, deliberately: the whole point of reading nav-state here is that it replaces a CLI
    // subprocess, and the only way that saving stays legible across releases is if the fast read
    // is billed to the same meter under a new `operation`.
    async navState(): Promise<NavRoute[] | null> {
      const started = performance.now()
      try {
        const reply = await connection!.invoke<NavStateReply>(
          { type: 'nav-state' },
          COMMAND_TIMEOUT_MS
        )
        return reply?.routes ?? null
      } finally {
        timing('app_flow.runtime.command', started, { operation: 'nav-state' })
      }
    },
    async close(): Promise<void> {
      await connection?.close()
      connection = null
    }
  }

  return {
    transport,
    get connection() {
      return connection
    },
    get state() {
      return connection?.state ?? 'idle'
    },
    /**
     * A structured command the caller composes itself (the sweep's `links` read), billed to the
     * same `app_flow.runtime.command` meter as the three the transport issues, under the
     * command's own `type` as `operation`. The raw `connection` stays unmetered: the UI-state
     * session drives it in bursts, and one span per burst command is the per-frame noise the
     * telemetry rules rule out.
     */
    async invoke<T>(command: AgentCommand, timeoutMs: number = COMMAND_TIMEOUT_MS): Promise<T> {
      const started = performance.now()
      try {
        return await connection!.invoke<T>(command, timeoutMs)
      } finally {
        timing('app_flow.runtime.command', started, { operation: command.type })
      }
    },
    close(): Promise<void> {
      return transport.close()
    }
  }
}
