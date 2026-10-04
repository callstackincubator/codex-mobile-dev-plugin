import {createHash} from 'node:crypto';
import type {FlowPresentationAction,FlowPresentations,FlowStateSite} from '../../shared/app-flow.ts';

// Only finite presentation selectors become hook previews. Query results,
// identity fields and request/submit flags remain evidence, never capture state.
const protectedField=/token|password|secret|authorization|cookie|credential|authenticated|loggedin|signedin|session|identity|currentuser|accesskey|verified|captcha|challenge|account|mutation|submit|fetch|loading|pending|error|success|result|^data$|^status$|^(__proto__|constructor|prototype)$/i;
const selectorField=/step|screen|view|form|stage|page|panel|dialog|modal|phase|^id$/i;
const inlineBody=/^(?:View|Text|Button|Icon|Avatar|Fragment|ActivityIndicator)$|Skeleton|Shimmer|Loading|Spinner|EmptyState|ErrorMessage/;
const destination=(action:FlowPresentationAction)=>JSON.stringify(action.effect.kind==='state'?[action.effect.site,action.effect.path,action.effect.value]:[action.file,action.owner,action.effect]);
const id=(key:string)=>`preview-${createHash('sha256').update(key).digest('hex').slice(0,20)}`;

/** Compile conservative, source-bound preview plans. A plan is not proof that
 * its hook/control is mounted or that its real data can render a screenshot. */
export function addSourcePreviewPlans(catalog:FlowPresentations) {
  const sites=new Map((catalog.viewStates??[]).map(site=>[site.id,site]));
  const plans=new Map<string,FlowPresentationAction>();
  for(const view of catalog.views??[]){
    const base={id:'',file:view.file,line:view.line,owner:view.owner,component:view.name,prop:'',name:view.name,preview:true,views:[view.id]};
    let action:FlowPresentationAction|undefined;
    if(view.state){
      const site=sites.get(view.state.site),field=view.state.path.at(-1)??site?.valueName;
      if(!site?.hook||!field||view.state.path.some(part=>protectedField.test(part)||/^(?:auth|user)$/.test(part))||protectedField.test(field)||protectedField.test(site.valueName??'')||/^use.*(?:Session|Account|Auth|Query|Mutation)/.test(site.owner))continue;
      const value=view.state.value;
      if(!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))continue;
      if(!selectorField.test(field))continue;
      if(typeof value==='boolean'&&!/open|visible|show|view|screen|dialog|modal/i.test(field))continue;
      if(!view.components.length||view.components.every(c=>inlineBody.test(c.component)))continue;
      const component=view.components.find(c=>!inlineBody.test(c.component)&&c.component!=='default')?.component??view.name;
      action={...base,name:component,component,effect:{kind:'state',...view.state}};
      if(site.owner!==view.owner||site.file!==view.file){
        const component=catalog.views?.find(v=>v.kind==='component'&&v.owner===view.owner&&v.file===view.file);
        const entries=component?.entries?.flatMap(entry=>entry.source?[{file:entry.file,owner:entry.owner,source:entry.source}]:[])??[];
        if(!entries.length)continue;
        action.consumer={component:view.owner,entries};
      }
    }else if(view.control?.boundary){
      // Method discovery happens on the exact mounted controller. It requires
      // a known open/close pair and a zero-argument opening function.
      action={...base,effect:{kind:'control',component:view.control.component,prop:view.control.prop,method:'auto',close:['close','dismiss','hide','collapse'],target:{file:view.file,owner:view.owner,line:view.line,source:view.source}}};
    }
    if(!action)continue;
    const key=destination(action),existing=plans.get(key);
    if(existing){existing.views!.push(view.id);continue;}
    action.id=id(key);plans.set(key,action);
  }
  // Retain source state metadata when the older, opener-based scan has the same
  // hook. Custom-hook consumer names let runtime tracking find its actual owner.
  const states=new Map<string,FlowStateSite>();
  for(const plan of plans.values())if(plan.effect.kind==='state'){const site=sites.get(plan.effect.site)!;states.set(site.id,site);}
  catalog.previewStates=[...states.values()];
  catalog.previews=[...plans.values()];
  return catalog;
}
