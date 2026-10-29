interface URLSearchParams extends Iterable<[name: string, value: string]> {
  /** The total number of search parameters. */
  readonly size: number

  /**
   * Append a new `name`/`value` pair.
   * @param name - The parameter name.
   * @param value - The parameter value.
   */
  append(name: string, value: string): void
  /**
   * Remove all pairs with `name`. If `value` is provided, only pairs with both the matching `name`
   * and `value` are removed.
   * @param name - The parameter name to remove.
   * @param value - If provided, only pairs also matching this value are removed.
   */
  delete(name: string, value?: string): void
  /**
   * Return the first value for `name`, or `null` if not present.
   * @param name - The parameter name to look up.
   */
  get(name: string): string | undefined
  /**
   * Return all values for `name` as an array.
   * @param name - The parameter name to look up.
   */
  getAll(name: string): string[]
  /**
   * Return `true` if a pair with `name` exists. If `value` is provided, the pair must also match
   * `value`.
   * @param name - The parameter name to check.
   * @param value - If provided, the pair must also match this value.
   */
  has(name: string, value?: string): boolean
  /**
   * Set the value for `name`, replacing any existing pairs with that name.
   * @param name - The parameter name.
   * @param value - The value to set.
   */
  set(name: string, value: string): void

  /** Returns the serialized string form. */
  toString(): string
  /** Returns the serialized string form. Suitable for JSON serialization. */
  toJSON(): string
}

declare class URLSearchParams {
  /**
   * Create a new `URLSearchParams` instance. `init` may be a query string, an iterable of `[name,
   * value]` pairs, or an object of key-value pairs.
   * @param init - A query string, an iterable of `[name, value]` pairs, or an object of key-value
   * pairs to initialize the params from.
   */
  constructor(init: string | Record<string, string> | Iterable<[string, string]>)
}

declare namespace URLSearchParams {
  /**
   * Return `true` if `value` is a `URLSearchParams` instance.
   * @param value - The value to test.
   */
  export function isURLSearchParams(value: unknown): value is URLSearchParams
}

export = URLSearchParams
