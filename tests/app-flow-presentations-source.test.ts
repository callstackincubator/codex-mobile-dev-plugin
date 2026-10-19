import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AppFlowPresentations } from '../src/shared/app-flow.ts'
import { addSourcePreviewPlans } from '../src/app-flow/preview-plans.ts'
import { scanPresentations } from '../src/app-flow/presentations-source.ts'
import { createSourceUnits, createSymbolResolver } from '../src/app-flow/source-units.ts'
import { scanSourceViews } from '../src/app-flow/views-source.ts'

const root = '/app'

/** Parse in-memory fixture files (keys are paths relative to `root`). */
function project(files: Record<string, string>) {
  const units = createSourceUnits(Object.entries(files).map(([file, text]) => ({ file: `${root}/${file}`, text })))
  return { units, symbol: createSymbolResolver(units, { root }) }
}

function presentations(files: Record<string, string>) {
  const { units, symbol } = project(files)
  return scanPresentations(units, root, symbol)
}

/** Everything `scan.ts` assembles before preview plans are compiled. */
function catalog(files: Record<string, string>): AppFlowPresentations {
  const { units, symbol } = project(files)
  const found = scanPresentations(units, root, symbol)
  const views = scanSourceViews(units, root, symbol)
  const result: AppFlowPresentations = { ...found, views: views.views, viewStates: views.states }
  return addSourcePreviewPlans(result)
}

