import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installFlowRuntime } from '../src/server/app-flow/runtime.js';
import { WebSocketServer } from 'ws';
import { once } from 'node:events';
import { FlowConnection } from '../src/server/app-flow/connection.ts';

function runtime(t: test.TestContext, redirect = false, timers = {setTimeout, clearTimeout}) {
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
  const context=vm.createContext({...timers,Date,Map,Set,JSON,Math,Object,Array,String,__REACT_DEVTOOLS_GLOBAL_HOOK__:{renderers:new Map([[1,{rendererPackageName:'react-native-renderer'}]]),getFiberRoots:()=>[{current:fiber}]}});
  vm.runInContext(`(${installFlowRuntime.toString()})('flow',5000)`,context);
  const invoke=(command:any)=>new Promise<any>(resolve=>context.flow.invoke(command,resolve));
  t.after(async()=>{if(context.flow)await invoke({type:'restore'})});
  return {context,invoke,getState:()=>state,original,navigation};
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

test('runtime strips credentials from observed route data',async t=>{
  const app=runtime(t);
  await app.invoke({type:'open',path:['Profile'],params:{id:'real',accessToken:'secret',password:'secret',nested:{cookie:'secret',id:'safe'}},timeoutMs:300});
  const info=await app.invoke({type:'inspect'});
  const text=JSON.stringify(info);
  assert.equal(text.includes('secret'),false);
  assert.ok(text.includes('real'));
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
