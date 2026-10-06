import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scanAppFlow} from '../src/server/app-flow/scan.ts';
import {createCaptureDriver} from '../src/server/app-flow/capture-driver.js';
import {createFlowRegistry} from '../src/server/app-flow/instrumentation-registry.js';
import {setTimeout as delay} from 'node:timers/promises';

function fixture() {
  const events:string[]=[], registry=createFlowRegistry(), owner=registry.create('App','hash');
  let afterClose:(()=>void)|undefined,visible='';
  const location=(line:number)=>({line,column:0,endLine:line,endColumn:100});
  const menu={open(){visible='menu';events.push('menu-open')},close(callback?:()=>void){visible='';events.push('menu-close');afterClose=callback;}};
  const dialog={open(){visible='dialog';events.push('dialog-open')},close(){visible='';events.push('dialog-close')}};
  registry.stage(owner,'App.tsx:2:0:control',{kind:'control',control:menu});
  registry.stage(owner,'App.tsx:4:0:control',{kind:'control',control:dialog});
  registry.stage(owner,'App.tsx:3:0:handoff',{kind:'entry'});registry.commit(owner);
  const parent={id:'menu',effect:{kind:'control',method:'open',close:'close',prop:'control',target:{file:'App.tsx',source:location(2)}}};
  const child={id:'dialog',effect:{kind:'control',method:'open',close:'close',prop:'control',target:{file:'App.tsx',source:location(4)}},handoffs:[{file:'App.tsx',source:location(3)}]};
  const driver=createCaptureDriver({invoke(){assert.fail('This fixture needs no navigation')}},registry,(target:any)=>target.within?{contained:target.within===`${owner.id}:App.tsx:2:0:control`}:{ready:!!visible,found:!!visible,signature:visible,key:visible});
  return {events,driver,parent,child,closeCompleted:()=>afterClose?.()};
}

test('a source-proven menu handoff waits for dismissal before opening its sibling dialog',async()=>{
  const app=fixture(),signal=new AbortController().signal;
  await app.driver.open({path:[],actions:[app.parent]},signal);
  const opened=app.driver.open({path:[],actions:[app.parent,app.child]},signal);await delay(0);
  assert.deepEqual(app.events,['menu-open','menu-close']);
  app.closeCompleted();await opened;
  assert.deepEqual(app.events,['menu-open','menu-close','dialog-open']);
  await app.driver.restore();
  assert.deepEqual(app.events,['menu-open','menu-close','dialog-open','dialog-close']);
});

test('cancellation prevents a late dismissal callback from opening the child',async()=>{
  const app=fixture(),controller=new AbortController();
  await app.driver.open({path:[],actions:[app.parent]},controller.signal);
  const opened=app.driver.open({path:[],actions:[app.parent,app.child]},controller.signal);await delay(0);
  controller.abort();app.closeCompleted();await assert.rejects(opened);
  await app.driver.restore();assert.ok(!app.events.includes('dialog-open'));
});

async function sourceFixture(t:test.TestContext,wrapper:string,handler='()=>dialog.open()') {
  const root=await mkdtemp(join(tmpdir(),'flow-handoff-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const files={'env.ts':`import {Platform} from 'react-native';export const APPLE=Platform.OS==='ios';export const ANDROID=Platform.OS==='android';`,
    'menu.tsx':`import {useContext,createContext} from 'react';import {APPLE,ANDROID} from './env';const Context=createContext(null);function useMenu(){const value=useContext(Context);if(!value)throw Error('context missing');return value}export function Item({onPress}){const context=useMenu();return <Pressable onPress={event=>{${wrapper}}}/>}`,
    'App.tsx':`import {Item} from './menu';export function App(){const menu=useControl(),dialog=useControl();const open=${handler};return <><Button onPress={()=>menu.open()}/><Menu control={menu}><Item onPress={open}/></Menu><Dialog control={dialog}/></>}`};
  for(const [file,source]of Object.entries(files)){await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),source);}
  return root;
}

test('source follows a platform alias and proves only the close-then-forward wrapper',async t=>{
  const root=await sourceFixture(t,`if(ANDROID){onPress?.(event);context.control.close()}else if(APPLE){context.control.close(()=>{onPress?.(event)})}`);
  const ios=await scanAppFlow(root,'ios'),android=await scanAppFlow(root,'android');
  const find=(graph:any)=>[...graph.presentations.actions,...graph.presentations.previews].find((action:any)=>action.effect.kind==='control'&&action.name==='Dialog');
  assert.deepEqual(find(ios).handoffs?.map((h:any)=>({component:h.component,contextPath:h.contextPath,close:h.close})),[{component:'Item',contextPath:['control'],close:'close'}]);
  assert.equal(find(android).handoffs,undefined,'An open-first platform branch must not become a close-first handoff');
});

