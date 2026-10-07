import ts from 'typescript';
import type {FlowStateExpression,FlowStateSite,FlowStateSync} from '../../shared/app-flow.ts';
import {protectedPreviewField} from './preview-plans.ts';
import {stateExpressions,stateProperty,unwrapStateNode} from './state-expressions-source.ts';

type Fn=ts.FunctionLikeDeclaration & {body:ts.ConciseBody};
const unwrap=unwrapStateNode;
const hasPayload=(node:FlowStateExpression):boolean=>!!node&&typeof node==='object'&&('input'in node&&node.input==='payload'||Object.values(node).some(value=>Array.isArray(value)?value.some(hasPayload):value&&typeof value==='object'&&hasPayload(value as FlowStateExpression)));
const conjunction=(a:FlowStateExpression,b:FlowStateExpression):FlowStateExpression=>({op:'&&',args:[a,b]});

/** Copy proven query/prop data into a temporary local reducer. Neither the
 * source effect nor the reducer, including its logging and mutations, runs. */
export function stateSyncs(site:FlowStateSite,call:ts.CallExpression,render:Fn,reducer:Fn,isEffect:(node:ts.CallExpression)=>boolean):FlowStateSync[] {
  const tuple=call.parent;
  if(!ts.isVariableDeclaration(tuple)||!ts.isArrayBindingPattern(tuple.name)||!ts.isBlock(reducer.body))return [];
  const dispatch=tuple.name.elements[1],state=reducer.parameters[0]?.name,action=reducer.parameters[1]?.name;
  if(!dispatch||!ts.isBindingElement(dispatch)||!ts.isIdentifier(dispatch.name)||!state||!action||!ts.isIdentifier(state)||!ts.isIdentifier(action))return [];
  const {binding,expression}=stateExpressions();
  const env=new Map<ts.Identifier,FlowStateExpression>([[state,{input:'state'}],[action,{input:'payload'}]]);
  const patches=new Map<string,Record<string,FlowStateExpression>>();
  let clone:ts.Identifier|undefined;
  for(const statement of reducer.body.statements){
    if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations){
      const initial=declaration.initializer&&unwrap(declaration.initializer);
      if(ts.isIdentifier(declaration.name)&&initial&&ts.isObjectLiteralExpression(initial)&&initial.properties.length===1){
        const spread=initial.properties[0];
        if(ts.isSpreadAssignment(spread)&&ts.isIdentifier(spread.expression)&&binding(spread.expression)===state)clone=declaration.name;
      }
    }
    if(!ts.isSwitchStatement(statement))continue;
    const discriminant=unwrap(statement.expression);
    if(!ts.isPropertyAccessExpression(discriminant)||!ts.isIdentifier(discriminant.expression)||binding(discriminant.expression)!==action||discriminant.name.text!=='type')continue;
    for(const clause of statement.caseBlock.clauses){
      if(!ts.isCaseClause(clause)||!ts.isStringLiteralLike(clause.expression))continue;
      const statements=clause.statements.length===1&&ts.isBlock(clause.statements[0])?clause.statements[0].statements:clause.statements;
      const patch:Record<string,FlowStateExpression>={};let valid=true;
      const field=(key:string|undefined,value:ts.Node)=>{
        if(!key||protectedPreviewField.test(key))return;
        const read=expression(value,env);
        // Only assignments that read the real payload become data transfers.
        // Fixed flags remain unchanged.
        if(hasPayload(read))patch[key]=read;
      };
      for(const item of statements){
        if(ts.isBreakStatement(item))break;
        if(ts.isReturnStatement(item)&&item.expression){
          const result=unwrap(item.expression);
          if(!ts.isObjectLiteralExpression(result)){valid=false;break;}
          const spread=result.properties[0];
          if(!spread||!ts.isSpreadAssignment(spread)||!ts.isIdentifier(spread.expression)||binding(spread.expression)!==state){valid=false;break;}
          for(const property of result.properties.slice(1)){
            if(!ts.isPropertyAssignment(property)){valid=false;break;}
            field(stateProperty(property.name),property.initializer);
          }
          break;
        }
        const value=ts.isExpressionStatement(item)?unwrap(item.expression):undefined;
        if(value&&ts.isCallExpression(value))continue;
        if(!clone||!value||!ts.isBinaryExpression(value)||value.operatorToken.kind!==ts.SyntaxKind.EqualsToken||!ts.isPropertyAccessExpression(value.left)||!ts.isIdentifier(value.left.expression)||binding(value.left.expression)!==clone){valid=false;break;}
        field(value.left.name.text,value.right);
      }
      if(valid&&Object.keys(patch).length&&Object.keys(patch).length<=32)patches.set(clause.expression.text,patch);
    }
  }
  if(!patches.size)return [];
  const result:FlowStateSync[]=[];
  const visit=(node:ts.Node)=>{
    if(result.length>=16)return;
    if(ts.isCallExpression(node)&&isEffect(node)){
      const callback=node.arguments[0]&&unwrap(node.arguments[0]);
      if(!callback||!ts.isArrowFunction(callback)&&!ts.isFunctionExpression(callback)||callback.parameters.length||callback.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword))return;
      const localEnv=new Map<ts.Identifier,FlowStateExpression>(),locals=new Set<string>();
      const capture=(part:ts.Node)=>{
        if(ts.isIdentifier(part)){
          const declaration=binding(part);
          if(declaration&&declaration!==dispatch.name&&declaration.getStart()<node.getStart())for(let parent:ts.Node|undefined=declaration.parent;parent;parent=parent.parent)if(parent===render){
            locals.add(part.text);localEnv.set(declaration,{get:{input:'locals'},key:part.text});break;
          }
        }
        ts.forEachChild(part,capture);
      };
      capture(callback.body);
      if(locals.size>32)return;
      const updates:FlowStateSync['updates']=[];
      const compile=(part:ts.Node,when:FlowStateExpression):boolean=>{
        if(ts.isBlock(part))return part.statements.every(statement=>compile(statement,when));
        if(ts.isIfStatement(part)){
          const condition=expression(part.expression,localEnv);
          return compile(part.thenStatement,conjunction(when,condition))&&(!part.elseStatement||compile(part.elseStatement,conjunction(when,{op:'!',args:[condition]})));
        }
        if(ts.isExpressionStatement(part))part=unwrap(part.expression);
        if(!ts.isCallExpression(part)||!ts.isIdentifier(part.expression)||binding(part.expression)!==dispatch.name||part.arguments.length!==1)return false;
        const payload=unwrap(part.arguments[0]);if(!ts.isObjectLiteralExpression(payload))return false;
        const type=payload.properties.find(property=>ts.isPropertyAssignment(property)&&stateProperty(property.name)==='type');
        if(!type||!ts.isPropertyAssignment(type)||!ts.isStringLiteralLike(type.initializer))return false;
        const patch=patches.get(type.initializer.text);if(!patch)return true;
        const fields:Record<string,FlowStateExpression>={};
        for(const property of payload.properties){
          if(!ts.isPropertyAssignment(property)||!stateProperty(property.name)||['__proto__','constructor','prototype'].includes(stateProperty(property.name)!))return false;
          fields[stateProperty(property.name)!]=expression(property.initializer,localEnv);
        }
        updates.push({when,payload:fields,patch});return updates.length<=16;
      };
      if(!compile(callback.body,{value:true})||!updates.length)return;
      const start=node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());
      const used=new Set<string>();
      const readLocals=(value:unknown)=>{if(!value||typeof value!=='object')return;const node=value as {get?:{input?:string};key?:string};if(node.get?.input==='locals'&&node.key)used.add(node.key);for(const child of Object.values(value))readLocals(child);};
      readLocals(updates);
      result.push({line:start.line+1,column:start.character,dispatch:dispatch.name.text,locals:[...locals].filter(name=>used.has(name)),updates});return;
    }
    if(ts.isFunctionLike(node))return;
    ts.forEachChild(node,visit);
  };
  ts.forEachChild(render.body,visit);
  return result;
}
