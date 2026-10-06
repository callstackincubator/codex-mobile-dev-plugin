import { relative, isAbsolute } from 'node:path';
import {readFile,realpath,stat} from 'node:fs/promises';
import {sourceUiPortal} from './portal-source.ts';
import {sourceUiOpenEffect} from './effect-source.ts';
import type { FlowStateSite, FlowPresentationAction } from '../../shared/app-flow.ts';
import type { PresentationBinding } from './presentations-runtime.js';

type Frame = {file?: string; lineNumber?: number; column?: number};
/** Metro resolves hook call sites and JSX entry locations without executing handlers. */
export async function bindPresentationSites(base: string, root: string, bindings: PresentationBinding[], states: FlowStateSite[], actions: FlowPresentationAction[] = []) {
  const frames: {file:string;methodName:string;lineNumber:number;column:number}[] = [];
  const frameIds = new Map<string,number>();
  const references: {owner:PresentationBinding;index:number}[] = [];
  const resolved: Frame[] = [];
  const origin=new URL(base).origin;
  const portalFrames:{binding:string;frame:Frame}[]=[],portalSources=new Map<string,string>();
  const matches: {binding:string;site:string}[] = [], resolvedEntries=new Set<string>(), resolvedStates=new Set<string>();
  const matchFrame=(binding:PresentationBinding,frame:Frame)=>{
    if(!frame.file||!Number.isInteger(frame.lineNumber))return;
    if(binding.kind==='portal'||binding.kind==='ui-effect'){portalFrames.push({binding:binding.id,frame});return;}
    const file=relative(root,frame.file.replace(/^file:\/\//,''));if(isAbsolute(file)||file.startsWith('..')||file.split(/[\\/]/).includes('node_modules'))return;
    if(binding.kind==='entry'){
      // Only the first project frame owns this JSX. Ancestor render frames must
      // not turn a nested or unrelated button into a presentation entry.
      if(resolvedEntries.has(binding.id))return;resolvedEntries.add(binding.id);
      for(const site of states)for(const entry of site.ownerEntries??[]){
        const loc=entry.source,line=frame.lineNumber!,column=frame.column;
        if(entry.component!==binding.owner||entry.file!==file||line<loc.line||line>loc.endLine)continue;
        if(column===undefined||line===loc.line&&column<loc.column||line===loc.endLine&&column>=loc.endColumn)continue;
        matches.push({binding:binding.id,site:`owner:${site.id}:${entry.component}`});
      }
      for(const action of actions){
        if(action.effect?.kind==='mount')continue;
        const sites=[{file:action.file,loc:action.source,id:action.id}];
        if(action.expected&&action.expected.component===binding.owner)sites.push({file:action.expected.file,loc:action.expected.source,id:`${action.id}:expected`});
        if(action.effect?.kind==='control'&&action.effect.target)sites.push({file:action.effect.target.file,loc:action.effect.target.source,id:`${action.id}:target`});
        for(const entry of action.consumer?.entries??[])sites.push({file:entry.file,loc:entry.source,id:`${action.id}:consumer`});
        for(const [index,entry]of (action.handoffs??[]).entries())if(entry.component===binding.owner)sites.push({file:entry.file,loc:entry.source,id:`${action.id}:handoff:${index}`});
        for(const site of sites){
          const loc=site.loc,line=frame.lineNumber!,column=frame.column;
          if(site.file!==file||!loc||line<loc.line||line>loc.endLine)continue;
          if(column===undefined||line===loc.line&&column<loc.column||line===loc.endLine&&column>=loc.endColumn)continue;
          matches.push({binding:binding.id,site:site.id});
        }
      }
    }else{
      const candidates=states.filter(site=>site.file===file&&frame.lineNumber!>=site.line&&frame.lineNumber!<=site.endLine&&
        (frame.column===undefined||site.endColumn===undefined||!(frame.lineNumber===site.line&&frame.column<site.column||frame.lineNumber===site.endLine&&frame.column>=site.endColumn)));
      if(candidates.length===1&&!resolvedStates.has(binding.id)){resolvedStates.add(binding.id);matches.push({binding:binding.id,site:candidates[0].id});}
    }
  };
  for(const binding of bindings.slice(0,3000)) {
    if(binding.source){matchFrame(binding,{file:binding.source.file,lineNumber:binding.source.line,column:binding.source.column});continue;}
    for(const line of (binding.stack??'').split('\n').slice(0,16)){
      const match=/at\s+(.*?)\s+\((?:address at )?(https?:\/\/.*):(\d+):(\d+)\)/.exec(line)??/^(.*?)@(https?:\/\/.*):(\d+):(\d+)$/.exec(line);
      if(!match)continue;
      let url:URL;try{url=new URL(match[2]);}catch{continue;}if(url.origin!==origin)continue;
      const frame={file:url.href,methodName:match[1],lineNumber:Number(match[3]),column:Math.max(0,Number(match[4])-1)};
      const key=JSON.stringify(frame);
      let index=frameIds.get(key);
      if(index===undefined){index=frames.length;frameIds.set(key,index);frames.push(frame);}
      references.push({owner:binding,index});
    }
  }
  for(let offset=0;offset<frames.length;offset+=120){
    const response=await fetch(new URL('/symbolicate',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stack:frames.slice(offset,offset+120)}),signal:AbortSignal.timeout(3000)});
    if(!response.ok)throw new Error('Metro could not resolve presentation source locations.');
    const result=await response.json() as {stack?:Frame[]};
    for(const [index,frame]of (result.stack??[]).slice(0,120).entries())resolved[offset+index]=frame;
  }
  // Shared creation stacks need one lookup per exact frame. Replay each owner's
  // original frame order so an ancestor cannot claim a nested JSX entry.
  for(const reference of references){const frame=resolved[reference.index];if(frame)matchFrame(reference.owner,frame);}
  const matchedPortals=new Set<string>();
  for(const {binding,frame}of portalFrames){
    if(matchedPortals.has(binding))continue;
    try{
      const file=await realpath(frame.file!.replace(/^file:\/\//,'')),local=relative(await realpath(root),file);
      if(isAbsolute(local)||local.startsWith('..')||(await stat(file)).size>512_000)continue;
      let source=portalSources.get(file);if(source===undefined){source=await readFile(file,'utf8');portalSources.set(file,source);}
      const kind=bindings.find(candidate=>candidate.id===binding)?.kind;
      const opening=kind==='ui-effect'?sourceUiOpenEffect(source,frame.lineNumber!,frame.column??0):undefined;
      const site=opening?`ui-effect:${opening.dependency}:${opening.method}`:kind==='portal'&&sourceUiPortal(source,frame.lineNumber!,frame.column??0)?'portal':undefined;
      if(site){matches.push({binding,site});matchedPortals.add(binding);}
    }catch{/* Unknown or unavailable source never enables a portal preview. */}
  }
  return matches;
}
