module.exports = class EventEmitterError extends Error {
  constructor(msg, fn = EventEmitterError, opts = {}) {
    const { code = fn.name } = opts

    super(`${code}: ${msg}`, opts)

    this.code = code

    if (Error.captureStackTrace) Error.captureStackTrace(this, fn)
  }

  get name() {
    return 'EventEmitterError'
  }

  static OPERATION_ABORTED(cause, msg = 'Operation aborted') {
    return new EventEmitterError(msg, EventEmitterError.OPERATION_ABORTED, { cause })
  }

  static UNHANDLED_ERROR(cause, msg = 'Unhandled error') {
    return new EventEmitterError(msg, EventEmitterError.UNHANDLED_ERROR, { cause })
  }
}
