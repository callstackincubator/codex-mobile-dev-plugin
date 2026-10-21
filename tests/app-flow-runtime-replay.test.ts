/**
 * Runtime replay — the variant that reaches a screen by dispatching through the app's own
 * navigator instead of re-walking a recorded path.
 *
 * What is covered here is what can be decided without a device: the refusals (a stale map, a
 * route whose parameters were never observed, a runtime that cannot be reached or that declines
 * the route), the route derivation handed to the runtime, and the closed-set telemetry outcome
 * each path emits. The dispatch itself is the sweep's own `RenderPort`, exercised against a live
 * runtime by `app-flow-fast.test.ts`; the point of these tests is that a replay asks for exactly
 * what a sweep asks for and never invents a parameter value.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppFlowNode, AppFlowResult } from '../src/shared/app-flow.ts'
import { describeTransportFailure } from '../src/app-flow/cdp/app-runtime-transport.ts'
import { createRenderPortForTransport, type RenderTransport } from '../src/app-flow/reach/adapters.ts'
import { ActiveTimeBudget } from '../src/app-flow/exploration.ts'
import { runtimeReplay } from '../src/app-flow/runtime-replay.ts'
import type { CaptureContext, CaptureDevice } from '../src/app-flow/capture.ts'

const node = (over: Partial<AppFlowNode> = {}): AppFlowNode =>
  ({
    id: 'HomeTab/Profile',
    title: 'Profile',
    slug: 'profile',
    urlPath: '/profile',
    params: [],
    reach: 'navigation-only',
    groups: ['HomeTab'],
    ...over
  }) as unknown as AppFlowNode

const flowWith = (nodes: AppFlowNode[], mode = 'expo-router'): AppFlowResult =>
  ({
    manifest: { project: { mode } },
    nodes,
    edges: []
  }) as unknown as AppFlowResult

/** A device that would throw if anything actually touched it — nothing here should. */
const prepare = async (): Promise<{ ctx: CaptureContext; device: CaptureDevice }> => {
  throw new Error('the device must not be prepared for a refusal decided from the stored map')
}

test('runtime replay refuses a project with no map, before touching a device', async () => {
  const result = await runtimeReplay('p', 'HomeTab/Profile', {
    prepare,
    read: async () => ({ flow: null, paramStore: null })
  })
  assert.equal(result.ok, false)
  assert.match(result.ok === false ? result.error : '', /no App Flow map/i)
})

test('runtime replay refuses a node the map no longer has', async () => {
  const result = await runtimeReplay('p', 'Gone', {
    prepare,
    read: async () => ({ flow: flowWith([node()]), paramStore: null })
  })
  assert.equal(result.ok, false)
  assert.match(result.ok === false ? result.error : '', /not in this project/i)
})

test('runtime replay refuses a route whose params were never observed, naming them', async () => {
  const result = await runtimeReplay('p', 'User', {
    prepare,
    read: async () => ({
      flow: flowWith([node({ id: 'User', urlPath: '/user/[id]', params: ['id'] })]),
      paramStore: null
    })
  })
  assert.equal(result.ok, false)
  const error = result.ok === false ? result.error : ''
  // Named, so the user knows which value is missing — and no stand-in was dispatched, which is
  // the whole reason this path refuses rather than guessing.
  assert.match(error, /:id/)
  assert.match(error, /observed/i)
})

test('runtime replay dispatches a stored param value rather than refusing', async () => {
  const dispatched: Array<{ route: string[]; params: Record<string, string> | null }> = []
  const transport = fakeTransport({ ok: true, action: 'navigate', path: ['User'] }, dispatched)
  const port = createRenderPortForTransport({ transport, expoRouter: false })
  const target = node({ id: 'User', urlPath: '/user/[id]', params: ['id'], groups: [] })
  const outcome = await port.navigate(target, { id: 'alice.test' })
  assert.equal(outcome.ok, true)
  assert.deepEqual(dispatched[0]?.route, ['User'])
  assert.deepEqual(dispatched[0]?.params, { id: 'alice.test' })
})