test('source can link a guarded opening without ever approving its mutation handler',async t=>{
  const root=await sourceFixture(t,`context.control.close(()=>onPress?.(event))`,`()=>{if(needsWarning){dialog.open()}else{mutateAccount()}}`);
  const graph=await scanAppFlow(root,'ios');
  assert.ok(!graph.presentations!.actions.some(a=>a.name==='Dialog'));
  const preview=graph.presentations!.previews!.find(a=>a.name==='Dialog');
  assert.equal(preview?.handoffs?.length,1,'Only the known UI control dismissal is approved');
});

for(const wrapper of [`context.control.close(()=>{mutateAccount();onPress?.(event)})`,`sendAnalytics();context.control.close(()=>onPress?.(event))`,`if(unprovenFlag){context.control.close(()=>onPress?.(event))}`,`context.control.close(()=>onPress?.(getEvent()))`])test(`source refuses an unproved wrapper: ${wrapper}`,async t=>{
  const root=await sourceFixture(t,wrapper),graph=await scanAppFlow(root,'ios');
  assert.ok([...graph.presentations!.actions,...graph.presentations!.previews!].every(action=>!action.handoffs?.length));
});

test('capture supports React Native AbortSignal without throwIfAborted',async()=>{
  const app=fixture(),controller=new AbortController();
  Object.defineProperty(controller.signal,'throwIfAborted',{value:undefined});
  const result=await app.driver.open({id:'menu',path:[],actions:[app.parent]},controller.signal);
  assert.equal(result.ready,true);
  await app.driver.restore();
});

test('dismissal waits for native completion even when the body leaves its source marker mounted',async()=>{
  const registry=createFlowRegistry(),owner=registry.create('Screen','hash');
  let opened=false,pending=false;
  const control={open(){opened=true},close(){opened=false;pending=true;setTimeout(()=>{pending=false},70)}};
  registry.stage(owner,'screen:1:0:control',{kind:'control',control});registry.commit(owner);
  const driver=createCaptureDriver({invoke(){}},registry,()=>({found:true,hosts:opened?2:0,content:opened?1:0,ready:opened,nativePending:pending,key:'sheet',signature:String(opened)}));
  await driver.open({id:'sheet',path:[],actions:[{id:'open',effect:{kind:'control',method:'open',close:'close',prop:'control',target:{file:'screen',source:{line:1,column:0}}}}]},new AbortController().signal);
  const started=Date.now();await driver.restore();
  assert.ok(Date.now()-started>=70);assert.equal(pending,false);
});

test('state preview inside an open sheet stays explicit instead of mounting outside its native parent',async()=>{
  const registry=createFlowRegistry(),owner=registry.create('Screen','hash');
  let visible=false,projects=0;
  registry.project=async()=>{projects++};
  registry.stage(owner,'sheet:1:0:control',{kind:'control',control:{open(){visible=true},close(){visible=false}}});
  registry.stage(owner,'step',{kind:'state',hook:'useState',tuple:[0,()=>{}]});registry.commit(owner);
  const driver=createCaptureDriver({invoke(){}},registry,()=>({ready:visible,found:visible,hosts:visible?1:0,content:visible?1:0,key:'sheet',signature:String(visible)}));
  const result=await driver.open({id:'step',path:[],actions:[{id:'open',effect:{kind:'control',method:'open',close:'close',prop:'control',target:{file:'sheet',source:{line:1,column:0}}}},{id:'step',name:'Step',preview:true,effect:{kind:'state',site:'step',path:[],value:1}}]},new AbortController().signal);
  assert.equal(result.status,'needs-data');assert.equal(projects,0);
  await driver.restore();assert.equal(visible,false);
});

