import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {scanAppFlow} from '../src/server/app-flow/scan.ts';
import {instrumentationManifest} from '../src/server/app-flow/capture-manifest.ts';
import {installPresentationRuntime} from '../src/server/app-flow/presentations-runtime.js';

const require=createRequire(import.meta.url),{transformSync}=require('@babel/core');
const plugin=require('../src/server/app-flow/instrumentation-plugin.cjs');

test('shared form branches restore exact owners before opening another branch',async t=>{
  const {JSDOM}=await import('jsdom'),{build,transform}=await import('esbuild');
  const rootPath=await mkdtemp(join(tmpdir(),'flow-branch-render-'));t.after(()=>rm(rootPath,{recursive:true,force:true}));
  const source=`import * as React from 'react';import {View} from 'react-native';
export function Root(){return <View route={{name:'Home'}} navigation={{isFocused:()=>true}}><App/></View>}
export function Main(){return <p>Original application</p>}
export function Welcome(){return <p>Welcome</p>}
export function Credentials(){return <p>Credentials</p>}
export function Recovery(){return <p>Recovery</p>}
export function Account(){return <p>Account</p>}
export function Username(){return <p>Username</p>}
export function Login(){const [screen]=React.useState('credentials');return <View>{screen==='credentials'?<Credentials/>:screen==='recovery'?<Recovery/>:null}</View>}
export function Signup(){const [state]=React.useReducer(s=>s,{step:'account'});return <View>{state.step==='account'?<Account/>:state.step==='username'?<Username/>:null}</View>}
export function Landing(){const [screen]=React.useState('welcome');return <View>{screen==='welcome'?<Welcome/>:screen==='login'?<Login/>:screen==='signup'?<Signup/>:null}</View>}
export function App(){React.useEffect(()=>{globalThis.liveEffects=(globalThis.liveEffects||0)+1},[]);return <View><Main/></View>}`;
  await writeFile(join(rootPath,'App.tsx'),source);
  const graph=await scanAppFlow(rootPath,'ios'),manifest=await instrumentationManifest(rootPath,graph),catalog=graph.presentations!;
  const states=[...(catalog.states??[]),...(catalog.previewStates??[])],actions=[...catalog.actions,...catalog.previews!];
  const action=(name:string)=>{const matches=actions.filter(a=>a.preview&&(name==='Landing'?a.effect.kind==='mount':a.effect.kind==='state')&&a.name===name);assert.equal(matches.length,1,name);return matches[0]};
  const dom=new JSDOM('<div id="root"></div>'),keys=['window','document','IS_REACT_ACT_ENVIRONMENT','__REACT_DEVTOOLS_GLOBAL_HOOK__','__MOBILE_DEV_FLOW_REGISTRY__','__r'];
  const saved=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({x:0,y:0,width:300,height:500,top:0,left:0,right:300,bottom:500,toJSON(){}});
  const renderers=new Map(),roots=new Set<any>();
  const hook={supportsFiber:true,renderers,inject(renderer:any){renderer.rendererPackageName='react-native-renderer';renderers.set(1,renderer);return 1},getFiberRoots:()=>roots,onCommitFiberRoot(_id:any,root:any){roots.add(root)},onCommitFiberUnmount(){}};
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__=hook;
  const React=require('react'),{createRoot}=require('react-dom/client');
  const View=({children,style}:any)=>React.createElement('div',{style:Object.assign({},...[style].flat(Infinity).filter(Boolean))},children);
  function Modal({children,visible,onShow,onDismiss}:any){React.useLayoutEffect(()=>{if(visible)onShow?.();else onDismiss?.()},[visible]);return visible?React.createElement('aside',null,children):null}
  const native={View,Modal,Platform:{OS:'ios'},StyleSheet:{create:(value:any)=>value}};
  const bundle=await build({entryPoints:['src/server/app-flow/instrumentation-client.js'],bundle:true,write:false,format:'cjs',platform:'node',external:['react','react-native']});
  const clientModule={exports:{} as any},context=vm.createContext({setTimeout,clearTimeout,console,module:clientModule,exports:clientModule.exports,require:(name:string)=>name==='react'?React:native});
  vm.runInContext(bundle.outputFiles[0].text,context);const client=clientModule.exports;
  globalThis.__MOBILE_DEV_FLOW_REGISTRY__=client.registry;
  globalThis.__r={getModules:()=>new Map([[1,{isInitialized:true,publicModule:{exports:React}}],[2,{isInitialized:true,publicModule:{exports:native}}],[3,{isInitialized:true,verboseName:join(rootPath,'App.tsx'),publicModule:{exports:{...appModule.exports}}}]])};
  const prepared=transformSync(source,{filename:join(rootPath,'App.tsx'),configFile:false,babelrc:false,parserOpts:{plugins:['jsx']},plugins:[[plugin,{enabled:true,projectRoot:rootPath,client:'flow-client',manifest}]]}).code;
  const compiled=await transform(prepared,{loader:'jsx',format:'cjs'}),appModule={exports:{} as any};
  context.module=appModule;context.exports=appModule.exports;context.require=(name:string)=>name==='react'?React:name==='react-native'?native:client;
  vm.runInContext(compiled.code,context);const errors:any[]=[];
  const root=createRoot(document.querySelector('#root'),{onCaughtError:(error:any)=>errors.push(error)});
  const fibers=(visit:any,subtree?:any)=>{const stack=[subtree??[...roots][0].current];while(stack.length){const fiber=stack.pop();if(fiber!==subtree&&fiber.sibling)stack.push(fiber.sibling);if(visit(fiber)!==false&&fiber.child)stack.push(fiber.child)}};
  const runtime=installPresentationRuntime({hook,fibers,hidden:()=>false,later:setTimeout});
  t.after(async()=>{await React.act(()=>runtime.rollback(0,false));runtime.cleanup();await React.act(()=>root.unmount());Object.assign(globalThis,saved);dom.window.close()});
  await React.act(()=>root.render(React.createElement(appModule.exports.Root)));
  const effects=context.liveEffects;
  let focus:any,expected:any;const frames:any[]=[];
  async function open(name:string){
    if(!frames.length)await React.act(()=>runtime.collect(states,actions,rootPath,graph.sourceHash));
    const item=action(name),prepared=runtime.prepareCapture(item.id,focus);
    if(name==='Username'){
      assert.equal(prepared.available,false,'Reducer previews keep the host source refresh fallback');
      await React.act(()=>runtime.collect(states,actions,rootPath,graph.sourceHash,item.id));
      assert.equal(runtime.prepare(item.id,focus).available,true);
    }else assert.equal(prepared.available,true,`${name}: ${prepared.error}`);
    const before=runtime.checkpoint();let result:any;
    await React.act(()=>{result=runtime.open(item.id,focus)});
    assert.equal(result.error,undefined,name);
    for(let level=before;level<runtime.checkpoint();level++)frames.push({focus,expected});
    focus=result.focus??runtime.focusFor(result.name,result.scope);expected=result.expected;
    runtime.focused(focus);const probe=runtime.probeFocus(focus,expected);focus=probe.focus;
    assert.equal(probe.expectedReady,true,`${name}: ${document.body.textContent} ${JSON.stringify(runtime.diagnostics().projectionSlots)}`);
    assert.match(document.querySelector('aside')?.textContent??'',new RegExp(name==='Landing'?'Welcome':name==='Login'?'Credentials':name==='Signup'?'Account':name));
    return runtime.checkpoint();
  }
  async function restore(level:number){await React.act(()=>runtime.rollback(level,false));while(frames.length>level){const previous=frames.pop();focus=previous.focus;expected=previous.expected}}
  const landing=await open('Landing');
  await open('Login');await open('Recovery');
  await restore(landing);
  await open('Signup');await open('Username');
  await restore(landing);
  await open('Login');await open('Credentials');
  const retired=focus,retiredExpected=expected;
  await restore(0);
  assert.equal(runtime.probeFocus(retired,retiredExpected).expectedReady,false,'A released projection cannot use another mounted body');
  assert.equal(document.querySelector('aside'),null);assert.equal(document.querySelector('#root')?.textContent,'Original application');
  assert.equal(context.liveEffects,effects,'Restoration never remounts the live application');
  assert.equal(client.registry.matchingOwners(graph.sourceHash).filter((owner:any)=>owner.preview).length,0);
  assert.deepEqual(errors,[]);
});
