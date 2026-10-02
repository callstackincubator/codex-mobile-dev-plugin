import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import{AppFlowCanvas}from './src/ui/components/app-flow-canvas.tsx';import{layoutFlow}from './src/shared/app-flow.ts';globalThis.mount=(element,scale=1,duplicates=false)=>{const nodes=Array.from({length:120},(_,i)=>({id:String(i),name:'Screen'+i,kind:'screen',path:[],required:[],status:'captured',entry:i===0,image:'mobile-flow://run/'+i}));const run={nodes,edges:nodes.slice(1).map(n=>({from:'0',to:n.id,kind:'navigation'}))};if(duplicates)run.edges.push(...run.edges,...run.edges);const root=createRoot(element);globalThis.update=()=>root.render(React.createElement(AppFlowCanvas,{panel:{visible(){}},run:{...run,edges:[]},graph:layoutFlow({...run,edges:[]}),images:{},scale,select(){},viewport:{current:null}}));root.render(React.createElement(AppFlowCanvas,{panel:{visible(){}},run,graph:layoutFlow(run),images:{'mobile-flow://run/0':'data:image/png;base64,iVBORw0KGgo='},scale,select(){},viewport:{current:null}}));return root};`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'}});
test('canvas mounts only nearby previews and releases observers on teardown',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{pretendToBeVisual:true,runScripts:'outside-only'});
  let observing=0;
  Object.defineProperties(dom.window.HTMLElement.prototype,{clientWidth:{get:()=>800},clientHeight:{get:()=>600}});
  dom.window.ResizeObserver=class {observe(){observing++}disconnect(){observing--}} as any;
  dom.window.eval(bundle.outputFiles[0].text);
  const root=(dom.window as any).mount(dom.window.document.getElementById('root'),.6);
  try{
    await new Promise(resolve=>setTimeout(resolve,50));
    const nodes=dom.window.document.querySelectorAll('.app-flow-node');
    assert.ok(nodes.length>0&&nodes.length<20,`mounted ${nodes.length} of 120 cards`);
    assert.equal(dom.window.document.querySelector('img')?.getAttribute('src'),'data:image/png;base64,iVBORw0KGgo=');
    assert.equal(observing,1);
    const checkEndpoints=()=>{
      const svg=dom.window.document.querySelector('.app-flow-edges') as unknown as SVGElement;
      assert.equal(svg.getAttribute('viewBox'),null);
      const arrows=svg.querySelectorAll(':scope > path');
      assert.ok(arrows.length>0);
      for(const arrow of arrows){
        assert.ok(dom.window.document.querySelector(`[data-node-id="${arrow.getAttribute('data-from')}"]`),'every arrow starts at a mounted card');
        const card=dom.window.document.querySelector(`[data-node-id="${arrow.getAttribute('data-to')}"]`) as HTMLElement;
        assert.ok(card,'every arrow ends at a mounted card');
        const [x,y]=arrow.getAttribute('d')!.split(' ').at(-1)!.split(',').map(Number);
        assert.ok(Math.abs(x+parseFloat(svg.style.left)-parseFloat(card.style.left))<.01);
        assert.ok(Math.abs(y+parseFloat(svg.style.top)-parseFloat(card.style.top)-28)<.01);
      }
    };
    checkEndpoints();
    const viewport=dom.window.document.querySelector('.app-flow-viewport')!;
    viewport.scrollLeft=360;viewport.scrollTop=220;
    viewport.dispatchEvent(new dom.window.Event('scroll'));
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(dom.window.document.querySelectorAll('.app-flow-edges > path').length,0,'culled sources must not leave disconnected arrows');
    viewport.scrollLeft=120;viewport.scrollTop=60;
    viewport.dispatchEvent(new dom.window.Event('scroll'));
    await new Promise(resolve=>setTimeout(resolve,50));
    checkEndpoints();
  }finally{root.unmount();assert.equal(observing,0);dom.window.close()}
});


test('repeated source edges leave no orphan paths after the graph changes',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{pretendToBeVisual:true,runScripts:'outside-only'});
  dom.window.ResizeObserver=class {observe(){}disconnect(){}} as any;
  Object.defineProperties(dom.window.HTMLElement.prototype,{clientWidth:{get:()=>1200},clientHeight:{get:()=>800}});
  dom.window.eval(bundle.outputFiles[0].text);
  const root=(dom.window as any).mount(dom.window.document.getElementById('root'),1,true);
  try {
    await new Promise(resolve=>setTimeout(resolve,50));
    const edges=[...dom.window.document.querySelectorAll('.app-flow-edges > path')];
    assert.ok(edges.length>0);
    assert.equal(edges.length,new Set(edges.map(edge=>edge.getAttribute('data-to'))).size);
    (dom.window as any).update();
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(dom.window.document.querySelectorAll('.app-flow-edges > path').length,0);
  } finally {root.unmount();dom.window.close()}
});
