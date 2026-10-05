import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanAppFlow } from '../src/server/app-flow/scan.ts';
import { installPresentationRuntime } from '../src/server/app-flow/presentations-runtime.js';
import { FlowPresentationCapture } from '../src/server/app-flow/presentations.ts';
import { AppFlowRuns } from '../src/server/app-flow/runs.ts';
import { flowRunning, type FlowRun } from '../src/shared/app-flow.ts';
import { bindPresentationSites } from '../src/server/app-flow/presentations-bindings.ts';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { JSDOM } from 'jsdom';
import {sharedLoopRuntime} from './app-flow-runtime-fixtures.ts';

async function fixture(t: test.TestContext, files: Record<string,string>) {
  const root=await mkdtemp(join(tmpdir(),'presentation-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const [file,source]of Object.entries(files)){await mkdir(join(root,file,'..'),{recursive:true});await writeFile(join(root,file),source);}
  return root;
}

test('source discovers finite welcome, login and registration state without executing source',async t=>{
  const root=await fixture(t,{'App.tsx':`import {useState} from 'react';
    enum Step {Welcome, Login, Register}
    export function App(){const [step,setStep]=useState(Step.Welcome);
      return <>{step===Step.Welcome?<Welcome onPressLogin={()=>setStep(Step.Login)} onPressRegister={()=>setStep(Step.Register)}/>:step===Step.Login?<Login onPressRegister={()=>setStep(Step.Register)}/>:<Registration/>}</>;}
    throw Error('do not execute');`});
  const g=await scanAppFlow(root,'ios');
  assert.deepEqual(g.presentations?.actions.map(a=>a.name),['Login','Registration','Registration']);
  assert.equal(g.presentations?.states.length,1);
});

test('context presentation methods resolve through providers, imports and callback wrappers',async t=>{
  const root=await fixture(t,{
    'state.tsx':`import {createContext,useContext,useMemo,useState} from 'react';
      const State=createContext(undefined),Controls=createContext({show(){}});
      export function Provider({children}){const [state,setState]=useState();const show=useCallback(opts=>setState(previous=>previous||opts),[]);const controls=useMemo(()=>({show}),[]);return <State.Provider value={state}><Controls.Provider value={controls}>{children}</Controls.Provider></State.Provider>;}
      export function useStateView(){return useContext(State)}
      export function useControls(){const {show}=useContext(Controls);return useMemo(()=>({show}),[show])}`,
    'hook.ts':`import {useControls as useBase} from './state';export function useOpen(){const {show}=useBase();return useMemo(()=>({show:withGuard(show)}),[show]);}`,
    'App.tsx':`import {useOpen} from './hook';import {useStateView} from './state';export function App(){const {show}=useOpen();const state=useStateView();const visible=!!state;return <><Button onPress={()=>show({mode:'new'})}/><Modal visible={visible}><ComposeForm/></Modal></>}`,
    'unrelated.tsx':`export function unrelated(){const show=()=>destroyAccount();return <Button onPress={()=>show()}/>}`,
  });
  const g=await scanAppFlow(root,'ios');
  assert.equal(g.presentations?.actions.length,1);
  assert.equal(g.presentations?.actions[0].name,'ComposeForm');
});

test('sheets preserve prop conditions and exclude save/discard prerequisites and unknown opening data',async t=>{
  const root=await fixture(t,{'App.tsx':`export function Composer({empty,dirty}){const drafts=useSheetControl();const warning=useSheetControl();const press=()=>{if(empty||!dirty){drafts.open()}else{warning.open()}};const discard=()=>{onDiscard();drafts.open()};return <><Button onPress={press}/><Button onPress={discard}/><Button onPress={()=>drafts.open(getData())}/><Drafts control={drafts}/><Warning control={warning}/></>}`});
  const actions=(await scanAppFlow(root,'ios')).presentations!.actions;
  assert.deepEqual(actions.map(a=>a.name),['Drafts','Warning']);
  assert.equal(actions[0].guard?.op,'||');
  assert.equal(actions[1].guard?.op,'!');
});

test('presentation state never includes session and credential setters',async t=>{
  const root=await fixture(t,{'App.tsx':`import {useState} from 'react';export function App(){const [authenticated,setAuthenticated]=useState(false);const [token,setToken]=useState('');return <><Button onPress={()=>setAuthenticated(true)}/><Button onPress={()=>setToken('fake')}/>{authenticated?<Home/>:<Login/>}{token?<Home/>:null}</>}`});
  assert.equal((await scanAppFlow(root,'ios')).presentations!.actions.length,0);
});

function configureFixture(runtime:any, catalog:any, matches:any[] = [], checked:string[] = []) {
  runtime.configure(catalog, matches, checked);
  const entries=runtime.records(0).bindings.filter((b:any)=>b.kind==='entry');
  runtime.configure(catalog,[...matches,...entries.flatMap((b:any)=>catalog.actions.filter((a:any)=>a.file===b.source?.file&&a.line===b.source?.line).map((a:any)=>({binding:b.id,site:a.id})))],entries.map((b:any)=>b.id));
}

function tree(install=installPresentationRuntime) {
  function App(){} function Button(){} function Sheet(){} function Nested(){}
  const root:any={type:App,memoizedProps:{},memoizedState:null};
  const button:any={type:Button,_debugSource:{fileName:'App.tsx',lineNumber:1,columnNumber:1},memoizedProps:{onPress(){throw Error('do not call the UI event')}},return:root};
  const control={opens:0,closes:0,open(){this.opens++},close(){this.closes++}};
  const sheet:any={type:Sheet,memoizedProps:{control},return:root};root.child=button;button.sibling=sheet;
  const nested:any={type:Nested,memoizedProps:{},return:sheet};sheet.child=nested;
  const fibers=(visit:any,subtree?:any)=>{const stack=[subtree??root];while(stack.length){const f=stack.pop();if(f!==subtree&&f.sibling)stack.push(f.sibling);if(visit(f)!==false&&f.child)stack.push(f.child)}};
  const runtime=install({hook:{renderers:new Map()},fibers,hidden:()=>false,later:setTimeout});
  const action:any={id:'open',file:'App.tsx',line:1,owner:'App',component:'Button',prop:'onPress',name:'Sheet',effect:{kind:'control',component:'Sheet',prop:'control',method:'open',close:'close'}};
  configureFixture(runtime,{states:[],actions:[action]});
  return {root,button,sheet,nested,control,runtime,action};
}

test('controller capture calls only the matched open/close methods and rolls back a checkpoint',async()=>{
  const app=tree();assert.equal(app.runtime.list().length,1);
  assert.equal(app.runtime.open('open').focus,app.sheet);assert.equal(app.control.opens,1);
  assert.equal(app.runtime.checkpoint(),1);
  await app.runtime.rollback(0,false);assert.equal(app.control.closes,1);assert.equal(app.runtime.checkpoint(),0);
  app.runtime.cleanup();assert.equal(app.runtime.list().length,0);
});

test('binding updates and later collections retain the installed presentation plans',async()=>{
  const app=tree();app.runtime.configure(undefined,[]);await app.runtime.collect();
  assert.equal(app.runtime.list().length,1);assert.equal(app.runtime.open('open').focus,app.sheet);
  await app.runtime.rollback(0,false);assert.equal(app.control.opens,1);app.runtime.cleanup();
});

test('runtime rejects disabled entries, unmet props and ambiguous controller instances',()=>{
  const app=tree();app.button.memoizedProps.disabled=true;assert.equal(app.runtime.list().length,0);
  app.button.memoizedProps.disabled=false;app.action.guard={prop:['allowed']};assert.equal(app.runtime.list().length,0);
  app.root.memoizedProps.allowed=true;assert.equal(app.runtime.list().length,1);
  app.sheet.sibling={...app.sheet,memoizedProps:{control:{open(){},close(){}}},child:undefined};assert.equal(app.runtime.list().length,0);
  app.runtime.cleanup();
});

test('presentation lookup skips native bounds for source plans absent from a busy screen',()=>{
  const app=tree();let measured=0;
  app.button.child={tag:5,type:'NativeButton',memoizedProps:{},stateNode:{getBoundingClientRect(){measured++;return {width:10,height:20}}},return:app.button};
  const absent=Array.from({length:500},(_,i)=>({...app.action,id:`absent-${i}`,file:'Other.tsx',line:i+1}));
  app.runtime.configure({states:[],actions:absent},[]);
  assert.deepEqual(app.runtime.list(app.root),[]);
  assert.equal(measured,0,'Unbound source entries must not measure same-named visible owners');
  app.runtime.cleanup();
});

test('a lookup shares native bounds across related owners and refreshes them on the next call',()=>{
  const app=tree();let measured=0,height=20;
  app.button.child={tag:5,type:'NativeButton',memoizedProps:{},stateNode:{getBoundingClientRect(){measured++;return {width:10,height}}},return:app.button};
  assert.equal(app.runtime.list(app.root).length,1);
  assert.equal(measured,1,'Owner and entry checks share the same native measurement');
  height=0;
  assert.deepEqual(app.runtime.list(app.root),[]);
  assert.equal(measured,2,'Bounds cannot survive a lookup or hide a later layout change');
  app.runtime.cleanup();
});

test('native presentation events hold readiness and cleanup restores event handlers',()=>{
  const app=tree();let originalCalls=0;const original={onStateChange(){originalCalls++}};
  const canonical={currentProps:original,publicInstance:{getBoundingClientRect:()=>({x:0,y:0,width:10,height:20})}};
  const host:any={tag:5,type:'NativeSheet',memoizedProps:original,stateNode:{canonical},return:app.sheet};app.sheet.child=host;
  app.runtime.open('open');assert.equal(app.runtime.motion(app.sheet).pending,true);
  canonical.currentProps.onStateChange({nativeEvent:{state:'opening'}});assert.equal(app.runtime.motion(app.sheet).pending,true);
  canonical.currentProps.onStateChange({nativeEvent:{state:'open'}});assert.equal(app.runtime.motion(app.sheet).pending,false);
  assert.equal(originalCalls,2);app.runtime.cleanup();assert.equal(canonical.currentProps,original);
});

test('serialized native handlers retain their event and receiver with shared loop bindings',()=>{
  const app=tree(sharedLoopRuntime()),calls:string[]=[];
  const props={onShow(this:any){assert.equal(this,canonical);calls.push('show')},onDismiss(this:any){assert.equal(this,canonical);calls.push('dismiss')},onStateChange(this:any){assert.equal(this,canonical);calls.push('state')}};
  const canonical:any={currentProps:props};
  app.sheet.child={tag:5,type:'NativeSheet',memoizedProps:props,stateNode:{canonical},return:app.sheet};
  app.runtime.open('open');assert.equal(app.runtime.motion(app.sheet).pending,true);
  canonical.currentProps.onShow.call(canonical);assert.equal(app.runtime.motion(app.sheet).pending,false);
  canonical.currentProps.onStateChange.call(canonical,{nativeEvent:{state:'closing'}});assert.equal(app.runtime.motion(app.sheet).pending,true);
  canonical.currentProps.onDismiss.call(canonical);assert.equal(app.runtime.motion(app.sheet).pending,false);
  assert.deepEqual(calls,['show','state','dismiss']);app.runtime.cleanup();assert.equal(canonical.currentProps,props);
});

test('native completion handlers survive mutation of the original props during dismissal',()=>{
  const app=tree();let calls=0;
  const original:any={onDismiss(){calls++;}};
  const canonical={currentProps:original};
  app.sheet.child={tag:5,type:'NativeSheet',memoizedProps:original,stateNode:{canonical},return:app.sheet};
  app.runtime.open('open');const completed=canonical.currentProps.onDismiss;
  delete original.onDismiss;
  completed();assert.equal(calls,1);assert.equal(app.runtime.motion(app.sheet).pending,false);
  app.runtime.cleanup();
});

test('JS portal content matches by React element props identity without an app adapter',()=>{
  const app=tree(),props={children:'portal content'},element={type:function PortalBody(){},props};
  app.sheet.child={type:function Portal(){},memoizedProps:{children:element},return:app.sheet};
  const portal:any={type:element.type,memoizedProps:props,return:app.root};app.sheet.sibling=portal;
  assert.equal(app.runtime.visualFocus(app.sheet),portal);
  app.runtime.cleanup();
});

test('portal focus keeps the whole body instead of narrowing to its last child',()=>{
  const app=tree(),textType=function Caption(){},textProps={children:'body text'};
  const bodyType=function PortalBody(){},bodyProps={children:{type:textType,props:textProps}};
  app.sheet.child={type:function Portal(){},memoizedProps:{children:{type:bodyType,props:bodyProps}},return:app.sheet};
  const body:any={type:bodyType,memoizedProps:bodyProps,return:app.root};
  body.child={type:textType,memoizedProps:textProps,return:body};app.sheet.sibling=body;
  assert.equal(app.runtime.visualFocus(app.sheet),body);
  app.runtime.cleanup();
});

test('presentation focus treats a missing alternate as outside the scope',()=>{
  for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
    const app=tree(install);app.button.alternate=null;
    assert.equal(app.runtime.focusFor('Nested',app.button),undefined);
    assert.equal(app.runtime.focusFor('Nested',app.sheet),app.nested);
    app.runtime.cleanup();
  }
});

test('presentation retries yield to untouched screens and retain all three readiness attempts',async t=>{
  const directory=await fixture(t,{}),events:string[]=[];let clock=0,key='Home',slow=0;
  t.mock.method(performance,'now',()=>clock);
  const actions:any[]=['Slow','Quick'].map(name=>({id:name,name,file:'Home.tsx',line:1,owner:'Home',component:'Button',prop:'onPress',effect:{kind:'control',component:name,prop:'control',method:'open',close:['close']}}));
  const nodes:any[]=['Home','Search'].map(name=>({id:name,name,kind:'screen',path:[name],required:[],status:'pending'}));
  const runs=new AppFlowRuns({directory,scan:async()=>({files:1,scanMs:1,warnings:[],nodes,edges:[],presentations:{states:[],actions}}),connect:async()=>({
    screenshot:async()=>Buffer.from(key),runtime:{async close(){},async invoke(command:any){
      if(command.type==='inspect')return {available:true};
      if(command.type==='open'){key=command.path.at(-1);if(command.timeoutMs===1000)events.push(key);}
      if(command.type==='presentation-rollback')key='Home';
      if(command.type==='presentations')return key==='Home'?actions:[];
      if(command.type==='presentation-open'){key=command.id;if(key==='Slow')slow++;events.push(`${key}:${key==='Slow'?slow:1}`);}
      if(command.type==='presentation-view'&&key==='Slow'&&slow<3){clock+=25000;return {key,ready:false,found:true,loading:true};}
      return {key,ready:true,found:true,active:[key],signature:key};
    }}
  })});
  t.after(()=>runs.close());
  const run=runs.start({projectRoot:directory,platform:'ios',deviceId:'fixture',targetId:'target',metroUrl:'http://127.0.0.1:8081',useAi:false});
  for(let i=0;i<300&&flowRunning(runs.read(run.id));i++)await new Promise(resolve=>setTimeout(resolve,10));
  const result=runs.read(run.id);
  assert.equal(result.phase,'complete');
  assert.deepEqual(events,['Home','Search','Slow:1','Quick:1','Slow:2','Slow:3']);
  assert.ok(result.nodes.every(node=>node.status==='captured'&&node.image));
  assert.equal(result.nodes.find(node=>node.name==='Slow')?.captureAttempts,3);
});

test('queued capture deduplicates local forms and sheets and restores each parent',async t=>{
  const root=await fixture(t,{}),signal=new AbortController().signal;
  const actions:any[]=[{id:'login',name:'Login',file:'App.tsx',line:1,owner:'App',component:'Button',prop:'onPress',effect:{kind:'state',site:'step',path:[],value:1}},
    {id:'sheet',name:'Options',file:'Login.tsx',line:2,owner:'Login',component:'Button',prop:'onPress',effect:{kind:'control',component:'Options',prop:'control',method:'open',close:'close'}}];
  const base:any={id:'entry',name:'Welcome',kind:'screen',entry:true,path:[],required:[],status:'captured'};
  const run:FlowRun={id:'run',phase:'capturing',startedAt:0,revision:0,ai:'off',files:1,scanMs:1,warnings:[],nodes:[base],edges:[],presentations:{states:[],actions}};
  await mkdir(join(root,'run'));
  const stack:string[]=[];let screenshots=0;
  const view=()=>({key:stack.join('/')||'welcome',ready:true,found:true,active:[],signature:stack.join('/')});
  const backend:any={screenshot:async()=>{screenshots++;return Buffer.from(stack.join('/')||'fixture')},runtime:{async invoke(c:any){
    if(c.type==='presentation-checkpoint')return {level:stack.length};
    if(c.type==='presentation-rollback'){stack.length=c.level??0;return {}};
    if(c.type==='presentations')return stack.length===0?[actions[0]]:stack.length===1?[actions[1]]:[];
    if(c.type==='presentation-open'){stack.push(c.id);return view()};
    if(c.type==='presentation-view')return view();return {};
  }}};
  const capture=new FlowPresentationCapture(run,root,root,signal,async()=>{});
  await capture.explore(backend,base);await capture.explore(backend,base);
  assert.equal(screenshots,0,'Discovery does not block the route queue with sheet captures');
  await capture.retry(backend,run.nodes[1]);
  await capture.retry(backend,run.nodes[2]);
  assert.equal(screenshots,4);assert.equal(stack.length,0);
  assert.deepEqual(run.nodes.map(n=>n.name),['Welcome','Login','Options']);
  assert.deepEqual(run.edges.map(e=>[e.from,e.to]),[[base.id,run.nodes[1].id],[run.nodes[1].id,run.nodes[2].id]]);
});

test('state hook tracking restores only its presentation field and leaves no wrapped exports',async t=>{
  const app=tree();let state={panel:false,other:1},mounted=true;
  const setter=(update:any)=>{state=update(state);app.root.memoizedState={memoizedState:state,next:null};};
  const useState=()=>[state,setter];const react={createElement(){},useState,useReducer(){}};
  const original=(globalThis as any).__r;(globalThis as any).__r={getModules:()=>new Map([[1,{isInitialized:true,publicModule:{exports:react}}]])};t.after(()=>{(globalThis as any).__r=original});
  const renderer={rendererPackageName:'react-native-renderer',getCurrentFiber:()=>app.root,scheduleUpdate(){app.root.memoizedState=null;react.useState();app.root.memoizedState={memoizedState:state,next:null}}};
  const fibers=(visit:any,subtree?:any)=>{if(!mounted)return;const stack=[subtree??app.root];while(stack.length){const f=stack.pop();if(f!==subtree&&f.sibling)stack.push(f.sibling);if(visit(f)!==false&&f.child)stack.push(f.child)}};
  const runtime=installPresentationRuntime({hook:{renderers:new Map([[1,renderer]])},fibers,hidden:()=>false,later:setTimeout});
  const site:any={id:'state',file:'App.tsx',line:1,column:0,endLine:1,owner:'App',paths:[['panel']]};
  const {bindings}=await runtime.collect([site]);assert.equal(react.useState,useState);assert.equal(bindings.length,1);
  configureFixture(runtime,{states:[site],actions:[{...app.action,effect:{kind:'state',site:'state',path:['panel'],value:true}}]},[{binding:bindings[0].id,site:'state'}],bindings.map(binding=>binding.id));
  assert.deepEqual((await runtime.collect([site])).bindings,[],'A mounted owner does not repeat source binding');
  mounted=false;await runtime.collect([site]);mounted=true;
  const refreshed=await runtime.collect([site]);
  const stateBinding=refreshed.bindings.find(binding=>binding.kind==='useState');
  assert.ok(stateBinding,'A returning owner recollects bindings removed while it was absent');
  configureFixture(runtime,{states:[site],actions:[{...app.action,effect:{kind:'state',site:'state',path:['panel'],value:true}}]},[{binding:stateBinding.id,site:'state'}],refreshed.bindings.map(binding=>binding.id));
  runtime.open('open');assert.equal(state.panel,true);setter((value:any)=>({...value,other:2}));
  await runtime.rollback(0,false);assert.deepEqual(state,{panel:false,other:2});runtime.cleanup();
});

test('a failed tree collection always restores the original hook exports',async t=>{
  const react={createElement(){},useState(){return [0,()=>{}]},useReducer(){return [0,()=>{}]}};
  const state=react.useState,reducer=react.useReducer,previous=(globalThis as any).__r;
  (globalThis as any).__r={getModules:()=>new Map([[1,{isInitialized:true,publicModule:{exports:react}}]])};
  t.after(()=>{(globalThis as any).__r=previous});
  const runtime=installPresentationRuntime({hook:{renderers:new Map()},fibers(){throw Error('tree read failed')},hidden:()=>false,later:setTimeout});
  await assert.rejects(runtime.collect([]),/tree read failed/);
  assert.equal(react.useState,state);assert.equal(react.useReducer,reducer);runtime.cleanup();
});

test('presentation binding pages keep one snapshot while new entries mount',()=>{
  const app=tree();let walks=0;
  for(let index=0;index<120;index++)app.root.child={type:app.button.type,return:app.root,sibling:app.root.child,_debugSource:{fileName:'App.tsx',lineNumber:1,columnNumber:1},memoizedProps:app.button.memoizedProps};
  const fibers=(visit:any)=>{walks++;const stack=[app.root];while(stack.length){const fiber=stack.pop();if(fiber.sibling)stack.push(fiber.sibling);if(visit(fiber)!==false&&fiber.child)stack.push(fiber.child)}};
  const runtime=installPresentationRuntime({hook:{renderers:new Map()},fibers,hidden:()=>false,later:setTimeout});
  runtime.configure({states:[],actions:[app.action]},[]);
  const first=runtime.records(0);assert.equal(first.bindings.length,100);
  app.root.child={type:app.button.type,return:app.root,sibling:app.root.child,_debugSource:{fileName:'App.tsx',lineNumber:1,columnNumber:1},memoizedProps:app.button.memoizedProps};
  const next=runtime.records(first.next);
  assert.equal(walks,1);assert.equal(next.bindings.length,21);
  assert.equal(new Set([...first.bindings,...next.bindings].map(binding=>binding.id)).size,121);
  const refreshed=runtime.records(0),tail=runtime.records(refreshed.next);
  assert.equal(refreshed.bindings.length+tail.bindings.length,122,'The next collection includes the newly mounted entry');
  runtime.cleanup();assert.deepEqual(runtime.records(100).bindings,[]);app.runtime.cleanup();
});

test('class presentation handlers observe native completion even through an opaque portal adapter',()=>{
  const app=tree();let calls=0;const original={onStateChange(){calls++}};
  const instance={props:original,onStateChange(event:any){this.props.onStateChange(event)}};
  const controller:any={tag:1,type:function Controller(){},memoizedProps:original,stateNode:instance,return:app.sheet};app.sheet.child=controller;
  app.runtime.open('open');assert.equal(app.runtime.motion(app.sheet).pending,true);
  instance.onStateChange({nativeEvent:{state:'open'}});assert.equal(app.runtime.motion(app.sheet).pending,false);assert.equal(calls,1);
  app.runtime.cleanup();assert.equal(instance.props,original);
});

test('unknown early-return guards never become unconditional sheet entries',async t=>{
  const root=await fixture(t,{'App.tsx':`export function App({allowed}){const control=useDialog();const uncertain=()=>{if(!canShow())return;control.open()};const press=()=>{if(!allowed)return;control.open()};return <><Button label="unknown" onPress={uncertain}/><Button label="known" onPress={press}/><Sheet control={control}/></>}`});
  const actions=(await scanAppFlow(root,'ios')).presentations!.actions;
  assert.equal(actions.length,1);assert.deepEqual(actions[0].guard,{op:'!',args:[{op:'!',args:[{prop:['allowed']}]}]});
});

test('a tooltip visibility flag does not hide its still-visible presentation trigger',()=>{
  const app=tree();const tooltip:any={type:function Tooltip(){},memoizedProps:{visible:false},child:app.button,return:app.root};
  app.button.return=tooltip;app.root.child=tooltip;app.button.sibling=undefined;tooltip.sibling=app.sheet;
  assert.equal(app.runtime.list().length,1);app.runtime.cleanup();
});

test('retry replays its saved route and full presentation chain, preserving completed siblings',async t=>{
  const root=await fixture(t,{});await mkdir(join(root,'run'));const commands:any[]=[];
  const node:any={id:'sheet',name:'Options',kind:'screen',path:[],required:[],status:'pending',presentation:{basePath:['Home'],actions:['form','options']}};
  const completed:any={id:'sibling',name:'Other',kind:'screen',path:[],required:[],status:'captured',image:'kept'};
  const run:FlowRun={id:'run',phase:'capturing',startedAt:0,revision:0,ai:'off',files:1,scanMs:1,warnings:[],nodes:[node,completed],edges:[],presentations:{states:[],actions:[]}};
  let screen='Home';
  const backend:any={screenshot:async()=>Buffer.from(screen),runtime:{async invoke(c:any){commands.push(c);if(c.type==='open'){screen='Home';return {ready:true}};if(c.type==='presentations')return [{id:'form'},{id:'options'}];if(c.type==='presentation-open')screen=c.id;if(c.type==='presentation-open'||c.type==='presentation-view')return {key:screen,ready:true,found:true,active:['Home'],signature:screen};return {};}}};
  const capture=new FlowPresentationCapture(run,root,root,new AbortController().signal,async()=>{});
  await capture.retry(backend,node);assert.equal(node.status,'captured');assert.equal(completed.image,'kept');
  assert.deepEqual(commands.filter(c=>c.type==='presentation-open').map(c=>c.id),['form','options']);assert.deepEqual(commands.find(c=>c.type==='open').path,['Home']);
  assert.equal(commands.at(-1).type,'presentation-rollback');
});

test('source supports optional sheet refs, custom controller props and false-valued form branches',async t=>{
  const root=await fixture(t,{'App.tsx':`import {useState,useRef} from 'react';export function App(){const [register,setRegister]=useState(true);const sheet=useRef();const menu=useMenu();return <><Button label="sheet" onPress={()=>sheet.current?.present()}/><Sheet ref={sheet}/><Button label="menu" onPress={()=>menu.show()}/><Menu controller={menu}/>{register?<Register onPressLogin={()=>setRegister(false)}/>:<Login/>}</>}`});
  const actions=(await scanAppFlow(root,'ios')).presentations!.actions;
  assert.deepEqual(actions.map(a=>a.name),['Sheet','Menu','Login']);
  const first=actions[0].effect as Extract<typeof actions[0]['effect'],{kind:'control'}>,second=actions[1].effect as typeof first;
  assert.deepEqual({...first,target:undefined},{kind:'control',component:'Sheet',prop:'ref',method:'present',close:['dismiss','close'],target:undefined});
  assert.deepEqual({...second,target:undefined},{kind:'control',component:'Menu',prop:'controller',method:'show',close:['hide','close','dismiss'],target:undefined});
  assert.equal(first.target?.file,'App.tsx');assert.ok(first.target!.source.column<second.target!.source.column);
});

test('controller close pairs can use hide without a close method',async()=>{
  const app=tree();const controller={shown:false,show(){this.shown=true},hide(){this.shown=false}};
  app.sheet.memoizedProps={controller};app.action.effect={kind:'control',component:'Sheet',prop:'controller',method:'show',close:['hide','close']};
  app.runtime.open('open');assert.equal(controller.shown,true);
  await app.runtime.rollback(0,false);assert.equal(controller.shown,false);app.runtime.cleanup();
});

test('an existing modal does not wait for a second onShow when its local form changes',()=>{
  const app=tree();const canonical={currentProps:{onShow(){}},publicInstance:{getBoundingClientRect:()=>({x:0,y:0,width:10,height:20})}};
  const host:any={tag:5,type:'NativeModal',memoizedProps:canonical.currentProps,stateNode:{canonical},return:app.root,child:app.sheet};
  app.sheet.return=host;app.button.sibling=host;
  app.runtime.open('open');assert.equal(app.runtime.motion(app.sheet).pending,false);app.runtime.cleanup();
});

test('native projection keeps deep live contexts, contains render errors and restores the root',async t=>{
  const app=tree();function View(){}function Modal(){}function Provider(){}
  const originalRequire=(globalThis as any).__r;
  const react=React;
  const native={View,Modal,Platform:{OS:'ios'},StyleSheet:{create(){}}};
  (globalThis as any).__r={getModules:()=>new Map([[1,{isInitialized:true,publicModule:{exports:react}}],[2,{isInitialized:true,publicModule:{exports:native}}]])};
  t.after(()=>{(globalThis as any).__r=originalRequire});
  app.root.type=View;app.root.memoizedProps={children:'original',marker:1};
  const modal:any={type:Modal,memoizedProps:{presentationStyle:'pageSheet'},return:app.root};
  const liveContext={user:'real existing context'};
  const provider:any={tag:10,type:Provider,memoizedProps:{value:liveContext},child:app.sheet,return:modal};
  modal.child=provider;app.sheet.return=provider;app.button.sibling=modal;
  const unrelated:any={type:View,memoizedProps:{children:'unrelated overlay'}};
  const fibers=(visit:any,subtree?:any)=>{const stack=subtree?[subtree]:[app.root,unrelated];while(stack.length){const f=stack.pop();if(f!==subtree&&f.sibling)stack.push(f.sibling);if(visit(f)!==false&&f.child)stack.push(f.child)}};
  const runtime=installPresentationRuntime({hook:{renderers:new Map([[1,{rendererPackageName:'react-native-renderer',overrideProps(fiber:any,_path:any,props:any){fiber.memoizedProps=props}}]])},fibers,hidden:()=>false,later:setTimeout});
  // The owner remains App while the projection host is the framework View.
  function App(){}const owner:any={type:App,memoizedProps:{},child:app.button,return:app.root};app.root.child=owner;app.button.return=owner;modal.return=owner;
  configureFixture(runtime,{states:[],actions:[app.action]});runtime.open('open');
  let ancestor=provider;
  for(let i=0;i<120;i++){const next:any={type:View,memoizedProps:{},return:ancestor};ancestor.child=next;ancestor=next;}
  ancestor.child=app.sheet;app.sheet.return=ancestor;
  assert.equal(runtime.project(app.sheet).error,undefined);
  assert.equal(unrelated.memoizedProps.children,'unrelated overlay','A preview uses its own app root instead of an unrelated renderer root');
  const element=app.root.memoizedProps.children.props.children[1];
  assert.equal(element.type,Modal);assert.equal(element.props.presentationStyle,'pageSheet');
  const boundary=element.props.children,content=boundary.props.children;
  assert.equal(content.type,Provider);assert.equal(content.props.value,liveContext);
  assert.equal(content.props.children.type,app.sheet.type);
  assert.equal(content.props.children.props.control,app.control);
  element.props.onShow();assert.equal(runtime.motion(app.sheet).pending,false);
  const dom=new JSDOM('<div id="root"></div>');
  const previousWindow=(globalThis as any).window,previousDocument=(globalThis as any).document;
  (globalThis as any).window=dom.window;(globalThis as any).document=dom.window.document;
  const errors:unknown[]=[];
  const rendered=createRoot(dom.window.document.getElementById('root')!,{onCaughtError:error=>errors.push(error)});
  function BrokenPreview(){throw Error('preview error');}
  try{
    flushSync(()=>rendered.render(React.createElement(React.Fragment,null,
      React.createElement('span',null,'Original app'),
      React.createElement(boundary.type,null,React.createElement(BrokenPreview)))));
    assert.equal(errors.length,1);
    assert.equal(dom.window.document.getElementById('root')!.textContent,'Original app');
    assert.equal(runtime.motion(app.sheet).error,'The temporary presentation preview failed.');
  }finally{
    flushSync(()=>rendered.unmount());
    await new Promise(resolve=>setTimeout(resolve,20));
    dom.window.close();
    (globalThis as any).window=previousWindow;(globalThis as any).document=previousDocument;
  }
  app.root.memoizedProps={...app.root.memoizedProps,marker:2};
  await runtime.rollback(0,false);
  assert.deepEqual(app.root.memoizedProps,{children:'original',marker:2});assert.equal(app.control.closes,1);runtime.cleanup();
});

test('adding a preview preserves app instances for single and array root children',async()=>{
  for(const shape of ['single','array','siblings']){
    const app=tree(),dom=new JSDOM('<div id="root"></div>');let mounts=0;
    const previous={window:(globalThis as any).window,document:(globalThis as any).document,require:(globalThis as any).__r};
    (globalThis as any).window=dom.window;(globalThis as any).document=dom.window.document;
    function View({children}:any){return React.createElement('div',null,children);}
    function Modal(){return null;}
    function AppState(){const [instance]=React.useState(()=>++mounts);return React.createElement('span',null,instance);}
    const element=React.createElement(AppState,{key:'app'});
    const children=shape==='single'?element:shape==='array'?[element]:[element,React.createElement('span',{key:'sibling'},'Sibling')];
    app.root.type=View;app.root.memoizedProps={children};
    function App(){}const owner:any={type:App,memoizedProps:{},child:app.button,return:app.root};
    app.root.child=owner;app.button.return=owner;app.sheet.return=owner;
    const native={View,Modal,Platform:{OS:'ios'},StyleSheet:{create(){}}};
    (globalThis as any).__r={getModules:()=>new Map([[1,{isInitialized:true,publicModule:{exports:React}}],[2,{isInitialized:true,publicModule:{exports:native}}]])};
    const rendered=createRoot(dom.window.document.getElementById('root')!);
    const render=()=>flushSync(()=>rendered.render(React.createElement(View,app.root.memoizedProps)));
    const fibers=(visit:any,subtree?:any)=>{const stack=[subtree??app.root];while(stack.length){const f=stack.pop();if(f!==subtree&&f.sibling)stack.push(f.sibling);if(visit(f)!==false&&f.child)stack.push(f.child)}};
    const runtime=installPresentationRuntime({hook:{renderers:new Map([[1,{rendererPackageName:'react-native-renderer',overrideProps(fiber:any,_path:any,props:any){fiber.memoizedProps=props;render();}}]])},fibers,hidden:()=>false,later:setTimeout});
    try{
      render();configureFixture(runtime,{states:[],actions:[app.action]});runtime.open('open');
      assert.equal(runtime.project(app.sheet).error,undefined);
      assert.equal(mounts,1,`${shape} app children keep their state when a preview opens`);
      await runtime.rollback(0,false);
      assert.equal(mounts,1,`${shape} app children keep their state when the preview closes`);
    }finally{
      runtime.cleanup();flushSync(()=>rendered.unmount());await new Promise(resolve=>setTimeout(resolve,20));dom.window.close();
      (globalThis as any).window=previous.window;(globalThis as any).document=previous.document;(globalThis as any).__r=previous.require;
    }
  }
});

test('saved native projections replay at the correct step on retry',async t=>{
  const root=await fixture(t,{});await mkdir(join(root,'run'));let key='entry';const commands:any[]=[];
  const node:any={id:'login',name:'Login',kind:'screen',path:[],required:[],status:'pending',presentation:{actions:['login'],projections:['login'],basePath:[]}};
  const run:FlowRun={id:'run',phase:'capturing',startedAt:0,revision:0,ai:'off',files:1,scanMs:1,warnings:[],nodes:[node],edges:[],presentations:{states:[],actions:[]}};
  const backend:any={screenshot:async()=>Buffer.from(key),runtime:{async invoke(command:any){commands.push(command.type);if(command.type==='presentations')return [{id:'login'}];if(command.type==='presentation-project')key='projected login';if(command.type==='presentation-view')return {key,ready:true,found:true,signature:key};return {};}}};
  await new FlowPresentationCapture(run,root,root,new AbortController().signal,async()=>{}).retry(backend,node);
  assert.equal(node.status,'captured');assert.equal(commands.filter(type=>type==='presentation-project').length,1);
});

test('a kept form reopens its saved native preview to discover uncaptured children',async t=>{
  const root=await fixture(t,{});await mkdir(join(root,'run'));let key='entry',projects=0;
  const actions:any[]=[{id:'login',name:'Login',file:'App.tsx',line:1,owner:'App',component:'Button',prop:'onPress',effect:{kind:'state',site:'step',path:[],value:1}},
    {id:'sheet',name:'Options',file:'Login.tsx',line:2,owner:'Login',component:'Button',prop:'onPress',effect:{kind:'control',component:'Options',prop:'control',method:'open',close:'close'}}];
  const base:any={id:'base',name:'Entry',kind:'screen',path:[],required:[],status:'captured'};
  const existing:any={id:'presentation-keep',name:'Login',kind:'screen',path:[],required:[],status:'captured',image:'kept',presentation:{actions:['login'],projections:['login'],basePath:[]}};
  // Use the same source destination identity as a previously completed run.
  const {createHash}=await import('node:crypto');existing.id=`presentation-${createHash('sha256').update(JSON.stringify(['step',[],1])).digest('hex').slice(0,24)}`;
  const run:FlowRun={id:'run',phase:'capturing',startedAt:0,revision:0,ai:'off',files:1,scanMs:1,warnings:[],nodes:[base,existing],edges:[],presentations:{states:[],actions}};
  const backend:any={screenshot:async()=>Buffer.from(key),runtime:{async invoke(command:any){
    if(command.type==='presentation-checkpoint')return {level:key==='entry'?0:2};
    if(command.type==='presentation-rollback'){key=command.level?'projected login':'entry';return {}};
    if(command.type==='presentations')return key==='entry'?[actions[0]]:key==='projected login'?[actions[1]]:[];
    if(command.type==='presentation-open')key=command.id;
    if(command.type==='presentation-project'){key='projected login';projects++};
    if(command.type==='presentation-view')return {key,ready:true,found:true,signature:key};return {};
  }}};
  const capture=new FlowPresentationCapture(run,root,root,new AbortController().signal,async()=>{});
  await capture.explore(backend,base);
  assert.equal(existing.status,'pending');
  await capture.retry(backend,existing);
  assert.equal(projects,1);assert.equal(existing.image,'kept');assert.equal(run.nodes.at(-1)?.name,'Options');assert.equal(run.nodes.at(-1)?.status,'pending');
  await capture.retry(backend,run.nodes.at(-1)!);
  assert.equal(run.nodes.at(-1)?.status,'captured');
});

test('apps without a navigator map local forms and resume a nested sheet after disconnect',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'presentation-test-'));let connections=0,opens=0;
  const actions:any[]=[{id:'login',name:'Login',file:'App.tsx',line:1,owner:'App',component:'Button',prop:'onPress',effect:{kind:'state',site:'step',path:[],value:1}},
    {id:'sheet',name:'Options',file:'Login.tsx',line:2,owner:'Login',component:'Button',prop:'onPress',effect:{kind:'control',component:'Options',prop:'controller',method:'show',close:['hide']}}];
  const runs=new AppFlowRuns({directory,scan:async()=>({files:1,scanMs:1,warnings:[],nodes:[],edges:[],presentations:{states:[],actions}}),connect:async()=>{
    const generation=++connections;const stack:string[]=[];let offline=false;
    return {target:{appId:'example.app'},screenshot:async()=>Buffer.from(stack.join('/')||'welcome'),runtime:{async close(){stack.length=0},async invoke(command:any){
      if(offline)throw Error('disconnected');
      if(command.type==='inspect'||command.type==='resume')return {available:false};
      if(command.type==='presentation-checkpoint')return {level:stack.length};
      if(command.type==='presentation-rollback'){stack.length=command.level??0;return {}};
      if(command.type==='presentations')return stack.length===0?[actions[0]]:stack.length===1?[actions[1]]:[];
      if(command.type==='presentation-open'){if(command.id==='sheet'&&generation===1){offline=true;throw Error('disconnected')};stack.push(command.id);opens++;return {}};
      if(command.type==='presentation-view')return {key:stack.join('/')||'welcome',signature:stack.join('/'),title:stack.at(-1)??'Welcome',found:true,ready:true};
      return {};
    }}};
  }});
  t.after(async()=>{await runs.close();await rm(directory,{recursive:true,force:true});});
  const run=runs.start({projectRoot:directory,platform:'ios',deviceId:'fixture',targetId:'target',metroUrl:'http://127.0.0.1:8081',useAi:false});
  for(let i=0;i<300&&flowRunning(runs.read(run.id));i++)await new Promise(resolve=>setTimeout(resolve,10));
  const result=runs.read(run.id);assert.equal(result.phase,'complete');assert.equal(connections,2);
  assert.deepEqual(result.nodes.map(n=>n.name),['Welcome','Login','Options']);assert.ok(result.nodes.every(n=>n.status==='captured'&&n.image));
  assert.equal(result.edges.length,2);assert.equal(opens,4,'The completed form replays to reach its child on each attempt');
});

