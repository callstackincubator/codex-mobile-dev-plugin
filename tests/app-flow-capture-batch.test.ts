import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureBatch,CaptureConnectionError} from '../src/server/app-flow/capture-batch.ts';
import {createCaptureQueue} from '../src/server/app-flow/capture-queue.js';
import {FlowAppFailure,FlowNativeFailure,FlowRuntimeTimeout} from '../src/server/app-flow/runtime-metrics.ts';

test('server saves only an acknowledged stable frame and removes discarded screenshots',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'flow-batch-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(join(directory,'run'));
  let listener:(event:any)=>void=()=>{},checks=0,shots=0,saves=0;
  const queue=createCaptureQueue({async open(){return {ready:true}},async ready(){return {key:'settled',ready:true}},async verify(){return {key:++checks===1?'moving':'settled',ready:true}},same:(a:any,b:any)=>a.key===b.key,async restore(){}},(event:any)=>listener(event));
  const runtime={onCapture(callback:any){listener=callback;return()=>{listener=()=>{}}},async close(){},async invoke(command:any){
    if(command.type==='capture-start')return queue.start(command.batch,command.jobs);
    if(command.type==='capture-ack')return queue.ack(command.batch,command.ticket,command.value);
    if(command.type==='capture-stop')return queue.stop();
  }};
  const run:any={id:'run',sourceHash:'hash',revision:0,nodes:[{id:'view',status:'pending'}]};
  await captureBatch({backend:{runtime,async screenshot(){return Buffer.from(`native-frame-${++shots}`)}},manifest:{version:1,total:1,jobs:[{id:'view',path:[],actions:[],sourceViews:[]}]},run,directory,signal:new AbortController().signal,async save(){saves++}});
  assert.equal(shots,2);assert.equal(saves,1);assert.equal(run.nodes[0].status,'captured');
  assert.equal(await readFile(join(directory,'run','view.png'),'utf8'),'native-frame-2');
  assert.deepEqual(await readdir(join(directory,'run')),['view.png']);
});

test('queued native sheet previews use server-bound source and retain their real recipe',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'flow-shared-batch-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(join(directory,'run'));
  const action:any={id:'guarded',consumer:{component:'Form'},preview:true,effect:{kind:'state',site:'shared-state'}};
  const events:string[]=[];let listener:(event:any)=>void=()=>{},queue:any;
  queue=createCaptureQueue({async open(){const value=await queue.request({operation:'open',actionId:'guarded'});return value.error?{ready:false,reason:value.error}:value.view;},async ready(){return {key:'form',ready:true}},async verify(){return {key:'form',ready:true}},same:(a:any,b:any)=>a.key===b.key,async restore(){events.push('restore')}},(event:any)=>listener(event));
  const runtime={onCapture(callback:any){listener=callback;return()=>{listener=()=>{}}},async close(){},async invoke(command:any){
    events.push(command.type);
    if(command.type==='capture-start'){assert.deepEqual(command.jobs[0].actions,[{id:'guarded'}]);assert.equal(command.jobs[0].sourceViews,undefined);return queue.start(command.batch,command.jobs);}
    if(command.type==='capture-ack')return queue.ack(command.batch,command.ticket,command.value);
    if(command.type==='capture-source')return queue.source(command.batch,command.ticket,command.value);
    if(command.type==='capture-stop')return queue.stop();
    if(command.type==='presentation-setup'){assert.equal(command.projectRoot,'/fixture');assert.equal(command.catalog.actions[0],action);return {};}
    if(command.type==='presentation-prepare')return {available:true};
    if(command.type==='presentation-open')return {key:'form',ready:true};
    assert.fail('Unexpected runtime command');
  }};
  const run:any={id:'run',sourceHash:'hash',revision:0,presentations:{states:[],actions:[],previews:[action]},nodes:[{id:'view',status:'pending'}]};
  await captureBatch({backend:{runtime,async screenshot(){return Buffer.from('actual-native-frame')}},manifest:{version:1,total:1,jobs:[{id:'view',path:[],actions:[action],sourceViews:[]}]},run,projectRoot:'/fixture',directory,signal:new AbortController().signal,async save(){}});
  assert.equal(run.nodes[0].status,'captured');assert.equal(await readFile(join(directory,'run','view.png'),'utf8'),'actual-native-frame');
  assert.ok(events.indexOf('presentation-setup')<events.indexOf('presentation-open'));
  assert.ok(events.indexOf('capture-source')<events.indexOf('capture-ack'));
  assert.ok(events.includes('restore'));
});

