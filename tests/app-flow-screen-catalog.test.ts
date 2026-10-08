import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import {scanAppFlow} from '../src/server/app-flow/scan.ts';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {QueuedAppFlowRuns} from './app-flow-queue-fixture.ts';
import {FlowStore} from '../src/server/app-flow/store.ts';
import {catalogNodes, mergeCatalog, reviewCatalog, seedCatalog} from '../src/server/app-flow/screen-catalog.ts';
import {flowRunning, type FlowGraph, type FlowNode, type FlowRun} from '../src/shared/app-flow.ts';
import type {FlowStart} from '../src/server/app-flow/runs.ts';

const sheet: any = {id: 'sheet', name: 'Sheet', file: 'App.tsx', line: 1, owner: 'Detail', component: 'Sheet', prop: 'onPress', effect: {kind: 'control', component: 'Sheet', prop: 'control', method: 'open', close: 'close'}};
const form: any = {...sheet, id: 'form', name: 'Form', preview: true, effect: {kind: 'state', site: 'site', path: ['step'], value: 1}};
const route = (id: string, name: string, extra: Partial<FlowNode> = {}): FlowNode => ({id, name, kind: 'screen', path: [name], required: [], status: 'pending', ...extra});
const run = (nodes: FlowNode[], extra: Partial<FlowRun> = {}): FlowRun => ({id: randomUUID(), phase: 'partial', revision: 1, startedAt: 1, ai: 'off', files: 1, scanMs: 0, warnings: [],
  sourceHash: 'source', nodes, edges: [], presentations: {states: [], actions: [sheet], previews: [form]}, ...extra});

test('the catalog keeps the last working recipe and records every real attempt', () => {
  const home = route('home', 'Home', {status: 'captured', image: 'mobile-flow://a/home'});
  const detail = route('detail', 'Detail', {required: ['id'], params: {id: 'real-1'}, status: 'captured', image: 'mobile-flow://a/detail'});
  const opened = route('opened', 'Sheet', {path: [], status: 'captured', image: 'mobile-flow://a/opened', presentation: {actions: ['sheet'], basePath: ['Detail'], baseParams: {id: 'real-1'}}});
  const preview = route('preview', 'Form', {path: [], status: 'timed-out', reason: 'loading', presentation: {actions: ['form'], preview: true, basePath: ['Home']}});
  const recorded = route('recorded', 'Recorded', {capture: 'observed', status: 'captured'});
  const entry = route('entry', 'App entry', {path: [], presentation: {actions: [], basePath: [], entryKey: 'k'}});
  const first = mergeCatalog(undefined, run([home, detail, opened, preview, recorded, entry], {edges: [{from: 'home', to: 'detail', kind: 'navigation'}, {from: 'home', to: 'recorded', kind: 'navigation'}]}), 10);
  assert.deepEqual(first.entries.map(entry => [entry.id, entry.category]), [['home', 'no-inputs'], ['detail', 'real-inputs'], ['opened', 'real-inputs'], ['preview', 'app-state']]);
  assert.deepEqual(first.edges, [{from: 'home', to: 'detail', kind: 'navigation'}], 'Recorded steps and entry fallbacks stay out');
  assert.equal(first.entries[1].node.status, 'pending');
  assert.equal(first.entries[1].node.image, undefined, 'The recipe holds no run-specific capture fields');
  assert.equal(first.entries[1].captured?.image, 'mobile-flow://a/detail');

  // A later failure with missing data must not replace the working recipe.
  const failed = route('detail', 'Detail', {required: ['id'], status: 'needs-data', reason: 'Real data is required for: id.'});
  const stopped = route('home', 'Home', {status: 'timed-out', reason: 'Run stopped.'});
  const second = mergeCatalog(first, run([failed, stopped]), 20);
  const detailEntry = second.entries.find(entry => entry.id === 'detail')!;
  assert.deepEqual(detailEntry.node.params, {id: 'real-1'});
  assert.equal(detailEntry.last?.status, 'needs-data');
  assert.equal(detailEntry.captured?.image, 'mobile-flow://a/detail', 'The accepted image survives a failed attempt');
  assert.equal(second.entries.find(entry => entry.id === 'home')!.last?.status, 'captured', 'A run that stopped first did not attempt the screen');
});

