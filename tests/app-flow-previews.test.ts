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

async function configure(app:ReturnType<typeof runtimeFixture>){
  const page=await app.runtime.collect([app.site],[app.action]);
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
  for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
    function Welcome(){}function OtherWelcome(){}
    const exports:any={Welcome,OtherWelcome};Object.defineProperty(exports,'Getter',{get(){assert.fail('Never invoke an export getter')}});
    const modules=[[3,{verboseName:'Forms.tsx',isInitialized:true,publicModule:{exports}}],
      [4,{verboseName:'Never.tsx',isInitialized:false,get publicModule(){assert.fail('Never initialize a module')}}]];
    const app=runtimeFixture(t,false,install,{modules,bootstrap:Welcome});
    const mount=(id:string,owner:string,file='Forms.tsx',exported=owner):any=>({id,file,line:1,owner,component:owner,name:owner,prop:'',preview:true,views:[`${id}-body`],effect:{kind:'mount',file,export:exported}});
    const actions=[mount('welcome','Welcome'),mount('other','OtherWelcome'),mount('wrong','Welcome','Other.tsx'),mount('getter','Getter'),mount('never','Welcome','Never.tsx')];
    app.runtime.configure({states:[],actions},[]);
    assert.deepEqual(app.runtime.list().map(a=>a.id),['welcome','other']);
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
