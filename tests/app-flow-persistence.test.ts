import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AppFlowRuns, type FlowDependencies, type FlowStart } from '../src/server/app-flow/runs.ts';
import { FlowStore } from '../src/server/app-flow/store.ts';
import { flowRunning, type FlowGraph } from '../src/shared/app-flow.ts';

const input: FlowStart = { projectRoot: '/fixture', platform: 'ios', deviceId: 'device', targetId: 'target', metroUrl: 'http://127.0.0.1:8081', useAi: false };
const graph = (): FlowGraph => ({ files: 1, scanMs: 1, warnings: [], edges: [], nodes: [
  { id: 'home', name: 'Home', kind: 'screen', path: ['Home'], required: [], status: 'pending' },
  { id: 'profile', name: 'Profile', kind: 'screen', path: ['Profile'], required: ['id'], status: 'needs-data', params: { mode: 'view' } },
] });
async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'flow-persistence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function finished(runs: AppFlowRuns, id: string) {
  for (let i = 0; i < 300; i++) {
    const run = await runs.readShared(id);
    if (run && !flowRunning(run)) { await (runs as any).sessions.get(id)?.done; return (await runs.readShared(id))!; }
    await delay(10);
  }
  assert.fail('Capture did not finish');
}
function backend(shots: string[], open?: (name: string, command: any) => Promise<any>): FlowDependencies['connect'] {
  return async () => {
    let name = 'Home';
    return { target: { appId: 'example.app', deviceId: 'device' }, runtime: {
      async invoke(command) {
        if (command.type === 'inspect') return { available: true, data: [{ id: 'real-id' }] };
        if (command.type === 'open') { name = (command.path as string[]).at(-1)!; const result = await open?.(name, command); if (result) return result; }
        return { ready: true, found: true, active: [name], name, signature: name };
      }, async close() {},
    }, async screenshot() { shots.push(name); return Buffer.from(name); } };
  };
}

test('another MCP instance can resolve a finished saved map without recapturing successful screens', async t => {
  const directory = await fixture(t), shots: string[] = [];
  const dependencies = { directory, scan: async () => graph(), connect: backend(shots) };
  const panel = new AppFlowRuns(dependencies), model = new AppFlowRuns(dependencies);
  t.after(async () => { await panel.close(); await model.close(); });
  const { id } = panel.start(input);
  const original = await finished(panel, id);
  await panel.close();
  const context = await model.contextShared(id);
  assert.equal(context.projectRoot, input.projectRoot);
  assert.deepEqual(context.data, [{ id: 'real-id' }]);
  assert.deepEqual(context.routes.map(route => route.nodeId), ['profile']);
  assert.deepEqual(context.routes[0].params, { mode: 'view' });
  const started = Date.now();
  t.mock.method(Date, 'now', () => started + 3_600_000);
  await model.submit(id, [{ nodeId: 'profile', params: { id: 'real-id' } }]);
  const complete = await finished(model, id);
  assert.equal(complete.id, original.id);
  assert.deepEqual(shots, ['Home', 'Profile']);
  assert.deepEqual(complete.nodes.map(node => node.status), ['captured', 'captured']);
  assert.equal(complete.nodes[0].image, original.nodes[0].image);
  assert.equal(complete.elapsedMs, original.elapsedMs, 'Idle time between capture sessions is excluded');
  assert.deepEqual(complete.nodes[1].params, { mode: 'view', id: 'real-id' });
  assert.equal((await panel.readShared(id))?.nodes[1].status, 'captured');
  assert.equal(await model.readShared(id, complete.revision), undefined);
  assert.equal((await stat(join(directory, id, 'session.json'))).mode & 0o777, 0o600);
  await model.submit(id, []);
  assert.deepEqual(shots, ['Home', 'Profile']);
});

test('a live owner consumes another process reply and competing clients never capture the same device', async t => {
  const directory = await fixture(t), shots: string[] = [];
  let release!: () => void, opening = false, connections = 0;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const connect = backend(shots, async name => { if (name === 'Home') { opening = true; await wait; } });
  const dependencies = { directory, scan: async () => graph(), connect: async (...args: Parameters<typeof connect>) => { connections++; return connect(...args); } };
  const panel = new AppFlowRuns(dependencies), model = new AppFlowRuns(dependencies);
  t.after(async () => { release(); await panel.close(); await model.close(); });
  const { id } = panel.start(input);
  while (!opening) await delay(5);
  await panel.prepare(id);
  assert.equal((await model.contextShared(id)).routes[0].nodeId, 'profile');
  await Promise.all([model.submit(id, [{ nodeId: 'profile', params: { id: 'real-id' } }]), model.submit(id, [])]);
  assert.equal(connections, 1);
  release();
  const result = await finished(panel, id);
  assert.equal(result.nodes[1].status, 'captured');
  assert.deepEqual(shots, ['Home', 'Profile']);
});

