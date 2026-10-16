import assert from 'node:assert/strict'
import test from 'node:test'
import { strategiesFor, type ReachStrategy } from '../src/app-flow/reach/ladder.ts'
import { agentSource } from '../src/app-flow/cdp/runtime-source.ts'
import { agentNavigate, DEFAULT_AGENT_LIMITS } from '../src/app-flow/cdp/agent-runtime.ts'
import { parseAppFlowStartRequest, resolveAppFlowStart } from '../src/app-flow/start-request.ts'
import { reconcileSweepProgress } from '../src/app-flow/reach/checkpoint.ts'
import { ActiveTimeBudget } from '../src/app-flow/exploration.ts'
import { renderStrategy } from '../src/app-flow/reach/strategies/render.ts'
import type { ReachPorts } from '../src/app-flow/reach/ports.ts'
import type { AppFlowCapture, AppFlowNode } from '../src/shared/app-flow.ts'

const rung = (name: string): ReachStrategy<null> => {
  const strategy = async () => ({
    strategy: name,
    ok: false,
    reason: name,
    touchedDevice: false,
    elapsedMs: 0,
    effects: []
  })
  Object.defineProperty(strategy, 'name', { value: name })
  return strategy
}

test('exploration modes select the exact approved pipelines', () => {
  const rungs = {
    probeCredit: rung('probe'),
    savedReplay: rung('saved'),
    deepLink: rung('deep-link'),
    render: rung('fast'),
    explore: rung('explore')
  }
  const names = (mode: 'auto' | 'fast' | 'thorough') =>
    strategiesFor(mode, rungs).map((strategy) => strategy.name)
  assert.deepEqual(names('fast'), ['fast'])
  assert.deepEqual(names('auto'), ['probe', 'saved', 'deep-link', 'fast'])
  assert.deepEqual(names('thorough'), ['probe', 'saved', 'deep-link', 'explore'])
})

test('the packaged Fast agent contains structured navigation and keeps its integrity guard', () => {
  const source = agentSource()
  assert.match(source, /function agentNavigate/)
  assert.match(source, /type === 'navigate'/)
})

test('Fast dispatches a nested route through the mounted navigator', () => {
  const state = {
    routeNames: ['HomeTab'],
    routes: [{ name: 'HomeTab', state: { routeNames: ['Profile'], routes: [] } }]
  }
  let action: unknown
  const nav = { getRootState: () => state, dispatch: (value: unknown) => { action = value } }
  const previous = (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown })
    .__REACT_DEVTOOLS_GLOBAL_HOOK__
  ;(globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map([[1, { rendererPackageName: 'react-native-renderer' }]]),
    getFiberRoots: () => new Set([{ current: { stateNode: nav } }])
  }
  try {
    assert.deepEqual(agentNavigate(['HomeTab', 'Profile'], { id: '42' }, DEFAULT_AGENT_LIMITS, null), {
      ok: true,
      action: 'navigate'
    })
    assert.deepEqual(action, {
      type: 'NAVIGATE',
      payload: {
        name: 'HomeTab',
        params: { screen: 'Profile', params: { id: '42' }, initial: false }
      }
    })
  } finally {
    ;(globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = previous
  }
})

test('Fast replaces the focused stack leaf instead of accumulating screens', () => {
  const leaf = {
    key: 'stack-1',
    type: 'stack',
    routeNames: ['Home', 'Profile'],
    index: 0,
    routes: [{ name: 'Home', params: {} }]
  }
  const state = {
    routeNames: ['HomeTab'],
    index: 0,
    routes: [{ name: 'HomeTab', state: leaf }]
  }
  let action: unknown
  const nav = { getRootState: () => state, dispatch: (value: unknown) => { action = value } }
  const previous = (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown })
    .__REACT_DEVTOOLS_GLOBAL_HOOK__
  ;(globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map([[1, { rendererPackageName: 'react-native-renderer' }]]),
    getFiberRoots: () => new Set([{ current: { stateNode: nav } }])
  }
  try {
    assert.deepEqual(agentNavigate(['HomeTab', 'Profile'], null, DEFAULT_AGENT_LIMITS, null), {
      ok: true,
      action: 'replace'
    })
    assert.deepEqual(action, {
      type: 'REPLACE',
      target: 'stack-1',
      payload: { name: 'Profile', params: undefined }
    })
  } finally {
    ;(globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = previous
  }
})

