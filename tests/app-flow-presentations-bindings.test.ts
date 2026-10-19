import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AppFlowPresentationAction, AppFlowStateSite } from '../src/shared/app-flow.ts'
import { bindPresentationSites } from '../src/app-flow/presentations-bindings.ts'
import type { AppFlowPresentationBinding } from '../src/app-flow/presentations-bindings.ts'

const root = '/app'
const metroOrigin = 'http://localhost:8081'
const bundle = `${metroOrigin}/index.bundle`

function state(site: Partial<AppFlowStateSite> & { id: string }): AppFlowStateSite {
  return { file: 'src/Screen.tsx', line: 1, column: 0, endLine: 1, endColumn: 80, owner: 'Screen', paths: [], ...site }
}

/** A `/symbolicate` stub: maps each posted frame through `map`, recording batches. */
function metro(map: (frame: { lineNumber: number; column: number }, index: number) => unknown) {
  const batches: { lineNumber: number; column: number }[][] = []
  const fetch = (async (_url: unknown, init?: { body?: string }) => {
    const sent = JSON.parse(String(init?.body)).stack as { lineNumber: number; column: number }[]
    batches.push(sent)
    return { ok: true, json: async () => ({ stack: sent.map(map) }) }
  }) as unknown as typeof globalThis.fetch
  return { fetch, batches }
}

/** Every posted frame resolves to the same project location. */
const at = (line: number, column = 4) => () => ({ file: `${root}/src/Screen.tsx`, lineNumber: line, column })

