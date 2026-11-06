/**
 * The sweep's per-node queue — plan Step 3c's prerequisite.
 *
 * The sweep used to be a raw `for (let i = 0; i < nodesWithSlug.length; i++)` loop, with a blocked
 * run retrying the current node via `i -= 1` and every "how many screens are left" question answered
 * by arithmetic on `i` scattered through the loop body (`total - i` for the auth gate mid-node,
 * `total - i - 1` once a node has just failed, `i + 1` once it has just succeeded). That shape only
 * works because the loop visits `nodesWithSlug` in array order — the moment sweep ordering
 * (`sweep-order.ts`) reshuffles that array, the index arithmetic keeps working (it never assumed
 * anything about *which* node sits at position `i`), but the raw index has no name for what it means
 * and every call site has to independently reconstruct "how far along am I". `ReachQueue` gives that
 * state a single, pull-based home so the loop body reads its position instead of recomputing it.
 *
 * No device or Electron import here — see `reach/types.ts`'s doc comment. This module is plain data
 * and pure functions, run under `node --test` with no Electron runtime.
 */

/**
 * A pull-based cursor over an ordered list of items to process one at a time. `next()` hands out the
 * next item and — as far as `completed`/`remaining` are concerned — assumes it will be finished
 * before `next()` is called again. `requeueCurrent()` is the one way to undo that assumption: it
 * marks the item just handed out as not-yet-done, so the very next `next()` call re-serves the same
 * item and `completed` never counted it.
 *
 * This mirrors the old loop precisely: `completed` reads exactly like the old `i` did at the top of
 * the loop body (nodes strictly before the current one), and `remaining` reads exactly like the old
 * `total - i` (the current node included, since it is not done yet). A caller that has just finished
 * processing the current node successfully reports `completed + 1` / discards a node with
 * `remaining - 1`, the same shift the old code applied by hand at those two call sites.
 */
export class ReachQueue<T> {
  private readonly items: readonly T[]
  /** Index of the item currently in flight, or one past the end once every item was served. -1
   * before the first `next()` call, so `completed` reports 0 and `remaining` reports the full count. */
  private index = -1
  /** Set by `requeueCurrent()`; consumed by the following `next()`, which then re-serves `index`
   * instead of advancing past it. */
  private requeued = false

  constructor(items: readonly T[]) {
    this.items = items
  }

  /** Total items the queue was constructed with — never changes. */
  get total(): number {
    return this.items.length
  }

  /** Items strictly before the one currently in flight (or, before any `next()` call, zero). */
  get completed(): number {
    return this.index < 0 ? 0 : this.index
  }

  /** Items left to process, the current one included. */
  get remaining(): number {
    return this.items.length - this.completed
  }

  /**
   * Hands out the next item, or `null` once the queue is exhausted. Advances past the previously
   * served item unless `requeueCurrent()` was called since the last `next()`, in which case the same
   * item is served again.
   */
  next(): T | null {
    this.index = this.requeued ? this.index : this.index + 1
    this.requeued = false
    if (this.index >= this.items.length) return null
    return this.items[this.index]
  }

  /**
   * Re-serves the item just handed out by `next()` — the direct replacement for the old loop's
   * `i -= 1` retry (`orchestrator.ts`'s blocked-run recovery). Calling this without a preceding
   * `next()`, or calling it twice between two `next()` calls, is a caller bug; it has no effect
   * beyond arming the very next `next()` to repeat.
   */
  requeueCurrent(): void {
    this.requeued = true
  }
}
