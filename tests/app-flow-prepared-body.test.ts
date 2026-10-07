import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {build,transform} from 'esbuild';
import {JSDOM} from 'jsdom';
import {installPresentationRuntime} from '../src/server/app-flow/presentations-runtime.js';
import {createFlowRegistry} from '../src/server/app-flow/instrumentation-registry.js';

const require=createRequire(import.meta.url);

test('prepared native body stays hidden through React updates and restores current app styles',async t=>{
  const dom=new JSDOM('<div id="root"></div>');
  const keys=['window','document','IS_REACT_ACT_ENVIRONMENT','__REACT_DEVTOOLS_GLOBAL_HOOK__','__MOBILE_DEV_FLOW_REGISTRY__','__r'];
  const saved=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  dom.window.HTMLElement.prototype.getBoundingClientRect=function(){
    const width=parseFloat(this.style.width)||300,height=parseFloat(this.style.height)||parseFloat(this.style.minHeight)||500;
    return {x:0,y:0,width,height,top:0,left:0,right:width,bottom:height,toJSON(){}};
  };
  const renderers=new Map(),roots=new Set<any>();
  const hook={supportsFiber:true,renderers,inject(renderer:any){renderer.rendererPackageName='react-native-renderer';renderers.set(1,renderer);return 1;},getFiberRoots:()=>roots,onCommitFiberRoot(_id:any,root:any){roots.add(root);},onCommitFiberUnmount(){}};
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__=hook;
  const React=require('react'),{createRoot}=require('react-dom/client');
  const flatten=(value:any)=>Object.assign({},...([value].flat(Infinity).filter(item=>item&&typeof item==='object')));
  const View=({children,style}:any)=>React.createElement('div',{style:flatten(style)},children);
  const ScrollView=({children,style,testID}:any)=>React.createElement('section',{style:flatten(style),'data-body':testID},children);
  let opens=0;
  function Modal({children,visible,onShow,onDismiss}:any){React.useLayoutEffect(()=>{if(visible){opens++;onShow?.();}else onDismiss?.();},[visible]);return visible?React.createElement('aside',null,children):null;}
  const native={View,ScrollView,Modal,Platform:{OS:'ios'},StyleSheet:{create:(value:any)=>value}};
  const bundle=await build({entryPoints:['src/server/app-flow/instrumentation-client.js'],bundle:true,write:false,format:'cjs',platform:'node',external:['react','react-native']});
  const module={exports:{} as any},context=vm.createContext({setTimeout,clearTimeout,console,module,exports:module.exports,require:(name:string)=>name==='react'?React:native});
  vm.runInContext(bundle.outputFiles[0].text,context);const client=module.exports;
  globalThis.__MOBILE_DEV_FLOW_REGISTRY__=client.registry;
  globalThis.__r={getModules:()=>new Map([[1,{isInitialized:true,publicModule:{exports:React}}],[2,{isInitialized:true,publicModule:{exports:native}}]])};
  const source=`import * as React from 'react';import {View,ScrollView} from 'react-native';
export const Data=React.createContext('white');
export let update,mounts=0,formEffects=0;export const updateScreen={};
export function Step({initialStep}){
  const [step]=React.useState(initialStep),color=React.useContext(Data);
  React.useEffect(()=>{formEffects++},[]);
  return <ScrollView testID={step} style={{minHeight:step==='one'?300:150,backgroundColor:color}}><p>{step}</p></ScrollView>;
}
export function Screen({id='live'}){const [color,setColor]=React.useState('white');updateScreen[id]=()=>setColor('blue');return <Data.Provider value={color}><View><Step initialStep="one"/></View></Data.Provider>}
export function App(){
  const [color,setColor]=React.useState('white');update=()=>setColor('blue');
  React.useEffect(()=>{mounts++},[]);
  return <Data.Provider value={color}><View><Screen/></View></Data.Provider>;
}`;
  const plugin=require('../src/server/app-flow/instrumentation-plugin.cjs');
  const prepared=require('@babel/core').transformSync(source,{filename:'/app/screen.jsx',configFile:false,babelrc:false,parserOpts:{plugins:['jsx']},plugins:[[plugin,{enabled:true,projectRoot:'/app',client:'flow-client',manifest:{sourceHash:'hash',files:{}}}]]}).code;
  const compiled=await transform(prepared,{loader:'jsx',format:'cjs'}),appModule={exports:{} as any};
  context.module=appModule;context.exports=appModule.exports;context.require=(name:string)=>name==='react'?React:name==='react-native'?native:client;
  vm.runInContext(compiled.code,context);const app=appModule.exports,reported:any[]=[];
  const root=createRoot(document.querySelector('#root'),{onCaughtError:(error:any)=>reported.push(error)});
  const fibers=(visit:any,subtree?:any)=>{const stack=[subtree??[...roots][0].current];while(stack.length){const fiber=stack.pop();if(fiber!==subtree&&fiber.sibling)stack.push(fiber.sibling);if(visit(fiber)!==false&&fiber.child)stack.push(fiber.child);}};
  const runtime=installPresentationRuntime({hook,fibers,hidden:()=>false,later:setTimeout});
  t.after(async()=>{await React.act(()=>runtime.rollback(0,false));runtime.cleanup();await React.act(()=>root.unmount());Object.assign(globalThis,saved);dom.window.close();});
  await React.act(()=>root.render(React.createElement(app.App)));
  await React.act(()=>runtime.collect([],[],'/app','hash'));
  let screen:any;fibers((fiber:any)=>{if(fiber.type===app.Screen)screen=fiber;});
  await React.act(()=>assert.equal(runtime.project(screen,{props:{id:'preview'},views:['screen']}).error,undefined));
  const original=document.querySelector('aside section') as HTMLElement;
  let step:any;fibers((fiber:any)=>{if(fiber.type===app.Step)step=fiber;});
  await React.act(()=>assert.equal(runtime.project(step,{props:{initialStep:'two'},views:['step']}).error,undefined));
  const focus=()=>{let found:any;fibers((fiber:any)=>{if(fiber.type===app.Step&&fiber.memoizedProps.initialStep==='two')found=fiber;});return found;};
  await React.act(()=>runtime.motion(focus()));
  assert.equal(runtime.motion(focus()).pending,false,'Native geometry must settle once the mask reaches React');
  assert.equal(document.querySelector('aside section'),original,'The sheet keeps the native body it observes');
  assert.equal(original.style.opacity,'0');assert.equal(original.style.position,'absolute');assert.equal(original.style.height,'150px');
  assert.equal((document.querySelector('aside [data-body="two"]') as HTMLElement).style.opacity,'');
  await React.act(()=>{app.update();app.updateScreen.preview();});
  assert.equal(original.style.opacity,'0','An ordinary provider render cannot undo concealment');
  assert.equal(original.style.backgroundColor,'blue','The mask retains new app styles');
  assert.equal(runtime.motion(focus()).pending,false);
  assert.equal(app.mounts,1);assert.equal(app.formEffects,1,'Temporary forms do not run app effects');assert.equal(opens,1);
  await React.act(()=>runtime.rollback(1,false));
  assert.equal(document.querySelector('aside section'),original);
  assert.equal(original.style.opacity,'');assert.equal(original.style.position,'');assert.equal(original.style.height,'');
  assert.equal(original.style.minHeight,'300px');assert.equal(original.style.backgroundColor,'blue');
  assert.equal(document.querySelector('aside [data-body="two"]'),null);
  for(const owner of client.registry.matchingOwners('hash'))assert.equal(client.registry.hostSnapshot(owner.id).masks.size,0);
  assert.deepEqual(reported,[]);
});

