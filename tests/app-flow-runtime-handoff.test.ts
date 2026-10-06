import test from 'node:test';
import assert from 'node:assert/strict';
import {installPresentationRuntime} from '../src/server/app-flow/presentations-runtime.js';
import {bindPresentationSites} from '../src/server/app-flow/presentations-bindings.ts';
import {sharedLoopRuntime} from './app-flow-runtime-fixtures.ts';

async function fixture(t:test.TestContext,install=installPresentationRuntime) {
  function App(){}function MenuRoot(){}function Owner(){}function Item(){}function Dialog(){}
  const events:string[]=[],source=(line:number)=>({fileName:'/app/App.tsx',lineNumber:line,columnNumber:1});
  const loc=(line:number)=>({line,column:0,endLine:line,endColumn:80});
  let afterClose:(()=>void)|undefined;
  const canonical:any={currentProps:{onStateChange(){}}};
  const menu={open(){events.push('menu-open');canonical.currentProps.onStateChange({nativeEvent:{state:'open'}})},close(callback?:()=>void){events.push('menu-close');canonical.currentProps.onStateChange({nativeEvent:{state:'closing'}});afterClose=callback;}};
  const dialog={open(){events.push('dialog-open')},close(){events.push('dialog-close')}};
  const app:any={type:App,memoizedProps:{}};
  const parent:any={type:MenuRoot,memoizedProps:{control:menu},_debugSource:source(1),return:app};app.child=parent;
  const owner:any={type:Owner,memoizedProps:{},return:parent};parent.child=owner;
  const host:any={tag:5,type:'NativeSheet',memoizedProps:canonical.currentProps,stateNode:{canonical},return:owner};owner.child=host;
  const item:any={type:Item,memoizedProps:{onPress(){assert.fail('Never execute the event handler')}},dependencies:{firstContext:{memoizedValue:{control:menu},next:null}},_debugSource:source(3),return:host};host.child=item;
  const target:any={type:Dialog,memoizedProps:{control:dialog},_debugSource:source(4),return:owner};host.sibling=target;
  const hook:any={renderers:new Map(),onCommitFiberRoot(){}};
  const fibers=(visit:any,subtree?:any)=>{const stack=[subtree??app];while(stack.length){const fiber=stack.pop();if(fiber!==subtree&&fiber.sibling)stack.push(fiber.sibling);if(visit(fiber)!==false&&fiber.child)stack.push(fiber.child)}};
  const runtime=install({hook,fibers,hidden:()=>false,later:setTimeout});t.after(()=>runtime.cleanup());
  const actions:any[]=[{id:'parent',file:'App.tsx',line:1,owner:'App',component:'MenuRoot',prop:'',preview:true,effect:{kind:'control',component:'MenuRoot',prop:'control',method:'open',close:'close',target:{file:'App.tsx',owner:'App',line:1,source:loc(1)}}},
    {id:'child',file:'App.tsx',line:4,owner:'Owner',component:'Dialog',prop:'',preview:true,effect:{kind:'control',component:'Dialog',prop:'control',method:'open',close:'close',target:{file:'App.tsx',owner:'Owner',line:4,source:loc(4)}},handoffs:[{file:'App.tsx',owner:'Owner',component:'Item',prop:'onPress',source:loc(3),contextPath:['control'],close:'close'}]}];
  runtime.configure({states:[],actions},[]);const bindings=runtime.records(0).bindings;
  const matches=await bindPresentationSites('http://localhost:8082','/app',bindings,[],actions);
  runtime.configure({states:[],actions},matches,bindings.map(binding=>binding.id));
  return {runtime,events,app,parent,owner,host,item,target,hook,menu,dialog,actions,
    callback:()=>afterClose?.(),nativeClosed:()=>canonical.currentProps.onStateChange({nativeEvent:{state:'closed'}})};
}

for(const install of [installPresentationRuntime,sharedLoopRuntime()]) {
  const mode=install===installPresentationRuntime?'normal':'shared loops';
  test(`default capture waits for the exact parent callback and native dismissal (${mode})`,async t=>{
    const app=await fixture(t,install),runtime:any=app.runtime;
    assert.equal(runtime.open('parent').error,undefined);
    const pending=runtime.handoff('child',app.parent);let finished=false;void pending.then(()=>{finished=true});
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.deepEqual(app.events,['menu-open','menu-close']);assert.equal(finished,false);
    app.callback();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(finished,false,'A premature callback must not skip native dismissal');
    app.nativeClosed();const result=await pending;assert.equal(result.closed,true);assert.equal(result.focus,app.owner);
    assert.equal(runtime.open('child',app.parent).error,undefined);
    await runtime.rollback();
    assert.deepEqual(app.events,['menu-open','menu-close','dialog-open','dialog-close'],'Cleanup does not close the already dismissed parent again');
  });
  test(`a handoff requires the mounted source entry and matching context control (${mode})`,async t=>{
    const app=await fixture(t,install),runtime:any=app.runtime;runtime.open('parent');
    app.item.dependencies.firstContext.memoizedValue={control:{close(){assert.fail('Do not close an unrelated control')}}};
    assert.match((await runtime.handoff('child',app.parent)).error,/parent/);
    assert.deepEqual(app.events,['menu-open']);
    app.host.child=undefined;app.hook.onCommitFiberRoot();
    assert.match((await runtime.handoff('child',app.parent)).error,/entry/);
    assert.deepEqual(app.events,['menu-open']);
    app.nativeClosed();await runtime.rollback(0,false);
  });
  test(`cancelled handoff never authorizes opening its child (${mode})`,async t=>{
    const app=await fixture(t,install),runtime:any=app.runtime;runtime.open('parent');let cancelled=false;
    const pending=runtime.handoff('child',app.parent,()=>cancelled);
    cancelled=true;app.callback();app.nativeClosed();
    assert.match((await pending).error,/cancel/);
    assert.ok(!app.events.includes('dialog-open'));await runtime.rollback(0,false);
  });
}


for(const install of [installPresentationRuntime,sharedLoopRuntime()]) {
 const mode=install===installPresentationRuntime?'normal':'shared loops';
 test(`an unmounted handoff target cannot open after dismissal (${mode})`,async t=>{
   const app=await fixture(t,install),runtime:any=app.runtime;runtime.open('parent');
   const pending=runtime.handoff('child',app.parent);
   app.host.sibling=undefined;app.hook.onCommitFiberRoot();app.callback();app.nativeClosed();
   assert.match((await pending).error,/unmounted/);await runtime.rollback();
   assert.deepEqual(app.events,['menu-open','menu-close']);
 });
 test(`a failed handoff close preserves the parent's cleanup record (${mode})`,async t=>{
   const app=await fixture(t,install),runtime:any=app.runtime;runtime.open('parent');
   const close=app.menu.close;let calls=0;app.menu.close=(callback?:()=>void)=>{if(++calls===1)throw Error('native ref unavailable');close(callback)};
   await assert.rejects(runtime.handoff('child',app.parent),/native ref unavailable/);
   await runtime.rollback(0,false);app.nativeClosed();assert.equal(calls,2);
   assert.deepEqual(app.events,['menu-open','menu-close']);
 });
}
