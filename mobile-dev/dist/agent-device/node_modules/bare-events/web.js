// Event state
const BUBBLES = 0x1
const CANCELABLE = 0x2
const COMPOSED = 0x4
const CANCELED = 0x8
const DISPATCH = 0x10
const STOP = 0x20
const IN_PASSIVE = 0x40

// EventTarget state
const CAPTURE = 0x1
const PASSIVE = 0x2
const ONCE = 0x4
const REMOVED = 0x8

// https://webidl.spec.whatwg.org/#invalidstateerror
class InvalidStateError extends Error {
  get name() {
    return 'InvalidStateError'
  }
}

// https://dom.spec.whatwg.org/#event
class Event {
  // https://dom.spec.whatwg.org/#dom-event-event
  constructor(type, options = {}) {
    const { bubbles = false, cancelable = false, composed = false } = options

    this._type = type
    this._target = null
    this._currentTarget = null
    this._state = 0

    if (bubbles) this._state |= BUBBLES
    if (cancelable) this._state |= CANCELABLE
    if (composed) this._state |= COMPOSED
  }

  // https://dom.spec.whatwg.org/#dom-event-type
  get type() {
    return this._type
  }

  // https://dom.spec.whatwg.org/#dom-event-target
  get target() {
    return this._target
  }

  // https://dom.spec.whatwg.org/#dom-event-currenttarget
  get currentTarget() {
    return this._currentTarget
  }

  // https://dom.spec.whatwg.org/#dom-event-bubbles
  get bubbles() {
    return (this._state & BUBBLES) !== 0
  }

  // https://dom.spec.whatwg.org/#dom-event-cancelable
  get cancelable() {
    return (this._state & CANCELABLE) !== 0
  }

  // https://dom.spec.whatwg.org/#dom-event-composed
  get composed() {
    return (this._state & COMPOSED) !== 0
  }

  // https://dom.spec.whatwg.org/#dom-event-defaultprevented
  get defaultPrevented() {
    return (this._state & CANCELED) !== 0
  }

  // https://dom.spec.whatwg.org/#dom-event-istrusted
  get isTrusted() {
    return false
  }

  // https://dom.spec.whatwg.org/#dom-event-preventdefault
  preventDefault() {
    if (this._state & IN_PASSIVE) return
    if (this._state & CANCELABLE) this._state |= CANCELED
  }

  // https://dom.spec.whatwg.org/#dom-event-stoppropagation
  stopPropagation() {}

  // https://dom.spec.whatwg.org/#dom-event-stopimmediatepropagation
  stopImmediatePropagation() {
    this._state |= STOP
  }

  toJSON() {
    return {
      type: this.type,
      target: this.target,
      bubbles: this.bubbles,
      cancelable: this.cancelable,
      composed: this.composed,
      defaultPrevented: this.defaultPrevented,
      isTrusted: this.isTrusted
    }
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: Event },

      type: this.type,
      target: this.target,
      bubbles: this.bubbles,
      cancelable: this.cancelable,
      composed: this.composed,
      defaultPrevented: this.defaultPrevented,
      isTrusted: this.isTrusted
    }
  }
}

exports.Event = Event

// https://dom.spec.whatwg.org/#customevent
exports.CustomEvent = class CustomEvent extends Event {
  constructor(type, options = {}) {
    super(type, options)

    const { detail = null } = options

    this._detail = detail
  }

  // https://dom.spec.whatwg.org/#dom-customevent-detail
  get detail() {
    return this._detail
  }

  toJSON() {
    return {
      type: this.type,
      target: this.target,
      bubbles: this.bubbles,
      cancelable: this.cancelable,
      composed: this.composed,
      defaultPrevented: this.defaultPrevented,
      isTrusted: this.isTrusted,
      detail: this.detail
    }
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: CustomEvent },

      type: this.type,
      target: this.target,
      bubbles: this.bubbles,
      cancelable: this.cancelable,
      composed: this.composed,
      defaultPrevented: this.defaultPrevented,
      isTrusted: this.isTrusted,
      detail: this.detail
    }
  }
}

