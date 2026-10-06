import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureBatch} from '../src/server/app-flow/capture-batch.ts';
import {createCaptureQueue} from '../src/server/app-flow/capture-queue.js';

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
