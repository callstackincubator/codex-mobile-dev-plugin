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
