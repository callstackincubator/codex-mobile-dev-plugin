import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installFlowRuntime } from '../src/server/app-flow/runtime.js';
import { WebSocketServer } from 'ws';
import { once } from 'node:events';
import { FlowConnection } from '../src/server/app-flow/connection.ts';
import { installPresentationRuntime } from '../src/server/app-flow/presentations-runtime.js';
import {FlowAppFailure,FlowRuntimeFailure,FlowRuntimeTimeout} from '../src/server/app-flow/runtime-metrics.ts';
import {sharedLoopRuntime} from './app-flow-runtime-fixtures.ts';

function runtime(t: test.TestContext, redirect = false, timers = {setTimeout, clearTimeout}, presentations: boolean | ((options:any)=>any) = false, globals = {}) {
  let state:any = {index:0,routeNames:['Home','Profile'],routes:[{name:'Home'}]};
  const original = state;
  const navigation = { getState:()=>state, isFocused:()=>true, dispatch(action:any){
    if(action.type==='NAVIGATE') state={...state,index:state.routes.length,routes:[...state.routes,{key:`route-${state.routes.length}`,name:action.payload.name,params:action.payload.params}]};
    else state={...action.payload,routeNames:['Home','Profile']};
    if(redirect){state.routes=[{name:'Login'}];state.index=0;}sync();
  } };
  const fiber:any = { memoizedProps:{ navigation, route:state.routes[0] }, tag:0 };
  const native:any = {tag:5,type:'View',memoizedProps:{children:'screen'},stateNode:{getBoundingClientRect:()=>({x:0,y:0,width:100,height:200})},return:fiber};
  fiber.child=native;
  function sync(){fiber.memoizedProps.route=state.routes[state.index ?? 0]}
  const context=vm.createContext({...timers,...globals,Date,Map,Set,JSON,Math,Object,Array,String,__REACT_DEVTOOLS_GLOBAL_HOOK__:{renderers:new Map([[1,{rendererPackageName:'react-native-renderer'}]]),getFiberRoots:()=>[{current:fiber}]}});
  vm.runInContext(`(${installFlowRuntime.toString()})('flow',5000,${typeof presentations==='function'?presentations.toString():presentations?installPresentationRuntime.toString():'undefined'})`,context);
  const invoke=(command:any)=>new Promise<any>(resolve=>context.flow.invoke(command,resolve));
  t.after(async()=>{if(context.flow)await invoke({type:'restore'})});
  return {context,invoke,getState:()=>state,original,navigation,fiber,native};
}

test('runtime finds mounted navigators, opens a target, and restores original state',async t=>{
  const app=runtime(t);
  const info=await app.invoke({type:'inspect'});
  assert.equal(info.available,true);
  assert.equal(info.registrations.length,2);
  const result=await app.invoke({type:'open',path:['Profile'],params:{id:'actual'},timeoutMs:300});
  assert.equal(result.ready,true);
  assert.equal(result.active[0],'Profile');
  assert.equal(app.getState().routes[app.getState().index].params.id,'actual');
  await app.invoke({type:'restore'});
  assert.equal(app.getState().routes[0].name,'Home');
  assert.equal(app.context.flow,undefined);
});

test('runtime rejects redirects and never reports a login screen as the target',async t=>{
  const app=runtime(t,true);
  const result=await app.invoke({type:'open',path:['Profile'],params:{id:'actual'},timeoutMs:90});
  assert.equal(result.ready,false);
  assert.match(result.reason,/redirected/);
});

test('a local form can remount its navigator without losing routes or the starting state',async t=>{
  const app=runtime(t);await app.invoke({type:'inspect'});
  await app.invoke({type:'open',path:['Profile'],timeoutMs:300});
  const live={...app.navigation};
  app.navigation.getState=()=>undefined;
  app.fiber.memoizedProps.navigation=live;
  const result=await app.invoke({type:'open',path:['Home'],timeoutMs:300});
  assert.equal(result.ready,true);assert.equal(result.active[0],'Home');
  await app.invoke({type:'restore'});
  assert.equal(app.getState().routes[0].name,'Home');
  assert.equal(app.getState().routes.length,1,'Rebinding preserves the original restoration snapshot');
});

test('a resumed runtime cancels old work and retains the original restoration state',async t=>{
  const app=runtime(t);
  await app.invoke({type:'inspect'});
  app.native.type='Skeleton';
  void app.invoke({type:'open',path:['Profile'],timeoutMs:200,loadingTimeoutMs:2000});
  await new Promise(resolve=>setTimeout(resolve,30));
  const resumed=await app.invoke({type:'resume'});
  assert.equal(resumed.available,true);
  app.native.type='View';
  const result=await app.invoke({type:'open',path:['Profile'],timeoutMs:300});
  assert.equal(result.ready,true);
  await app.invoke({type:'restore'});
  assert.equal(app.getState().routes[0].name,'Home');
});

for (const command of ['resume', 'restore']) {
  test(`${command} releases an in-flight presentation rollback before queuing another restore`, async t => {
    const scheduled = new Set<ReturnType<typeof setTimeout>>();
    const timers = {
      setTimeout(callback: (...args: any[]) => void, ms: number) {
        const timer = setTimeout(() => { scheduled.delete(timer); callback(); }, ms);
        scheduled.add(timer); return timer;
      },
      clearTimeout(timer: ReturnType<typeof setTimeout>) { scheduled.delete(timer); clearTimeout(timer); },
    };
    const app = runtime(t, false, timers, true);
    t.after(() => { for (const timer of scheduled) clearTimeout(timer); });
    await app.invoke({type: 'inspect'});
    const rollback = app.invoke({type: 'presentation-rollback'});
    // The empty rollback has released its native records, but still awaits its
    // final paint delay. Reconnect/restore must settle that cancelled delay.
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await app.invoke({type: 'diagnostics'})).waitTimers, 1);
    const next = app.invoke({type: command});
    let deadline: ReturnType<typeof setTimeout>;
    const result = await Promise.race([
      Promise.all([rollback, next]),
      new Promise<null>(resolve => { deadline = setTimeout(() => resolve(null), 400); }),
    ]);
    clearTimeout(deadline!);
    // A failing implementation must not hang this test's cleanup on the same
    // broken queue. Its tracked timers are cleared by the hook above.
    if (!result) app.context.flow = undefined;
    assert.ok(result, 'Cancelling a paint delay must release the serialized rollback queue');
    if (command === 'resume') {
      assert.equal(result[1].available, true);
      await app.invoke({type: 'presentation-rollback'});
      assert.equal((await app.invoke({type: 'heartbeat'})).alive, true);
    } else {
      assert.equal(result[1].restored, true);
      assert.equal(app.context.flow, undefined);
    }
  });
}

