import { inflateSync } from 'node:zlib';

/** Reject an empty native body even if React has already committed a screen behind it. */
export function blankFlowFrame(png: Buffer): boolean {
  if (png.length < 33 || !png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return false;
  const width=png.readUInt32BE(16), height=png.readUInt32BE(20), depth=png[24], color=png[25];
  const channels=color===6?4:color===2?3:0;
  if (!channels || depth!==8 || png[28]!==0 || width<20 || height<20 || width*height*channels>64*1024*1024) return false;
  const chunks:Buffer[]=[];
  for(let offset=8;offset+12<=png.length;) {
    const size=png.readUInt32BE(offset);
    if(offset+size+12>png.length) return false;
    if(png.toString('ascii',offset+4,offset+8)==='IDAT')chunks.push(png.subarray(offset+8,offset+8+size));
    offset+=size+12;
  }
  const stride=width*channels, raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:(stride+1)*height});
  if(raw.length!==(stride+1)*height) return false;
  let previous=Buffer.alloc(stride), row=Buffer.alloc(stride), samples=0, largest=0;
  const colors=new Uint32Array(4096), step=Math.max(1,Math.floor(width/100));
  for(let y=0;y<height;y++) {
    const offset=y*(stride+1), filter=raw[offset];
    if(filter>4) return false;
    for(let x=0;x<stride;x++) {
      const a=x>=channels?row[x-channels]:0,b=previous[x],c=x>=channels?previous[x-channels]:0;
      let predictor=0;
      if(filter===1)predictor=a;
      else if(filter===2)predictor=b;
      else if(filter===3)predictor=(a+b)>>>1;
      else if(filter===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);predictor=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
      row[x]=(raw[offset+x+1]+predictor)&255;
    }
    // Exclude the status bar, rounded screen edges, and home indicator.
    if(y>height*.16 && y<height*.88 && y%step===0)for(let x=Math.ceil(width*.06);x<width*.94;x+=step){
      const index=x*channels,key=((row[index]>>>4)<<8)|((row[index+1]>>>4)<<4)|(row[index+2]>>>4);
      largest=Math.max(largest,++colors[key]);samples++;
    }
    [previous,row]=[row,previous];
  }
  return samples>0 && largest/samples>.998;
}
