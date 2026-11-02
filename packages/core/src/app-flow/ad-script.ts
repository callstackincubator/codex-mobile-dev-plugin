/**
 * Locating and editing a single step inside a recorded `.ad` script.
 *
 * Pure and separate from `capture.ts` for the same reason `replay-divergence.ts` is: `capture.ts`
 * reaches `electron` through `./storage` and cannot be imported under the test runner. What lives
 * here decides which line of a verified recording gets rewritten, so it is worth testing.
 *
 * Step numbers in agent-device's divergence reports are 1-based over the lines it *executes*, which
 * is every line except `context`, blanks and comments — the `# agent-device:target-v1` identity
 * records among them. Step 5 of the measured social-app seeds is therefore script line 8, and
 * nothing may assume the two numberings agree.
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
 * This is the last lever available for the failure that costs this sweep every seed but Home. The
 * recorded identity is *correct about the button* — `matchCount 1`, no competing candidate, every
 * field matching except where the button sits — and wrong only about the tree around it, which
 * reads `application/"Blue Sky"` on one snapshot and `other/"Home"` on the next of the same screen.
 * Record-and-heal cannot win that: it re-recorded the identical ancestry and the healed script
 * failed at the same step. Removing the annotation removes the guard built from it, so the step
 * resolves on its selector alone — which already matched one element and the right one.
 *
 * What is given up is narrow and worth naming: that press no longer re-verifies *which* element it
 * found. The destination `wait` after it keeps its own identity record, so arrival is still proved;
 * only the press's own structural assertion goes. Callers must therefore strip on the evidence of
 * an ancestry-only mismatch and never as a way to quiet a `SELECTOR_MISS` or an ambiguous match,
 * where it would turn a caught mistake into a silent wrong tap.
 *
 * Returns `undefined` when there is nothing to strip — the step is not a press, or it carries no
 * identity comment — so a caller can tell "already stripped" from "stripped now" and stop looping.
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
  return `wait "${clause.replace(/"/g, '\\"')}" ${INSERTED_WAIT_TIMEOUT_MS}`
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
 * Two changes to `stripRecordedIdentity`'s one-step-at-a-time behaviour, both measured on the
 * 15-53-19 sweep, where this path cost 17s across two replays and still published nothing.
 *
 * **All at once, not one per replay.** The caller used to strip the reported step, replay (~8s),
 * read the next report, strip again. But the instability is a property of a *node*, not of a step:
 * `ProfileFollowers` recorded `application/"Blue Sky"` in the ancestry of both its presses and the
 * replay rejected both, the second only after a round trip that could have been predicted from the
 * first. So every press sharing an ancestry entry with the proven-unstable one is stripped in the
 * same pass. Steps whose ancestry is disjoint keep their guard: the evidence is about one node, and
 * widening past it would start swallowing the moved-or-relabelled control that record-and-heal is
 * the right answer for. An identity with no recorded ancestry at all proves nothing shareable, so
 * only the reported step is touched.
 *
 * **A wait where the guard was.** `stripRecordedIdentity`'s doc names what a strip gives up — the
 * press stops re-verifying *which* element it found — and treats the destination wait as enough to
 * cover it. For `ProfileFollowers` step 7 it was not: that press had no wait in front of it at all,
 * so dropping its identity turned `IDENTITY_MISMATCH` into `COMMAND_FAILED`, the bare selector
 * evaluated against a tree whose header was still `other/"Profile banner placeholder"` — the same
 * placeholder the earlier mismatch had named. The identity record had been doing double duty as a
 * *temporal* guard. Replacing it with the selector wait agent-device records for its own presses
 * restores that, for the better reason: the press now waits for the control to exist rather than
 * asserting the shape of the tree around it.
 *
 * Only a press leading with an `id="…"` alternative gets a wait, and only when the step before it
 * is not already that wait — an id is the one part of a recorded selector that is not derived from
 * volatile display text (`label="1 follower"`), and a wait on the rest would be a guess.
 *
 * Inserting a wait renumbers every later step, so the result is not a base for a second round of
 * report-driven stripping: the caller replays it once and restores the original if it still fails.
 *
 * Returns `undefined` when `step` is not a press carrying an identity — the same "nothing to do"
 * signal `stripRecordedIdentity` gives, so an already-stripped script cannot be processed twice.
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
