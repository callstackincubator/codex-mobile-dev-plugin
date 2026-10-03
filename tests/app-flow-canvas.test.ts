import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
const bundle = await build({
  stdin: { contents: `
    import React, {useMemo, useRef, useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {AppFlowCanvas} from './src/ui/components/app-flow-canvas.tsx';
    import {layoutFlow} from './src/shared/app-flow.ts';
    globalThis.mount = (element, initialScale = 1, duplicates = false) => {
      const nodes = Array.from({length:120}, (_,i) => ({id:String(i), name:'Screen'+i, kind:'screen', path:[], required:[], status:'captured', entry:i===0, image:'mobile-flow://run/'+i}));
      const initialRun = {nodes, edges:nodes.slice(1).map(n => ({from:'0',to:n.id,kind:'navigation'}))};
      if (duplicates) initialRun.edges.push(...initialRun.edges, ...initialRun.edges);
      globalThis.scaleChanges = [];
      globalThis.timings = [];
      globalThis.selections = [];
      const panel = {visible(){}};
      function Fixture() {
        const [scale, setScale] = useState(initialScale);
        const [run, setRun] = useState(initialRun);
        const viewport = useRef(null);
        const graph = useMemo(() => layoutFlow(run), [run]);
        globalThis.update = () => setRun({...initialRun, edges:[]});
        globalThis.changeScale = setScale;
        return <div data-scale={scale}><AppFlowCanvas panel={panel} run={run} graph={graph}
          images={{'mobile-flow://run/0':'data:image/png;base64,iVBORw0KGgo='}} scale={scale}
          onScaleChange={value => {globalThis.scaleChanges.push(value); setScale(value)}}
          select={id => globalThis.selections.push(id)} viewport={viewport}/></div>;
      }
      const root = createRoot(element);
      root.render(<Fixture/>);
      return root;
    };`, resolveDir:process.cwd(), loader:'tsx'},
  bundle:true, write:false, format:'iife', platform:'browser', define:{'process.env.NODE_ENV':'"production"'},
  plugins:[{name:'telemetry', setup(build) {
    build.onLoad({filter:/src\/ui\/telemetry\.ts$/}, () => ({contents:`
      export function recordUiTiming(name, duration) { globalThis.timings?.push({name,duration}); }
      export function setUiGauge() {}
    `, loader:'js'}));
  }}],
});
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

const settle = () => new Promise(resolve => setTimeout(resolve, 60));
async function gestureFixture(scale = .5) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual:true, runScripts:'outside-only' });
  const window = dom.window as any;
  const captures = new Set<number>();
  window.ResizeObserver = class {observe(){} disconnect(){}};
  Object.defineProperties(window.HTMLElement.prototype, {clientWidth:{get:()=>800}, clientHeight:{get:()=>600}});
  window.HTMLElement.prototype.getBoundingClientRect = () => ({left:40, top:80});
  window.HTMLElement.prototype.setPointerCapture = (id: number) => captures.add(id);
  window.HTMLElement.prototype.hasPointerCapture = (id: number) => captures.has(id);
  window.HTMLElement.prototype.releasePointerCapture = (id: number) => captures.delete(id);
  window.eval(bundle.outputFiles[0].text);
  const root = window.mount(window.document.getElementById('root'), scale);
  await settle();
  const viewport = window.document.querySelector('.app-flow-viewport') as HTMLElement;
  const wheel = (deltaY: number, ctrlKey = true, deltaMode = 0) => {
    const event = new window.WheelEvent('wheel', {deltaY, deltaMode, ctrlKey, clientX:240, clientY:230, bubbles:true, cancelable:true});
    viewport.dispatchEvent(event);
    return event;
  };
  const pointer = (type: string, id: number, x: number, y: number, target: Element = viewport, pointerType = 'touch') => {
    const event = new window.MouseEvent(type, {clientX:x + 40, clientY:y + 80, button:0, bubbles:true, cancelable:true});
    Object.defineProperties(event, {pointerId:{value:id}, pointerType:{value:pointerType}});
    target.dispatchEvent(event);
  };
  return {dom, window, root, captures, viewport, wheel, pointer, scale:()=>Number(window.document.querySelector('[data-scale]').dataset.scale)};
}

function near(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < .001, `${actual} != ${expected}`); }