test('Fast uses Expo Router replace for file-based routes', () => {
  let replaced: unknown
  const previous = (globalThis as { __r?: unknown }).__r
  ;(globalThis as { __r?: unknown }).__r = {
    getModules: () => new Map([[1, {
      isInitialized: true,
      publicModule: { exports: { router: {
        push() {},
        replace(value: unknown) { replaced = value },
        canGoBack() { return false }
      } } }
    }]])
  }
  try {
    assert.deepEqual(agentNavigate(['(tabs)', 'settings'], { id: '42' }, DEFAULT_AGENT_LIMITS, '/settings'), {
      ok: true,
      action: 'expo-replace'
    })
    assert.deepEqual(replaced, { pathname: '/settings', params: { id: '42' } })
  } finally {
    ;(globalThis as { __r?: unknown }).__r = previous
  }
})

const capture = (captureMethod: AppFlowCapture['captureMethod'], status: AppFlowCapture['status']): AppFlowCapture => ({
  captureMethod,
  status,
  needsNavigation: false,
  note: null,
  screenshot: status === 'missing' ? null : 'screens/example.png',
  pressables: [],
  states: []
})

test('checkpoint pipeline changes retain successes and re-queue unfinished screens', () => {
  const current = {
    structureKey: 'structure',
    explorationMode: 'fast' as const,
    sourceHash: 'source-2',
    fastFingerprint: 'runtime-2'
  }
  const result = reconcileSweepProgress({
    structureKey: 'structure',
    explorationMode: 'auto',
    sourceHash: 'source-1',
    fastFingerprint: 'runtime-1',
    updatedAt: 'before',
    captures: {
      kept: capture('rendered', 'ok'),
      missing: capture('unreached', 'missing')
    },
    opened: { kept: { app: 'demo', url: 'demo://kept' }, missing: { app: 'demo', url: 'demo://missing' } },
    inferred: { kept: { key: 'kept' }, missing: { key: 'missing' } },
    statesDone: ['kept', 'missing']
  }, current)
  assert.equal(result.resuming, false)
  assert.equal(result.retained, 1)
  assert.deepEqual(Object.keys(result.checkpoint.captures), ['kept'])
  assert.deepEqual(result.checkpoint.statesDone, ['kept'])
  assert.deepEqual(result.checkpoint.opened, { kept: { app: 'demo', url: 'demo://kept' } })
})

test('App Flow start no longer exposes a render transport switch', () => {
  const parsed = parseAppFlowStartRequest({
    projectPath: '/project',
    mode: 'screen-ui-and-structure',
    explorationMode: 'fast',
    renderTransportMode: 'cli'
  })
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal('renderTransportMode' in parsed.input, false)
  assert.deepEqual(resolveAppFlowStart(parsed.input), {
    projectPath: '/project',
    mode: 'screen-ui-and-structure',
    screenLimit: undefined,
    explorationMode: 'fast',
    deepLinkJudgeMode: 'on'
  })
})

test('Fast remembers a guarded render 404 and skips siblings behind the same gate', async () => {
  const condition = '!features.enabled(Inbox)'
  const node = {
    id: 'Inbox', title: 'Inbox', slug: 'inbox', urlPath: '/inbox', params: [],
    guard: { condition, fallback: 'NotFoundScreen' }
  } as unknown as AppFlowNode
  let availableCalls = 0
  let navigateCalls = 0
  const ports = {
    render: {
      async available() { availableCalls += 1; return true },
      async navigate() { navigateCalls += 1; return { ok: true, reason: 'dispatched' } },
      async awaitSettled() { return { settled: true, reason: 'settled' } }
    },
    device: {
      async captureScreenshot() { return { relaunched: false } },
      async capturePressables() { return [] }
    },
    judge: {
      async verifyArrival() { return { verdict: 'mismatch', status: 'not-found', reason: 'Page not found' } }
    }
  } as unknown as ReachPorts
  const budget = new ActiveTimeBudget(10_000)
  const first = await renderStrategy({ node, params: null, unresolvedParams: [], budget,
    scratchPath: key => `/tmp/${key}`, guardGateClosed: () => false }, ports)
  assert.equal(first.failure, 'unavailable')
  assert.deepEqual(first.effects, [{ kind: 'guard-gate-closed', condition }])

  const sibling = await renderStrategy({ node: { ...node, id: 'InboxSettings' }, params: null,
    unresolvedParams: [], budget, scratchPath: key => `/tmp/${key}`,
    guardGateClosed: candidate => candidate === condition }, ports)
  assert.equal(sibling.failure, 'unavailable')
  assert.equal(sibling.touchedDevice, false)
  assert.equal(availableCalls, 1)
  assert.equal(navigateCalls, 1)
})
