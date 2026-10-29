import URLError from './lib/errors'
import URLSearchParams from './lib/url-search-params'

interface URL {
  /** The full serialized URL string. Setting this property reparses the URL. */
  href: string
  /** The URL scheme followed by `':'`, for example `'https:'`. */
  protocol: string
  /** The username portion of the URL, or an empty string. */
  username: string
  /** The password portion of the URL, or an empty string. */
  password: string
  /** The hostname and port, for example `'example.com:8080'`. */
  host: string
  /** The hostname without the port. */
  hostname: string
  /** The port as a string, or an empty string if not present. */
  port: string
  /** The path portion of the URL. */
  pathname: string
  /** The query string including the leading `'?'`, or an empty string. */
  search: string
  /**
   * A `URLSearchParams` object for the query string. Mutations to the params are reflected in the
   * URL.
   */
  searchParams: URLSearchParams
  /** The fragment including the leading `'#'`, or an empty string. */
  hash: string

  /** Returns the serialized string form. */
  toString(): string
  /** Returns the serialized string form. Suitable for JSON serialization. */
  toJSON(): string
}

declare class URL {
  /**
   * Parse `input` as a URL. If `base` is provided, `input` is resolved relative to `base`.
   * @param input - The URL string to parse.
   * @param base - A base URL that `input` is resolved relative to, if provided.
   * @throws {INVALID_URL} `input` is not a valid URL.
   */
  constructor(input: string | URL, base?: string | URL)
}

declare namespace URL {
  /**
   * Return `true` if `value` is a `URL` instance.
   * @param value - The value to test.
   */
  export function isURL(value: unknown): value is URL

  /**
   * Return `true` if `value` is a `URLSearchParams` instance.
   * @param value - The value to test.
   */
  export function isURLSearchParams(value: unknown): value is URLSearchParams

  /**
   * Parse `input` as a URL without throwing.
   * @param input - The URL string to parse.
   * @param base - A base URL that `input` is resolved relative to, if provided.
   * @returns A `URL` instance if `input` parses successfully, or `null` on failure.
   */
  export function parse(input: string, base?: string | URL): URL | null

  /**
   * Return `true` if `input` can be parsed as a valid URL, optionally relative to `base`.
   * @param input - The URL string to test.
   * @param base - A base URL that `input` is resolved relative to, if provided.
   */
  export function canParse(input: string, base?: string | URL): boolean

  /**
   * Convert a `file:` URL to a platform-specific file path. `url` may be a `URL` instance or a
   * string.
   * @param url - The `file:` URL to convert, as a `URL` instance or a string.
   * @throws {INVALID_URL_SCHEME} the URL does not use the `file:` protocol.
   * @throws {INVALID_FILE_URL_HOST} (non-Windows) the URL has a host other than empty or
   * `'localhost'`.
   * @throws {INVALID_FILE_URL_PATH} the URL path contains an encoded path-separator or NUL
   * character, or, on Windows, is not an absolute drive path.
   */
  export function fileURLToPath(url: URL | string): string

  /**
   * Convert a platform-specific file path to a `file:` URL.
   * @param pathname - The platform-specific file path to convert.
   */
  export function pathToFileURL(pathname: string): URL

  export { URL, type URLError, URLError as errors, URLSearchParams }
}

export = URL