test('body masks reject stale ownership and remove only their own current mask',()=>{
  const registry=createFlowRegistry(),owner=registry.create('view#Body','hash');
  registry.commit(owner,new Map([['body',{kind:'host'}]]));
  const binding={owner:owner.id,site:'body',sourceHash:'hash'},first={style:{opacity:0}},next={style:{opacity:0,height:150}};
  const initial=registry.hostSnapshot(owner.id);
  assert.equal(registry.setHostMask({...binding,sourceHash:'old'},undefined,first),false);
  assert.equal(registry.setHostMask(binding,undefined,first),true);assert.notEqual(registry.hostSnapshot(owner.id),initial);
  assert.equal(registry.setHostMask(binding,undefined,next),false,'Another preview cannot take over the body');
  assert.equal(registry.setHostMask(binding,first,next),true);
  registry.removeHostMask(binding,first);assert.equal(registry.hostSnapshot(owner.id).masks.get('body'),next);
  registry.removeHostMask(binding,next);assert.equal(registry.hostSnapshot(owner.id).masks.size,0);
  registry.commit(owner,new Map([['body',{kind:'host',ambiguous:true}]]));assert.equal(registry.setHostMask(binding,undefined,first),false);
  registry.remove(owner);assert.equal(registry.setHostMask(binding,undefined,first),false);
});