test('a standalone form maps without a navigator or any injectable transitions',async t=>{
  const directory=await fixture(t,{});
  const runs=new AppFlowRuns({directory,scan:async()=>({files:1,scanMs:1,warnings:[],nodes:[],edges:[]}),connect:async()=>({screenshot:async()=>Buffer.from('login form'),runtime:{async close(){},async invoke(command:any){
    if(command.type==='inspect')return {available:false};
    if(command.type==='presentation-view')return {key:'login',signature:'login form',title:'Sign in',ready:true,found:true};
    return {};
  }}})});
  t.after(()=>runs.close());const run=runs.start({projectRoot:directory,platform:'ios',deviceId:'fixture',targetId:'target',metroUrl:'http://127.0.0.1:8081',useAi:false});
  for(let i=0;i<200&&flowRunning(runs.read(run.id));i++)await new Promise(resolve=>setTimeout(resolve,10));
  const result=runs.read(run.id);assert.equal(result.phase,'complete');assert.equal(result.nodes.length,1);assert.equal(result.nodes[0].name,'Sign in');assert.equal(result.nodes[0].status,'captured');
});

test('source entry binding distinguishes same-named components and same-line JSX',async()=>{
  const actions:any[]=[
    {id:'close',file:'Dialog.tsx',line:4,source:{line:4,column:0,endLine:4,endColumn:30}},
    {id:'auth',file:'Account.tsx',line:4,source:{line:4,column:0,endLine:4,endColumn:30}},
    {id:'other',file:'Dialog.tsx',line:4,source:{line:4,column:31,endLine:4,endColumn:60}},
  ];
  const binding:any={id:'button',kind:'entry',stack:'',source:{file:'/app/Dialog.tsx',line:4,column:10}};
  assert.deepEqual(await bindPresentationSites('http://localhost:8081','/app',[binding],[],actions),[{binding:'button',site:'close'}]);
  binding.source.column=40;
  assert.deepEqual(await bindPresentationSites('http://localhost:8081','/app',[binding],[],actions),[{binding:'button',site:'other'}]);
  binding.source.file='/app/node_modules/shared/Dialog.tsx';
  assert.deepEqual(await bindPresentationSites('http://localhost:8081','/app',[binding],[],actions),[]);
});

