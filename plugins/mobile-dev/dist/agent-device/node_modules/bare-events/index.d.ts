import { AbortSignal } from 'bare-abort-controller'

interface EventMap {
  [event: string | symbol]: unknown[]
}

interface EventHandler<in A extends unknown[] = unknown[], out R = unknown> {
  (...args: A): R
}

declare class EventEmitterError extends Error {
  static OPERATION_ABORTED(cause: Error, msg?: string): EventEmitterError
  static UNHANDLED_ERROR(cause: Error, msg?: string): EventEmitterError
}

interface EventEmitter<in out M extends Record<keyof M, unknown[]> = EventMap> {
  addListener<E extends keyof M>(name: E, fn: EventHandler<M[E]>): this

  addOnceListener<E extends keyof M>(name: E, fn: EventHandler<M[E]>): this

  prependListener<E extends keyof M>(name: E, fn: EventHandler<M[E]>): this

  prependOnceListener<E extends keyof M>(name: E, fn: EventHandler<M[E]>): this

  removeListener<E extends keyof M>(name: E, fn: EventHandler<M[E]>): this

  removeAllListeners<E extends keyof M>(name?: E): this

  on<E extends keyof M>(name: E, fn: EventHandler<M[E]>): this

  once<E extends keyof M>(name: E, fn: EventHandler<M[E]>): this

  off<E extends keyof M>(name: E, fn: EventHandler<M[E]>): this

  emit<E extends keyof M>(name: E, ...args: M[E]): boolean

  listeners<E extends keyof M>(name: E): EventHandler<M[E]>[]

  rawListeners<E extends keyof M>(name: E): EventHandler<M[E]>[]

  eventNames(): (keyof M)[]

  listenerCount<E extends keyof M>(name: E): number

  getMaxListeners(): number
  setMaxListeners(n: number): this
}

declare class EventEmitter<in out M extends Record<keyof M, unknown[]> = EventMap> {}

declare namespace EventEmitter {
  export function on<M extends Record<keyof M, unknown[]>, E extends keyof M>(
    emitter: EventEmitter<M>,
    name: E,
    opts?: { signal?: AbortSignal }
  ): AsyncIterableIterator<M[E]>

  export function once<M extends Record<keyof M, unknown[]>, E extends keyof M>(
    emitter: EventEmitter<M>,
    name: E,
    opts?: { signal?: AbortSignal }
  ): Promise<M[E]>

  export function forward<
    F extends Record<keyof F, unknown[]>,
    E extends keyof F,
    T extends Record<keyof T, unknown[]> & Pick<F, E>
  >(
    from: EventEmitter<F>,
    to: EventEmitter<T>,
    names: E | E[],
    opts?: { emit?: (name: E, ...args: T[E]) => void }
  ): void

  export function listenerCount<M extends Record<keyof M, unknown[]>, E extends keyof M>(
    emitter: EventEmitter<M>,
    name: E
  ): number

  export function getMaxListeners(emitter: EventEmitter<any>): number

  export function setMaxListeners(n: number, ...emitters: EventEmitter<any>[]): void

  export let defaultMaxListeners: number

  export { EventEmitter, EventEmitterError as errors, EventMap, EventHandler }
}

export = EventEmitter
