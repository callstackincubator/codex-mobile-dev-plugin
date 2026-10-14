/**
 * Reading agent-device's `REPLAY_DIVERGENCE` report.
 *
 * Split out of `capture.ts` for one reason: `capture.ts` reaches `electron` through `./storage`, so
 * importing it under the test runner throws before a single assertion runs. This logic is pure, it
 * is the part that decides whether a seed gets healed or thrown away, and it was wrong twice before
 * the structured report existed — it belongs somewhere it can be tested.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

export function describeReplayDivergence(error: unknown): string | undefined {
  const divergence = asRecord(asRecord(asRecord(error)?.details)?.divergence)
  if (!divergence) return undefined

  const parts: string[] = []
  const cause = asRecord(divergence.cause)
  if (typeof cause?.code === 'string') parts.push(`cause ${cause.code}`)
  if (typeof divergence.repairHint === 'string') parts.push(`repairHint ${divergence.repairHint}`)

  const binding = asRecord(divergence.targetBinding)
  if (binding) {
    if (typeof binding.matchCount === 'number') parts.push(`matchCount ${binding.matchCount}`)
    if (Array.isArray(binding.mismatches) && binding.mismatches.length > 0)
      parts.push(`mismatches ${binding.mismatches.slice(0, 5).map(String).join('; ')}`)
    if (Array.isArray(binding.candidates))
      parts.push(`${binding.candidates.length} candidate(s) shared the recorded identity`)
  }

  // What a heal would have needed, kept now purely as diagnostics: agent-device's own answer to a
  // divergence is to re-perform the step as a recorded action and continue with
  // `replay --from <n> --plan-digest <d>`, which is only possible while `resume.allowed` is true
  // and the repair session is still held. Nothing here drives a repair any more — see
  // `parseStructuralOnlyMismatchStep` for why that route was removed — but these are the fields
  // that say whether agent-device thought the script was recoverable at all, and none of them is
  // inferable from the message.
  const resume = asRecord(divergence.resume)
  if (resume) {
    const allowed = resume.allowed === true
    parts.push(
      `resume ${allowed ? 'allowed' : `denied${typeof resume.reason === 'string' ? ` (${resume.reason})` : ''}`}`
    )
    if (allowed) {
      parts.push(`from ${String(resume.from)}`)
      if (typeof resume.alternateFrom === 'number')
        parts.push(`alternateFrom ${resume.alternateFrom}`)
      if (typeof resume.planDigest === 'string') parts.push(`planDigest ${resume.planDigest}`)
    }
    if (resume.repairSessionHeld === true) parts.push('repairSessionHeld')
  }

  const screen = asRecord(divergence.screen)
  if (typeof screen?.state === 'string') parts.push(`screen ${screen.state}`)
  // The first few refs, because the root is the node under suspicion. A mismatch confined to
  // `ancestry[0]` says the recorded and observed trees disagree about what the button hangs off,
  // and the only way to tell which reading is the odd one out is to see the tree agent-device
  // actually had in front of it.
  if (Array.isArray(screen?.refs) && screen.refs.length > 0) {
    const refs = screen.refs.slice(0, 3).map((raw) => {
      const ref = asRecord(raw)
      if (!ref) return String(raw)
      const label = typeof ref.label === 'string' ? ` "${ref.label}"` : ''
      return `${String(ref.ref ?? '?')} [${String(ref.role)}]${label}`
    })
    parts.push(
      `refs ${refs.join(', ')}${screen.refs.length > 3 ? ` (+${screen.refs.length - 3})` : ''}`
    )
  }

  const suggestions = Array.isArray(divergence.suggestions) ? divergence.suggestions : []
  for (const raw of suggestions.slice(0, 3)) {
    const suggestion = asRecord(raw)
    if (!suggestion) continue
    const label = typeof suggestion.label === 'string' ? ` "${suggestion.label}"` : ''
    parts.push(`suggestion [${String(suggestion.basis)}]${label} ${String(suggestion.selector)}`)
  }

  return parts.length > 0 ? parts.join(' | ') : undefined
}

/**
 * A divergence whose *only* disagreement is where the target sits in the tree, which
 * record-and-heal cannot fix.
 *
 * Measured, not reasoned: the heal ran on three seeds and the script it published records step 5's
 * ancestry as `application/"Blue Sky"` — byte-identical to the identity that had just been
 * rejected, differing only in `rect`. The corrective press re-read the tree seconds after the
 * replay observed `other/"Home"` on the same screen in the same session, and read `application`
 * again. So the re-recorded identity is not a correction; the root node's reading is simply not
 * stable between reads, and re-recording it reproduces the same mismatch on the next replay. All
 * three healed scripts failed their verification replay at the same step with the same code.
 *
 * Narrow on purpose. `matchCount === 1` with no competing candidate means the selector found
 * exactly one element and agent-device agreed it is the recorded one on every field it checked
 * except where the element sits. Widen this and the strip would start dropping recorded evidence
 * for divergences it does not describe — a moved or relabelled control, where the recorded identity
 * is genuinely wrong about the element and silently ignoring it hides a broken script.
 *
 * `position:` is admitted on the same evidence and for the same reason. It is emitted by `gd` in
 * agent-device's `session2.js`, which compares the `documentOrder`/`sibling` of the node
 * pre-action verification isolated against the node dispatch resolution then resolved — two reads
 * milliseconds apart inside one replay step, both taken from the live snapshot. Nothing in the
 * recorded script is an input to that comparison, so no edit to a `target-v1` annotation can
 * change its outcome; `_d` appends it *after* the identity diff rather than in place of it, which
 * is why it can be the whole mismatch list while every recorded field still agrees.
 *
 * Measured on the 20-05-23 sweep, which is also what proves re-recording is not the answer here:
 * `MyProfile`, `Profile` and `ProfileFollowers` each failed the press on `bottomBarProfileBtn`
 * with `mismatches: position: recorded=doc24/sibling4 observed=doc23/sibling7` — the same control,
 * the same numbers, three times. All three were healed, and all three healed scripts reproduced
 * the failure byte for byte. 117s of exploration, 39% of the sweep, published nothing — which is
 * why the heal no longer exists and this predicate no longer has a rival to decline in favour of.
 * Routing them here sends them to the strip, the one tier that works on this class:
 * removing the annotation stops pre-action verification running at all, so `gd` is never reached.
 * `SearchTab/Search` is the control case — its press happened to keep its position, failed
 * ancestry-only, took the strip and published.
 */
