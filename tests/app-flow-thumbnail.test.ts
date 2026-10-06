import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';

const bundle=await build({entryPoints:['src/ui/app-flow-thumbnail.ts'],bundle:true,write:false,format:'iife',globalName:'Thumbnail',platform:'browser'});
function fixture(fail=false) {
  let instance:any,drawn:number[]=[];
  const canvas={width:0,height:0,getContext:()=>({drawImage:(_image:any,...bounds:number[])=>{drawn=bounds;}}),toDataURL:()=>{if(fail)throw Error('Encode failed');return 'data:image/png;base64,preview';}};
  class Image {
    naturalWidth=1206;naturalHeight=2622;onload?:()=>void;onerror?:()=>void;value='';
    constructor(){instance=this;}
    set src(value:string){this.value=value;if(value)queueMicrotask(()=>this.onload?.());}
    get src(){return this.value;}
  }
  const context=vm.createContext({Image,document:{createElement:()=>canvas}});
  vm.runInContext(bundle.outputFiles[0].text,context);
  return {capture:context.Thumbnail.flowThumbnail,canvas,image:()=>instance,drawn:()=>drawn};
}
test('canvas previews retain only scaled pixels and release the original decode',async()=>{
  const f=fixture(),preview=await f.capture('original',192);
  assert.deepEqual(f.drawn(),[0,0,192,417]);
  assert.equal(preview.pixels,192*417);
  assert.equal(preview.bytes,192*417*4+preview.url.length*2);
  assert.equal(f.canvas.width,0);assert.equal(f.canvas.height,0);
  assert.equal(f.image().src,'');assert.equal(f.image().onload,null);assert.equal(f.image().onerror,null);
});
test('a failed thumbnail also releases its bitmap and decode handlers',async()=>{
  const f=fixture(true);
  await assert.rejects(f.capture('original',192),/Encode failed/);
  assert.equal(f.canvas.width,0);assert.equal(f.image().src,'');assert.equal(f.image().onload,null);
});