test('navigation diagnostics count retained stack routes without returning their names or params',async t=>{
  const app=runtime(t);await app.invoke({type:'inspect'});
  const state=app.getState();state.type='tab';state.routes.push({name:'private-route',params:{secret:'private-data'},state:{type:'stack',routes:[{name:'private-one'},{name:'private-two'}]}});
  const counts=await app.invoke({type:'diagnostics'});
  assert.equal(counts.navigationRoutes,4);assert.equal(counts.navigationStacks,1);assert.equal(counts.largestStack,2);
  assert.equal(counts.navigationTruncated,false);assert.equal(JSON.stringify(counts).includes('private'),false);
  state.routes.at(-1).state.routes[0].state=state;
  assert.equal((await app.invoke({type:'diagnostics'})).navigationRoutes,4,'Cycles do not repeat retained routes');
  delete state.routes.at(-1).state.routes[0].state;
});

test('focused lookup keeps scanning content and links after finding the first native bounds',async t=>{
  const app=runtime(t);
  const box=()=>({x:0,y:0,width:100,height:200});
  const loader:any={tag:0,type:{name:'Skeleton'},memoizedProps:{},return:app.fiber};
  loader.child={tag:5,type:'View',memoizedProps:{},stateNode:{getBoundingClientRect:box},return:loader};
  app.native.sibling=loader;
  // A second matching route must not replace the first, but its links remain
  // visible evidence. Bounds lookup must not hide a later loader in the target.
  app.fiber.sibling={tag:0,memoizedProps:{route:{name:'Home'},navigation:app.navigation,href:'/other'},child:{tag:5,type:'Text',memoizedProps:{children:'other screen'},stateNode:{getBoundingClientRect:box}}};
  let result=await app.invoke({type:'verify',name:'Home'});
  assert.equal(result.found,true);
  assert.equal(result.loading,true);
  assert.equal(result.loadingReason,'skeleton');
  assert.equal(result.hosts,2);
  assert.deepEqual(Array.from(result.links),['/other']);
  loader.memoizedProps.style={display:'none'};
  result=await app.invoke({type:'verify',name:'Home'});
  assert.equal(result.loading,false);
  assert.equal(result.hosts,1);
  assert.ok(result.signature.includes('screen'));
  assert.ok(!result.signature.includes('other screen'));
});

test('offscreen list batches do not change readiness, including flattened children',async t=>{
  const app=runtime(t);let y=500;
  const row:any={tag:5,type:'View',memoizedProps:{},stateNode:{getBoundingClientRect:()=>({x:0,y,width:100,height:50})},return:app.fiber};
  const text:any={tag:5,type:'Text',memoizedProps:{children:'offscreen row'},stateNode:{},return:row};row.child=text;app.native.sibling=row;
  const timer=setInterval(()=>{text.memoizedProps.children+='.'},10);t.after(()=>clearInterval(timer));
  const result=await app.invoke({type:'open',path:['Profile'],timeoutMs:300});
  assert.equal(result.ready,true);assert.ok(!result.signature.includes('offscreen row'));
  clearInterval(timer);y=100;
  const visible=await app.invoke({type:'verify',name:'Profile'});assert.ok(visible.signature.includes('offscreen row'));
  // Overflowing children can be visible while their parent is outside the view.
  y=500;text.stateNode={getBoundingClientRect:()=>({x:0,y:20,width:100,height:20})};
  assert.ok((await app.invoke({type:'verify',name:'Profile'})).signature.includes('offscreen row'));
});

test('presentation inspection reaches portal outlets beyond a large feed and uses their native bounds',async t=>{
  const app=runtime(t);await app.invoke({type:'restore'});
  const focus:any={type:function Sheet(){},memoizedProps:{},return:app.fiber};
  const bodyProps={children:'Sheet content'},bodyType=function PortalBody(){};
  focus.child={type:function Portal(){},memoizedProps:{children:{type:bodyType,props:bodyProps}},return:focus};
  app.native.sibling=focus;
  let tail=focus;
  for(let i=0;i<16020;i++){tail.sibling={tag:5,type:'View',memoizedProps:{},return:app.fiber};tail=tail.sibling;}
  const outlet:any={type:bodyType,memoizedProps:bodyProps,return:app.fiber};tail.sibling=outlet;
  const box=()=>({x:0,y:0,width:100,height:200});
  outlet.child={tag:5,type:'View',memoizedProps:{children:'Sheet content'},stateNode:{getBoundingClientRect:box},return:outlet};
  const loader:any={type:function Skeleton(){},memoizedProps:{},return:outlet};
  loader.child={tag:5,type:'View',memoizedProps:{},stateNode:{getBoundingClientRect:box},return:loader};outlet.child.sibling=loader;
  app.native.stateNode={getBoundingClientRect:()=>({x:0,y:5000,width:100,height:200})};
  app.context.focus=focus;
  vm.runInContext(`(${installFlowRuntime.toString()})('flow',5000,(options)=>{const p=(${installPresentationRuntime.toString()})(options);return {...p,open:()=>({name:'Sheet',focus})}})`,app.context);
  await app.invoke({type:'inspect'});await app.invoke({type:'presentation-open',id:'sheet'});
  let view=await app.invoke({type:'presentation-view'});
  assert.equal(view.found,true);assert.equal(view.loading,true);assert.equal(view.bounds.y,0);assert.equal(view.hosts,2);
  loader.memoizedProps.style={display:'none'};
  await app.invoke({type:'presentation-view'});await new Promise(resolve=>setTimeout(resolve,200));
  view=await app.invoke({type:'presentation-view'});assert.equal(view.ready,true);assert.equal(view.loading,false);
});

test('restoration waits for child sheet dismissal before resetting parent navigation',async t=>{
  const app=runtime(t);await app.invoke({type:'restore'});app.context.order=[];
  const dispatch=app.navigation.dispatch;app.navigation.dispatch=action=>{app.context.order.push('navigation');dispatch(action)};
  vm.runInContext(`(${installFlowRuntime.toString()})('flow',5000,()=>({checkpoint:()=>1,async rollback(){order.push('dismiss');await new Promise(resolve=>setTimeout(resolve,20));order.push('dismissed')},cleanup(){order.push('cleanup')}}))`,app.context);
  await app.invoke({type:'inspect'});await app.invoke({type:'restore'});
  assert.deepEqual(Array.from(app.context.order),['dismiss','dismissed','cleanup','navigation']);assert.equal(app.context.flow,undefined);
});

test('a failed presentation restore leaves the inspector available to retry cleanup',async t=>{
  const app=runtime(t);await app.invoke({type:'restore'});app.context.attempts=0;
  vm.runInContext(`(${installFlowRuntime.toString()})('flow',5000,()=>({checkpoint:()=>1,async rollback(){if(++attempts===1)throw Error('close failed')},cleanup(){}}))`,app.context);
  await app.invoke({type:'inspect'});
  assert.equal((await app.invoke({type:'restore'})).error,'App Flow restoration failed.');
  assert.equal((await app.invoke({type:'heartbeat'})).alive,true);
  assert.equal((await app.invoke({type:'restore'})).restored,true);
  assert.equal(app.context.flow,undefined);
});

test('diagnostics report bounded counts without traversing native layout or returning app content',async t=>{
  const app=runtime(t,false,{setTimeout,clearTimeout},true);
  app.native.stateNode.getBoundingClientRect=()=>{assert.fail('Diagnostic counters must not request native layout')};
  app.native.memoizedProps.children='private app content';
  const diagnostics=await app.invoke({type:'diagnostics'});
  assert.equal(diagnostics.mountedFibers,2);assert.equal(diagnostics.mountedHosts,1);
  assert.equal(diagnostics.presentations.bindings,0);
  assert.equal(JSON.stringify(diagnostics).includes('private'),false);
});

