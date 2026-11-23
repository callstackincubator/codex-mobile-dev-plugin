/**
 * Finds the React Native debugger WebSocket target for a running Metro server.
 *
 * Metro serves its inspector targets at `/json/list`. This module does that one HTTP GET and turns
 * the answer into typed, validated targets; it opens no socket (the connection lives elsewhere)
 * and imports nothing from Electron or the device layer, so it stays loadable under `node --test`
 * like the rest of `app-flow/` (see the note at the top of `reach/types.ts`).
 *
 * The Metro port is taken as a plain number, the way every other consumer already holds it
 * (`ProfilingDevice.metroPort`, `selectNavStateTarget`, `selectMetroCdpTarget`), and the origin is
 * built the same way they build it: `http://127.0.0.1:<port>`. Nothing new discovers Metro.
 *
 * **A Metro response is untrusted input.** The body is capped in size and in target count, and every
 * `webSocketDebuggerUrl` is checked before it is handed back: `ws:` only, a loopback host, the
 * port Metro itself was reached on, and no credentials or fragment. A target failing any of those
 * is dropped, not repaired, so a compromised or spoofed listener on that port cannot steer the
 * caller's socket at an arbitrary host. The port check also matters in the benign case: an
 * inspector may advertise `localhost` where discovery used `127.0.0.1`, which is accepted, but one
 * advertising a different port is not the Metro we were asked about.
 *
 * ### `supportsMultipleDebuggers`
 *
 * Whether the target reports `reactNative.capabilities.supportsMultipleDebuggers` is returned as
 * data and deliberately NOT enforced here. A target without it allows exactly one debugger
 * attached at a time, and a second attach either fails or evicts the first. That matters to us
 * because a sweep wants to hold one socket for its whole duration while the CPU profiler
 * separately attaches `agent-device cdp` to the same inspector
 * (`profiling/profilers/cpu-devtool.ts`, `selectMetroCdpTarget`). On a single-debugger target those
 * two collide, and `shell.ts` already SIGKILLs a hung eval for exactly that contention. Refusing
 * such targets outright would make the feature unusable on older runtimes that otherwise work fine
 * for a sweep with no profiler attached, so the decision is the caller's: it knows whether a
 * profiler is going to run.
 */

/** How long `/json/list` may take. Metro answers locally in milliseconds; 5s is a hung server. */
export const DISCOVERY_TIMEOUT_MS = 5_000
/** Largest `/json/list` body accepted. Real lists are a few hundred bytes per target. */
export const MAX_DISCOVERY_BODY_BYTES = 1024 * 1024
/** Most targets parsed from one response. A dev machine has a handful; beyond this is noise. */
export const MAX_DISCOVERY_TARGETS = 100
/** Longest string kept from any descriptive field of a target. */
const MAX_FIELD_LENGTH = 512

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** One validated Metro inspector target. */
export interface MetroCdpTarget {
  /** Metro's id for the target. Volatile: Metro reassigns it across restarts. Do not persist it. */
  id: string
  title: string
  appId?: string
  deviceName?: string
  /** `reactNative.logicalDeviceId`: stable per device, unlike `id`. */
  deviceId?: string
  /** Validated: `ws:`, loopback host, Metro's own port. Safe to hand to a WebSocket client. */
  webSocketDebuggerUrl: string
  /**
   * True only when the target explicitly reports `supportsMultipleDebuggers`. False means it was
   * absent or not `true` (indistinguishable on purpose; both mean "assume one debugger"). See the
   * module doc for why this is data rather than a refusal.
   */
  supportsMultipleDebuggers: boolean
}