test('a caller-named shared shell replaces the unnamed entry with the same recipe', () => {
  const plan = {actions: ['sheet', 'form'], preview: true, basePath: ['Home']};
  const unnamed = route('shell', 'Outer', {path: [], status: 'captured', image: 'mobile-flow://a/shell', presentation: plan});
  const other = route('other', 'Outer', {path: [], status: 'captured', image: 'mobile-flow://a/other', presentation: {...plan, basePath: ['Detail']}});
  const first = mergeCatalog(undefined, run([route('home', 'Home'), unnamed, other], {edges: [{from: 'home', to: 'shell', kind: 'navigation'}]}), 10);
  const named = route('shell-profile', 'Outer', {path: [], status: 'captured', image: 'mobile-flow://b/shell-profile',
    capturedSites: ['Prompt.tsx:62:4', 'EditProfile.tsx:74:6'], presentation: {...plan, instances: {form: 'EditProfile.tsx:74:6'}}});
  const second = mergeCatalog(first, run([named], {edges: [{from: 'home', to: 'shell-profile', kind: 'navigation'}]}), 20);
  assert.deepEqual(second.entries.map(entry => entry.id), ['home', 'other', 'shell-profile']);
  assert.deepEqual(second.entries[2].captured?.sites, ['Prompt.tsx:62:4', 'EditProfile.tsx:74:6']);
  assert.equal(second.entries[2].node.capturedSites, undefined, 'Sites belong to the capture, not the recipe');
  assert.deepEqual(second.edges, [{from: 'home', to: 'shell-profile', kind: 'navigation'}]);
});

test('catalog selection skips stale recipes and already captured screens on request', () => {
  const catalog = mergeCatalog(undefined, run([
    route('home', 'Home', {status: 'captured', image: 'x'}),
    route('gone', 'Gone', {status: 'timed-out', reason: 'loading'}),
    route('opened', 'Sheet', {path: [], status: 'timed-out', reason: 'native', presentation: {actions: ['sheet'], basePath: ['Home']}}),
    route('preview', 'Form', {path: [], status: 'captured', image: 'y', presentation: {actions: ['form'], preview: true, basePath: ['Home']}}),
  ]));
  const graph: Pick<FlowGraph, 'nodes' | 'presentations'> = {nodes: [route('home', 'Home')], presentations: {states: [], actions: [sheet], previews: []}};
  const all = catalogNodes(catalog, graph, 'all');
  assert.deepEqual(all.nodes.map(node => node.id), ['home', 'opened']);
  assert.deepEqual(all.stale, ['gone', 'preview'], 'A removed route and a removed opening action are stale');
  assert.deepEqual(catalogNodes(catalog, graph, 'missing').nodes.map(node => node.id), ['opened']);
  assert.deepEqual(catalogNodes(undefined, graph).nodes, []);
});

test('a rejected review returns the screen to the missing set until a new capture', () => {
  const first = run([route('home', 'Home', {status: 'captured', image: 'mobile-flow://a/home'}), route('feed', 'Feed', {status: 'captured', image: 'mobile-flow://a/feed'})]);
  const merged = mergeCatalog(undefined, first);
  const graph: Pick<FlowGraph, 'nodes' | 'presentations'> = {nodes: [route('home', 'Home'), route('feed', 'Feed')], presentations: {states: [], actions: [], previews: []}};
  assert.deepEqual(catalogNodes(merged, graph, 'missing').nodes, []);
  const {catalog, applied} = reviewCatalog(merged, first.id, [{nodeId: 'feed', accepted: false, reason: 'Loading placeholders'}, {nodeId: 'home', accepted: true}, {nodeId: 'gone', accepted: false}]);
  assert.equal(applied, 2, 'Unknown screens are ignored');
  assert.equal(catalog.entries.find(entry => entry.id === 'feed')!.captured, undefined, 'A rejected image is not an accepted capture');
  assert.equal(catalog.entries.find(entry => entry.id === 'home')!.captured?.image, 'mobile-flow://a/home');
  assert.deepEqual(catalogNodes(catalog, graph, 'missing').nodes.map(node => node.id), ['feed']);
  assert.equal(reviewCatalog(catalog, 'another-run', [{nodeId: 'home', accepted: false}]).applied, 0, 'A verdict applies only to the run that produced the latest image');
  const next = mergeCatalog(catalog, run([route('feed', 'Feed', {status: 'captured', image: 'mobile-flow://b/feed'})]));
  const feed = next.entries.find(entry => entry.id === 'feed')!;
  assert.equal(feed.review, undefined, 'A new attempt clears the old verdict');
  assert.equal(feed.captured?.image, 'mobile-flow://b/feed');
});

