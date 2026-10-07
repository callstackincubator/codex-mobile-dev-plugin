import {createHash} from 'node:crypto';
import ts from 'typescript';
import type {FlowGraph,FlowPresentationAction,FlowPresentations,FlowStateSite} from '../../shared/app-flow.ts';

// Only finite presentation selectors become hook previews. Query results,
// identity fields and request/submit flags remain evidence, never capture state.
export const protectedPreviewField=/token|password|secret|authorization|cookie|credential|authenticated|loggedin|signedin|session|identity|currentuser|accesskey|verified|captcha|challenge|account|mutation|submit|fetch|loading|pending|error|success|result|^data$|^status$|^(__proto__|constructor|prototype)$/i;
const inlineBody=/^(?:View|Text|Button|Icon|Avatar|Fragment|ActivityIndicator)$|Skeleton|Shimmer|Loading|Spinner|EmptyState|ErrorMessage/;
const destination=(action:FlowPresentationAction)=>JSON.stringify(action.effect.kind==='state'?[action.effect.site,action.effect.path,action.effect.value]:[action.file,action.owner,action.effect]);
const id=(key:string)=>`preview-${createHash('sha256').update(key).digest('hex').slice(0,20)}`;

// A UI selector cannot reveal a progress-only branch without changing a
// separate request flag. Keep its source evidence, but do not queue it as a view.
function requiresProgress(branch:import('../../shared/app-flow.ts').FlowSourceView['branch']) {
  if(!branch||branch.side==='case')return false;
  const ast=ts.createSourceFile('condition.ts',`const condition=(${branch.condition});`,ts.ScriptTarget.Latest,true);
  const statement=ast.statements[0];
  if(!statement||!ts.isVariableStatement(statement))return false;
  const expression=statement.declarationList.declarations[0]?.initializer;if(!expression)return false;
  const progress=/^(?:is)?(?:pending|loading|fetching|submitting|mutating|busy)$/i;
  const required=(node:ts.Expression,positive:boolean):boolean=>{
    if(ts.isParenthesizedExpression(node))return required(node.expression,positive);
    if(ts.isPrefixUnaryExpression(node)&&node.operator===ts.SyntaxKind.ExclamationToken)return required(node.operand,!positive);
    if(ts.isIdentifier(node)||ts.isPropertyAccessExpression(node))return positive&&progress.test(ts.isIdentifier(node)?node.text:node.name.text);
    if(!ts.isBinaryExpression(node))return false;
    const op=node.operatorToken.kind;
    if(op===ts.SyntaxKind.AmpersandAmpersandToken||op===ts.SyntaxKind.BarBarToken){
      const a=required(node.left,positive),b=required(node.right,positive);
      return (op===ts.SyntaxKind.AmpersandAmpersandToken)===positive?a||b:a&&b;
    }
    if(op!==ts.SyntaxKind.EqualsEqualsEqualsToken&&op!==ts.SyntaxKind.ExclamationEqualsEqualsToken)return false;
    const boolean=(value:ts.Expression)=>value.kind===ts.SyntaxKind.TrueKeyword?true:value.kind===ts.SyntaxKind.FalseKeyword?false:undefined;
    const left=boolean(node.left),right=boolean(node.right),value=left??right;
    if(value===undefined)return false;
    return required(left===undefined?node.left:node.right,(op===ts.SyntaxKind.EqualsEqualsEqualsToken)===positive?value:!value);
  };
  return required(expression,branch.side==='true');
}

/** Compile conservative, source-bound preview plans. A plan is not proof that
 * its hook/control is mounted or that its real data can render a screenshot. */
