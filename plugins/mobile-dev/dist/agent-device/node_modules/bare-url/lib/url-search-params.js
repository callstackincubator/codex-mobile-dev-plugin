const kind = Symbol.for('bare.url.search-params.kind')

// The URL each instance writes back to, if any. Kept module private so that the
// setter it drives cannot be pointed at an arbitrary object.
const urls = new WeakMap()

class URLSearchParams {
  static get [kind]() {
    return 0 // Compatibility version
  }

  // https://url.spec.whatwg.org/#dom-urlsearchparams-urlsearchparams
  constructor(init, url = null) {
    this._params = null

    if (url) urls.set(this, url)

    if (typeof init === 'string') {
      this._parse(init)
    } else {
      this._params = new Map()

      if (init) {
        for (const [name, value] of typeof init[Symbol.iterator] === 'function'
          ? init
          : Object.entries(init)) {
          this.append(name, value)
        }
      }
    }
  }

  get [kind]() {
    return URLSearchParams[kind]
  }

  // https://url.spec.whatwg.org/#dom-urlsearchparams-size
  get size() {
    let size = 0

    for (const values of this._params.values()) size += values.length

    return size
  }

  // https://url.spec.whatwg.org/#dom-urlsearchparams-append
  append(name, value = null) {
    if (value === null) return

    let list = this._params.get(name)

    if (list === undefined) {
      list = []
      this._params.set(name, list)
    }

    list.push(value)

    this._update()
  }

  // https://url.spec.whatwg.org/#dom-urlsearchparams-delete
  delete(name, value = null) {
    if (value === null) this._params.delete(name)
    else {
      let list = this._params.get(name)

      if (list === undefined) return

      list = list.filter((found) => found !== value)

      if (list.length === 0) this._params.delete(name)
      else this._params.set(name, list)
    }

    this._update()
  }

  // https://url.spec.whatwg.org/#dom-urlsearchparams-get
  get(name) {
    const list = this._params.get(name)

    if (list === undefined) return null

    return list[0]
  }

  // https://url.spec.whatwg.org/#dom-urlsearchparams-getall
  getAll(name) {
    const list = this._params.get(name)

    if (list === undefined) return []

    return Array.from(list)
  }

  // https://url.spec.whatwg.org/#dom-urlsearchparams-has
  has(name, value = null) {
    const list = this._params.get(name)

    if (list === undefined) return false

    if (value === null) return true

    return list.includes(value)
  }

  // https://url.spec.whatwg.org/#dom-urlsearchparams-set
  set(name, value = null) {
    if (value === null) this._params.delete(name)
    else this._params.set(name, [value])

    this._update()
  }

  toString() {
    return this._serialize()
  }

  toJSON() {
    return [...this]
  }

  *[Symbol.iterator]() {
    for (const [name, values] of this._params) {
      for (const value of values) yield [name, value]
    }
  }

  [Symbol.for('bare.inspect')]() {
    const object = {
      __proto__: { constructor: URLSearchParams }
    }

    for (const [name, values] of this._params) {
      if (values.length === 1) object[name] = values[0]
      else object[name] = values
    }

    return object
  }

  // https://url.spec.whatwg.org/#concept-urlsearchparams-update
  _update() {
    const url = urls.get(this)

    if (url === undefined) return

    url.search = this._serialize()
  }

  // https://url.spec.whatwg.org/#concept-urlencoded-parser
  _parse(input) {
    const params = new Map()

    this._params = params

    const len = input.length

    let start = input.charCodeAt(0) === 0x3f /* ? */ ? 1 : 0

    while (start < len) {
      let end = input.indexOf('&', start)
      if (end === -1) end = len

      if (end !== start) {
        let split = input.indexOf('=', start)
        if (split === -1 || split > end) split = end

        const name = decode(input.slice(start, split))
        const value = split === end ? '' : decode(input.slice(split + 1, end))

        const list = params.get(name)

        if (list === undefined) params.set(name, [value])
        else list.push(value)
      }

      start = end + 1
    }
  }

  // https://url.spec.whatwg.org/#concept-urlencoded-serializer
  _serialize() {
    let result = ''
    let separator = ''

    for (const [name, values] of this._params) {
      // The name is shared by all of its values, so it is only encoded once.
      const encoded = encode(String(name))

      for (const value of values) {
        result += separator + encoded + '=' + encode(String(value))
        separator = '&'
      }
    }

    return result
  }
}

module.exports = exports = URLSearchParams

exports.isURLSearchParams = function isURLSearchParams(value) {
  if (value instanceof URLSearchParams) return true

  return typeof value === 'object' && value !== null && value[kind] === URLSearchParams[kind]
}

// https://url.spec.whatwg.org/#concept-urlencoded-byte-serializer
//
// Everything except ASCII alphanumerics and `*-._` is percent-encoded, and a
// space becomes `+` rather than `%20`. Names and values usually consist entirely
// of characters that are left alone, so a component is tested as a whole before
// any of it is rewritten.
const unencoded = /^[\w*.-]*$/

// As above, but allowing spaces, which need nothing more than turning into `+`.
// Spaces are by far the most common reason for a component to need rewriting at
// all, so recognizing them here spares those components a trip through
// encodeURIComponent().
const spaced = /^[\w*. -]*$/

// The characters that encodeURIComponent() leaves alone but the urlencoded byte
// serializer does not. Two patterns are needed because a global regular
// expression cannot be shared between test() and replace(), as test() advances
// its lastIndex.
const extra = /[!'()~]/
const extraAll = /[!'()~]/g

const escapes = {
  '!': '%21',
  "'": '%27',
  '(': '%28',
  ')': '%29',
  '~': '%7E'
}

// A surrogate pair, or a surrogate that is not part of one and so encodes no
// scalar value. Pairs are matched first so that only the capture group can hold
// a lone surrogate; a lookbehind would say this more directly but isn't
// supported by every engine.
const lone = /[\ud800-\udbff][\udc00-\udfff]|([\ud800-\udbff]|[\udc00-\udfff])/g

function encode(component) {
  if (unencoded.test(component)) return component

  if (spaced.test(component)) return component.replaceAll(' ', '+')

  let encoded

  try {
    encoded = encodeURIComponent(component)
  } catch {
    // encodeURIComponent() rejects lone surrogates, whereas the UTF-8 encoder the
    // serializer is defined in terms of replaces them with U+FFFD.
    encoded = encodeURIComponent(
      component.replace(lone, (match, single) => (single === undefined ? match : '\ufffd'))
    )
  }

  if (encoded.includes('%20')) encoded = encoded.replaceAll('%20', '+')

  if (extra.test(encoded)) encoded = encoded.replace(extraAll, (match) => escapes[match])

  return encoded
}

// https://url.spec.whatwg.org/#percent-decode-after-encoding
function decode(component) {
  if (component.indexOf('+') !== -1) component = component.replaceAll('+', ' ')

  if (component.indexOf('%') === -1) return component

  return decodeURIComponent(component)
}
