import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scanAppFlow} from '../src/server/app-flow/scan.ts';
import {instrumentationManifest} from '../src/server/app-flow/capture-manifest.ts';
import {selectOpeningState} from '../src/server/app-flow/state-selections.js';

const source=`import {useState} from 'react';
export function Form({record}){
 const [model,setModel]=useState();
 const open=(opts)=>{
   const author=opts.record?.author;
   const blocked=Boolean(author&&author.blocked);
   if(blocked){showToast()}else{setModel(prev=>{if(prev){return prev}return opts})}
 };
 const onPress=()=>{analytics();open({record,subject:{...record,kind:'item'}})};
 return <><Button onPress={onPress}/>{model&&<Details record={model.record}/>}</>;
}
function Details(){return <View/>}`;
async function fixture(t:test.TestContext,body=source){
 const root=await mkdtemp(join(tmpdir(),'flow-opening-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(join(root,'App.tsx'),body);
 const graph=await scanAppFlow(root,'ios');
 return {root,graph,action:graph.presentations!.actions.find(action=>action.input)!};
}

test('source-proven openings carry observed data through helpers without executing handlers',async t=>{
 const {action,graph,root}=await fixture(t);assert.ok(action);
 assert.equal(action.name,'Details');assert.equal(action.effect.kind,'state');
 assert.deepEqual(action.input!.locals,['record']);
 const real=Object.freeze({id:'observed-record',author:Object.freeze({blocked:false})});
 const result=selectOpeningState(action.input,undefined,{props:{},locals:{record:real}});
 assert.equal(result.value.record,real);assert.deepEqual(result.value.subject,{...real,kind:'item'});
 assert.equal(selectOpeningState(action.input,undefined,{locals:{record:{...real,author:{blocked:true}}}}),undefined,'Preserve the opener condition');
 assert.equal(selectOpeningState(action.input,undefined,{locals:{}}),undefined,'Missing data is not invented');
 assert.equal(selectOpeningState(action.input,undefined,{locals:{record:{get author(){assert.fail('Getter ran')}}}}),undefined);
 const existing={record:real};assert.equal(selectOpeningState(action.input,existing,{locals:{record:real}}).value,existing,'Preserve an already open body');
 const manifest=await instrumentationManifest(root,graph);
 assert.deepEqual(manifest.files['App.tsx'].controls.find(control=>control.source.line===action.source!.line)!.locals,['record']);
});

test('unknown guards, shadowed setters and submission handlers cannot become data openings',async t=>{
 const guarded=await fixture(t,source.replace('Boolean(author&&author.blocked)','unknownGuard(author)'));
 assert.ok(guarded.action);
 assert.equal(selectOpeningState(guarded.action.input,undefined,{locals:{record:{id:'real'}}}),undefined);
 const shadowed=await fixture(t,source.replace('if(blocked){showToast()}else{','if(blocked){showToast()}else{const setModel=externalSetter;'));
 assert.equal(shadowed.action,undefined);
 const submitting=await fixture(t,source.replace('analytics();','submitRecord();'));
 assert.equal(submitting.action,undefined);
});

test('prepared runtime opens one shared form from real row data and restores its state',async t=>{
 const {createRequire}=await import('node:module'),require=createRequire(import.meta.url);
 const {transformSync}=require('@babel/core'),plugin=require('../src/server/app-flow/instrumentation-plugin.cjs');
 const {build,transform}=await import('esbuild'),{JSDOM}=await import('jsdom'),vm=await import('node:vm');
 const {installPresentationRuntime}=await import('../src/server/app-flow/presentations-runtime.js');
 const body=`import * as React from 'react';import {View,ScrollView} from 'react-native';
 export const mode={disabled:false,active:true,horizontal:false,paging:false,scrollEnabled:true};
 const State=React.createContext(),Controls=React.createContext();
 export function Provider({children}){const [model,setModel]=React.useState();const open=React.useCallback(opts=>setModel(previous=>previous||opts),[]);const api=React.useMemo(()=>({open}),[open]);return <State.Provider value={model}><Controls.Provider value={api}>{children}</Controls.Provider></State.Provider>}
 export function useModel(){return React.useContext(State)}
 export function useControls(){const {open}=React.useContext(Controls);return React.useMemo(()=>({open}),[open])}
 export function Row({record}){const {open}=useControls();const onPress=()=>{analytics();open({record,subject:{...record,kind:'item'}})};return <View><p>Loaded row content</p><Button disabled={mode.disabled} onPress={onPress}/></View>}
 export function Button({onPress,disabled}){return <button disabled={disabled} onClick={onPress}>Open</button>}
 export function Details({record}){return <p>{record.id}</p>}
 export function Display(){const model=useModel();return <View>{model&&<Details record={model.record}/>}</View>}
 function Layer({children}){return children}
 function Deep({children}){for(let i=0;i<140;i++)children=<Layer>{children}</Layer>;return children}
 export function App(){return <View><Provider><Deep isPageFocused={mode.active}><ScrollView horizontal={mode.horizontal} pagingEnabled={mode.paging} scrollEnabled={mode.scrollEnabled}><Row record={{id:'real-first'}}/><Row record={{id:'real-second'}}/></ScrollView></Deep><Display/></Provider></View>}`;
 const {root:directory,graph,action}=await fixture(t,body),manifest=await instrumentationManifest(directory,graph);
 assert.ok(action);assert.equal(action.name,'Details');
 const site=graph.presentations!.states.find(site=>action.effect.kind==='state'&&site.id===action.effect.site)!;
 const dom=new JSDOM('<div id="root"></div>'),keys=['window','document','IS_REACT_ACT_ENVIRONMENT','__REACT_DEVTOOLS_GLOBAL_HOOK__','__MOBILE_DEV_FLOW_REGISTRY__','__r'];
 const saved=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const geometry={entryX:0,entryY:0,viewportX:0,entryHeight:40};
 dom.window.HTMLElement.prototype.getBoundingClientRect=function(){const button=this.tagName==='BUTTON',x=button?geometry.entryX:this.hasAttribute('data-scroll')?geometry.viewportX:0,y=button?geometry.entryY:0,height=button?geometry.entryHeight:500;return {x,y,width:300,height,top:y,left:x,right:x+300,bottom:y+height,toJSON(){}};};
 const renderers=new Map(),roots=new Set<any>();
 const hook={supportsFiber:true,renderers,inject(renderer:any){renderer.rendererPackageName='react-native-renderer';renderers.set(1,renderer);return 1;},getFiberRoots:()=>roots,onCommitFiberRoot(_id:any,root:any){roots.add(root)},onCommitFiberUnmount(){}};
 globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__=hook;
 const React=require('react'),{createRoot}=require('react-dom/client');
 const native={View:({children}:any)=>React.createElement('div',null,children),ScrollView:({children,...props}:any)=>React.createElement('div',{'data-scroll':true,ref:(element:any)=>{if(element)element.viewConfig={uiViewClassName:'RCTScrollView'}},...props},children)};
 const bundle=await build({entryPoints:['src/server/app-flow/instrumentation-client.js'],bundle:true,write:false,format:'cjs',platform:'node',external:['react','react-native']});
 const clientModule={exports:{} as any},context=vm.createContext({setTimeout,clearTimeout,console,module:clientModule,exports:clientModule.exports,require:(name:string)=>name==='react'?React:native});
 vm.runInContext(bundle.outputFiles[0].text,context);const client=clientModule.exports;
 globalThis.__MOBILE_DEV_FLOW_REGISTRY__=client.registry;
 globalThis.__r={getModules:()=>new Map([[1,{isInitialized:true,publicModule:{exports:React}}],[2,{isInitialized:true,publicModule:{exports:native}}]])};
 const prepared=transformSync(body,{filename:join(directory,'App.tsx'),configFile:false,babelrc:false,parserOpts:{plugins:['jsx']},plugins:[[plugin,{enabled:true,projectRoot:directory,client:'flow-client',manifest}]]}).code;
 const compiled=await transform(prepared,{loader:'jsx',format:'cjs'}),appModule={exports:{} as any};
 context.module=appModule;context.exports=appModule.exports;context.require=(name:string)=>name==='react'?React:name==='react-native'?native:client;
 context.analytics=()=>assert.fail('The app handler must not execute');
 vm.runInContext(compiled.code,context);
 const reported:any[]=[],root=createRoot(document.querySelector('#root'),{onCaughtError:(error:any)=>reported.push(error)});
 const fibers=(visit:any,subtree?:any)=>{const stack=[subtree??[...roots][0].current];while(stack.length){const fiber=stack.pop();if(fiber!==subtree&&fiber.sibling)stack.push(fiber.sibling);if(visit(fiber)!==false&&fiber.child)stack.push(fiber.child)}};
 const runtime=installPresentationRuntime({hook,fibers,hidden:()=>false,later:setTimeout});
 t.after(async()=>{await React.act(()=>runtime.rollback(0,false));runtime.cleanup();await React.act(()=>root.unmount());Object.assign(globalThis,saved);dom.window.close();});
 await React.act(()=>root.render(React.createElement(appModule.exports.App)));
 await React.act(()=>runtime.collect([site],[action],directory,graph.sourceHash));
 assert.equal(runtime.prepare(action.id).available,true);
 geometry.entryY=750;
 assert.equal(runtime.prepare(action.id).available,true,'A real opening below the fold is reachable in its active vertical scroll area');
 geometry.entryX=400;
 assert.equal(runtime.prepare(action.id).available,false,'Horizontal page clipping still excludes the entry');
 geometry.entryX=0;geometry.entryHeight=0;
 assert.equal(runtime.prepare(action.id).available,false,'A zero-size entry cannot open');
 geometry.entryHeight=40;geometry.viewportX=400;
 assert.equal(runtime.prepare(action.id).available,false,'An offscreen scroll viewport cannot supply an opening');
 geometry.viewportX=0;
 const mode=appModule.exports.mode;
 for(const [key,blocked,allowed]of [['disabled',true,false],['active',false,true],['horizontal',true,false],['paging',true,false],['scrollEnabled',false,true]]){
   mode[key]=blocked;await React.act(()=>root.render(React.createElement(appModule.exports.App)));
   assert.equal(runtime.prepare(action.id).available,false,`Preserve the ${key} gate for an offscreen entry`);
   mode[key]=allowed;await React.act(()=>root.render(React.createElement(appModule.exports.App)));
   assert.equal(runtime.prepare(action.id).available,true);
 }
 await React.act(()=>{assert.equal(runtime.open(action.id).error,undefined)});
 const opened=client.registry.find(site.id).value.tuple[0];
 assert.ok(['real-first','real-second'].includes(opened.record.id));assert.equal(opened.subject.id,opened.record.id);
 assert.match(document.body.textContent!,/real-(first|second)/);assert.equal(runtime.checkpoint(),1);
 assert.equal(runtime.prepare(action.id).available,false,'An open shared form must not be replaced by another row');
 await React.act(()=>runtime.rollback(0,false));
 assert.equal(client.registry.find(site.id).value.tuple[0],undefined);assert.equal(runtime.checkpoint(),0);
 const setModel=client.registry.find(site.id).value.tuple[1];
 const external={record:{id:'external'}};
 await React.act(()=>{assert.equal(runtime.open(action.id).error,undefined)});
 await React.act(()=>setModel(external));
 await React.act(()=>runtime.rollback(0,false));
 assert.equal(client.registry.find(site.id).value.tuple[0],external,'Restore leaves a later app opening intact');assert.equal(runtime.checkpoint(),0);
 await React.act(()=>setModel(undefined));
 await React.act(()=>{setModel(external);runtime.open(action.id)});
 assert.equal(client.registry.find(site.id).value.tuple[0],external,'A queued app update wins over the stale opening data');
 await React.act(()=>runtime.rollback(0,false));
 assert.equal(client.registry.find(site.id).value.tuple[0],external);assert.equal(runtime.checkpoint(),0);assert.deepEqual(reported,[]);
});