test('source previews wait for their proven body to mount instead of capturing the previous form',async t=>{
  const app=runtime(t);await app.invoke({type:'restore'});app.context.focus=app.fiber;
  vm.runInContext(`(${installFlowRuntime.toString()})('flow',5000,(options)=>{const p=(${installPresentationRuntime.toString()})(options);return {...p,open:()=>({name:'Wizard',focus,expected:'Verify'})}})`,app.context);
  await app.invoke({type:'inspect'});
  const opened=await app.invoke({type:'presentation-open',id:'verify'});
  assert.equal(opened.error,undefined);assert.equal(opened.ready,false);
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal((await app.invoke({type:'presentation-view'})).ready,false,'A stable old form is not the expected body');
  const verified:any={type:function Verify(){},memoizedProps:{},return:app.fiber,child:app.native};
  app.native.return=verified;app.fiber.child=verified;
  assert.equal((await app.invoke({type:'presentation-view'})).ready,false);
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal((await app.invoke({type:'presentation-view'})).ready,true);
});

test('deferred presentation inspection errors reply to the mapper without escaping into the app',async t=>{
  const app=runtime(t);await app.invoke({type:'restore'});app.context.focus=app.fiber;
  vm.runInContext(`(${installFlowRuntime.toString()})('flow',5000,()=>({
    open:()=>({focus,expected:'Next'}),project:()=>({}),
    focusFor(){throw Error('private inspection failure')},visualFocus:focus=>focus,
    checkpoint:()=>0,focused(){},cleanup(){},rollback:async()=>{}
  }))`,app.context);
  await app.invoke({type:'inspect'});
  for(const type of ['presentation-open','presentation-project']){
    const result=await app.invoke({type,id:'next'});
    assert.equal(result.error,'Presentation inspection is unavailable.');
    assert.equal(result.detail,'private inspection failure');
    assert.equal((await app.invoke({type:'heartbeat'})).alive,true);
  }
});

test('runtime strips credentials from observed route data',async t=>{
  const app=runtime(t);
  await app.invoke({type:'open',path:['Profile'],params:{id:'real',accessToken:'secret',password:'secret',nested:{cookie:'secret',id:'safe'}},timeoutMs:300});
  const info=await app.invoke({type:'inspect'});
  const text=JSON.stringify(info);
  assert.equal(text.includes('secret'),false);
  assert.ok(text.includes('real'));
});

test('context refresh reads newly cached records without navigation, layout, getters, or refetching', async t => {
  const app = runtime(t);
  let data: any = {id: 'old-record'}, reads = 0;
  const queries = [{queryKey: ['records'], state: {get data() { assert.fail('Query data accessor must stay unread'); }}},
    {queryKey: ['records'], state: {data}}];
  const client = {getQueryCache() { reads++; return {getAll: () => queries}; }, refetchQueries() { assert.fail('Cache refresh must not fetch'); }};
  app.fiber.memoizedProps.client = client;
  app.navigation.getState = () => { assert.fail('Context refresh must not inspect navigation'); };
  app.navigation.isFocused = () => { assert.fail('Context refresh must not change focus'); };
  app.navigation.dispatch = () => { assert.fail('Context refresh must not navigate'); };
  app.native.stateNode.getBoundingClientRect = () => { assert.fail('Context refresh must not inspect layout'); };
  assert.equal((await app.invoke({type: 'context-data'})).data[0].value.id, 'old-record');
  const records: any[] = [{id: 'new-record', password: 'private', nested: {authorization: 'private', id: 'safe'}}];
  Object.defineProperty(records, '1', {get() { assert.fail('Array accessors must stay unread'); }, enumerable: true});
  data = {records, accessToken: 'private', get dangerous() { assert.fail('Object accessors must stay unread'); }};
  queries[1].state = {data};
  const snapshot = await app.invoke({type: 'context-data'});
  assert.equal(snapshot.data[0].value.records[0].id, 'new-record');
  assert.equal(snapshot.data[0].value.records[0].nested.id, 'safe');
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
  assert.equal(reads, 2);
  assert.equal((await app.invoke({type: 'heartbeat'})).alive, true);
});

test('recording observes local forms without a navigator and waits for their loading state', async t => {
  const app = runtime(t);
  app.fiber.memoizedProps = {};
  app.fiber.type = function LoginForm() {};
  app.native.memoizedProps = {children:'Sign in', accessibilityRole:'header'};
  let view = await app.invoke({type:'observe'});
  assert.equal(view.ready,false);
  await new Promise(resolve => setTimeout(resolve,190));
  view = await app.invoke({type:'observe'});
  assert.equal(view.ready,true);
  assert.equal(view.title,'Sign in');
  assert.deepEqual(Array.from(view.active),[]);
  const loginKey = view.key;
  app.fiber.type = function ResetForm() {};
  app.native.memoizedProps = {children:'Reset password', accessibilityState:{busy:true}};
  view = await app.invoke({type:'observe'});
  assert.equal(view.ready,false);
  assert.notEqual(view.key,loginKey);
  app.native.memoizedProps.accessibilityState.busy = false;
  await app.invoke({type:'observe'});
  await new Promise(resolve => setTimeout(resolve,190));
  assert.equal((await app.invoke({type:'observe'})).ready,true);
});

test('recording never restores navigation after a user changes auth state, and blocks navigation commands', async t => {
  const app = runtime(t);
  const actions:any[] = [];
  const dispatch = app.navigation.dispatch;
  app.navigation.dispatch = action => {actions.push(action);dispatch(action)};
  await app.invoke({type:'observe'});
  // The user navigates or completes login during recording.
  dispatch({type:'NAVIGATE',payload:{name:'Profile'}});
  const result = await app.invoke({type:'open',path:['Home'],timeoutMs:200});
  assert.match(result.error,/navigation commands are disabled/);
  await app.invoke({type:'restore'});
  assert.deepEqual(actions,[]);
  assert.equal(app.getState().routes[app.getState().index].name,'Profile');
  assert.equal(app.context.flow,undefined);
});

test('recording gives a visible modal priority over background content and loaders', async t => {
  const app = runtime(t);
  app.native.memoizedProps.accessibilityState = {busy:true};
  const modal:any = {tag:0,type:function Modal(){},memoizedProps:{visible:true},child:{tag:5,type:'View',memoizedProps:{children:'Sign in',accessibilityRole:'header'},stateNode:app.native.stateNode}};
  app.fiber.sibling = modal;
  await app.invoke({type:'observe'});
  await new Promise(resolve => setTimeout(resolve,190));
  const view = await app.invoke({type:'observe'});
  assert.equal(view.ready,true);
  assert.equal(view.title,'Sign in');
  assert.equal(view.loading,false);
});

