import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const APPROVAL_DOMAIN = 'com.apple.launchservices.schemeapproval'
const APPROVAL_KEY_PREFIX = 'com.apple.CoreSimulator.CoreSimulatorBridge-->'
const OPEN_IN_PROMPT_RE = /\bopen in\b/i
/**
 * Budget for the one alert probe in `acceptOpenInAppPrompt`.
 *
 * The iOS runner gives an `alert` command's main-thread block exactly the `timeoutMs` we pass, and
 * the work inside it enumerates SpringBoard's alert and sheet hierarchies — an XCTest query that on
 * a cold simulator, mid app-launch, routinely runs for tens of seconds. A budget the query cannot
 * finish inside does not cancel it: XCTest work cannot be cancelled, so the runner abandons the
 * block and refuses *every* later command with RUNNER_BUSY until it drains. Generous here, because
 * the cost of being wrong in that direction is one slow probe, and in the other direction it is the
 * whole sweep — see `dismissOpenInAppPrompt`'s callers.
 */
const OPEN_IN_PROMPT_TIMEOUT_MS = 15_000

/**
 * Simulators on which a scheme's launch-services approval has been written, and whether an open has
 * since confirmed that the approval took effect. The approval is a device-level fact (one `defaults
 * write` per scheme per simulator), so it belongs here rather than on any one capture or profiling
 * session: a later session opening the same scheme on the same simulator is equally covered, and
 * equally has no prompt to look for.
 *
 * `pending` exists because writing the approval and opening the URL happen in the same breath. On a
 * simulator that booted seconds ago, `launchservicesd` has not read the write back by the time the
 * open lands, so the *first* open after a write still gets the "Open in …?" sheet. Treating the
 * write as proof would skip the one probe that can clear it, and the user sees the simulator boot
 * with the app never coming up — the second click then works, because the OS has caught up.
 */
const schemeApprovals = new Map<string, 'pending' | 'approved'>()

function preapprovalKey(udid: string, scheme: string): string {
  return `${udid}\u0000${scheme.toLowerCase()}`
}

/**
 * Whether this simulator has already been taught to open `url`'s scheme without asking *and* an
 * open has confirmed it.
 *
 * Callers use it to skip the "Open in …?" probe entirely. That probe is the single most expensive
 * thing a sweep can do when it is not needed — see `OPEN_IN_PROMPT_TIMEOUT_MS` — so it stays worth
 * skipping, just not before the approval has been shown to work once.
 */
export function isUrlSchemePreapproved(udid: string | null | undefined, url: string): boolean {
  const scheme = urlSchemeFromUrl(url)
  if (!scheme || !udid?.trim()) return false
  return schemeApprovals.get(preapprovalKey(udid, scheme)) === 'approved'
}

/**
 * Records that an open of `url` on this simulator found no "Open in …?" sheet left to clear, so the
 * written approval is now in force and later opens can skip the probe.
 */
export function markUrlSchemeApproved(udid: string | null | undefined, url: string): void {
  const scheme = urlSchemeFromUrl(url)
  if (!scheme || !udid?.trim()) return
  schemeApprovals.set(preapprovalKey(udid, scheme), 'approved')
}

/** Test seam: drops every remembered approval so cases do not leak state into one another. */
export function resetUrlSchemeApprovals(): void {
  schemeApprovals.clear()
}

export interface IosSchemeApprovalClient {
  command: {
    alert: (options?: {
      action?: 'get' | 'accept' | 'dismiss' | 'wait'
      timeoutMs?: number
      platform?: 'ios'
    }) => Promise<unknown>
  }
  interactions: {
    press: (options: { selector: string; platform?: 'ios' }) => Promise<unknown>
  }
}

export function urlSchemeFromUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed).protocol.replace(/:$/, '') || null
  } catch {
    const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(trimmed)
    return match?.[1] ?? null
  }
}

export function shouldPreapproveUrlScheme(url: string): boolean {
  const scheme = urlSchemeFromUrl(url)?.toLowerCase()
  return Boolean(scheme) && scheme !== 'http' && scheme !== 'https'
}

export function schemeApprovalKey(scheme: string): string {
  return `${APPROVAL_KEY_PREFIX}${scheme}`
}

function collectPromptText(payload: unknown): string {
  if (payload == null) return ''
  if (typeof payload === 'string') return payload
  if (typeof payload === 'number' || typeof payload === 'boolean') return String(payload)
  if (Array.isArray(payload)) return payload.map(collectPromptText).join(' ')
  if (typeof payload === 'object') {
    return Object.values(payload as Record<string, unknown>)
      .map(collectPromptText)
      .join(' ')
  }
  return ''
}

export async function preapproveIosUrlScheme(options: {
  udid: string
  url: string
  bundleId: string
  /** Test seam for the `defaults write`; defaults to `xcrun simctl spawn …`. */
  writeApproval?: (write: { udid: string; scheme: string; bundleId: string }) => Promise<void>
}): Promise<boolean> {
  if (!shouldPreapproveUrlScheme(options.url)) return false
  const scheme = urlSchemeFromUrl(options.url)
  if (!scheme || !options.udid.trim() || !options.bundleId.trim()) return false

  try {
    if (options.writeApproval) {
      await options.writeApproval({ udid: options.udid, scheme, bundleId: options.bundleId })
    } else {
      await execFileAsync('xcrun', [
        'simctl',
        'spawn',
        options.udid,
        'defaults',
        'write',
        APPROVAL_DOMAIN,
        schemeApprovalKey(scheme),
        '-string',
        options.bundleId
      ])
    }
    // Pending, not approved: `launchservicesd` has not necessarily read this back yet, and the very
    // open this write is for may still land on the sheet. One probe decides it — see
    // `schemeApprovals` and `markUrlSchemeApproved`.
    const key = preapprovalKey(options.udid, scheme)
    if (schemeApprovals.get(key) !== 'approved') schemeApprovals.set(key, 'pending')
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(
      `[ios] could not preapprove ${scheme} for ${options.bundleId} on ${options.udid}: ${message}`
    )
    return false
  }
}

export async function acceptOpenInAppPrompt(
  client: IosSchemeApprovalClient
): Promise<'accepted' | 'absent' | 'skipped'> {
  // One alert command, not two. The previous pair — `wait` and then `get` — ran SpringBoard's modal
  // enumeration twice, and the `wait` gave its block a 2.5s main-thread budget that the enumeration
  // could not finish inside. Every sweep therefore abandoned that block on the first deep link, and
  // the runner answered RUNNER_BUSY to every snapshot behind it for the two minutes it took to
  // reach the wedge threshold and be recycled. `wait` was never a distinct action on the runner
  // anyway: it resolves the alert and falls through to the same branch `get` does.
  let info: unknown
  try {
    info = await client.command.alert({
      action: 'get',
      platform: 'ios',
      timeoutMs: OPEN_IN_PROMPT_TIMEOUT_MS
    })
  } catch {
    // "alert not found" — nothing is on screen to accept, which is the normal case once the scheme
    // is pre-approved and the only case worth being fast about.
    return 'absent'
  }

  const text = collectPromptText(info)
  if (text && !OPEN_IN_PROMPT_RE.test(text)) return 'skipped'
  try {
    await client.command.alert({
      action: 'accept',
      platform: 'ios',
      timeoutMs: OPEN_IN_PROMPT_TIMEOUT_MS
    })
    return 'accepted'
  } catch {
    try {
      await client.interactions.press({ selector: 'text="Open"', platform: 'ios' })
      return 'accepted'
    } catch {
      return 'skipped'
    }
  }
}
