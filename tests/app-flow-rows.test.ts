import test from 'node:test';
import assert from 'node:assert/strict';
import {installPresentationRuntime} from '../src/server/app-flow/presentations-runtime.js';

// A vertical list of rows, each with its own opener and sheet controller.
function list(rows:{y:number;mine?:boolean}[],{horizontal=false}={}) {
  function App(){} function Row(){} function Button(){} function Sheet(){}
  const host=(y:number,height=40)=>({tag:5,type:'View',memoizedProps:{},stateNode:{getBoundingClientRect:()=>({x:0,y,width:400,height})}});
  const root:any={type:App,memoizedProps:{},memoizedState:null};
  const scroll:any={tag:5,type:'RCTScrollView',memoizedProps:{horizontal},stateNode:{getBoundingClientRect:()=>({x:0,y:0,width:400,height:800})},return:root};
  root.child=scroll;
  const opened:number[]=[];let previous:any;
  const made=rows.map((row,index)=>{
    const owner:any={type:Row,memoizedProps:{mine:!!row.mine},return:scroll};
    const button:any={type:Button,_debugSource:{fileName:'App.tsx',lineNumber:1,columnNumber:1},memoizedProps:{onPress(){throw Error('do not call the UI event')}},return:owner};
    const native:any={...host(row.y),return:button};button.child=native;
    const control={open(){opened.push(index)},close(){}};
    const sheet:any={type:Sheet,memoizedProps:{control},return:owner};
    owner.child=button;button.sibling=sheet;
    if(previous)previous.sibling=owner;else scroll.child=owner;previous=owner;
    return {owner,sheet};
  });
  const fibers=(visit:any,subtree?:any)=>{const stack=[subtree??root];while(stack.length){const f=stack.pop();if(f!==subtree&&f.sibling)stack.push(f.sibling);if(visit(f)!==false&&f.child)stack.push(f.child)}};
  const runtime=installPresentationRuntime({hook:{renderers:new Map()},fibers,hidden:()=>false,later:setTimeout});
  const action:any={id:'menu',file:'App.tsx',line:1,owner:'Row',component:'Button',prop:'onPress',name:'Sheet',effect:{kind:'control',component:'Sheet',prop:'control',method:'open',close:'close'}};
  const configure=(catalog:any)=>{
    runtime.configure(catalog,[]);
    const entries=runtime.records(0).bindings.filter((b:any)=>b.kind==='entry');
    runtime.configure(catalog,entries.map((b:any)=>({binding:b.id,site:'menu'})),entries.map((b:any)=>b.id));
  };
  configure({states:[],actions:[action]});
  return {runtime,action,made,opened,configure};
}

test('a menu opener repeated in list rows opens the first visible row',async()=>{
  const app=list([{y:300},{y:100},{y:500}]);
  try{
    assert.equal(app.runtime.list().length,1,'The rows are one view');
    assert.equal(app.runtime.open('menu').focus,app.made[1].sheet,'The topmost row opens');
    assert.deepEqual(app.opened,[1]);
    await app.runtime.rollback(0,false);
  }finally{app.runtime.cleanup()}
});

test('the first visible row must meet the opener source condition',async()=>{
  const app=list([{y:100},{y:200,mine:true},{y:300,mine:true}]);
  try{
    app.action.guard={prop:['mine']};app.configure({states:[],actions:[app.action]});
    assert.equal(app.runtime.open('menu').focus,app.made[1].sheet,'The first row meeting the condition opens');
    await app.runtime.rollback(0,false);
  }finally{app.runtime.cleanup()}
});

test('data-bearing openers and horizontal lists still need one owner',()=>{
  const data=list([{y:100},{y:200}]);
  try{
    data.action.input={value:{input:'props'},when:{value:true},locals:[]};data.configure({states:[],actions:[data.action]});
    assert.equal(data.runtime.prepare('menu').available,false);
  }finally{data.runtime.cleanup()}
  const pages=list([{y:100},{y:200}],{horizontal:true});
  try{assert.equal(pages.runtime.prepare('menu').available,false,'Pages of a horizontal list are not rows')}
  finally{pages.runtime.cleanup()}
});