test('persistent CDP connection uses binding replies and renews the runtime lease', {timeout: 5000}, async t=>{
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});
  await once(server,'listening');
  t.after(()=>new Promise<void>(resolve=>{for(const client of server.clients)client.terminate();server.close(()=>resolve())}));
  let binding='',requests=0;
  let heartbeatReceived!: () => void;
  const heartbeat = new Promise<void>(resolve => { heartbeatReceived = resolve; });
  server.on('connection',socket=>socket.on('message',bytes=>{
    const message=JSON.parse(bytes.toString());requests++;
    if(message.method==='Runtime.addBinding')binding=message.params.name;
    if(message.params?.expression?.includes('"heartbeat"'))heartbeatReceived();
    socket.send(JSON.stringify({id:message.id,result:{result:{type:'undefined'}}}));
    if(message.id<0)setTimeout(()=>socket.send(JSON.stringify({method:'Runtime.bindingCalled',params:{name:binding,payload:JSON.stringify({id:message.id,result:{available:true,marker:message.id}})}})),10);
  }));
  const address=server.address() as {port:number};
  const connection=new FlowConnection(`ws://127.0.0.1:${address.port}`);
  const first=await connection.invoke({type:'inspect'});
  const second=await connection.invoke({type:'inspect'});
  assert.equal(first.available,true);
  assert.ok(second.marker<first.marker);
  assert.equal(server.clients.size,1);
  await heartbeat;
  await connection.close();
  assert.ok(requests>=6);
});

test('reconnections isolate late replies and release debugger objects without restoring between sockets',async t=>{
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});await once(server,'listening');
  t.after(()=>new Promise<void>(resolve=>{for(const socket of server.clients)socket.terminate();server.close(()=>resolve())}));
  const bindings:string[]=[],evaluations:any[]=[],released:string[]=[];
  let restores=0;
  server.on('connection',socket=>{
    let binding='';
    socket.on('message',bytes=>{
      const message=JSON.parse(bytes.toString());
      if(message.method==='Runtime.addBinding'){binding=message.params.name;bindings.push(binding)}
      if(message.method==='Runtime.releaseObjectGroup')released.push(message.params.objectGroup);
      if(message.method==='Runtime.evaluate')evaluations.push(message.params);
      if(message.id>0)socket.send(JSON.stringify({id:message.id,result:{}}));
      if(message.id<0){
        if(message.params.expression.includes('"restore"'))restores++;
        if(bindings.length>1)socket.send(JSON.stringify({method:'Runtime.bindingCalled',params:{name:bindings[0],payload:JSON.stringify({id:message.id,result:{stale:true}})}}));
        socket.send(JSON.stringify({method:'Runtime.bindingCalled',params:{name:binding,payload:JSON.stringify({id:message.id,result:{available:true}})}}));
      }
    });
  });
  const address=server.address() as {port:number},url=`ws://127.0.0.1:${address.port}`,session='same-run';
  const first=new FlowConnection(url,session);
  await first.invoke({type:'inspect'});await first.close({restore:false});
  const next=new FlowConnection(url,session);
  const result=await next.invoke({type:'resume'});
  assert.deepEqual(result,{available:true});assert.equal(restores,0);assert.notEqual(bindings[0],bindings[1]);
  await next.close();await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(restores,1);assert.deepEqual(released,['__mobile_flow_samerun','__mobile_flow_samerun']);
  assert.ok(evaluations.every(params=>params.returnByValue===true));
});

test('runtime acknowledgements identify the stalled step and missing inspectors fail immediately',async t=>{
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});await once(server,'listening');
  t.after(()=>new Promise<void>(resolve=>{for(const socket of server.clients)socket.terminate();server.close(()=>resolve())}));
  let binding='';
  server.on('connection',socket=>socket.on('message',bytes=>{
    const message=JSON.parse(bytes.toString());
    if(message.method==='Runtime.addBinding')binding=message.params.name;
    socket.send(JSON.stringify({id:message.id,result:{}}));
    if(message.id<0&&message.params.expression.includes('"heartbeat"'))vm.runInNewContext(message.params.expression,{[binding]:(payload:string)=>socket.send(JSON.stringify({method:'Runtime.bindingCalled',params:{name:binding,payload}}))});
  }));
  const address=server.address()as {port:number},connection=new FlowConnection(`ws://127.0.0.1:${address.port}`);
  t.after(()=>connection.close({restore:false}));
  await assert.rejects(connection.invoke({type:'presentation-collect'},20),error=>error instanceof FlowRuntimeTimeout&&/collecting presentation bindings/.test(error.message));
  await assert.rejects(connection.invoke({type:'heartbeat'},200),/inspector is no longer installed/);
});

test('presentation setup stops on a failed collection and names rejected or malformed stages',async t=>{
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});await once(server,'listening');
  t.after(()=>new Promise<void>(resolve=>{for(const socket of server.clients)socket.terminate();server.close(()=>resolve())}));
  const commands:string[]=[];let failing='presentation-collect';
  server.on('connection',socket=>{
    let binding='';
    socket.on('message',bytes=>{
      const message=JSON.parse(bytes.toString());
      if(message.method==='Runtime.addBinding')binding=message.params.name;
      if(message.id>0){socket.send(JSON.stringify({id:message.id,result:{}}));return;}
      vm.runInNewContext(message.params.expression,{
        [message.params.objectGroup]:{invoke(command:any,reply:any){commands.push(command.type);reply(command.type===failing?{error:'private app exception'}:command.type==='presentation-collect'?{bindings:[]}:{})}},
        [binding]:(payload:string)=>socket.send(JSON.stringify({method:'Runtime.bindingCalled',params:{name:binding,payload}})),
      });
    });
  });
  const address=server.address()as {port:number},connection=new FlowConnection(`ws://127.0.0.1:${address.port}`);
  t.after(()=>connection.close({restore:false}));
  const setup={type:'presentation-setup',projectRoot:'/app',catalog:{states:[],actions:[]}};
  await assert.rejects(connection.invoke(setup),error=>error instanceof FlowRuntimeFailure&&error.operation==='presentation-collect'&&!error.message.includes('private')&&error.detail==='private app exception');
  assert.deepEqual(commands,['presentation-collect'],'A failed collection must never bind an empty catalog');
  failing='presentation-configure';
  await assert.rejects(connection.invoke(setup),error=>error instanceof FlowRuntimeFailure&&error.operation==='presentation-configure');
  failing='none';
  await assert.rejects(connection.invoke({type:'presentations'}),error=>error instanceof FlowRuntimeFailure&&error.operation==='presentations'&&/invalid response/.test(error.message));
});

