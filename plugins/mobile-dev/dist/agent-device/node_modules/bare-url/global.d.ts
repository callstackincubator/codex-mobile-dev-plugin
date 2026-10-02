import * as url from '.'

type URLConstructor = typeof url.URL
type URLSearchParamsConstructor = typeof url.URLSearchParams

declare global {
  /**
   * Parse `input` as a URL. If `base` is provided, `input` is resolved relative to `base`.
   * @param input - The URL string to parse.
   * @param base - A base URL that `input` is resolved relative to, if provided.
   * @throws {INVALID_URL} `input` is not a valid URL.
   */
  type URL = url.URL
  /**
   * Create a new `URLSearchParams` instance. `init` may be a query string, an iterable of `[name,
   * value]` pairs, or an object of key-value pairs.
   * @param init - A query string, an iterable of `[name, value]` pairs, or an object of key-value
   * pairs to initialize the params from.
   */
  type URLSearchParams = url.URLSearchParams

  const URL: URLConstructor
  const URLSearchParams: URLSearchParamsConstructor
}
