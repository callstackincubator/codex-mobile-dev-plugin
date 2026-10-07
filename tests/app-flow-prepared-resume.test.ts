import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {QueuedAppFlowRuns} from './app-flow-queue-fixture.ts';
import {FlowStore} from '../src/server/app-flow/store.ts';
import {captureRecipeNodes} from '../src/server/app-flow/capture-manifest.ts';
import {flowRunning, type FlowGraph, type FlowRun} from '../src/shared/app-flow.ts';
import type {FlowStart} from '../src/server/app-flow/runs.ts';

async function finished(runs: QueuedAppFlowRuns, id: string) {
  for (let i = 0; i < 300; i++) {
    const run = await runs.readShared(id);
    if (run && !flowRunning(run)) {
      await (runs as any).sessions.get(id)?.done;
      return (await runs.readShared(id))!;
    }
    await delay(5);
  }
  assert.fail('Prepared capture did not finish');
}

async function fixture(t: test.TestContext, slow = false, presentation = false) {
  const directory = await mkdtemp(join(tmpdir(), 'flow-prepared-resume-'));
  const store = new FlowStore(directory), instances: QueuedAppFlowRuns[] = [];
  const shots: string[] = [], opened: {path: string[]; params?: Record<string, unknown>}[] = [];
  const state = {fail: slow, sourceHash: 'source', connections: 0};
  const action: any = {id: 'details', name: 'Details', file: 'App.tsx', line: 1, owner: 'App', component: 'Details', prop: 'onPress', effect: {kind: 'control', component: 'Details', prop: 'control', method: 'open', close: 'close'}};
  const graph: FlowGraph = {files: 1, scanMs: 0, warnings: [], sourceHash: 'source', edges: [{from: 'home', to: 'profile', kind: 'navigation'}], nodes: [
    {id: 'home', name: 'Home', kind: 'screen', path: ['Home'], required: [], status: 'pending', entry: true},
    {id: 'profile', name: 'Profile', kind: 'screen', path: ['Profile'], required: slow ? [] : ['id'], params: {mode: 'view'}, status: slow ? 'pending' : 'needs-data'},
  ], presentations: {states: [], actions: [action]}};
  if (presentation) {
    const node = graph.nodes[1];
    node.path = [];
    node.presentation = {actions: ['details'], basePath: ['Profile'], baseParams: {mode: 'view', scope: 'observed'}};
  }
  const plan: FlowRun = {...structuredClone(graph), id: randomUUID(), phase: 'partial', revision: 1, startedAt: Date.now(), ai: 'off'};
  const input: FlowStart = {projectRoot: directory, deviceId: 'device', targetId: 'target', platform: 'ios', metroUrl: 'http://127.0.0.1:8081', useAi: false, capture: {planRunId: plan.id, include: ['home', 'profile']}};
  await store.save({run: plan, input});
  const make = () => {
    const runs = new QueuedAppFlowRuns({directory, scan: async () => ({...structuredClone(graph), sourceHash: state.sourceHash}), connect: async () => {
      state.connections++;
      let current = 'Home', sheet = false;
      const view = () => ({ready: true, found: true, active: [current], name: current, signature: `${current}/${sheet}`, key: `${current}/${sheet}`, motion: 'settled', content: 3});
      return {runtime: {async close() { assert.equal(sheet, false); }, async invoke(command: any) {
        if (command.type === 'inspect') return {available: true, active: ['Home'], entries: [['Home']]};
        if (command.type === 'capture-inventory') return {sourceHashes: [state.sourceHash]};
        if (command.type === 'open') {
          current = command.path.at(-1); opened.push({path: command.path, params: command.params});
          if (current === 'Profile' && state.fail) return {ready: false, reason: 'Screen is still loading (skeleton).'};
        }
        if (command.type === 'presentation-prepare') return {available: true};
        if (command.type === 'presentation-open') sheet = true;
        if (command.type === 'presentation-rollback') {sheet = false; return {};}
        if (command.type === 'presentation-checkpoint') return {level: sheet ? 1 : 0};
        return view();
      }}, async screenshot() {const key = `${current}${sheet ? '/Details' : ''}`; shots.push(key); return Buffer.from(key);}};
    }});
    instances.push(runs); return runs;
  };
  t.after(async () => {await Promise.all(instances.map(runs => runs.close())); await rm(directory, {recursive: true, force: true});});
  return {make, store, graph, plan, input, shots, opened, state, directory};
}

