import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installFlowRuntime } from '../src/server/app-flow/runtime.js';
import { WebSocketServer } from 'ws';
import { once } from 'node:events';
import { FlowConnection } from '../src/server/app-flow/connection.ts';

function runtime(t: test.TestContext, redirect = false) {
  let state:any = {index:0,routeNames:['Home','Profile'],routes:[{name:'Home'}]};
  const original = state;
  const navigation = { getState:()=>state, isFocused:()=>true, dispatch(action:any){state={...action.payload,routeNames:['Home','Profile']};if(redirect)state.routes=[{name:'Login'}];sync();} };
  const fiber:any = { memoizedProps:{ navigation, route:state.routes[0] }, tag:0 };
  const native:any = {tag:5,type:'View',memoizedProps:{children:'screen'},stateNode:{getBoundingClientRect:()=>({x:0,y:0,width:100,height:200})},return:fiber};
  fiber.child=native;
  function sync(){fiber.memoizedProps.route=state.routes[0]}
  const context=vm.createContext({setTimeout,clearTimeout,Date,Map,Set,JSON,Math,Object,Array,String,__REACT_DEVTOOLS_GLOBAL_HOOK__:{renderers:new Map([[1,{rendererPackageName:'react-native-renderer'}]]),getFiberRoots:()=>[{current:fiber}]}});
  vm.runInContext(`(${installFlowRuntime.toString()})('flow',5000)`,context);
  const invoke=(command:any)=>new Promise<any>(resolve=>context.flow.invoke(command,resolve));
  t.after(async()=>{if(context.flow)await invoke({type:'restore'})});
  return {context,invoke,getState:()=>state,original};
}

test('runtime finds mounted navigators, opens a target, and restores original state',async t=>{
  const app=runtime(t);
  const info=await app.invoke({type:'inspect'});
  assert.equal(info.available,true);
  assert.equal(info.registrations.length,2);
  const result=await app.invoke({type:'open',path:['Profile'],params:{id:'actual'},timeoutMs:300});
  assert.equal(result.ready,true);
  assert.equal(result.active[0],'Profile');
  assert.equal(app.getState().routes[0].params.id,'actual');
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

test('persistent CDP connection uses binding replies rather than evaluation acknowledgements',async t=>{
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});
  await once(server,'listening');
  t.after(()=>new Promise<void>(resolve=>{for(const client of server.clients)client.terminate();server.close(()=>resolve())}));
  let binding='',requests=0;
  server.on('connection',socket=>socket.on('message',bytes=>{
    const message=JSON.parse(bytes.toString());requests++;
    if(message.method==='Runtime.addBinding')binding=message.params.name;
    socket.send(JSON.stringify({id:message.id,result:{result:{type:'undefined'}}}));
    if(message.id<0)setTimeout(()=>socket.send(JSON.stringify({method:'Runtime.bindingCalled',params:{name:binding,payload:JSON.stringify({id:message.id,result:{available:true,marker:message.id}})}})),10);
  }));
  const address=server.address() as {port:number};
  const connection=new FlowConnection(`ws://127.0.0.1:${address.port}`,1000);
  const first=await connection.invoke({type:'inspect'});
  const second=await connection.invoke({type:'inspect'});
  assert.equal(first.available,true);
  assert.ok(second.marker<first.marker);
  assert.equal(server.clients.size,1);
  await connection.close();
  assert.ok(requests>=5);
});
