const path = require('bare-path')
const binding = require('./binding')
const errors = require('./lib/errors')
const URLSearchParams = require('./lib/url-search-params')

const kind = Symbol.for('bare.url.kind')

const isWindows = Bare.platform === 'win32'

// Scratch buffer that the binding writes the parsed component offsets into. A
// single shared buffer is reused across every parse.
//
// The offsets are copied out into fields on the URL immediately after a
// successful parse, so nothing observes the buffer across calls.
const components = new Uint32Array(8)

// The value used for a component that is not present in the URL.
const unset = 0xffffffff

// The schemes the parser treats specially. A URL cannot be switched between a
// special and a non-special scheme, and a backslash only terminates a host for
// the former.
const special = new Set(['ftp', 'file', 'http', 'https', 'ws', 'wss'])

// https://url.spec.whatwg.org/#scheme-start-state
const scheme = /^[a-z][a-z0-9+\-.]*$/

// ASCII tab and newline are removed from input before it is parsed rather than
// percent-encoded like the other C0 controls.
const whitespaceAll = /[\t\n\r]/g

// The characters that terminate a host, and so bound the value the host and
// hostname setters accept.
const hostEnd = /[/\\?#]/
const hostEndOpaque = /[/?#]/

// The delimiters that would let a setter's value escape the component it is
// spliced into. Everything else is left to the reparse, which applies the full
// percent-encode set for the component. As elsewhere in this package, each set
// needs two patterns because test() advances a global pattern's lastIndex.
//
// Credentials are not run through the parser and so keep their tabs and
// newlines, percent-encoded, rather than having them stripped.
const userinfoDelimiter = /[\t\n\r/\\?#@:]/
const userinfoDelimiterAll = /[\t\n\r/\\?#@:]/g

const pathDelimiter = /[?#]/
const pathDelimiterAll = /[?#]/g

// A leading or trailing run of C0 control or space in a value that ends up at
// either end of the href. The parser strips those, but only when parsing a URL
// as a whole, so a setter has to encode its own.
const edges = /^[\u0000-\u0020]+|[\u0000-\u0020]+$/g

const escapes = {
  '\t': '%09',
  '\n': '%0A',
  '\r': '%0D',
  '/': '%2F',
  '\\': '%5C',
  ':': '%3A',
  '?': '%3F',
  '@': '%40',
  '#': '%23'
}

// The characters that pathToFileURL() has to percent-encode itself. A backslash
// is a path separator on Windows and so is left alone there.
const reserved = isWindows ? /[%#?\n\r\t]/ : /[%#?\n\r\t\\]/

class URL {
  static get [kind]() {
    return 0 // Compatibility version
  }

  constructor(input, base, opts = {}) {
    if (arguments.length === 0) throw errors.INVALID_URL()

    input = String(input)

    if (base !== undefined) base = String(base)

    this._href = undefined
    this._schemeEnd = 0
    this._usernameEnd = 0
    this._hostStart = 0
    this._hostEnd = 0
    this._pathStart = 0
    this._queryStart = 0
    this._fragmentStart = 0
    this._params = null

    this._parse(input, base, opts.throw !== false)
  }

  get [kind]() {
    return URL[kind]
  }

  // https://url.spec.whatwg.org/#dom-url-href

  get href() {
    return this._href
  }

  set href(value) {
    // Unlike every other setter, the href setter reports a parse failure rather
    // than leaving the URL untouched.
    this._parse(String(value), null, true)

    if (this._params) this._params._parse(this.search)
  }

  // https://url.spec.whatwg.org/#dom-url-protocol

  get protocol() {
    return this._slice(0, this._schemeEnd) + ':'
  }

  set protocol(value) {
    value = strip(String(value))

    const end = value.indexOf(':')

    if (end !== -1) value = value.slice(0, end)

    value = value.toLowerCase()

    if (!scheme.test(value)) return

    const current = this._slice(0, this._schemeEnd)

    if (special.has(current) !== special.has(value)) return

    if (value === 'file' && (this.username || this.password || this.port)) {
      return
    }

    if (current === 'file' && this._hostStart === this._hostEnd) return

    this._update(this._replace(value, 0, this._schemeEnd))
  }

  // https://url.spec.whatwg.org/#dom-url-username

  get username() {
    return this._slice(this._schemeEnd + 3 /* :// */, this._usernameEnd)
  }

  set username(value) {
    if (cannotHaveCredentialsOrPort(this)) {
      return
    }

    value = encodeUserinfo(String(value))

    if (!hasCredentials(this)) value += '@'

    this._update(this._replace(value, this._schemeEnd + 3 /* :// */, this._usernameEnd))
  }

  // https://url.spec.whatwg.org/#dom-url-password

  get password() {
    return this._href.slice(this._usernameEnd + 1 /* : */, this._hostStart - 1 /* @ */)
  }

  set password(value) {
    if (cannotHaveCredentialsOrPort(this)) {
      return
    }

    value = ':' + encodeUserinfo(String(value))

    let end = this._hostStart - 1 /* @ */

    if (!hasCredentials(this)) {
      value += '@'
      end = this._usernameEnd
    }

    this._update(this._replace(value, this._usernameEnd, end))
  }

  // https://url.spec.whatwg.org/#dom-url-host

  get host() {
    return this._slice(this._hostStart, this._pathStart)
  }

  set host(value) {
    if (hasOpaquePath(this)) {
      return
    }

    const protocol = this._slice(0, this._schemeEnd)

    value = truncateHost(protocol, String(value))

    // An `@` would make the reparse read the value as credentials rather than
    // as a host, so it is rejected outright.
    if (value.includes('@')) return

    const separator = portSeparator(value)

    let end = this._hostEnd

    // A port in the value is parsed separately so that an invalid one leaves
    // the existing port in place rather than rejecting the host along with it.
    if (separator !== -1) {
      // A file URL cannot have a port, so a value carrying one is rejected
      // rather than split.
      if (protocol === 'file') return

      const port = parsePort(value.slice(separator + 1))

      value = value.slice(0, separator)

      if (port !== null) {
        value += port
        end = this._pathStart
      }
    }

    if (value === '' && cannotHaveEmptyHost(protocol)) return

    this._update(this._replace(value, this._hostStart, end))
  }

  // https://url.spec.whatwg.org/#dom-url-hostname

  get hostname() {
    return this._slice(this._hostStart, this._hostEnd)
  }

  set hostname(value) {
    if (hasOpaquePath(this)) {
      return
    }

    const protocol = this._slice(0, this._schemeEnd)

    value = truncateHost(protocol, String(value))

    // A port cannot be set through this setter, and a value that carries one is
    // rejected outright rather than truncated. An `@` would make the reparse
    // read the value as credentials rather than as a host.
    if (value.includes('@') || portSeparator(value) !== -1) return

    if (value === '' && cannotHaveEmptyHost(protocol)) return

    this._update(this._replace(value, this._hostStart, this._hostEnd))
  }

  // https://url.spec.whatwg.org/#dom-url-port

  get port() {
    return this._slice(this._hostEnd + 1 /* : */, this._pathStart)
  }

  set port(value) {
    if (cannotHaveCredentialsOrPort(this)) {
      return
    }

    value = strip(String(value))

    if (value !== '') {
      value = parsePort(value)

      if (value === null) return
    }

    this._update(this._replace(value, this._hostEnd, this._pathStart))
  }

  // https://url.spec.whatwg.org/#dom-url-pathname

  get pathname() {
    return this._slice(this._pathStart, this._queryStart - 1 /* ? */)
  }

  set pathname(value) {
    if (hasOpaquePath(this)) {
      return
    }

    value = encodePath(encodeEdges(String(value)))

    // An empty path is left alone, as only a special scheme is required to have
    // one and the reparse inserts it there.
    if (value !== '' && value[0] !== '/' && value[0] !== '\\') {
      value = '/' + value
    }

    this._update(this._replace(value, this._pathStart, this._queryStart - 1 /* ? */))
  }

  // https://url.spec.whatwg.org/#dom-url-search

  get search() {
    return this._slice(this._queryStart - 1 /* ? */, this._fragmentStart - 1 /* # */)
  }

  set search(value) {
    value = String(value)

    if (value !== '') {
      if (value[0] === '?') value = value.slice(1)

      value = '?' + encodeQuery(encodeEdges(value))
    }

    this._update(
      this._replace(value, this._queryStart - 1 /* ? */, this._fragmentStart - 1 /* # */)
    )
  }

  // https://url.spec.whatwg.org/#dom-url-searchparams

  get searchParams() {
    if (this._params === null) {
      this._params = new URLSearchParams(this.search, this)
    }

    return this._params
  }

  // https://url.spec.whatwg.org/#dom-url-hash

  get hash() {
    return this._slice(this._fragmentStart - 1 /* # */)
  }

  set hash(value) {
    value = String(value)

    // The fragment runs to the end of the URL, so nothing in it can escape into
    // another component and no delimiter needs encoding here.
    if (value !== '') {
      if (value[0] === '#') value = value.slice(1)

      value = '#' + encodeEdges(value)
    }

    this._update(this._replace(value, this._fragmentStart - 1 /* # */))
  }

  toString() {
    return this._href
  }

  toJSON() {
    return this._href
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: URL },

      href: this.href,
      protocol: this.protocol,
      username: this.username,
      password: this.password,
      host: this.host,
      hostname: this.hostname,
      port: this.port,
      pathname: this.pathname,
      search: this.search,
      searchParams: this.searchParams,
      hash: this.hash
    }
  }

  _slice(start, end = this._href.length) {
    return this._href.slice(start, end)
  }

  _replace(replacement, start, end = this._href.length) {
    return this._slice(0, start) + replacement + this._slice(end)
  }

  _parse(input, base, shouldThrow) {
    let href

    try {
      href = binding.parse(input, base || null, components, shouldThrow)
    } catch (err) {
      if (err instanceof TypeError || err.code !== undefined) throw err

      throw errors.INVALID_URL(`Invalid URL '${input}'`, input)
    }

    if (href === undefined) return

    this._href = href
    this._schemeEnd = components[0]
    this._usernameEnd = components[1]
    this._hostStart = components[2]
    this._hostEnd = components[3]
    this._pathStart = components[5]

    const queryStart = components[6]
    const fragmentStart = components[7]

    const end = href.length + 1

    this._queryStart = queryStart === unset ? end : queryStart
    this._fragmentStart = fragmentStart === unset ? end : fragmentStart
  }

  _update(input) {
    try {
      this._parse(input, null, true)
    } catch (err) {
      if (err instanceof TypeError) throw err

      return
    }

    if (this._params) this._params._parse(this.search)
  }
}

module.exports = exports = URL

// https://url.spec.whatwg.org/#url-opaque-path
function hasOpaquePath(url) {
  return url.pathname[0] !== '/'
}

// https://url.spec.whatwg.org/#cannot-have-a-username-password-port
function cannotHaveCredentialsOrPort(url) {
  return url.hostname === '' || url.protocol === 'file:'
}

// Whether the URL carries a userinfo section, and so an `@` before its host.
function hasCredentials(url) {
  return url._hostStart !== url._usernameEnd
}

// Almost no input contains any of these, so it is worth ruling all three out
// before rewriting anything.
function strip(value) {
  if (value.indexOf('\t') === -1 && value.indexOf('\n') === -1 && value.indexOf('\r') === -1) {
    return value
  }

  return value.replace(whitespaceAll, '')
}

// https://url.spec.whatwg.org/#host-state
//
// Host parsing stops at the first character that starts another component, so
// anything from there on is dropped rather than spliced into the host.
function truncateHost(protocol, value) {
  const end = value.search(special.has(protocol) ? hostEnd : hostEndOpaque)

  return end === -1 ? value : value.slice(0, end)
}

// Only a special scheme other than file has to have a host.
function cannotHaveEmptyHost(protocol) {
  return protocol !== 'file' && special.has(protocol)
}

// The index of the colon that separates a host from its port, disregarding the
// colons of an IPv6 address, or -1 if the host carries no port.
function portSeparator(host) {
  return host.indexOf(':', host[0] === '[' ? host.indexOf(']') : 0)
}

// https://url.spec.whatwg.org/#port-state
//
// Parsing stops at the first character that is not a digit, so a value with no
// leading digits, or one that overflows, leaves the port as it was.
function parsePort(value) {
  value = /^\d*/.exec(value)[0]

  if (value === '' || Number(value) > 65535) return null

  return ':' + value
}

function encodeUserinfo(value) {
  if (!userinfoDelimiter.test(value)) return value

  return value.replace(userinfoDelimiterAll, (match) => escapes[match])
}

function encodePath(value) {
  if (!pathDelimiter.test(value)) return value

  return value.replace(pathDelimiterAll, (match) => escapes[match])
}

function encodeQuery(value) {
  if (value.indexOf('#') === -1) return value

  return value.replaceAll('#', '%23')
}

// Percent-encodes a leading or trailing run of C0 control or space, which the
// parser would otherwise strip from a value that lands at either end of the
// href. Every component that can end a URL encodes them anyway, so this only
// brings the encoding forward.
function encodeEdges(value) {
  const len = value.length

  if (len === 0) return value
  if (value.charCodeAt(0) > 0x20 && value.charCodeAt(len - 1) > 0x20) return value

  return value.replace(edges, (match) => {
    let encoded = ''

    for (let i = 0, n = match.length; i < n; i++) {
      encoded += '%' + match.charCodeAt(i).toString(16).padStart(2, '0').toUpperCase()
    }

    return encoded
  })
}

exports.URL = URL
exports.URLSearchParams = URLSearchParams

exports.errors = errors

exports.isURL = function isURL(value) {
  if (value instanceof URL) return true

  return typeof value === 'object' && value !== null && value[kind] === URL[kind]
}

exports.isURLSearchParams = URLSearchParams.isURLSearchParams

// https://url.spec.whatwg.org/#dom-url-parse
exports.parse = function parse(input, base) {
  const url = new URL(input, base, { throw: false })
  return url._href ? url : null
}

// https://url.spec.whatwg.org/#dom-url-canparse
exports.canParse = function canParse(input, base) {
  return binding.canParse(String(input), base ? String(base) : null)
}

exports.fileURLToPath = function fileURLToPath(url) {
  if (typeof url === 'string') {
    url = new URL(url)
  }

  if (url.protocol !== 'file:') {
    throw errors.INVALID_URL_SCHEME('The URL must use the file: protocol')
  }

  if (!isWindows && url.hostname) {
    throw errors.INVALID_FILE_URL_HOST("The file: URL host must be 'localhost' or empty")
  }

  const encoded = url.pathname

  // Every check below looks for a percent encoded sequence, as does the decoding
  // that follows, so a path without any can skip all of them.
  const hasEncoded = encoded.includes('%')

  if (hasEncoded) {
    if (isWindows) {
      if (/%2f|%5c/i.test(encoded)) {
        throw errors.INVALID_FILE_URL_PATH(
          'The file: URL path must not include encoded \\ or / characters'
        )
      }
    } else if (/%2f/i.test(encoded)) {
      throw errors.INVALID_FILE_URL_PATH('The file: URL path must not include encoded / characters')
    }

    if (/%00/i.test(encoded)) {
      throw errors.INVALID_FILE_URL_PATH(
        'The file: URL path must not include encoded NUL characters'
      )
    }
  }

  const pathname = path.normalize(hasEncoded ? decodeURIComponent(encoded) : encoded)

  if (isWindows) {
    if (url.hostname) return '\\\\' + url.hostname + pathname

    const letter = pathname.charCodeAt(1) | 0x20

    if (letter < 0x61 /* a */ || letter > 0x7a /* z */ || pathname.charCodeAt(2) !== 0x3a /* : */) {
      throw errors.INVALID_FILE_URL_PATH('The file: URL path must be absolute')
    }

    return pathname.slice(1)
  }

  return pathname
}

exports.pathToFileURL = function pathToFileURL(pathname) {
  let resolved = path.resolve(pathname)

  if (pathname[pathname.length - 1] === '/') {
    resolved += '/'
  } else if (isWindows && pathname[pathname.length - 1] === '\\') {
    resolved += '\\'
  }

  // Paths hardly ever contain any of these, so one pass to rule them out is
  // cheaper than the six or seven replacements it stands in for.
  if (reserved.test(resolved)) {
    resolved = resolved
      .replaceAll('%', '%25') // Must be first
      .replaceAll('#', '%23')
      .replaceAll('?', '%3f')
      .replaceAll('\n', '%0a')
      .replaceAll('\r', '%0d')
      .replaceAll('\t', '%09')

    if (!isWindows) {
      resolved = resolved.replaceAll('\\', '%5c')
    }
  }

  return new URL('file:' + resolved)
}

exports.format = function format(parts) {
  const { protocol, auth, host, hostname, port, pathname, search, query, hash, slashes } = parts

  let result = ''

  if (typeof protocol === 'string') {
    result += protocol

    if (protocol[protocol.length - 1] !== ':') {
      result += ':'
    }

    if (slashes === true || /https?|ftp|gopher|file/.test(protocol)) {
      result += '//'
    }
  }

  if (typeof auth === 'string') {
    if (host || hostname) result += auth + '@'
  }

  if (typeof host === 'string') result += host
  else {
    result += hostname

    if (port) result += ':' + port
  }

  if (typeof pathname === 'string' && pathname !== '') {
    if (pathname[0] !== '/') result += '/'
    result += pathname
  }

  if (typeof search === 'string') {
    if (search[0] !== '?') result += '?'
    result += search
  } else if (typeof query === 'object' && query !== null) {
    result += '?' + new URLSearchParams(query)
  }

  if (typeof hash === 'string') {
    if (hash[0] !== '#') result += '#'
    result += hash
  }

  return result
}