function isStructuralOnlyMismatch(divergence: Record<string, unknown>): boolean {
  if (asRecord(divergence.cause)?.code !== 'IDENTITY_MISMATCH') return false
  const binding = asRecord(divergence.targetBinding)
  if (!binding || binding.matchCount !== 1) return false
  if (Array.isArray(binding.candidates) && binding.candidates.length > 0) return false
  const mismatches = binding.mismatches
  if (!Array.isArray(mismatches) || mismatches.length === 0) return false
  return mismatches.every((entry) => {
    const field = String(entry).trimStart()
    return field.startsWith('ancestry[') || field.startsWith('position:')
  })
}

/**
 * The 1-based step of a divergence that `isStructuralOnlyMismatch` describes, or `undefined`.
 *
 * The one reader of a divergence left, and the only lever anything downstream still pulls: the
 * recorded identity itself. Re-recording the step — agent-device's record-and-heal, which this
 * module used to supply resume coordinates for — is gone, because every firing of it this repo ever
 * recorded was a failure. Three seeds on the 15-07-13 sweep and the three named above on the
 * 20-05-23 one were healed; all six healed scripts reproduced the rejected identity byte for byte
 * and all six candidates were discarded, 117s and 39% of the 20-05-23 sweep for nothing. There is
 * no recorded heal success to weigh against that, and nothing in the mechanism suggests one is
 * possible for this class: the re-read is taken from the same unstable tree the replay just read.
 *
 * `resume.from` is the failed index — the step to strip, not a step to resume at.
 */
export function parseStructuralOnlyMismatchStep(error: unknown): number | undefined {
  const divergence = asRecord(asRecord(asRecord(error)?.details)?.divergence)
  if (!divergence || !isStructuralOnlyMismatch(divergence)) return undefined
  const failedStep = asRecord(divergence.resume)?.from
  return typeof failedStep === 'number' ? failedStep : undefined
}
