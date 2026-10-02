import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { blankFlowFrame } from '../src/server/app-flow/frame.ts';
function png(content: boolean) {
  const chunk=(name:string,bytes:Buffer)=>{const out=Buffer.alloc(bytes.length+12);out.writeUInt32BE(bytes.length);out.write(name,4);bytes.copy(out,8);return out};
  const header=Buffer.alloc(13);header.writeUInt32BE(100);header.writeUInt32BE(100,4);header[8]=8;header[9]=2;
  const rows=Buffer.alloc(100*301,255);
  for(let y=0;y<100;y++){rows[y*301]=0;if(content&&y>40&&y<50)rows.fill(0,y*301+61,y*301+240)}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
test('blank native frames are rejected while a screen with content is retained',()=>{
  assert.equal(blankFlowFrame(png(false)),true);
  assert.equal(blankFlowFrame(png(true)),false);
  assert.equal(blankFlowFrame(Buffer.from('not a png')),false);
});

test('blank detection agrees across all PNG filters, mixed rows, RGB and RGBA',()=>{
  const width=137,height=193;
  for(const channels of [3,4]) for(const filters of [[0],[1],[2],[3],[4],[0,1,2,3,4]]) for(const content of [false,true]) {
    const stride=width*channels,pixels=Buffer.alloc(stride*height,255),rows=Buffer.alloc((stride+1)*height);
    if(content)for(let y=50;y<110;y++)for(let x=20;x<80;x++)for(let channel=0;channel<3;channel++)pixels[y*stride+x*channels+channel]=(x*13+y*7+channel*31)%256;
    for(let y=0;y<height;y++){
      const filter=filters[y%filters.length];rows[y*(stride+1)]=filter;
      for(let x=0;x<stride;x++){
        const index=y*stride+x,left=x>=channels?pixels[index-channels]:0,up=y?pixels[index-stride]:0,corner=y&&x>=channels?pixels[index-stride-channels]:0;
        let predictor=0;
        if(filter===1)predictor=left;
        if(filter===2)predictor=up;
        if(filter===3)predictor=Math.floor((left+up)/2);
        if(filter===4){const p=left+up-corner,values=[left,up,corner];predictor=values.reduce((best,value)=>Math.abs(p-value)<Math.abs(p-best)?value:best)}
        rows[y*(stride+1)+x+1]=(pixels[index]-predictor+256)%256;
      }
    }
    const chunk=(name:string,bytes:Buffer)=>{const out=Buffer.alloc(bytes.length+12);out.writeUInt32BE(bytes.length);out.write(name,4);bytes.copy(out,8);return out};
    const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=channels===4?6:2;
    const image=()=>Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
    assert.equal(blankFlowFrame(image()),!content,`${channels} channels, filters ${filters}, content ${content}`);
    rows[(height-1)*(stride+1)]=5;
    assert.equal(blankFlowFrame(image()),false,'invalid filters must still be checked below the sampled area');
  }
});
