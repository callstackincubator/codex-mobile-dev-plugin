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
