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
      if(command.type==='recover'||command.type==='heartbeat'){if(generation===1)throw Error('disconnected');return {recovered:true};}
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

test('slow recovery with a healthy connection retries the route without reinstalling or blaming the app',async t=>{
  const {FlowRuntimeTimeout}=await import('../src/server/app-flow/runtime-metrics.ts');
  const opens:string[]=[],shots:string[]=[];let connections=0,recoveries=0,heartbeats=0,screen='Home';
  const runs=new AppFlowRuns({directory:await directory(t),scan:async()=>graph(),connect:async()=>{
    connections++;
    return {runtime:{async invoke(command){
      if(command.type==='inspect')return {available:true};
      if(command.type==='open'){
        screen=(command.path as string[])[0];opens.push(screen);
        if(screen==='Profile'&&opens.filter(name=>name==='Profile').length<3)throw new FlowRuntimeTimeout('open');
        return {ready:true,active:[screen],name:screen,signature:screen};
      }
      if(command.type==='recover'){recoveries++;throw new FlowRuntimeTimeout('recover');}
      if(command.type==='heartbeat'){heartbeats++;return {alive:true};}
      return {found:true,active:[screen]};
    },async close(){}},async screenshot(){shots.push(screen);return Buffer.from(screen)}};
  }});
  const run=runs.start(input);await until(()=>!flowRunning(runs.read(run.id)));await runs.close();
  assert.equal(connections,1);assert.equal(recoveries,2);assert.equal(heartbeats,2);
  assert.deepEqual(shots,['Home','Settings','Profile']);
  assert.equal(runs.read(run.id).nodes.find(n=>n.name==='Profile')?.captureAttempts,3);
  assert.equal(runs.read(run.id).phase,'complete');
});

