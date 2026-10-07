import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {build,transform} from 'esbuild';
import {JSDOM} from 'jsdom';
import {installPresentationRuntime} from '../src/server/app-flow/presentations-runtime.js';
import {createFlowRegistry} from '../src/server/app-flow/instrumentation-registry.js';

const require=createRequire(import.meta.url);

test('prepared slot survives provider updates, restores nested previews, and preserves current app children',async t=>{
  const dom=new JSDOM('<div id="root"></div>');
  const keys=['window','document','IS_REACT_ACT_ENVIRONMENT','__REACT_DEVTOOLS_GLOBAL_HOOK__','__MOBILE_DEV_FLOW_REGISTRY__','__r'];
  const saved=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({x:0,y:0,width:300,height:500,top:0,left:0,right:300,bottom:500,toJSON(){}});
  const renderers=new Map(),roots=new Set<any>();
  // Use React's real DevTools implementation. A mock that just mutates Fiber
  // props cannot reproduce an ordinary provider render dropping the override.
  const hook={supportsFiber:true,renderers,inject(renderer:any){renderer.rendererPackageName='react-native-renderer';renderers.set(1,renderer);return 1;},getFiberRoots:()=>roots,onCommitFiberRoot(_id:any,root:any){roots.add(root);},onCommitFiberUnmount(){}};
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__=hook;
  const React=require('react'),{createRoot}=require('react-dom/client');
  let opens=0,closes=0;
  const View=({children,style}:any)=>React.createElement('div',{style},children);
  function Modal({children,visible,onShow,onDismiss}:any){
    React.useLayoutEffect(()=>{if(visible){opens++;onShow?.();}else{closes++;onDismiss?.();}},[visible]);
    return visible?React.createElement('aside',null,children):null;
  }
  const native={View,Modal,Platform:{OS:'ios'},StyleSheet:{create:(value:any)=>value}};
  const bundle=await build({entryPoints:['src/server/app-flow/instrumentation-client.js'],bundle:true,write:false,format:'cjs',platform:'node',external:['react','react-native']});
  const module={exports:{} as any},context=vm.createContext({setTimeout,clearTimeout,console,module,exports:module.exports,require:(name:string)=>name==='react'?React:native});
  vm.runInContext(bundle.outputFiles[0].text,context);const client=module.exports;
  globalThis.__MOBILE_DEV_FLOW_REGISTRY__=client.registry;
  globalThis.__r={getModules:()=>new Map([[1,{isInitialized:true,publicModule:{exports:React}}],[2,{isInitialized:true,publicModule:{exports:native}}]])};
  const source=`import * as React from 'react';
import {View} from 'react-native';
export const Data=React.createContext(null);
export let update,changeField,mounts=0,formEffects=0;
export function Portal({children}){React.useLayoutEffect(()=>{},[]);return null;}
export function Form(){
  const [field,setField]=React.useState('real data');
  changeField=setField;
  const data=React.useContext(Data);
  React.useEffect(()=>{formEffects++},[]);
  return <><p>{field}</p><Portal><p>nested dialog</p></Portal></>;
}
export function Login({initialStep}){
  const [step]=React.useState(initialStep);
  return <View>{step==='form'?<Form/>:<p>{step}</p>}</View>;
}
export function App(){
  const [revision,setRevision]=React.useState(0);
  update=()=>setRevision(value=>value+1);
  React.useEffect(()=>{mounts++},[]);
  return <Data.Provider value={{revision,update}}><View><Login initialStep="choose"/>{revision>0&&<p>new app child {revision}</p>}</View></Data.Provider>;
}`;
  const plugin=require('../src/server/app-flow/instrumentation-plugin.cjs');
  const prepared=require('@babel/core').transformSync(source,{filename:'/app/screen.jsx',configFile:false,babelrc:false,parserOpts:{plugins:['jsx']},plugins:[[plugin,{enabled:true,projectRoot:'/app',client:'flow-client',manifest:{sourceHash:'hash',files:{}}}]]}).code;
  const compiled=await transform(prepared,{loader:'jsx',format:'cjs'});
  const appModule={exports:{} as any};context.module=appModule;context.exports=appModule.exports;context.require=(name:string)=>name==='react'?React:name==='react-native'?native:client;
  vm.runInContext(compiled.code,context);const app=appModule.exports;
  const reported:any[]=[];
  const root=createRoot(document.querySelector('#root'),{onCaughtError:(error:any)=>reported.push(error)});
  const fibers=(visit:any,subtree?:any)=>{const stack=[subtree??[...roots][0].current];while(stack.length){const fiber=stack.pop();if(fiber!==subtree&&fiber.sibling)stack.push(fiber.sibling);if(visit(fiber)!==false&&fiber.child)stack.push(fiber.child);}};
  const runtime=installPresentationRuntime({hook,fibers,hidden:()=>false,later:setTimeout});
  t.after(async()=>{await React.act(()=>runtime.rollback(0,false));runtime.cleanup();await React.act(()=>root.unmount());Object.assign(globalThis,saved);dom.window.close();});
  await React.act(()=>root.render(React.createElement(app.App)));
  await React.act(()=>runtime.collect([],[],'/app','hash'));
  let login:any;fibers((fiber:any)=>{if(fiber.type===app.Login)login=fiber;});
  await React.act(()=>assert.equal(runtime.project(login,{props:{initialStep:'form'}}).error,undefined));
  const owner=client.registry.matchingOwners('hash').find((owner:any)=>owner.source.endsWith('#App'));
  assert.equal(client.registry.slotSnapshot(owner.id).size,1,'The shared executor uses the prepared host slot');
  assert.equal(runtime.diagnostics().detachedProjections,0);
  assert.match(document.body.textContent!,/real data/);
  let copy:any;fibers((fiber:any)=>{if(fiber.type===app.Login&&fiber.memoizedProps.initialStep==='form')copy=fiber;});
  await React.act(()=>{app.changeField('edited local field');app.update();});
  assert.match(document.body.textContent!,/edited local field/);
  assert.match(document.body.textContent!,/new app child 1/);
  assert.equal(runtime.diagnostics().detachedProjections,0);
  assert.equal(app.mounts,1,'Slot insertion must not remount the app');
  const portals=runtime.portalBindings(copy);
  assert.equal(portals.length,1);
  await React.act(()=>assert.equal(runtime.previewPortals(portals.map(portal=>portal.id),copy).portals,1));
  assert.match(document.body.textContent!,/edited local field/,'Adding portal content must retain the copied form state and preview provider');
  assert.match(document.body.textContent!,/nested dialog/);
  assert.equal(app.formEffects,0,'Portal updates must preserve app effect containment');
  await React.act(()=>app.update());
  assert.match(document.body.textContent!,/edited local field/);
  assert.match(document.body.textContent!,/nested dialog/,'An app update must retain the updated slot, including its portal');
  await React.act(()=>assert.equal(runtime.project(copy,{props:{initialStep:'nested'}}).error,undefined));
  assert.match(document.body.textContent!,/nested/);
  assert.doesNotMatch(document.body.textContent!,/edited local field/);
  assert.equal(opens,1,'Nested steps share the shown native presentation');
  await React.act(()=>runtime.rollback(1,false));
  assert.match(document.body.textContent!,/real data/);
  assert.equal(client.registry.slotSnapshot(owner.id).size,1,'Releasing the child must retain the restored parent slot');
  // Let the mocked native dismissal commit while the real executor awaits it.
  let closing:Promise<any>;
  await React.act(()=>{closing=runtime.rollback();});
  await React.act(()=>closing!);
  assert.equal(closes,1);
  assert.equal(document.body.textContent,'choosenew app child 2');
  assert.equal(client.registry.slotSnapshot(owner.id).size,0);
  assert.deepEqual(reported,[]);
  assert.equal(runtime.diagnostics().projections,0);
});

