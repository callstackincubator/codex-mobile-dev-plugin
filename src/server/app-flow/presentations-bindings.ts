import { relative, isAbsolute } from 'node:path';
import type { FlowStateSite } from '../../shared/app-flow.ts';

type Binding = {id:string;owner:string;stack:string};
/** Metro resolves hook call sites, including calls inside custom hooks and compiled React. */
export async function bindPresentationSites(base: string, root: string, bindings: Binding[], states: FlowStateSite[]) {
  const frames: {file:string;methodName:string;lineNumber:number;column:number}[] = [];
  const owners: string[] = [];
  const origin=new URL(base).origin;
  for(const binding of bindings.slice(0,1500)) {
    for(const line of (binding.stack??'').split('\n').slice(0,16)){
      const match=/at\s+(.*?)\s+\((?:address at )?(https?:\/\/.*):(\d+):(\d+)\)/.exec(line)??/^(.*?)@(https?:\/\/.*):(\d+):(\d+)$/.exec(line);
      if(!match)continue;
      let url:URL;try{url=new URL(match[2]);}catch{continue;}if(url.origin!==origin)continue;
      frames.push({file:url.href,methodName:match[1],lineNumber:Number(match[3]),column:Math.max(0,Number(match[4])-1)});owners.push(binding.id);
    }
  }
  if(!frames.length)return [];
  const matches=new Map<string,string>();
  for(let offset=0;offset<frames.length;offset+=120){
    const response=await fetch(new URL('/symbolicate',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stack:frames.slice(offset,offset+120)}),signal:AbortSignal.timeout(3000)});
    if(!response.ok)throw new Error('Metro could not resolve presentation hook locations.');
    const result=await response.json() as {stack?:{file?:string;lineNumber?:number;column?:number}[]};
    for(const [index,frame]of (result.stack??[]).slice(0,120).entries()){
      if(!frame.file||!Number.isInteger(frame.lineNumber))continue;
      const file=relative(root,frame.file.replace(/^file:\/\//,''));if(isAbsolute(file)||file.startsWith('..'))continue;
      const candidates=states.filter(site=>site.file===file&&frame.lineNumber!>=site.line&&frame.lineNumber!<=site.endLine);
      if(candidates.length!==1)continue;
      const id=owners[offset+index];
      if(!matches.has(id))matches.set(id,candidates[0].id);
    }
  }
  return [...matches].map(([binding,site])=>({binding,site}));
}
