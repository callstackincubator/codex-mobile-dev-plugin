import assert from 'node:assert/strict';
import test from 'node:test';
import { compareViewReference } from '../scripts/lib/compare-app-flow-views.mjs';

const control = (file = 'Screen.tsx', component = 'Basic', prop = 'control') => ({
  id: `${file}:${component}:${prop}`, file, line: 10, owner: 'Screen', name: component,
  effect: { kind: 'control', component, prop, method: 'open', close: ['close'] },
});
const target = (line, component = 'Basic', file = 'Prompt.tsx') => ({
  file: 'Screen.tsx', line, owner: 'Screen', generic: true, prop: 'control', definition: { file, component },
});
const graph = (actions, states = [], nodes = [], edges = []) => ({ nodes, edges, presentations: { actions, states } });
const row = (id, selectors, extra = {}) => ({ id, label: id, category: 'sheet', selectors, ...extra });

test('separate generic prompts cannot both claim one collapsed control destination', () => {
  const result = compareViewReference(graph([control()]), { views: [
    row('delete', [{ control: { file: 'Screen.tsx', line: 30 } }]),
    row('hide', [{ control: { file: 'Screen.tsx', line: 50 } }]),
  ] }, () => [target(30), target(50)]);
  assert.equal(result.matchedViews, 0);
  assert.equal(result.presentationDestinations, 1);
  assert.deepEqual(result.rows.map(item => item.status), ['ambiguous', 'ambiguous']);
  assert.deepEqual(result.collisions[0].views, ['delete', 'hide']);
});

test('shared body aliases and repeated openers count as one reviewed view', () => {
  const first = control(), second = { ...first, id: 'second', line: 20 };
  const result = compareViewReference(graph([first, second]), { views: [row('shared', [
    { control: { file: 'Screen.tsx', line: 30 } }, { control: { file: 'Screen.tsx', line: 50 } },
  ])] }, () => [target(30), target(50)]);
  assert.equal(result.matchedViews, 1);
  assert.equal(result.rawPresentationActions, 2);
  assert.equal(result.presentationDestinations, 1);
});

test('finding a shared container does not prove a nested reducer state', () => {
  const action = control('Screen.tsx', 'Editor');
  const result = compareViewReference(graph([action]), { views: [row('token-form', [
    { state: { file: 'Email.tsx', line: 42, path: ['step'], value: 'token' } },
  ], { containers: [{ control: { file: 'Editor.tsx', component: 'Editor' } }] })] }, () => [target(30, 'Editor', 'Editor.tsx')]);
  assert.equal(result.rows[0].status, 'container-only');
  assert.equal(result.matchedViews, 0);
});

test('finite state matches source identity, path and value; inferred names do not count', () => {
  const action = { ...control(), name: 'AllForms', effect: { kind: 'state', site: 's', path: ['step'], value: 0 } };
  const site = { id: 's', file: 'Form.tsx', line: 12 };
  const selectors = value => [{ state: { file: 'Form.tsx', line: 12, path: ['step'], value } }];
  const result = compareViewReference(graph([action], [site]), { views: [row('first', selectors(0)), row('second', selectors(1)),
    row('other-owner', [{ state: { file: 'Other.tsx', line: 12, path: ['step'], value: 0 } }]) ] }, () => []);
  assert.deepEqual(result.rows.map(item => item.status), ['matched', 'missing', 'missing']);
});

test('a route registration alone is not a reviewed access path', () => {
  const nodes = [{ id: 'a', name: 'Home', entry: true }, { id: 'b', name: 'Detail' }];
  const reference = { views: [row('home', [{ route: 'Home' }], { category: 'route', access: 'entry' }),
    row('detail', [{ route: 'Detail' }], { category: 'route', access: 'ui', parents: ['Home'] })] };
  const registered = compareViewReference(graph([], [], nodes), reference, () => []);
  assert.deepEqual(registered.rows.map(item => item.status), ['matched', 'missing']);
  const linked = compareViewReference(graph([], [], nodes, [{ from: 'a', to: 'b', kind: 'navigation' }]), reference, () => []);
  assert.equal(linked.matchedViews, 2);
});

test('distinct props on a shared wrapper retain distinct destinations', () => {
  const first = control('Screen.tsx', 'Alerts', 'chatControl'), second = control('Screen.tsx', 'Alerts', 'requestControl');
  const selectors = prop => [{ control: { file: 'Alerts.tsx', component: 'Alerts', prop } }];
  const result = compareViewReference(graph([first, second]), { views: [row('chat', selectors('chatControl')), row('requests', selectors('requestControl'))] }, action => [
    { ...target(30, 'Alerts', 'Alerts.tsx'), prop: action.effect.prop },
  ]);
  assert.equal(result.matchedViews, 2);
  assert.equal(result.collisions.length, 0);
});