test('a connection sends presentation plans once and fresh connections seed their own runtime',async t=>{
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});await once(server,'listening');
  t.after(()=>new Promise<void>(resolve=>{for(const socket of server.clients)socket.terminate();server.close(()=>resolve())}));
  const commands:any[]=[];
  server.on('connection',socket=>{
    let binding='';
    socket.on('message',bytes=>{
      const message=JSON.parse(bytes.toString());if(message.method==='Runtime.addBinding')binding=message.params.name;
      if(message.id>0){socket.send(JSON.stringify({id:message.id,result:{}}));return;}
      vm.runInNewContext(message.params.expression,{
        [message.params.objectGroup]:{invoke(command:any,reply:any){commands.push(command);reply(command.type==='presentation-collect'?{bindings:[]}:{})}},
        [binding]:(payload:string)=>socket.send(JSON.stringify({method:'Runtime.bindingCalled',params:{name:binding,payload}})),
      });
    });
  });
  const address=server.address()as {port:number},url=`ws://127.0.0.1:${address.port}`;
  const catalog={states:[],actions:[{id:'immutable',effect:{kind:'state'}}]};
  const command={type:'presentation-setup',projectRoot:'/app',catalog};
  const first=new FlowConnection(url);t.after(()=>first.close({restore:false}));
  await first.invoke(command);await first.invoke(command);await first.close({restore:false});
  const next=new FlowConnection(url);t.after(()=>next.close({restore:false}));await next.invoke(command);
  const collections=commands.filter(command=>command.type==='presentation-collect');
  assert.deepEqual(collections.map(command=>command.actions?.length),[1,undefined,1]);
  assert.deepEqual(collections.map(command=>command.projectRoot),['/app',undefined,'/app']);
  assert.ok(commands.filter(command=>command.type==='presentation-configure').every(command=>command.catalog===undefined));
});


test('runtime forwards the project root to presentation collection',async t=>{
  const app=runtime(t,false,{setTimeout,clearTimeout},function(){return {collect(states,actions,projectRoot){return Promise.resolve({projectRoot,states,actions})},checkpoint(){return 0},cleanup(){},rollback(){return Promise.resolve()}}});
  const result=await app.invoke({type:'presentation-collect',states:[],actions:[],projectRoot:'/workspace/demo'});
  assert.equal(result.projectRoot,'/workspace/demo');
});

test('recovery releases a cancelled collection wait and restores React exports', {timeout:1000}, async t=>{
  const app=runtime(t,false,{setTimeout,clearTimeout},true);
  app.fiber.type=function Home(){};
  const react={createElement(){},useState(){return [0,()=>{}]},useReducer(){return [0,()=>{}]}};
  const original=react.useState;
  app.context.__r={getModules:()=>new Map([[1,{isInitialized:true,publicModule:{exports:react}}]])};
  app.context.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.get(1).scheduleUpdate=()=>{};
  const pending=app.invoke({type:'presentation-collect',states:[{id:'local-state',owner:'Home'}],actions:[]});
  assert.notEqual(react.useState,original);
  await app.invoke({type:'resume'});
  await pending;
  assert.equal(react.useState,original);
});


test('runtime lease renews beyond 30 seconds and restores after heartbeats stop', async t => {
  let now = 0, sequence = 0;
  const timers = new Map<number, {at: number; callback: () => void}>();
  const app = runtime(t, false, {
    setTimeout: ((callback: () => void, ms: number) => {
      const id = ++sequence; timers.set(id, {at: now + ms, callback}); return id;
    }) as unknown as typeof setTimeout,
    clearTimeout: ((id: number) => { timers.delete(id); }) as unknown as typeof clearTimeout,
  });
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  };
  await app.invoke({type: 'inspect'});
  app.navigation.dispatch({payload: {index: 0, routes: [{name: 'Profile'}]}});
  for (let i = 0; i < 20; i++) {
    advance(2000);
    assert.ok(app.context.flow);
    assert.equal((await app.invoke({type: 'heartbeat'})).alive, true);
  }
  assert.equal(timers.size, 1);
  advance(5000);
  assert.equal(app.context.flow, undefined);
  assert.equal(app.getState().routes[0].name, 'Home');
  assert.equal(timers.size, 0);
});

test('recovery restores the starting stack without ending the runtime session', async t => {
  const app=runtime(t);
  await app.invoke({type:'open',path:['Profile'],params:{id:'real'},timeoutMs:300});
  assert.deepEqual(Array.from(app.getState().routes,(r:any)=>r.name),['Home','Profile']);
  await app.invoke({type:'recover'});
  assert.equal(app.getState().routes[0].name,'Home');
  assert.equal((await app.invoke({type:'heartbeat'})).alive,true);
});

test('long screens cap host layout reads while retaining late loaders, queries, headings and opacity',async t=>{
  const app=runtime(t);let measured=0;
  const box=()=>{measured++;return {x:0,y:0,width:100,height:200}};
  app.native.stateNode={getBoundingClientRect:box};
  let tail=app.native;
  for(let i=1;i<1000;i++){
    const host:any={tag:5,type:'Text',memoizedProps:{children:`row ${i}`},stateNode:{getBoundingClientRect:box},return:app.fiber};
    tail.sibling=host;tail=host;
  }
  let view=await app.invoke({type:'verify',name:'Home'});
  assert.equal(measured,250);assert.equal(JSON.parse(view.signature).length,250);
  const signature=view.signature;
  const heading:any={tag:5,type:'Text',memoizedProps:{children:'Late heading',accessibilityRole:'header'},stateNode:{getBoundingClientRect:box},return:app.fiber};
  tail.sibling=heading;
  measured=0;view=await app.invoke({type:'presentation-view'});
  assert.equal(view.title,'Late heading');assert.equal(measured,251);assert.equal(view.signature,signature);
  const loader:any={tag:0,type:function Skeleton(){},memoizedProps:{},return:app.fiber,child:{tag:5,type:'View',memoizedProps:{},stateNode:{getBoundingClientRect:box}}};
  heading.sibling=loader;
  assert.equal((await app.invoke({type:'verify',name:'Home'})).loading,true,'Loaders after the signature cap still block');
  loader.type=function QueryView(){};loader.memoizedState={memoizedState:{data:undefined,status:'pending',fetchStatus:'fetching'}};
  assert.equal((await app.invoke({type:'verify',name:'Home'})).loadingReason,'data');
  loader.memoizedState=null;
  let opacity=.2;loader.memoizedProps={style:opacityStyle({_isReanimatedSharedValue:true,getSync:()=>opacity})};
  const first=await app.invoke({type:'verify',name:'Home'});opacity=.8;
  const second=await app.invoke({type:'verify',name:'Home'});
  assert.notEqual(first.motion,second.motion,'A late native fade still changes the signature');
});

test('an unchanged skeleton waits beyond the fast deadline and captures as soon as content replaces it', async t => {
  const app=runtime(t);
  const skeleton:any={tag:0,type:function ProfileSkeleton(){},memoizedProps:{},child:{tag:5,type:'View',memoizedProps:{},stateNode:app.native.stateNode}};
  app.native.sibling=skeleton;
  const timer=setTimeout(()=>{app.native.sibling=undefined;app.native.memoizedProps.children='Loaded profile'},350);
  t.after(()=>clearTimeout(timer));
  const result=await app.invoke({type:'open',path:['Profile'],timeoutMs:150,loadingTimeoutMs:1200});
  assert.equal(result.ready,true);
  assert.ok(result.loadingMs>=300);
  assert.ok(result.readinessMs<1000,'should finish when content is ready instead of waiting out the loading deadline');
  assert.ok(result.signature.includes('Loaded profile'));
});

