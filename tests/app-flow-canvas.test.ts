import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import{AppFlowCanvas}from './src/ui/components/app-flow-canvas.tsx';import{layoutFlow}from './src/shared/app-flow.ts';globalThis.mount=element=>{const nodes=Array.from({length:120},(_,i)=>({id:String(i),name:'Screen'+i,kind:'screen',path:[],required:[],status:'captured',entry:i===0,image:'mobile-flow://run/'+i}));const run={nodes,edges:nodes.slice(1).map(n=>({from:'0',to:n.id,kind:'navigation'}))};const root=createRoot(element);root.render(React.createElement(AppFlowCanvas,{panel:{visible(){}},run,graph:layoutFlow(run),images:{'mobile-flow://run/0':'data:image/png;base64,iVBORw0KGgo='},scale:1,select(){},viewport:{current:null}}));return root};`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'}});
test('canvas mounts only nearby previews and releases observers on teardown',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{pretendToBeVisual:true,runScripts:'outside-only'});
  let observing=0;
  Object.defineProperties(dom.window.HTMLElement.prototype,{clientWidth:{get:()=>800},clientHeight:{get:()=>600}});
  dom.window.ResizeObserver=class {observe(){observing++}disconnect(){observing--}} as any;
  dom.window.eval(bundle.outputFiles[0].text);
  const root=(dom.window as any).mount(dom.window.document.getElementById('root'));
  try{
    await new Promise(resolve=>setTimeout(resolve,50));
    const nodes=dom.window.document.querySelectorAll('.app-flow-node');
    assert.ok(nodes.length>0&&nodes.length<20,`mounted ${nodes.length} of 120 cards`);
    assert.equal(dom.window.document.querySelector('img')?.getAttribute('src'),'data:image/png;base64,iVBORw0KGgo=');
    assert.equal(observing,1);
  }finally{root.unmount();assert.equal(observing,0);dom.window.close()}
});