test('timeouts get two later adaptive retries, fast screens finish first, and final failures stay truthful', async t => {
  const directory = await fixture(t), shots: string[] = [], opens: { name: string; loading: number }[] = [];
  const routes = (): FlowGraph => ({ ...graph(), nodes: ['Slow', 'Fast', 'Broken'].map(name => ({ id: name.toLowerCase(), name, kind: 'screen', path: [name], required: [], status: 'pending' })) });
  const runs = new AppFlowRuns({ directory, scan: async () => routes(), connect: backend(shots, async (name, command) => {
    opens.push({ name, loading: command.loadingTimeoutMs });
    if (name === 'Broken' || name === 'Slow' && command.loadingTimeoutMs < 20000) return { ready: false, reason: 'Screen is still loading (skeleton).' };
  }) });
  t.after(() => runs.close());
  const { id } = runs.start(input), result = await finished(runs, id);
  assert.deepEqual(opens.map(item => item.name), ['Slow', 'Fast', 'Broken', 'Slow', 'Broken', 'Slow', 'Broken']);
  assert.deepEqual(opens.filter(item => item.name === 'Slow').map(item => item.loading), [6000, 10000, 20000]);
  assert.deepEqual(shots, ['Fast', 'Slow']);
  assert.equal(result.nodes[2].status, 'timed-out');
  assert.equal(result.nodes[2].captureAttempts, 3);
  assert.equal(result.nodes[2].image, undefined);
  const before = shots.length;
  await runs.retry(id);
  const retried = await finished(runs, id);
  assert.equal(shots.length, before);
  assert.equal(retried.nodes[0].image, result.nodes[0].image);
});

test('legacy maps still provide context and can retry with confirmed setup', async t => {
  const directory = await fixture(t), id = randomUUID(), shots: string[] = [];
  const run = { ...graph(), id, phase: 'complete', revision: 1, ai: 'off', startedAt: Date.now() };
  run.nodes[0].status = 'timed-out';
  await mkdir(join(directory, id));
  await writeFile(join(directory, id, 'map.json'), JSON.stringify(run));
  const runs = new AppFlowRuns({ directory, scan: async () => graph(), connect: backend(shots) });
  t.after(() => runs.close());
  assert.equal((await runs.contextShared(id)).routes[0].name, 'Profile');
  await runs.retry(id, input);
  const result = await finished(runs, id);
  assert.equal(result.nodes[0].status, 'captured');
  assert.deepEqual(shots, ['Home']);
  assert.equal(JSON.parse(await readFile(join(directory, id, 'session.json'), 'utf8')).input.projectRoot, input.projectRoot);
});

test('a fade starting during screenshot capture retries in place and saves only a settled frame', async t => {
  const directory=await fixture(t);let shots=0,opens=0,checks=0;
  const runs=new AppFlowRuns({directory,scan:async()=>({...graph(),nodes:[graph().nodes[0]]}),connect:async()=>({
    runtime:{async invoke(command){
      if(command.type==='inspect')return{available:true};
      if(command.type==='open'){opens++;return{ready:true,name:'Home',active:['Home'],signature:'content',motion:'[0]'}}
      if(command.type==='verify')return{found:true,active:['Home'],motion:JSON.stringify([ [.25,.75,1,1][checks++] ?? 1 ])};
      return{};
    },async close(){}},
    async screenshot(){return Buffer.from(`frame-${++shots}`)},
  })});
  t.after(()=>runs.close());
  const {id}=runs.start(input),result=await finished(runs,id);
  assert.equal(result.nodes[0].status,'captured');
  assert.equal(opens,1,'recapture must not replay the navigation or restart the fade');
  assert.equal(shots,4);
  assert.equal((await runs.image(id,'home')).toString(),'frame-4');
});

test('device leases exclude other capture owners and release cleanly', async t => {
  const store = new FlowStore(await fixture(t));
  const first = await store.claim(input);
  assert.ok(first);
  assert.equal(await store.claim(input), undefined);
  await first.release();
  const second = await store.claim(input);
  assert.ok(second);
  await first.release(); // A late old release must not remove the new lease.
  assert.equal(await store.claim(input), undefined);
  await second.release();
  await assert.rejects(store.load('../not-a-run'), /Invalid App Flow run/);
});

test('Stop from another MCP process interrupts a long readiness wait', async t => {
  const directory = await fixture(t);
  let opening = false;
  const owner = new AppFlowRuns({ directory, scan: async () => graph(), connect: backend([], async () => {
    opening = true;
    return new Promise(() => {});
  }) });
  const client = new AppFlowRuns({ directory, connect: async () => { throw Error('Stop must not connect'); } });
  t.after(async () => { await owner.close(); await client.close(); });
  const { id } = owner.start(input);
  while (!opening) await delay(5);
  await client.stopShared(id);
  const result = await finished(owner, id);
  assert.equal(result.phase, 'stopped');
  assert.equal(result.nodes[0].image, undefined);
});

test('closing a run waits for an in-flight control read before releasing its files', {timeout:3000}, async t=>{
  const directory=await fixture(t);let opening=false,reading=false,reads=0,settled=false;
  let release!:(value:any[])=>void;
  const owner=new AppFlowRuns({directory,scan:async()=>graph(),connect:backend([],async()=>{opening=true;return new Promise(()=>{})})});
  t.mock.method((owner as any).store,'commands',async()=>{if(++reads!==2)return [];reading=true;return new Promise(resolve=>{release=resolve})});
  const {id}=owner.start(input);
  try {
    while(!opening||!reading)await delay(5);
    const done=(owner as any).sessions.get(id).done.then(()=>{settled=true});
    owner.stop(id);await delay(10);assert.equal(settled,false);
    release([]);await done;assert.equal(settled,true);
  } finally { release?.([]);await owner.close(); }
});