test('busy accessibility state and Suspense fallbacks are not saved as finished screens', async t => {
  const app=runtime(t);
  for (const state of ['busy','suspense']) {
    app.native.memoizedProps.accessibilityState={busy:state==='busy'};
    app.native.sibling=state==='suspense'?{tag:13,memoizedProps:{},memoizedState:{},child:{...app.native,sibling:undefined}}:undefined;
    const result=await app.invoke({type:'open',path:['Profile'],timeoutMs:80,loadingTimeoutMs:140});
    assert.equal(result.ready,false);
    assert.match(result.reason,new RegExp(state));
  }
});

test('only visible initial query loads block capture; cached refetches and offscreen loaders do not', async t => {
  const app=runtime(t);
  let data:any=undefined;
  app.fiber.memoizedState={memoizedState:{getCurrentQuery(){return{}},getCurrentResult(){return {data,isPending:!data,fetchStatus:'fetching'}}}};
  let result=await app.invoke({type:'open',path:['Profile'],timeoutMs:80,loadingTimeoutMs:140});
  assert.equal(result.ready,false);assert.match(result.reason,/data/);
  data={loaded:true};
  app.native.sibling={tag:0,type:function Skeleton(){},memoizedProps:{},child:{tag:5,memoizedProps:{},stateNode:{getBoundingClientRect:()=>({x:0,y:500,width:100,height:50})}}};
  result=await app.invoke({type:'open',path:['Profile'],timeoutMs:500});
  assert.equal(result.ready,true);
  assert.equal(result.loadingMs,0);
  // A spinner switched off by its caller is not an active loading indicator.
  app.native.sibling={tag:0,type:function ActivityIndicator(){},memoizedProps:{animating:false},child:{tag:5,memoizedProps:{animating:false},stateNode:app.native.stateNode}};
  assert.equal((await app.invoke({type:'verify',name:'Profile'})).loading,false);
  app.native.sibling={tag:0,memoizedProps:{isPageFocused:false},child:{tag:0,type:function Skeleton(){},memoizedProps:{},child:{tag:5,memoizedProps:{},stateNode:app.native.stateNode}}};
  assert.equal((await app.invoke({type:'verify',name:'Profile'})).loading,false,'an inactive pager can report onscreen Yoga bounds');
  app.native.sibling={tag:0,type:function LoadingPlaceholder(){},memoizedProps:{},child:null};
  assert.equal((await app.invoke({type:'verify',name:'Profile'})).loading,false,'a loading component that returns null is not visible');
});

function pagedContent(app: ReturnType<typeof runtime>) {
  const pager:any = {tag:5,type:'NativePager',memoizedProps:{initialPage:0,onPageSelected(){},onPageScroll(){}},stateNode:app.native.stateNode,return:app.fiber};
  const first:any = {tag:5,type:'View',memoizedProps:{},return:pager};
  const second:any = {tag:5,type:'View',memoizedProps:{},return:pager};
  const selected:any = {tag:0,memoizedProps:{active:true},return:first,child:app.native};
  const inactive:any = {tag:0,memoizedProps:{active:false},return:second};
  const placeholder:any = {tag:0,memoizedProps:{isLoading:true},return:inactive};
  placeholder.child = {tag:5,type:'View',memoizedProps:{children:'Loading hidden page'},stateNode:app.native.stateNode,return:placeholder};
  app.fiber.child=pager; pager.child=first; first.sibling=second;
  first.child=selected; second.child=inactive; inactive.child=placeholder; app.native.return=selected;
  return {selected,inactive,placeholder};
}

test('inactive native pager pages do not block capture at overlapping native bounds', async t => {
  const app=runtime(t);
  const {inactive}=pagedContent(app);
  for (const flag of ['active','isActive','isPageActive','tabActive']) {
    inactive.memoizedProps={[flag]:false};
    const view=await app.invoke({type:'verify',name:'Home'});
    assert.equal(view.loading,false);
    assert.ok(!view.signature.includes('Loading hidden page'));
  }
  const result=await app.invoke({type:'open',path:['Profile'],timeoutMs:500,loadingTimeoutMs:2000});
  assert.equal(result.ready,true);
  assert.equal(result.loadingMs,0);
  assert.ok(result.readinessMs<500);
  const view=await app.invoke({type:'observe'});
  assert.equal(view.loading,false,'recording uses the same page visibility checks');
  assert.ok(!view.signature.includes('Loading hidden page'));
});

test('switching to a loading pager page waits until its content is ready', async t => {
  const app=runtime(t);
  const {selected,inactive,placeholder}=pagedContent(app);
  selected.memoizedProps.active=false; inactive.memoizedProps.active=true;
  const loading=await app.invoke({type:'open',path:['Profile'],timeoutMs:80,loadingTimeoutMs:140});
  assert.equal(loading.ready,false);
  assert.match(loading.reason,/busy/);
  const timer=setTimeout(()=>{placeholder.memoizedProps.isLoading=false;placeholder.child.memoizedProps.children='Loaded selected page'},180);
  t.after(()=>clearTimeout(timer));
  const ready=await app.invoke({type:'open',path:['Profile'],timeoutMs:80,loadingTimeoutMs:1000});
  assert.equal(ready.ready,true);
  assert.ok(ready.loadingMs>=180);
  assert.ok(ready.signature.includes('Loaded selected page'));
  assert.ok(!ready.signature.includes('screen'));
});

test('inactive controls and content outside native page boundaries still block on visible loaders', async t => {
  const app=runtime(t);
  app.native.memoizedProps={children:'Loading',active:false,accessibilityState:{busy:true}};
  assert.equal((await app.invoke({type:'verify',name:'Home'})).loading,true);
  pagedContent(app);
  // This is one control among the page's content, not the whole page.
  app.native.sibling={tag:5,type:'Text',memoizedProps:{children:'Other content'},stateNode:app.native.stateNode,return:app.native.return};
  assert.equal((await app.invoke({type:'verify',name:'Home'})).loading,true);
});

function opacityStyle(source: any) {
  const updater=Object.assign(()=>{assert.fail('App style updaters must never execute during inspection')},{__closure:{source}});
  return {viewDescriptors:{},initial:{value:{opacity:0},updater}};
}

test('native opacity changes delay readiness even when React content stays unchanged', async t => {
  const app=runtime(t), source={_isReanimatedSharedValue:true,value:0};
  const style=opacityStyle(source);
  // Current Worklets versions expose the shared value through a closure getter.
  Object.defineProperty(style.initial.updater.__closure,'source',{get:()=>source});
  app.fiber.memoizedProps.style=style;
  app.native.memoizedProps.style={opacity:0};
  // The React host props keep the initial opacity while the native view animates.
  app.native.sibling={tag:5,type:'Text',memoizedProps:{children:'Header'},stateNode:app.native.stateNode,return:app.fiber};
  const interval=setInterval(()=>{source.value=Math.min(1,source.value+.25)},55);
  t.after(()=>clearInterval(interval));
  const result=await app.invoke({type:'open',path:['Profile'],timeoutMs:700});
  assert.equal(result.ready,true);
  assert.equal(result.motion,'[1]');
  assert.ok(result.readinessMs>=220);
  assert.ok(result.readinessMs<650);
  assert.ok(result.signature.includes('Header'));
});

