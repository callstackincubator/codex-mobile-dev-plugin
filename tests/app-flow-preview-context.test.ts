import test from 'node:test';
import assert from 'node:assert/strict';
import {capturePreviewContext} from '../src/server/app-flow/instrumentation-context.js';
import {createFlowRegistry} from '../src/server/app-flow/instrumentation-registry.js';

test('preview context keeps nearest providers and contains only its own boundary',()=>{
  const calls:any[]=[];
  const original=function(...args:any[]){calls.push({receiver:this,args});};
  const stateNode={onCaughtError:original};
  const outer={tag:10,elementType:{name:'outer'},memoizedProps:{value:{id:'real-outer'}},return:{tag:3,stateNode}};
  const inner={tag:10,type:{name:'inner'},memoizedProps:{value:{id:'real-inner'}},return:outer};
  const owner={tag:12,memoizedProps:{id:'owner'},return:inner};
  const root={current:owner};
  const hook={renderers:new Map([[1,{rendererPackageName:'react-native-renderer'}]]),getFiberRoots:()=>new Set([root])};
  class Boundary{props:any;constructor(projection:any){this.props={projection};}}
  const projection={};let failures=0;
  const context=capturePreviewContext('owner',Boundary,projection,()=>failures++,hook);
  assert.deepEqual(context.providers,[{type:inner.type,value:inner.memoizedProps.value},{type:outer.elementType,value:outer.memoizedProps.value}]);
  const wrapped=stateNode.onCaughtError,error=new Error('Temporary render');
  wrapped.call(stateNode,error,{errorBoundary:new Boundary(projection)});
  assert.equal(failures,1);assert.equal(calls.length,0);
  wrapped.call(stateNode,error,{errorBoundary:new Boundary({})});
  assert.equal(calls.length,1);assert.equal(calls[0].receiver,stateNode);
  context.release();assert.equal(stateNode.onCaughtError,original);
  wrapped.call(stateNode,error,{errorBoundary:new Boundary(projection)});
  assert.equal(calls.length,2,'Retained wrappers forward app errors after cleanup');
  root.current={tag:12,memoizedProps:{id:'another'},return:inner};
  assert.throws(()=>capturePreviewContext('owner',Boundary,{},()=>{},hook),/no longer available/);
});

test('a component loaded after its host unmounts never installs a stale preview',async()=>{
  let loaded:any,contexts=0;
  const registry=createFlowRegistry(()=>{contexts++;});
  const host=registry.create('root','hash');host.host=true;registry.commit(host);
  registry.registerLoaders([['cold',()=>new Promise(resolve=>{loaded=resolve;})]]);
  const pending=registry.project({source:'cold'});
  registry.remove(host);loaded(()=>null);
  await assert.rejects(pending,/unmounted/);
  assert.equal(registry.projection,undefined);assert.equal(contexts,0);
});