test('an ancestor creation frame cannot prove a nested JSX entry',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});
  globalThis.fetch=async()=>new Response(JSON.stringify({stack:[
    {file:'/app/node_modules/react/jsx-runtime.js',lineNumber:1,column:0},
    {file:'/app/Dialog.tsx',lineNumber:4,column:2},
    {file:'/app/Account.tsx',lineNumber:4,column:2},
  ]}));
  const binding:any={id:'entry',kind:'entry',stack:['Error',...Array.from({length:3},(_,i)=>`    at render (http://localhost:8081/index.bundle:${i+1}:1)`)].join('\n')};
  const action:any={id:'auth',file:'Account.tsx',source:{line:4,column:0,endLine:4,endColumn:30}};
  assert.deepEqual(await bindPresentationSites('http://localhost:8081','/app',[binding],[],[action]),[]);
});

test('shared source frames resolve once and retain each entry stack order',async t=>{
  let requested=0;
  t.mock.method(globalThis,'fetch',async(_url:any,options:any)=>{
    const {stack}=JSON.parse(options.body);requested+=stack.length;
    return new Response(JSON.stringify({stack:stack.map((frame:any)=>({file:frame.lineNumber===1?'/app/Child.tsx':'/app/Parent.tsx',lineNumber:4,column:2}))}));
  });
  const actions:any[]=['Child','Parent'].map(name=>({id:name,file:name+'.tsx',source:{line:4,column:0,endLine:4,endColumn:30}}));
  const frame=(line:number)=>`    at render (http://localhost:8081/index.bundle:${line}:1)`;
  const bindings:any[]=Array.from({length:240},(_,index)=>({id:String(index),kind:'entry',stack:['Error',...((index%2)?[frame(2),frame(1)]:[frame(1),frame(2)])].join('\n')}));
  const matches=await bindPresentationSites('http://localhost:8081','/app',bindings,[],actions);
  assert.equal(requested,2);assert.deepEqual(matches,bindings.map((binding,index)=>({binding:binding.id,site:index%2?'Parent':'Child'})));
});