test('an unconfirmed native dismissal in source binding stops without acknowledging or saving a frame',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'flow-native-failure-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(join(directory,'run'));
  let listener:(event:any)=>void=()=>{},detached=false;
  const commands:string[]=[],action:any={id:'child',effect:{kind:'control'}};
  const runtime={onCapture(callback:any){listener=callback;return()=>{detached=true;listener=()=>{}}},async close(){},async invoke(command:any){
    commands.push(command.type);
    if(command.type==='capture-start'){
      listener({type:'opening',batch:command.batch,id:'view'});
      listener({type:'source',batch:command.batch,id:'view',ticket:1,operation:'open',actionId:'child'});
      return {started:true};
    }
    if(command.type==='presentation-setup')throw new FlowNativeFailure('presentation-collect');
    if(command.type==='capture-stop')return {};
    assert.fail('No capture acknowledgement or later opening is safe');
  }};
  const run:any={id:'run',sourceHash:'hash',revision:0,nodes:[{id:'view',status:'pending'}],presentations:{states:[],actions:[action]}};
  await assert.rejects(captureBatch({backend:{runtime,async screenshot(){assert.fail('No native pixels should be requested')}},manifest:{version:1,total:1,jobs:[{id:'view',path:[],actions:[action],sourceViews:[]}]},run,projectRoot:'/fixture',directory,signal:new AbortController().signal,async save(){assert.fail('No capture should be saved')}}),FlowNativeFailure);
  assert.deepEqual(commands,['capture-start','presentation-setup','capture-stop']);
  assert.equal(detached,true);assert.deepEqual(await readdir(join(directory,'run')),[]);
});

test('a saved presentation keeps the compiled caller sites read with its frame',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'flow-sites-batch-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(join(directory,'run'));
  let listener:(event:any)=>void=()=>{};
  const sites:Record<string,unknown>={prompt:['src/components/Prompt.tsx:62:4','src/screens/EditProfile.tsx:74:6'],invalid:['/Users/me/app.tsx:1:2\nmore'],route:['ignored.tsx:1:1']};
  const queue=createCaptureQueue({async open(){return {ready:true}},async ready(){return {key:'view',ready:true}},async verify(){return {key:'view',ready:true}},same:(a:any,b:any)=>a.key===b.key,async restore(){},
    async sites(job:any){return sites[job.id]}},(event:any)=>listener(event));
  const runtime={onCapture(callback:any){listener=callback;return()=>{listener=()=>{}}},async close(){},async invoke(command:any){
    if(command.type==='capture-start')return queue.start(command.batch,command.jobs);
    if(command.type==='capture-ack')return queue.ack(command.batch,command.ticket,command.value);
    if(command.type==='capture-stop')return queue.stop();
  }};
  const presentation={actions:['open'],basePath:[]};
  const run:any={id:'run',sourceHash:'hash',revision:0,nodes:[{id:'prompt',status:'pending',presentation},{id:'invalid',status:'pending',presentation},{id:'route',status:'pending'}]};
  const job=(id:string)=>({id,path:[],actions:[{id:'open'}],sourceViews:[]}) as any;
  let shots=0;
  await captureBatch({backend:{runtime,async screenshot(){return Buffer.from(`frame-${++shots}`)}},manifest:{version:1,total:3,jobs:[job('prompt'),job('invalid'),job('route')]},run,directory,signal:new AbortController().signal,async save(){}});
  assert.deepEqual(run.nodes.map((node:any)=>node.status),['captured','captured','captured']);
  assert.deepEqual(run.nodes[0].capturedSites,sites.prompt);
  assert.equal(run.nodes[1].capturedSites,undefined,'Malformed site evidence is dropped');
  assert.equal(run.nodes[2].capturedSites,undefined,'Route screens are identified by their route');
});

test('an app too busy to acknowledge interrupts the batch, and in-app app or native failures keep their kind',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'flow-ack-timeout-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(join(directory,'run'));
  const attempt=async(driver:any,ack:(command:any,queue:any)=>any)=>{
    let listener:(event:any)=>void=()=>{};
    const queue=createCaptureQueue({async open(){return {ready:true}},async ready(){return {key:'view',ready:true}},async verify(){return {key:'view',ready:true}},same:(a:any,b:any)=>a.key===b.key,async restore(){},...driver},(event:any)=>listener(event));
    const runtime={onCapture(callback:any){listener=callback;return()=>{listener=()=>{}}},async close(){},async invoke(command:any){
      if(command.type==='capture-start')return queue.start(command.batch,command.jobs);
      if(command.type==='capture-ack')return ack(command,queue);
      if(command.type==='capture-stop')return queue.stop();
    }};
    const run:any={id:'run',sourceHash:'hash',revision:0,nodes:[{id:'view',status:'pending'}]};
    return captureBatch({backend:{runtime,async screenshot(){return Buffer.from('frame')}},manifest:{version:1,total:1,jobs:[{id:'view',path:[],actions:[],sourceViews:[]}]},run,directory,signal:new AbortController().signal,async save(){}});
  };
  await assert.rejects(attempt({},()=>{throw new FlowRuntimeTimeout('capture-ack')}),CaptureConnectionError);
  const fail=(kind:string)=>({async open(){throw Object.assign(new Error('Native presentation dismissal is unconfirmed.'),{fatal:true,[kind]:true})}});
  await assert.rejects(attempt(fail('native'),(command,queue)=>queue.ack(command.batch,command.ticket,command.value)),(error:any)=>error instanceof FlowNativeFailure&&/unconfirmed/.test(error.detail));
  await assert.rejects(attempt(fail('app'),(command,queue)=>queue.ack(command.batch,command.ticket,command.value)),FlowAppFailure);
});
