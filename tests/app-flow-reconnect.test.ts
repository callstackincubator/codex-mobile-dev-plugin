import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AppFlowRuns, type FlowStart } from '../src/server/app-flow/runs.ts';
import { reconnectFlowTarget } from '../src/server/app-flow/target.ts';
import { flowProgress, flowRunning, type FlowGraph } from '../src/shared/app-flow.ts';

const input: FlowStart = {projectRoot:'/fixture',platform:'ios',deviceId:'device',targetId:'old-target',metroUrl:'http://127.0.0.1:8081',useAi:false};
const graph = (): FlowGraph => ({files:1,scanMs:1,warnings:[],edges:[],nodes:['Home','Profile','Settings'].map(name=>({id:name,name,kind:'screen',path:[name],required:[],status:'pending'}))});
async function until(check:()=>boolean) { for(let i=0;i<200&&!check();i++)await delay(10); assert.ok(check()); }
async function directory(t: test.TestContext) { const path=await mkdtemp(join(tmpdir(),'flow-reconnect-'));t.after(()=>rm(path,{recursive:true,force:true}));return path; }

test('disconnect saves progress, reconnects to the same run, and resumes the interrupted screen',async t=>{
  const path=await directory(t),shots:string[]=[],sessions:string[]=[],closures:boolean[]=[],target={appId:'example.app',deviceId:'logical-device'};
  let connections=0,release!:()=>void;
  const wait=new Promise<void>(resolve=>{release=resolve});
  const runs=new AppFlowRuns({directory:path,scan:async()=>graph(),connect:async(_input,_signal,resume)=>{
    const generation=++connections;sessions.push(resume!.sessionId);
    if(generation===2){assert.deepEqual(resume?.target,target);await wait;}
    let screen='Home';
    return {target,runtime:{async invoke(command){
      if(command.type==='inspect'||command.type==='resume')return {available:true};
      if(command.type==='recover'){if(generation===1)throw Error('disconnected');return {recovered:true};}
      if(command.type==='open'){screen=(command.path as string[])[0];if(generation===1&&screen==='Profile')throw Error('disconnected');return {ready:true,active:[screen],name:screen,signature:screen};}
      return {found:true,active:[screen]};
    },async close(options){closures.push(options?.restore!==false)}},async screenshot(){shots.push(screen);return Buffer.from(screen)}};
  }});
  const run=runs.start(input);await until(()=>connections===2);
  assert.equal(runs.read(run.id).phase,'reconnecting');assert.equal(flowRunning(runs.read(run.id)),true);
  const saved=JSON.parse(await readFile(join(path,run.id,'map.json'),'utf8'));
  assert.equal(saved.nodes[0].status,'captured');assert.equal(saved.phase,'reconnecting');
  release();await until(()=>!flowRunning(runs.read(run.id)));await runs.close();
  const result=runs.read(run.id);
  assert.equal(result.phase,'complete');assert.deepEqual(shots,['Home','Profile','Settings']);
  assert.deepEqual(sessions,[run.id,run.id]);assert.deepEqual(closures,[false,true]);
  assert.deepEqual(flowProgress(result),{captured:3,queued:0,discovered:3,needsData:0,unsuccessful:0});
  const active=(runs as any).sessions.get(run.id);
  assert.equal(active.runtime,undefined);assert.equal(active.writing.size,0);
});

test('Stop cancels reconnect backoff and saves the existing map',async t=>{
  let connections=0;
  const runs=new AppFlowRuns({directory:await directory(t),scan:async()=>graph(),connect:async()=>{
    if(++connections>1)throw Error('Metro is restarting');
    return {runtime:{async invoke(command){if(command.type==='inspect')return {available:true};throw Error('lost connection')},async close(){}},async screenshot(){throw Error('must not capture')}};
  }});
  const run=runs.start(input);await until(()=>connections===2);runs.stop(run.id);await runs.close();
  assert.equal(runs.read(run.id).phase,'stopped');assert.equal(connections,2);
});

test('the unfiltered registration graph is never published during connection setup',async t=>{
  let release!:(value:any)=>void;
  const wait=new Promise<any>(resolve=>{release=resolve});
  const runs=new AppFlowRuns({directory:await directory(t),scan:async()=>graph(),connect:async()=>wait});
  const run=runs.start(input);await until(()=>runs.read(run.id).phase==='connecting');
  assert.deepEqual(runs.read(run.id).nodes,[]);assert.deepEqual(runs.read(run.id).edges,[]);
  runs.stop(run.id);await runs.close();
  let closed=false;
  release({runtime:{async invoke(){return {}},async close(){closed=true}},async screenshot(){return Buffer.alloc(0)}});
  await until(()=>closed);
});

test('target refresh follows app restarts but rejects other apps and ambiguous devices',()=>{
  const previous={appId:'example.app',deviceName:'iPhone',deviceId:'old-logical'};
  const correct={id:'new',appId:'example.app',deviceName:'iPhone',deviceId:'new-logical'};
  const other={id:'other',appId:'different.app',deviceName:'iPhone',deviceId:'new-logical'};
  assert.equal(reconnectFlowTarget([other,correct],'old',previous),correct);
  assert.equal(reconnectFlowTarget([other],'old',previous),undefined);
  assert.equal(reconnectFlowTarget([correct,{...correct,id:'duplicate'}],'old',previous),undefined);
  assert.equal(reconnectFlowTarget([{...correct,deviceName:'other phone'}],'old',previous),undefined);
  assert.equal(reconnectFlowTarget([{id:'same',deviceId:'device'}],'same',{deviceId:'device'})?.id,'same');
});

test('progress reports discovered work without treating it as a fixed total',()=>{
  const run:any={...graph(),phase:'capturing'};run.nodes[0].status='captured';run.nodes[1].status='needs-data';
  assert.deepEqual(flowProgress(run),{captured:1,queued:1,discovered:3,needsData:1,unsuccessful:0});
  run.nodes.push({...run.nodes[2],id:'new'});
  assert.deepEqual(flowProgress(run),{captured:1,queued:2,discovered:4,needsData:1,unsuccessful:0});
});
