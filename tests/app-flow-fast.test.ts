import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { runReachLadder, strategiesFor, touchedDevice, type ReachRungs, type ReachStrategy } from '../src/app-flow/reach/ladder.ts'
import { isToolingFailure } from '../src/app-flow/exploration.ts'
import { agentSource } from '../src/app-flow/cdp/runtime-source.ts'
import {
  agentCollectLinks,
  agentControlCloser,
  agentCopiesLiveNavigation,
  agentCreatePresentations,
  agentLinkCandidate,
  agentModalCarryOver,
  agentNavigate,
  agentOpeningControl,
  agentPresentationCollect,
  agentPresentationIndex,
  agentPresentationList,
  agentPresentationContent,
  agentPresentationOpen,
  agentPresentationRollback,
  agentProjectionRoot,
  agentSetPath,
  AGENT_FUNCTIONS,
  DEFAULT_AGENT_LIMITS,
  LINK_CANDIDATE_CAP
} from '../src/app-flow/cdp/agent-runtime.ts'
import { EXPECTED_AGENT_FUNCTION_COUNT } from '../src/app-flow/cdp/runtime-source.ts'
import { ingestLinkCandidates, type LinkHarvestNode } from '../src/app-flow/link-harvest.ts'
import { ParamStore } from '../src/app-flow/param-store.ts'
import {
  parseAppFlowStartRequest,
  requiresDecisionProvider,
  resolveAppFlowStart
} from '../src/app-flow/start-request.ts'
import { reconcileSweepProgress } from '../src/app-flow/reach/checkpoint.ts'
import { ActiveTimeBudget } from '../src/app-flow/exploration.ts'
import { renderStrategy } from '../src/app-flow/reach/strategies/render.ts'
import { createReachPorts } from '../src/app-flow/reach/adapters.ts'
import type { ReachPorts } from '../src/app-flow/reach/ports.ts'
import { createCoalescedWriter } from '../src/app-flow/coalesced-write.ts'
import {
  ensureAdoptedMetro,
  MetroUnavailableError,
  type CaptureContext,
  type CaptureDevice
} from '../src/app-flow/capture.ts'
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
  // esbuild's transform normalises string quotes, so match either form.
  assert.match(source, /type === ["']navigate["']/)
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
    assert.deepEqual(
      agentNavigate(['HomeTab', 'Profile'], { id: '42' }, DEFAULT_AGENT_LIMITS, null, null),
      { ok: true, action: 'navigate', path: ['HomeTab', 'Profile'], via: 'exact' }
    )
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
    assert.deepEqual(agentNavigate(['HomeTab', 'Profile'], null, DEFAULT_AGENT_LIMITS, null, null), {
      ok: true,
      action: 'replace',
      path: ['HomeTab', 'Profile'],
      via: 'exact'
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

const withNavigator = <T>(state: unknown, run: (dispatched: () => unknown) => T): T => {
  let action: unknown
  const nav = { getRootState: () => state, dispatch: (value: unknown) => { action = value } }
  const previous = (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown })
    .__REACT_DEVTOOLS_GLOBAL_HOOK__
  ;(globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map([[1, { rendererPackageName: 'react-native-renderer' }]]),
    getFiberRoots: () => new Set([{ current: { stateNode: nav } }])
  }
  try {
    return run(() => action)
  } finally {
    ;(globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = previous
  }
}

test('Fast resolves a bare leaf name to its nested navigator path', () => {
  const state = {
    routeNames: ['HomeTab', 'SearchTab'],
    index: 0,
    routes: [
      { name: 'HomeTab', state: { routeNames: ['Home', 'Profile'], index: 0, routes: [{ name: 'Home' }] } },
      { name: 'SearchTab', state: { routeNames: ['Search'], index: 0, routes: [{ name: 'Search' }] } }
    ]
  }
  withNavigator(state, (dispatched) => {
    assert.deepEqual(agentNavigate(['Profile'], { id: '7' }, DEFAULT_AGENT_LIMITS, null, null), {
      ok: true,
      action: 'navigate',
      path: ['HomeTab', 'Profile'],
      via: 'nested'
    })
    assert.deepEqual(dispatched(), {
      type: 'NAVIGATE',
      payload: {
        name: 'HomeTab',
        params: { screen: 'Profile', params: { id: '7' }, initial: false }
      }
    })
  })
})

test('Fast prefers the focused tab when a leaf is registered in several', () => {
  const tab = (name: string) => ({
    // Not a stack with a key, so the resolver's path - not the REPLACE shortcut - is what is read.
    routeNames: [name, 'Profile'],
    index: 0,
    routes: [{ name }]
  })
  const state = {
    routeNames: ['HomeTab', 'SearchTab'],
    index: 1,
    routes: [
      { name: 'HomeTab', state: tab('Home') },
      { name: 'SearchTab', state: tab('Search') }
    ]
  }
  withNavigator(state, () => {
    const reply = agentNavigate(['Profile'], null, DEFAULT_AGENT_LIMITS, null, null)
    assert.equal(reply.ok, true)
    assert.deepEqual(reply.ok && reply.path, ['SearchTab', 'Profile'])
  })
})

test('Fast falls back to a parsed ancestor for an unmounted navigator', () => {
  const state = {
    routeNames: ['HomeTab', 'SettingsTab'],
    index: 0,
    routes: [{ name: 'HomeTab', state: { routeNames: ['Home'], index: 0, routes: [{ name: 'Home' }] } }]
  }
  withNavigator(state, (dispatched) => {
    const reply = agentNavigate(['Appearance'], null, DEFAULT_AGENT_LIMITS, null, ['SettingsTab'])
    assert.deepEqual(reply, {
      ok: true,
      action: 'navigate',
      path: ['SettingsTab', 'Appearance'],
      via: 'nested'
    })
    assert.deepEqual(dispatched(), {
      type: 'NAVIGATE',
      payload: { name: 'SettingsTab', params: { screen: 'Appearance', params: undefined, initial: false } }
    })
  })
})

test('Fast still refuses a route no mounted navigator registers, naming the whole path', () => {
  const state = {
    routeNames: ['HomeTab'],
    index: 0,
    routes: [{ name: 'HomeTab', state: { routeNames: ['Home'], index: 0, routes: [{ name: 'Home' }] } }]
  }
  const reply = withNavigator(state, () =>
    agentNavigate(['Ghost'], null, DEFAULT_AGENT_LIMITS, null, ['Nowhere'])
  )
  assert.equal(reply.ok, false)
  assert.equal(!reply.ok && reply.reason, 'unregistered')
  // Only a navigator count crosses the wire - no route names beyond the ones the host sent.
  assert.match(String(!reply.ok && reply.detail), /^searched \d+ mounted navigator\(s\)$/)
})

test('Fast resolves a leaf that is already focused to a noop', () => {
  const leaf = {
    key: 'stack-1',
    type: 'stack',
    routeNames: ['Home', 'Profile'],
    index: 0,
    routes: [{ name: 'Profile', params: { id: '7' } }]
  }
  const state = { routeNames: ['HomeTab'], index: 0, routes: [{ name: 'HomeTab', state: leaf }] }
  withNavigator(state, (dispatched) => {
    assert.deepEqual(agentNavigate(['Profile'], { id: '7' }, DEFAULT_AGENT_LIMITS, null, null), {
      ok: true,
      action: 'noop',
      path: ['HomeTab', 'Profile'],
      via: 'nested'
    })
    assert.equal(dispatched(), undefined)
  })
})

test('the render port reports the whole refused path and the navigators searched', async () => {
  const node = {
    id: 'SettingsTab/Appearance', title: 'Appearance', slug: 'appearance', urlPath: null,
    params: [], group: 'SettingsTab', groups: ['SettingsTab', 'ProfileTab'], navigator: 'SettingsStack'
  } as unknown as AppFlowNode
  let sent: unknown[] = []
  const ports = createReachPorts({
    renderTransport: {
      async ready() { return { ok: true as const } },
      async navigate(route, params, expoPath, candidates) {
        sent = [route, candidates]
        return { ok: false, reason: 'unregistered', detail: 'searched 4 mounted navigator(s)' }
      },
      async readiness() { return null as never },
      async close() {}
    }
  } as unknown as Parameters<typeof createReachPorts>[0])
  const outcome = await ports.render!.navigate(node, null)
  assert.equal(outcome.ok, false)
  assert.equal(
    outcome.reason,
    'Route SettingsTab > Appearance is not registered in the running navigator (searched 4 mounted navigator(s)).'
  )
  // The parsed ancestors the in-app resolver falls back on, minus names already in the path.
  assert.deepEqual(sent, [['SettingsTab', 'Appearance'], ['ProfileTab', 'SettingsStack']])
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
    assert.deepEqual(
      agentNavigate(['(tabs)', 'settings'], { id: '42' }, DEFAULT_AGENT_LIMITS, '/settings', null),
      { ok: true, action: 'expo-replace' }
    )
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
  pressables: []
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
    inferred: { kept: { key: 'kept' }, missing: { key: 'missing' } }
  }, current)
  assert.equal(result.resuming, false)
  assert.equal(result.retained, 1)
  assert.deepEqual(Object.keys(result.checkpoint.captures), ['kept'])
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
    deepLinkJudgeMode: 'on',
    captureUiStates: false
  })
})

