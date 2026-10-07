import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createCaptureDriver} from '../src/server/app-flow/capture-driver.js';
import {captureSource} from '../src/server/app-flow/capture-source.ts';
import {sharedLoopRuntime} from './app-flow-runtime-fixtures.ts';

function fixture(factory=createCaptureDriver) {
  const events:any[]=[], frames:string[]=[];
  let signature='Home', motion='settled', loading=false, cleanup:Promise<void>|undefined, unavailable=false;
  const view=()=>({key:signature,signature,motion,active:['Home'],found:true,content:2,ready:!loading,loading,routeMatches:true});
  const runtime={invoke(command:any,reply:any){
    events.push(command);
    if(command.type==='presentation-rollback') {
      void Promise.resolve(cleanup).then(()=>{frames.splice(command.level);signature=frames.at(-1)??'Home';reply({});});
    } else if(command.type==='presentation-checkpoint')reply({level:frames.length});
    else if(command.type==='open')reply({...view(),name:'Home'});
    else reply(view());
  }};
  const source=async(request:any)=>{
    events.push(request);
    if(unavailable)return {error:'No live owner',status:'needs-data'};
    if(request.operation==='open'){frames.push(request.actionId);signature=request.actionId;return {view:view()};}
    return view();
  };
  const driver=factory(runtime,source);
  const job=(id:string,ids:string[]=[])=>({id,path:['Home'],actions:ids.map(id=>({id,effect:{kind:'state'},preview:true,consumer:{component:'SharedConsumer'}}))});
  return {driver,events,frames,job,view,source,runtime,
    loading:(next:boolean)=>{loading=next},signature:(next:string)=>{signature=next},motion:(next:string)=>{motion=next},
    cleanup:(next:Promise<void>)=>{cleanup=next},unavailable:()=>{unavailable=true}};
}
for(const factory of [createCaptureDriver,sharedLoopRuntime(createCaptureDriver as any) as any]) {
 const mode=factory===createCaptureDriver?'normal':'shared loop bindings';
 test(`shared consumers and nested preview steps use the same source opener (${mode})`,async()=>{
  const app=fixture(factory),signal=new AbortController().signal;
  const result=await app.driver.open(app.job('child',['sheet','shared-form']),signal);
  assert.equal(result.ready,true);
  assert.deepEqual(app.events.filter(event=>event.operation==='open').map(event=>event.actionId),['sheet','shared-form']);
  await app.driver.restore();assert.deepEqual(app.frames,[]);
 });
 test(`siblings keep the proven parent and roll back only their child (${mode})`,async()=>{
  const app=fixture(factory),signal=new AbortController().signal;
  await app.driver.open(app.job('first',['sheet','first']),signal);
  app.events.length=0;
  await app.driver.open(app.job('second',['sheet','second']),signal);
  assert.deepEqual(app.events.filter(event=>event.type==='presentation-rollback').map(event=>event.level),[1]);
  assert.deepEqual(app.events.filter(event=>event.operation==='open').map(event=>event.actionId),['second']);
  await app.driver.restore();assert.deepEqual(app.frames,[]);
 });
 test(`missing live context returns immediately without entering readiness waits (${mode})`,async()=>{
  const app=fixture(factory);app.unavailable();app.loading(true);
  const result=await app.driver.open({...app.job('missing',['missing']),path:[]},new AbortController().signal);
  assert.equal(result.status,'needs-data');
  assert.equal(app.events.some(event=>event.type==='presentation-view'&&event.waitMs),false);
  await app.driver.restore();
 });
 test(`cleanup remains pending until the shared native rollback completes (${mode})`,async()=>{
  const app=fixture(factory);await app.driver.open(app.job('sheet',['sheet']),new AbortController().signal);
  let complete:()=>void;app.cleanup(new Promise(resolve=>{complete=resolve}));
  let finished=false;const pending=app.driver.restore().then(()=>{finished=true});
  await delay(0);assert.equal(finished,false);assert.deepEqual(app.frames,['sheet']);
  complete!();await pending;assert.deepEqual(app.frames,[]);
 });
}

