import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {buildFlowRuntime} from '../scripts/build-flow-runtime.mjs';
import {createFlowRegistry} from '../src/server/app-flow/instrumentation-registry.js';

test('packaged driver preserves per-action owner and control closures across async opening and rollback',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'capture-runtime-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await buildFlowRuntime(directory);
  const {functions}=JSON.parse(await readFile(join(directory,'runtime.json'),'utf8'));
  const factory=new Function(`return (${functions[3]});`)();
  assert.doesNotMatch(functions[3],/\basync\s+(?:function|\()/,'Hermes should receive the compiled coroutine');
  const registry=createFlowRegistry(),owner=registry.create('Screen','hash'),events:string[]=[];
  const visible=new Set<string>();
  for(const id of ['first','second'])registry.stage(owner,`${id}:1:0:control`,{kind:'control',control:{open(){visible.add(id);events.push(`open-${id}`)},close(){visible.delete(id);events.push(`close-${id}`)}}});
  registry.commit(owner);
  const driver=factory({invoke(){}},registry,(target:any)=>{
    const id=target.target?.split(':')[0],shown=visible.has(id);
    return {ready:shown,found:shown,hosts:shown?1:0,content:shown?1:0,key:id,signature:String(shown)};
  });
  const actions=['first','second'].map(id=>({id,effect:{kind:'control',method:'open',close:'close',prop:'control',target:{file:id,source:{line:1,column:0}}}}));
  assert.equal((await driver.open({id:'nested',path:[],actions},new AbortController().signal)).ready,true);
  await driver.restore();
  assert.deepEqual(events,['open-first','open-second','close-second','close-first']);
});


test('the package uses matching compiled factories and falls back for an older app build',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'compiled-runtime-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await buildFlowRuntime(directory);
  const {functions,fingerprint}=JSON.parse(await readFile(join(directory,'runtime.json'),'utf8'));
  const scope:any={setTimeout,clearTimeout,exports:{},module:{exports:{}},require:(id:string)=>id==='react'?{createContext:()=>null,Component:class{}}:{View:()=>null}};
  runInNewContext(await readFile(join(directory,'instrumentation-client.cjs'),'utf8'),scope);
  assert.equal(scope.__MOBILE_DEV_FLOW_COMPILED__.fingerprint,fingerprint);
  scope.factories=functions.map((source:string)=>runInNewContext(`(${source})`,scope));
  for(const matching of [true,false]){
    scope.__MOBILE_DEV_FLOW_COMPILED__.fingerprint=matching?fingerprint:'old-build';
    scope.arguments=matching?Array.from({length:4},()=>()=>assert.fail('Compiled mode must use its bundled factories')):scope.factories.slice(1);
    runInNewContext(`factories[0]('testRuntime',30000,...arguments)`,scope);
    const installed=scope.testRuntime;
    try {
      const diagnostics:any=await new Promise(resolve=>installed.invoke({type:'diagnostics'},resolve));
      assert.equal(diagnostics.execution,matching?'compiled':'debugger');
      assert.equal(diagnostics.mountedFibers,0);
      const heartbeat:any=await new Promise(resolve=>installed.invoke({type:'heartbeat'},resolve));
      assert.equal(heartbeat.alive,true);
    } finally { await new Promise(resolve=>installed.invoke({type:'restore'},resolve)); }
    assert.equal(scope.testRuntime,undefined,'Both paths release the runtime and watchdog');
  }
});