describe('App Flow presentation binding symbolication', () => {
  it('parses both stack frame formats and resolves each against Metro', async () => {
    const bindings: AppFlowPresentationBinding[] = [
      { id: 'a', owner: 'Screen', stack: `    at Screen (${bundle}:10:21)` },
      { id: 'b', owner: 'Screen', stack: `Screen@${bundle}:11:31` },
    ]
    const sites = [state({ id: 'first', line: 5, column: 0, endLine: 5, endColumn: 40 }), state({ id: 'second', line: 6, column: 0, endLine: 6, endColumn: 40 })]
    const { fetch, batches } = metro((frame, index) => ({ file: `${root}/src/Screen.tsx`, lineNumber: index === 0 ? 5 : 6, column: 4 }))
    const matches = await bindPresentationSites(root, bindings, { states: sites, actions: [] }, { metroOrigin, fetch })
    assert.deepEqual(batches[0], [
      { file: bundle, methodName: 'Screen', lineNumber: 10, column: 20 },
      { file: bundle, methodName: 'Screen', lineNumber: 11, column: 30 },
    ])
    assert.deepEqual(matches, [{ binding: 'a', site: 'first' }, { binding: 'b', site: 'second' }])
  })

  it('ignores frames served from another origin', async () => {
    const bindings: AppFlowPresentationBinding[] = [{
      id: 'a',
      owner: 'Screen',
      stack: [`    at Other (https://cdn.example.com/bundle.js:3:4)`, `    at Screen (${bundle}:10:5)`].join('\n'),
    }]
    const { fetch, batches } = metro(at(5))
    const matches = await bindPresentationSites(root, bindings, { states: [state({ id: 'first', line: 5, endLine: 5 })], actions: [] }, { metroOrigin, fetch })
    assert.deepEqual(batches, [[{ file: bundle, methodName: 'Screen', lineNumber: 10, column: 4 }]])
    assert.deepEqual(matches, [{ binding: 'a', site: 'first' }])
  })

  it('reads at most sixteen frames per binding', async () => {
    const stack = Array.from({ length: 24 }, (_, index) => `    at Frame${index} (${bundle}:${index + 1}:1)`).join('\n')
    const { fetch, batches } = metro(() => undefined)
    await bindPresentationSites(root, [{ id: 'a', owner: 'Screen', stack }], { states: [], actions: [] }, { metroOrigin, fetch })
    assert.equal(batches[0].length, 16)
  })

  it('symbolicates in batches of one hundred and twenty frames', async () => {
    const bindings = Array.from({ length: 300 }, (_, index): AppFlowPresentationBinding => ({
      id: `b${index}`, owner: 'Screen', stack: `    at Screen (${bundle}:${index + 1}:1)`,
    }))
    const { fetch, batches } = metro(() => undefined)
    await bindPresentationSites(root, bindings, { states: [], actions: [] }, { metroOrigin, fetch })
    assert.deepEqual(batches.map(batch => batch.length), [120, 120, 60])
  })

  it('binds a hook whose resolved position falls inside one state range', async () => {
    const sites = [
      state({ id: 'inside', line: 4, column: 10, endLine: 4, endColumn: 30 }),
      state({ id: 'elsewhere', line: 9, column: 0, endLine: 9, endColumn: 30 }),
    ]
    const { fetch } = metro(at(4, 12))
    const matches = await bindPresentationSites(root, [{ id: 'a', owner: 'Screen', stack: `    at Screen (${bundle}:1:1)` }], { states: sites, actions: [] }, { metroOrigin, fetch })
    assert.deepEqual(matches, [{ binding: 'a', site: 'inside' }])
  })

  it('binds nothing when two state sites cover the same position', async () => {
    const sites = [
      state({ id: 'outer', line: 4, column: 0, endLine: 6, endColumn: 30 }),
      state({ id: 'inner', line: 4, column: 0, endLine: 4, endColumn: 30 }),
    ]
    const { fetch } = metro(at(4, 12))
    const matches = await bindPresentationSites(root, [{ id: 'a', owner: 'Screen', stack: `    at Screen (${bundle}:1:1)` }], { states: sites, actions: [] }, { metroOrigin, fetch })
    assert.deepEqual(matches, [])
  })

  it('keeps the first resolution when a later frame also matches a site', async () => {
    const stack = [`    at Screen (${bundle}:10:1)`, `    at Parent (${bundle}:20:1)`].join('\n')
    const sites = [state({ id: 'first', line: 4, column: 0, endLine: 4, endColumn: 30 }), state({ id: 'second', line: 8, column: 0, endLine: 8, endColumn: 30 })]
    const { fetch } = metro((_frame, index) => ({ file: `${root}/src/Screen.tsx`, lineNumber: index === 0 ? 4 : 8, column: 4 }))
    const matches = await bindPresentationSites(root, [{ id: 'a', owner: 'Screen', stack }], { states: sites, actions: [] }, { metroOrigin, fetch })
    assert.deepEqual(matches, [{ binding: 'a', site: 'first' }])
  })

  it('considers at most three thousand bindings', async () => {
    const bindings = Array.from({ length: 3100 }, (_, index): AppFlowPresentationBinding => ({
      id: `b${index}`, owner: 'Screen', source: { file: `${root}/src/Screen.tsx`, line: 4, column: 4 },
    }))
    const sites = [state({ id: 'only', line: 4, column: 0, endLine: 4, endColumn: 30 })]
    const matches = await bindPresentationSites(root, bindings, { states: sites, actions: [] }, { metroOrigin, fetch: (() => { throw new Error('unused') }) as unknown as typeof globalThis.fetch })
    assert.equal(matches.length, 3000)
    assert.equal(matches.at(-1)?.binding, 'b2999')
  })

  it('degrades to no bindings when Metro cannot symbolicate', async () => {
    const failing = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof globalThis.fetch
    const refusing = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof globalThis.fetch
    const sites = [state({ id: 'only', line: 4, column: 0, endLine: 4, endColumn: 30 })]
    const binding: AppFlowPresentationBinding[] = [{ id: 'a', owner: 'Screen', stack: `    at Screen (${bundle}:1:1)` }]
    assert.deepEqual(await bindPresentationSites(root, binding, { states: sites, actions: [] }, { metroOrigin, fetch: failing }), [])
    assert.deepEqual(await bindPresentationSites(root, binding, { states: sites, actions: [] }, { metroOrigin, fetch: refusing }), [])
  })

  it('binds a JSX entry to its owning press action, and only to the first project frame', async () => {
    const action: AppFlowPresentationAction = {
      id: 'action-1', file: 'src/Screen.tsx', line: 12, owner: 'Screen', component: 'Button', prop: 'onPress', name: 'open',
      source: { line: 12, column: 4, endLine: 12, endColumn: 60 },
      effect: { kind: 'state', site: 'only', path: ['open'], value: true },
    }
    const stack = [`    at Button (${bundle}:1:1)`, `    at Screen (${bundle}:2:1)`].join('\n')
    const { fetch } = metro((_frame, index) => ({ file: `${root}/src/Screen.tsx`, lineNumber: index === 0 ? 12 : 20, column: 10 }))
    const matches = await bindPresentationSites(root, [{ id: 'e', owner: 'Screen', kind: 'entry', stack }], { states: [], actions: [action] }, { metroOrigin, fetch })
    assert.deepEqual(matches, [{ binding: 'e', site: 'action-1' }])
  })

  it('leaves portal bindings unresolved until the source analysers are supplied', async () => {
    const binding: AppFlowPresentationBinding[] = [{ id: 'p', owner: 'Portal', kind: 'portal', stack: `    at Portal (${bundle}:1:1)` }]
    const { fetch } = metro(at(7, 2))
    assert.deepEqual(await bindPresentationSites(root, binding, { states: [], actions: [] }, { metroOrigin, fetch }), [])
    const matches = await bindPresentationSites(root, binding, { states: [], actions: [] }, {
      metroOrigin, fetch,
      readSource: async file => (file === `${root}/src/Screen.tsx` ? 'const x = 1' : undefined),
      sourceUiPortal: () => ({ append: 'attach', remove: 'detach' }),
    })
    assert.deepEqual(matches, [{ binding: 'p', site: 'portal:attach:detach' }])
  })
})