test('App Flow start accepts zero as all screens and resolves it to the uncapped engine value', () => {
  const parsed = parseAppFlowStartRequest({
    projectPath: '/project',
    mode: 'screen-ui-and-structure',
    screenLimit: 0
  })
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.input.screenLimit, 0)
  assert.equal(resolveAppFlowStart(parsed.input).screenLimit, undefined)

  for (const value of [-1, 1.5, Number.NaN, '0']) {
    assert.equal(
      parseAppFlowStartRequest({ projectPath: '/project', screenLimit: value }).ok,
      false,
      `${String(value)} is refused`
    )
  }
  assert.equal(parseAppFlowStartRequest({ projectPath: '/project', screenLimit: 1 }).ok, true)
})

test('Capture UI states is one optional boolean, off unless asked for, and nothing else is accepted', () => {
  const base = { projectPath: '/project', mode: 'screen-ui-and-structure' as const }
  for (const value of [true, false]) {
    const parsed = parseAppFlowStartRequest({ ...base, captureUiStates: value })
    assert.equal(parsed.ok, true)
    if (parsed.ok) assert.equal(resolveAppFlowStart(parsed.input).captureUiStates, value)
  }
  const absent = parseAppFlowStartRequest(base)
  assert.equal(absent.ok && resolveAppFlowStart(absent.input).captureUiStates, false)
  for (const value of ['true', 1, null, {}]) {
    assert.equal(parseAppFlowStartRequest({ ...base, captureUiStates: value }).ok, false, `${String(value)} is refused`)
  }
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
      async available() { availableCalls += 1; return { ok: true as const } },
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

test('an unavailable transport names its reason in the skip note and logs it once per run', async () => {
  const reason = 'No unambiguous Metro runtime supports Fast capture.'
  const logged: Array<{ transport: string; reason: string }> = []
  const ports = {
    render: {
      async available() { return { ok: false as const, reason } },
      async navigate() { throw new Error('must not dispatch') },
      async awaitSettled() { throw new Error('must not settle') }
    },
    sweepLog: {
      node() { throw new Error('no node record for a transport that never ran') },
      transportUnavailable(value: string) {
        // The real sink keeps only the first; this one records every call so the rung's own
        // per-node call pattern stays visible.
        logged.push({ transport: 'unavailable', reason: value })
      }
    }
  } as unknown as ReachPorts
  const node = { id: 'Inbox', title: 'Inbox', slug: 'inbox', urlPath: '/inbox', params: [] } as unknown as AppFlowNode
  const run = (id: string) =>
    renderStrategy(
      { node: { ...node, id }, params: null, unresolvedParams: [], budget: new ActiveTimeBudget(10_000),
        scratchPath: key => `/tmp/${key}`, guardGateClosed: () => false },
      ports
    )
  const first = await run('Inbox')
  const second = await run('InboxSettings')
  assert.equal(first.ok, false)
  assert.equal(first.reason, `Runtime transport unavailable — ${reason}`)
  assert.equal(second.reason, `Runtime transport unavailable — ${reason}`)
  assert.equal(first.touchedDevice, false)
  assert.deepEqual(logged, [
    { transport: 'unavailable', reason },
    { transport: 'unavailable', reason }
  ])
})

const RENDER_NODE = {
  id: 'HomeTab/Profile',
  title: 'Profile',
  slug: 'profile',
  urlPath: null,
  params: []
} as unknown as AppFlowNode

/**
 * A render-rung port set whose settle answer is dictated by the test, counting judge calls. The
 * dispatch always resolves to `HomeTab > Profile`, so the only thing varying between these cases
 * is the readiness evidence the runtime reports.
 */
const renderPorts = (settle: Record<string, unknown>) => {
  const judged: string[] = []
  const ports = {
    render: {
      async available() { return { ok: true as const } },
      async navigate() {
        return { ok: true, reason: 'Dispatched HomeTab > Profile.', path: ['HomeTab', 'Profile'] }
      },
      async awaitSettled() {
        return {
          settled: true,
          reason: 'settled',
          polls: 2,
          stop: 'settled',
          active: ['HomeTab', 'Profile'],
          found: true,
          content: 14,
          paramMismatch: [],
          signature: 'sig-1',
          ...settle
        }
      }
    },
    device: {
      async captureScreenshot() { return { relaunched: false } },
      async capturePressables() { return [] }
    },
    judge: {
      async verifyArrival(node: AppFlowNode) {
        judged.push(node.id)
        return { verdict: 'match', status: 'ok', reason: 'the judge looked' }
      }
    }
  } as unknown as ReachPorts
  return { ports, judged }
}

const runRender = (settle: Record<string, unknown>, arrivalJudge?: 'always' | 'fallback') => {
  const { ports, judged } = renderPorts(settle)
  return renderStrategy(
    {
      node: RENDER_NODE,
      params: null,
      unresolvedParams: [],
      budget: new ActiveTimeBudget(10_000),
      scratchPath: (key) => `/tmp/${key}`,
      guardGateClosed: () => false,
      ...(arrivalJudge ? { arrivalJudge } : {})
    },
    ports
  ).then((attempt) => ({ attempt, judged }))
}

test('Fast accepts an unambiguous runtime arrival without paying the vision judge', async () => {
  const { attempt, judged } = await runRender({}, 'fallback')
  assert.equal(attempt.ok, true)
  assert.deepEqual(judged, [])
  assert.equal(attempt.arrival?.verdict, 'match')
  assert.match(String(attempt.arrival?.reason), /Runtime navigation confirmed: HomeTab > Profile/)
  // A no-judge verdict names no screen and describes none — see `inferredScreens` in the
  // orchestrator for why that map stays empty on a Fast run.
  assert.equal(attempt.arrival?.key, undefined)
})

test('Fast falls through to the judge on anything the runtime cannot settle outright', async () => {
  // The target was never focused.
  const notFound = await runRender({ found: false }, 'fallback')
  assert.deepEqual(notFound.judged, ['HomeTab/Profile'])
  // The right route, the wrong record — the one case a route-identity check alone would miss.
  const mismatch = await runRender({ paramMismatch: ['handle'] }, 'fallback')
  assert.deepEqual(mismatch.judged, ['HomeTab/Profile'])
  // Nothing on screen yet.
  const empty = await runRender({ content: 0 }, 'fallback')
  assert.deepEqual(empty.judged, ['HomeTab/Profile'])
  // A poll that never got an answer carries its empty defaults, `found: false` among them.
  const noAnswer = await runRender(
    { settled: false, stop: 'no-answer', found: false, content: 0, active: [] },
    'fallback'
  )
  assert.deepEqual(noAnswer.judged, ['HomeTab/Profile'])
  // Focused on a sibling: the dispatched path is not a suffix of the live path.
  const elsewhere = await runRender({ active: ['SearchTab', 'Search'] }, 'fallback')
  assert.deepEqual(elsewhere.judged, ['HomeTab/Profile'])
})

test('a Fast sweep starts without a decision provider; every other mode still demands one', () => {
  // The guard both the orchestrator's throw and the service's start refusal are made of. A Fast
  // sweep asks no model anything it cannot do without, so requiring a provider for it would be a
  // requirement the sweep no longer has.
  assert.equal(requiresDecisionProvider('screen-ui-and-structure', 'fast'), false)
  assert.equal(requiresDecisionProvider('screen-ui-and-structure', 'auto'), true)
  assert.equal(requiresDecisionProvider('screen-ui-and-structure', 'thorough'), true)
  // The default exploration mode is `auto`, so an unstated one is not Fast.
  assert.equal(requiresDecisionProvider('screen-ui-and-structure', undefined), true)
  // A structure build never asked for one in the first place.
  assert.equal(requiresDecisionProvider('structure-only', 'auto'), false)
  assert.equal(requiresDecisionProvider(undefined, 'auto'), false)
})

test('a live feed that never goes quiet is verified from its own evidence, not by the judge', async () => {
  // HomeTab/Home and NotificationsTab/Notifications in the 2026-10 reference run: the poll gave up
  // on a timeout because the feed never stops moving, while the snapshot said the dispatched path
  // was focused, with content and no param mismatch. That is the whole question the judge was
  // being asked, and it cost ~3.2s per node to have it answered a second time.
  const { attempt, judged } = await runRender(
    { settled: false, stop: 'timeout', content: 337 },
    'fallback'
  )
  assert.equal(attempt.ok, true)
  assert.deepEqual(judged, [])
  assert.equal(attempt.arrival?.verdict, 'match')
  // The note is honest about what it does not stand behind: the frame may be mid-animation.
  assert.match(String(attempt.arrival?.reason), /readiness poll stopped on timeout/)
})

test('a timed-out settle is still not enough on its own', async () => {
  // The relaxation is only about `settled`. Every other part of the evidence test stands, so a
  // timed-out poll that also reports the wrong record still goes to the judge.
  const { judged } = await runRender(
    { settled: false, stop: 'timeout', paramMismatch: ['handle'] },
    'fallback'
  )
  assert.deepEqual(judged, ['HomeTab/Profile'])
})

test('auto keeps asking the judge on every render arrival', async () => {
  // `strategiesFor('auto')` ends on the render rung, and the orchestrator hands it no
  // `arrivalJudge`, which must mean the judge decides exactly as it always has.
  assert.equal(
    strategiesFor('auto', {
      probeCredit: rung('probe'),
      savedReplay: rung('saved'),
      deepLink: rung('deep-link'),
      render: rung('fast'),
      explore: rung('explore')
    }).length,
    4
  )
  const { attempt, judged } = await runRender({})
  assert.equal(attempt.ok, true)
  assert.deepEqual(judged, ['HomeTab/Profile'])
  assert.equal(attempt.arrival?.reason, 'the judge looked')
  // Including on the evidence Fast now accepts outright: `'always'` means always.
  const liveFeed = await runRender({ settled: false, stop: 'timeout', content: 337 })
  assert.deepEqual(liveFeed.judged, ['HomeTab/Profile'])
  assert.equal(liveFeed.attempt.arrival?.reason, 'the judge looked')
})

/** A render port over a scripted readiness sequence, with the settle deadlines under test. */
const settlePort = (
  snapshot: () => Record<string, unknown>,
  settleDeadlinesMs: readonly number[]
) => {
  let polls = 0
  const ports = createReachPorts({
    settleDeadlinesMs,
    renderTransport: {
      async ready() { return { ok: true as const } },
      async navigate() { return { ok: true, action: 'navigate' } },
      async readiness() { polls += 1; return snapshot() },
      async close() {}
    }
  } as unknown as Parameters<typeof createReachPorts>[0])
  return { render: ports.render!, polls: () => polls }
}

const LIVE_FEED = {
  settled: false,
  quiet: false,
  painted: true,
  confident: true,
  missing: [],
  found: true,
  content: 9,
  loading: null,
  signature: 'stable',
  active: ['HomeTab', 'Profile'],
  paramMismatch: []
}

test('the settle poll stops on a screen that is stable but never goes quiet', async () => {
  const { render, polls } = settlePort(() => ({ ...LIVE_FEED }), [5_000])
  const startedAt = Date.now()
  const result = await render.awaitSettled(RENDER_NODE, null, new ActiveTimeBudget(20_000))
  assert.equal(result.stop, 'stable-not-quiet')
  assert.equal(result.settled, true)
  // The decisive fields survive the poll rather than being folded into prose.
  assert.deepEqual(result.active, ['HomeTab', 'Profile'])
  assert.equal(result.found, true)
  assert.equal(result.content, 9)
  assert.deepEqual(result.paramMismatch, [])
  assert.equal(result.signature, 'stable')
  // Not before the screen has had time to arrive, and well before the deadline.
  assert.ok(Date.now() - startedAt >= 1_500, 'short-circuited before IDLE_AFTER_MS')
  assert.ok(Date.now() - startedAt < 4_000, 'waited out the whole deadline anyway')
  assert.ok(polls() >= 3, 'needs at least three identical signatures')
})

test('a changing screen stops at the first deadline, and extends only while it is loading', async () => {
  let tick = 0
  const churning = () => ({ ...LIVE_FEED, signature: `sig-${(tick += 1)}` })
  const quick = settlePort(churning, [200, 900])
  const quickStartedAt = Date.now()
  const quickResult = await quick.render.awaitSettled(RENDER_NODE, null, new ActiveTimeBudget(20_000))
  const quickElapsed = Date.now() - quickStartedAt
  assert.equal(quickResult.stop, 'timeout')
  assert.ok(quickElapsed < 600, `stopped at the first deadline (took ${quickElapsed}ms)`)

  tick = 0
  const loading = settlePort(() => ({ ...churning(), loading: 'spinner' }), [200, 900])
  const loadingStartedAt = Date.now()
  const loadingResult = await loading.render.awaitSettled(RENDER_NODE, null, new ActiveTimeBudget(20_000))
  const loadingElapsed = Date.now() - loadingStartedAt
  assert.equal(loadingResult.stop, 'timeout')
  assert.ok(loadingElapsed >= 850, `extended to the second deadline (took ${loadingElapsed}ms)`)
})

test('a refused dispatch is reported as refused rather than as a stuck app', async () => {
  const ports = {
    render: {
      async available() { return { ok: true as const } },
      async navigate() {
        return {
          ok: false,
          reason: 'Route HomeTab > Ghost is not registered in the running navigator.',
          refusal: 'unregistered'
        }
      },
      async awaitSettled() { throw new Error('a refused dispatch must not be settled for') }
    }
  } as unknown as ReachPorts
  const renderRung: ReachStrategy<null> = (_input, p) =>
    renderStrategy(
      {
        node: RENDER_NODE,
        params: null,
        unresolvedParams: [],
        budget: new ActiveTimeBudget(10_000),
        scratchPath: (key) => `/tmp/${key}`,
        guardGateClosed: () => false,
        arrivalJudge: 'fallback'
      },
      p
    )
  const outcome = await runReachLadder({
    input: null,
    ports,
    budget: { expired: false },
    strategies: [renderRung]
  })
  assert.equal(outcome.status, 'unreached')
  assert.equal(outcome.status === 'unreached' && outcome.refused, true)
  // The eval went out and came back, so this is not a free short-circuit...
  assert.equal(outcome.attempts[0].touchedDevice, true)
  assert.equal(outcome.attempts[0].refused, true)
  // ...and the orchestrator cannot learn any of this from `isToolingFailure`, which is why the
  // refusal needs a flag of its own rather than a widened reason test. Widening that function
  // would also change thorough-mode walk retries, which share it.
  assert.equal(isToolingFailure(outcome.reason), false)
})

test('a dispatch that threw is not a refusal — it may have moved the app', async () => {
  const ports = {
    render: {
      async available() { return { ok: true as const } },
      async navigate() {
        return { ok: false, reason: 'Navigation dispatch threw: boom', refusal: 'threw' }
      }
    }
  } as unknown as ReachPorts
  const attempt = await renderStrategy(
    {
      node: RENDER_NODE,
      params: null,
      unresolvedParams: [],
      budget: new ActiveTimeBudget(10_000),
      scratchPath: (key) => `/tmp/${key}`,
      guardGateClosed: () => false,
      arrivalJudge: 'fallback'
    },
    ports
  )
  assert.equal(attempt.refused, undefined)
  assert.equal(attempt.touchedDevice, true)
})

test('the checkpoint coalesces a burst into one write and still flushes on a durable path', async () => {
  // A hand-driven clock and timer, so the window is exercised without waiting on one.
  let now = 0
  let scheduled: (() => void) | null = null
  const written: number[] = []
  const writer = createCoalescedWriter({
    write: async () => {
      written.push(now)
    },
    windowMs: 1_500,
    now: () => now,
    setTimer: (fn) => {
      scheduled = fn
      return 'timer'
    },
    clearTimer: () => {
      scheduled = null
    }
  })

  // The first mutation writes outright — a resumed sweep must see the very first screen.
  await writer.mark()
  assert.deepEqual(written, [0])

  // Four more inside the window write nothing now, and schedule exactly one trailing write.
  now = 200
  await writer.mark()
  now = 400
  await writer.mark()
  now = 900
  await writer.mark()
  assert.deepEqual(written, [0])
  assert.ok(scheduled, 'A deferred mutation is never simply dropped.')

  // The trailing write carries every mutation that joined the window.
  now = 1_500
  scheduled!()
  await Promise.resolve()
  assert.equal(writer.writes, 2)

  // A forced flush with nothing new is free — this is what makes the sweep's `finally` safe to
  // run after `clearSweepProgress` on a completed run.
  await writer.flush()
  assert.equal(writer.writes, 2)

  // A forced flush with something pending writes immediately, window or no window.
  now = 1_600
  await writer.mark()
  assert.equal(writer.writes, 2, 'Still inside the window.')
  await writer.flush()
  assert.equal(writer.writes, 3)
  assert.equal(scheduled, null, 'Forcing cancels the trailing write it supersedes.')
})

// --- adopted-device Metro validation -----------------------------------------------------------
// The adopt path reuses the `metroPort` the user's Launch recorded. These cover the three ways that
// port can turn out: still live, dead but restartable, and gone for good — where the mode decides
// whether the run dies with it.

const adoptedCtx = { projectPath: '/tmp/app', scheme: 'myapp' } as unknown as CaptureContext

const adoptedDevice = (port: number): CaptureDevice =>
  ({
    metroPort: port,
    metroLogPath: null,
    launchProcess: null,
    launchUrl: `exp://127.0.0.1:${port}`,
    devClientUrl: `myapp://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${port}`
  }) as unknown as CaptureDevice

const recoveredMetro = (metroPort: number) => async () => ({
  child: { pid: 4242, kill: () => true } as never,
  metroPort,
  metroLogPath: '/tmp/metro.log'
})

const neverRecovers = async () => {
  throw new Error('"npm start" timed out waiting for Metro.')
}

test('an adopted device whose Metro still answers is left exactly as it was', async () => {
  const device = adoptedDevice(8081)
  const probed: number[] = []
  const outcome = await ensureAdoptedMetro(adoptedCtx, device, {
    explorationMode: 'fast',
    probe: async (port) => {
      probed.push(port)
      return true
    },
    recover: neverRecovers
  })
  assert.deepEqual(outcome, { status: 'live', metroPort: 8081 })
  assert.deepEqual(probed, [8081])
  assert.equal(device.metroPort, 8081)
})

test('a dead adopted port is recovered, and every URL that names it moves with it', async () => {
  const device = adoptedDevice(8081)
  const outcome = await ensureAdoptedMetro(adoptedCtx, device, {
    explorationMode: 'fast',
    probe: async () => false,
    recover: recoveredMetro(8099)
  })
  assert.equal(outcome.status, 'recovered')
  assert.equal(outcome.metroPort, 8099)
  assert.equal(device.metroPort, 8099)
  assert.equal(device.metroLogPath, '/tmp/metro.log')
  assert.equal(device.launchUrl, 'exp://127.0.0.1:8099')
  assert.match(device.devClientUrl ?? '', /8099/)
  assert.doesNotMatch(device.devClientUrl ?? '', /8081/)
})

test('Fast aborts loudly when Metro cannot be recovered', async () => {
  const device = adoptedDevice(8081)
  await assert.rejects(
    ensureAdoptedMetro(adoptedCtx, device, {
      explorationMode: 'fast',
      probe: async () => false,
      recover: neverRecovers
    }),
    (error: unknown) => {
      assert.ok(error instanceof MetroUnavailableError)
      assert.match(error.message, /Metro dev server for this project is not reachable on port 8081/)
      assert.match(error.message, /Fast capture reaches every screen through Metro/)
      return true
    }
  )
})

for (const mode of ['auto', 'thorough'] as const) {
  test(`${mode} survives an unrecoverable Metro with a warning instead of an abort`, async () => {
    const device = adoptedDevice(8081)
    const outcome = await ensureAdoptedMetro(adoptedCtx, device, {
      explorationMode: mode,
      probe: async () => false,
      recover: neverRecovers
    })
    assert.equal(outcome.status, 'degraded')
    assert.equal(outcome.metroPort, 8081)
    assert.match(outcome.warning ?? '', /not reachable/)
    assert.match(outcome.warning ?? '', /deep links and on-device exploration/)
  })
}

test('a run of device-free skips never trips the blocked-run breaker, a stuck app still does', async () => {
  // The breaker counts consecutive `unreached` nodes whose post-failure screen matches the
  // previous failure's, and asks the user to clear a blocker at three. `touchedDevice` is the
  // guard the orchestrator applies before that counter, so this reproduces the counter around it
  // with the same screen for every node — the pathological input, where the app never moves.
  const runLadder = async (node: AppFlowNode, unresolvedParams: string[], ports: ReachPorts) =>
    runReachLadder({
      input: { node, params: null, unresolvedParams, budget: new ActiveTimeBudget(10_000),
        scratchPath: (key: string) => `/tmp/${key}`, guardGateClosed: () => false },
      ports,
      strategies: strategiesFor('fast', {
        probeCredit: rung('probe'), savedReplay: rung('saved'), deepLink: rung('deep-link'),
        render: renderStrategy as unknown as ReachStrategy<unknown>, explore: rung('explore')
      } as unknown as ReachRungs<unknown>),
      budget: new ActiveTimeBudget(10_000)
    })
  const node = (id: string) =>
    ({ id, title: id, slug: id.toLowerCase(), urlPath: `/${id}`, params: [] }) as unknown as AppFlowNode

  // Fast's ladder is render-only, so an unresolved route parameter costs 0ms and never dispatches.
  const idlePorts = {
    render: {
      async available() { throw new Error('must not reach the transport') },
      async navigate() { throw new Error('must not dispatch') },
      async awaitSettled() { throw new Error('must not settle') }
    }
  } as unknown as ReachPorts
  let blockedRun = 0
  for (const id of ['Terms', 'Privacy', 'CopyrightPolicy', 'Licenses']) {
    const outcome = await runLadder(node(id), ['documentId'], idlePorts)
    assert.equal(outcome.status, 'unreached')
    assert.match(outcome.reason ?? '', /Unresolved route parameters/)
    // Not `refused`: the runtime was never asked, so the narrower exclusion would have missed it.
    assert.equal(outcome.refused, false)
    if (touchedDevice(outcome)) blockedRun += 1
  }
  assert.equal(blockedRun, 0, 'device-free skips must not ask the user to clear a blocker')

  // The case the breaker exists for: every node dispatches, and the screen does not move.
  const stuckPorts = {
    render: {
      async available() { return { ok: true as const } },
      async navigate() { return { ok: true, reason: 'dispatched', path: ['Home'] } },
      async awaitSettled() { return { settled: true, reason: 'settled', polls: 1, stop: 'settled', active: ['Home'], found: false, content: 3, paramMismatch: [] } },
      async captureScreenshot() { return { relaunched: false } }
    },
    device: {
      async captureScreenshot() { return { relaunched: false } },
      async capturePressables() { return [{ label: 'Retry' }] }
    },
    judge: {
      async verifyArrival() { return { verdict: 'mismatch', status: 'other', reason: 'Still the error screen' } }
    }
  } as unknown as ReachPorts
  blockedRun = 0
  for (const id of ['Profile', 'Settings', 'About']) {
    const outcome = await runLadder(node(id), [], stuckPorts)
    assert.equal(outcome.status, 'unreached')
    if (touchedDevice(outcome)) blockedRun += 1
  }
  assert.equal(blockedRun, 3, 'a dispatched node that did not move the app still feeds the breaker')
})

/* ------------------------------------------------- link harvest (route params) */

/** Installs a DevTools hook over a hand-built tree for the duration of `body`. */
const withFiberTree = <T>(roots: unknown[], body: () => T): T => {
  const slot = globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }
  const previous = slot.__REACT_DEVTOOLS_GLOBAL_HOOK__
  slot.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map([[1, { rendererPackageName: 'react-native-renderer' }]]),
    getFiberRoots: () => new Set(roots.map((current) => ({ current })))
  }
  try {
    return body()
  } finally {
    slot.__REACT_DEVTOOLS_GLOBAL_HOOK__ = previous
  }
}

