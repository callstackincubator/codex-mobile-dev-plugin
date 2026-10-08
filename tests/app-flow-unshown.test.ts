import test from 'node:test';
import assert from 'node:assert/strict';
import {markUnshown, unshownReason} from '../src/server/app-flow/unshown.ts';
import {FlowPresentationDiscovery} from '../src/server/app-flow/presentations.ts';
import type {FlowNode, FlowPresentationAction, FlowRun} from '../src/shared/app-flow.ts';

const source = (line: number) => ({line, column: 2, endLine: line, endColumn: 20});
const control = (id: string, owner: string, component: string, line: number, extra: Partial<FlowPresentationAction> = {}): FlowPresentationAction => ({id, file: `src/${owner}.tsx`, line, owner, component: 'Button', prop: 'onPress', name: component, source: source(line), parents: ['settings'],
  effect: {kind: 'control', component, prop: 'control', method: 'open', close: 'close', target: {file: `src/${owner}.tsx`, owner, line, source: source(line)}}, ...extra});
const screen = (id: string, status: FlowNode['status'] = 'captured'): FlowNode => ({id, name: id[0].toUpperCase() + id.slice(1), kind: 'screen', path: [id], required: [], status});

test('openers missing from an explored screen become needs-data nodes with their source conditions', () => {
  const remove = control('remove', 'AccountRow', 'Basic', 40, {when: [{kind: 'when', text: 'accounts.length > 1', file: 'src/Settings.tsx', line: 12}, {kind: 'each', text: 'accounts', file: 'src/Settings.tsx', line: 14}]});
  const captured = control('password', 'Settings', 'PasswordDialog', 20);
  const passwordBody = control('password-body', 'PasswordDialog', 'Outer', 5, {preview: true});
  const compiledShell = control('shell', 'Prompt', 'Outer', 7, {preview: true});
  const unexplored = control('elsewhere', 'Feed', 'ReportDialog', 9, {parents: ['feed']});
  const ref = {...control('list', 'Settings', 'List', 60, {preview: true}), effect: {kind: 'control', component: 'List', prop: 'ref', method: 'auto', close: 'close'}} as FlowPresentationAction;
  // One controller passed through a header and to the dialog it opens.
  const header = control('header', 'Messages', 'Header', 30, {preview: true, controller: 'newChatControl'});
  const dialog = control('new-chat', 'Messages', 'NewChat', 31, {preview: true, controller: 'newChatControl'});
  const dialogBody = control('new-chat-body', 'NewChat', 'Outer', 3, {preview: true});
  const run = {id: 'run', revision: 0, files: 1, scanMs: 0, warnings: [], phase: 'capturing', startedAt: 0, ai: 'off',
    nodes: [screen('settings'), screen('feed'), {...screen('password-node'), path: [], presentation: {actions: ['password'], basePath: ['settings']}, capturedSites: ['src/Prompt.tsx:7:2:control']}],
    edges: [], presentations: {states: [], actions: [remove, captured, unexplored], previews: [passwordBody, compiledShell, ref, header, dialog, dialogBody]}} as unknown as FlowRun;
  const added = markUnshown(run, id => id === 'settings');
  assert.deepEqual(added.map(node => node.name).sort(), ['Basic', 'NewChat'], 'Remove-account and one new-chat view');
  const removeNode = added.find(node => node.name === 'Basic')!;
  assert.equal(removeNode.status, 'needs-data');
  assert.deepEqual(removeNode.presentation, {actions: ['remove'], basePath: ['settings'], expo: false});
  assert.equal(removeNode.reason, 'Not found on Settings in this app state. It renders when `accounts.length > 1` (Settings.tsx:12) and `accounts` has items (Settings.tsx:14). Opener: AccountRow at src/AccountRow.tsx:40.');
  assert.equal(added.find(node => node.name === 'NewChat')!.presentation?.actions[0], 'new-chat', 'The element rendering the body names the view, not the pass-through header');
  assert.ok(run.edges.every(edge => edge.from === 'settings'));
  assert.deepEqual(markUnshown(run, id => id === 'settings'), [], 'A second pass adds nothing');
});

test('callers of one specific dialog become one node, on every pass', () => {
  const pill = control('pill', 'PostAlerts', 'LabelsDialog', 10), notice = control('notice', 'ProfileLabels', 'LabelsDialog', 20);
  const dialogBody = control('labels-body', 'LabelsDialog', 'Outer', 5, {preview: true});
  const run = {id: 'run', revision: 0, files: 1, scanMs: 0, warnings: [], phase: 'capturing', startedAt: 0, ai: 'off', edges: [],
    nodes: [screen('settings')], presentations: {states: [], actions: [pill, notice], previews: [dialogBody]}} as unknown as FlowRun;
  assert.equal(markUnshown(run, () => true).length, 1);
  assert.deepEqual(markUnshown(run, () => true), [], 'The other caller of the same dialog stays covered');
});

test('a shell shared by many callers keeps each caller distinct', () => {
  const callers = Array.from({length: 5}, (_, index) => control(`caller-${index}`, `Screen${index}`, 'Basic', 10 + index));
  const shellBody = control('basic-body', 'Basic', 'Outer', 4, {preview: true});
  const run = {id: 'run', revision: 0, files: 1, scanMs: 0, warnings: [], phase: 'capturing', startedAt: 0, ai: 'off', edges: [],
    nodes: [screen('settings'), {...screen('first'), path: [], presentation: {actions: ['caller-0'], basePath: ['settings']}}],
    presentations: {states: [], actions: callers, previews: [shellBody]}} as unknown as FlowRun;
  const added = markUnshown(run, () => true);
  assert.deepEqual(added.map(node => node.presentation?.actions[0]).sort(), ['caller-1', 'caller-2', 'caller-3', 'caller-4'], 'One caller\'s capture shows the shell body, never the other callers');
});

test('a reason without conditions still names the opener, and a handler guard reads as written', () => {
  assert.equal(unshownReason(control('x', 'Menu', 'BlockDialog', 8)), 'Its opener was not found in this app state. Opener: Menu at src/Menu.tsx:8.');
  const guarded = control('y', 'Badge', 'VerifierDialog', 9, {guard: {op: '===', args: [{prop: ['state', 'profile', 'role']}, {value: 'verifier'}]}});
  assert.equal(unshownReason(guarded, 'Home'), 'Not found on Home in this app state. Its handler opens it when `state.profile.role === "verifier"`. Opener: Badge at src/Badge.tsx:9.');
  const negated = control('z', 'Badge', 'VerificationsDialog', 9, {guard: {op: '!', args: [{op: '===', args: [{prop: ['role']}, {value: 'verifier'}]}]}});
  assert.match(unshownReason(negated), /when `!\(role === "verifier"\)`/);
});

test('a resumed run keeps the screens it already explored', () => {
  const run = {id: 'run', revision: 0, nodes: [screen('settings'), screen('feed', 'timed-out')], edges: [], explored: ['settings', 'feed'], presentations: {states: [], actions: []}} as unknown as FlowRun;
  const discovery = new FlowPresentationDiscovery(run, '/app', '/data', new AbortController().signal, async () => {});
  assert.equal(discovery.hasVisited('settings'), true);
  assert.equal(discovery.hasVisited('feed'), false, 'Only captured screens count as explored');
});
