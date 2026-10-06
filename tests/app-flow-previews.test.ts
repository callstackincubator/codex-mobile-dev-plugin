import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sharedLoopRuntime} from './app-flow-runtime-fixtures.ts';
import {scanAppFlow} from '../src/server/app-flow/scan.ts';
import {installPresentationRuntime} from '../src/server/app-flow/presentations-runtime.js';
import {bindPresentationSites} from '../src/server/app-flow/presentations-bindings.ts';
import {compareViewReference,presentationDestination} from '../scripts/lib/compare-app-flow-views.mjs';
import {compareFlowCapture} from '../scripts/lib/compare-app-flow-capture.mjs';
import {FlowPresentationCapture} from '../src/server/app-flow/presentations.ts';

test('source preview plans cover finite reducer bodies without opener callbacks and exclude business flags',async t=>{
  const root=await mkdtemp(join(tmpdir(),'flow-previews-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'App.tsx'),`import {useReducer,useState} from 'react';enum Step {Info,Handle,Challenge}
    export function App(){const [state]=useReducer(reducer,{});return state.activeStep===Step.Info?<Info/>:state.activeStep===Step.Handle?<Handle/>:<Challenge/>}
    function Secret(){const [session]=useState({screen:'start'});return session.screen==='start'?<Login/>:<Home/>}
    function Business(){const [state]=useState({pendingSubmit:false});return state.pendingSubmit?<Success/>:<Form/>}`);
  const graph=await scanAppFlow(root,'ios'),plans=graph.presentations!.previews!.filter(a=>a.effect.kind==='state');
  assert.deepEqual(plans.map(p=>p.effect.kind==='state'&&p.effect.value).sort(),[0,1,2]);
  assert.deepEqual(plans.map(p=>p.name),['Info','Handle','Challenge']);
  assert.equal(graph.presentations!.actions.length,0);
  assert.match(graph.sourceHash!,/^[a-f\d]{64}$/);
  const reference={views:plans.map((p:any)=>({id:p.name,category:'flow-step',selectors:[{state:{file:p.file,line:graph.presentations!.previewStates![0].line,path:p.effect.path,value:p.effect.value}}]}))};
  const result=compareViewReference(graph,reference,()=>[]);
  assert.equal(result.previewPlannedViews,3);assert.equal(result.actionableViews,0);
});

test('finite state previews prefer the body selected without unrelated guards over an earlier control', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flow-preview-target-')); t.after(() => rm(root, {recursive: true, force: true}));
  await writeFile(join(root, 'App.tsx'), `import {useState} from 'react';
    export function App({canDismiss}) { const [screen]=useState('start'); return <>
      {canDismiss && screen==='start' ? <ActionGlyph/> : null}
      {screen==='start' ? <WelcomeForm/> : <SignInForm/>}
    </> }
    function ActionGlyph() { return <span/> }
    function WelcomeForm() { return <section/> }
    function SignInForm() { return <section/> }`);
  const graph = await scanAppFlow(root, 'ios');
  const plan = graph.presentations!.previews!.find(p => p.effect.kind==='state' && p.effect.value==='start')!;
  assert.equal(plan.name, 'WelcomeForm');
  const source = graph.presentations!.views!.find(v => v.state?.value==='start')!;
  assert.ok(source.components.some(c => c.component==='ActionGlyph'), 'Earlier guarded JSX stays in the source evidence');
  assert.ok(source.components.some(c => c.component==='WelcomeForm'));
  assert.equal(plan.views!.length, 1, 'One finite state still has one capture destination');
});


test('request progress branches stay source evidence and do not become UI selector previews',async t=>{
  const root=await mkdtemp(join(tmpdir(),'flow-preview-progress-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'App.tsx'), `import {useState} from 'react';
    export function App({pending,isLoading,busy}){const [mode]=useState('edit');return <>
      {pending && mode==='edit' ? <ProgressGlyph/> : null}
      {!!isLoading && mode==='check' ? <ProgressGlyph/> : null}
      {busy===true && mode==='send' ? <ProgressGlyph/> : null}
      {!pending && mode==='edit' ? <EditForm/> : null}
      {isLoading===false && mode==='check' ? <CheckForm/> : null}
      {busy!==true && mode==='send' ? <SendForm/> : null}
    </>}
    export function Optional({pending}){const [mode]=useState('edit');return mode==='edit'||pending?<OptionalForm/>:null}
    function ProgressGlyph(){return <span/>}function EditForm(){return <section/>}
    function OptionalForm(){return <section/>}function CheckForm(){return <section/>}function SendForm(){return <section/>}`);
  const graph=await scanAppFlow(root,'ios'),catalog=graph.presentations!;
  const plans=catalog.previews!.filter(p=>p.effect.kind==='state');
  assert.deepEqual(plans.map(p=>p.component).sort(),['CheckForm','EditForm','OptionalForm','SendForm']);
  assert.ok(catalog.views!.some(v=>v.components.some(c=>c.component==='ProgressGlyph')),'Progress branches remain source evidence');
  assert.ok(plans.every(p=>p.component!=='ProgressGlyph'));
});


test('a local reducer form keeps its body when a nested row callback uses the same selector first', async t => {
  const root=await mkdtemp(join(tmpdir(),'flow-preview-rows-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'App.tsx'), `import {useReducer} from 'react';
    export function App(){const [{page}]=useReducer(reducer,{page:0});
      const renderItem=()=>page===1?<MemberRow/>:null;
      return page===1?<MemberForm/>:<StartForm/>;
    }
    function MemberRow(){return <span/>}
    function MemberForm(){return <section/>}
    function StartForm(){return <section/>}`);
  const graph=await scanAppFlow(root,'ios');
  const plan=graph.presentations!.previews!.find(p=>p.effect.kind==='state'&&p.effect.value===1);
  assert.ok(plan,'The nested callback must not hide the form preview');
  assert.equal(plan.owner,'App');assert.equal(plan.component,'MemberForm');
  assert.equal(plan.consumer,undefined,'A local hook needs no shared consumer binding');
  const view=graph.presentations!.views!.find(v=>v.id===plan.views![0])!;
  assert.ok(view.components.some(c=>c.component==='MemberRow'),'Row evidence remains in the catalog');
  assert.ok(view.components.some(c=>c.component==='MemberForm'));
  assert.equal(graph.presentations!.previews!.filter(p=>p.effect.kind==='state'&&p.effect.value===1).length,1);
});

test('a shared reducer form uses a source-bound consumer instead of an earlier list callback in another file', async t => {
  const root=await mkdtemp(join(tmpdir(),'flow-preview-consumer-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'App.tsx'), `import {createContext,useReducer} from 'react';
    import {Form} from './Form';export const Context=createContext(null);
    export function App(){const [state]=useReducer(reducer,{page:'start'});
      const renderItem=()=>state.page==='members'?<MemberRow/>:null;
      return <Context.Provider value={state}><Form/></Context.Provider>}
    function MemberRow(){return <span/>}`);
  await writeFile(join(root,'Form.tsx'), `import {useContext} from 'react';import {Context} from './App';
    export function Form(){const state=useContext(Context);return state.page==='members'?<MemberForm/>:<StartForm/>}
    function MemberForm(){return <section/>} function StartForm(){return <section/>}`);
  const graph=await scanAppFlow(root,'ios');
  const plan=graph.presentations!.previews!.find(p=>p.effect.kind==='state'&&p.effect.value==='members');
  assert.ok(plan,'A real form consumer needs a preview even when an earlier callback has no component entry');
  assert.equal(plan.file,'Form.tsx');assert.equal(plan.owner,'Form');assert.equal(plan.component,'MemberForm');
  assert.equal(plan.consumer?.component,'Form');assert.equal(plan.consumer?.entries[0].owner,'App');
  const view=graph.presentations!.views!.find(v=>v.id===plan.views![0])!;
  assert.ok(view.components.some(c=>c.file==='App.tsx'&&c.component==='MemberRow'));
});

test('a boolean body selector with a proven UI setter does not depend on its spelling', async t => {
  const root=await mkdtemp(join(tmpdir(),'flow-preview-boolean-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'App.tsx'), `import {useState} from 'react';
    export function App(){const [override,setOverride]=useState(false);if(override)return <Content/>;return <Warning><Button onPress={()=>setOverride(true)}/></Warning>}
    function Content(){return <section/>} function Warning(){return <section/>} function Button(){return <button/>}
    function Account(){const [authenticated]=useState(false);return authenticated?<Content/>:<Warning/>}`);
  const graph=await scanAppFlow(root,'ios');
  const plans=graph.presentations!.previews!.filter(p=>p.effect.kind==='state');
  assert.deepEqual(plans.map(p=>p.effect.kind==='state'&&p.effect.value).sort(),[false,true]);
  assert.ok(plans.every(p=>p.owner==='App'));
});


test('a sheet controller passed only to callbacks is not an extra native presentation target', async t => {
  const root=await mkdtemp(join(tmpdir(),'flow-preview-control-owner-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'App.tsx'), `import {useImperativeHandle,useRef} from 'react';
    export function App(){const control=useControl(),otherControl=useControl();return <Sheet control={control} otherControl={otherControl}/>}
    function Sheet({control,otherControl}){return <Outer control={control}><Body otherControl={otherControl}/></Outer>}
    function Outer({control,children}){const ref=useRef(null);useImperativeHandle(control.ref,()=>({open:()=>ref.current.present(),close:()=>ref.current.dismiss()}));return <NativeSheet ref={ref}>{children}</NativeSheet>}
    function Body({otherControl}){return <Button onPress={()=>otherControl.open()}/>}`);
  const graph=await scanAppFlow(root,'ios');
  const previews=graph.presentations!.previews!.filter(p=>p.file==='App.tsx'&&p.owner==='App'&&p.effect.kind==='control');
  assert.deepEqual(previews.map(p=>p.effect.kind==='control'&&p.effect.prop),['control']);
  const source=graph.presentations!.views!.find(v=>v.control?.prop==='otherControl'&&v.owner==='App')!;
  assert.ok(source,'An outbound controller still remains source evidence');assert.equal(source.control!.boundary,false);
});


test('a cached header renders through its enclosing form without requiring a list row or footer data', async t => {
  const root=await mkdtemp(join(tmpdir(),'flow-preview-header-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'App.tsx'), `import {useMemo,useReducer} from 'react';
    export function App({members}){const [{page}]=useReducer(reducer,{page:0});
      const renderItem=({item})=>page===1?<MemberRow item={item}/>:null;
      const header=useMemo(()=>page===1?<SearchForm/>:null,[page]);
      return <List header={header} renderItem={renderItem}>{page===1&&members.length>0?<Footer/>:null}</List>;
    }
    function MemberRow(){return <span/>} function SearchForm(){return <section/>} function Footer(){return <footer/>}`);
  const graph=await scanAppFlow(root,'ios');
  const plan=graph.presentations!.previews!.find(p=>p.effect.kind==='state'&&p.effect.value===1)!;
  assert.equal(plan.owner,'App');assert.equal(plan.component,'SearchForm');assert.equal(plan.consumer,undefined);
});


test('a spread keeps unknown controller ownership eligible for runtime discovery', async t => {
  const root=await mkdtemp(join(tmpdir(),'flow-preview-control-spread-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'App.tsx'), `import {useImperativeHandle} from 'react';
    export function App(){const control=useControl(),otherControl=useControl();return <Sheet control={control} otherControl={otherControl}/>}
    function Sheet(props){return <><Outer control={props.control}/><Other {...props}/></>}
    function Outer({control}){useImperativeHandle(control.ref,()=>({open(){},close(){}}));return <section/>}`);
  const graph=await scanAppFlow(root,'ios');
  assert.ok(graph.presentations!.previews!.some(p=>p.owner==='App'&&p.effect.kind==='control'&&p.effect.prop==='otherControl'));
});

function runtimeFixture(t:test.TestContext,shared=false,install=installPresentationRuntime,extra?:{modules?:any[];bootstrap?:any;hook?:any}){
  const real={step:'start',record:{id:'observed-record'},pendingSubmit:null};let current:any,clone:any,projection:any;
  let dispatched=0,effects=0,initializers=0,walks=0;const effectKinds:string[]=[];
  function View(){}function Modal(){}function Provider(){}function Wizard(){}function Form(){}function Start(){}function Verify(){}
  const originalChildren={type:Wizard,props:{}};
  const host:any={tag:5,type:View,memoizedProps:{children:originalChildren}};
  const owner:any={type:shared?Provider:Wizard,return:host,memoizedProps:{},memoizedState:{memoizedState:real,next:null}};host.child=owner;
  const context:any={tag:10,type:{},return:owner,memoizedProps:{value:[real,()=>{}]}};
  const form:any={type:Form,return:context,memoizedProps:{},_debugSource:{fileName:'App.tsx',lineNumber:5,columnNumber:1}};
  if(shared){owner.child=context;context.child=form;form.child={type:Start,return:form,memoizedProps:{}};}else owner.child={type:Start,return:owner,memoizedProps:{}};
  const reducer=(fn:any,initial:any,init?:any)=>{const state=current===owner?real:init?init(initial):initial;current.memoizedState={memoizedState:state,next:null};return [state,()=>{dispatched++;fn(state,{})}];};
  const react:any={createElement(type:any,props:any,...children:any[]){return {type,props:{...props,...(children.length?{children:children.length===1?children[0]:children}:{})}}},Component:class{},Fragment:Symbol(),useState(initial:any){const value=typeof initial==='function'?initial():initial;if(current)current.memoizedState={memoizedState:value,next:null};return [value,()=>{}]},useReducer:reducer,useEffect(callback:any){effectKinds.push('useEffect');callback()},useLayoutEffect(callback:any){effectKinds.push('useLayoutEffect');callback()},useInsertionEffect(callback:any){effectKinds.push('useInsertionEffect');callback()}};
  const originals={useReducer:react.useReducer,useEffect:react.useEffect,useLayoutEffect:react.useLayoutEffect};
  const native={View,Modal,Platform:{OS:'ios'},StyleSheet:{create(){}}};
  const prior=(globalThis as any).__r;(globalThis as any).__r={getModules:()=>new Map([[1,{isInitialized:true,publicModule:{exports:react}}],[2,{isInitialized:true,publicModule:{exports:native}}],...(extra?.modules??[])])};t.after(()=>{(globalThis as any).__r=prior});
  const fibers=(visit:any,subtree?:any)=>{if(!subtree)walks++;const stack=[subtree??host];while(stack.length){const fiber=stack.pop();if(fiber!==subtree&&fiber.sibling)stack.push(fiber.sibling);if(visit(fiber)!==false&&fiber.child)stack.push(fiber.child)}};
  const renderer:any={rendererPackageName:'react-native-renderer',getCurrentFiber:()=>current,scheduleUpdate(fiber:any){current=fiber;fiber.memoizedState=null;react.useReducer(()=>{throw Error('never dispatch')},real);current=undefined;},overrideProps(fiber:any,_path:any,props:any){
    fiber.memoizedProps=props;const modal=props.children?.props?.children?.at?.(-1);
    if(!modal||modal.type!==Modal){owner.sibling=undefined;clone=undefined;projection=undefined;return;}
    let child=modal.props.children.props.children;projection=child;
    while(child.type!==Wizard&&child.type!==Form&&child.type!==extra?.bootstrap)child=child.props.children;
    clone={type:child.type,return:host,pendingProps:child.props,memoizedProps:child.props,memoizedState:null};owner.sibling=clone;current=clone;
    if(child.type===extra?.bootstrap)react.useState({step:'start'});
    else if(!shared)react.useReducer(()=>{throw Error('never dispatch')},{},()=>{initializers++;throw Error('never initialize with business code')});
    react.useEffect(()=>effects++);react.useLayoutEffect(()=>effects++);
    const snapshot=shared?projection.props.value[0]:clone.memoizedState.memoizedState;
    clone.child={type:snapshot.step==='verify'?Verify:Start,return:clone,memoizedProps:{}};
    modal.props.onShow();current=undefined;
  }};
  const hook=extra?.hook??{};hook.renderers=new Map([[1,renderer]]);
  const runtime=install({hook,fibers,hidden:()=>false,later:setTimeout});t.after(()=>runtime.cleanup());
  const site:any={id:'state',file:'App.tsx',line:1,column:0,endLine:1,owner:shared?'useFlow':'Wizard',owners:shared?['Provider']:[],paths:[['step']],hook:'useReducer'};
  const action:any={id:'preview',file:'App.tsx',line:2,owner:shared?'Form':'Wizard',name:'Verify',component:'Verify',prop:'',preview:true,views:['verified-body'],effect:{kind:'state',site:'state',path:['step'],value:'verify'},...(shared?{consumer:{component:'Form',entries:[{file:'App.tsx',owner:'Provider',source:{line:5,column:0,endLine:5,endColumn:10}}]}}:{})};
  return {runtime,site,action,real,owner,host,form,context,react,originals,originalChildren,effectKinds,hook,get walks(){return walks},get clone(){return clone},get projection(){return projection},get counts(){return {dispatched,effects,initializers}},setCurrent:(fiber:any)=>{current=fiber}};
}

async function configure(app:ReturnType<typeof runtimeFixture>,projectRoot?:string){
  const page=await app.runtime.collect([app.site],[app.action],projectRoot);
  app.runtime.configure({states:[app.site],actions:[app.action]},page.bindings.map(b=>({binding:b.id,site:b.kind==='entry'?'preview:consumer':'state'})),page.bindings.map(b=>b.id));
  return page;
}

test('a reducer preview seeds a temporary instance, contains effects and preserves the original form',async t=>{
  const app=runtimeFixture(t);await configure(app);
  assert.equal(app.runtime.list().length,1);
  const opened=app.runtime.open('preview');assert.equal(opened.error,undefined);
  assert.equal(app.clone.memoizedState.memoizedState.step,'verify');
  assert.equal(app.clone.memoizedState.memoizedState.record,app.real.record);
  assert.equal(app.real.step,'start');assert.deepEqual(app.counts,{dispatched:0,effects:0,initializers:0});
  // The original app still runs its own effects while the preview is open.
  let originalEffects=0;app.setCurrent(app.owner);app.react.useEffect(()=>originalEffects++);app.setCurrent(undefined);assert.equal(originalEffects,1);
  assert.ok(app.runtime.activeViews(app.owner).includes('verified-body'));
  await app.runtime.rollback(0,false);
  assert.equal(app.clone,undefined);assert.equal(app.runtime.checkpoint(),0);
  assert.equal(app.react.useReducer,app.originals.useReducer);
  assert.equal(app.react.useEffect,app.originals.useEffect);
  assert.equal(app.react.useLayoutEffect,app.originals.useLayoutEffect);
});

test('a shared reducer preview copies its tuple context and keeps live props and data references',async t=>{
  const app=runtimeFixture(t,true);const page=await configure(app);
  assert.ok(page.bindings.some(b=>b.kind==='useReducer'));
  assert.ok(page.bindings.some(b=>b.kind==='entry'));
  assert.equal(app.runtime.open('preview').error,undefined);
  assert.equal(app.projection.props.value[0].step,'verify');
  assert.equal(app.projection.props.value[0].record,app.real.record);
  assert.equal(app.context.memoizedProps.value[0],app.real);
  assert.deepEqual(app.counts,{dispatched:0,effects:0,initializers:0});
  await app.runtime.rollback(0,false);assert.equal(app.host.memoizedProps.children,app.originalChildren);
});

test('serialized hook and effect wrappers keep their identities with shared loop bindings',async t=>{
  const app=runtimeFixture(t,false,sharedLoopRuntime());await configure(app);
  const calls:string[]=[];
  const opened=app.runtime.open('preview');assert.equal(opened.error,undefined);
  assert.equal(app.clone.memoizedState.memoizedState.step,'verify');
  const originalEffect=app.originals.useEffect,originalLayout=app.originals.useLayoutEffect;
  assert.notEqual(originalEffect,originalLayout);
  app.effectKinds.length=0;
  app.setCurrent(app.owner);app.react.useEffect(()=>calls.push('effect'));app.react.useLayoutEffect(()=>calls.push('layout'));app.react.useInsertionEffect(()=>calls.push('insertion'));app.setCurrent(undefined);
  assert.deepEqual(calls,['effect','layout','insertion']);assert.deepEqual(app.effectKinds,['useEffect','useLayoutEffect','useInsertionEffect']);assert.deepEqual(app.counts,{dispatched:0,effects:0,initializers:0});
  await app.runtime.rollback(0,false);
  assert.equal(app.react.useReducer,app.originals.useReducer);assert.equal(app.react.useEffect,originalEffect);assert.equal(app.react.useLayoutEffect,originalLayout);
});

test('collection preserves useState and useReducer calls with shared loop bindings',async t=>{
  function App(){}const owner:any={type:App,memoizedProps:{},memoizedState:null};const calls:string[]=[];
  const append=(kind:string,value:any)=>{calls.push(kind);const hook={memoizedState:value,next:null};let previous=owner.memoizedState;if(!previous)owner.memoizedState=hook;else{while(previous.next)previous=previous.next;previous.next=hook;}return [value,()=>{}];};
  let initialized=0;
  const react:any={createElement(){},useState(value:any){return append('useState',typeof value==='function'?value():value)},useReducer(_reducer:any,value:any){return append('useReducer',value)}};
  const originals={...react},prior=(globalThis as any).__r;(globalThis as any).__r={getModules:()=>new Map([[1,{isInitialized:true,publicModule:{exports:react}}]])};
  const renderer={rendererPackageName:'react-native-renderer',getCurrentFiber:()=>owner,scheduleUpdate(){owner.memoizedState=null;react.useState('state');react.useReducer(()=>{},'reducer');react.useState(()=>{initialized++;return 'second state'});}};
  const runtime=sharedLoopRuntime()({hook:{renderers:new Map([[1,renderer]])},fibers:(visit:any)=>visit(owner),hidden:()=>false,later:setTimeout});
  t.after(()=>{runtime.cleanup();(globalThis as any).__r=prior});
  const page=await runtime.collect([{id:'hook',owner:'App'}]);
  assert.deepEqual(calls,['useState','useReducer','useState']);assert.deepEqual(page.bindings.map(binding=>binding.kind),calls);
  assert.deepEqual(page.bindings.map(binding=>binding.owner),['App','App','App']);
  assert.equal(owner.memoizedState.memoizedState,'state');assert.equal(owner.memoizedState.next.memoizedState,'reducer');
  assert.equal(owner.memoizedState.next.next.memoizedState,'second state');assert.equal(initialized,1);
  assert.equal(react.useState,originals.useState);assert.equal(react.useReducer,originals.useReducer);
});

test('shared-state previews require an exact consumer entry and reject ambiguous shared references',async t=>{
  const app=runtimeFixture(t,true);const page=await app.runtime.collect([app.site],[app.action]);
  app.runtime.configure({states:[app.site],actions:[app.action]},page.bindings.filter(b=>b.kind!=='entry').map(b=>({binding:b.id,site:'state'})));
  assert.deepEqual(app.runtime.list(),[]);
  app.runtime.configure({states:[app.site],actions:[app.action]},page.bindings.filter(b=>b.kind==='entry').map(b=>({binding:b.id,site:'preview:consumer'})));
  app.form.memoizedProps={state:app.real};
  assert.match(app.runtime.open('preview').error!,/ambiguous/);
  assert.equal(app.clone,undefined);assert.equal(app.real.step,'start');
});

test('controller-only source previews require the exact target and no opening arguments',async()=>{
  let opened=0,closed=0;function App(){}function Outer(){}
  const control={open(){opened++},close(){closed++}},root:any={type:App,memoizedProps:{}};
  const sheet:any={type:Outer,return:root,memoizedProps:{control},_debugSource:{fileName:'/app/App.tsx',lineNumber:3,columnNumber:1}};root.child=sheet;
  const fibers=(visit:any,subtree?:any)=>{visit(subtree??root);if(!subtree)visit(sheet)};
  const runtime=installPresentationRuntime({hook:{renderers:new Map()},fibers,hidden:()=>false,later:setTimeout});
  const action:any={id:'sheet',file:'App.tsx',line:3,owner:'App',component:'Outer',prop:'',name:'Outer',preview:true,effect:{kind:'control',component:'Outer',prop:'control',method:'auto',close:['close'],target:{file:'App.tsx',owner:'App',line:3,source:{line:3,column:0,endLine:3,endColumn:30}}}};
  const records=await runtime.collect([],[action]);
  const matches=await bindPresentationSites('http://127.0.0.1:8082','/app',records.bindings,[],[action]);runtime.configure({states:[],actions:[action]},matches);
  assert.equal(runtime.list().length,1);runtime.open('sheet');assert.equal(opened,1);
  await runtime.rollback(0,false);assert.equal(closed,1);
  sheet.memoizedProps.control={open(_data:any){opened++},close(){}};assert.deepEqual(runtime.list(),[]);
  sheet.memoizedProps.control=control;root.memoizedProps={style:{display:'none'}};assert.deepEqual(runtime.list(),[]);
  runtime.cleanup();
});

test('nested preview metadata counts only the top visible state',async t=>{
  const app=runtimeFixture(t);await configure(app);app.runtime.open('preview');
  const next={...app.action,id:'done',name:'Start',views:['done-body'],effect:{...app.action.effect,value:'done'}};
  app.runtime.configure({states:[app.site],actions:[app.action,next]},[]);
  app.runtime.open('done');assert.deepEqual(app.runtime.activeViews(app.owner),['done-body']);
});

test('many preview plans share one mounted-tree lookup and see fresh state on the next check',async t=>{
  const app=runtimeFixture(t);await configure(app);
  const plans=Array.from({length:128},(_,i)=>({...app.action,id:`plan-${i}`,effect:{...app.action.effect,value:`step-${i}`}}));
  app.runtime.configure({states:[app.site],actions:plans},[]);
  let before=app.walks;assert.equal(app.runtime.list().length,128);assert.equal(app.walks-before,1);
  app.real.step='step-10';
  before=app.walks;assert.equal(app.runtime.list().length,127);assert.equal(app.walks-before,1);
  before=app.walks;app.runtime.activeViews(app.owner);assert.equal(app.walks-before,1);
});

for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
  test(`absolute Metro module paths identify the exact state owner (${install===installPresentationRuntime?'normal':'shared loops'})`,async t=>{
    const exports:any={};
    const app=runtimeFixture(t,false,install,{modules:[[3,{isInitialized:true,verboseName:'/workspace/demo/App.tsx',publicModule:{exports}}]]});
    exports.Wizard=app.owner.type;
    const unrelated:any={type:function Wizard(){},return:app.host,memoizedProps:{},memoizedState:{memoizedState:{step:'start'},next:null}};
    app.owner.sibling=unrelated;
    const renderer=app.hook.renderers.get(1),scheduled:any[]=[],update=renderer.scheduleUpdate;
    renderer.scheduleUpdate=(fiber:any)=>{scheduled.push(fiber);return update(fiber)};
    await configure(app,'/workspace/demo');
    assert.deepEqual(scheduled,[app.owner],'A same-named component from another module must not be rerendered');
    assert.equal(app.runtime.list().length,1);
    assert.equal(app.counts.dispatched,0);
  });
}

for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
  test(`custom hook consumers use their own module paths (${install===installPresentationRuntime?'normal':'shared loops'})`,async t=>{
    const providerExports:any={};
    const app=runtimeFixture(t,true,install,{modules:[
      [3,{isInitialized:true,verboseName:'/workspace/demo/State.tsx',publicModule:{exports:{useFlow:function useFlow(){}}}}],
      [4,{isInitialized:true,verboseName:'/workspace/demo/Provider.tsx',publicModule:{exports:providerExports}}],
    ]});
    providerExports.Provider=app.owner.type;
    app.site.file='State.tsx';app.site.ownerSites=[{owner:'Provider',file:'Provider.tsx'}];
    const unrelated:any={type:function Provider(){},return:app.host,memoizedProps:{},memoizedState:{memoizedState:{step:'start'},next:null}};
    app.owner.sibling=unrelated;
    const renderer=app.hook.renderers.get(1),scheduled:any[]=[],update=renderer.scheduleUpdate;
    renderer.scheduleUpdate=(fiber:any)=>{scheduled.push(fiber);return update(fiber)};
    await configure(app,'/workspace/demo');
    assert.deepEqual(scheduled,[app.owner],'A custom hook must not collect unrelated same-named providers');
    assert.equal(app.runtime.list().length,1);
    assert.equal(app.counts.dispatched,0);
  });
}

for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
  test(`unchanged presentation binding passes reuse committed structure (${install===installPresentationRuntime?'normal':'shared loops'})`,async t=>{
    let commits=0;const hook={onCommitFiberRoot(){commits++}};
    const app=runtimeFixture(t,false,install,{hook});await configure(app);assert.equal(app.runtime.list().length,1);
    const before=app.walks;await configure(app);assert.equal(app.runtime.list().length,1);
    assert.equal(app.walks-before,0,'Source binding updates alone do not change the committed tree');
    app.owner.memoizedState.memoizedState.step='verify';hook.onCommitFiberRoot();
    const changed=app.walks;assert.equal(app.runtime.list().length,0);
    assert.equal(app.walks-changed,1,'A real commit still needs a fresh tree');assert.equal(commits,1);
    app.runtime.cleanup();assert.equal(hook.onCommitFiberRoot.name,'onCommitFiberRoot');
  });
}

test('a source-only preview uses the capture queue and a failed body does not stop its siblings',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'preview-capture-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const id='00000000-0000-0000-0000-000000000000';await mkdir(join(directory,id));
  const action:any={id:'step',file:'App.tsx',line:1,owner:'App',component:'Form',prop:'',name:'Form',preview:true,views:['source-body'],effect:{kind:'state',site:'state',path:['step'],value:1}};
  const run:any={id,sourceHash:'source',revision:0,nodes:[],edges:[],presentations:{states:[],actions:[],previews:[action],previewStates:[]}};
  const base:any={id:'entry',kind:'screen',name:'Entry',path:[],required:[],status:'captured'};run.nodes.push(base);
  let opened=false,failed=false,shots=0;
  const backend:any={screenshot:async()=>Buffer.from(`frame-${shots++}`),runtime:{async invoke(command:any){
    if(command.type==='presentation-setup'){assert.equal(command.catalog.actions.length,1);assert.equal(command.catalog.views,undefined);return {};}
    if(command.type==='presentation-active')return [];
    if(command.type==='presentations')return opened?[]:[action];
    if(command.type==='presentation-open'){opened=true;return {};}
    if(command.type==='presentation-rollback'){opened=false;return {};}
    if(command.type==='presentation-view')return {key:'same-components',signature:opened?'new-body':'old-body',found:true,ready:!failed,error:failed?'The temporary presentation preview failed.':undefined};
    return {};
  }}};
  const capture=new FlowPresentationCapture(run,directory,directory,new AbortController().signal,async()=>{});
  assert.equal(capture.enabled,true);await capture.explore(backend,base);
  const node=run.nodes[1];await capture.retry(backend,node);
  assert.equal(node.status,'captured');assert.equal(node.presentation.preview,true);assert.equal(node.imageSourceHash,'source');assert.deepEqual(node.sourceViews,['source-body']);
  node.image=undefined;node.status='pending';failed=true;await capture.retry(backend,node);
  assert.equal(node.status,'blocked');assert.equal(base.status,'captured');assert.equal(opened,false);
});

test('capture comparison counts verified automatic images once and separates UI previews from live captures',()=>{
  const action:any={id:'step',effect:{kind:'state',site:'hook',path:['step'],value:1}},key=presentationDestination(action);
  const graph:any={sourceHash:'current',presentations:{actions:[action],views:[]}};
  const comparison:any={rows:[{id:'home',label:'Home',category:'route',selectors:[{route:'Home'}],candidates:[]},
    {id:'step',label:'Step',category:'flow-step',selectors:[],candidates:[{key,result:'exact'}]},
    {id:'failed',label:'Failed',category:'sheet',selectors:[{route:'Missing'}],candidates:[]}]};
  const run:any={id:'run',sourceHash:'current',nodes:[{id:'home',kind:'screen',name:'Home',status:'captured',image:'image',imageSourceHash:'current'},
    {id:'step',kind:'screen',status:'captured',image:'image',imageSourceHash:'current',presentation:{actions:['step'],preview:true}},
    {id:'recorded',kind:'screen',name:'Missing',status:'captured',capture:'observed',image:'image'}]};
  let result=compareFlowCapture(graph,comparison,run,new Set(['home','step','recorded']));
  assert.equal(result.automaticCapturedViews,2);assert.equal(result.liveCapturedViews,1);assert.equal(result.previewCapturedViews,1);
  result=compareFlowCapture(graph,comparison,run,new Set(['home']));assert.equal(result.automaticCapturedViews,1);
  const child={id:'child',effect:{kind:'state',site:'hook',path:['step'],value:2}};
  graph.presentations.actions.push(child);
  run.nodes[1].presentation.actions.push('child');
  result=compareFlowCapture(graph,comparison,run,new Set(['home','step']));assert.equal(result.automaticCapturedViews,1);
  assert.throws(()=>compareFlowCapture(graph,comparison,{...run,sourceHash:'old'},new Set()),/source differs/);
});


test('an open controller cannot requeue its own captured preview during child discovery',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'preview-self-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const id='00000000-0000-0000-0000-000000000000';await mkdir(join(directory,id));
  const action:any={id:'sheet',file:'App.tsx',line:1,owner:'App',component:'Sheet',prop:'',name:'Sheet',preview:true,effect:{kind:'control',component:'Sheet',prop:'control',method:'open',close:'close'}};
  const run:any={id,sourceHash:'source',revision:0,nodes:[],edges:[],presentations:{states:[],actions:[],previews:[action],previewStates:[]}};
  const base:any={id:'entry',name:'Home',kind:'screen',path:[],required:[],status:'captured'};run.nodes.push(base);
  let opened=false,shots=0;
  const backend:any={screenshot:async()=>Buffer.from(`frame-${shots++}`),runtime:{async invoke(c:any){
    if(c.type==='presentations')return [action];
    if(c.type==='presentation-open')opened=true;
    if(c.type==='presentation-rollback')opened=false;
    return {key:opened?'sheet':'home',signature:opened?'sheet':'home',ready:true,found:true,active:[]};
  }}};
  const capture=new FlowPresentationCapture(run,directory,directory,new AbortController().signal,async()=>{});
  await capture.explore(backend,base);const sheet=run.nodes[1];await capture.retry(backend,sheet);
  assert.equal(sheet.status,'captured');assert.equal(sheet.captureAttempts,1);assert.ok(sheet.image);
  assert.equal(run.nodes.length,2);assert.equal(run.edges.length,1);assert.equal(opened,false);
});


test('unmounted owner plans require an export with optional props, including inherited members',async t=>{
  const root=await mkdtemp(join(tmpdir(),'preview-owners-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'Props.ts'),`export interface Base {record:string};export interface ImportedRequired extends Base {label?:string};export interface ImportedOptional {label?:string}`);
  await writeFile(join(root,'App.tsx'),`import {useState} from 'react';import type {ImportedRequired,ImportedOptional} from './Props';
    interface Base {optional?:boolean};type Props={onClose?:()=>void};interface Optional extends Props {label?:string};
    interface Required {record:string};interface HiddenRequired extends Required {label?:string};
    export function OptionalForm({onClose}:Optional){const [screen]=useState<'start'|'next'>('start');return screen==='start'?<Start/>:<Next/>}
    export function RequiredForm({record}:HiddenRequired){const [screen]=useState<'start'|'next'>('start');return screen==='start'?<Start/>:<Next/>}
    export function ImportedForm(props:ImportedOptional){const [screen]=useState<'start'|'next'>('start');return screen==='start'?<Start/>:<Next/>}
    export function ImportedDataForm(props:ImportedRequired){const [screen]=useState<'start'|'next'>('start');return screen==='start'?<Start/>:<Next/>}
    export function UnknownForm(props:Unknown){const [screen]=useState<'start'|'next'>('start');return screen==='start'?<Start/>:<Next/>}
    function PrivateForm(){const [screen]=useState<'start'|'next'>('start');return screen==='start'?<Start/>:<Next/>}
    export default function DefaultForm(){const [screen]=useState<'start'|'next'>('start');return screen==='start'?<Start/>:<Next/>}`);
  const graph=await scanAppFlow(root,'ios');
  const plans=graph.presentations!.previews!.filter(p=>p.effect.kind==='mount');
  assert.deepEqual(plans.map(p=>p.owner).sort(),['DefaultForm','ImportedForm','OptionalForm']);
  assert.equal(plans.find(p=>p.owner==='DefaultForm')!.effect.kind==='mount'&&(plans.find(p=>p.owner==='DefaultForm')!.effect as any).export,'default');
  for(const plan of plans){assert.equal(plan.views!.length,1);assert.equal(graph.presentations!.views!.find(v=>v.id===plan.views![0])!.kind,'component');}
});

test('unmounted previews use initialized exact data exports and keep each owner distinct',async t=>{
  for(const install of [installPresentationRuntime,sharedLoopRuntime()])for(const projectRoot of [undefined,'/workspace/demo']){
    function Welcome(){}function OtherWelcome(){}
    const exports:any={Welcome,OtherWelcome};Object.defineProperty(exports,'Getter',{get(){assert.fail('Never invoke an export getter')}});
    const modules=[[3,{verboseName:projectRoot?`${projectRoot}/Forms.tsx`:'Forms.tsx',isInitialized:true,publicModule:{exports}}],
      [4,{verboseName:projectRoot?`${projectRoot}/Never.tsx`:'Never.tsx',isInitialized:false,get publicModule(){assert.fail('Never initialize a module')}}],
      [5,{verboseName:'/workspace/other/Other.tsx',isInitialized:true,publicModule:{exports:{Welcome}}}]];
    const app=runtimeFixture(t,false,install,{modules,bootstrap:Welcome});
    const mount=(id:string,owner:string,file='Forms.tsx',exported=owner):any=>({id,file,line:1,owner,component:owner,name:owner,prop:'',preview:true,views:[`${id}-body`],effect:{kind:'mount',file,export:exported}});
    const actions=[mount('welcome','Welcome'),mount('other','OtherWelcome'),mount('wrong','Welcome','Other.tsx'),mount('getter','Getter'),mount('never','Welcome','Never.tsx')];
    if(projectRoot)await app.runtime.collect([],actions,projectRoot);
    app.runtime.configure({states:[],actions},[]);
    assert.deepEqual(app.runtime.list().map(a=>a.id),['welcome','other']);
    assert.deepEqual(app.runtime.diagnostics().mountChecks,{plans:5,moduleMissing:2,moduleCold:1,moduleUnknown:1,exportMissing:1,ownerMismatch:0,alreadyMounted:0,available:2});
    assert.equal(app.runtime.open('welcome').error,undefined);assert.equal(app.clone.type,Welcome);
    assert.deepEqual(app.clone.memoizedProps,{});assert.deepEqual(app.counts,{dispatched:0,effects:0,initializers:0});
    app.runtime.focused(app.clone);
    assert.deepEqual(app.runtime.activeViews(app.clone),['welcome-body']);
    assert.deepEqual(app.runtime.list(app.clone),[],'A child form cannot bootstrap another unrelated owner');
    await app.runtime.rollback(0,false);assert.equal(app.clone,undefined);assert.equal(app.host.memoizedProps.children,app.originalChildren);
    assert.deepEqual(app.runtime.list().map(a=>a.id),['welcome','other']);
    app.host.memoizedProps={style:{display:'none'}};assert.deepEqual(app.runtime.list(),[]);
  }
});


for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
  test(`cleanup clears the project root for unmounted exports (${install===installPresentationRuntime?'normal':'shared loops'})`,async t=>{
    function Welcome(){}
    const app=runtimeFixture(t,false,install,{modules:[[3,{verboseName:'file:///workspace/demo/Forms.tsx',isInitialized:true,publicModule:{exports:{Welcome}}}]],bootstrap:Welcome});
    const action:any={id:'welcome',file:'Forms.tsx',line:1,owner:'Welcome',component:'Welcome',name:'Welcome',prop:'',preview:true,views:['welcome-body'],effect:{kind:'mount',file:'Forms.tsx',export:'Welcome'}};
    const catalog={states:[],actions:[action]};
    await app.runtime.collect([],catalog.actions,'/workspace/demo/');
    app.runtime.configure(catalog,[]);assert.deepEqual(app.runtime.list().map(a=>a.id),['welcome']);
    app.runtime.cleanup();app.runtime.configure(catalog,[]);
    assert.deepEqual(app.runtime.list(),[],'A later catalog must not inherit the old project root');
  });
}


test('finite UI body selectors do not depend on the hook field name',async t=>{
  const root=await mkdtemp(join(tmpdir(),'flow-preview-fields-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'App.tsx'),`import {useState} from 'react';enum Pane {People,Name}
    export function App(){const [mode]=useState('people');return mode==='people'?<People/>:mode==='name'?<Name/>:null}
    export function Group(){const [choice]=useState(Pane.People);return choice===Pane.People?<Members/>:choice===Pane.Name?<Title/>:null}
    export function Request(){const [status]=useState('ready');return status==='ready'?<Form/>:<Receipt/>}
    export function Account(){const [account]=useState({mode:'start'});return account.mode==='start'?<Welcome/>:<Profile/>}
    export function Business(){const [enabled]=useState(false);return enabled?<Done/>:<Form/>}`);
  const graph=await scanAppFlow(root,'ios');const plans=graph.presentations!.previews!.filter(p=>p.effect.kind==='state');
  assert.deepEqual(plans.map(p=>p.name).sort(),['Members','Name','People','Title']);
  assert.ok(plans.every(p=>p.owner==='App'||p.owner==='Group'));
});

for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
  test(`temporary query reads reuse only a current settled result (${install===installPresentationRuntime?'normal':'shared loops'})`,async t=>{
    const query:any={queryHash:'record',state:{data:{id:'real-record'}}};
    const observed={data:query.state.data,isPending:false,isFetching:false,isError:false,isPlaceholderData:false,isFetchedAfterMount:true};
    let cold={...observed,isFetchedAfterMount:false};
    let reads=0,temporary=false;
    class QueryObserver {
      getCurrentQuery(){return query}
      getOptimisticResult(_options:any){reads++;return temporary?cold:observed}
    }
    const original=QueryObserver.prototype.getOptimisticResult;
    const app=runtimeFixture(t,false,install,{modules:[[3,{verboseName:'node_modules/@tanstack/query-core/build/modern/queryObserver.js',isInitialized:true,publicModule:{exports:{QueryObserver}}}]]});
    await configure(app);const observer=new QueryObserver(),options={queryHash:'record'};
    app.setCurrent(app.owner);assert.equal(observer.getOptimisticResult(options),observed);app.setCurrent(undefined);
    assert.equal(app.runtime.open('preview').error,undefined);
    temporary=true;app.setCurrent(app.clone);const before=reads;
    assert.equal(observer.getOptimisticResult(options),observed,'Reuse the exact real result, including its actual lifecycle flags');
    assert.equal(reads,before+1,'Only the ordinary library read runs');
    assert.equal(app.runtime.diagnostics().reusedQueryResults,1);
    const unchanged=cold;cold={...cold,data:{id:'changed-data'}};
    assert.equal(observer.getOptimisticResult(options),cold,'Changed data cannot borrow a previous ready result');cold=unchanged;
    assert.equal(observer.getOptimisticResult({...options,select:()=>{throw Error('never select')}}),cold,'Different selection cannot borrow another representation');
    assert.equal(observer.getOptimisticResult({...options,placeholderData:{id:'other'}}),cold,'Different placeholder data keeps its own result');
    assert.equal(observer.getOptimisticResult({...options,enabled:false}),cold,'A different enabled condition keeps its own result');
    query.state={data:query.state.data};
    assert.equal(observer.getOptimisticResult(options),cold,'A changed cache state invalidates the observed result');
    assert.equal(observer.getOptimisticResult({queryHash:'other-record'}),cold,'A changing query key cannot borrow the old observer result');
    app.setCurrent(undefined);await app.runtime.rollback(0,false);app.runtime.cleanup();
    assert.equal(QueryObserver.prototype.getOptimisticResult,original);
    assert.equal(app.runtime.diagnostics().querySnapshots,0);
    assert.equal(app.runtime.diagnostics().reusedQueryResults,0);
  });
}

for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
  test(`query observation stays bounded and detaches through a later wrapper (${install===installPresentationRuntime?'normal':'shared loops'})`,async t=>{
    class QueryObserver {
      query:any;result:any;
      constructor(index:number){this.query={queryHash:String(index),state:{data:{id:index}}};this.result={data:this.query.state.data,isPending:false,isFetching:false,isError:false,isPlaceholderData:false};}
      getCurrentQuery(){return this.query}
      getOptimisticResult(_options:any){return this.result}
    }
    const original=QueryObserver.prototype.getOptimisticResult;
    const app=runtimeFixture(t,false,install,{modules:[[3,{verboseName:'node_modules/@tanstack/query-core/src/queryObserver.ts',isInitialized:true,publicModule:{exports:{QueryObserver}}}]]});
    await configure(app);app.setCurrent(app.owner);
    for(let index=0;index<220;index++){const observer=new QueryObserver(index);observer.getOptimisticResult({queryHash:observer.query.queryHash});}
    assert.equal(app.runtime.diagnostics().querySnapshots,200);
    const wrapped=QueryObserver.prototype.getOptimisticResult;
    const replacement=function(this:QueryObserver,options:any){return wrapped.call(this,options)};
    QueryObserver.prototype.getOptimisticResult=replacement;
    app.runtime.cleanup();assert.equal(QueryObserver.prototype.getOptimisticResult,replacement,'Cleanup preserves a later framework observer');
    const observer=new QueryObserver(999);assert.equal(observer.getOptimisticResult({queryHash:'999'}),observer.result);
    assert.equal(app.runtime.diagnostics().querySnapshots,0,'A forwarded old wrapper cannot collect after cleanup');
    assert.equal(app.runtime.diagnostics().reusedQueryResults,0);
    app.setCurrent(undefined);QueryObserver.prototype.getOptimisticResult=original;
  });
}

for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
  test(`query tracking reads initialized CommonJS framework exports only (${install===installPresentationRuntime?'normal':'shared loops'})`,async t=>{
    let frameworkReads=0,unrelatedReads=0;
    const query={queryHash:'record',state:{data:{id:'observed'}}};
    const result={data:query.state.data,isPending:false,isFetching:false,isError:false,isPlaceholderData:false};
    class QueryObserver {getCurrentQuery(){return query}getOptimisticResult(){return result}}
    const original=QueryObserver.prototype.getOptimisticResult;
    const framework=Object.defineProperty({},'QueryObserver',{get(){frameworkReads++;return QueryObserver}});
    const unrelated=()=>Object.defineProperty({},'QueryObserver',{get(){unrelatedReads++;throw Error('Unrelated export must not execute')}});
    const app=runtimeFixture(t,false,install,{modules:[
      [3,{verboseName:'node_modules/@tanstack/query-core/build/modern/queryObserver.cjs',isInitialized:true,publicModule:{exports:framework}}],
      [4,{verboseName:'src/queryObserver.cjs',isInitialized:true,publicModule:{exports:unrelated()}}],
      [5,{verboseName:'node_modules/@tanstack/query-core/build/modern/queryObserver.js',isInitialized:true,publicModule:{exports:unrelated()}}],
      [6,{verboseName:'node_modules/@tanstack/query-core/build/legacy/queryObserver.cjs',isInitialized:false,publicModule:{exports:unrelated()}}],
    ]});
    await configure(app);assert.equal(frameworkReads,1);assert.equal(unrelatedReads,0);
    assert.equal(app.runtime.diagnostics().queryObservers,1);
    app.setCurrent(app.owner);assert.equal(new QueryObserver().getOptimisticResult(),result);app.setCurrent(undefined);
    // No query hash in these options, so no ready snapshot is claimed.
    assert.equal(app.runtime.diagnostics().querySnapshots,0);
    app.runtime.cleanup();assert.equal(QueryObserver.prototype.getOptimisticResult,original);
    assert.equal(app.runtime.diagnostics().queryObservers,0);
  });
}

for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
  test(`live query caches supply settled results without Metro exports (${install===installPresentationRuntime?'normal':'shared loops'})`,async t=>{
    const data={id:'real'},query:any={queryHash:'record',state:{data},observers:[]};
    const options={queryHash:'record',enabled:false};
    let settled={data,isPending:false,isFetching:false,isError:false,isPlaceholderData:false,isFetchedAfterMount:true};
    let cold={...settled,isFetchedAfterMount:false},cacheReads=0,resultReads=0,appCalls=0;
    class QueryObserver {
      options=options;temporary:boolean;
      constructor(temporary=false){this.temporary=temporary}
      getCurrentQuery(){return query}
      getCurrentResult(){resultReads++;return settled}
      getOptimisticResult(_options?:any){return this.temporary?cold:settled}
    }
    class QueryCache {getAll(){cacheReads++;return [query]}}
    const cache=new QueryCache();
    class QueryClient {getQueryCache(){return cache}}
    const client=new QueryClient(),live=new QueryObserver();query.observers=[live];
    Object.defineProperty(client,'getQueryCache',{get(){appCalls++;throw Error('Instance getter must not execute')}});
    Object.defineProperty(live,'getCurrentResult',{get(){appCalls++;throw Error('Instance getter must not execute')}});
    const original=QueryObserver.prototype.getOptimisticResult;
    const app=runtimeFixture(t,false,install);app.owner.memoizedProps={client};
    await configure(app);
    assert.equal(cacheReads,1);assert.equal(resultReads,1);assert.equal(appCalls,0);
    assert.deepEqual(app.runtime.diagnostics().queryCache,{clients:1,caches:1,observerCandidates:1,clientTypes:['QueryClient'],observerTypes:['QueryObserver']});
    assert.equal(app.runtime.diagnostics().queryObservers,1);assert.equal(app.runtime.diagnostics().querySnapshots,1);
    assert.equal(app.runtime.open('preview').error,undefined);app.setCurrent(app.clone);
    const preview=new QueryObserver(true);assert.equal(preview.getOptimisticResult(),cold,'Missing options cannot reuse another representation');
    assert.equal(preview.getOptimisticResult(options),settled,'Use the actual result loaded before capture started');
    assert.equal(app.runtime.diagnostics().reusedQueryResults,1);
    query.state={data};assert.equal(preview.getOptimisticResult(options),cold,'Changed cache state requires a fresh real observer read');
    app.setCurrent(undefined);await app.runtime.rollback(0,false);
    // A pending live result is not readiness evidence even when it has old data.
    settled={...settled,isFetching:true};await app.runtime.collect([app.site],[app.action]);
    assert.equal(app.runtime.open('preview').error,undefined);app.setCurrent(app.clone);
    assert.equal(preview.getOptimisticResult(options),cold);
    app.setCurrent(undefined);await app.runtime.rollback(0,false);app.runtime.cleanup();
    assert.equal(QueryObserver.prototype.getOptimisticResult,original);assert.equal(app.runtime.diagnostics().querySnapshots,0);
    assert.deepEqual(app.runtime.diagnostics().queryCache,{clients:0,caches:0,observerCandidates:0,clientTypes:[],observerTypes:[]});
  });
  test(`unrelated clients and observer getters stay unread (${install===installPresentationRuntime?'normal':'shared loops'})`,async t=>{
    let calls=0;
    class OtherClient {getQueryCache(){calls++;throw Error('Unrelated client')}}
    const app=runtimeFixture(t,false,install);app.owner.memoizedProps={client:new OtherClient()};
    await configure(app);assert.equal(calls,0);assert.equal(app.runtime.diagnostics().queryObservers,0);
    class QueryClient {getQueryCache(){return new QueryCache()}}
    class QueryCache {getAll(){return [Object.defineProperty({queryHash:'key',state:{}},'observers',{get(){calls++;throw Error('Accessor')}})]}}
    app.owner.memoizedProps={client:new QueryClient()};await app.runtime.collect([app.site],[app.action]);
    assert.equal(calls,0);assert.equal(app.runtime.diagnostics().queryObservers,0);app.runtime.cleanup();
  });
}

for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
  test(`a contained mount can read the exact settled live query without starting its predicted fetch (${install===installPresentationRuntime?'normal':'shared loops'})`,async t=>{
    const data={id:'observed'},query:any={queryHash:'record',state:{data,status:'success',fetchStatus:'idle'},observers:[]};
    const ready={data,status:'success',fetchStatus:'idle',isFetching:false,isRefetching:false,isPending:false,isError:false,isPlaceholderData:false,isStale:true,isFetchedAfterMount:true};
    let cold={...ready,fetchStatus:'fetching',isFetching:true,isRefetching:true,isFetchedAfterMount:false},reads=0;
    const options={queryHash:'record',_optimisticResults:'optimistic',staleTime:0};
    class QueryObserver{
      result=ready;
      getCurrentQuery(){return query}
      getCurrentResult(){return this.result}
      getOptimisticResult(){reads++;return cold}
    }
    const live=new QueryObserver(),preview=new QueryObserver();query.observers=[live];
    class QueryCache{getAll(){return [query]}}
    class QueryClient{getQueryCache(){return new QueryCache()}}
    (live as any).options=options;
    const app=runtimeFixture(t,false,install);
    app.owner.memoizedProps={...app.owner.memoizedProps,client:new QueryClient()};
    await configure(app);assert.equal(app.runtime.diagnostics().querySnapshots,1);
    assert.equal(app.runtime.open('preview').error,undefined);app.setCurrent(app.clone);
    const before=reads;assert.equal(preview.getOptimisticResult(options),ready);assert.equal(reads,before+1);
    assert.equal(app.runtime.diagnostics().reusedQueryResults,1);
    assert.equal(preview.getOptimisticResult({...options,staleTime:Infinity}),cold,'Changed mount rules keep their own result');
    assert.equal(preview.getOptimisticResult({...options,_optimisticResults:undefined}),cold,'Only the library mount prediction can differ');
    query.observers=[];assert.equal(preview.getOptimisticResult(options),cold,'A detached observer is not live evidence');query.observers=[live];
    live.result={...ready,isStale:false};assert.equal(preview.getOptimisticResult(options),cold,'Changed live results cannot supply an older ready object');live.result=ready;
    query.state.fetchStatus='fetching';assert.equal(preview.getOptimisticResult(options),cold,'A real request cannot be hidden');query.state.fetchStatus='idle';
    const mount=cold;cold={...mount,data:{id:'different'}};assert.equal(preview.getOptimisticResult(options),cold,'Different data cannot reuse the app result');
    cold={...mount,status:'error'};assert.equal(preview.getOptimisticResult(options),cold,'Different status cannot reuse the app result');
    cold=mount;assert.equal(preview.getOptimisticResult(options),ready);
    app.setCurrent(undefined);await app.runtime.rollback(0,false);app.runtime.cleanup();
    assert.equal(app.runtime.diagnostics().queryPreviewReads,0);
    assert.deepEqual(app.runtime.diagnostics().queryPreviewRejections,{missing:0,representation:0,fields:0});
  });
}

test('exported guard bodies above a navigator get previews without changing account conditions',async t=>{
  const root=await mkdtemp(join(tmpdir(),'flow-guard-body-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'App.tsx'),`import {createNativeStackNavigator} from '@react-navigation/native-stack';
    const Stack=createNativeStackNavigator();
    export function Routes(){return <Stack.Navigator><Stack.Screen name="Home" component={Home}/></Stack.Navigator>}
    export function App({account}){return account.status==='disabled'?<DisabledPage/>:<Wrapper/>}
    function Wrapper(){return <Routes/>}
    export function DisabledPage(){return <Text>Account disabled</Text>}
    function Home(){return <View/>}`);
  const graph=await scanAppFlow(root,'ios'),plan=graph.presentations!.previews!.find(p=>p.effect.kind==='mount'&&p.owner==='DisabledPage');
  assert.ok(plan,'A source gate above navigation has a real body preview');
  assert.equal(plan.preview,true);assert.equal(plan.effect.kind,'mount');
  assert.ok(plan.views!.some(id=>graph.presentations!.views!.find(v=>v.id===id)?.kind==='branch'));
  assert.ok(!graph.presentations!.previews!.some(p=>p.effect.kind==='state'&&p.file==='App.tsx'),'No account-state mutation becomes a capture plan');
});

test('guard body previews exclude unrelated rows, required props, unexported bodies and progress',async t=>{
  const root=await mkdtemp(join(tmpdir(),'flow-guard-body-limits-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'App.tsx'),`import {createNativeStackNavigator} from '@react-navigation/native-stack';
    const Stack=createNativeStackNavigator();
    function Routes(){return <Stack.Navigator><Stack.Screen name="Home" component={Home}/></Stack.Navigator>}
    export function App({account,pending,error}){return <>
      {account.status==='required'?<RequiredPage record={account}/>:null}
      {account.status==='private'?<PrivatePage/>:null}
      {pending?<ProgressPage/>:null}<Routes/>
    </>}
    export function RequiredPage({record}:{record:object}){return <Text>Required</Text>}
    function PrivatePage(){return <Text>Private</Text>}
    export function ProgressPage(){return <Text>Waiting</Text>}
    export function Row({error}){return error?<RowBadge/>:null}
    export function RowBadge(){return <Text>Badge</Text>}
    function Home(){return <View/>}`);
  const graph=await scanAppFlow(root,'ios');
  assert.ok(!graph.presentations!.previews!.some(p=>['RequiredPage','PrivatePage','ProgressPage','RowBadge'].includes(p.owner)));
});

for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
  test(`fresh selectors reuse only the exact data from a current live observer (${install===installPresentationRuntime?'normal':'shared loops'})`,async t=>{
    const selected={id:'selected'},data={selected},query:any={queryHash:'record',state:{data,status:'success',fetchStatus:'idle'},observers:[]};
    const ready={data:selected,status:'success',fetchStatus:'idle',isFetching:false,isRefetching:false,isPending:false,isError:false,isPlaceholderData:false,isStale:true,isFetchedAfterMount:true};
    let cold={...ready,fetchStatus:'fetching',isFetching:true,isRefetching:true,isFetchedAfterMount:false};
    let selections=0;const select=(value:any)=>{selections++;return value.selected};
    const options={queryHash:'record',select,_optimisticResults:'optimistic',staleTime:0};
    class QueryObserver{options=options;getCurrentQuery(){return query}getCurrentResult(){return ready}getOptimisticResult(opts:any){return {...cold,data:opts.select(data)}}}
    const live=new QueryObserver(),preview=new QueryObserver();query.observers=[live];
    class QueryCache{getAll(){return [query]}}
    class QueryClient{getQueryCache(){return new QueryCache()}}
    const app=runtimeFixture(t,false,install);app.owner.memoizedProps={...app.owner.memoizedProps,client:new QueryClient()};
    await configure(app);assert.equal(app.runtime.open('preview').error,undefined);app.setCurrent(app.clone);
    const newOptions={...options,select:(value:any)=>{selections++;return value.selected}};
    assert.equal(preview.getOptimisticResult(newOptions),ready);assert.equal(selections,1,'Only the ordinary library selection runs');
    assert.equal(app.runtime.diagnostics().reusedQuerySelections,1);
    assert.notEqual(preview.getOptimisticResult({...newOptions,select:()=>({...selected})}),ready,'A new object with similar fields is a different representation');
    assert.notEqual(preview.getOptimisticResult({...newOptions,enabled:false}),ready,'Other options still must match');
    query.observers=[];assert.notEqual(preview.getOptimisticResult(newOptions),ready,'The source observer must still be mounted');query.observers=[live];
    cold={...cold,isStale:false};assert.notEqual(preview.getOptimisticResult(newOptions),ready,'New status fields stay authoritative');
    app.setCurrent(undefined);await app.runtime.rollback(0,false);app.runtime.cleanup();assert.equal(app.runtime.diagnostics().reusedQuerySelections,0);
  });
}

for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
  test(`only source-approved UI opening effects run in a temporary form (${install===installPresentationRuntime?'normal':'shared loops'})`,async t=>{
    const app=runtimeFixture(t,false,install);await configure(app);assert.equal(app.runtime.open('preview').error,undefined);
    let opens=0,closes=0,otherEffects=0,cleans=0;const control={open(){opens++},close(){closes++}};
    const opening=()=>{control.open();return ()=>{cleans++}};
    const register=()=>{app.setCurrent(app.clone);app.react.useEffect(opening,[control]);app.react.useEffect(()=>otherEffects++);app.setCurrent(undefined)};
    register();assert.equal(opens,0);assert.equal(otherEffects,0);
    const bindings=app.runtime.uiEffectBindings(app.clone);assert.equal(bindings.length,1);assert.equal(bindings[0].kind,'ui-effect');
    assert.equal(app.runtime.previewEffects([{binding:bindings[0].id,site:'portal'}],app.clone).effects,0);
    const matches=[{binding:bindings[0].id,site:'ui-effect:0:open'}];
    assert.equal(app.runtime.previewEffects(matches,app.clone).effects,1);assert.equal(opens,1);assert.equal(otherEffects,0);
    assert.equal(app.runtime.uiEffectBindings(app.clone).length,0);
    register();assert.equal(app.runtime.uiEffectBindings(app.clone).length,0,'An unchanged dependency does not repeat the effect');
    assert.equal(app.runtime.diagnostics().openedUiEffects,1);
    await app.runtime.rollback(0,false);assert.equal(cleans,1);assert.equal(closes,1);assert.equal(app.runtime.diagnostics().uiEffectBindings,0);
    app.runtime.cleanup();assert.equal(cleans,1);assert.equal(app.runtime.diagnostics().openedUiEffects,0);
  });

  test(`restoration cancels a delayed UI opening effect (${install===installPresentationRuntime?'normal':'shared loops'})`,async t=>{
    const app=runtimeFixture(t,false,install);await configure(app);app.runtime.open('preview');
    let opens=0;const control={open(){opens++},close(){}};
    app.setCurrent(app.clone);app.react.useEffect(()=>{const timer=setTimeout(()=>control.open(),60);return ()=>clearTimeout(timer)},[control]);app.setCurrent(undefined);
    const binding=app.runtime.uiEffectBindings(app.clone)[0];app.runtime.previewEffects([{binding:binding.id,site:'ui-effect:0:open'}],app.clone);
    await app.runtime.rollback(0,false);await new Promise(resolve=>setTimeout(resolve,80));assert.equal(opens,0);
    app.runtime.cleanup();
  });

  test(`UI opening effects do not read controller accessors (${install===installPresentationRuntime?'normal':'shared loops'})`,async t=>{
    const app=runtimeFixture(t,false,install);await configure(app);app.runtime.open('preview');
    const control={get open(){assert.fail('Never run an app getter')},close(){}};
    app.setCurrent(app.clone);app.react.useEffect(()=>control.open(),[control]);app.setCurrent(undefined);
    assert.deepEqual(app.runtime.uiEffectBindings(app.clone),[]);await app.runtime.rollback(0,false);app.runtime.cleanup();
  });
}