const postThread: LinkHarvestNode = {
  id: 'PostThread',
  urlPath: '/profile/:name/post/:rkey',
  params: ['name', 'rkey'],
  file: 'src/screens/PostThread.tsx'
}

test('a harvested link assembles a two-param record the a11y learners cannot', () => {
  // One row, off-screen under a tab the user has not opened. The walk must not prune it: an
  // unfocused subtree still holds the destination, and that is the whole point of reading props.
  const row = { memoizedProps: { to: '/profile/alice.test/post/3kabc' }, child: null, sibling: null }
  const hiddenTab = { memoizedProps: { activityState: 0 }, child: row, sibling: null }
  const reply = withFiberTree([{ child: hiddenTab, sibling: null, memoizedProps: {} }], () =>
    agentCollectLinks(DEFAULT_AGENT_LIMITS, LINK_CANDIDATE_CAP)
  )
  assert.deepEqual(reply.links, [{ path: '/profile/alice.test/post/3kabc' }])
  assert.equal(reply.capped, false)

  const store = new ParamStore()
  assert.equal(store.best(postThread), null)
  const { usable, unmatched } = ingestLinkCandidates(reply.links, 'Home', [postThread], store)
  assert.equal(usable, 1)
  assert.equal(unmatched, 0)
  // Both params, from one record, with no merge across sightings and no new precedence rule.
  assert.deepEqual(store.best(postThread)?.values, { name: 'alice.test', rkey: '3kabc' })
})