test('source seeds plan unreached screens with a parent route, once per controlled view', () => {
  const live = {...sheet, id: 'live', parents: ['detail'], effect: {...sheet.effect, target: {file: 'Detail.tsx', owner: 'Detail', line: 9}}};
  const preview = {...live, id: 'preview-same', preview: true, effect: {...live.effect, method: 'auto'}};
  const ref = {...sheet, id: 'ref', owner: 'List', effect: {kind: 'control', component: 'List', prop: 'ref', method: 'scrollToEnd', close: 'scrollToTop'}};
  const shell = {...sheet, id: 'shell', owner: 'Shell', name: 'Prompt', effect: {...sheet.effect, component: 'Prompt', target: {file: 'Shell.tsx', owner: 'Shell', line: 4}}};
  const needs = {...sheet, id: 'needs', owner: 'Item', parents: ['item'], effect: {...sheet.effect, component: 'Menu', target: {file: 'Item.tsx', owner: 'Item', line: 2}}};
  const graph: any = {sourceHash: 'source', links: [], edges: [{from: 'home', to: 'detail', kind: 'navigation'}, {from: 'home', to: 'item', kind: 'navigation'}],
    nodes: [route('home', 'Home', {entry: true}), route('detail', 'Detail'), route('item', 'Item', {required: ['id']}), route('debug', 'Debug')],
    presentations: {states: [], actions: [live, ref, shell, needs], previews: [preview]}};
  const seeded = seedCatalog(undefined, graph, 5);
  const routes = seeded.entries.filter(entry => !entry.node.presentation).map(entry => entry.id);
  assert.deepEqual(routes, ['home', 'detail', 'item'], 'Only routes linked from app UI are seeded');
  const openers = seeded.entries.filter(entry => entry.node.presentation);
  assert.deepEqual(openers.map(entry => [entry.node.presentation!.actions[0], entry.node.presentation!.basePath]), [['live', ['Detail']], ['shell', ['Home']]],
    'One recipe per controlled view, the live opener first; refs are not views; a parent without real params waits');
  assert.ok(openers.every(entry => entry.seeded && entry.id.startsWith('presentation-')));
  // Real params from a captured parent let its openers be planned.
  const withItem = mergeCatalog(seeded, run([route('item', 'Item', {required: ['id'], params: {id: 'real-7'}, status: 'captured', image: 'x'})]));
  const planned = seedCatalog(withItem, graph, 6).entries.find(entry => entry.node.presentation?.actions[0] === 'needs')!;
  assert.deepEqual(planned.node.presentation!.baseParams, {id: 'real-7'});
  assert.equal(seedCatalog(seedCatalog(undefined, graph), graph).entries.length, seeded.entries.length, 'Seeding twice adds nothing');
});