test('resolving a prepared selection after a process restart keeps accepted images and the new real data', async t => {
  const f = await fixture(t), panel = f.make();
  const {id} = panel.start(f.input), before = await finished(panel, id);
  assert.deepEqual(before.nodes.map(node => node.status), ['captured', 'needs-data']);
  await panel.close();
  const model = f.make();
  await model.submit(id, [{nodeId: 'profile', params: {id: 'observed-id'}}]);
  const after = await finished(model, id);
  assert.equal(after.phase, 'complete', after.error);
  assert.deepEqual(f.shots, ['Home', 'Profile']);
  assert.equal(after.nodes[0].image, before.nodes[0].image);
  assert.equal(after.nodes[0].captureAttempts, before.nodes[0].captureAttempts);
  assert.deepEqual(after.nodes[1].params, {mode: 'view', id: 'observed-id'});
  assert.deepEqual(f.opened.at(-1)?.params, {mode: 'view', id: 'observed-id'});
  assert.deepEqual(after.edges, before.edges);
});

test('a resolved sheet resumes with its real base params after the run owner closes', async t => {
  const f = await fixture(t, false, true), panel = f.make();
  const {id} = panel.start(f.input); await finished(panel, id); await panel.close();
  const model = f.make();
  await model.submit(id, [{nodeId: 'profile', params: {id: 'observed-id'}}]);
  const after = await finished(model, id);
  assert.equal(after.phase, 'complete', after.error);
  assert.deepEqual(f.shots, ['Home', 'Profile/Details']);
  assert.deepEqual(f.opened.at(-1)?.params, {mode: 'view', scope: 'observed', id: 'observed-id'});
  assert.deepEqual(after.nodes[1].presentation?.baseParams, f.opened.at(-1)?.params);
});

test('retrying a prepared timeout captures only the failed view and preserves the fixed selection', async t => {
  const f = await fixture(t, true), runs = f.make();
  const {id} = runs.start(f.input), before = await finished(runs, id);
  assert.deepEqual(before.nodes.map(node => node.status), ['captured', 'timed-out']);
  f.state.fail = false;
  await runs.retry(id);
  const after = await finished(runs, id);
  assert.equal(after.phase, 'complete', after.error);
  assert.deepEqual(f.shots, ['Home', 'Profile']);
  assert.equal(after.nodes[0].image, before.nodes[0].image);
  assert.equal(after.nodes[0].captureAttempts, before.nodes[0].captureAttempts);
  assert.deepEqual(after.nodes.map(node => node.id), before.nodes.map(node => node.id));
});

test('a prepared retry no longer depends on the original plan file', async t => {
  const f = await fixture(t, true), panel = f.make();
  const {id} = panel.start(f.input); await finished(panel, id); await panel.close();
  await rm(join(f.directory, f.plan.id), {recursive: true});
  f.state.fail = false;
  const model = f.make();
  await model.retry(id);
  const after = await finished(model, id);
  assert.equal(after.phase, 'complete', after.error);
  assert.deepEqual(f.shots, ['Home', 'Profile']);
});

test('a changed app source rejects a prepared retry before connecting and keeps accepted pixels', async t => {
  const f = await fixture(t, true), runs = f.make();
  const {id} = runs.start(f.input), before = await finished(runs, id), connections = f.state.connections;
  f.state.sourceHash = 'changed-source';
  await runs.retry(id);
  const after = await finished(runs, id);
  assert.equal(after.phase, 'failed');
  assert.match(after.error!, /prepared.*source/i);
  assert.equal(f.state.connections, connections);
  assert.equal(after.sourceHash, before.sourceHash);
  assert.equal(after.nodes[0].image, before.nodes[0].image);
  assert.deepEqual(f.shots, ['Home']);
});

test('fresh selections reuse resolved base data before creating recipes without rewriting the saved plan', async t => {
  const f = await fixture(t), runs = f.make();
  const {id} = runs.start(f.input); await finished(runs, id);
  // Record a real-data reply as the shared resolver would, then start a new
  // selection from the original plan. It must not replace the reply with old data.
  runs.resolve(id, [{nodeId: 'profile', params: {id: 'observed-id'}}]);
  const recipes = [{baseNodeId: 'profile', actions: ['details']}];
  const recipe = captureRecipeNodes(f.graph, f.plan.nodes, recipes)[0];
  const next = runs.start({...f.input, capture: {planRunId: f.plan.id, recipes, include: [recipe.id]}});
  const after = await finished(runs, next.id);
  assert.equal(after.phase, 'complete', after.error);
  assert.deepEqual(f.shots, ['Home', 'Profile/Details']);
  assert.deepEqual(f.opened.at(-1)?.params, {mode: 'view', id: 'observed-id'});
  assert.deepEqual(after.nodes[0].presentation?.baseParams, {mode: 'view', id: 'observed-id'});
  assert.deepEqual((await f.store.load(f.plan.id)).run.nodes[1].params, {mode: 'view'});
});