test('an object destination carries route name and params in a single record', () => {
  const row = {
    memoizedProps: { href: { screen: 'PostThread', params: { name: 'bob.test', rkey: '3kxyz', onPress: () => {} } } },
    child: null,
    sibling: null
  }
  const reply = withFiberTree([{ child: row, sibling: null, memoizedProps: {} }], () =>
    agentCollectLinks(DEFAULT_AGENT_LIMITS, LINK_CANDIDATE_CAP)
  )
  // The callback is dropped in the app, so nothing arrives as `[object Object]` pretending to be an id.
  assert.deepEqual(reply.links, [
    { name: 'PostThread', params: { name: 'bob.test', rkey: '3kxyz' } }
  ])
  const store = new ParamStore()
  assert.equal(ingestLinkCandidates(reply.links, 'Home', [postThread], store).usable, 1)
  assert.deepEqual(store.best(postThread)?.values, { name: 'bob.test', rkey: '3kxyz' })
})

test('a harvested link is still subject to the learned shape baseline', () => {
  const receipt: LinkHarvestNode = {
    id: 'Receipt',
    urlPath: '/receipt/:id/:rev',
    params: ['id', 'rev'],
    file: null
  }
  const store = new ParamStore()
  // An incomplete literal in source text: it teaches what an `id` looks like for this route
  // without itself becoming a record, so `best()` below reports only what the harvest produced.
  store.noteStatic(receipt, { id: '41' })
  const refused = ingestLinkCandidates(
    [
      { name: 'Receipt', params: { id: 'abcdef', rev: '2' } },
      { path: '/receipt/abcdef/2' }
    ],
    'Home',
    [receipt],
    store
  )
  assert.equal(refused.usable, 0, 'a token where digits were learned must not become a record')
  assert.equal(store.best(receipt), null)
  // The same route still accepts a value of the learned shape, from the same harvest path.
  assert.equal(ingestLinkCandidates([{ path: '/receipt/99/2' }], 'Home', [receipt], store).usable, 1)
  assert.deepEqual(store.best(receipt)?.values, { id: '99', rev: '2' })
})

