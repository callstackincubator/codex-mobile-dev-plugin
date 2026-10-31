/**
 * A snapshot that views read with `useSyncExternalStore`. Each change replaces the
 * snapshot and notifies subscribers; after `close()` changes are ignored, so work that
 * finishes after its panel is gone cannot publish into it.
 */
export class Store<S> {
  #listeners = new Set<() => void>();
  #closed = false;
  protected state: S;

  constructor(state: S) { this.state = state; }

  readonly subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  readonly getSnapshot = (): S => this.state;

  protected get closed() { return this.#closed; }
  protected update(patch: Partial<S>) { this.set({ ...this.state, ...patch }); }
  protected set(state: S) {
    if (this.#closed) return;
    this.state = state;
    for (const listener of this.#listeners) listener();
  }
  /** Ignores later changes and drops subscribers. */
  protected close() { this.#closed = true; this.#listeners.clear(); }
}
