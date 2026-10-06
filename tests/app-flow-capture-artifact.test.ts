import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