test('source requests use only the server recipe and wait for native handoff',async()=>{
  const events:string[]=[];let close:()=>void;
  const closed=new Promise(resolve=>{close=()=>resolve(undefined)});
  const action:any={id:'child',effect:{kind:'control'},handoffs:[{}]};
  const signal=new AbortController().signal;
  const backend:any={runtime:{async invoke(command:any){
    events.push(command.type);
    if(command.type==='presentation-prepare')return {available:true};
    if(command.type==='presentation-handoff'){await closed;return {closed:true};}
    if(command.type==='presentation-open')return {ready:true,key:'child'};
    return {};
  }}};
  const options:any={backend,job:{id:'child',path:['Home'],actions:[action]},catalog:{states:[],actions:[action]},projectRoot:'/fixture',sourceHash:'hash',signal};
  const opening=captureSource({...options,operation:'open',actionId:'child'});
  await delay(0);assert.deepEqual(events,['presentation-setup','presentation-prepare','presentation-handoff']);
  close!();assert.equal((await opening).closed,true);assert.equal(events.at(-1),'presentation-open');
  events.length=0;
  await assert.rejects(captureSource({...options,operation:'open',actionId:'not-in-recipe'}),/outside/);
  await assert.rejects(captureSource({...options,operation:'delete-account',actionId:'child'}),/outside/);
  await assert.rejects(captureSource({...options,operation:'project',actionId:'child'}),/approved projection/);
  assert.deepEqual(events,[]);
});

test('stopping during handoff cannot open the child after a late callback',async()=>{
  const controller=new AbortController(),events:string[]=[];let close:()=>void;
  const closed=new Promise(resolve=>{close=()=>resolve(undefined)});
  const backend:any={runtime:{async invoke(command:any){events.push(command.type);if(command.type==='presentation-prepare')return {available:true};if(command.type==='presentation-handoff')await closed;return {};}}};
  const opening=captureSource({backend,job:{id:'child',path:[],sourceViews:[],actions:[{id:'child',handoffs:[{}]} as any]},operation:'open',actionId:'child',catalog:{states:[],actions:[]},projectRoot:'/fixture',signal:controller.signal});
  await delay(0);controller.abort();close!();await assert.rejects(opening);
  assert.equal(events.includes('presentation-open'),false);
});

test('a source-bound route frame avoids another wait and rejects later loading or changed content',async()=>{
  const app=fixture(),controller=new AbortController();
  Object.defineProperty(controller.signal,'throwIfAborted',{value:undefined});
  const job=app.job('home');await app.driver.open(job,controller.signal);
  app.events.length=0;
  assert.equal((await app.driver.ready(job,controller.signal)).ready,true);
  assert.equal(app.events.some(event=>event.type==='open'),false);
  app.signature('changed');assert.equal((await app.driver.verify(job)).ready,false);
  assert.equal((await app.driver.ready(job,controller.signal)).ready,true);
  assert.equal(app.events.filter(event=>event.type==='open').length,1);
  app.loading(true);assert.equal((await app.driver.verify(job)).ready,false);
  controller.abort();await assert.rejects(app.driver.ready(job,controller.signal),/stopped/);
  await app.driver.restore();
});

test('native motion and a missing body cannot pass verification',async()=>{
  const app=fixture(),job=app.job('home'),signal=new AbortController().signal;
  await app.driver.open(job,signal);
  const before=await app.driver.ready(job,signal);
  app.motion('fading');assert.equal(app.driver.same(before,await app.driver.verify(job)),false);
  app.loading(true);assert.equal((await app.driver.verify(job)).ready,false);
  await app.driver.restore();
});


