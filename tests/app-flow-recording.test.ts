import {QueuedAppFlowRuns as AppFlowRuns} from './app-flow-queue-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { type FlowStart } from '../src/server/app-flow/runs.ts';
import { flowRunning, type FlowGraph } from '../src/shared/app-flow.ts';

const input: FlowStart = {projectRoot:'/fixture',platform:'ios',deviceId:'device',targetId:'target',metroUrl:'http://127.0.0.1:8081',useAi:false};
async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 250; i++) { if (await check()) return; await delay(10); }
  assert.fail('Recording did not reach the expected state');
}
async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'flow-recording-'));
  const graph: FlowGraph = { files:1, scanMs:1, warnings:[], edges:[], nodes:[{id:'home', name:'Home', kind:'screen', path:['Home'], required:[], status:'pending', entry:true}] };
  let view = { key:'login', ready:true, signature:'Login content', title:'Sign in', active:[] as string[] };
  let shots = 0, disconnect = false, connections = 0, failures = 0, afterShot: (() => void) | undefined;
  const commands: string[] = [];
  const connect = async () => {
    connections++;
    if (failures > 0) { failures--; throw Error('Metro is restarting'); }
    return { target:{appId:'example.app',deviceId:'device'}, runtime:{
      async invoke(command: Record<string, any>) {
        commands.push(command.type);
        if (command.type === 'observe') { if (disconnect) { disconnect = false; throw Error('disconnected'); } return {...view}; }
        if (command.type === 'inspect') return {available:true, active:['Home'], entries:[['Home']]};
        return {ready:true,found:true,active:['Home'],name:'Home',signature:'Home'};
      }, async close() {},
    }, async screenshot() { shots++; const bytes = Buffer.from(view.signature); afterShot?.(); return bytes; } };
  };
  const owner = new AppFlowRuns({directory,connect,scan:async()=>structuredClone(graph)});
  const client = new AppFlowRuns({directory,connect,scan:async()=>structuredClone(graph)});
  t.after(async () => { await owner.close(); await client.close(); await rm(directory,{recursive:true,force:true,maxRetries:3}); });
  return {owner,client,commands, directory, get shots(){return shots}, get connections(){return connections},
    show(key: string, title = key, ready = true) { view = {key, title, ready, signature:`${title} content`, active:[]}; },
    disconnect(reconnectFailures = 0) {disconnect = true; failures = reconnectFailures;}, afterShot(callback?: () => void) { afterShot = callback; } };
}

test('recording captures local forms, waits for loading, deduplicates visits and connects observed steps', async t => {
  const app = await fixture(t);
  const run = await app.owner.record(input,'Sign-in flow');
  await until(() => app.owner.read(run.id).nodes.length === 1);
  app.show('reset','Forgot password',false);
  await delay(350);
  assert.equal(app.owner.read(run.id).nodes.length,1);
  app.show('reset','Forgot password');
  await until(() => app.owner.read(run.id).nodes.length === 2);
  app.show('login','Sign in');
  await until(() => app.owner.read(run.id).edges.length === 2);
  assert.equal(app.shots,2,'Returning to a known view must not capture another screenshot');
  const current = app.owner.read(run.id);
  assert.deepEqual(current.nodes.map(node => node.name),['Sign in','Forgot password']);
  assert.ok(current.nodes.every(node => node.capture === 'observed' && node.groupId === run.groups![0].id));
  assert.deepEqual(current.edges.map(edge => [edge.from,edge.to]),[[current.nodes[0].id,current.nodes[1].id],[current.nodes[1].id,current.nodes[0].id]]);
  await app.client.stopShared(run.id);
  await until(async () => !flowRunning(await app.client.readShared(run.id)));
  assert.equal((await app.client.readShared(run.id))?.phase,'complete');
  assert.ok(app.commands.every(command => command === 'observe'),'No navigation, auth, or recovery command is sent');
});

test('a cross-process capture request saves another state of the same component, with its chosen name', async t => {
  const app = await fixture(t), run = await app.owner.record(input,'Onboarding');
  await until(() => app.owner.read(run.id).nodes.length === 1);
  await app.client.captureStep(run.id,'Email entered');
  await until(() => app.owner.read(run.id).nodes.length === 2);
  const nodes = app.owner.read(run.id).nodes;
  assert.equal(nodes[1].name,'Email entered');
  assert.notEqual(nodes[0].image,nodes[1].image);
  await assert.rejects(app.client.retry(run.id),/Finish recording/);
  await assert.rejects(app.client.submit(run.id,[]),/Finish recording/);
});

test('recording rejects a changed screenshot and resumes observation after a connection drop', async t => {
  const app = await fixture(t);
  app.afterShot(() => { app.show('next','Next step'); app.afterShot(); });
  const run = await app.owner.record(input,'Sign in');
  await until(() => app.owner.read(run.id).nodes.length === 1);
  assert.equal(app.owner.read(run.id).nodes[0].name,'Next step');
  app.disconnect();
  await until(() => app.connections === 2);
  app.show('done','Welcome');
  await until(() => app.owner.read(run.id).nodes.length === 2);
  assert.equal(app.owner.read(run.id).nodes[1].name,'Welcome');
  assert.ok(app.commands.every(command => command === 'observe'));
});

test('recorded and automatic screens share a saved map without losing previews or navigating recorded forms', async t => {
  const app = await fixture(t), run = await app.owner.record(input,'Sign in');
  await until(() => app.owner.read(run.id).nodes.length === 1);
  await app.owner.stopShared(run.id);
  await until(() => !flowRunning(app.owner.read(run.id)));
  await app.owner.close();
  const original = (await app.client.readShared(run.id))!;
  await app.client.extend(run.id,input);
  await until(async () => !flowRunning(await app.client.readShared(run.id)));
  const merged = (await app.client.readShared(run.id))!;
  assert.equal(merged.nodes.length,2);
  assert.equal(merged.nodes.find(node => node.capture === 'observed')?.image,original.nodes[0].image);
  assert.equal(merged.nodes.find(node => node.id === 'home')?.status,'captured');
  assert.deepEqual(merged.groups,original.groups);
  assert.equal(app.commands.filter(command => command === 'open').length,1);
  await app.client.close();
  await assert.rejects(app.client.record({...input,projectRoot:'/other'},'Different app',run.id),/same project and device/);
});

test('a second recorder cannot take over the same device', async t => {
  const app = await fixture(t);
  await app.owner.record(input,'First');
  await assert.rejects(app.client.record(input,'Second'),/already running/);
});

test('a manual step requested during reconnect survives the connection wait', async t => {
  const app = await fixture(t), run = await app.owner.record(input,'Sign in');
  await until(() => app.owner.read(run.id).nodes.length === 1);
  app.disconnect(1);
  await until(() => app.owner.read(run.id).phase === 'reconnecting');
  await app.client.captureStep(run.id,'After reconnect');
  await until(() => app.owner.read(run.id).nodes.length === 2);
  assert.equal(app.owner.read(run.id).nodes[1].name,'After reconnect');
  await delay(300);
  assert.equal(app.owner.read(run.id).edges.length,1,'Idle observation must not add a false back edge after a manual step');
});
