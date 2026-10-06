import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,readdir,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {scanAppFlow} from '../src/server/app-flow/scan.ts';
import {FlowStore} from '../src/server/app-flow/store.ts';
import {flowProgressRun} from '../src/shared/app-flow.ts';
import {installPresentationRuntime} from '../src/server/app-flow/presentations-runtime.js';
import {bindPresentationSites} from '../src/server/app-flow/presentations-bindings.ts';
import {sharedLoopRuntime} from './app-flow-runtime-fixtures.ts';
import {compareViewReference} from '../scripts/lib/compare-app-flow-views.mjs';

async function fixture(t:test.TestContext,files:Record<string,string>){
  const root=await mkdtemp(join(tmpdir(),'source-views-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const [file,source]of Object.entries(files)){await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),source);}return root;
}

test('finite reducer fields cross tuple contexts, returned custom hooks and JSX props without dispatching',async t=>{
  const root=await fixture(t,{
    'state.tsx':`import {createContext,useContext,useReducer} from 'react';
      export const Context=createContext(null);
      interface State {step:'start'|'verify'|'done'}
      function reducer(state:State,action):State{throw Error('never dispatch')}
      export function useFlow(){return useReducer(reducer,{step:'start'})}
      export function Provider({children}){const [state,dispatch]=useFlow();return <Context.Provider value={[state,dispatch]}>{children}</Context.Provider>}
      export const useFlowContext=()=>useContext(Context);`,
    'App.tsx':`import {useFlowContext} from './state';import {Body} from './Body';export function App(){const [state]=useFlowContext();return <Body state={state}/>}`,
    'Body.tsx':`export function Body({state}){return <>{state.step==='start'?<Start/>:state.step==='verify'?<Verify/>:<Done/>}</>}`,
  });
  const graph=await scanAppFlow(root,'ios'),catalog=graph.presentations!;
  const site=catalog.viewStates!.find(s=>s.owner==='useFlow')!;
  assert.deepEqual(new Set(catalog.views!.filter(v=>v.state?.site===site.id).map(v=>v.state?.value)),new Set(['start','verify','done']));
  assert.ok(catalog.views!.filter(v=>v.state?.site===site.id).every(v=>v.state?.path.join('.')==='step'));
  assert.ok(site.ownerSites?.some(owner=>owner.file==='state.tsx'&&owner.owner==='Provider'));
  assert.ok(site.ownerSites?.some(owner=>owner.file==='App.tsx'&&owner.owner==='App'));
  assert.equal(catalog.actions.length,0);assert.equal(catalog.states.length,0);
});

test('private hook owners are collected only after their own JSX source has been verified',async t=>{
  const root=await fixture(t,{
    'Forms.tsx':`import {useState} from 'react';function Inner(){const [step]=useState('start');return step==='start'?<Start/>:<Finish/>}export function Outer(){return <Inner/>}`,
    'Other.tsx':`function Inner(){return <Unrelated/>}export function Other(){return <Inner/>}`,
  });
  const catalog=(await scanAppFlow(root,'ios')).presentations!;
  const site=catalog.viewStates!.find(site=>site.file==='Forms.tsx'&&site.owner==='Inner')!;
  const own=site.ownerEntries?.find(entry=>entry.file==='Forms.tsx'&&entry.component==='Inner');assert.ok(own);
  for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
    function Inner(){}const OtherInner=function Inner(){};
    const wanted:any={type:Inner,memoizedProps:{},memoizedState:null,_debugSource:{fileName:join(root,'Forms.tsx'),lineNumber:own.source.line,columnNumber:own.source.column+1}};
    const unrelated:any={type:OtherInner,memoizedProps:{},memoizedState:null,_debugSource:{fileName:join(root,'Other.tsx'),lineNumber:1,columnNumber:1}};
    const react={createElement(){},useState(){return [false,()=>{}]},useReducer(){}};let live:any;const calls:any[]=[];
    const modules=new Map([[1,{isInitialized:true,publicModule:{exports:react}}]]);
    const previous=(globalThis as any).__r;(globalThis as any).__r={getModules:()=>modules};t.after(()=>{(globalThis as any).__r=previous});
    const renderer={rendererPackageName:'react-native-renderer',getCurrentFiber:()=>live,scheduleUpdate(fiber:any){calls.push(fiber);live=fiber;react.useState();live=undefined;}};
    const runtime=install({hook:{renderers:new Map([[1,renderer]])},fibers(visit:any){visit(wanted);visit(unrelated)},hidden:()=>false,later:setTimeout});t.after(()=>runtime.cleanup());
    const first=await runtime.collect([site],[],root);
    assert.deepEqual(calls,[],'Private owners must not be forced before source proof arrives');
    const matches=await bindPresentationSites('http://127.0.0.1:8081',root,first.bindings,[site]);
    assert.equal(matches.filter(match=>match.site===`owner:${site.id}:Inner`).length,1);
    runtime.configure({states:[site],actions:[]},matches,first.bindings.map(binding=>binding.id));
    const second=await runtime.collect();
    assert.deepEqual(calls,[wanted]);assert.equal(second.bindings.filter(binding=>binding.kind==='useState').length,1);
    await runtime.collect();assert.deepEqual(calls,[wanted],'Already tracked owners are not rendered twice');
    runtime.cleanup();(globalThis as any).__r=previous;
  }
});

test('enum fallback and early return retain their own body and exact finite state',async t=>{
  const root=await fixture(t,{'App.tsx':`import {useReducer,useState} from 'react';enum Step {Info,Handle,Challenge}
    export function App(){const [state]=useReducer(reducer,{});return state.step===Step.Info?<Info/>:state.step===Step.Handle?<Handle/>:<Challenge/>}
    export function Gate(){const [override]=useState(false);if(!data||override)return <Content/>;return <Blocked/>}`});
  const graph=await scanAppFlow(root,'ios'),c=graph.presentations!;
  const app=c.viewStates!.find(s=>s.owner==='App')!,gate=c.viewStates!.find(s=>s.owner==='Gate')!;
  assert.deepEqual(new Set(c.views!.filter(v=>v.state?.site===app.id).map(v=>v.state?.value)),new Set([0,1,2]));
  assert.ok(c.views!.some(v=>v.state?.site===gate.id&&v.state.value===false&&v.branch?.side==='false'));
});

test('source-only branch and component matching requires body, condition, side and a real JSX caller',async t=>{
  const root=await fixture(t,{'App.tsx':`import {Restricted} from './Restricted';export function App(){return allowed?<Main/>:<Restricted/>}`,
    'Restricted.tsx':`export function Restricted(){return <Unavailable/>} export function Unused(){return <Debug/>}`});
  const graph=await scanAppFlow(root,'ios');
  const row=(id:string,selectors:any[])=>({id,category:'auth-guard',selectors});
  const ref={views:[
    row('restricted',[{component:{file:'Restricted.tsx',name:'Restricted',entry:{file:'App.tsx',line:1}}}]),
    row('unused',[{component:{file:'Restricted.tsx',name:'Unused',entry:{file:'App.tsx',line:1}}}]),
    row('wrong-condition',[{branch:{file:'App.tsx',condition:'invented',side:'false',line:1}}]),
    row('wrong-side',[{branch:{file:'App.tsx',condition:'allowed',side:'true',line:2}}]),
  ]};
  const result=compareViewReference(graph,ref,()=>[]);
  assert.deepEqual(result.rows.map((r:any)=>r.status),['matched','missing','missing','missing']);
  assert.equal(result.actionableViews,0);assert.equal(result.sourceOnlyViews,1);
});

test('two same-named mounted sheets bind and open only their own source target',async t=>{
  const rootPath=await fixture(t,{'App.tsx':`export function App(){const first=useControl(),second=useControl();return <><Button onPress={()=>first.open()}/><Button onPress={()=>second.open()}/><Basic control={first}/><Basic control={second}/></>}`});
  const catalog=(await scanAppFlow(rootPath,'ios')).presentations!;
  assert.equal(catalog.actions.length,2);
  function App(){}function Button(){}function Basic(){}
  const root:any={type:App,memoizedProps:{}};
  const controls=[{openCount:0,closeCount:0,open(){this.openCount++},close(){this.closeCount++}},{openCount:0,closeCount:0,open(){this.openCount++},close(){this.closeCount++}}];
  const source=(loc:any)=>({fileName:join(rootPath,'App.tsx'),lineNumber:loc.line,columnNumber:loc.column+1});
  const items:any[]=[];
  for(const [i,action]of catalog.actions.entries()){
    assert.equal(action.effect.kind,'control');if(action.effect.kind!=='control')continue;
    items.push({type:Button,return:root,memoizedProps:{onPress(){throw Error('never click')}},_debugSource:source(action.source)});
    items.push({type:Basic,return:root,memoizedProps:{control:controls[i]},_debugSource:source(action.effect.target!.source)});
  }
  root.child=items[0];items.forEach((f,i)=>{f.sibling=items[i+1]});
  const fibers=(visit:any,subtree?:any)=>{const stack=[subtree??root];while(stack.length){const f=stack.pop();if(f!==subtree&&f.sibling)stack.push(f.sibling);if(visit(f)!==false&&f.child)stack.push(f.child)}};
  const runtime=installPresentationRuntime({hook:{renderers:new Map()},fibers,hidden:()=>false,later:setTimeout});t.after(()=>runtime.cleanup());
  const records=await runtime.collect([],catalog.actions);
  const matches=await bindPresentationSites('http://127.0.0.1:8081',rootPath,records.bindings,[],catalog.actions);
  runtime.configure(catalog,matches,records.bindings.map(b=>b.id));
  assert.equal(runtime.list().length,2);
  runtime.open(catalog.actions[0].id);assert.deepEqual(controls.map(c=>c.openCount),[1,0]);
  await runtime.rollback(0,false);assert.deepEqual(controls.map(c=>c.closeCount),[1,0]);
  runtime.open(catalog.actions[1].id);assert.deepEqual(controls.map(c=>c.openCount),[1,1]);
});

test('the immutable catalog saves once, restores for inspection and stays out of map polling',async t=>{
  const path=await fixture(t,{}),store=new FlowStore(path),id=randomUUID();
  const views:any[]=[{id:'proof',availability:'observed-only'}];
  const actions:any[]=[{id:'open-sheet',effect:{kind:'control',component:'Sheet',prop:'control',method:'open',close:'close'}}];
  const run:any={id,phase:'complete',revision:1,nodes:[],edges:[],warnings:[],links:[{target:'sheet',owner:'Home',guarded:false}],presentations:{states:[],actions,views,viewStates:[]}};
  await store.save({run});
  const files=await readdir(join(path,id)),source=files.find(f=>f.startsWith('source-'))!;
  const before=(await stat(join(path,id,source))).mtimeMs;
  run.revision=2;await store.save({run});
  assert.equal((await stat(join(path,id,source))).mtimeMs,before);
  const map=JSON.parse(await readFile(join(path,id,'map.json'),'utf8'));
  assert.equal(map.presentations.views,undefined);
  assert.deepEqual(map.presentations.actions,actions,'Restart and AI replay must retain the saved recipes');
  const progress=flowProgressRun(run);
  assert.equal(progress.presentations,undefined);assert.equal(progress.links,undefined);
  assert.equal(run.presentations.actions,actions,'A canvas read must never mutate the run catalog');
  assert.deepEqual((await store.load(id)).run.presentations?.views,views);
  assert.equal((await store.load(id,false)).run.presentations?.views,undefined);
  const other=new FlowStore(path);assert.deepEqual((await other.load(id)).run.presentations?.views,views);
});

test('shared form props retain every hook origin rather than the last caller',async t=>{
  const root=await fixture(t,{'App.tsx':`import {useState} from 'react';
    function First(){const [step]=useState('verify');return <Form step={step}/>}
    function Second(){const [step]=useState('done');return <Form step={step}/>}
    function Form({step}){return step==='verify'?<Verify/>:<Done/>}`});
  const catalog=(await scanAppFlow(root,'ios')).presentations!;
  const matched=catalog.views!.filter(v=>v.state?.value==='verify');
  assert.deepEqual(new Set(matched.map(v=>catalog.viewStates!.find(s=>s.id===v.state?.site)?.owner)),new Set(['First','Second']));
});

test('literal-disabled debug branches do not prove a source entry or a sheet target',async t=>{
  const root=await fixture(t,{'App.tsx':`const enabled=false;export function App(){return <>{enabled&&<Debug/>}{true?<Main/>:<Sheet control={control}/>}</>}
    export function Debug(){return <Testing/>}`});
  const catalog=(await scanAppFlow(root,'ios')).presentations!;
  assert.equal(catalog.views!.some(v=>v.control?.component==='Sheet'),false);
  assert.deepEqual(catalog.views!.find(v=>v.kind==='component'&&v.owner==='Debug')?.entries,[]);
});

test('an anonymous default component keeps its identity when nested callbacks render JSX',async t=>{
  const root=await fixture(t,{'App.tsx':`import Guard from './Guard';export function App(){return <Guard/>}`,
    'Guard.tsx':`export default ()=>{const renderItem=()=> <Inline/>;return <Blocked renderItem={renderItem}/>}`});
  const graph=await scanAppFlow(root,'ios'),result=compareViewReference(graph,{views:[{id:'guard',category:'auth-guard',selectors:[{component:{file:'Guard.tsx',name:'default',entry:{file:'App.tsx',line:1}}}]}]},()=>[]);
  assert.equal(result.matchedViews,1);
  assert.deepEqual(graph.presentations!.views!.find(v=>v.kind==='component'&&v.file==='Guard.tsx'&&v.owner==='default')?.entries?.map(({source,...entry})=>entry),[{file:'App.tsx',line:1,owner:'App'}]);
});

test('a local prop cannot inherit an unrelated constant or hook with the same name',async t=>{
  const root=await fixture(t,{'App.tsx':`import {useState} from 'react';const enabled=false;
    function Unrelated(){const [state]=useState('verify');return state==='verify'?<Other/>:null}
    export function App({enabled,state}){return <>{enabled&&<Feature/>}{state==='verify'&&<Verify/>}</>}
    function Feature(){return <Body/>}`});
  const c=(await scanAppFlow(root,'ios')).presentations!;
  assert.ok(c.views!.find(v=>v.kind==='component'&&v.owner==='Feature')?.entries?.length);
  assert.equal(c.views!.some(v=>v.kind==='state'&&v.owner==='App'),false);
});

test('a block alias cannot claim a sibling block hook with the same name',async t=>{
  const root=await fixture(t,{'App.tsx':`import {useState} from 'react';export function App({condition}){
    if(condition){const [phase]=useState('a');return phase==='a'?<First/>:null}
    {const [phase]=useState('b');return phase==='b'?<Second/>:null}
  }`});
  const c=(await scanAppFlow(root,'ios')).presentations!,states=c.viewStates!;
  assert.equal(states.length,2);
  const views=c.views!.filter(v=>v.state);
  assert.deepEqual(views.map(v=>v.state!.value).sort(),['a','b']);
  assert.equal(new Set(views.map(v=>v.state!.site)).size,2);
});
