/**
 * Pure helpers for editing recorded `.ad` scripts without importing `capture.ts` and its Electron
 * dependencies. agent-device step numbers are 1-based over executable lines, not file lines.
 */

/** The `# agent-device:target-v1 {...}` comment that records the identity of the step below it. */
const TARGET_COMMENT = '# agent-device:target-v1'

function isExecutable(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.length > 0 && !trimmed.startsWith('#') && !trimmed.startsWith('context ')
}

/** The 0-based file line index of a 1-based execution step, or `undefined` if the script is shorter. */
export function lineIndexOfStep(lines: readonly string[], step: number): number | undefined {
  let seen = 0
  for (const [index, line] of lines.entries()) {
    if (!isExecutable(line)) continue
    seen += 1
    if (seen === step) return index
  }
  return undefined
}

/**
 * The selector of a `press` step, unescaped, or `undefined` for any other kind of step.
 *
 * Deliberately narrow: a press is the only step the recovery paths know how to re-perform or
 * re-bind, and every divergence measured on social-app is one.
 */
export function pressSelectorAtStep(lines: readonly string[], step: number): string | undefined {
  const index = lineIndexOfStep(lines, step)
  if (index === undefined) return undefined
  const match = /^press\s+"(.*)"$/.exec(lines[index].trim())
  return match ? match[1].replace(/\\(["\\])/g, '$1') : undefined
}

/**
 * Drop the recorded identity comment above a press step, leaving the press itself untouched.
 *
 * This recovery is safe only for an ancestry-only mismatch; using it for a missing or ambiguous
 * selector could hide a wrong tap. Returns `undefined` when the step has no removable identity.
 */
export function stripRecordedIdentity(
  lines: readonly string[],
  step: number
): string[] | undefined {
  const index = lineIndexOfStep(lines, step)
  if (index === undefined) return undefined
  if (!/^press\s+"/.test(lines[index].trim())) return undefined
  if (index === 0 || !lines[index - 1].trim().startsWith(TARGET_COMMENT)) return undefined
  return [...lines.slice(0, index - 1), ...lines.slice(index)]
}

/** The timeout recorded on agent-device's own selector waits, reused for the ones we insert. */
const INSERTED_WAIT_TIMEOUT_MS = 15_000

/** The recorded `target-v1` payload above a step, or `undefined` when there is none to read. */
export function identityAtStep(
  lines: readonly string[],
  step: number
): Record<string, unknown> | undefined {
  const index = lineIndexOfStep(lines, step)
  if (index === undefined || index === 0) return undefined
  const previous = lines[index - 1].trim()
  if (!previous.startsWith(TARGET_COMMENT)) return undefined
  try {
    const parsed: unknown = JSON.parse(previous.slice(TARGET_COMMENT.length).trim())
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/**
 * The recorded ancestry of an identity, as comparable `role/label` keys.
 *
 * Keys rather than objects because this exists to answer one question — do two recorded identities
 * hang off the same node — and the divergence that motivates it names that node by exactly these
 * two fields (`recorded=application/"Blue Sky"`).
 */
function ancestryKeys(identity: Record<string, unknown> | undefined): string[] {
  const ancestry = identity?.ancestry
  if (!Array.isArray(ancestry)) return []
  return ancestry.flatMap((raw) => {
    if (typeof raw !== 'object' || raw === null) return []
    const entry = raw as Record<string, unknown>
    const role = typeof entry.role === 'string' ? entry.role : ''
    const label = typeof entry.label === 'string' ? entry.label : ''
    return [`${role}/${label}`]
  })
}

/** The leading `id="…"` alternative of a press selector, or `undefined` when it does not lead with one. */
function idClause(selector: string): string | undefined {
  const first = selector.split('||')[0].trim()
  return /^id="[^"]+"$/.test(first) ? first : undefined
}

/** The `wait "<selector>" <timeout>` line agent-device would have recorded for this id clause. */
function waitLineFor(clause: string): string {
  // Backslashes must be escaped before quotes, matching the unescape above (`/\\(["\\])/g`):
  // escaping only `"` leaves a clause ending in a literal backslash (`id="foo\\"`) parsing as an
  // escaped quote that swallows the line's own closing quote.
  const escaped = clause.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `wait "${escaped}" ${INSERTED_WAIT_TIMEOUT_MS}`
}

/** The previous executable line before a file index, or `undefined` at the start of the script. */
function previousExecutable(lines: readonly string[], index: number): string | undefined {
  for (let i = index - 1; i >= 0; i--) if (isExecutable(lines[i])) return lines[i].trim()
  return undefined
}

export interface UnguardedPresses {
  readonly lines: string[]
  /** 1-based steps, in the *input* numbering, whose recorded identity was dropped. */
  readonly stripped: number[]
  /** 1-based steps, in the *input* numbering, that gained a selector wait in front of them. */
  readonly guarded: number[]
}

/**
 * Drop every recorded identity that hangs off the node a divergence just proved unstable, and give
 * each unguarded press a selector wait in its place.
 *
 * All presses sharing the unstable ancestry are handled in one pass; unrelated identities retain
 * their guards. A leading `id="…"` selector receives a wait unless the preceding executable line is
 * already identical. Because inserted waits renumber later steps, callers must not feed the result
 * into another report-driven pass. Returns `undefined` when the reported step has no identity.
 */
export function unguardPressSteps(
  lines: readonly string[],
  step: number
): UnguardedPresses | undefined {
  if (!stripRecordedIdentity(lines, step)) return undefined

  const unstable = new Set(ancestryKeys(identityAtStep(lines, step)))

  // Collected as (step, lineIndex) pairs up front, because editing invalidates both numberings.
  const targets: { step: number; index: number }[] = []
  let seen = 0
  for (const [index, line] of lines.entries()) {
    if (!isExecutable(line)) continue
    seen += 1
    if (!/^press\s+"/.test(line.trim())) continue
    if (index === 0 || !lines[index - 1].trim().startsWith(TARGET_COMMENT)) continue
    const shares = ancestryKeys(identityAtStep(lines, seen)).some((key) => unstable.has(key))
    if (seen === step || shares) targets.push({ step: seen, index })
  }

  // Descending, so each edit leaves the indices of the ones not yet applied untouched.
  let next = [...lines]
  const stripped: number[] = []
  const guarded: number[] = []
  for (const target of [...targets].reverse()) {
    const selector = pressSelectorAtStep(lines, target.step)
    const clause = selector ? idClause(selector) : undefined
    const wait = clause ? waitLineFor(clause) : undefined
    const alreadyGuarded = previousExecutable(lines, target.index - 1) === wait

    next = [
      ...next.slice(0, target.index - 1),
      ...(wait && !alreadyGuarded ? [wait] : []),
      ...next.slice(target.index)
    ]
    stripped.unshift(target.step)
    if (wait && !alreadyGuarded) guarded.unshift(target.step)
  }

  return { lines: next, stripped, guarded }
}

/**
 * The selector a published script's trailing destination guard waits on, or `undefined`.
 *
 * `saveAndReplayRecording` appends that guard as the last thing it records, so for any script that
 * reached publication the final executable line is `wait "<selector>" 15000` on a non-chrome
 * landmark of the destination. Reading it back is what lets a caller that did not record the
 * script — the saved-replay rung, verifying it for the first time — hand the same selector to the
 * recovery tiers, which need somewhere to wait after they rewrite a step.
 *
 * Deliberately only the *last* line. A script is full of intermediate waits, and any of them would
 * be accepted by a looser search while proving nothing about arrival.
 */
export function destinationGuardSelector(lines: readonly string[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!isExecutable(lines[i])) continue
    const match = /^wait\s+"(.*)"\s+\d+$/.exec(lines[i].trim())
    return match ? match[1].replace(/\\(["\\])/g, '$1') : undefined
  }
  return undefined
}