test('exported body preview plans retain their exact source identity and entry',()=>{
  const view={id:'body',kind:'component',file:'Guard.tsx',owner:'BlockedPage',entries:[{file:'App.tsx',line:8}]};
  const preview={id:'preview',file:'Guard.tsx',owner:'BlockedPage',preview:true,views:['body','unknown'],effect:{kind:'mount',file:'Guard.tsx',export:'BlockedPage'}};
  const source={nodes:[],edges:[],presentations:{actions:[],states:[],previews:[preview],views:[view]}};
  const reference={views:[row('blocked',[{component:{file:'Guard.tsx',name:'BlockedPage',entry:{file:'App.tsx',line:8}}}]),
    row('other-entry',[{component:{file:'Guard.tsx',name:'BlockedPage',entry:{file:'App.tsx',line:20}}}])]};
  const result=compareViewReference(source,reference,()=>[]);
  assert.equal(result.previewPlannedViews,1);assert.equal(result.rows[0].coverage,'preview');
  assert.equal(result.rows[1].status,'missing');assert.equal(result.collisions.length,0);
});


import {assertCaptureProvenance} from '../scripts/lib/compare-app-flow-capture.mjs';

test('capture evidence rejects another build and unfinished restoration',()=>{
  const run={pluginVersion:'test-build',phase:'complete',startedAt:10,finishedAt:20};
  assert.doesNotThrow(()=>assertCaptureProvenance(run,'test-build'));
  assert.throws(()=>assertCaptureProvenance(run,'other-build'),/plugin version differs/);
  for(const changed of [{pluginVersion:undefined},{phase:'finishing'},{finishedAt:undefined},{finishedAt:9}])assert.throws(()=>assertCaptureProvenance({...run,...changed},'test-build'));
  assert.doesNotThrow(()=>assertCaptureProvenance({...run,phase:'stopped'},'test-build'),'A stopped partial run is valid evidence, with its status retained');
});

test('a generic boundary matches either source name of a wrapped owner', () => {
  const view = { id: 'v', kind: 'control', file: 'Notice.tsx', line: 12, owner: 'NoticeInner',
    components: [{ file: 'Sheet.tsx', component: 'Outer' }], control: { component: 'Outer', prop: 'control', boundary: true, generic: true } };
  const source = { nodes: [], edges: [], presentations: { actions: [], states: [], views: [view] } };
  const reference = { views: [row('notice', [{ control: { file: 'Notice.tsx', component: 'Notice' } }])] };
  assert.equal(compareViewReference(source, reference, () => []).rows[0].status, 'missing');
  const aliases = (file, owner) => file === 'Notice.tsx' && owner === 'NoticeInner' ? ['NoticeInner', 'Notice'] : [];
  assert.equal(compareViewReference(source, reference, () => [], aliases).rows[0].status, 'matched');
  const other = { views: [row('other', [{ control: { file: 'Other.tsx', component: 'Notice' } }])] };
  assert.equal(compareViewReference(source, other, () => [], aliases).rows[0].status, 'missing', 'An alias never crosses files');
});

import {compareFlowCapture} from '../scripts/lib/compare-app-flow-capture.mjs';

test('a child capture never credits an ancestor view that is still mounted', () => {
  const step = (id, site, value, views) => ({ id, file: 'Wizard.tsx', line: 5, owner: 'Wizard', name: id, preview: true, views,
    effect: { kind: 'state', site, path: ['step'], value } });
  const actions = [step('open', 'outer', 'form', ['outer-view']), step('next', 'inner', 2, ['inner-view'])];
  const views = [{ id: 'outer-view', kind: 'state', state: { site: 'outer', path: ['step'], value: 'form' } },
    { id: 'inner-view', kind: 'state', state: { site: 'inner', path: ['step'], value: 2 } }];
  const graph = { sourceHash: 'h', nodes: [], edges: [], presentations: { actions: [], previews: actions, states: [
    { id: 'outer', file: 'Wizard.tsx', line: 5 }, { id: 'inner', file: 'Form.tsx', line: 9 }], views } };
  const reference = { views: [row('form', [{ state: { file: 'Wizard.tsx', line: 5, path: ['step'], value: 'form' } }]),
    row('form-step-2', [{ state: { file: 'Form.tsx', line: 9, path: ['step'], value: 2 } }], { parent: 'form' })] };
  const compared = compareViewReference(graph, reference, () => []);
  // Runtime discovery lists every active view, including the outer form.
  const child = { id: 'child', kind: 'screen', status: 'captured', imageSourceHash: 'h', sourceViews: ['inner-view', 'outer-view'],
    presentation: { actions: ['open', 'next'], preview: true } };
  const result = compareFlowCapture(graph, compared, { id: 'run', sourceHash: 'h', nodes: [child] }, new Set(['child']));
  assert.deepEqual(result.rows.map(item => [item.id, item.capture, item.attempts.length]), [['form', 'not-captured', 0], ['form-step-2', 'preview', 1]]);
  const parent = { ...child, id: 'parent', sourceViews: ['outer-view'], presentation: { actions: ['open'], preview: true } };
  const both = compareFlowCapture(graph, compared, { id: 'run', sourceHash: 'h', nodes: [child, parent] }, new Set(['child', 'parent']));
  assert.deepEqual(both.rows.map(item => item.nodeId), ['parent', 'child']);
});

