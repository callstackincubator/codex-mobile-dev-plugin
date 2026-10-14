import type { AppFlowPressable } from '../shared/app-flow.ts'

// A dev build shows a splash screen and then Metro's "Downloading JS bundle" bar before the first
// route mounts. Anything whose only on-screen text looks like that is not a screen.
const LOADING_LABEL_RE =
  /^(loading|please wait|downloading|bundling|building|starting|connecting|refreshing)\b/i

/** True while the app is still booting: nothing interactive, or only loading chrome. */
export function isLoadingScreen(pressables: readonly AppFlowPressable[]): boolean {
  return pressables.every((pressable) => {
    const text = `${pressable.text ?? pressable.label ?? pressable.identifier ?? ''}`.trim()
    return !text || LOADING_LABEL_RE.test(text)
  })
}

/**
 * Lowercases and splits `source` into the same token vocabulary a pressable's text contributes to
 * `fingerprint` below. Pulled out so static text — a route's title, id, or url segments — can be
 * tokenized identically and compared against a live observation on equal footing (see
 * `expectedNodeTokens` in exploration.ts, used for opportunistic screen capture).
 */
export function tokenize(source: string): string[] {
  const out: string[] = []
  for (const word of source.toLowerCase().split(/[^a-z0-9@#']+/)) {
    // Short tokens and bare numbers are noise: counters, badges, timestamps and ids differ
    // between two visits to the same screen.
    if (word.length < 3 || /^\d+$/.test(word)) continue
    out.push(word)
  }
  return out
}

/**
 * The words a screen exposes through its interactive elements.
 *
 * Identity, not vocabulary: two fingerprints can be compared without knowing what either screen
 * is, so nothing here needs to be taught about sign-in, onboarding, paywalls or any other kind of
 * gate, in any language. The accessibility snapshot is already captured for every screen, so this
 * costs no extra device work and no tokens.
 */
export function fingerprint(pressables: readonly AppFlowPressable[]): Set<string> {
  const out = new Set<string>()
  for (const pressable of pressables) {
    const source = [pressable.text, pressable.label, pressable.identifier].filter(Boolean).join(' ')
    for (const word of tokenize(source)) out.add(word)
  }
  return out
}

/** Jaccard overlap of two fingerprints. 1 = the same screen, 0 = nothing in common. */
export function similarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size && !b.size) return 1
  let shared = 0
  for (const word of a) if (b.has(word)) shared += 1
  return shared / (a.size + b.size - shared)
}

/**
 * Whether a frame that just passed the two-matching-reads settle test is still the frame that was
 * on screen *before* the caller's action, and so should not be reported as settled yet.
 *
 * This is what replaces a flat sleep after a deep link or a tap. The sleep was never covering the
 * app's load — a stability poll does that, and better — it was covering one specific wrong answer:
 * a router transition takes a beat, so a poll that starts immediately can read the *previous*
 * screen twice, find it perfectly stable (it is: nothing is happening on it), and hand the caller a
 * frame from before the action as the result of the action. The judge downstream then honestly
 * reports a mismatch for a route that works.
 *
 * Comparing against the pre-action frame answers that directly, which a sleep can only approximate:
 * a screen that did change settles as soon as two reads agree, with no fixed cost at all, and a
 * screen that is still mid-transition keeps waiting however long it actually needs.
 *
 * `graceMs` is required because "unchanged" is sometimes the right answer — a deep link to the
 * screen the app is already on changes nothing, and so does a tap that opens a menu the reader
 * cannot see. Past the grace, an unchanged frame is accepted and the caller behaves exactly as it
 * did when the sleep was unconditional. The grace is therefore a ceiling on this function's cost,
 * not a floor on every call's: the old sleep was paid by every screen, this is paid only by screens
 * that genuinely have not moved.
 */
export function isFrameUnchangedSinceAction(input: {
  /** Fingerprint of the frame before the action that is being waited on. */
  before: ReadonlySet<string>
  /** Fingerprint of the frame two consecutive reads just agreed on. */
  settled: ReadonlySet<string>
  /** Milliseconds since the action was issued. */
  elapsedMs: number
  /** How long an unchanged frame is disbelieved before being accepted. */
  graceMs: number
  /** The overlap at which two frames count as the same screen. */
  similarityFloor: number
}): boolean {
  if (input.elapsedMs >= input.graceMs) return false
  return similarity(input.before, input.settled) >= input.similarityFloor
}

/**
 * Markers unique to the Expo dev-client / dev-launcher screen.
 *
 * Each is a heading or control that screen renders and that an app's own UI has no reason to show.
 * Matching is deliberately anchored where the text is a whole caption ("Development Servers" is a
 * section heading, not a phrase inside a sentence) so a post or a settings row that happens to
 * mention a development server does not read as the launcher.
 */