test('a link candidate that names nothing routable is dropped before it costs a lookup', () => {
  assert.equal(agentLinkCandidate('Open profile'), null)
  assert.equal(agentLinkCandidate({ screen: 'PostThread' }), null, 'a bare name resolves nothing navigator state did not')
  assert.equal(agentLinkCandidate(undefined), null)
  assert.deepEqual(agentLinkCandidate('bluesky://profile/alice.test'), {
    path: 'bluesky://profile/alice.test'
  })
})

test('the assembled agent evaluates in an empty node:vm context with no free module references', () => {
  // The agent is re-created in a fresh scope inside the app, so a reference to anything that only
  // exists in this repo's module scope (a constant, an import) type-checks, passes every test that
  // calls the function directly, and then fails as a ReferenceError against a live device. An
  // empty `vm` context has the standard JS builtins and nothing else, so evaluating the real,
  // injected source there and then calling every function reproduces that failure here.
  const names = Object.keys(AGENT_FUNCTIONS)
  // Same text that is injected; only the closure's return value is widened so each function can be
  // reached from outside it.
  const exposed = agentSource().replace(
    'return agentInstall;',
    `return {${names.map((name) => `${name}: ${name}`).join(',')}};`
  )
  const context = vm.createContext({})
  const agent = vm.runInContext(exposed, context) as Record<string, () => unknown>
  assert.deepEqual(Object.keys(agent), names, 'every registry function reached the closure')
  for (const name of names) {
    try {
      agent[name]!()
    } catch (error) {
      // Calling with no arguments is expected to fail inside most of these; what must never happen
      // is failing because a name does not exist.
      // The error is constructed by the vm's own realm, so `instanceof ReferenceError` is false
      // here even when it is one; compare the name instead.
      assert.notEqual(
        (error as Error | undefined)?.name,
        'ReferenceError',
        `agent function "${name}" referenced a name that does not exist in the app: ${String(error)}`
      )
    }
  }
})