test('a form step that mounts only for some accounts seeds behind its owner mount preview', () => {
  const mount: any = {id: 'mount-form', file: 'Onboarding.tsx', line: 3, owner: 'Onboarding', component: 'Onboarding', prop: '', name: 'Onboarding', preview: true, effect: {kind: 'mount', file: 'Onboarding.tsx', export: 'Onboarding'}};
  const step: any = {id: 'step-profile', file: 'Onboarding.tsx', line: 9, owner: 'Onboarding', component: 'Layout', prop: '', name: 'Layout', preview: true, effect: {kind: 'state', site: 'onboarding', path: ['activeStep'], value: 'profile'}};
  const graph: any = {nodes: [route('home', 'Home', {entry: true})], edges: [], links: [], presentations: {states: [], actions: [], previews: [mount, step]}};
  const seeded = seedCatalog(undefined, graph, 1);
  const recipe = seeded.entries.find(entry => entry.node.presentation?.actions.at(-1) === 'step-profile')?.node.presentation;
  assert.deepEqual(recipe?.actions, ['mount-form', 'step-profile']);
  assert.deepEqual(recipe?.basePath, ['Home']);
  // An earlier one-step entry that never captured gains the mount step.
  const earlier: any = {version: 1, updatedAt: 1, edges: [], entries: [{id: 'old', name: 'Layout', category: 'app-state', last: {runId: 'r', status: 'needs-data', at: 1},
    node: {...route('old', 'Layout', {path: []}), presentation: {actions: ['step-profile'], preview: true, basePath: ['Home']}}}]};
  assert.deepEqual(seedCatalog(earlier, graph, 2).entries.find(entry => entry.id === 'old')?.node.presentation?.actions, ['mount-form', 'step-profile']);
});

test('the scan names the registered screens that render each opener', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flow-parents-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const files: Record<string, string> = {
    'Navigation.tsx': `import {createNativeStackNavigator} from '@react-navigation/native-stack';import {HomeScreen} from './Home';import {SettingsScreen} from './Settings';
      const Stack = createNativeStackNavigator();
      export function Navigation() { return <Stack.Navigator><Stack.Screen name="Home" component={HomeScreen} /><Stack.Screen name="Settings" component={SettingsScreen} /></Stack.Navigator>; }`,
    'Home.tsx': `import {Shell} from './Shell';export function HomeScreen({navigation}) { return <Button onPress={() => navigation.navigate('Settings')} />; }`,
    'Settings.tsx': `import {useDialogControl} from './Dialog';import {SignOutPrompt} from './Prompt';
      export function SettingsScreen() { const control = useDialogControl(); return <><Button onPress={() => control.open()} /><SignOutPrompt control={control} /></>; }`,
    'Prompt.tsx': `export function SignOutPrompt({control}) { return <Outer control={control}><Text>Sign out?</Text></Outer>; }`,
    'Shell.tsx': `import {useDialogControl} from './Dialog';import {SignOutPrompt} from './Prompt';
      export function Shell() { const control = useDialogControl(); return <><Button onPress={() => control.open()} /><SignOutPrompt control={control} /></>; }`,
    'Dialog.tsx': `import {useState} from 'react';export function useDialogControl() { const [open, setOpen] = useState(false); return {open: () => setOpen(true), close: () => setOpen(false), isOpen: open}; }`,
  };
  for (const [file, text] of Object.entries(files)) await writeFile(join(root, file), text);
  const graph = await scanAppFlow(root, 'ios');
  const settings = graph.nodes.find(node => node.name === 'Settings')!;
  const owners = (owner: string) => [...graph.presentations!.actions, ...graph.presentations!.previews!].filter(action => action.owner === owner);
  assert.ok(owners('SettingsScreen').length && owners('SettingsScreen').every(action => JSON.stringify(action.parents) === JSON.stringify([settings.id])));
  assert.ok(owners('Shell').length && owners('Shell').every(action => action.parents === undefined), 'A component no screen renders has no parent');
});

async function finished(runs: QueuedAppFlowRuns, id: string) {
  for (let i = 0; i < 400; i++) {
    const current = await runs.readShared(id);
    if (current && !flowRunning(current)) { await (runs as any).sessions.get(id)?.done; return (await runs.readShared(id))!; }
    await delay(5);
  }
  assert.fail('Capture did not finish');
}