test('two source sites sharing one controller open and dismiss that native sheet once',async()=>{
  const registry=createFlowRegistry(),owner=registry.create('Screen','hash');
  let visible=false,opens=0,closes=0;
  const control={open(){assert.equal(visible,false);visible=true;opens++},close(){assert.equal(visible,true);visible=false;closes++}};
  for(const line of [1,2])registry.stage(owner,`sheet:${line}:0:control`,{kind:'control',control});
  registry.commit(owner);
  const driver=createCaptureDriver({invoke(){}},registry,()=>({ready:visible,found:visible,hosts:visible?1:0,key:'sheet',signature:String(visible)}));
  const actions=[1,2].map(line=>({id:`site-${line}`,effect:{kind:'control',method:'open',close:'close',prop:'control',target:{file:'sheet',source:{line,column:0}}}}));
  assert.equal((await driver.open({id:'sheet',path:[],actions},new AbortController().signal)).ready,true);
  await driver.restore();assert.equal(opens,1);assert.equal(closes,1);
});

test('a burst of source commits schedules one readiness check and cancels its wake on stop',async()=>{
  const registry=createFlowRegistry();let reads=0;
  const driver=createCaptureDriver({invoke(){}},registry,()=>{reads++;return {ready:false,found:false,key:'waiting'}});
  const controller=new AbortController();const ready=driver.ready({id:'waiting',path:[]},controller.signal);const initial=reads;
  for(let i=0;i<100;i++)registry.commit(registry.create('Row','hash'));
  assert.equal(reads,initial,'Layout effects must not each traverse and measure the app');
  await delay(5);assert.equal(reads,initial+1);
  registry.commit(registry.create('Last','hash'));controller.abort();
  await assert.rejects(ready,/stopped/);await delay(5);assert.equal(reads,initial+1,'Stopping cancels the queued source wake');
});

test('cleanup keeps each owner and setter when the evaluator shares loop bindings',async()=>{
  const {sharedLoopRuntime}=await import('./app-flow-runtime-fixtures.ts');
  const factory=sharedLoopRuntime(createCaptureDriver as any) as any;
  const registry=createFlowRegistry(),events:string[]=[];
  for(const id of ['one','two']){
    const owner=registry.create(id,'hash');
    registry.stage(owner,id,{kind:'state',hook:'useState',tuple:[false,(value:boolean)=>events.push(`${id}:${value}`)]});registry.commit(owner);
  }
  const driver=factory({invoke(){}},registry,()=>({ready:true,found:true,key:'view',signature:'stable'}));
  const actions=['one','two'].map(id=>({id,effect:{kind:'state',site:id,path:[],value:true}}));
  await driver.open({id:'steps',path:[],actions},new AbortController().signal);
  await driver.restore();
  assert.deepEqual(events,['one:true','two:true','two:false','one:false']);
});

test('a handoff through a duplicate source site still closes the actual parent before opening a child',async()=>{
  const app=fixture(),signal=new AbortController().signal;
  const alias={...app.parent,id:'menu-alias'};
  await app.driver.open({id:'alias',path:[],actions:[app.parent,alias]},signal);
  const opening=app.driver.open({id:'child',path:[],actions:[app.parent,alias,app.child]},signal);
  await delay(0);assert.deepEqual(app.events,['menu-open','menu-close']);
  app.closeCompleted();await opening;await app.driver.restore();
  assert.deepEqual(app.events,['menu-open','menu-close','dialog-open','dialog-close']);
});


test('a verified navigation frame avoids a second settling wait only while it still matches',async()=>{
  const registry=createFlowRegistry();
  let current:any={ready:true,key:'Home',signature:'loaded',motion:'settled'};
  const runtime={invoke(_command:any,reply:any){reply({...current});}};
  const driver=createCaptureDriver(runtime,registry,(target:any)=>target.nativeStart?{}:current);
  const signal=new AbortController().signal,job={id:'home',path:['Home'],params:{},actions:[]};
  assert.equal((await driver.open(job,signal)).ready,true);
  let settled=false;const first=driver.ready(job,signal).then((value:any)=>{settled=true;return value;});
  await Promise.resolve();assert.equal(settled,true,'The route already supplied its loading, motion and paint proof');
  await first;
  current={...current,signature:'changed'};
  settled=false;const second=driver.ready(job,signal).then((value:any)=>{settled=true;return value;});
  await Promise.resolve();assert.equal(settled,false,'Changed content must settle again');
  assert.equal((await second).signature,'changed');
  current={...current,ready:false,loading:true};
  const controller=new AbortController();const third=driver.ready(job,controller.signal);
  controller.abort();await assert.rejects(third,/stopped/);
  await driver.restore();
});