test('the packaged Fast agent carries the link harvest and its integrity guard counts it', () => {
  const source = agentSource()
  assert.match(source, /function agentCollectLinks/)
  assert.match(source, /type === ["']links["']/)
  assert.equal(Object.keys(AGENT_FUNCTIONS).length, EXPECTED_AGENT_FUNCTION_COUNT)
})

/* ------------------------------------------------------------ presentations runtime */

test('the packaged agent carries the presentation commands and counts their functions', () => {
  const source = agentSource()
  assert.match(source, /function agentProject/)
  assert.match(source, /function agentRestorePresentations/)
  assert.match(source, /type === ["']presentation-setup["']/)
  assert.match(source, /type === ["']presentations["']/)
  assert.match(source, /type === ["']presentation-open["']/)
  assert.match(source, /type === ["']presentation-rollback["']/)
  assert.equal(Object.keys(AGENT_FUNCTIONS).length, EXPECTED_AGENT_FUNCTION_COUNT)
})

test('a presentation controller needs a zero-argument opener paired with a closer', () => {
  const sheet = { present: () => {}, dismiss: () => {} }
  assert.equal(agentOpeningControl(sheet), true)
  assert.equal(agentOpeningControl(sheet, 'present'), true)
  assert.equal(agentOpeningControl(sheet, 'open'), false, 'only the named method may qualify')
  assert.equal(agentControlCloser(sheet, 'present'), 'dismiss')
  // An opener taking an argument is an app API that needs data we do not have; calling it is a
  // guess, so it is refused.
  assert.equal(agentOpeningControl({ present: (id: string) => id, dismiss: () => {} }), false)
  // An opener with no paired closer could be opened and never put back.
  assert.equal(agentOpeningControl({ open: () => {} }), false)
  assert.equal(agentControlCloser({ open: () => {} }, 'open'), null)
  // A getter must never be invoked to decide whether something is a controller.
  let invoked = 0
  const trap = {}
  Object.defineProperty(trap, 'open', { get: () => { invoked++; return () => {} }, enumerable: true })
  Object.defineProperty(trap, 'close', { get: () => { invoked++; return () => {} }, enumerable: true })
  assert.equal(agentOpeningControl(trap), false)
  assert.equal(invoked, 0, 'descriptors are read, never properties')
})

test('a projected copy inherits only the six presentation props of its nearest ancestor Modal', () => {
  const Modal = function Modal() {}
  const outer = {
    type: Modal,
    memoizedProps: { presentationStyle: 'fullScreen', transparent: false, animationType: 'slide' },
    return: null
  }
  const nearest = {
    type: Modal,
    memoizedProps: {
      presentationStyle: 'pageSheet',
      transparent: true,
      statusBarTranslucent: true,
      onRequestClose: () => {},
      children: 'ignored'
    },
    return: outer
  }
  const focus = { return: nearest }
  assert.deepEqual(agentModalCarryOver(focus, Modal), {
    presentationStyle: 'pageSheet',
    transparent: true,
    statusBarTranslucent: true
  })
  assert.deepEqual(agentModalCarryOver({ return: null }, Modal), {}, 'no ancestor Modal carries nothing')
  assert.deepEqual(agentModalCarryOver(focus, undefined), {})
})

test('projection refuses a copy that would duplicate the live app navigation', () => {
  const Provider = function Provider() {}
  const Navigator = function Navigator() {}
  const navigatorProps = { children: null }
  const element = { type: Navigator, props: navigatorProps }
  const props = { children: element }
  const focus = { type: Provider, memoizedProps: props, return: null }
  const navigatorFiber = { type: Navigator, memoizedProps: navigatorProps, return: focus }
  const screen = {
    memoizedProps: { route: { name: 'Home' }, navigation: { getState: () => ({}) } },
    return: navigatorFiber
  }
  const tree = {
    all: [focus, navigatorFiber, screen],
    props: new Map([[navigatorProps, [navigatorFiber]]]),
    inside: (fiber: any, owner: any) => {
      for (let parent = fiber; parent; parent = parent.return) if (parent === owner) return true
      return false
    }
  }
  assert.equal(agentCopiesLiveNavigation(focus, props, tree), true)
  // The same provider with no navigator under its copied children is projectable.
  const plain = { children: { type: function Label() {}, props: {} } }
  assert.equal(agentCopiesLiveNavigation(focus, plain, tree), false)
  assert.equal(agentCopiesLiveNavigation(focus, { children: undefined }, tree), false)
})

test('agentSetPath writes a path immutably and an empty path replaces the value', () => {
  const before = { form: { sheet: false, other: 1 }, kept: true }
  const after = agentSetPath(before, ['form', 'sheet'], true)
  assert.deepEqual(after, { form: { sheet: true, other: 1 }, kept: true })
  assert.equal(before.form.sheet, false, 'the original is untouched')
  assert.notEqual(after.form, before.form)
  assert.equal(agentSetPath('closed', [], 'open'), 'open')
  assert.deepEqual(agentSetPath([1, 2], ['1'], 9), [1, 9])
})

/** Minimal React-shaped fibers: enough structure for the presentation index to walk. */
function presFiber(type: unknown, props: Record<string, unknown>, children: any[] = [], extra: Record<string, unknown> = {}): any {
  const fiber: any = { tag: 0, type, elementType: type, memoizedProps: props, child: null, sibling: null, return: null, ...extra }
  let previous: any = null
  for (const child of children) {
    child.return = fiber
    if (previous) previous.sibling = child
    else fiber.child = child
    previous = child
  }
  return fiber
}

function withFiberRoot<T>(root: any, body: () => T): T {
  const holder = globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }
  const previous = holder.__REACT_DEVTOOLS_GLOBAL_HOOK__
  holder.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map([[1, { rendererPackageName: 'react-native-renderer' }]]),
    getFiberRoots: () => new Set([{ current: root }])
  }
  const restore = () => { holder.__REACT_DEVTOOLS_GLOBAL_HOOK__ = previous }
  let result: T
  try {
    result = body()
  } catch (error) {
    restore()
    throw error
  }
  // An async body keeps the hook until it settles.
  if (result && typeof (result as { then?: unknown }).then === 'function') {
    return (result as unknown as Promise<unknown>).finally(restore) as T
  }
  restore()
  return result
}

/**
 * The shape of the bug: one app-wide dialog controller, one opener that lives on one screen only.
 * `Feed` owns a `PostMenuItems` that renders the opener and the `ReportDialog`; `Settings` has
 * neither. Both screens stay mounted, as React Navigation keeps them, and focus is a flag.
 */
function reportDialogApp(options: { openers?: number; focused?: 'Feed' | 'Settings' } = {}) {
  const control = { open() {}, close() {} }
  const PostMenuItem = function PostMenuItem() {}
  const ReportDialog = function ReportDialog() {}
  const PostMenuItems = function PostMenuItems() {}
  const Screen = function Screen() {}
  const App = function App() {}
  const focusedName = options.focused ?? 'Feed'
  const route = (name: string, kids: any[]) =>
    presFiber(
      Screen,
      { route: { name }, navigation: { isFocused: () => name === focusedName } },
      kids
    )
  const owners = Array.from({ length: options.openers ?? 1 }, () => {
    const opener = presFiber(PostMenuItem, { onPress: () => {} }, [], { _debugStack: { stack: 'at PostMenuItems (address at http://localhost:8081/index.bundle:10:5)' } })
    const dialog = presFiber(ReportDialog, { control })
    return { owner: presFiber(PostMenuItems, {}, [opener, dialog]), opener, dialog }
  })
  const feed = route('Feed', owners.map(entry => entry.owner))
  const settings = route('Settings', [presFiber(function Label() {}, {})])
  const root = presFiber(App, {}, [feed, settings])
  const action = {
    id: 'a1',
    name: 'Report',
    owner: 'PostMenuItems',
    component: 'PostMenuItem',
    prop: 'onPress',
    effect: { kind: 'control', component: 'ReportDialog', prop: 'control', method: 'open', close: 'close' }
  }
  return { root, control, owners, feed, settings, action }
}

function collectEntries(pres: any): any {
  let reply: any
  agentPresentationCollect(pres, value => { reply = value })
  return reply
}

test('a control opener that is not bound to a live entry on the focused screen is refused', () => {
  const app = reportDialogApp()
  withFiberRoot(app.root, () => {
    const pres = agentCreatePresentations(globalThis, DEFAULT_AGENT_LIMITS, [])
    pres.catalog = { states: [], actions: [app.action] }

    // The controller is mounted and well-formed, but nothing proves this action's opener is here:
    // the reference's hard gate. This is what let one dialog open on every screen.
    const unbound = agentPresentationList(pres)
    assert.deepEqual(unbound.available, [])
    assert.deepEqual(unbound.rejected, { unbound: 1 })
    const refused = agentPresentationOpen(pres, 'a1', null)
    assert.equal(refused.ok, false)
    assert.equal(refused.reason, 'unbound')

    // The collection pass records the opener's creation stack and offers it to the host.
    const reply = collectEntries(pres)
    assert.equal(reply.ok, true)
    assert.deepEqual(reply.unbound.map((entry: any) => [entry.kind, entry.owner]), [['entry', 'PostMenuItem']])
    assert.match(reply.unbound[0].stack, /PostMenuItems/)
    assert.equal(reply.entries, 1)
    assert.equal(reply.entriesMatched, 0)

    // The host's join names the site; configure is the same write the command performs.
    pres.entries.forEach((record: any) => record.actions.add('a1'))
    pres.structureCache = undefined
    const listed = agentPresentationList(pres)
    assert.deepEqual(listed.available, [{ id: 'a1', kind: 'control' }])
    const opened = agentPresentationOpen(pres, 'a1', null)
    assert.equal(opened.ok, true)
    assert.equal(pres.undo[0].control, app.control)
    // An opener the host looked at and could not place is not offered again.
    pres.entries.forEach((record: any) => { record.actions.clear(); record.checked = true })
    assert.deepEqual(collectEntries(pres).unbound, [])
  })
})

test('a control opener on a screen that is mounted but not focused does not open from another screen', () => {
  const app = reportDialogApp({ focused: 'Settings' })
  withFiberRoot(app.root, () => {
    const pres = agentCreatePresentations(globalThis, DEFAULT_AGENT_LIMITS, [])
    pres.catalog = { states: [], actions: [app.action] }
    collectEntries(pres)
    pres.entries.forEach((record: any) => record.actions.add('a1'))
    pres.structureCache = undefined

    const listed = agentPresentationList(pres)
    assert.deepEqual(listed.available, [], 'Settings is focused and renders no opener')
    assert.deepEqual(listed.rejected, { 'not-in-view': 1 })
    assert.equal(agentPresentationOpen(pres, 'a1', null).reason, 'not-in-view')
    assert.equal(pres.undo.length, 0, 'nothing was opened')
  })
})

test('two owners of one control opener outside a list stay ambiguous, and list rows open the first', () => {
  const app = reportDialogApp({ openers: 2 })
  withFiberRoot(app.root, () => {
    const pres = agentCreatePresentations(globalThis, DEFAULT_AGENT_LIMITS, [])
    pres.catalog = { states: [], actions: [app.action] }
    collectEntries(pres)
    pres.entries.forEach((record: any) => record.actions.add('a1'))
    pres.structureCache = undefined
    assert.equal(agentPresentationOpen(pres, 'a1', null).reason, 'ambiguous-owner')

    // Put both owners in one vertical scroll container: rows of a feed.
    const list = presFiber('RCTScrollView', {}, [], { tag: 5, type: 'RCTScrollView' })
    for (const entry of app.owners) entry.owner.return = list
    list.return = app.feed
    pres.structureCache = undefined
    const rows = agentPresentationOpen(pres, 'a1', null)
    assert.equal(rows.ok, true, 'one control per row means one distinct controller per owner')
  })
})

test('the entry index follows the current alternate and drops records for unmounted openers', () => {
  const app = reportDialogApp()
  withFiberRoot(app.root, () => {
    const pres = agentCreatePresentations(globalThis, DEFAULT_AGENT_LIMITS, [])
    pres.catalog = { states: [], actions: [app.action] }
    collectEntries(pres)
    pres.entries.forEach((record: any) => record.actions.add('a1'))
    pres.structureCache = undefined
    assert.equal(agentPresentationIndex(pres).entries.get('a1')?.length, 1)
    // Unmount the opener's owner; the next pass frees the record.
    app.feed.child = null
    pres.structureCache = undefined
    collectEntries(pres)
    assert.equal(pres.entries.size, 0)
  })
})

/**
 * The shape of the sweep bug for state openers: one provider `useState` (a composer sheet), a
 * button on each of two screens that both end in it. Screen A is focused; B stays mounted.
 */
function composerApp(options: { focused?: 'A' | 'B'; guard?: boolean; second?: boolean } = {}) {
  const Provider = function Provider() {}
  const Fab = function Fab() {}
  const FeedScreen = function FeedScreen() {}
  const ProfileScreen = function ProfileScreen() {}
  const Screen = function Screen() {}
  const App = function App() {}
  const focusedName = options.focused ?? 'A'
  const updates: Array<(value: unknown) => unknown> = []
  const stack = (owner: string) => ({ stack: `at ${owner} (address at http://localhost:8081/index.bundle:10:5)` })
  const press = () => {}
  const feedFab = presFiber(Fab, { onPress: press, enabled: options.guard ?? true }, [], { _debugStack: stack('FeedScreen') })
  const extraFab = presFiber(Fab, { onPress: press }, [], { _debugStack: stack('FeedScreenSecond') })
  const profileFab = presFiber(Fab, { onPress: press }, [], { _debugStack: stack('ProfileScreen') })
  const feed = presFiber(FeedScreen, { enabled: options.guard ?? true }, options.second ? [feedFab, extraFab] : [feedFab])
  const profile = presFiber(ProfileScreen, {}, [profileFab])
  const route = (name: string, kids: any[]) =>
    presFiber(Screen, { route: { name }, navigation: { isFocused: () => name === focusedName } }, kids)
  const screenA = route('A', [feed])
  const screenB = route('B', [profile])
  const provider = presFiber(Provider, {}, [screenA, screenB], {
    memoizedState: { memoizedState: undefined, next: null }
  })
  const root = presFiber(App, {}, [provider])
  const binding = { id: 'b1', index: 0, kind: 'useState', site: 's1', fiber: provider, setter: (update: (value: unknown) => unknown) => updates.push(update) }
  const act = (id: string, owner: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: 'ComposePost',
    owner,
    component: 'Fab',
    prop: 'onPress',
    effect: { kind: 'state', site: 's1', path: [], value: { open: true } },
    ...extra
  })
  const states = [{ id: 's1', owner: 'Provider' }]
  return { root, provider, binding, updates, feed, profile, feedFab, extraFab, profileFab, act, states }
}

/** What the host's source join does: attach each record whose creation stack names `owner`. */
function bindEntries(pres: any, ids: Record<string, string>): void {
  pres.entries.forEach((record: any) => {
    for (const [owner, id] of Object.entries(ids)) {
      if (String(record.stack).includes(`at ${owner} `)) record.actions.add(id)
    }
  })
  pres.structureCache = undefined
}

test('a state opener with no entry bound to a live fiber is refused, so a failed join captures nothing', () => {
  const app = composerApp()
  withFiberRoot(app.root, () => {
    const pres = agentCreatePresentations(globalThis, DEFAULT_AGENT_LIMITS, [])
    pres.catalog = { states: app.states, actions: [app.act('a1', 'FeedScreen'), app.act('a2', 'ProfileScreen')] }
    pres.bindings.set('b1', app.binding)
    // The hook binding is live and unambiguous, which is all the old resolver asked for.
    const listed = agentPresentationList(pres)
    assert.deepEqual(listed.available, [])
    assert.deepEqual(listed.rejected, { unbound: 2 })
    const refused = agentPresentationOpen(pres, 'a1', null)
    assert.equal(refused.ok, false)
    assert.equal(refused.reason, 'unbound')
    assert.equal(pres.undo.length, 0)
    assert.equal(app.updates.length, 0, 'the setter was never called')
  })
})

test('a state opener opens only on the screen that renders it, and pushes one undo frame that guards a queued update', () => {
  const app = composerApp()
  withFiberRoot(app.root, () => {
    const pres = agentCreatePresentations(globalThis, DEFAULT_AGENT_LIMITS, [])
    pres.catalog = { states: app.states, actions: [app.act('a1', 'FeedScreen'), app.act('a2', 'ProfileScreen')] }
    pres.bindings.set('b1', app.binding)
    collectEntries(pres)
    bindEntries(pres, { FeedScreen: 'a1', ProfileScreen: 'a2' })

    const listed = agentPresentationList(pres)
    assert.deepEqual(listed.available, [{ id: 'a1', kind: 'state' }], 'both reach one hook; only A is on screen')
    assert.deepEqual(listed.rejected, { 'not-in-view': 1 })
    assert.deepEqual(listed.kinds, { state: 1 })
    assert.equal(agentPresentationOpen(pres, 'a2', null).reason, 'not-in-view')
    assert.equal(app.updates.length, 0)

    const opened = agentPresentationOpen(pres, 'a1', null)
    assert.equal(opened.ok, true)
    assert.equal(opened.kind, 'state')
    assert.equal(pres.undo.length, 1)
    assert.equal(pres.undo[0].value, undefined)
    assert.equal(pres.undo[0].nativeDismiss, true)
    assert.equal(app.updates.length, 1)
    assert.deepEqual(app.updates[0]!(undefined), { open: true })
    assert.equal(app.updates[0]!('something the app queued'), 'something the app queued')

    let rolled: any
    agentPresentationRollback(pres, 0, false, (value: unknown) => { rolled = value })
    assert.equal(rolled.ok, true)
    assert.equal(app.updates.length, 2)
  })
})

test('the same openers resolve on the other screen once it is focused', () => {
  const app = composerApp({ focused: 'B' })
  withFiberRoot(app.root, () => {
    const pres = agentCreatePresentations(globalThis, DEFAULT_AGENT_LIMITS, [])
    pres.catalog = { states: app.states, actions: [app.act('a1', 'FeedScreen'), app.act('a2', 'ProfileScreen')] }
    pres.bindings.set('b1', app.binding)
    collectEntries(pres)
    bindEntries(pres, { FeedScreen: 'a1', ProfileScreen: 'a2' })
    assert.deepEqual(agentPresentationList(pres).available, [{ id: 'a2', kind: 'state' }])
  })
})

test('two openers on one screen that write the same state are listed once', () => {
  const app = composerApp({ second: true })
  withFiberRoot(app.root, () => {
    const pres = agentCreatePresentations(globalThis, DEFAULT_AGENT_LIMITS, [])
    // Both sit under FeedScreen, so one owner holds two openers whose callback is the same function.
    pres.catalog = { states: app.states, actions: [app.act('a1', 'FeedScreen'), app.act('a3', 'FeedScreen')] }
    pres.bindings.set('b1', app.binding)
    collectEntries(pres)
    bindEntries(pres, { FeedScreen: 'a1', FeedScreenSecond: 'a3' })
    const listed = agentPresentationList(pres)
    assert.deepEqual(listed.available, [{ id: 'a1', kind: 'state' }])
    assert.equal(listed.aliased, 1, 'the second opener reaches the destination the first already does')
    assert.deepEqual(listed.rejected, {})
  })
})

test('a state opener is refused when its state already holds the value, needs opener data, or fails its guard', () => {
  const app = composerApp()
  withFiberRoot(app.root, () => {
    const pres = agentCreatePresentations(globalThis, DEFAULT_AGENT_LIMITS, [])
    pres.catalog = {
      states: app.states,
      actions: [
        app.act('a1', 'FeedScreen'),
        app.act('a4', 'FeedScreen', { input: { value: { expr: 'x' }, when: { expr: 'y' }, locals: [] } }),
        app.act('a5', 'FeedScreen', { guard: { prop: ['enabled'] }, effect: { kind: 'state', site: 's1', path: [], value: { open: 'other' } } })
      ]
    }
    pres.bindings.set('b1', app.binding)
    collectEntries(pres)
    bindEntries(pres, { FeedScreen: 'a1' })
    pres.entries.forEach((record: any) => { record.actions.add('a4'); record.actions.add('a5') })
    pres.structureCache = undefined
    // a1 opens; a4 would need the opener's own argument; a5's guard holds (enabled is true).
    const first = agentPresentationList(pres)
    assert.deepEqual(first.available.map((entry: any) => entry.id), ['a1', 'a5'])
    assert.equal(first.rejected.unsupported, 1)

    app.feed.memoizedProps = { enabled: false }
    pres.structureCache = undefined
    const guarded = agentPresentationList(pres)
    assert.equal(guarded.rejected['unmet-condition'], 1, 'a5 no longer holds')

    app.feed.memoizedProps = { enabled: true }
    app.provider.memoizedState = { memoizedState: { open: true }, next: null }
    pres.structureCache = undefined
    assert.equal(agentPresentationList(pres).rejected['already-open'], 2)
  })
})

test('a state opener needs one distinct callback, and a state declared by its own owner binds inside it', () => {
  const app = composerApp({ second: true })
  withFiberRoot(app.root, () => {
    const pres = agentCreatePresentations(globalThis, DEFAULT_AGENT_LIMITS, [])
    pres.catalog = { states: app.states, actions: [app.act('a1', 'FeedScreen')] }
    pres.bindings.set('b1', app.binding)
    collectEntries(pres)
    bindEntries(pres, { FeedScreen: 'a1', FeedScreenSecond: 'a1' })
    const first = () => Object.assign(() => {}, {})
    const named = function openComposer() {}
    app.feedFab.memoizedProps = { onPress: first() }
    app.extraFab.memoizedProps = { onPress: named }
    pres.structureCache = undefined
    assert.equal(agentPresentationList(pres).rejected['ambiguous-callback'], 1)
    // A named handler breaks the tie, as the reference does.
    pres.catalog = { states: app.states, actions: [app.act('a1', 'FeedScreen', { handler: 'openComposer' })] }
    pres.structureCache = undefined
    assert.deepEqual(agentPresentationList(pres).available, [{ id: 'a1', kind: 'state' }])

    // The site is declared by the action's own owner: a binding above that owner is not its own.
    pres.catalog = { states: [{ id: 's1', owner: 'FeedScreen' }], actions: [app.act('a1', 'FeedScreen', { handler: 'openComposer' })] }
    pres.structureCache = undefined
    assert.equal(agentPresentationList(pres).rejected['no-binding'], 1)
  })
})

test('a source join failing mid-pass leaves every entry unplaced and every state refused', () => {
  const app = composerApp()
  withFiberRoot(app.root, () => {
    const pres = agentCreatePresentations(globalThis, DEFAULT_AGENT_LIMITS, [])
    pres.catalog = { states: app.states, actions: [app.act('a1', 'FeedScreen')] }
    pres.bindings.set('b1', app.binding)
    const reply = collectEntries(pres)
    assert.ok(reply.unbound.some((entry: any) => entry.kind === 'entry'))
    assert.equal(reply.entriesMatched, 0)
    assert.deepEqual(agentPresentationList(pres).available, [])
  })
})

/** A controller whose close removes (or fails to remove) the sheet content from the tree. */
function dismissalApp(closes: boolean, sheetSize: number) {
  const Sheet = function Sheet() {}
  const App = function App() {}
  const Row = function Row() {}
  const base = [presFiber(Row, {}), presFiber(Row, {})]
  const sheet = Array.from({ length: sheetSize }, () => presFiber(Sheet, {}))
  const root = presFiber(App, {}, [...base, ...sheet])
  const control: any = {
    open() {},
    close() {
      if (!closes) return
      for (const fiber of sheet) {
        fiber.return = null
      }
      // Rebuild the sibling chain without the sheet.
      root.child = base[0]
      base[0].sibling = base[1]
      base[1].sibling = null
    }
  }
  return { root, control, baseline: 1 + base.length }
}

test('a control dismissal is confirmed by the sheet leaving the tree, not by the controller still looking like one', async () => {
  const app = dismissalApp(true, 6)
  await withFiberRoot(app.root, async () => {
    const pres = agentCreatePresentations(globalThis, DEFAULT_AGENT_LIMITS, [])
    pres.undo.push({ control: app.control, close: 'close', baseline: app.baseline })
    const started = Date.now()
    const rolled: any = await new Promise(resolve => agentPresentationRollback(pres, 0, true, resolve))
    assert.equal(rolled.ok, true, 'the controller shape never changes, so only the tree can confirm this')
    assert.equal(rolled.evidence, 'tree')
    assert.equal(pres.undo.length, 0)
    assert.ok(Date.now() - started < 1500, 'a confirmed close returns at once rather than at the deadline')
  })
})

test('a control dismissal that never takes the sheet away still fails, so the sweep latch stays meaningful', async () => {
  const app = dismissalApp(false, 6)
  await withFiberRoot(app.root, async () => {
    const pres = agentCreatePresentations(globalThis, DEFAULT_AGENT_LIMITS, [])
    pres.undo.push({ control: app.control, close: 'close', baseline: app.baseline })
    const rolled: any = await new Promise(resolve => agentPresentationRollback(pres, 0, true, resolve))
    assert.equal(rolled.ok, false)
    assert.match(String(rolled.error), /has not finished/)
    assert.equal(pres.undo.length, 1, 'the checkpoint is kept so the close can be retried')
  })
})

/**
 * A mount preview projects from the focused leaf route. The tree's first fiber is the HostRoot,
 * which has no `View` above it, so projecting from there refused every mount on every screen.
 */
function mountApp(options: { focus?: boolean } = {}) {
  const View = function View() {}
  const Modal = function Modal() {}
  const Preview = function Preview() {}
  const Screen = function Screen() {}
  const App = function App() {}
  const react = {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props: { ...(props as object), children }, key: null }),
    useState() {},
    useReducer() {},
    Fragment: Symbol('fragment'),
    Component: class {}
  }
  const native = { Platform: { OS: 'ios' }, StyleSheet: { create: (value: unknown) => value }, View, Modal }
  const route = presFiber(
    Screen,
    { route: { name: 'Profile' }, navigation: { isFocused: () => options.focus ?? true } },
    []
  )
  const container = presFiber(View, {}, [route])
  const host = presFiber(App, { children: { type: react.Fragment, key: null, props: { children: [] } } }, [container])
  const overrides: unknown[] = []
  const modules = new Map<number, unknown>([
    [1, { isInitialized: true, publicModule: { exports: react } }],
    [2, { isInitialized: true, publicModule: { exports: native } }],
    [3, { isInitialized: true, verboseName: 'src/Preview.tsx', publicModule: { exports: Object.defineProperty({}, 'Preview', { value: Preview }) } }]
  ])
  return { View, host, route, container, modules, overrides, mounted: Preview }
}

test('a mount preview projects from the focused route, not from the HostRoot', () => {
  const app = mountApp()
  const holder = globalThis as { __r?: unknown; __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }
  const previousR = holder.__r
  try {
    holder.__r = { getModules: () => app.modules }
    withFiberRoot(app.host, () => {
      const hook = holder.__REACT_DEVTOOLS_GLOBAL_HOOK__ as { renderers: Map<number, object> }
      hook.renderers.set(1, { rendererPackageName: 'react-native-renderer', overrideProps: (_root: unknown, _path: unknown, next: unknown) => app.overrides.push(next) })
      const pres = agentCreatePresentations(globalThis, DEFAULT_AGENT_LIMITS, [])
      pres.catalog = {
        states: [],
        actions: [{ id: 'm1', name: 'Preview', owner: 'Preview', component: 'Preview', prop: '', preview: true, effect: { kind: 'mount', file: 'src/Preview.tsx', export: 'Preview' } }]
      }
      const tree = agentPresentationIndex(pres)
      assert.equal(agentProjectionRoot(pres, tree.all[0]), null, 'the HostRoot has no View ancestor')
      assert.ok(agentProjectionRoot(pres, app.route), 'the focused route sits inside one')
      const opened = agentPresentationOpen(pres, 'm1', null)
      assert.equal(opened.ok, true, String(opened.error))
      assert.equal(opened.kind, 'mount')
      assert.equal(app.overrides.length, 1)
    })
  } finally {
    holder.__r = previousR
  }
})

test('a mount preview of a component the app already renders is refused, not projected again', () => {
  // The reference's `mountedExport` alreadyMounted guard (presentations-runtime.js:1314). Without
  // it an app-wide component — a NUX announcement mounted in the shell — is offered on every
  // screen, and the cold second copy draws nothing because it has none of the live provider state.
  const app = mountApp()
  const holder = globalThis as { __r?: unknown; __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }
  const previousR = holder.__r
  try {
    holder.__r = { getModules: () => app.modules }
    // Put the very component the preview would project into the live tree.
    const live = presFiber(app.mounted, {}, [])
    app.route.child = live
    live.return = app.route
    withFiberRoot(app.host, () => {
      const pres = agentCreatePresentations(globalThis, DEFAULT_AGENT_LIMITS, [])
      pres.catalog = {
        states: [],
        actions: [{ id: 'm1', name: 'Preview', owner: 'Preview', component: 'Preview', prop: '', preview: true, effect: { kind: 'mount', file: 'src/Preview.tsx', export: 'Preview' } }]
      }
      const opened = agentPresentationOpen(pres, 'm1', null)
      assert.equal(opened.ok, false)
      assert.equal(opened.reason, 'already-mounted')
      assert.equal(pres.projected.length, 0, 'nothing was projected')
      assert.equal(app.overrides.length, 0)
    })
  } finally {
    holder.__r = previousR
  }
})

test('a mount preview whose export is not the named component is refused', () => {
  // The reference's ownerMismatch guard (presentations-runtime.js:1313).
  const app = mountApp()
  const holder = globalThis as { __r?: unknown; __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }
  const previousR = holder.__r
  try {
    holder.__r = { getModules: () => app.modules }
    withFiberRoot(app.host, () => {
      const pres = agentCreatePresentations(globalThis, DEFAULT_AGENT_LIMITS, [])
      pres.catalog = {
        states: [],
        actions: [{ id: 'm1', name: 'Other', owner: 'SomethingElse', component: 'Other', prop: '', preview: true, effect: { kind: 'mount', file: 'src/Preview.tsx', export: 'Preview' } }]
      }
      const opened = agentPresentationOpen(pres, 'm1', null)
      assert.equal(opened.ok, false)
      assert.equal(opened.reason, 'owner-mismatch')
      assert.equal(pres.projected.length, 0)
    })
  } finally {
    holder.__r = previousR
  }
})

test('a mount preview open names the component the host must find drawing', () => {
  const app = mountApp()
  const holder = globalThis as { __r?: unknown; __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }
  const previousR = holder.__r
  try {
    holder.__r = { getModules: () => app.modules }
    withFiberRoot(app.host, () => {
      const hook = holder.__REACT_DEVTOOLS_GLOBAL_HOOK__ as { renderers: Map<number, object> }
      hook.renderers.set(1, { rendererPackageName: 'react-native-renderer', overrideProps: (_root: unknown, _path: unknown, next: unknown) => app.overrides.push(next) })
      const pres = agentCreatePresentations(globalThis, DEFAULT_AGENT_LIMITS, [])
      pres.catalog = {
        states: [],
        actions: [{ id: 'm1', name: 'Preview', owner: 'Preview', component: 'Preview', prop: '', preview: true, effect: { kind: 'mount', file: 'src/Preview.tsx', export: 'Preview' } }]
      }
      const opened = agentPresentationOpen(pres, 'm1', null)
      assert.equal(opened.ok, true, String(opened.error))
      // The reference returns `expected: action.owner` from every open so readiness can refuse a
      // projection that mounted nothing or drew nothing.
      assert.equal(opened.expected, 'Preview')
    })
  } finally {
    holder.__r = previousR
  }
})

test('the content probe separates "not mounted" from "mounted but drawing nothing"', () => {
  const app = mountApp()
  withFiberRoot(app.host, () => {
    const pres = agentCreatePresentations(globalThis, DEFAULT_AGENT_LIMITS, [])
    pres.catalog = { states: [], actions: [] }
    const absent = agentPresentationContent(pres, 'NotHere')
    assert.equal(absent.found, false, 'a component that never mounted')
    assert.equal(absent.visible, 0)
  })
})

test('a mount preview with no single focused route refuses without projecting', () => {
  const app = mountApp({ focus: false })
  const holder = globalThis as { __r?: unknown; __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }
  const previousR = holder.__r
  try {
    holder.__r = { getModules: () => app.modules }
    withFiberRoot(app.host, () => {
      const pres = agentCreatePresentations(globalThis, DEFAULT_AGENT_LIMITS, [])
      pres.catalog = {
        states: [],
        actions: [{ id: 'm1', name: 'Preview', owner: 'Preview', component: 'Preview', prop: '', preview: true, effect: { kind: 'mount', file: 'src/Preview.tsx', export: 'Preview' } }]
      }
      const opened = agentPresentationOpen(pres, 'm1', null)
      assert.equal(opened.ok, false)
      assert.match(String(opened.error), /cannot project/)
      assert.equal(pres.projected.length, 0)
    })
  } finally {
    holder.__r = previousR
  }
})
