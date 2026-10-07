import ts from 'typescript';
import type {FlowStateExpression} from '../../shared/app-flow.ts';

export type StateDataResolver = (node:ts.Node)=>{file:string;name:string;path:string[]}|undefined;
export const unwrapStateNode = (node:ts.Node):ts.Node => {
  while(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isSatisfiesExpression(node)||ts.isTypeAssertionExpression(node))node=node.expression;
  return node;
};
const unwrap=unwrapStateNode;
const unknown:FlowStateExpression={unknown:true};
export const stateProperty=(name:ts.PropertyName)=>ts.isIdentifier(name)||ts.isStringLiteralLike(name)||ts.isNumericLiteral(name)?name.text:undefined;
const key=stateProperty;
export const statePropertyValue=(property:ts.ObjectLiteralElementLike)=>ts.isPropertyAssignment(property)?property.initializer:ts.isShorthandPropertyAssignment(property)&&!property.objectAssignmentInitializer?property.name:undefined;

/** Resolve lexical data reads without compiling or calling app code. */
export function stateExpressions(data?:StateDataResolver) {
  const scopes=new WeakMap<ts.Node,Map<string,ts.Identifier>>();
  const bind=(name:ts.BindingName,values:Map<string,ts.Identifier>)=>{
    if(ts.isIdentifier(name))values.set(name.text,name);
    else for(const item of name.elements)if(ts.isBindingElement(item))bind(item.name,values);
  };
  const scope=(node:ts.Node)=>{
    let values=scopes.get(node);if(values)return values;
    values=new Map();scopes.set(node,values);
    const collect=(child:ts.Node)=>{
      if(ts.isVariableDeclaration(child)||ts.isParameter(child))bind(child.name,values!);
      if(ts.isFunctionLike(child)||ts.isBlock(child))return;
      ts.forEachChild(child,collect);
    };
    ts.forEachChild(node,collect);return values;
  };
  const binding=(node:ts.Identifier)=>{
    for(let parent=node.parent;parent;parent=parent.parent)if(ts.isBlock(parent)||ts.isFunctionLike(parent)||ts.isSourceFile(parent)){
      const value=scope(parent).get(node.text);if(value)return value;
    }
  };
  const dataReads=new Map<string,{file:string;name:string}>();
  function external(node:ts.Node){
    let root=node;while(ts.isPropertyAccessExpression(root)||ts.isElementAccessExpression(root))root=root.expression;
    const local=ts.isIdentifier(root)&&binding(root);
    for(let parent=local&&local.parent;parent;parent=parent.parent)if(ts.isFunctionLike(parent))return;
    const value=data?.(node);if(!value)return;
    const {file,name,path}=value;if(path.some(part=>['__proto__','constructor','prototype'].includes(part)))return;
    const ref={file,name};dataReads.set(`${file}#${name}`,ref);
    return path.reduce<FlowStateExpression>((get,key)=>({get,key}),{data:ref});
  }
  function expression(node:ts.Node|undefined,env:Map<ts.Identifier,FlowStateExpression>,depth=0):FlowStateExpression {
    if(!node||depth>20)return unknown;node=unwrap(node);
    if(ts.isStringLiteralLike(node))return {value:node.text};
    if(ts.isNumericLiteral(node))return {value:Number(node.text)};
    if(node.kind===ts.SyntaxKind.TrueKeyword)return {value:true};
    if(node.kind===ts.SyntaxKind.FalseKeyword)return {value:false};
    if(node.kind===ts.SyntaxKind.NullKeyword)return {value:null};
    if(ts.isIdentifier(node))return node.text==='undefined'&&!binding(node)?{undefined:true}:env.get(binding(node)!)??external(node)??unknown;
    if(ts.isObjectLiteralExpression(node)){
      if(node.properties.length>64)return unknown;
      let fields:Record<string,FlowStateExpression>={};const parts:FlowStateExpression[]=[];
      for(const property of node.properties){
        if(ts.isSpreadAssignment(property)){
          if(Object.keys(fields).length){parts.push({object:fields});fields={};}
          parts.push(expression(property.expression,env,depth+1));continue;
        }
        const value=statePropertyValue(property),field=property.name&&key(property.name);
        if(!value||!field||['__proto__','constructor','prototype'].includes(field))return unknown;
        fields[field]=expression(value,env,depth+1);
      }
      if(!parts.length)return {object:fields};
      if(Object.keys(fields).length)parts.push({object:fields});
      return {merge:parts};
    }
    if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='Boolean'&&!binding(node.expression)&&node.arguments.length===1)return {op:'!',args:[{op:'!',args:[expression(node.arguments[0],env,depth+1)]}]};
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='has'&&node.arguments.length===1)return {has:expression(node.expression.expression,env,depth+1),item:expression(node.arguments[0],env,depth+1)};
    if(ts.isPropertyAccessExpression(node)||ts.isElementAccessExpression(node)){
      const part=ts.isPropertyAccessExpression(node)?node.name.text:node.argumentExpression&&(ts.isStringLiteralLike(node.argumentExpression)||ts.isNumericLiteral(node.argumentExpression))?node.argumentExpression.text:undefined;
      if(part===undefined||['__proto__','constructor','prototype'].includes(part))return unknown;
      let base:ts.Node=node;while(ts.isPropertyAccessExpression(base))base=base.expression;
      if(ts.isIdentifier(base)&&!env.has(binding(base)!)){const value=external(node);if(value)return value;}
      return {get:expression(node.expression,env,depth+1),key:part,...(node.questionDotToken?{optional:true}:{}),...(ts.isOptionalChain(node)?{chain:true}:{})};
    }
    if(ts.isConditionalExpression(node))return {op:'?',args:[expression(node.condition,env,depth+1),expression(node.whenTrue,env,depth+1),expression(node.whenFalse,env,depth+1)]};
    if(ts.isPrefixUnaryExpression(node)&&node.operator===ts.SyntaxKind.ExclamationToken)return {op:'!',args:[expression(node.operand,env,depth+1)]};
    if(ts.isBinaryExpression(node)){
      const operations=['===','!==','&&','||','??','<','<=','>','>='] as const;
      const op=operations.find(value=>value===node.operatorToken.getText());
      if(op)return {op,args:[expression(node.left,env,depth+1),expression(node.right,env,depth+1)]};
    }
    return unknown;
  }
  return {binding,expression,dataReads};
}