export function addSourcePreviewPlans(catalog:FlowPresentations, navigators:FlowGraph['nodes']=[]) {
  const sites=new Map((catalog.viewStates??[]).map(site=>[site.id,site]));
  const plans=new Map<string,FlowPresentationAction>();
  const booleanSelectors=new Set(catalog.actions.filter(action=>action.effect.kind==='state'&&typeof action.effect.value==='boolean')
    .map(action=>action.effect.kind==='state'?JSON.stringify([action.effect.site,action.effect.path]):''));
  const ownersBySource=new Map((catalog.views??[]).filter(view=>view.kind==='component').map(view=>[JSON.stringify([view.file,view.owner]),view]));
  for(const view of catalog.views??[]){
    const base={id:'',file:view.file,line:view.line,owner:view.owner,component:view.name,prop:'',name:view.name,preview:true,views:[view.id]};
    let action:FlowPresentationAction|undefined;
    if(view.state){
      const site=sites.get(view.state.site),field=view.state.path.at(-1)??site?.valueName;
      if(!site?.hook||!field||view.state.path.some(part=>protectedPreviewField.test(part)||/^(?:auth|user)$/.test(part))||protectedPreviewField.test(field)||protectedPreviewField.test(site.valueName??'')||/^use.*(?:Session|Account|Auth|Query|Mutation)/.test(site.owner))continue;
      const value=view.state.value;
      if(!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))continue;
      // Keep each render origin separate. A row callback can use the same
      // selector before the full form, but cannot serve as that form's owner.
      const candidates=(view.renders??[view]).flatMap(render=>{
        if(requiresProgress(render.branch))return [];
        if(typeof value==='boolean'&&!/open|visible|show|view|screen|dialog|modal/i.test(field)&&
          !(render.renderBody&&booleanSelectors.has(JSON.stringify([view.state!.site,view.state!.path]))))return [];
        const target=render.components.filter(c=>!inlineBody.test(c.component)&&c.component!=='default')
          .sort((a,b)=>(a.guards??0)-(b.guards??0))[0];
        const component=target?.component;
        if(!component)return [];
        const local=site.owner===render.owner&&site.file===render.file;
        const entries=local?undefined:ownersBySource.get(JSON.stringify([render.file,render.owner]))?.entries
          ?.flatMap(entry=>entry.source?[{file:entry.file,owner:entry.owner,source:entry.source}]:[]);
        if(!local&&!entries?.length)return [];
        return [{render,component,target,local,entries,rank:(render.renderBody?0:2)+(local?0:1),guards:target?.guards??0}];
      }).sort((a,b)=>a.rank-b.rank||a.guards-b.guards);
      const selected=candidates[0];if(!selected)continue;
      const {render,component,target,entries}=selected;
      action={...base,file:render.file,line:render.line,owner:render.owner,name:component,component,effect:{kind:'state',...view.state},
        ...(target?.entry?{expected:{component,file:target.entry.file,owner:render.owner,source:target.entry.source,...(!render.renderBody||render.source.line!==target.entry.source.line||render.source.column!==target.entry.source.column?{scope:'owner' as const}:{})}}:{}),
        ...(!selected.local?{consumer:{component:render.owner,entries:entries!}}:{})};
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
  // A finite form owner may never mount in this session. Preview only an
  // exported owner with an ordinary render that accepts omitted props. Its
  // local steps are discovered after it mounts; no module factory is executed.
  const owners=new Set([...plans.values()].filter(plan=>plan.effect.kind==='state').map(plan=>JSON.stringify([plan.file,plan.owner])));
  for(const view of catalog.views??[]){
    if(view.kind!=='component'||!view.mount||!owners.has(JSON.stringify([view.file,view.owner]))||protectedPreviewField.test(view.owner))continue;
    const effect={kind:'mount' as const,file:view.file,export:view.mount.export};
    const key=JSON.stringify([view.file,view.owner,effect]);
    plans.set(key,{id:id(key),file:view.file,line:view.line,owner:view.owner,component:view.owner,prop:'',name:view.owner,preview:true,views:[view.id],effect});
  }
  // A gate above navigation can return a complete page without a local UI
  // selector. Render its exported body as a contained preview using the live
  // context. The gate's account/request condition remains unchanged.
  const componentViews=new Map<string,NonNullable<FlowPresentations['views']>[number]>();
  const sourceKey=(file:string,component:string)=>JSON.stringify([file,component]);
  for(const view of catalog.views??[])if(view.kind==='component'){
    componentViews.set(sourceKey(view.file,view.owner),view);
    if(view.mount)componentViews.set(sourceKey(view.file,view.mount.export),view);
  }
  const parents=new Map<string,Set<string>>();
  for(const view of catalog.views??[])if(view.kind==='component')for(const child of view.components){
    const target=componentViews.get(sourceKey(child.file,child.component));
    const key=sourceKey(target?.file??child.file,target?.owner??child.component);
    const owners=parents.get(key)??new Set<string>();owners.add(sourceKey(view.file,view.owner));parents.set(key,owners);
  }
  const navigationOwners=new Set<string>();
  for(const navigator of navigators)if(navigator.kind==='navigator'&&navigator.file){
    const component=navigator.definition?.split('#').at(-1)??navigator.component??navigator.name;
    navigationOwners.add(sourceKey(navigator.file,component));
  }
  const queue=[...navigationOwners];
  for(let index=0;index<queue.length;index++)for(const parent of parents.get(queue[index])??[])if(!navigationOwners.has(parent)){navigationOwners.add(parent);queue.push(parent);}
  for(const branch of catalog.views??[]){
    if(branch.kind!=='branch'||!branch.branch||branch.components.length!==1||!navigationOwners.has(sourceKey(branch.file,branch.owner))||!protectedPreviewField.test(branch.branch.condition)||requiresProgress(branch.branch))continue;
    const target=branch.components[0],body=componentViews.get(sourceKey(target.file,target.component));
    if(!body?.mount||inlineBody.test(body.owner))continue;
    const effect={kind:'mount' as const,file:body.file,export:body.mount.export};
    const key=JSON.stringify([body.file,body.owner,effect]),existing=plans.get(key);
    if(existing){existing.views=[...new Set([...(existing.views??[]),body.id,branch.id])];continue;}
    plans.set(key,{id:id(key),file:body.file,line:body.line,owner:body.owner,component:body.owner,prop:'',name:body.owner,preview:true,views:[body.id,branch.id],effect});
  }
  // Retain source state metadata when the older, opener-based scan has the same
  // hook. Custom-hook consumer names let runtime tracking find its actual owner.
  const states=new Map<string,FlowStateSite>();
  for(const plan of plans.values())if(plan.effect.kind==='state'){const site=sites.get(plan.effect.site)!;states.set(site.id,site);}
  catalog.previewStates=[...states.values()];
  catalog.previews=[...plans.values()];
  return catalog;
}