test('Stop preserves a failed route reason while cancelling the next route',async t=>{
  let opening=false,release!:()=>void;
  const wait=new Promise<void>(resolve=>{release=resolve});
  const runs=new AppFlowRuns({directory:await directory(t),scan:async()=>graph(),connect:async()=>({
    runtime:{async invoke(command){
      if(command.type==='inspect')return {available:true};
      if(command.type==='open'){
        if((command.path as string[])[0]==='Home')return {ready:false,reason:'Screen is still loading (data).'};
        opening=true;await wait;return {ready:false};
      }
      return {recovered:true};
    },async close(){}},async screenshot(){throw Error('Unready screens must not capture')},
  })});
  t.after(async()=>{release();await runs.close()});
  const run=runs.start(input);await until(()=>opening);runs.stop(run.id);release();await runs.close();
  assert.equal(runs.read(run.id).nodes.find(n=>n.name==='Home')?.reason,'Screen is still loading (data).');
  assert.equal(runs.read(run.id).nodes.find(n=>n.name==='Profile')?.reason,'Run stopped.');
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

test('fatal app errors stop capture before saving an error overlay or opening later routes',async t=>{
  const {FlowAppFailure}=await import('../src/server/app-flow/runtime-metrics.ts');
  const path=await directory(t),opened:string[]=[],shots:string[]=[];
  let screen='Home',connections=0;
  const runs=new AppFlowRuns({directory:path,scan:async()=>graph(),connect:async()=>{
    connections++;
    return {runtime:{async invoke(command){
      if(command.type==='inspect')return {available:true};
      if(command.type==='open'){screen=(command.path as string[])[0];opened.push(screen);return {ready:true,active:[screen],name:screen,signature:screen};}
      if(command.type==='verify'&&screen==='Profile')throw new FlowAppFailure('verify');
      return {found:true,active:[screen]};
    },async close(){}},async screenshot(){shots.push(screen);return Buffer.from(screen)}};
  }});
  const run=runs.start(input);await until(()=>!flowRunning(runs.read(run.id)));await runs.close();
  const result=runs.read(run.id);
  assert.equal(result.phase,'failed');assert.match(result.error!,/fatal JavaScript error/);
  assert.equal(connections,1);assert.deepEqual(opened,['Home','Profile']);assert.deepEqual(shots,['Home','Profile']);
  assert.equal(result.nodes.find(node=>node.name==='Home')?.status,'captured');
  assert.equal(result.nodes.find(node=>node.name==='Profile')?.image,undefined);
  await assert.rejects(readFile(join(path,run.id,'Profile.png')),{code:'ENOENT'});
});

test('a fatal app error during reconnect ends the run instead of retrying forever',async t=>{
  const {FlowAppFailure}=await import('../src/server/app-flow/runtime-metrics.ts');
  let connections=0;
  const runs=new AppFlowRuns({directory:await directory(t),scan:async()=>graph(),connect:async()=>{
    connections++;
    return {runtime:{async invoke(command){
      if(command.type==='inspect')return {available:true};
      if(command.type==='resume')throw new FlowAppFailure('resume');
      throw Error('connection lost');
    },async close(){}},async screenshot(){throw Error('must not capture')}};
  }});
  const run=runs.start(input);await until(()=>!flowRunning(runs.read(run.id)));await runs.close();
  assert.equal(runs.read(run.id).phase,'failed');assert.equal(connections,2);
});

test('route and presentation retries preserve the failed runtime step in their saved reason',async t=>{
  const {FlowRuntimeTimeout}=await import('../src/server/app-flow/runtime-metrics.ts');
  const g=graph();g.nodes=g.nodes.slice(0,2);
  g.presentations={states:[],actions:[{id:'sheet',name:'Sheet',file:'App.tsx',line:1,owner:'App',component:'Button',prop:'onPress',effect:{kind:'control',component:'Sheet',prop:'control',method:'open',close:'close'}}]};
  let screen='Home';
  const runs=new AppFlowRuns({directory:await directory(t),scan:async()=>g,connect:async()=>({runtime:{async invoke(command){
    if(command.type==='inspect')return {available:true};
    if(command.type==='open'){
      screen=(command.path as string[])[0];
      if(screen==='Profile')throw new FlowRuntimeTimeout('open');
      return {ready:true,active:[screen],name:screen,signature:screen};
    }
    if(command.type==='presentations')return [{id:'sheet'}];
    if(command.type==='presentation-view')throw new FlowRuntimeTimeout('presentation-view');
    if(command.type==='presentation-active')return [];
    return {found:true,active:[screen]};
  },async close(){}},async screenshot(){return Buffer.from(screen)}})});
  const run=runs.start(input);await until(()=>!flowRunning(runs.read(run.id)));await runs.close();
  const nodes=runs.read(run.id).nodes;
  const route=nodes.find(n=>n.name==='Profile')!,sheet=nodes.find(n=>n.presentation)!;
  assert.equal(route.status,'timed-out');assert.match(route.reason!,/opening a route/);assert.equal(route.captureAttempts,3);
  assert.equal(sheet.status,'timed-out');assert.match(sheet.reason!,/checking presentation readiness/);assert.equal(sheet.captureAttempts,3);
});


test('a native screenshot failure keeps its own step and local evidence',async t=>{
  const {FlowRuntimeFailure}=await import('../src/server/app-flow/runtime-metrics.ts');
  const g=graph();g.nodes=g.nodes.slice(0,1);
  const runs=new AppFlowRuns({directory:await directory(t),scan:async()=>g,connect:async()=>({runtime:{async invoke(c){
    if(c.type==='inspect')return {available:true};
    return {ready:true,active:['Home'],name:'Home',signature:'Home',found:true};
  },async close(){}},async screenshot(){throw new FlowRuntimeFailure('screenshot','failed','Screenshot failed with HTTP 503.')}})});
  const run=runs.start(input);await until(()=>!flowRunning(runs.read(run.id)));await runs.close();
  const node=runs.read(run.id).nodes[0];assert.equal(node.status,'timed-out');assert.equal(node.captureAttempts,3);
  assert.match(node.reason!,/device screenshot/);assert.deepEqual(node.failure,{operation:'screenshot',detail:'Screenshot failed with HTTP 503.'});
});


test('failed native dismissal reconnects despite a healthy heartbeat and closes before navigation recovery',async t=>{
  const {FlowRuntimeFailure}=await import('../src/server/app-flow/runtime-metrics.ts');
  const g=graph();g.nodes=g.nodes.slice(0,1);
  g.presentations={states:[],actions:[{id:'sheet',name:'Sheet',file:'App.tsx',line:1,owner:'App',component:'Button',prop:'onPress',effect:{kind:'control',component:'Sheet',prop:'control',method:'open',close:'close'}}]};
  let connections=0,open=false,screen='Home';const events:string[]=[];
  const runs=new AppFlowRuns({directory:await directory(t),scan:async()=>g,connect:async()=>{
    const generation=++connections;
    return {runtime:{async invoke(command){
      const type=String(command.type);events.push(`${generation}:${type}`);
      if(type==='inspect'||type==='resume')return {available:true};
      if(type==='heartbeat')return {alive:true};
      if(type==='presentation-rollback'){
        if(open&&generation===1)throw new FlowRuntimeFailure(type,'was rejected','Native dismissal is still pending.');
        open=false;screen='Home';return {};
      }
      if(type==='recover'){assert.equal(open,false,'Native sheets must dismiss before route recovery');return {recovered:true};}
      if(type==='open'){assert.equal(open,false);return {ready:true,active:['Home'],name:'Home',signature:'Home'};}
      if(type==='presentations')return open?[]:[{id:'sheet'}];
      if(type==='presentation-active')return [];
      if(type==='presentation-open'){open=true;screen='Sheet';if(generation===1)throw new FlowRuntimeFailure(type);}
      if(type==='presentation-checkpoint')return {level:open?1:0};
      return {key:screen,ready:true,found:true,active:[screen],signature:screen};
    },async close(){}},async screenshot(){return Buffer.from(screen)}};
  }});
  const run=runs.start(input);await until(()=>!flowRunning(runs.read(run.id)));await runs.close();
  assert.equal(connections,2);assert.equal(runs.read(run.id).phase,'complete');
  assert.equal(runs.read(run.id).nodes.find(node=>node.presentation)?.status,'captured');
  assert.ok(events.indexOf('2:presentation-rollback')<events.indexOf('2:recover'));
});

test('diagnostics use the reconnected inspector while native dismissal is pending',async t=>{
  let connections=0,dismissing=false,released=false,release!:()=>void;
  const wait=new Promise<void>(resolve=>{release=()=>{released=true;resolve()}});
  const events:string[]=[];
  const runs=new AppFlowRuns({directory:await directory(t),scan:async()=>graph(),connect:async()=>{
    const generation=++connections;let screen='Home';
    return {runtime:{async invoke(command){
      const type=String(command.type);events.push(`${generation}:${type}`);
      if(type==='inspect'||type==='resume')return {available:true};
      if(type==='open'){screen=(command.path as string[])[0];if(generation===1&&screen==='Profile')throw Error('disconnected');return {ready:true,active:[screen],name:screen,signature:screen};}
      if((type==='heartbeat'||type==='recover')&&generation===1)throw Error('disconnected');
      if(type==='presentation-rollback'&&generation===2){dismissing=true;await wait;return {};}
      if(type==='diagnostics')return {generation,dismissalWaiters:released?0:1};
      if(type==='recover'&&generation===2)assert.equal(released,true);
      return {found:true,active:[screen]};
    },async close(){}},async screenshot(){return Buffer.from(screen)}};
  }});
  t.after(async()=>{release();await runs.close()});
  const run=runs.start(input);await until(()=>dismissing);
  assert.equal(runs.read(run.id).phase,'reconnecting');
  assert.deepEqual((await runs.diagnostics(run.id)).runtime,{generation:2,dismissalWaiters:1});
  release();await until(()=>!flowRunning(runs.read(run.id)));await runs.close();
  assert.equal(runs.read(run.id).phase,'complete');
  assert.ok(events.indexOf('2:diagnostics')<events.indexOf('2:recover'));
});

for(const failOpening of [false,true])test(`slow presentation cleanup resumes without reinstalling the live inspector (${failOpening?'failed opening':'captured sheet'})`,async t=>{
  const {FlowRuntimeTimeout}=await import('../src/server/app-flow/runtime-metrics.ts');
  const g=graph();g.nodes=g.nodes.filter(node=>node.name!=='Profile');
  const action:any={id:'sheet',name:'Details',file:'Home.tsx',line:1,owner:'Home',component:'Button',prop:'onPress',effect:{kind:'control',component:'Details',prop:'control',method:'open',close:'close'}};
  g.presentations={states:[],actions:[action]};
  let connections=0,heartbeats=0,closeRequests=0,openingFailures=0,cleanupFailed=false,level=0,screen='Home';
  const view=()=>({ready:true,found:true,active:[screen],key:level?'Details':screen,signature:level?'details-body':screen});
  const runs=new AppFlowRuns({directory:await directory(t),scan:async()=>g,connect:async()=>{
    connections++;
    return {runtime:{async invoke(command){
      if(command.type==='inspect')return {available:true};
      if(command.type==='open'){assert.equal(level,0,'Never navigate under a sheet that is still closing');screen=(command.path as string[])[0];return {...view(),name:screen};}
      if(command.type==='presentations')return screen==='Home'&&level===0?[action]:[];
      if(command.type==='presentation-checkpoint')return {level};
      if(command.type==='presentation-open'){level=1;if(failOpening&&openingFailures++===0)return {error:'Body not available yet'};return view();}
      if(command.type==='presentation-rollback'){
        if(level){closeRequests++;if(!cleanupFailed){cleanupFailed=true;throw new FlowRuntimeTimeout('presentation-rollback');}}
        level=0;return {};
      }
      if(command.type==='heartbeat'){heartbeats++;return {alive:true};}
      return view();
    },async close(){}},async screenshot(){return Buffer.from(view().key)}};
  }});
  const run=runs.start(input);await until(()=>!flowRunning(runs.read(run.id)));await runs.close();
  assert.equal(runs.read(run.id).phase,'complete');assert.equal(connections,1);
  assert.equal(heartbeats,1);assert.ok(closeRequests>=2);assert.equal(level,0);
  assert.ok(runs.read(run.id).nodes.every(node=>node.status==='captured'));
});
