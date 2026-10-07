import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {build,transform} from 'esbuild';
import {JSDOM} from 'jsdom';
import {installPresentationRuntime} from '../src/server/app-flow/presentations-runtime.js';
import {captureManifest,instrumentationManifest} from '../src/server/app-flow/capture-manifest.ts';
import {FlowPresentationDiscovery} from '../src/server/app-flow/presentations.ts';

const require=createRequire(import.meta.url);

test('a shared prompt shell records the compiled site of the caller that opened it',async t=>{
  const source=`import * as React from 'react';
function useControl(){const ref=React.useRef({open(){},close(){}});return React.useMemo(()=>({ref,open(){ref.current.open()},close(){ref.current.close()}}),[]);}
export function Dialog({control,children}){
  const [open,setOpen]=React.useState(false);
  control.ref.current={open:()=>setOpen(true),close:()=>setOpen(false)};
  return open?<section>{children}</section>:null;
}
export function Outer({control,children}){return <Dialog control={control}>{children}</Dialog>;}
export function Basic({control,title}){return <Outer control={control}><p>{title}</p></Outer>;}
export function Sheet({control,children}){return <div>{children}</div>;}
export function EditProfile(){const edit=useControl(),discard=useControl();return <Sheet control={edit}><Basic control={discard} title="Discard profile edits"/></Sheet>;}
export function Chat(){const tooNew=useControl();return <div><Basic control={tooNew} title="Account too new"/></div>;}
export function App(){return <main><EditProfile/><Chat/></main>;}
`;
  const at=(needle:string)=>{
    const index=source.indexOf(needle),before=source.slice(0,index),line=before.split('\n').length,column=index-before.lastIndexOf('\n')-1;
    return {line,column,endLine:line,endColumn:column+needle.length};
  };
  const view=(id:string,owner:string,needle:string,component:string)=>({id,name:component,file:'screen.jsx',owner,line:at(needle).line,kind:'control',source:at(needle),
    components:[{file:'screen.jsx',component}],control:{component,prop:'control',boundary:true,generic:false},availability:'observed-only'});
  const views=[view('shell','Outer','<Dialog control={control}>','Dialog'),view('basic','Basic','<Outer control={control}>','Outer'),
    view('profile','EditProfile','<Basic control={discard}','Basic'),view('sheet','EditProfile','<Sheet control={edit}>','Sheet'),view('chat','Chat','<Basic control={tooNew}','Basic')];
  const shell:any={id:'outer',file:'screen.jsx',line:views[0].line,owner:'Outer',component:'Outer',prop:'',name:'Outer',preview:true,views:['shell'],
    effect:{kind:'control',component:'Dialog',prop:'control',method:'auto',close:['close'],target:{file:'screen.jsx',owner:'Outer',line:views[0].line,source:views[0].source}}};
  const directory=await realpath(await mkdtemp(join(tmpdir(),'flow-identity-')));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(join(directory,'screen.jsx'),source);
  const manifest=await instrumentationManifest(directory,{sourceHash:'hash',nodes:[],edges:[],warnings:[],files:1,scanMs:0,presentations:{states:[],actions:[],previews:[shell],views:views as any}});
  // Source-only caller sites carry markers beside the opened shell's own target.
  const sites=manifest.files['screen.jsx'].controls.map(control=>`${control.source.line}:${control.source.column}`);
  for(const item of views)assert.ok(sites.includes(`${item.source.line}:${item.source.column}`),`${item.id} has a compiled marker`);
  assert.equal(manifest.files['screen.jsx'].controls.length,views.length,'A controller site is marked once');

  const dom=new JSDOM('<div id="root"></div>');
  const keys=['window','document','IS_REACT_ACT_ENVIRONMENT','__REACT_DEVTOOLS_GLOBAL_HOOK__','__MOBILE_DEV_FLOW_REGISTRY__'];
  const saved=Object.fromEntries(keys.map(key=>[key,(globalThis as any)[key]]));
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  dom.window.HTMLElement.prototype.getBoundingClientRect=()=>({x:0,y:0,width:300,height:500,top:0,left:0,right:300,bottom:500,toJSON(){}});
  const renderers=new Map(),roots=new Set<any>();
  const hook={supportsFiber:true,renderers,inject(renderer:any){renderer.rendererPackageName='react-native-renderer';renderers.set(1,renderer);return 1;},getFiberRoots:()=>roots,onCommitFiberRoot(_id:any,root:any){roots.add(root);},onCommitFiberUnmount(){}};
  (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__=hook;
  const React=require('react'),{createRoot}=require('react-dom/client');
  const native={View:({children}:any)=>React.createElement('div',null,children),Platform:{OS:'ios'},StyleSheet:{create:(value:any)=>value}};
  const bundle=await build({entryPoints:['src/server/app-flow/instrumentation-client.js'],bundle:true,write:false,format:'cjs',platform:'node',external:['react','react-native']});
  const module={exports:{} as any},context=vm.createContext({setTimeout,clearTimeout,console,module,exports:module.exports,require:(name:string)=>name==='react'?React:native});
  vm.runInContext(bundle.outputFiles[0].text,context);const client=module.exports;
  (globalThis as any).__MOBILE_DEV_FLOW_REGISTRY__=client.registry;
  const plugin=require('../src/server/app-flow/instrumentation-plugin.cjs');
  const prepared=require('@babel/core').transformSync(source,{filename:join(directory,'screen.jsx'),configFile:false,babelrc:false,parserOpts:{plugins:['jsx']},plugins:[[plugin,{enabled:true,projectRoot:directory,client:'flow-client',manifest}]]}).code;
  const compiled=await transform(prepared,{loader:'jsx',format:'cjs'});
  const appModule={exports:{} as any};context.module=appModule;context.exports=appModule.exports;context.require=(name:string)=>name==='react'?React:name==='react-native'?native:client;
  vm.runInContext(compiled.code,context);const app=appModule.exports;
  const root=createRoot(document.querySelector('#root'));
  const fibers=(visit:any,subtree?:any)=>{const stack=[subtree??[...roots][0].current];while(stack.length){const fiber=stack.pop();if(fiber!==subtree&&fiber.sibling)stack.push(fiber.sibling);if(visit(fiber)!==false&&fiber.child)stack.push(fiber.child);}};
  const runtime=installPresentationRuntime({hook,fibers,hidden:()=>false,later:setTimeout});
  t.after(async()=>{await React.act(()=>runtime.rollback(0,false));runtime.cleanup();await React.act(()=>root.unmount());Object.assign(globalThis,saved);dom.window.close();});
  await React.act(()=>root.render(React.createElement(app.App)));
  await React.act(()=>runtime.collect([],[shell],directory,'hash'));
  const owner=(type:any)=>{let found:any;fibers((fiber:any)=>{if(fiber.type===type)found=fiber;});return found;};
  const site=(item:any)=>`screen.jsx:${item.source.line}:${item.source.column}`,passed=(item:any)=>`${site(item)}:control`;

  assert.deepEqual(runtime.openedSites(),[],'Nothing is open yet');
  await React.act(()=>assert.equal(runtime.open('outer',owner(app.EditProfile)).error,undefined));
  assert.match(document.body.textContent!,/Discard profile edits/);
  // The enclosing sheet passes another controller and the chat caller is not
  // an ancestor, so neither names this image.
  assert.deepEqual(runtime.openedSites(),[passed(views[0]),passed(views[1]),passed(views[2])]);
  await React.act(()=>runtime.rollback(0,false));
  assert.deepEqual(runtime.openedSites(),[]);
  await React.act(()=>assert.equal(runtime.open('outer',owner(app.Chat)).error,undefined));
  assert.match(document.body.textContent!,/Account too new/);
  assert.deepEqual(runtime.openedSites(),[passed(views[0]),passed(views[1]),passed(views[4])]);
  await React.act(()=>runtime.rollback(0,false));

  // Discovery names each caller of the shared shell. A preview of the caller's
  // own site becomes the canonical step; otherwise the caller site separates it.
  const chatPrompt:any={id:'chat-prompt',file:'screen.jsx',line:views[4].line,owner:'Chat',component:'Basic',prop:'',name:'Basic',preview:true,views:['chat'],
    effect:{kind:'control',component:'Basic',prop:'control',method:'auto',close:['close'],target:{file:'screen.jsx',owner:'Chat',line:views[4].line,source:views[4].source}}};
  await React.act(()=>runtime.collect([],[shell,chatPrompt],directory,'hash'));
  const listed=(focus?:any)=>runtime.list(focus).map((item:any)=>({id:item.id,canonicalId:item.canonicalId,instance:item.instance}));
  assert.deepEqual(listed(owner(app.EditProfile)),[{id:'outer',canonicalId:'outer',instance:site(views[2])}]);
  assert.deepEqual(listed(owner(app.Chat)),[{id:'outer',canonicalId:'chat-prompt',instance:site(views[4])}]);
  // Two mounted callers make the bare shell ambiguous. A recipe's caller site
  // selects one copy without a focused parent.
  assert.equal(runtime.prepare('outer').available,false);
  assert.equal(runtime.prepare('outer',undefined,site(views[2])).available,true);
  await React.act(()=>assert.equal(runtime.open('outer',undefined,undefined,site(views[2])).error,undefined));
  assert.match(document.body.textContent!,/Discard profile edits/);
  assert.doesNotMatch(document.body.textContent!,/Account too new/);
  assert.deepEqual(runtime.openedSites(),[passed(views[0]),passed(views[1]),passed(views[2])]);
});

test('discovery keeps one view per caller of a shared shell and replays that caller',async()=>{
  const source={line:62,column:4,endLine:67,endColumn:10};
  const shell:any={id:'outer',file:'Prompt.tsx',line:62,owner:'Outer',component:'Outer',prop:'',name:'Outer',preview:true,views:['shell-view'],
    effect:{kind:'control',component:'Dialog',prop:'control',method:'auto',close:['close'],target:{file:'Prompt.tsx',owner:'Outer',line:62,source}}};
  const chat:any={...shell,id:'chat-prompt',file:'Chat.tsx',line:834,owner:'Chat',component:'Basic',name:'Basic',views:['chat-view'],
    effect:{...shell.effect,component:'Basic',target:{file:'Chat.tsx',owner:'Chat',line:834,source:{line:834,column:6,endLine:841,endColumn:8}}}};
  const parent=(id:string,instances?:Record<string,string>):any=>({id,name:id,kind:'screen',path:[],required:[],status:'captured',image:`mobile-flow://run/${id}`,
    presentation:{actions:[`open-${id}`],basePath:['Home'],...(instances?{instances}:{})}});
  const profile=parent('profile',{'open-profile':'Profile.tsx:20:4'}),list=parent('list'),send=parent('send');
  const run:any={id:'run',revision:0,nodes:[profile,list,send],edges:[],presentations:{states:[],actions:[shell,chat]}};
  const discovery=new FlowPresentationDiscovery(run,'/fixture','/fixture',new AbortController().signal,async()=>{});
  const listed:Record<string,any[]>={
    profile:[{id:'outer',canonicalId:'outer',aliases:['outer'],instance:'EditProfile.tsx:74:6',name:'Outer',file:'Prompt.tsx',line:62,views:['shell-view']}],
    list:[{id:'outer',canonicalId:'outer',aliases:['outer'],instance:'CreateList.tsx:97:6',name:'Outer',file:'Prompt.tsx',line:62,views:['shell-view']}],
    // The chat caller has its own site preview, so the runtime made it canonical.
    send:[{id:'outer',canonicalId:'chat-prompt',aliases:['outer','chat-prompt'],instance:'Chat.tsx:834:6',name:'Outer',file:'Prompt.tsx',line:62,views:['shell-view','chat-view']}],
  };
  for(const base of [profile,list,send]){
    const backend:any={runtime:{async invoke(command:any){return command.type==='presentations'?listed[base.id]:command.type==='presentation-active'?[]:{};}}};
    await discovery.explore(backend,base);
  }
  const shells=run.nodes.slice(3);
  assert.equal(shells.length,3,'Each caller is its own view');
  assert.equal(new Set(shells.map((node:any)=>node.id)).size,3);
  assert.deepEqual(shells.map((node:any)=>node.presentation.instances),[
    {'open-profile':'Profile.tsx:20:4',outer:'EditProfile.tsx:74:6'},{outer:'CreateList.tsx:97:6'},undefined]);
  assert.deepEqual(run.edges.map((edge:any)=>[edge.from,edge.to]),[['profile',shells[0].id],['list',shells[1].id],['send',shells[2].id]]);
  // The caller travels with the recipe, never as the app's own request.
  const manifest=captureManifest(run,shells);
  const job=manifest.jobs.find(item=>item.id===shells[0].id)!;
  assert.deepEqual(job.instances,{'open-profile':'Profile.tsx:20:4',outer:'EditProfile.tsx:74:6'});
});