test('every run updates the catalog, and a catalog run replays only screens still missing', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'flow-catalog-'));
  const graph: FlowGraph = {files: 1, scanMs: 0, warnings: [], sourceHash: 'source', edges: [{from: 'home', to: 'profile', kind: 'navigation'}], nodes: [
    route('home', 'Home', {entry: true}), route('profile', 'Profile', {required: ['id'], params: {id: 'real-1'}}),
  ], presentations: {states: [], actions: []}};
  const store = new FlowStore(directory), plan: FlowRun = {...structuredClone(graph), id: randomUUID(), phase: 'partial', revision: 1, startedAt: 1, ai: 'off'};
  const input: FlowStart = {projectRoot: directory, deviceId: 'device', targetId: 'target', platform: 'ios', metroUrl: 'http://127.0.0.1:8081', useAi: false, capture: {planRunId: plan.id}};
  await store.save({run: plan, input});
  const state = {failProfile: true}, shots: string[] = [];
  const runs = new QueuedAppFlowRuns({directory, scan: async () => structuredClone(graph), connect: async () => {
    let current = 'Home';
    const view = () => ({ready: true, found: true, active: [current], name: current, signature: current, key: current, motion: 'settled', content: 3});
    return {runtime: {async close() {}, async invoke(command: any) {
      if (command.type === 'inspect') return {available: true, active: ['Home'], entries: [['Home']]};
      if (command.type === 'capture-inventory') return {sourceHashes: ['source']};
      if (command.type === 'open') { current = command.path.at(-1); if (current === 'Profile' && state.failProfile) return {ready: false, reason: 'Screen is still loading (skeleton).'}; }
      return view();
    }}, async screenshot() { shots.push(current); return Buffer.from(current); }};
  }});
  t.after(async () => { await runs.close(); await rm(directory, {recursive: true, force: true}); });

  const first = await finished(runs, runs.start(input).id);
  assert.deepEqual(first.nodes.map(node => node.status), ['captured', 'timed-out']);
  const catalog = await runs.catalog(directory, 'ios');
  assert.deepEqual(catalog.screens.map(screen => [screen.id, screen.category, screen.last?.status]), [['home', 'no-inputs', 'captured'], ['profile', 'real-inputs', 'timed-out']]);
  assert.equal(catalog.captured, 1);

  state.failProfile = false; shots.length = 0;
  const missing = await finished(runs, runs.start({...input, capture: {catalog: 'missing'}}).id);
  assert.equal(missing.phase, 'complete', missing.error);
  assert.deepEqual(shots, ['Profile'], 'Only the screen still missing is captured');
  assert.deepEqual(missing.edges, [], 'Edges stay between selected screens');
  const after = await runs.catalog(directory, 'ios');
  assert.deepEqual(after.screens.map(screen => screen.last?.status), ['captured', 'captured']);
  assert.equal(after.captured, 2);
  const reviewed = await runs.catalog(directory, 'ios', {runId: missing.id, reviews: [{nodeId: 'profile', accepted: false, reason: 'Loading placeholders'}]});
  assert.equal(reviewed.reviewsApplied, 1);assert.equal(reviewed.rejected, 1);assert.equal(reviewed.captured, 1);
  shots.length = 0;
  const again = await finished(runs, runs.start({...input, capture: {catalog: 'missing'}}).id);
  assert.equal(again.phase, 'complete', again.error);
  assert.deepEqual(shots, ['Profile'], 'A rejected image is captured again');
  assert.equal((await runs.catalog(directory, 'ios')).captured, 2);

  shots.length = 0;
  const all = await finished(runs, runs.start({...input, capture: {catalog: 'all'}}).id);
  assert.equal(all.phase, 'complete', all.error);
  assert.deepEqual(shots.sort(), ['Home', 'Profile']);
  assert.deepEqual(all.edges, [{from: 'home', to: 'profile', kind: 'navigation'}], 'Catalog runs keep the catalog edges for the canvas');
  const both = await finished(runs, runs.start({...input, capture: {catalog: 'all', planRunId: plan.id}}).id);
  assert.match(both.error!, /saved plan or the screen catalog/);
  assert.equal((await readdir(join(directory, 'catalogs'))).length, 1, 'One catalog file per project and platform');
});