test('trackpad pinch batches input, anchors the cursor, respects limits and leaves scrolling alone', async () => {
  const f = await gestureFixture(.6);
  try {
    f.viewport.scrollLeft = 300; f.viewport.scrollTop = 180;
    assert.equal(f.wheel(-30, false).defaultPrevented, false);
    await settle();
    assert.equal(f.scale(), .6);
    for (let i = 0; i < 3; i++) assert.equal(f.wheel(-Math.log(1.1) / .01).defaultPrevented, true);
    await settle();
    near(f.scale(), .6 * 1.1 ** 3);
    assert.equal(f.window.scaleChanges.length, 1, 'one zoom update per animation frame');
    near((f.viewport.scrollLeft + 200) / f.scale(), 500 / .6);
    near((f.viewport.scrollTop + 150) / f.scale(), 330 / .6);
    const timings = f.window.timings.filter((timing: any) => timing.name === 'ui.app_flow.zoom');
    assert.equal(timings.length, 1);
    assert.ok(timings[0].duration >= 0);
    f.window.changeScale(.9);
    await settle();
    f.wheel(-1, true, 1);
    await settle();
    near(f.scale(), .9 * Math.exp(.16));
    f.wheel(-10000); await settle(); assert.equal(f.scale(), 1.5);
    f.wheel(10000); await settle(); assert.equal(f.scale(), .15);
    f.wheel(1); await settle(); assert.equal(f.scale(), .15);
  } finally {f.root.unmount(); f.dom.window.close()}
});

test('touch pinch anchors its midpoint, continues panning with one finger, and does not select a card', async () => {
  const f = await gestureFixture();
  try {
    f.viewport.scrollLeft = 300; f.viewport.scrollTop = 180;
    let card = f.window.document.querySelector('.app-flow-node');
    f.pointer('pointerdown', 1, 200, 200, card);
    f.pointer('pointerdown', 2, 400, 200, card);
    f.pointer('lostpointercapture', 1, 200, 200, card);
    f.pointer('lostpointercapture', 2, 400, 200, card);
    f.pointer('pointermove', 1, 150, 200);
    f.pointer('pointermove', 2, 450, 200);
    await settle();
    near(f.scale(), .75);
    near(f.viewport.scrollLeft, 600);
    near(f.viewport.scrollTop, 370);
    f.pointer('pointerup', 2, 450, 200);
    f.pointer('pointermove', 1, 130, 180);
    await settle();
    near(f.viewport.scrollLeft, 620); near(f.viewport.scrollTop, 390);
    near(f.scale(), .75);
    f.pointer('pointercancel', 1, 130, 180);
    assert.equal(f.captures.size, 0);
    card = f.window.document.querySelector('.app-flow-node');
    const click = new f.window.MouseEvent('click', {detail:1, bubbles:true, cancelable:true});
    card.dispatchEvent(click);
    assert.equal(click.defaultPrevented, true);
    assert.equal(f.window.selections.length, 0);
    // A new tap and a keyboard activation still select normally.
    f.pointer('pointerdown', 3, 200, 200, card);
    f.pointer('pointerup', 3, 200, 200, card);
    card.dispatchEvent(new f.window.MouseEvent('click', {detail:1, bubbles:true}));
    card.dispatchEvent(new f.window.MouseEvent('click', {detail:0, bubbles:true}));
    assert.equal(f.window.selections.length, 2);
  } finally {f.root.unmount(); f.dom.window.close()}
});

test('mouse drag still pans, and unmount cancels pending zoom and removes gesture listeners', async () => {
  const f = await gestureFixture();
  try {
    f.viewport.scrollLeft = 300; f.viewport.scrollTop = 180;
    f.pointer('pointerdown', 1, 200, 200, f.viewport, 'mouse');
    f.pointer('pointermove', 1, 150, 170, f.viewport, 'mouse');
    await settle();
    assert.equal(f.viewport.scrollLeft, 350); assert.equal(f.viewport.scrollTop, 210);
    assert.equal(f.scale(), .5);
    f.pointer('pointerup', 1, 150, 170, f.viewport, 'mouse');
    f.pointer('pointerdown', 2, 200, 200);
    f.pointer('pointerdown', 3, 400, 200);
    assert.equal(f.captures.size, 2);
    f.wheel(-10);
    f.root.unmount();
    assert.equal(f.captures.size, 0);
    assert.equal(f.wheel(-10).defaultPrevented, false);
    await settle();
    assert.equal(f.window.scaleChanges.length, 0);
  } finally {f.dom.window.close()}
});