test('unverified entries never open a controller even with identical component and callback names',()=>{
  const app=tree();app.action.id='unrelated';app.action.file='Other.tsx';app.runtime.configure({states:[],actions:[app.action]},[]);
  assert.deepEqual(app.runtime.list(),[]);assert.ok(app.runtime.open('unrelated').error);assert.equal(app.control.opens,0);
  delete app.button._debugSource;assert.deepEqual(app.runtime.list(),[]);app.runtime.cleanup();
});

test('source-verified triggers select the correct owner among duplicate component names',()=>{
  const app=tree();let unrelatedBounds=0;const other:any={type:app.root.type,memoizedProps:{},child:undefined};
  const button:any={type:app.button.type,_debugSource:{fileName:'Other.tsx',lineNumber:1,columnNumber:1},memoizedProps:app.button.memoizedProps,return:other};
  const sheet:any={type:app.sheet.type,memoizedProps:{control:{open(){throw Error('wrong controller')},close(){}}},return:other};other.child=button;button.sibling=sheet;
  button.child={tag:5,type:'NativeButton',memoizedProps:{},stateNode:{getBoundingClientRect(){unrelatedBounds++;return {width:10,height:20}}},return:button};
  // Place the unrelated owner first in the traversal.
  other.sibling=app.root;const fibers=(visit:any,subtree?:any)=>{const stack=[subtree??other];while(stack.length){const f=stack.pop();if(f!==subtree&&f.sibling)stack.push(f.sibling);if(visit(f)!==false&&f.child)stack.push(f.child)}};
  const runtime=installPresentationRuntime({hook:{renderers:new Map()},fibers,hidden:()=>false,later:setTimeout});
  configureFixture(runtime,{states:[],actions:[app.action]});
  assert.equal(runtime.list().length,1);assert.equal(runtime.open('open').focus,app.sheet);assert.equal(app.control.opens,1);assert.equal(unrelatedBounds,0);runtime.cleanup();app.runtime.cleanup();
});

