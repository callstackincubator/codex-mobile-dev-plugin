import ts from 'typescript';
import type {FlowOpeningData,FlowStateExpression,FlowStateSite} from '../../shared/app-flow.ts';
import type {SourceUnit} from './source-links.ts';
import {stateExpressions,unwrapStateNode} from './state-expressions-source.ts';

type Fn=ts.FunctionLikeDeclaration & {body:ts.ConciseBody};
type State={site:FlowStateSite;unit:SourceUnit;setterNode:ts.Identifier};
type Operation=(unit:SourceUnit,node:ts.Node)=>{unit:SourceUnit;fn:Fn}|undefined;
const unwrap=unwrapStateNode,unknown:FlowStateExpression={unknown:true};
const and=(a:FlowStateExpression,b:FlowStateExpression):FlowStateExpression=>({op:'&&',args:[a,b]});
const not=(a:FlowStateExpression):FlowStateExpression=>({op:'!',args:[a]});

/** Read a UI setter's real argument through source-resolved helpers. The
 * handler, helper functions, reducer and unrelated effects never execute. */
export function openingData(unit:SourceUnit,handler:Fn,render:Fn,entry:ts.Node,states:State[],operation:Operation) {
  const {binding,expression}=stateExpressions(),locals=new Set<string>();
  const results:{state:State;input:FlowOpeningData}[]=[];
  let budget=300;
  const read=(node:ts.Node|undefined,env:Map<ts.Identifier,FlowStateExpression>)=>{
    const captured=new Map(env);
    const visit=(node:ts.Node)=>{
      if(ts.isIdentifier(node)){
        const bound=binding(node);
        if(bound&&!captured.has(bound)&&bound.getStart()<entry.getStart()){
          for(let parent=bound.parent;parent;parent=parent.parent)if(ts.isFunctionLike(parent)){
            if(parent===render){locals.add(node.text);captured.set(bound,{get:{input:'locals'},key:node.text});}break;
          }
        }
      }
      ts.forEachChild(node,visit);
    };
    if(node)visit(node);return expression(node,captured);
  };
  const variables=(statement:ts.Statement,env:Map<ts.Identifier,FlowStateExpression>)=>{
    if(!ts.isVariableStatement(statement)||!(statement.declarationList.flags&ts.NodeFlags.Const))return false;
    for(const declaration of statement.declarationList.declarations){
      if(!ts.isIdentifier(declaration.name))return false;
      env.set(declaration.name,read(declaration.initializer,env));
    }
    return true;
  };
  // Updaters may retain the existing open view. Preserve that condition rather
  // than forcing a new payload into an already open form.
  const returned=(node:ts.Node,env:Map<ts.Identifier,FlowStateExpression>,fallback:FlowStateExpression=unknown):FlowStateExpression=>{
    if(--budget<0)return unknown;
    if(ts.isReturnStatement(node))return read(node.expression,env);
    if(ts.isIfStatement(node))return {op:'?',args:[read(node.expression,env),returned(node.thenStatement,new Map(env),fallback),node.elseStatement?returned(node.elseStatement,new Map(env),fallback):fallback]};
    if(!ts.isBlock(node))return read(node,env);
    const walk=(index:number,values:Map<ts.Identifier,FlowStateExpression>):FlowStateExpression=>{
      if(--budget<0)return unknown;
      const statement=node.statements[index];if(!statement)return fallback;
      if(variables(statement,values))return walk(index+1,values);
      if(ts.isReturnStatement(statement))return returned(statement,values);
      if(ts.isIfStatement(statement))return returned(statement,values,walk(index+1,new Map(values)));
      return unknown;
    };
    return walk(0,new Map(env));
  };
  const follow=(unit:SourceUnit,fn:Fn,env:Map<ts.Identifier,FlowStateExpression>,when:FlowStateExpression,seen:Set<Fn>,depth=0)=>{
    if(depth>5||seen.has(fn)||--budget<0)return;
    seen=new Set(seen).add(fn);
    const visit=(node:ts.Node,values:Map<ts.Identifier,FlowStateExpression>,condition:FlowStateExpression)=>{
      if(--budget<0)return;
      if(ts.isBlock(node)){
        let current=condition;
        for(const statement of node.statements){
          if(variables(statement,values))continue;
          if(ts.isReturnStatement(statement)){if(statement.expression)visit(statement.expression,values,current);break;}
          if(ts.isIfStatement(statement)){
            const test=read(statement.expression,values);
            visit(statement.thenStatement,new Map(values),and(current,test));
            if(statement.elseStatement)visit(statement.elseStatement,new Map(values),and(current,not(test)));
            // Only a simple exit can constrain subsequent statements. Other
            // branch returns are not sufficient proof of a later opening.
            const exits=(part:ts.Node)=>ts.isReturnStatement(part)||ts.isBlock(part)&&part.statements.length===1&&ts.isReturnStatement(part.statements[0]);
            if(exits(statement.thenStatement)&&!statement.elseStatement)current=and(current,not(test));
            else {let exit=false;const check=(part:ts.Node)=>{if(ts.isFunctionLike(part))return;if(ts.isReturnStatement(part))exit=true;ts.forEachChild(part,check);};check(statement);if(exit)break;}
            continue;
          }
          visit(statement,values,current);
        }
        return;
      }
      if(ts.isExpressionStatement(node)){visit(node.expression,values,condition);return;}
      node=unwrap(node);if(!ts.isCallExpression(node))return;
      const setter=ts.isIdentifier(node.expression)&&binding(node.expression);
      const state=setter&&states.find(state=>state.unit===unit&&state.setterNode===setter&&state.site.paths.some(path=>!path.length));
      if(state){
        if(node.arguments.length!==1)return;
        const arg=unwrap(node.arguments[0]);let value:FlowStateExpression;
        if(ts.isArrowFunction(arg)||ts.isFunctionExpression(arg)){
          if(arg.parameters.length!==1||!ts.isIdentifier(arg.parameters[0].name)||arg.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword))return;
          const next=new Map(values);next.set(arg.parameters[0].name,{get:{input:'state'},key:'current'});value=returned(arg.body,next);
        }else value=read(arg,values);
        results.push({state,input:{value,when:condition,locals:[]}});return;
      }
      const remote=operation(unit,node.expression);if(!remote)return;
      const next=new Map<ts.Identifier,FlowStateExpression>();
      for(const [index,parameter]of remote.fn.parameters.entries()){
        if(!ts.isIdentifier(parameter.name)||parameter.dotDotDotToken)return;
        next.set(parameter.name,read(node.arguments[index],values));
      }
      follow(remote.unit,remote.fn,next,condition,seen,depth+1);
    };
    visit(fn.body,new Map(env),when);
  };
  follow(unit,handler,new Map(),{value:true},new Set());
  if(budget<0||locals.size>32||results.length!==1)return;
  const result=results[0];result.input.locals=[...locals];
  const text=JSON.stringify(result.input);
  if(text.length>24000||!text.includes('"input":"locals"'))return;
  return result;
}
