import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {scanAppFlow} from '../src/server/app-flow/scan.ts';
import {instrumentationManifest} from '../src/server/app-flow/capture-manifest.ts';
import {syncPreviewState} from '../src/server/app-flow/state-selections.js';

const require=createRequire(import.meta.url),babel=require('@babel/core'),plugin=require('../src/server/app-flow/instrumentation-plugin.cjs');
const reducer=`export function reducer(state,action){let next={...state};switch(action.type){
case 'receive':{animate();next.description=action.value;next.domain=action.value?.domains[0]??'';next.isLoading=false;break;}
case 'loading':{next.isLoading=action.value;break;}
case 'submit':{next.pendingSubmit=action.value;break;}
case 'credentials':{next.password=action.value;break;}
}log(next);return next;}`;
const source=`import * as React from 'react';import {View} from 'react-native';import {reducer} from './reducer';import {useResource} from './query';
export function Details({description}){return <p>{description?.label||'missing'}</p>}
export function Form(){
 const [model,dispatch]=React.useReducer(reducer,{step:0,description:undefined,domain:'',isLoading:true,pendingSubmit:null});
 const {resource,failed}=useResource();
 React.useEffect(()=>{if(failed){dispatch({type:'receive',value:undefined})}else if(resource){dispatch({type:'receive',value:resource})}dispatch({type:'loading',value:false});},[resource,failed]);
 React.useEffect(()=>{if(model.pendingSubmit)submit(model.pendingSubmit)},[model]);
 return <View>{model.description&&<span/>}{model.step===2&&<Details description={model.description}/>}</View>;
}
export function RootNavigator(){return <View><Form/></View>}`;
async function fixture(t:any,app=source,body=reducer){
 const root=await mkdtemp(join(tmpdir(),'flow-sync-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(join(root,'App.tsx'),app);await writeFile(join(root,'reducer.ts'),body);
 const graph=await scanAppFlow(root,'ios'),site=graph.presentations!.previewStates!.find(site=>site.owner==='Form')!;
 return {root,graph,site};
}

test('source-bound local transfers carry real data, preserve flags, and reject unsafe branches',async t=>{
 const {site}=await fixture(t);assert.equal(site.sync?.length,1);
 assert.ok(site.paths.some(path=>path[0]==='description'),'Render guards may depend on real data and still need that data transferred');
 const plan=site.sync![0],real=Object.freeze({label:'server response',domains:['real.example']}),before={step:2,description:undefined,domain:'',isLoading:true,pendingSubmit:null};
 assert.deepEqual(plan.updates.map(update=>Object.keys(update.patch)),[['description','domain'],['description','domain']]);
 const copied=syncPreviewState(before,plan,{resource:real,failed:false});
 assert.equal(copied.description,real);assert.equal(copied.domain,'real.example');assert.equal(copied.step,2);assert.equal(copied.isLoading,true);assert.equal(copied.pendingSubmit,null);
 assert.equal(before.description,undefined);assert.equal(syncPreviewState(copied,plan,{resource:real,failed:false}),copied,'Unchanged data keeps the same state reference');
 const cleared=syncPreviewState(copied,plan,{resource:real,failed:true});assert.equal(cleared.description,undefined);assert.equal(cleared.domain,'');
 assert.equal(syncPreviewState(before,plan,{resource:{},failed:false}),before,'An absent required property inside an optional chain must not become a guessed default');
 const controller={label:'not data',domains:['real.example'],open(){assert.fail('Controller must not execute')}};
 assert.equal(syncPreviewState(before,plan,{resource:controller,failed:false}),before);
 const repeated={...plan,updates:[...plan.updates,...plan.updates]};
 assert.equal(syncPreviewState(before,repeated,{resource:controller,failed:false}),before,'A failed data check cannot approve the same object on a later update');
 const cyclic:any={domains:['real.example']};cyclic.self=cyclic;
 assert.equal(syncPreviewState(before,plan,{resource:cyclic,failed:false}),before);
 const large={domains:['real.example'],values:Array(5000).fill(1)};
 assert.equal(syncPreviewState(before,plan,{resource:large,failed:false}),before,'Data validation work is bounded even for arrays of primitives');
 const getter={get domains(){assert.fail('The app data getter must not run')}};
 assert.equal(syncPreviewState(before,plan,{resource:getter,failed:false}),before);
 assert.equal(syncPreviewState(before,plan,{resource:undefined,failed:false}),before);
 const unsafe=await fixture(t,source.replace("if(failed){", "sendToServer(resource);if(failed){"));
 assert.equal(unsafe.site.sync,undefined,'Effects with unproven control/data work remain disabled');
 const shadowed=await fixture(t,source.replace("if(failed){dispatch({type:'receive',value:undefined})}","if(failed){const dispatch=externalDispatch;dispatch({type:'receive',value:resource})}"));
 assert.equal(shadowed.site.sync,undefined,'A shadowed dispatch must not bind to the local reducer');
});

test('temporary form receives a later query result without running the app reducer or submit effect',async t=>{
 const {JSDOM}=await import('jsdom'),{build,transform}=await import('esbuild');
 const React=require('react'),{createRoot}=require('react-dom/client');
 const {root:directory,graph,site}=await fixture(t),manifest=await instrumentationManifest(directory,graph);
 manifest.files['App.tsx'].hosts=['RootNavigator'];
 const dom=new JSDOM('<div id="root"></div>');
 const saved={window:globalThis.window,document:globalThis.document,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT};
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const context=vm.createContext({console,setTimeout,clearTimeout});
 const clientBundle=await build({entryPoints:['src/server/app-flow/instrumentation-client.js'],bundle:true,write:false,format:'cjs',platform:'node',external:['react','react-native']});
 const clientModule={exports:{} as any};context.module=clientModule;context.exports=clientModule.exports;
 const native={View:({children}:any)=>React.createElement('div',null,children)};
 context.require=(name:string)=>name==='react'?React:native;
 vm.runInContext(clientBundle.outputFiles[0].text,context);const client=clientModule.exports;
 const prepared=babel.transformSync(source,{filename:join(directory,'App.tsx'),configFile:false,babelrc:false,parserOpts:{plugins:['jsx']},plugins:[[plugin,{enabled:true,projectRoot:directory,client:'flow-client',manifest}]]}).code;
 const compiled=await transform(prepared,{loader:'jsx',format:'cjs'}),appModule={exports:{} as any};
 let snapshot={resource:undefined as any,failed:false},calls=0,submits=0;
 const listeners=new Set<()=>void>(),subscribe=(listener:()=>void)=>{listeners.add(listener);return ()=>listeners.delete(listener)},read=()=>snapshot;
 const query={useResource:()=>React.useSyncExternalStore(subscribe,read,read)};
 const appReducer=(state:any,action:any)=>{calls++;return action.type==='receive'?{...state,description:action.value,domain:action.value?.domains[0]??'',isLoading:false}:action.type==='loading'?{...state,isLoading:action.value}:state};
 context.submit=()=>submits++;context.module=appModule;context.exports=appModule.exports;
 context.require=(name:string)=>name==='react'?React:name==='react-native'?native:name==='./reducer'?{reducer:appReducer}:name==='./query'?query:client;
 vm.runInContext(compiled.code,context);const app=appModule.exports,reported:any[]=[];
 const root=createRoot(document.querySelector('#root'),{onCaughtError:(error:any)=>reported.push(error)});
 context.__REACT_DEVTOOLS_GLOBAL_HOOK__={renderers:new Map([[1,{rendererPackageName:'react-native-renderer'}]]),getFiberRoots:()=>new Set([(root as any)._internalRoot])};
 t.after(async()=>{await React.act(()=>root.unmount());Object.assign(globalThis,saved);dom.window.close();});
 await React.act(()=>root.render(React.createElement(React.StrictMode,null,React.createElement(app.RootNavigator))));
 const live=client.registry.find(site.id),baseline=calls;
 // Build seeds in the app realm, like the native executor does.
 context.seed=live.value.tuple[0];vm.runInContext("seed={...seed,step:2,pendingSubmit:{mustNotRun:true}}",context);
 await React.act(()=>client.registry.project({source:live.owner.source,owner:live.owner,site:site.id,value:context.seed}));
 assert.equal(calls,baseline);assert.equal(submits,0);assert.match(document.body.textContent!,/missing/);
 const real=vm.runInContext("Object.freeze({label:'real query data',domains:['real.example']})",context);
 const before=calls;
 await React.act(()=>{snapshot={resource:real,failed:false};for(const listener of listeners)listener();});
 const preview=client.registry.find(site.id);assert.ok(preview.owner.preview);assert.equal(preview.value.tuple[0].description,real);assert.equal(preview.value.tuple[0].domain,'real.example');
 assert.match(document.body.textContent!,/real query data/);assert.equal(submits,0);assert.equal(calls-before,4,'Strict Mode runs only the two live-app dispatches twice, never the preview reducer');
 await React.act(()=>client.registry.unproject());
 assert.equal(client.registry.find(site.id).value.tuple[0].step,0);assert.equal(client.registry.find(site.id).value.tuple[0].pendingSubmit,null);
 assert.deepEqual(reported,[]);await React.act(()=>root.unmount());assert.equal(client.registry.inventory().owners,0);assert.equal(listeners.size,0);
});


test('query transfers copy shorthand object payloads and settle on unchanged real data',async t=>{
 const app=`import {useReducer,useEffect} from 'react';import {reducer} from './reducer';export function Form({resource}){const [model,dispatch]=useReducer(reducer,{step:1,description:undefined});useEffect(()=>{if(resource)dispatch({type:'receive',resource})},[resource,model.description]);return <>{model.step===2&&<Details description={model.description}/>}</>}function Details(){return <View/>}`;
 const body=`export function reducer(state,action){switch(action.type){case 'receive':return {...state,description:{...action.resource,kind:'record'}};}}`;
 const {site}=await fixture(t,app,body),plan=site.sync![0],resource=Object.freeze({id:'observed',child:Object.freeze({id:'real-child'})}),before={step:2,description:undefined};
 assert.ok(plan);
 const next=syncPreviewState(before,plan,{resource});
 assert.deepEqual(next.description,{id:'observed',child:resource.child,kind:'record'});
 assert.equal(before.description,undefined);assert.equal(next.description.child,resource.child);
 assert.equal(syncPreviewState(next,plan,{resource}),next,'Copying equal data must not keep rendering the form');
 const changed=syncPreviewState(next,plan,{resource:{...resource,id:'new-observation'}});
 assert.equal(changed.description.id,'new-observation');assert.notEqual(changed,next);
});
