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
