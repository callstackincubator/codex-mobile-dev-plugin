import assert from 'node:assert/strict';
import test from 'node:test';
import {sourceUiPortal} from '../src/server/app-flow/portal-source.ts';
import {bindPresentationSites} from '../src/server/app-flow/presentations-bindings.ts';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const source=`import {createContext,useContext,useId,useEffect,useMemo,useCallback,useRef,useState} from 'react';
function createGroup(){
 const Context=createContext({outlet:null,append(){},remove(){}});
 function Provider({children}){
  const map=useRef({}),[outlet,setOutlet]=useState(null);
  const append=useCallback((id,component)=>{if(map.current[id])return;map.current[id]=<Fragment key={id}>{component}</Fragment>;setOutlet(<>{Object.values(map.current)}</>)},[]);
  const remove=useCallback(id=>{delete map.current[id];setOutlet(<>{Object.values(map.current)}</>)},[]);
  const value=useMemo(()=>({outlet,append,remove}),[outlet,append,remove]);return <Context.Provider value={value}>{children}</Context.Provider>;
 }
 function Portal({children}){
  const {append,remove}=useContext(Context),id=useId();
  useEffect(()=>{append(id,children);return()=>remove(id)},[id,children,append,remove]);
  return null;
 }
 return {Provider,Portal};
}`;
const line=source.slice(0,source.indexOf('  useEffect')).split('\n').length;
test('portal source proves UI state output before previewing suppressed portal children',()=>{
 assert.equal(sourceUiPortal(source,line,2),true);
 for(const changed of [
  source.replace('append(id,children)','append(id,credentials)'),
  source.replace('remove(id)','remove(other)'),
  source.replace('return null;','return allowed?null:<Content/>;'),
  source.replace('append(id,children);return','submit();append(id,children);return'),
  source.replace('map.current[id]=<Fragment key={id}>{component}</Fragment>','upload(component)'),
  source.replace('setOutlet(<>{Object.values(map.current)}</>)','sendToServer(map.current)'),
 ])assert.equal(sourceUiPortal(changed,line,2),false);
 assert.equal(sourceUiPortal(source,9999),false);assert.equal(sourceUiPortal(source,line,99999),false);
});

