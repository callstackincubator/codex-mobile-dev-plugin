import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const APPROVAL_DOMAIN = 'com.apple.launchservices.schemeapproval'
const APPROVAL_KEY_PREFIX = 'com.apple.CoreSimulator.CoreSimulatorBridge-->'
const OPEN_IN_PROMPT_RE = /\bopen in\b/i
/**
 * Budget for the one alert probe in `acceptOpenInAppPrompt`.
 *
 * XCTest cannot cancel an alert query that exceeds this timeout; the runner remains busy until the
 * query drains. Keep the budget generous enough for a cold simulator during app launch.
 */
const OPEN_IN_PROMPT_TIMEOUT_MS = 15_000

/**
 * Scheme approvals by simulator. They are device-level state and therefore span capture sessions.
 *
 * A write remains `pending` until an open confirms it: `launchservicesd` may not apply a fresh
 * write before the first URL open, which can still show the "Open in …?" sheet.
 */
const schemeApprovals = new Map<string, 'pending' | 'approved'>()

function preapprovalKey(udid: string, scheme: string): string {
  return `${udid}\u0000${scheme.toLowerCase()}`
}

/** Whether an open has confirmed this simulator's approval for the URL scheme. */
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
    // The first open can still show the prompt before launchservicesd applies the write.
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
  // `wait` and `get` both enumerate the modal hierarchy; use one command to avoid wedging the runner.
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
