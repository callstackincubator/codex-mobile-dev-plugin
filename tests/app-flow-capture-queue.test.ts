import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createCaptureQueue} from '../src/server/app-flow/capture-queue.js';
import {createFlowRegistry} from '../src/server/app-flow/instrumentation-registry.js';

test('capture holds a screen until its screenshot is acknowledged and verified', async () => {
  const events:any[] = [], opened:string[] = [];
  let restored = 0;
  const driver = {async open(job:any){opened.push(job.id);return {ready:true};},async ready(){return {ready:true,key:'settled'};},async verify(){return {ready:true,key:'settled'};},same:(a:any,b:any)=>a.key===b.key,async restore(){restored++;}};
  const queue = createCaptureQueue(driver, (event:any)=>events.push(event));
  queue.start('batch', [{id:'one'},{id:'two'}]);
  await delay(0);
  assert.deepEqual(opened,['one']);
  const first = events.find(event=>event.type==='frame');
  assert.equal(queue.ack('stale',first.ticket,{ok:true}).accepted,false);
  await delay(0); assert.deepEqual(opened,['one']);
  queue.ack('batch',first.ticket,{ok:true}); await delay(0);
  assert.deepEqual(opened,['one','two']);
  assert.equal(events.filter(event=>event.status==='captured').length,1);
  const second=events.filter(event=>event.type==='frame')[1];
  queue.ack('batch',second.ticket,{ok:true});await delay(0);
  assert.equal(restored,1);assert.equal(queue.active,false);
  assert.equal(events.at(-1).type,'done');
});

test('a changed view discards the frame without reopening the route', async () => {
  const events:any[]=[];let opens=0,checks=0;
  const queue=createCaptureQueue({async open(){opens++;return {ready:true};},async ready(){return {key:'settled',ready:true};},async verify(){return {key:++checks===1?'moving':'settled',ready:true};},same:(a:any,b:any)=>a.key===b.key,async restore(){}},(event:any)=>events.push(event));
  queue.start('b',[{id:'one'}]);await delay(0);
  queue.ack('b',events.find(e=>e.type==='frame').ticket,{ok:true});await delay(0);
  assert.equal(opens,1);assert.equal(events.filter(e=>e.type==='discard').length,1);
  assert.equal(events.filter(e=>e.status==='captured').length,0);
  queue.ack('b',events.filter(e=>e.type==='frame')[1].ticket,{ok:true});await delay(0);
  assert.equal(events.filter(e=>e.status==='captured').length,1);
});

test('cancelling while a frame is pending restores once and rejects late acknowledgements',async()=>{
  const events:any[]=[];let restores=0;
  const queue=createCaptureQueue({async open(){return {ready:true};},async ready(){return {ready:true};},async restore(){restores++;}},(event:any)=>events.push(event));
  queue.start('b',[{id:'one'},{id:'two'}]);await delay(0);
  const frame=events.find(e=>e.type==='frame');await queue.stop();
  assert.equal(restores,1);assert.equal(queue.ack('b',frame.ticket,{ok:true}).accepted,false);
  assert.equal(events.some(e=>e.status==='captured'),false);
});

test('source bindings publish only committed values and release owners on unmount',()=>{
  const registry=createFlowRegistry();const first=registry.create('source'),second=registry.create('source');
  registry.stage(first,'control',{actual:1});assert.equal(registry.find('control'),undefined);
  registry.commit(first);assert.equal(registry.find('control').value.actual,1);
  registry.stage(second,'control',{actual:2});registry.commit(second);
  assert.equal(registry.find('control'),undefined);
  assert.equal(registry.find('control',first.id).value.actual,1);
  registry.remove(second);assert.equal(registry.find('control').owner,first);
  first.pending=new Map();registry.commit(first);assert.equal(registry.find('control'),undefined);
  registry.remove(first);assert.equal(registry.inventory().owners,0);
});

test('Strict Mode cleanup/setup replays the same committed bindings',()=>{
  const registry=createFlowRegistry(),owner=registry.create('Screen','hash');
  const entries=owner.pending;registry.stage(owner,'state',{value:42});registry.commit(owner,entries);
  registry.remove(owner);registry.commit(owner,entries);
  assert.equal(registry.find('state').value.value,42);
  const abandoned=new Map([['state',{value:99}]]);owner.pending=abandoned;
  assert.equal(registry.find('state').value.value,42);
});