export interface ListMetroTargetsOptions {
  /** Cancels the request; the rejection is the abort reason, not a "cannot reach Metro" error. */
  signal?: AbortSignal
  /** Injected so tests never touch the network. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** The parts of a target that survive a Metro restart. */
export interface MetroTargetIdentity {
  appId?: string
  deviceId?: string
  deviceName?: string
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.slice(0, MAX_FIELD_LENGTH) : undefined

/**
 * Validates one advertised debugger URL against the Metro port we reached. Returns the normalized
 * href, or null when it must be rejected. Relative URLs resolve against the Metro origin, which
 * then fails the scheme check, so they are rejected rather than guessed at.
 */
function validateDebuggerUrl(raw: string, metroPort: number): string | null {
  let url: URL
  try {
    url = new URL(raw, `http://127.0.0.1:${metroPort}`)
  } catch {
    return null
  }
  if (url.protocol !== 'ws:') return null
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null
  if (url.username || url.password || url.hash) return null
  // `ws:` defaults to port 80, which `URL` reports as the empty string.
  if (Number(url.port || 80) !== metroPort) return null
  return url.href
}

/** Reads a response body as text, giving up as soon as it exceeds the cap rather than after. */
async function readCappedText(response: Response, maxBytes: number): Promise<string> {
  const tooLarge = (): Error => new Error('Metro returned too much data for its target list.')
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge()
  if (!response.body) {
    const text = await response.text()
    if (Buffer.byteLength(text) > maxBytes) throw tooLarge()
    return text
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let received = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw tooLarge()
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

/**
 * Lists the inspector targets of the Metro server on `metroPort`, keeping only those whose
 * debugger URL passes `validateDebuggerUrl`. Throws when Metro is unreachable, answers non-2xx,
 * sends an oversized or malformed body, or sends something that is not a list; an empty array
 * means Metro is up with nothing attached.
 */
export async function listMetroTargets(
  metroPort: number,
  options: ListMetroTargetsOptions = {}
): Promise<MetroCdpTarget[]> {
  const { signal, fetchImpl = fetch, timeoutMs = DISCOVERY_TIMEOUT_MS } = options
  const origin = `http://127.0.0.1:${metroPort}`
  const timeout = AbortSignal.timeout(timeoutMs)
  let response: Response
  try {
    response = await fetchImpl(`${origin}/json/list`, {
      // A redirect is a different server answering; following it would defeat the port check.
      redirect: 'error',
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(`Cannot reach Metro at ${origin}.`, { cause: error })
  }
  if (!response.ok) throw new Error(`Metro returned HTTP ${response.status}.`)

  const body = await readCappedText(response, MAX_DISCOVERY_BODY_BYTES)
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch (error) {
    throw new Error('Metro returned a target list that is not valid JSON.', { cause: error })
  }
  if (!Array.isArray(payload)) throw new Error('Metro returned an invalid target list.')

  const targets: MetroCdpTarget[] = []
  for (const item of payload.slice(0, MAX_DISCOVERY_TARGETS)) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.webSocketDebuggerUrl !== 'string') continue
    const webSocketDebuggerUrl = validateDebuggerUrl(record.webSocketDebuggerUrl, metroPort)
    if (!webSocketDebuggerUrl) continue
    const reactNative = (record.reactNative ?? {}) as {
      logicalDeviceId?: unknown
      capabilities?: { supportsMultipleDebuggers?: unknown }
    }
    targets.push({
      id: record.id,
      title: asString(record.title) ?? record.id,
      appId: asString(record.appId),
      deviceName: asString(record.deviceName),
      deviceId: asString(reactNative.logicalDeviceId),
      webSocketDebuggerUrl,
      supportsMultipleDebuggers: reactNative.capabilities?.supportsMultipleDebuggers === true
    })
  }
  return targets
}

const normalizeDeviceName = (name: string): string => name.toLowerCase().replace(/[^a-z\d]/g, '')

/**
 * Finds the target we were attached to before, after Metro may have restarted and handed out new
 * ids. Matching is by app plus device, never by id alone: the same app on two simulators shares an
 * `appId`, and a different app on the same simulator shares a device, so both must agree.
 *
 * Device identity is the logical device id when both sides have one, else the device name compared
 * loosely (case and punctuation), since a name is all older runtimes report. When several targets
 * still match, the one whose id is unchanged wins, otherwise the answer is `undefined`: picking one
 * of two equally plausible targets would silently drive the wrong app. With no previous identity
 * there is nothing to re-identify, so only the id is consulted.
 */
export function reidentifyTarget<T extends MetroTargetIdentity & { id: string }>(
  targets: readonly T[],
  previousId: string,
  previous?: MetroTargetIdentity
): T | undefined {
  if (!previous) return targets.find((target) => target.id === previousId)
  const matches = targets.filter((target) => {
    const sameApp = previous.appId
      ? target.appId === previous.appId
      : target.id === previousId && !target.appId
    const sameDevice =
      (previous.deviceId !== undefined && target.deviceId === previous.deviceId) ||
      (previous.deviceName !== undefined &&
        target.deviceName !== undefined &&
        normalizeDeviceName(target.deviceName) === normalizeDeviceName(previous.deviceName))
    return sameApp && sameDevice
  })
  const exact = matches.find((target) => target.id === previousId)
  return exact ?? (matches.length === 1 ? matches[0] : undefined)
}