test('opacity inputs read once per sample, ignore offscreen views, and allow settled translucency', async t => {
  const app=runtime(t);let reads=0;
  const source={_isReanimatedSharedValue:true,getSync(){reads++;return .45}};
  const style=opacityStyle(source);
  app.fiber.memoizedProps.style=style;app.native.memoizedProps.style=style;
  let view=await app.invoke({type:'verify',name:'Home'});
  assert.equal(view.motion,'[0.45]');assert.equal(reads,1);
  app.native.sibling={tag:5,type:'View',memoizedProps:{style:opacityStyle({_isReanimatedSharedValue:true,getSync(){assert.fail('Offscreen opacity must not be read')}})},stateNode:{getBoundingClientRect:()=>({x:0,y:500,width:100,height:100})}};
  const result=await app.invoke({type:'open',path:['Profile'],timeoutMs:500});
  assert.equal(result.ready,true);assert.equal(result.motion,'[0.45]');
  app.native.memoizedProps.style=undefined;app.fiber.memoizedProps.style=undefined;
  view=await app.invoke({type:'verify',name:'Profile'});
  assert.equal(view.motion,undefined);
});

test('stopping during loading cancels polling and the restoration watchdog', async t => {
  let sequence=0;const timers=new Map<number,()=>void>();
  const app=runtime(t,false,{
    setTimeout:((callback:()=>void)=>{const id=++sequence;timers.set(id,callback);return id}) as unknown as typeof setTimeout,
    clearTimeout:((id:number)=>{timers.delete(id)}) as unknown as typeof clearTimeout,
  });
  app.native.memoizedProps.accessibilityState={busy:true};
  void app.invoke({type:'open',path:['Profile'],timeoutMs:100,loadingTimeoutMs:6000});
  assert.ok(timers.size>1);
  await app.invoke({type:'restore'});
  assert.equal(timers.size,0);
});

test('fatal RN errors reject in-flight and later captures while preserving error handling and cleanup',async t=>{
  const forwarded:any[]=[];
  const receiver={};
  const original=function(this:unknown,...args:unknown[]){forwarded.push([this,...args]);return 'handled'};
  let handler=original;
  const ErrorUtils={getGlobalHandler:()=>handler,setGlobalHandler:(value:typeof original)=>{handler=value}};
  const app=runtime(t,false,undefined,true,{ErrorUtils});
  const warning=Error('nonfatal');
  assert.equal(handler.call(receiver,warning,false),'handled');
  assert.equal((await app.invoke({type:'inspect'})).available,true);
  const opening=app.invoke({type:'open',path:['Profile'],timeoutMs:1000});
  const fatal=Error('private app error');
  assert.equal(handler.call(receiver,fatal,true),'handled');
  assert.equal((await opening).appFailed,true);
  for(const type of ['verify','presentation-view','presentation-open','resume']){
    const result=await app.invoke({type});
    assert.equal(result.appFailed,true);assert.equal(result.error,undefined,'No app error text leaves the observer');
  }
  assert.equal((await app.invoke({type:'heartbeat'})).alive,true);
  await app.invoke({type:'presentation-rollback'});
  await app.invoke({type:'restore'});
  assert.equal(handler,original);
  assert.deepEqual(forwarded,[[receiver,warning,false],[receiver,fatal,true]]);
  assert.equal(app.getState().routes[0].name,'Home');
});

test('runtime cleanup does not replace an error handler installed later by the app',async t=>{
  let handler=()=>{};
  const ErrorUtils={getGlobalHandler:()=>handler,setGlobalHandler:(value:typeof handler)=>{handler=value}};
  const app=runtime(t,false,undefined,false,{ErrorUtils});
  const next=()=>{};handler=next;
  await app.invoke({type:'restore'});assert.equal(handler,next);
});

test('CDP binding replies turn a fatal app error into a fixed capture failure',async t=>{
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});await once(server,'listening');
  t.after(()=>new Promise<void>(resolve=>{for(const client of server.clients)client.terminate();server.close(()=>resolve())}));
  let binding='';
  server.on('connection',socket=>socket.on('message',bytes=>{
    const message=JSON.parse(bytes.toString());
    if(message.method==='Runtime.addBinding')binding=message.params.name;
    socket.send(JSON.stringify({id:message.id,result:{result:{type:'undefined'}}}));
    if(message.id<0)socket.send(JSON.stringify({method:'Runtime.bindingCalled',params:{name:binding,payload:JSON.stringify({id:message.id,result:{appFailed:true}})}}));
  }));
  const address=server.address()as {port:number},connection=new FlowConnection(`ws://127.0.0.1:${address.port}`);
  await assert.rejects(connection.invoke({type:'verify'}),error=>error instanceof FlowAppFailure&&error.operation==='verify'&&error.detail===undefined);
  await connection.close();
});


test('readiness diagnostics separate native layout work from the tree scan',async t=>{
  const app=runtime(t);
  await app.invoke({type:'verify',name:'Home'});
  const {lastProbe}=await app.invoke({type:'diagnostics'});
  assert.equal(lastProbe.layoutReads,1);assert.equal(lastProbe.opacityReads,0);assert.equal(lastProbe.fibers,2);
  assert.ok(lastProbe.totalMs>=lastProbe.layoutMs);assert.equal(Object.keys(lastProbe).length,5);
});


test('a detached busy navigator cannot keep its replacement waiting forever',async t=>{
  const app=runtime(t),listeners=new Map<string,()=>void>(),removed:string[]=[];
  (app.navigation as any).addListener=(event:string,listener:()=>void)=>{listeners.set(event,listener);return ()=>removed.push(event)};
  await app.invoke({type:'inspect'});listeners.get('transitionStart')!();
  app.fiber.memoizedProps.navigation={...app.navigation,addListener(){return ()=>{}}};
  const opened=await app.invoke({type:'open',path:['Profile'],timeoutMs:500});
  assert.equal(opened.ready,true);assert.deepEqual(removed,['transitionStart','transitionEnd']);
});

test('a mounted native transition still blocks readiness until its end event',async t=>{
  const app=runtime(t),listeners=new Map<string,()=>void>();
  (app.navigation as any).addListener=(event:string,listener:()=>void)=>{listeners.set(event,listener);return ()=>{}};
  await app.invoke({type:'inspect'});listeners.get('transitionStart')!();
  let completed=false;
  const timer=setTimeout(()=>{completed=true;listeners.get('transitionEnd')!()},160);t.after(()=>clearTimeout(timer));
  const opened=await app.invoke({type:'open',path:['Profile'],timeoutMs:700});
  assert.equal(completed,true);assert.equal(opened.ready,true);assert.ok(opened.readinessMs>=160);
});


