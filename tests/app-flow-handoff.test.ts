import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scanAppFlow} from '../src/server/app-flow/scan.ts';

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

test('a conditional event prop retains its proven UI dismissal without approving either handler',async t=>{
  const root=await sourceFixture(t,`context.control.close(()=>onPress?.(event))`);
  await writeFile(join(root,'App.tsx'),`import {Item} from './menu';export function App(){const menu=useControl(),dialog=useControl();return <><Menu control={menu}><Item onPress={alreadyDone?mutateAccount:()=>dialog.open()}/></Menu><Dialog control={dialog}/></>}`);
  const graph=await scanAppFlow(root,'ios'),preview=graph.presentations!.previews!.find(a=>a.name==='Dialog');
  assert.equal(preview?.handoffs?.length,1,'The callback branch proves only which menu dismissal precedes this dialog');
  assert.ok(!graph.presentations!.actions.some(a=>a.name==='Dialog'),'The mixed event handler remains unapproved');
});