test('portal bindings can verify library source but cannot read source outside the project',async t=>{
 const root=await mkdtemp(join(tmpdir(),'flow-portals-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=join(root,'node_modules','ui-portal','index.tsx');await mkdir(join(file,'..'),{recursive:true});await writeFile(file,source);
 const binding:any={id:'portal-1',owner:'Portal',kind:'portal',source:{file,line,column:2}};
 assert.deepEqual(await bindPresentationSites('http://127.0.0.1:8082',root,[binding],[]),[{binding:'portal-1',site:'portal'}]);
 assert.deepEqual(await bindPresentationSites('http://127.0.0.1:8082',root,[{...binding,source:{file:'/private/tmp/unrelated-ui.tsx',line,column:2}}],[]),[]);
 assert.deepEqual(await bindPresentationSites('http://127.0.0.1:8082',root,[{...binding,kind:'entry'}],[],[{id:'unknown',file:'node_modules/ui-portal/index.tsx',line}as any]),[]);
});


import * as React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {JSDOM} from 'jsdom';
import {installPresentationRuntime} from '../src/server/app-flow/presentations-runtime.js';
import {sharedLoopRuntime} from './app-flow-runtime-fixtures.ts';

for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
 test(`temporary portal children keep context, suppress effects and restore cleanly (${install===installPresentationRuntime?'normal':'shared loops'})`,async()=>{
  const react=(React as any).default??React,dom=new JSDOM('<div id="root"></div>');
  const previous={window:(globalThis as any).window,document:(globalThis as any).document,require:(globalThis as any).__r};
  (globalThis as any).window=dom.window;(globalThis as any).document=dom.window.document;
  const originalEffect=react.useEffect,Context=react.createContext(undefined),value={label:'Real nested context'};
  let current:any,setShown:any,setLabel:any,mounts=0,appEffects=0,previewEffects=0,attaches=0,removes=0;
  const rendered=createRoot(dom.window.document.getElementById('root')!);
  const root:any={tag:3,stateNode:(rendered as any)._internalRoot};
  const host:any={tag:5,type:View,memoizedProps:{children:react.createElement(Original)},return:root};root.child=host;
  const form:any={type:HiddenForm,elementType:HiddenForm,return:host};
  const provider:any={tag:10,type:Context.Provider,memoizedProps:{value},return:form};
  const portal:any={type:Portal,elementType:Portal,return:provider};
  const body:any={type:SheetBody,elementType:SheetBody,return:host};
  function View({children}:any){return react.createElement('div',null,children)}
  function Modal({children,onShow}:any){onShow();return children}
  function Original(){current=undefined;react.useEffect(()=>{appEffects++},[]);return 'Original app'}
  function HiddenForm(props:any){
   current=form;form.memoizedProps=form.pendingProps=props;host.child=form;form.sibling=undefined;
   const [shown,updateShown]=react.useState(()=>{mounts++;return true});setShown=updateShown;const [label,updateLabel]=react.useState('');setLabel=updateLabel;const child=react.useMemo(()=>react.createElement(SheetBody,{label}),[label]);form.child=provider;provider.child=shown?portal:undefined;
   current=undefined;return react.createElement(Context.Provider,{value},shown?react.createElement(Portal,null,child):null);
  }
  function Portal(props:any){
   current=portal;portal.memoizedProps=portal.pendingProps=props;portal.child=undefined;
   react.useEffect(()=>{attaches++;return()=>{removes++}},[props.children]);
   current=undefined;return null;
  }
  function SheetBody(props:any){
   current=body;body.memoizedProps=body.pendingProps=props;form.sibling=body;
   const context=react.useContext(Context);react.useEffect(()=>{previewEffects++},[]);react.useLayoutEffect(()=>{previewEffects++},[]);
   current=undefined;return react.createElement('span',null,context.label+props.label);
  }
  const hook:any={renderers:new Map(),onCommitFiberRoot(){}};
  const render=()=>{flushSync(()=>rendered.render(react.createElement(View,host.memoizedProps)));hook.onCommitFiberRoot()};
  hook.renderers.set(1,{rendererPackageName:'react-native-renderer',getCurrentFiber:()=>current,overrideProps(fiber:any,_path:any,props:any){fiber.memoizedProps=props;if(props.children?.type!==react.Fragment)host.child=undefined;render()}});
  (globalThis as any).__r={getModules:()=>new Map([[1,{isInitialized:true,publicModule:{exports:react}}],[2,{isInitialized:true,publicModule:{exports:{View,Modal,Platform:{OS:'android'},StyleSheet:{create(){}}}}}],[3,{verboseName:'Forms.tsx',isInitialized:true,publicModule:{exports:{HiddenForm}}}]])};
  const fibers=(visit:any,subtree?:any)=>{const stack=[subtree??root];while(stack.length){const fiber=stack.pop();if(fiber!==subtree&&fiber.sibling)stack.push(fiber.sibling);if(visit(fiber)!==false&&fiber.child)stack.push(fiber.child)}};
  const runtime=install({hook,fibers,hidden:()=>false,later:setTimeout});
  const action:any={id:'mount',file:'Forms.tsx',line:1,owner:'HiddenForm',component:'HiddenForm',name:'HiddenForm',prop:'',preview:true,views:['form'],effect:{kind:'mount',file:'Forms.tsx',export:'HiddenForm'}};
  try{
   render();runtime.configure({states:[],actions:[action]},[]);assert.equal(runtime.open('mount').error,undefined);runtime.focused(form);
   const candidates=runtime.portalBindings(form);assert.equal(candidates.length,1);assert.equal(candidates[0].approved,false);
   assert.equal(dom.window.document.getElementById('root')!.textContent,'Original app');assert.equal(attaches,0);
   assert.deepEqual(runtime.previewPortals([candidates[0].id],form),{portals:1});
   assert.equal(dom.window.document.getElementById('root')!.textContent,'Original appReal nested context',JSON.stringify(runtime.diagnostics()));
   assert.equal(runtime.portalBindings(form).length,0,'An already rendered portal cannot duplicate its body');
   assert.equal(runtime.diagnostics().portalPreviews,1);assert.equal(mounts,1,'Portal attachment keeps the original temporary form mounted');assert.equal(previewEffects,0);assert.equal(appEffects,1);
   assert.equal(provider.memoizedProps.value,value);assert.equal(attaches,0);assert.equal(removes,0);
   flushSync(()=>setLabel(' updated'));hook.onCommitFiberRoot();
   assert.equal(dom.window.document.getElementById('root')!.textContent,'Original appReal nested context updated');
   assert.equal(mounts,1);assert.equal(previewEffects,0);assert.equal(attaches,0);
   flushSync(()=>setShown(false));hook.onCommitFiberRoot();assert.equal(dom.window.document.getElementById('root')!.textContent,'Original app');
   assert.equal(runtime.diagnostics().portalPreviews,0);assert.equal(runtime.diagnostics().portalBindings,0);
   await runtime.rollback(0,false);assert.equal(runtime.checkpoint(),0);assert.equal(runtime.diagnostics().projections,0);
   assert.equal(react.useEffect,originalEffect);
  }finally{runtime.cleanup();flushSync(()=>rendered.unmount());await new Promise(resolve=>setTimeout(resolve,20));dom.window.close();(globalThis as any).window=previous.window;(globalThis as any).document=previous.document;(globalThis as any).__r=previous.require;}
 });
}


import {WebSocketServer} from 'ws';
import {once} from 'node:events';
import vm from 'node:vm';
import {FlowConnection} from '../src/server/app-flow/connection.ts';
import {FlowRuntimeFailure,FlowRuntimeMetrics} from '../src/server/app-flow/runtime-metrics.ts';

test('connection verifies portal source, renders nested portals once and keeps fixed timing operations',async t=>{
 const root=await mkdtemp(join(tmpdir(),'flow-portal-connection-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=join(root,'portal.tsx');await writeFile(file,source);
 const server=new WebSocketServer({port:0,host:'127.0.0.1'});await once(server,'listening');
 t.after(()=>new Promise<void>(resolve=>{for(const client of server.clients)client.terminate();server.close(()=>resolve())}));
 const commands:any[]=[];let rejected=false,unsafe=false;
 server.on('connection',socket=>{
  let binding='';socket.on('message',bytes=>{
   const message=JSON.parse(bytes.toString());if(message.method==='Runtime.addBinding')binding=message.params.name;
   if(message.id>0){socket.send(JSON.stringify({id:message.id,result:{}}));return;}
   vm.runInNewContext(message.params.expression,{
    [message.params.objectGroup]:{invoke(command:any,reply:any){
     commands.push(JSON.parse(JSON.stringify(command)));
     const candidate=(id:string)=>({id,owner:'Portal',kind:'portal',source:{file:unsafe?'/private/tmp/unrelated.tsx':file,line,column:2}});
     reply(command.type==='presentation-collect'?{bindings:[]}:
      command.type==='presentation-open'?{portalBindings:[candidate('first')]}:
      command.type==='presentation-portals'?(rejected?{error:'private application details'}:{ready:true,portalBindings:command.ids[0]==='first'?[candidate('nested')]:[candidate('nested')]}):{});
    }},
    [binding]:(payload:string)=>socket.send(JSON.stringify({method:'Runtime.bindingCalled',params:{name:binding,payload}})),
   });
  });
 });
 const address=server.address()as {port:number},metrics=new FlowRuntimeMetrics('ios'),connection=new FlowConnection(`ws://127.0.0.1:${address.port}`,'fixture','ios',metrics);
 t.after(()=>connection.close({restore:false}));
 await connection.invoke({type:'presentation-setup',projectRoot:root,catalog:{states:[],actions:[]}});
 assert.equal((await connection.invoke({type:'presentation-open',id:'entry'})).ready,true);
 assert.deepEqual(commands.filter(command=>command.type==='presentation-portals').map(command=>command.ids),[['first'],['nested']]);
 assert.equal(metrics.snapshot().find(operation=>operation.operation==='presentation-portals')?.count,2);
 rejected=true;await assert.rejects(connection.invoke({type:'presentation-open',id:'entry'}),error=>error instanceof FlowRuntimeFailure&&error.operation==='presentation-portals'&&!error.message.includes('private'));
 rejected=false;unsafe=true;const before=commands.length;await connection.invoke({type:'presentation-open',id:'entry'});
 assert.deepEqual(commands.slice(before).map(command=>command.type),['presentation-open'],'Unknown source never mounts portal children');
});