const DEV_LAUNCHER_MARKER_RES = [
  /^development servers$/i,
  /^recently opened$/i,
  /^fetch development servers$/i,
  /\benter url manually\b/i,
  /^start a local development server/i
]

/**
 * True when the frame is the dev client's own launcher rather than the app under test.
 *
 * This matters because the launcher is indistinguishable from a real screen to every other signal
 * the sweep has. It is fully rendered and interactive, so `isLoadingScreen` does not flag it and
 * `waitForAppReady` reports it settled; it runs inside the app's own process, so its bundle id is
 * the app's and agent-device's `appstate` — which is session-derived on iOS — names the bound app
 * either way. Nothing short of reading the screen tells the two apart.
 *
 * The cost of not telling them apart is not one bad frame. A deep link into the launcher does
 * nothing at all, so the route is judged a mismatch, the walk that follows explores the launcher's
 * own controls, and the replay recorded from it fails on its first press. One stalled app is
 * enough to bill a whole sweep for screens it never captured.
 *
 * Two markers are required rather than one. A single heading can appear by coincidence — an app
 * with a developer-settings screen is the obvious case — while the pair "Development Servers" plus
 * "Enter URL manually" is the launcher and nothing else.
 */
export function isDevClientLauncher(pressables: readonly AppFlowPressable[]): boolean {
  const matched = new Set<number>()
  for (const pressable of pressables) {
    for (const source of [pressable.text, pressable.label, pressable.identifier]) {
      const text = source?.trim()
      if (!text) continue
      DEV_LAUNCHER_MARKER_RES.forEach((re, index) => {
        if (re.test(text)) matched.add(index)
      })
    }
  }
  return matched.size >= 2
}

/**
 * The deep link that makes an Expo dev client load a bundle from `metroPort` instead of sitting on
 * the launcher `isDevClientLauncher` above detects. Its companion: that function recognises the
 * screen, this one addresses the only thing that clears it.
 *
 * `expo-development-client` is the route the dev client registers on the app's own scheme, and
 * `?url=` names the server it should connect to — the same thing that happens when a person taps a
 * row under "Recently Opened", which is exactly the manual fix this replaces. `127.0.0.1` rather
 * than the LAN address the launcher lists, because the only consumer is a simulator sharing this
 * machine's loopback.
 *
 * Returns `null` when the app cannot have a dev client to address: Expo Go carries its bundle URL
 * at launch already, and an app with no custom scheme has no route to open. A plain React Native
 * build does get a URL here, and opening it is an inert no-op on that app — harmless, because the
 * only caller first establishes that the Expo launcher is on screen, which such a build cannot show.
 */
export function devClientReconnectUrl(
  scheme: string | null,
  isNativeBuild: boolean,
  metroPort: number
): string | null {
  if (!isNativeBuild || !scheme || !metroPort) return null
  return `${scheme}://expo-development-client/?url=${encodeURIComponent(`http://127.0.0.1:${metroPort}`)}`
}

/**
 * Whether re-rooting this app has to go through the dev-client reconnect URL because it has no
 * launch URL of its own.
 *
 * The pure half of the decision `goHome` makes in `capture.ts`, kept here so it can be stated and
 * tested without a device. The thing it encodes is easy to get wrong twice in a row, and the
 * 2026-10-09 social-app sweep got it wrong both ways in thirty seconds: `relaunchBoundApp` opened
 * `launchUrl`, which `openInstalledApp` returns as `null` for every `native-run` build, so a
 * dev client was restarted with nothing to load and came up on its launcher — three interactive
 * elements that then read as a settled screen twice and cost two `arrival` model calls against
 * the Expo launcher. A soft open at the same null URL would not have been wrong so much as
 * *nothing*: `apps.open` with no URL and no `--relaunch` against a frontmost process brings it to
 * the front of itself, which `reconnectDevClient`'s comment records sixteen consecutive failures
 * of. The URL that actually re-roots such a build is `devClientUrl`.
 *
 * Deliberately not "always prefer `devClientUrl` when it exists". Opening it tells the dev client
 * to fetch and evaluate the bundle again, which is a reload, not a re-root — on the sweep above
 * that reload is what killed a warm app and cost 28s of recovery. So the fallback is only for a
 * build that has no launch URL at all, and only for a caller that has already established the app
 * is not loaded.
 */
export function needsDevClientReconnect(device: {
  launchUrl: string | null
  devClientUrl: string | null
}): boolean {
  return !device.launchUrl && Boolean(device.devClientUrl)
}