test('source preparation checks just the requested entry and keeps its failure reason',async()=>{
  const events:any[]=[],action:any={id:'form',effect:{kind:'mount',file:'Form.tsx',export:'Form'}};
  const backend:any={runtime:{async invoke(command:any){events.push(command);if(command.type==='presentation-prepare')return {available:false,error:'The opening state could not be bound to its source.'};return {};}}};
  const result=await captureSource({backend,job:{id:'form',path:[],actions:[action],sourceViews:[]},catalog:{states:[],actions:[action]},projectRoot:'/fixture',signal:new AbortController().signal,operation:'open',actionId:'form'});
  assert.equal(result.status,'needs-data');assert.match(result.error,/opening state/);
  assert.deepEqual(events.map(event=>event.type),['presentation-setup','presentation-prepare']);
  assert.equal(events[1].id,'form');
});

for(const factory of [createCaptureDriver,sharedLoopRuntime(createCaptureDriver as any) as any]) {
 const mode=factory===createCaptureDriver?'normal':'shared loop bindings';
 test(`cancelling a lost runtime callback stops opening and ignores its late reply (${mode})`,async()=>{
  let reply:any,opens=0,restores=0;
  const driver=factory({invoke(command:any,callback:any){
   if(command.type==='presentation-rollback'){restores++;callback({});}
   else if(command.type==='open')reply=callback;
   else assert.fail('A cancelled command must not continue');
  }},async()=>{opens++;return {view:{ready:true}}});
  const controller=new AbortController();
  const pending=driver.open({id:'child',path:['Home'],actions:[{id:'child'}]},controller.signal);
  const rejected=assert.rejects(pending,/Capture stopped/);
  await delay(0);assert.equal(typeof reply,'function');
  controller.abort();await rejected;
  reply({ready:true,active:['Home']});await delay(0);
  assert.equal(opens,0);await driver.restore();assert.equal(restores,2);
 });
}

test('a lost callback expires even when the inspector keeps answering heartbeats',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const driver=createCaptureDriver({invoke(){}},async()=>assert.fail('No source request expected'));
 const pending=driver.verify({path:[],actions:[]});
 const rejected=assert.rejects(pending,(error:any)=>error.interrupted===true&&error.fatal===true);
 t.mock.timers.tick(2001);await rejected;
});

for(const status of ['needs-data','timed-out','unrecognized'])test(`source open preserves missing-data failures without treating them as retries: ${status}`,async()=>{
  const action:any={id:'choice',effect:{kind:'state'}};
  const events:string[]=[];
  const backend:any={runtime:{async invoke(command:any){events.push(command.type);return command.type==='presentation-prepare'?{available:true}:command.type==='presentation-open'?{error:'No rendered choice',status}:{};}}};
  const result=await captureSource({backend,job:{id:'view',path:[],actions:[action],sourceViews:[]},operation:'open',actionId:'choice',catalog:{states:[],actions:[action]},projectRoot:'/app',signal:new AbortController().signal});
  assert.equal(result.status,status==='needs-data'?'needs-data':'timed-out');
  assert.deepEqual(events,['presentation-setup','presentation-prepare','presentation-open']);
});


test('in-app timing separates source, navigation, readiness and rollback without retaining app data',async()=>{
  const samples:{phase:string;ms:number}[]=[];
  const app=fixture((runtime,source)=>createCaptureDriver(runtime,source,(phase:string,ms:number)=>samples.push({phase,ms})));
  const job=app.job('private-job',['private-opening']),signal=new AbortController().signal;
  await app.driver.open(job,signal);await app.driver.ready(job,signal);await app.driver.verify(job,signal);await app.driver.restore();
  for(const phase of ['navigation','source','probe','checkpoint','rollback'])assert.ok(samples.some(value=>value.phase===phase),phase);
  assert.ok(samples.every(value=>Number.isFinite(value.ms)&&value.ms>=0));
  assert.equal(JSON.stringify(samples).includes('private'),false);
});


test('a failed diagnostic observer cannot stall an opening or its cleanup',async()=>{
  const app=fixture((runtime,source)=>createCaptureDriver(runtime,source,()=>{throw Error('diagnostics unavailable')}));
  const job=app.job('screen',['sheet']),signal=new AbortController().signal;
  assert.equal((await app.driver.open(job,signal)).ready,true);
  assert.equal((await app.driver.ready(job,signal)).ready,true);
  await app.driver.restore();assert.deepEqual(app.frames,[]);
});