test('presentation readiness checks the expected logical owner before inspecting its portal body',async t=>{
  const factory=()=>({
    open(){return {focus:(globalThis as any).logical,expected:'Sheet'};},
    visualFocus(){return (globalThis as any).portal;},
    focusFor(_name:any,scope:any){return scope===(globalThis as any).logical?scope:undefined;},
    motion(){return {pending:false,signature:'[]'};},focused(){},checkpoint(){return 0;},cleanup(){},
  });
  const app=runtime(t,false,undefined,factory);
  app.context.logical=app.fiber;
  const body:any={type:function PortalBody(){},memoizedProps:{},return:app.fiber};
  const host:any={tag:5,type:'Text',memoizedProps:{children:'Loaded sheet'},stateNode:app.native.stateNode,return:body};body.child=host;app.native.sibling=body;app.context.portal=body;
  await app.invoke({type:'presentation-open',id:'sheet'});
  await new Promise(resolve=>setTimeout(resolve,200));
  const view=await app.invoke({type:'presentation-view'});
  assert.equal(view.ready,true);assert.equal(view.reason,undefined);assert.ok(view.signature.includes('Loaded sheet'));
  const probe=(await app.invoke({type:'diagnostics'})).lastPresentationProbe;
  assert.equal(probe.expectedReady,true);assert.equal(probe.found,true);assert.equal(probe.stage,'done');assert.ok(probe.totalMs>=probe.visualMs);
});


test('an initialized RN LogBox observer rejects overlays without exporting error text',async t=>{
  let observer:any,unsubscribed=0;
  const store={observe(callback:any){observer=callback;callback({isDisabled:false,selectedLogIndex:-1});return {unsubscribe(){unsubscribed++;observer=undefined}}}};
  const __r={getModules:()=>new Map([[1,{isInitialized:true,verboseName:'node_modules/react-native/Libraries/LogBox/Data/LogBoxData.js',publicModule:{exports:store}}]])};
  const app=runtime(t,false,undefined,false,{__r});
  assert.equal((await app.invoke({type:'inspect'})).available,true);
  const opening=app.invoke({type:'open',path:['Profile'],timeoutMs:1000});
  observer({isDisabled:false,selectedLogIndex:0,logs:new Set([{message:'private render error'}])});
  assert.equal((await opening).appFailed,true);
  for(const type of ['verify','presentation-view','presentation-open'])assert.deepEqual(JSON.parse(JSON.stringify(await app.invoke({type}))),{appFailed:true});
  assert.equal((await app.invoke({type:'heartbeat'})).alive,true);
  await app.invoke({type:'restore'});assert.equal(unsubscribed,1);assert.equal(observer,undefined);
});

test('LogBox detection never initializes modules or treats a disabled inspector as visible',async t=>{
  let initializations=0;
  const module={isInitialized:false,verboseName:'node_modules/react-native/Libraries/LogBox/Data/LogBoxData.js',get publicModule(){initializations++;throw Error('never initialize')}};
  const disabled={isInitialized:true,verboseName:module.verboseName,publicModule:{exports:{observe(callback:any){callback({isDisabled:true,selectedLogIndex:0});return {unsubscribe(){}}}}}};
  const app=runtime(t,false,undefined,false,{__r:{getModules:()=>new Map([[1,module],[2,disabled]])}});
  assert.equal((await app.invoke({type:'inspect'})).available,true);assert.equal(initializations,0);
});


test('opening a route replaces a detached helper even when it still reads valid state',async t=>{
  const app=runtime(t);await app.invoke({type:'inspect'});
  const live={...app.navigation};
  app.navigation.dispatch=()=>{assert.fail('Detached navigation must never dispatch')};
  app.fiber.memoizedProps.navigation=live;
  const opened=await app.invoke({type:'open',path:['Profile'],timeoutMs:500});
  assert.equal(opened.ready,true);assert.deepEqual(Array.from(opened.active),['Profile']);
});

test('bounded stack replacement dispatches through its current mounted helper',async t=>{
  const app=runtime(t);
  let leaf:any={type:'stack',key:'current-stack',index:0,routeNames:['Home','Profile'],routes:[{name:'Home',key:'home'}]};
  let state:any={type:'tab',key:'tabs',index:0,routeNames:['HomeTab'],routes:[{name:'HomeTab',state:leaf}]};
  let replaces=0;
  app.navigation.getState=()=>state;
  app.navigation.dispatch=(action:any)=>{
    assert.notEqual(action.type,'REPLACE','The parent cannot dispatch through a detached child listener');
    if(action.type==='RESET'){state=action.payload;leaf=state.routes[0].state;}
  };
  const live={getState:()=>leaf,getParent:()=>app.navigation,isFocused:()=>true,dispatch(action:any){
    assert.equal(action.type,'REPLACE');assert.equal(action.target,leaf.key);replaces++;
    leaf={...leaf,routes:[{key:`leaf-${replaces}`,name:action.payload.name,params:action.payload.params}]};
    state={...state,routes:[{name:'HomeTab',state:leaf}]};app.fiber.memoizedProps.route=leaf.routes[0];
  }};
  app.fiber.memoizedProps={navigation:live,route:leaf.routes[0]};
  await app.invoke({type:'inspect'});
  const opened=await app.invoke({type:'open',path:['HomeTab','Profile'],params:{id:'real-id'},timeoutMs:500});
  assert.equal(opened.ready,true);assert.equal(replaces,1);assert.equal(leaf.routes.length,1);
  assert.deepEqual(Array.from(opened.active),['HomeTab','Profile']);
});


test('route opens and recovery cannot unmount an unrestored presentation',async t=>{
  const app=runtime(t);await app.invoke({type:'restore'});app.context.level=1;
  vm.runInContext(`(${installFlowRuntime.toString()})('flow',5000,()=>({checkpoint:()=>level,async rollback(){level=0},cleanup(){}}))`,app.context);
  await app.invoke({type:'inspect'});
  for(const type of ['open','recover']){
    const result=await app.invoke({type,path:['Profile']});
    assert.equal(result.error,'Restore presentations before changing navigation.');
    assert.equal(app.getState().routes[0].name,'Home');
  }
  await app.invoke({type:'presentation-rollback'});
  assert.equal((await app.invoke({type:'open',path:['Profile'],timeoutMs:300})).ready,true);
});


for (const install of [installPresentationRuntime, sharedLoopRuntime()]) {
  test(`presentation content and motion share native geometry only within one check (${install===installPresentationRuntime?'normal':'shared loops'})`, async t => {
    const factory = (options:any) => ({
      ...(globalThis as any).installPresentationRuntime(options),
      open:()=>({focus:(globalThis as any).logical}),
    });
    const app=runtime(t,false,undefined,factory,{installPresentationRuntime:install});
    let reads=0,width=100;
    app.native.stateNode={canonical:{publicInstance:{getBoundingClientRect(){reads++;return {x:0,y:0,width,height:200}}}}};
    app.context.logical=app.fiber;
    await app.invoke({type:'presentation-open',id:'preview'});
    await new Promise(resolve=>setTimeout(resolve,180));
    reads=0;
    const settled=await app.invoke({type:'presentation-view'});
    assert.equal(settled.ready,true);assert.equal(reads,1,'The native host is measured once for content and motion');
    width=160;reads=0;
    const moving=await app.invoke({type:'presentation-view'});
    assert.equal(reads,1,'A later probe must read current native geometry');
    assert.notEqual(moving.motion,settled.motion);assert.equal(moving.ready,false,'Changed bounds restart paint and settling checks');
    await new Promise(resolve=>setTimeout(resolve,180));
    assert.equal((await app.invoke({type:'presentation-view'})).ready,true);
    assert.equal('geometry' in settled,false,'Native host references never enter tool results');
  });
}