describe('App Flow static presentation discovery', () => {
  it('finds a boolean modal opened by a press, and names the component it reveals', () => {
    const found = presentations({
      'src/Screen.tsx': `
        import { useState } from 'react'
        import { SettingsSheet } from './SettingsSheet'
        export function Screen() {
          const [open, setOpen] = useState(false)
          return <View>
            <Button testID="settings" onPress={() => setOpen(true)} />
            {open && <SettingsSheet />}
          </View>
        }
      `,
      'src/SettingsSheet.tsx': 'export function SettingsSheet() { return <View /> }'
    })
    assert.equal(found.actions.length, 1)
    const [action] = found.actions
    assert.equal(action.name, 'SettingsSheet')
    assert.equal(action.owner, 'Screen')
    assert.equal(action.prop, 'onPress')
    assert.deepEqual(action.trigger, { testID: 'settings' })
    assert.equal(action.effect.kind, 'state')
    assert.deepEqual(action.effect.kind === 'state' ? [action.effect.path, action.effect.value] : null, [[], true])
    // A state site is reported only when an emitted action references it.
    assert.deepEqual(found.states.map(site => site.id), [action.effect.kind === 'state' ? action.effect.site : ''])
    assert.equal(found.states[0].hook, 'useState')
    assert.equal(found.states[0].file, 'src/Screen.tsx')
  })

  it('rejects a condition that gates only text, because no capitalized component is rendered', () => {
    const found = presentations({
      'src/Screen.tsx': `
        import { useState } from 'react'
        export function Screen() {
          const [open, setOpen] = useState(false)
          return <View>
            <Button onPress={() => setOpen(true)} />
            {open && 'Settings are open'}
          </View>
        }
      `
    })
    // The setter folds perfectly; only the missing component body stops it.
    assert.deepEqual(found.actions, [])
    assert.deepEqual(found.states, [])
  })

  it('vetoes a handler that also saves, even though it opens a real sheet', () => {
    const files = (handler: string) => ({
      'src/Screen.tsx': `
        import { useState } from 'react'
        import { SettingsSheet } from './SettingsSheet'
        export function Screen({ saveDraft }) {
          const [open, setOpen] = useState(false)
          return <View>
            <Button onPress={() => { ${handler} }} />
            {open && <SettingsSheet />}
          </View>
        }
      `,
      'src/SettingsSheet.tsx': 'export function SettingsSheet() { return <View /> }'
    })
    assert.equal(presentations(files('setOpen(true)')).actions.length, 1)
    assert.deepEqual(presentations(files('saveDraft(); setOpen(true)')).actions, [])
    assert.deepEqual(presentations(files('deleteAccount(); setOpen(true)')).actions, [])
  })

  it('accepts an imperative controller opened with no arguments, and only then', () => {
    const files = (call: string) => ({
      'src/Screen.tsx': `
        import { useRef } from 'react'
        import { BottomSheet } from './BottomSheet'
        export function Screen() {
          const sheet = useRef(null)
          return <View>
            <Button onPress={() => ${call}} />
            <BottomSheet ref={sheet} />
          </View>
        }
      `,
      'src/BottomSheet.tsx': 'export function BottomSheet() { return <View /> }'
    })
    const opened = presentations(files('sheet.current.open()'))
    assert.equal(opened.actions.length, 1)
    assert.equal(opened.actions[0].effect.kind, 'control')
    assert.deepEqual(opened.actions[0].effect.kind === 'control' ? [opened.actions[0].effect.component, opened.actions[0].effect.prop, opened.actions[0].effect.method] : null, ['BottomSheet', 'ref', 'open'])
    // Data-dependent opening arguments cannot be fabricated.
    assert.deepEqual(presentations(files("sheet.current.open('settings')")).actions, [])
    // Only open/present/show/expand count as opening a presentation.
    assert.deepEqual(presentations(files('sheet.current.refresh()')).actions, [])
  })

  it('leaves useReducer to the view scan, which reads its finite state type', () => {
    const files = {
      'src/Wizard.tsx': `
        import { useReducer } from 'react'
        import { ReviewPanel } from './ReviewPanel'
        import { FormPanel } from './FormPanel'
        type WizardState = { step: 'form' | 'review' }
        function reducer(state: WizardState, action: { type: string }): WizardState { return state }
        export function Wizard() {
          const [state, dispatch] = useReducer(reducer, { step: 'form' })
          return state.step === 'review' ? <ReviewPanel /> : <FormPanel />
        }
      `,
      'src/ReviewPanel.tsx': 'export function ReviewPanel() { return <View /> }',
      'src/FormPanel.tsx': 'export function FormPanel() { return <View /> }'
    }
    // scanPresentations is useState-only, by design: it interprets setter calls,
    // and a dispatch cannot be folded that way.
    assert.deepEqual(presentations(files).states, [])
    const { units, symbol } = project(files)
    const views = scanSourceViews(units, root, symbol)
    const site = views.states.find(state => state.hook === 'useReducer')
    assert.ok(site, 'the useReducer site is catalogued')
    assert.deepEqual(site.paths, [['step']])
    const reviewed = views.views.find(view => view.state?.site === site.id && view.state.value === 'review')
    assert.ok(reviewed, 'the review step is catalogued as a finite state view')
    assert.deepEqual(reviewed.components.map(component => component.component), ['ReviewPanel'])
  })

  it('never previews a protected field, however well its view is formed', () => {
    const guarded = catalog({
      'src/Screen.tsx': `
        import { useState } from 'react'
        import { LoadingPanel } from './LoadingPanel'
        import { ContentPanel } from './ContentPanel'
        export default function Screen() {
          const [loading, setLoading] = useState(false)
          return loading ? <LoadingPanel /> : <ContentPanel />
        }
      `,
      'src/LoadingPanel.tsx': 'export function LoadingPanel() { return <View /> }',
      'src/ContentPanel.tsx': 'export function ContentPanel() { return <View /> }'
    })
    assert.ok(guarded.views?.some(view => view.state), 'the view is still catalogued as evidence')
    assert.deepEqual(guarded.previews?.filter(plan => plan.effect.kind === 'state'), [])

    const allowed = catalog({
      'src/Screen.tsx': `
        import { useState } from 'react'
        import { DetailDialog } from './DetailDialog'
        import { ContentPanel } from './ContentPanel'
        export default function Screen() {
          const [showDialog, setShowDialog] = useState(false)
          return showDialog ? <DetailDialog /> : <ContentPanel />
        }
      `,
      'src/DetailDialog.tsx': 'export function DetailDialog() { return <View /> }',
      'src/ContentPanel.tsx': 'export function ContentPanel() { return <View /> }'
    })
    // Both sides of the ternary are previewable once the selector is allowed.
    assert.deepEqual(allowed.previews?.filter(plan => plan.effect.kind === 'state').map(plan => plan.name).sort(), ['ContentPanel', 'DetailDialog'])
  })

  it('admits a boolean preview by selector name OR by a proven opener, and otherwise not', () => {
    const files = (field: string, opener: boolean) => ({
      'src/Screen.tsx': `
        import { useState } from 'react'
        import { DetailDialog } from './DetailDialog'
        import { ContentPanel } from './ContentPanel'
        export default function Screen() {
          const [${field}, set${field[0].toUpperCase()}${field.slice(1)}] = useState(false)
          ${opener ? `const trigger = <Button onPress={() => set${field[0].toUpperCase()}${field.slice(1)}(true)} />` : ''}
          return ${field} ? <DetailDialog /> : <ContentPanel />
        }
      `,
      'src/DetailDialog.tsx': 'export function DetailDialog() { return <View /> }',
      'src/ContentPanel.tsx': 'export function ContentPanel() { return <View /> }'
    })
    const plans = (field: string, opener: boolean) =>
      catalog(files(field, opener)).previews?.filter(plan => plan.effect.kind === 'state').map(plan => plan.name).sort() ?? []
    // Alternative one: the selector's own name reads like a presentation gate.
    assert.deepEqual(plans('showDialog', false), ['ContentPanel', 'DetailDialog'])
    // Alternative two: the name says nothing, but the press scan proved an
    // opener writes this exact site and path, and this is the render body.
    assert.deepEqual(plans('expanded', true), ['ContentPanel', 'DetailDialog'])
    // Neither: a boolean with an unremarkable name and no proven opener.
    assert.deepEqual(plans('expanded', false), [])
  })
})
