import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceUiOpenEffect} from '../src/server/app-flow/effect-source.ts';

const proof=(body:string,deps='control,delay',prefix='')=>{
  const source=`import {useEffect} from 'react';${prefix}function useOpening(control,delay){useEffect(()=>{${body}},[${deps}]);}`;
  const column=source.indexOf('useEffect(()=>');return sourceUiOpenEffect(source,1,column);
};

test('UI opening proof preserves direct and cancellable delayed lifecycle code',()=>{
  assert.deepEqual(proof('control.open()'),{dependency:0,method:'open'});
  assert.deepEqual(proof('if(delay){const timer=setTimeout(()=>{control.open()},delay);return ()=>clearTimeout(timer)}else{control.open()}'),{dependency:0,method:'open'});
  assert.deepEqual(proof('control.present()','delay,control'),{dependency:1,method:'present'});
});

test('UI opening proof rejects other effects, unknown controls and timer leaks',()=>{
  for(const body of ['control.open();saveAccount()','saveAccount();control.open()','control.open(record)','control.open();state.ready=true','control.open();return ()=>saveAccount()','const timer=setTimeout(()=>control.open(),delay)','if(delay){const timer=setTimeout(()=>control.open(),delay)}else{control.open()}','control.current.open()','if(control.visible){control.open()}','control.open();throw Error("no")'])assert.equal(proof(body),undefined,body);
  assert.equal(proof('control.open()','delay'),undefined);
  assert.equal(proof('const timer=setTimeout(()=>control.open(),delay);return ()=>clearTimeout(timer)','control,delay','const setTimeout=saveAccount;'),undefined);
  assert.equal(proof('const timer=setTimeout(()=>control.open(),delay);return ()=>clearTimeout(timer)','control,delay','function clearTimeout(value){saveAccount(value)}'),undefined);
});

test('UI opening proof checks the exact React call site and aliases',()=>{
  const source=`import {useEffect as afterRender} from 'react';function useOpening(control){afterRender(()=>control.show(),[control]);}`;
  assert.deepEqual(sourceUiOpenEffect(source,1,source.indexOf('afterRender(()=>')),{dependency:0,method:'show'});
  assert.equal(sourceUiOpenEffect(source,1,source.indexOf('function useOpening')),undefined);
  assert.equal(sourceUiOpenEffect(source,0),undefined);
  assert.equal(sourceUiOpenEffect(source,1,source.length+1),undefined);
});


import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocketServer} from 'ws';
import {once} from 'node:events';
import vm from 'node:vm';
import {FlowConnection} from '../src/server/app-flow/connection.ts';
import {FlowRuntimeMetrics} from '../src/server/app-flow/runtime-metrics.ts';

test('connection checks delayed opening source on readiness polls and bounds repeated effects',async t=>{
  const root=await mkdtemp(join(tmpdir(),'flow-effect-connection-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const file=join(root,'opening.tsx'),source="import {useEffect} from 'react';export function useOpening(control){useEffect(()=>control.open(),[control]);}";
  await writeFile(file,source);const column=source.indexOf('useEffect(()=>');
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});await once(server,'listening');
  t.after(()=>new Promise<void>(resolve=>{for(const client of server.clients)client.terminate();server.close(()=>resolve())}));
  const commands:any[]=[];let unsafe=false;
  server.on('connection',socket=>{
    let binding='';socket.on('message',bytes=>{
      const message=JSON.parse(bytes.toString());if(message.method==='Runtime.addBinding')binding=message.params.name;
      if(message.id>0){socket.send(JSON.stringify({id:message.id,result:{}}));return;}
      vm.runInNewContext(message.params.expression,{
        [message.params.objectGroup]:{invoke(command:any,reply:any){
          commands.push(JSON.parse(JSON.stringify(command)));
          const effect={id:'auto-open',owner:'Dialog',kind:'ui-effect',source:{file:unsafe?'/private/tmp/unrelated.tsx':file,line:1,column}};
          reply(command.type==='presentation-collect'?{bindings:[]}:
            command.type==='presentation-view'?{ready:false,effectBindings:[effect]}:
            command.type==='presentation-effects'?{ready:true,effects:1,effectBindings:[effect]}:{});
        }},
        [binding]:(payload:string)=>socket.send(JSON.stringify({method:'Runtime.bindingCalled',params:{name:binding,payload}})),
      });
    });
  });
  const address=server.address()as {port:number},metrics=new FlowRuntimeMetrics('ios'),connection=new FlowConnection(`ws://127.0.0.1:${address.port}`,'fixture','ios',metrics);
  t.after(()=>connection.close({restore:false}));
  await connection.invoke({type:'presentation-setup',projectRoot:root,catalog:{states:[],actions:[]}});
  assert.equal((await connection.invoke({type:'presentation-view'})).ready,true);
  assert.deepEqual(commands.filter(command=>command.type==='presentation-effects').map(command=>command.matches),[[{binding:'auto-open',site:'ui-effect:0:open'}]]);
  assert.equal(metrics.snapshot().find(operation=>operation.operation==='presentation-effects')?.count,1);
  unsafe=true;const before=commands.length;await connection.invoke({type:'presentation-view'});
  assert.deepEqual(commands.slice(before).map(command=>command.type),['presentation-view']);
  await writeFile(file,source.replace('control.open()','submitAccount();control.open()'));
  unsafe=false;const changed=commands.length;await connection.invoke({type:'presentation-view'});
  assert.deepEqual(commands.slice(changed).map(command=>command.type),['presentation-view']);
});