test('prepared slots reject stale or ambiguous hosts and clean up only the owned element',()=>{
  const registry=createFlowRegistry(),owner=registry.create('screen#Screen','hash');
  registry.commit(owner,new Map([['view',{kind:'host'}]]));
  const binding={owner:owner.id,site:'view',sourceHash:'hash'},first={},next={};let changes=0,unrelated=0;
  const unsubscribe=registry.subscribeSlots(owner.id,()=>changes++),other=registry.subscribeSlots('other',()=>unrelated++);
  assert.equal(registry.setHostSlot({...binding,sourceHash:'stale'},'preview',first),false);
  assert.equal(registry.setHostSlot(binding,'preview',first),true);
  assert.equal(registry.setHostSlot(binding,'preview',next),true);
  registry.removeHostSlot(binding,'preview',first);
  assert.equal(registry.slotSnapshot(owner.id).get('view').get('preview'),next);
  registry.removeHostSlot(binding,'preview',next);
  assert.equal(registry.slotSnapshot(owner.id).size,0);
  assert.equal(changes,3);assert.equal(unrelated,0);
  registry.commit(owner,new Map([['view',{kind:'host',ambiguous:true}]]));
  assert.equal(registry.setHostSlot(binding,'preview',first),false);
  registry.remove(owner);assert.equal(registry.setHostSlot(binding,'preview',first),false);
  unsubscribe();other();
});
