import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {scanAppFlow} from '../src/server/app-flow/scan.ts';
import {instrumentationManifest} from '../src/server/app-flow/capture-manifest.ts';
import {selectPreviewState} from '../src/server/app-flow/state-selections.js';

const require=createRequire(import.meta.url),{transformSync}=require('@babel/core');
const plugin=require('../src/server/app-flow/instrumentation-plugin.cjs');
const source=`import {useReducer} from 'react';import {reducer} from './reducer';
export function Form({options}){
  const [model,send]=useReducer(reducer,{step:1});
  return <>{options.map(option=><Choice item={option} onSelect={()=>send({type:'choose',item:option,fallback:unavailable()})}/>)}
    {model.step===2&&<Details item={model.chosen}/>}
    <Choice onSelect={()=>{writeAccount();send({type:'choose',item:options[0]})}}/>
    <Choice onSelect={()=>send({type:'save'})}/><Choice onSelect={()=>send({type:'account'})}/>
    {options.map(send=><Choice item={send} onSelect={()=>send({type:'choose'})}/>)}
  </>;
}
function Choice(){return <View/>}function Details(){return <View/>}`;
const reducer=`export function reducer(state,action){switch(action.type){
  case 'choose':return {...state,chosen:action.item,step:action.item.kind==='other'?3:2,extra:action.item.kind==='other'?action.fallback:undefined};
  case 'save':writeAccount();return {...state,step:2};
  case 'account':return {...state,authenticated:true,step:2};
}}`;
async function fixture(t:test.TestContext){
  const root=await mkdtemp(join(tmpdir(),'flow-state-choice-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'App.tsx'),source);await writeFile(join(root,'reducer.ts'),reducer);
  return {root,graph:await scanAppFlow(root,'ios')};
}

test('source choices bind a local dispatch to real JSX props and a data-only reducer patch',async t=>{
  const {graph}=await fixture(t),site=graph.presentations!.viewStates!.find(site=>site.owner==='Form')!;
  assert.equal(site.selections?.length,1,'Extra handler calls and shadowed dispatchers are excluded');
  const selection=site.selections![0],item={kind:'known',id:'real-observed-id'};
  const before=Object.freeze({step:1,chosen:undefined,unchanged:'kept'});
  const selected=selectPreviewState([selection],before,{path:['step'],value:2},[{id:selection.id,props:{item}}]);
  assert.equal(selected?.value.chosen,item);assert.equal(selected.value.step,2);assert.equal(selected.value.unchanged,'kept');
  assert.equal(selected.value.extra,undefined);assert.equal(before.step,1);assert.equal(before.chosen,undefined);
  assert.equal(selectPreviewState([selection],before,{path:['step'],value:3},[{id:selection.id,props:{item:{kind:'other'}}}]),undefined,'An unknown prerequisite cannot be invented');
});

test('choice projection refuses missing props and getters without executing them',async t=>{
  const {graph}=await fixture(t),selection=graph.presentations!.viewStates!.find(site=>site.owner==='Form')!.selections![0];
  const props={get item(){assert.fail('Getter executed')}};
  assert.equal(selectPreviewState([selection],{step:1},{path:['step'],value:2},[{id:selection.id,props}]),undefined);
  assert.equal(selectPreviewState([selection],{step:1},{path:['step'],value:2},[]),undefined);
  const item={get kind(){assert.fail('Nested getter executed')}};
  assert.equal(selectPreviewState([selection],{step:1},{path:['step'],value:2},[{id:selection.id,props:{item}}]),undefined);
});

test('source markers inside rows reuse the form owner without inserting callback hooks',async t=>{
  const {graph,root}=await fixture(t),manifest=await instrumentationManifest(root,graph);
  const unit=manifest.files['App.tsx'],selection=graph.presentations!.viewStates!.find(site=>site.owner==='Form')!.selections![0];
  assert.ok(unit.controls.some(entry=>entry.source.line===selection.source.line&&entry.source.column===selection.source.column&&entry.outerOwner));
  const output=transformSync(source,{filename:join(root,'App.tsx'),configFile:false,babelrc:false,parserOpts:{plugins:['jsx']},plugins:[[plugin,{enabled:true,projectRoot:root,client:'flow-client',manifest}]]}).code;
  assert.equal((output.match(/useFlowOwner\(/g)??[]).length,1);
  assert.match(output,/\.map\(option => _flow.entry\(_flowOwner,/);
  assert.match(output,/onSelect=\{\(\) => send\(/);
});

test('shared preview opens a real chosen form step and leaves the live reducer untouched',async t=>{
  const {JSDOM}=await import('jsdom'),{build,transform}=await import('esbuild'),vm=await import('node:vm');
  const {installPresentationRuntime}=await import('../src/server/app-flow/presentations-runtime.js');
  const rootPath=await mkdtemp(join(tmpdir(),'flow-choice-render-'));t.after(()=>rm(rootPath,{recursive:true,force:true}));
  const appSource=`import * as React from 'react';import {View} from 'react-native';import {reducer} from './reducer';
export function Choice({item,onSelect}){return <button onClick={onSelect}>{item.id}</button>}
export function Details({item}){return <p>{item?.id||'missing data'}</p>}
export function Form({options}){const [model,send]=React.useReducer(reducer,{step:1});
  React.useEffect(()=>{globalThis.formEffects=(globalThis.formEffects||0)+1},[model]);
  return <View>{options.map(option=><Choice key={option.id} item={option} onSelect={()=>send({type:'choose',item:option,fallback:unavailable()})}/>)}{model.step===2&&<Details item={model.chosen}/>}</View>;
}
export function App(){return <View><Form options={[{kind:'known',id:'observed item'}]}/></View>}`;
  await writeFile(join(rootPath,'App.tsx'),appSource);await writeFile(join(rootPath,'reducer.ts'),reducer);
  const graph=await scanAppFlow(rootPath,'ios'),manifest=await instrumentationManifest(rootPath,graph),catalog=graph.presentations!;
  const site=catalog.previewStates!.find(site=>site.owner==='Form')!,action=catalog.previews!.find(action=>action.effect.kind==='state'&&action.effect.site===site.id&&action.effect.value===2)!;
  assert.ok(site.selections?.length);assert.ok(action);
  const dom=new JSDOM('<div id="root"></div>'),keys=['window','document','IS_REACT_ACT_ENVIRONMENT','__REACT_DEVTOOLS_GLOBAL_HOOK__','__MOBILE_DEV_FLOW_REGISTRY__','__r'];
  const saved=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({x:0,y:0,width:300,height:500,top:0,left:0,right:300,bottom:500,toJSON(){}});
  const renderers=new Map(),roots=new Set<any>();
  const hook={supportsFiber:true,renderers,inject(renderer:any){renderer.rendererPackageName='react-native-renderer';renderers.set(1,renderer);return 1;},getFiberRoots:()=>roots,onCommitFiberRoot(_id:any,root:any){roots.add(root);},onCommitFiberUnmount(){}};
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__=hook;
  const React=require('react'),{createRoot}=require('react-dom/client');
  const View=({children,style}:any)=>React.createElement('div',{style},children);
  function Modal({children,visible,onShow,onDismiss}:any){React.useLayoutEffect(()=>{if(visible)onShow?.();else onDismiss?.();},[visible]);return visible?React.createElement('aside',null,children):null;}
  const native={View,Modal,Platform:{OS:'ios'},StyleSheet:{create:(value:any)=>value}};
  const bundle=await build({entryPoints:['src/server/app-flow/instrumentation-client.js'],bundle:true,write:false,format:'cjs',platform:'node',external:['react','react-native']});
  const clientModule={exports:{} as any},context=vm.createContext({setTimeout,clearTimeout,console,module:clientModule,exports:clientModule.exports,require:(name:string)=>name==='react'?React:native});
  vm.runInContext(bundle.outputFiles[0].text,context);const client=clientModule.exports;
  globalThis.__MOBILE_DEV_FLOW_REGISTRY__=client.registry;
  globalThis.__r={getModules:()=>new Map([[1,{isInitialized:true,publicModule:{exports:React}}],[2,{isInitialized:true,publicModule:{exports:native}}]])};
  const prepared=transformSync(appSource,{filename:join(rootPath,'App.tsx'),configFile:false,babelrc:false,parserOpts:{plugins:['jsx']},plugins:[[plugin,{enabled:true,projectRoot:rootPath,client:'flow-client',manifest}]]}).code;
  const compiled=await transform(prepared,{loader:'jsx',format:'cjs'}),appModule={exports:{} as any};
  context.module=appModule;context.exports=appModule.exports;context.require=(name:string)=>name==='react'?React:name==='react-native'?native:name==='./reducer'?{reducer(){assert.fail('The app reducer must never execute to prepare a preview')}}:client;
  vm.runInContext(compiled.code,context);const app=appModule.exports,reported:any[]=[];
  const root=createRoot(document.querySelector('#root'),{onCaughtError:(error:any)=>reported.push(error)});
  const fibers=(visit:any,subtree?:any)=>{const stack=[subtree??[...roots][0].current];while(stack.length){const fiber=stack.pop();if(fiber!==subtree&&fiber.sibling)stack.push(fiber.sibling);if(visit(fiber)!==false&&fiber.child)stack.push(fiber.child);}};
  const runtime=installPresentationRuntime({hook,fibers,hidden:()=>false,later:setTimeout});
  t.after(async()=>{await React.act(()=>runtime.rollback(0,false));runtime.cleanup();await React.act(()=>root.unmount());Object.assign(globalThis,saved);dom.window.close();});
  await React.act(()=>root.render(React.createElement(app.App)));
  await React.act(()=>runtime.collect([site],[action],rootPath,graph.sourceHash));
  const live=client.registry.find(site.id),before=live.value.tuple[0],effects=context.formEffects;
  assert.equal(runtime.diagnostics().lastCompiledBindings,1);
  const select=client.registry.selectState;client.registry.selectState=(...args:any[])=>{assert.ok(args[3].length,'Source choices must bind to their rendered elements');const value=select(...args);assert.ok(value,'Rendered props must satisfy the compiled projection');return value;};
  await React.act(()=>assert.equal(runtime.open(action.id).error,undefined));
  const preview=client.registry.matchingOwners(graph.sourceHash).find((owner:any)=>owner.preview&&owner.entries.has(site.id));
  assert.ok(preview);assert.equal(preview.entries.get(site.id).tuple[0].chosen.id,'observed item');
  assert.equal(live.value.tuple[0],before);assert.equal(before.step,1);assert.equal(context.formEffects,effects);
  assert.match(document.querySelector('aside')?.textContent??'',/observed itemobserved item/);
  assert.deepEqual(reported,[]);
  await React.act(()=>runtime.rollback(0,false));
  assert.equal(client.registry.matchingOwners(graph.sourceHash).filter((owner:any)=>owner.preview).length,0);
  assert.equal(client.registry.find(site.id).value.tuple[0].step,1);
});