// https://dom.spec.whatwg.org/#eventtarget
exports.EventTarget = class EventTarget {
  // https://dom.spec.whatwg.org/#dom-eventtarget-eventtarget
  constructor() {
    this._listeners = new Map()
  }

  // https://dom.spec.whatwg.org/#dom-eventtarget-addeventlistener
  addEventListener(type, callback = null, options = {}) {
    if (typeof options === 'boolean') options = { capture: options }

    const { capture = false, passive = false, once = false, signal = null } = options

    if (signal !== null && signal.aborted) return
    if (callback === null) return

    const listener = new EventListener(type, callback, capture, passive, once, signal)

    const listeners = this._listeners.get(type)

    if (listeners !== undefined) {
      for (const existing of listeners) {
        if (callback === existing.callback && capture === existing.capture) {
          return // Duplicate listener
        }
      }

      listener.link(listeners)
    } else {
      this._listeners.set(type, listener)
    }

    if (signal !== null) {
      const self = this

      listener._abort = onabort

      signal.addEventListener('abort', onabort)

      function onabort() {
        self._unlink(type, listener)
      }
    }
  }

  // https://dom.spec.whatwg.org/#dom-eventtarget-removeeventlistener
  removeEventListener(type, callback = null, options = {}) {
    if (typeof options === 'boolean') options = { capture: options }

    const { capture = false } = options

    const listeners = this._listeners.get(type)

    if (listeners === undefined) return

    for (const existing of listeners) {
      if (callback === existing.callback && capture === existing.capture) {
        this._unlink(type, existing)
        return
      }
    }
  }

  // https://dom.spec.whatwg.org/#dom-eventtarget-dispatchevent
  dispatchEvent(event) {
    if (event._state & DISPATCH) {
      throw new InvalidStateError('Event is already being dispatched')
    }

    event._target = this
    event._currentTarget = this
    event._state |= DISPATCH

    const listeners = this._listeners.get(event.type)

    try {
      if (listeners === undefined) return true

      const snapshot = Array.from(listeners)

      for (const listener of snapshot) {
        // https://dom.spec.whatwg.org/#concept-event-listener-inner-invoke

        if (listener.removed) continue

        if (listener.once) this._unlink(event.type, listener)

        let callback = listener.callback
        let context = this

        if (typeof callback === 'object') {
          context = callback
          callback = callback.handleEvent
        }

        if (listener.passive) event._state |= IN_PASSIVE

        try {
          Reflect.apply(callback, context, [event])
        } catch (err) {
          // https://html.spec.whatwg.org/#report-the-exception
          queueMicrotask(() => {
            throw err
          })
        }

        event._state &= ~IN_PASSIVE

        if (event._state & STOP) break
      }

      return (event._state & CANCELED) === 0
    } finally {
      event._currentTarget = null
      event._state &= ~DISPATCH
      event._state &= ~STOP
    }
  }

  toJSON() {
    return {}
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: EventTarget }
    }
  }

  _unlink(type, listener) {
    if (listener.removed) return

    if (listener._abort !== null) {
      listener._signal.removeEventListener('abort', listener._abort)
      listener._abort = null
    }

    const head = this._listeners.get(type)
    const next = listener.unlink()

    if (head === listener) {
      if (next === listener) this._listeners.delete(type)
      else this._listeners.set(type, next)
    }
  }
}

// https://dom.spec.whatwg.org/#concept-event-listener
class EventListener {
  constructor(type, callback, capture, passive, once, signal) {
    this._type = type
    this._callback = callback
    this._signal = signal
    this._abort = null
    this._state = 0

    if (capture) this._state |= CAPTURE
    if (passive) this._state |= PASSIVE
    if (once) this._state |= ONCE

    this._previous = this
    this._next = this
  }

  get type() {
    return this._type
  }

  get callback() {
    return this._callback
  }

  get capture() {
    return (this._state & CAPTURE) !== 0
  }

  get passive() {
    return (this._state & PASSIVE) !== 0
  }

  get once() {
    return (this._state & ONCE) !== 0
  }

  get removed() {
    return (this._state & REMOVED) !== 0
  }

  link(listener) {
    const next = this._next
    const previous = listener._previous

    this._next = listener
    listener._previous = this

    previous._next = next
    next._previous = previous

    return listener
  }

  unlink() {
    if (this.removed) return this

    this._state |= REMOVED

    const next = this._next
    const previous = this._previous

    this._next = this
    this._previous = this

    previous._next = next
    next._previous = previous

    return next
  }

  *[Symbol.iterator]() {
    let current = this

    while (true) {
      const next = current._next
      yield current
      if (next === this) break
      current = next
    }
  }

  toJSON() {
    return {
      type: this.type,
      capture: this.capture,
      passive: this.passive,
      once: this.once,
      removed: this.removed
    }
  }

  [Symbol.for('bare.inspect')]() {
    return {
      __proto__: { constructor: EventListener },

      type: this.type,
      callback: this.callback,
      capture: this.capture,
      passive: this.passive,
      once: this.once,
      removed: this.removed
    }
  }
}