test('source-first owner lookup still rejects a visible nested owner that makes the entry ambiguous',()=>{
  const app=tree();
  const nested:any={type:app.root.type,memoizedProps:{},return:app.root};
  app.sheet.sibling=nested;
  assert.deepEqual(app.runtime.list(),[],'A nested same-named owner still excludes its ancestor');
  nested.memoizedProps.hidden=true;
  // This fixture uses only the built-in native visibility properties.
  nested.memoizedProps.style={display:'none'};
  assert.equal(app.runtime.list().length,1);
  app.runtime.cleanup();
});

test('compiled branch creation can bind at its condition without matching another file',async t=>{
  const root=await fixture(t,{'App.tsx':`import {useState} from 'react';
export function App(){const [step,setStep]=useState(0);
return step===0 ? (
<Welcome onPressLogin={()=>setStep(1)}/>
) : <Login/>;}`});
  const catalog=(await scanAppFlow(root,'ios')).presentations!,action=catalog.actions[0];
  assert.equal(action.source?.line,3);
  const binding:any={id:'welcome',kind:'entry',owner:'Welcome',stack:'',source:{file:join(root,'App.tsx'),line:3,column:10}};
  assert.deepEqual(await bindPresentationSites('http://localhost:8081',root,[binding],[],catalog.actions),[{binding:'welcome',site:action.id}]);
});

