import assert from 'node:assert/strict'
import test from 'node:test'
import { runReachLadder, strategiesFor, touchedDevice, type ReachRungs, type ReachStrategy } from '../src/app-flow/reach/ladder.ts'
import { isToolingFailure } from '../src/app-flow/exploration.ts'
import { agentSource } from '../src/app-flow/cdp/runtime-source.ts'
import {
  agentCollectLinks,
  agentLinkCandidate,
  agentNavigate,
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
    deepLinkJudgeMode: 'on',
    stateCaptureMode: 'off'
  })
})

test('state capture is opt-in and off by default, and a bad literal is rejected', () => {
  // Off by default in *every* mode, auto included — the state pass used to run unconditionally
  // outside Fast, and this is the line that records the change.
  for (const explorationMode of ['auto', 'fast', 'thorough'] as const) {
    const resolved = resolveAppFlowStart({ projectPath: '/project', explorationMode })
    assert.equal(resolved.stateCaptureMode, 'off')
  }
  const on = parseAppFlowStartRequest({ projectPath: '/project', stateCaptureMode: 'on' })
  assert.equal(on.ok, true)
  if (on.ok) assert.equal(resolveAppFlowStart(on.input).stateCaptureMode, 'on')
  // Rejected rather than coerced to the default, like every other literal crossing the boundary:
  // a caller that asked for state capture and silently did not get it is the worse outcome.
  const bad = parseAppFlowStartRequest({ projectPath: '/project', stateCaptureMode: 'yes' })
  assert.equal(bad.ok, false)
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
  // Opting Fast into the state pass puts `state-trigger` and a real arrival judgement back on
  // every hinted route, so that run does need a provider — and an explicit `off`, or an absent
  // option, leaves Fast exactly where it was.
  assert.equal(requiresDecisionProvider('screen-ui-and-structure', 'fast', 'on'), true)
  assert.equal(requiresDecisionProvider('screen-ui-and-structure', 'fast', 'off'), false)
  assert.equal(requiresDecisionProvider('screen-ui-and-structure', 'fast', undefined), false)
  // A structure-only build runs no sweep at all, so the option cannot make it need one.
  assert.equal(requiresDecisionProvider('structure-only', 'fast', 'on'), false)
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

test('the packaged Fast agent carries the link harvest and its integrity guard counts it', () => {
  const source = agentSource()
  assert.match(source, /function agentCollectLinks/)
  assert.match(source, /type === 'links'/)
  assert.equal(Object.keys(AGENT_FUNCTIONS).length, EXPECTED_AGENT_FUNCTION_COUNT)
})