test('the standalone render port derives the same nested route a sweep would', async () => {
  const dispatched: Array<{ route: string[]; expoPath: string | null; candidates: string[] | null }> = []
  const transport = fakeTransport({ ok: true, action: 'navigate', path: ['HomeTab', 'Profile'] }, dispatched)
  const port = createRenderPortForTransport({ transport, expoRouter: true })
  await port.navigate(node({ groups: ['HomeTab', 'RootStack'] }), null)
  // Node ids are the parser's spelling of the navigator path, so `HomeTab/Profile` dispatches as
  // two segments; Expo Router additionally gets the pathname, and the parsed ancestors ride along
  // as candidates for a tab the run has never mounted. Any drift here means a replay would ask
  // for a different route than the sweep that mapped the screen.
  assert.deepEqual(dispatched[0]?.route, ['HomeTab', 'Profile'])
  assert.equal(dispatched[0]?.expoPath, '/profile')
  assert.deepEqual(dispatched[0]?.candidates, ['RootStack'])
})

test('the standalone render port reports the runtime’s own refusal reason', async () => {
  const transport = fakeTransport({ ok: false, reason: 'unregistered', detail: 'searched 3 navigators' }, [])
  const port = createRenderPortForTransport({ transport })
  const outcome = await port.navigate(node(), null)
  assert.equal(outcome.ok, false)
  assert.equal(outcome.refusal, 'unregistered')
  assert.match(outcome.reason, /not registered/i)
  // The whole path, not just its leaf: naming only `Profile` sent readers looking for a screen
  // that may well be registered somewhere else in the tree.
  assert.match(outcome.reason, /HomeTab > Profile/)
})

test('a node with no route name is refused without a dispatch', async () => {
  const dispatched: Array<unknown> = []
  const transport = fakeTransport({ ok: true, action: 'navigate' }, dispatched as never)
  const port = createRenderPortForTransport({ transport })
  const outcome = await port.navigate(node({ id: '' }), null)
  assert.equal(outcome.ok, false)
  assert.equal(dispatched.length, 0)
})

test('a transport failure is scrubbed of paths and bounded before it is shown', () => {
  const described = describeTransportFailure(
    new Error('connect ECONNREFUSED at /Users/someone/code/my-app/node_modules/x')
  )
  assert.match(described, /<path>/)
  assert.doesNotMatch(described, /someone/)
  assert.ok(describeTransportFailure(new Error('x'.repeat(500))).length <= 200)
  assert.equal(describeTransportFailure(new Error('')), 'The runtime handshake failed without a message.')
})

test('the settle budget is the outer bound, never extended by the port', async () => {
  const transport = fakeTransport({ ok: true, action: 'navigate', path: ['HomeTab', 'Profile'] }, [])
  const port = createRenderPortForTransport({ transport })
  // An exhausted budget has to end the poll loop: a replay bounded at 15s must not be able to sit
  // in a port whose own escalating deadlines run to 8s per screen on a screen that never settles.
  const budget = new ActiveTimeBudget(50)
  const startedAt = Date.now()
  const result = await port.awaitSettled(node(), null, budget)
  assert.equal(result.settled, false)
  assert.ok(Date.now() - startedAt < 2_000, 'the settle must respect an exhausted budget')
})

function fakeTransport(
  reply: Record<string, unknown>,
  dispatched: Array<{ route: string[]; params?: Record<string, string> | null; expoPath?: string | null; candidates?: string[] | null }>
): RenderTransport {
  return {
    ready: async () => ({ ok: true }),
    navigate: async (route, params, expoPath, candidates) => {
      dispatched.push({ route, params, expoPath, candidates })
      return reply as never
    },
    readiness: async () =>
      ({
        found: false, loading: false, content: 0, paramMismatch: [], active: [],
        settled: false, quiet: false, painted: null, confident: false, missing: [],
        commitQuietMs: null, networkQuietMs: null, inflight: null
      }) as never,
    navState: async () => null,
    close: async () => undefined
  }
}