test('a second discovery timeout after reconnect keeps captured routes and continues the queue',async t=>{
  const directory=await fixture(t,{});let connections=0,discoveryFailed=false;
  const action:any={id:'dialog',owner:'Home',file:'App.tsx',component:'Button',prop:'onPress',name:'Dialog',line:1,effect:{kind:'control',component:'Dialog',prop:'control',method:'open',close:'close'}};
  const nodes:any[]=['Home','Search'].map(name=>({id:name,name,kind:'screen',path:[name],required:[],status:'pending',entry:true}));
  const runs=new AppFlowRuns({directory,scan:async()=>({files:1,scanMs:1,warnings:[],nodes,edges:[],presentations:{states:[],actions:[action]}}),connect:async()=>{
    const generation=++connections;
    return {runtime:{async close(){},async invoke(command:any){
      if(['inspect','resume','recover'].includes(command.type))return {available:true};
      if(command.type==='presentation-setup'&&generation===1){discoveryFailed=true;throw Error('discovery stalled')}
      if(command.type==='heartbeat'&&generation===1&&discoveryFailed)throw Error('connection stalled');
      if(command.type==='open'&&generation===2&&command.path[0]==='Home')throw Error('replay stalled');
      if(command.type==='open')return {ready:true,name:command.path[0],active:command.path,signature:command.path[0]};
      if(command.type==='verify')return {found:true,active:[command.name]};
      if(command.type==='presentations')return [];
      return {};
    }},screenshot:async()=>Buffer.from('frame')};
  }});
  const run=runs.start({projectRoot:directory,platform:'ios',deviceId:'fixture',targetId:'fixture',metroUrl:'http://127.0.0.1:8081',useAi:false});
  while(flowRunning(runs.read(run.id)))await new Promise(resolve=>setTimeout(resolve,5));
  const saved=runs.read(run.id);assert.equal(saved.phase,'partial');assert.equal(saved.error,undefined);
  assert.equal(saved.nodes.filter(node=>node.status==='captured').length,2);assert.equal(connections,2);
  assert.ok(saved.warnings.some(w=>w.includes('partial map was kept')));
  assert.equal(saved.discoveryFailures?.length,1);assert.equal(saved.discoveryFailures?.[0].nodeId,'Home');await runs.close();
});