test('a shared prompt shell credits only the caller sites saved with its image', () => {
  const view = (id, file, line, component, owner = 'Caller', boundary = false) => ({ id, name: component, file, owner, line, kind: 'control',
    source: { line, column: 6, endLine: line, endColumn: 40 }, components: [{ file: 'Prompt.tsx', component }], control: { component, prop: 'control', boundary, generic: false } });
  const shell = { id: 'shell', file: 'Prompt.tsx', line: 62, owner: 'Outer', name: 'Outer', component: 'Outer', prop: '', preview: true, views: ['shell-view'],
    effect: { kind: 'control', component: 'Dialog', prop: 'control', method: 'auto', close: ['close'], target: { file: 'Prompt.tsx', owner: 'Outer', line: 62, source: { line: 62, column: 6, endLine: 67, endColumn: 10 } } } };
  const views = [view('shell-view', 'Prompt.tsx', 62, 'Dialog', 'Outer', true), view('profile-view', 'EditProfile.tsx', 74, 'Basic'), view('chat-view', 'Chat.tsx', 834, 'Basic')];
  const graph = { sourceHash: 'h', nodes: [], edges: [], presentations: { actions: [], previews: [shell], states: [], views } };
  const reference = { views: [row('discard-profile', [{ control: { file: 'EditProfile.tsx', line: 74 } }]), row('new-account-chat', [{ control: { file: 'Chat.tsx', line: 834 } }])] };
  const compared = compareViewReference(graph, reference, () => []);
  // Discovery from several parents merged every caller into one shell node.
  const node = { id: 'prompt', kind: 'screen', status: 'captured', imageSourceHash: 'h', sourceViews: ['shell-view', 'profile-view', 'chat-view'], presentation: { actions: ['shell'], preview: true } };
  const legacy = compareFlowCapture(graph, compared, { id: 'run', sourceHash: 'h', nodes: [node] }, new Set(['prompt']));
  assert.deepEqual(legacy.rows.map(item => item.capture), ['preview', 'preview']);
  const sited = { ...node, capturedSites: ['Prompt.tsx:62:6', 'EditProfile.tsx:74:6'] };
  const result = compareFlowCapture(graph, compared, { id: 'run', sourceHash: 'h', nodes: [sited] }, new Set(['prompt']));
  assert.deepEqual(result.rows.map(item => [item.id, item.capture]), [['discard-profile', 'preview'], ['new-account-chat', 'not-captured']]);
});

test('an element passing two controllers credits only the prop that carried the opened one', () => {
  const view = (id, prop) => ({ id, name: 'Dialogs', file: 'Settings.tsx', owner: 'Settings', line: 346, kind: 'control', source: { line: 346, column: 6, endLine: 349, endColumn: 8 },
    components: [{ file: 'Dialogs.tsx', component: 'Dialogs' }], control: { component: 'Dialogs', prop, boundary: true, generic: false } });
  const open = { id: 'open', file: 'Settings.tsx', line: 262, owner: 'Settings', name: 'Dialogs', component: 'Button', prop: 'onPress',
    effect: { kind: 'control', component: 'Dialogs', prop: 'chatControl', method: 'open', close: ['close'] } };
  const graph = { sourceHash: 'h', nodes: [], edges: [], presentations: { actions: [open], previews: [], states: [], views: [view('chat', 'chatControl'), view('requests', 'chatRequestControl')] } };
  const reference = { views: [row('chat', [{ control: { file: 'Settings.tsx', line: 346, prop: 'chatControl' } }]), row('requests', [{ control: { file: 'Settings.tsx', line: 346, prop: 'chatRequestControl' } }])] };
  const compared = compareViewReference(graph, reference, () => []);
  const node = { id: 'dialog', kind: 'screen', status: 'captured', imageSourceHash: 'h', sourceViews: [], capturedSites: ['Settings.tsx:346:6:chatControl'], presentation: { actions: ['open'] } };
  const result = compareFlowCapture(graph, compared, { id: 'run', sourceHash: 'h', nodes: [node] }, new Set(['dialog']));
  assert.deepEqual(result.rows.map(item => [item.id, item.capture]), [['chat', 'live'], ['requests', 'not-captured']]);
});