test('failed discovery retries after fresh routes and discovers sheets without replacing their screenshots',async t=>{
  const directory=await fixture(t,{}),events:string[]=[];let active='Home',collections=0;
  const action:any={id:'sheet',owner:'Home',file:'App.tsx',component:'Button',prop:'onPress',name:'Sheet',line:1,effect:{kind:'control',component:'Sheet',prop:'control',method:'open',close:'close'}};
  const nodes:any[]=['Home','Search'].map(name=>({id:name,name,kind:'screen',path:[name],required:[],status:'pending',entry:true}));
  const runs=new AppFlowRuns({directory,scan:async()=>({files:1,scanMs:1,warnings:[],nodes,edges:[],presentations:{states:[],actions:[action]}}),connect:async()=>({
    runtime:{async close(){},async invoke(command:any){
      if(command.type==='inspect')return {available:true};
      if(command.type==='open'){active=command.path[0];events.push(`open:${active}`);return {ready:true,name:active,active:[active],signature:active};}
      if(command.type==='verify')return {found:true,active:[command.name]};
      if(command.type==='presentation-setup'&&active==='Home'&&++collections===1)throw Error('temporary discovery failure');
      if(command.type==='presentations')return active==='Home'?[action]:[];
      if(command.type==='presentation-open')active='Sheet';
      if(command.type==='presentation-rollback')active='Home';
      if(command.type==='presentation-view')return {key:active,ready:true,found:true,signature:active,active:[active]};
      return {};
    }},async screenshot(){events.push(`capture:${active}`);return Buffer.from(active)},
  })});
  t.after(()=>runs.close());
  const input:any={projectRoot:directory,platform:'ios',deviceId:'fixture',targetId:'fixture',metroUrl:'http://127.0.0.1:8081',useAi:false};
  const store=(runs as any).store,save=store.save.bind(store);
  t.mock.method(store,'save',async(value:any)=>{
    if(value.run.phase==='complete')await new Promise(resolve=>setTimeout(resolve,100));
    return save(value);
  });
  const run=runs.start(input);while(flowRunning(runs.read(run.id)))await new Promise(resolve=>setTimeout(resolve,5));
  const saved=runs.read(run.id);assert.equal(saved.phase,'complete');assert.deepEqual(saved.discoveryFailures,[]);
  assert.equal(saved.nodes.filter(node=>node.status==='captured').length,3);
  assert.ok(events.indexOf('open:Search')<events.lastIndexOf('open:Home'));
  assert.equal(events.filter(event=>event==='capture:Search').length,1);
  assert.equal(events.filter(event=>event==='capture:Home').length,2,'one original route screenshot and one baseline check before opening the sheet');
  assert.ok(!saved.warnings.some(warning=>warning.includes('partial map')));
});

test('extending a captured route discovers newly available sheets and keeps its original image',async t=>{
  const directory=await fixture(t,{});let active='Home',available=false,shots=0;
  const action:any={id:'sheet',owner:'Home',file:'App.tsx',component:'Button',prop:'onPress',name:'Sheet',line:1,effect:{kind:'control',component:'Sheet',prop:'control',method:'open',close:'close'}};
  const runs=new AppFlowRuns({directory,scan:async()=>({files:1,scanMs:1,warnings:[],nodes:[{id:'Home',name:'Home',kind:'screen',path:['Home'],required:[],status:'pending',entry:true}],edges:[],presentations:{states:[],actions:[action]}}),connect:async()=>({
    runtime:{async close(){},async invoke(command:any){
      if(command.type==='inspect')return {available:true};
      if(command.type==='open'){active='Home';return {ready:true,name:active,active:[active],signature:active};}
      if(command.type==='verify')return {found:true,active:[command.name]};
      if(command.type==='presentations')return available&&active==='Home'?[action]:[];
      if(command.type==='presentation-open')active='Sheet';
      if(command.type==='presentation-rollback')active='Home';
      if(command.type==='presentation-view')return {key:active,ready:true,found:true,signature:active,active:[active]};
      return {};
    }},async screenshot(){return Buffer.from(`${active}:${++shots}`)},
  })});
  t.after(()=>runs.close());
  const input:any={projectRoot:directory,platform:'ios',deviceId:'fixture',targetId:'fixture',metroUrl:'http://127.0.0.1:8081',useAi:false};
  const run=runs.start(input);while(flowRunning(runs.read(run.id)))await new Promise(resolve=>setTimeout(resolve,5));
  const image=await readFile(join(directory,run.id,'Home.png'));
  available=true;await runs.extend(run.id,input);while(flowRunning(runs.read(run.id)))await new Promise(resolve=>setTimeout(resolve,5));
  const saved=runs.read(run.id);assert.equal(saved.phase,'complete');assert.equal(saved.nodes.filter(node=>node.status==='captured').length,2);
  assert.equal(saved.nodes.find(node=>node.id==='Home')?.captureAttempts,1);
  assert.deepEqual(await readFile(join(directory,run.id,'Home.png')),image);
});

test('motion limits native layout reads while retaining transition events beyond the signature cap',()=>{
  for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
    const app=tree(install);let calls=0,last:any,original:any;
    let previous=app.nested;
    for(let index=0;index<80;index++){
      const handler=()=>{};
      const canonical={currentProps:{onStateChange:handler},publicInstance:{getBoundingClientRect(){calls++;return {x:index,y:0,width:100,height:200}}}};
      const fiber:any={tag:5,type:'View',memoizedProps:{},stateNode:{canonical},return:app.sheet};
      previous.sibling=fiber;previous=fiber;last=canonical;original=handler;
    }
    app.runtime.open('open');calls=0;
    app.runtime.motion(app.sheet);assert.equal(calls,24);
    last.currentProps.onStateChange({nativeEvent:{state:'opening'}});
    calls=0;const view=app.runtime.motion(app.sheet);
    assert.equal(view.pending,true);assert.equal(calls,24);
    const boxes=JSON.parse(view.signature);
    assert.equal(boxes.length,24);assert.deepEqual(boxes.map((box:any)=>box[0]),Array.from({length:24},(_,i)=>i));
    app.runtime.cleanup();assert.equal(last.currentProps.onStateChange,original);
  }
});
