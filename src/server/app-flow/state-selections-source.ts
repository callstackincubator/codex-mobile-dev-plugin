import {createHash} from 'node:crypto';
import ts from 'typescript';
import type {FlowStateExpression, FlowStateSelection, FlowStateSite} from '../../shared/app-flow.ts';
import {protectedPreviewField} from './preview-plans.ts';

type Fn = ts.FunctionLikeDeclaration & {body: ts.ConciseBody};
const unwrap = (node: ts.Node): ts.Node => {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) node=node.expression;
  return node;
};
const walk = (node: ts.Node, visit: (node: ts.Node) => void) => {visit(node);ts.forEachChild(node,child=>walk(child,visit));};
const unknown: FlowStateExpression = {unknown:true};
const key = (name: ts.PropertyName) => ts.isIdentifier(name)||ts.isStringLiteralLike(name)||ts.isNumericLiteral(name)?name.text:undefined;

/** Compile data reads and object patches, never a handler or reducer call. */
export function stateSelections(site: FlowStateSite, call: ts.CallExpression, render: Fn, reducer: Fn): FlowStateSelection[] {
  const tuple=call.parent;
  if(!ts.isVariableDeclaration(tuple)||!ts.isArrayBindingPattern(tuple.name))return [];
  const dispatch=tuple.name.elements[1];
  if(!dispatch||!ts.isBindingElement(dispatch)||!ts.isIdentifier(dispatch.name)||!ts.isBlock(reducer.body))return [];
  const state=reducer.parameters[0]?.name,action=reducer.parameters[1]?.name;
  if(!state||!action||!ts.isIdentifier(state)||!ts.isIdentifier(action))return [];
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
  function expression(node:ts.Node|undefined,env:Map<ts.Identifier,FlowStateExpression>,depth=0):FlowStateExpression {
    if(!node||depth>20)return unknown;node=unwrap(node);
    if(ts.isStringLiteralLike(node))return {value:node.text};
    if(ts.isNumericLiteral(node))return {value:Number(node.text)};
    if(node.kind===ts.SyntaxKind.TrueKeyword)return {value:true};
    if(node.kind===ts.SyntaxKind.FalseKeyword)return {value:false};
    if(node.kind===ts.SyntaxKind.NullKeyword)return {value:null};
    if(ts.isIdentifier(node))return node.text==='undefined'&&!binding(node)?{undefined:true}:env.get(binding(node)!)??unknown;
    if(ts.isPropertyAccessExpression(node)||ts.isElementAccessExpression(node)){
      const part=ts.isPropertyAccessExpression(node)?node.name.text:node.argumentExpression&&(ts.isStringLiteralLike(node.argumentExpression)||ts.isNumericLiteral(node.argumentExpression))?node.argumentExpression.text:undefined;
      if(part===undefined||['__proto__','constructor','prototype'].includes(part))return unknown;
      return {get:expression(node.expression,env,depth+1),key:part};
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
  const reducerEnv=new Map<ts.Identifier,FlowStateExpression>([[state,{input:'state'}],[action,{input:'payload'}]]);
  const variables=(statement:ts.Statement,env:Map<ts.Identifier,FlowStateExpression>)=>{
    if(!ts.isVariableStatement(statement)||!(statement.declarationList.flags&ts.NodeFlags.Const))return false;
    for(const declaration of statement.declarationList.declarations){
      if(!ts.isIdentifier(declaration.name))return false;
      env.set(declaration.name,expression(declaration.initializer,env));
    }
    return true;
  };
  const patches=new Map<string,Record<string,FlowStateExpression>>();
  for(const statement of reducer.body.statements){
    if(variables(statement,reducerEnv))continue;
    if(!ts.isSwitchStatement(statement))break;
    const discriminant=unwrap(statement.expression);
    if(!ts.isPropertyAccessExpression(discriminant)||!ts.isIdentifier(discriminant.expression)||binding(discriminant.expression)!==action||discriminant.name.text!=='type')break;
    for(const clause of statement.caseBlock.clauses){
      if(!ts.isCaseClause(clause)||!ts.isStringLiteralLike(clause.expression))continue;
      const statements=clause.statements.length===1&&ts.isBlock(clause.statements[0])?clause.statements[0].statements:clause.statements;
      const env=new Map(reducerEnv);let result:ts.ObjectLiteralExpression|undefined;
      for(const item of statements){
        if(variables(item,env))continue;
        if(ts.isReturnStatement(item)&&item.expression&&ts.isObjectLiteralExpression(unwrap(item.expression)))result=unwrap(item.expression) as ts.ObjectLiteralExpression;
        break;
      }
      if(!result||!result.properties.length||result.properties.length>33)continue;
      const spread=result.properties[0];
      if(!ts.isSpreadAssignment(spread)||!ts.isIdentifier(spread.expression)||binding(spread.expression)!==state)continue;
      const patch:Record<string,FlowStateExpression>={};let valid=true;
      for(const property of result.properties.slice(1)){
        if(!ts.isPropertyAssignment(property)||!key(property.name)||protectedPreviewField.test(key(property.name)!)){valid=false;break;}
        patch[key(property.name)!]=expression(property.initializer,env);
      }
      if(valid&&Object.keys(patch).length)patches.set(clause.expression.text,patch);
    }
    break;
  }
  if(!patches.size)return [];
  const selections:FlowStateSelection[]=[];
  walk(render.body,node=>{
    if(selections.length>=64||!ts.isJsxOpeningElement(node)&&!ts.isJsxSelfClosingElement(node))return;
    const attributes=node.attributes.properties.filter(ts.isJsxAttribute);
    for(const attribute of attributes){
      if(!/^on[A-Z]/.test(attribute.name.getText())||!attribute.initializer||!ts.isJsxExpression(attribute.initializer)||!attribute.initializer.expression)continue;
      const callback=unwrap(attribute.initializer.expression);
      if(!ts.isArrowFunction(callback)&&!ts.isFunctionExpression(callback)||callback.parameters.length||callback.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword))continue;
      let body:ts.Node=callback.body;
      if(ts.isBlock(body)){
        if(body.statements.length!==1)continue;
        const statement=body.statements[0];
        if(ts.isExpressionStatement(statement))body=statement.expression;
        else if(ts.isReturnStatement(statement)&&statement.expression)body=statement.expression;
        else continue;
      }
      body=unwrap(body);
      if(!ts.isCallExpression(body)||!ts.isIdentifier(body.expression)||binding(body.expression)!==dispatch.name||body.arguments.length!==1)continue;
      const payload=unwrap(body.arguments[0]);if(!ts.isObjectLiteralExpression(payload))continue;
      const type=payload.properties.find(p=>ts.isPropertyAssignment(p)&&key(p.name)==='type');
      if(!type||!ts.isPropertyAssignment(type)||!ts.isStringLiteralLike(type.initializer))continue;
      const patch=patches.get(type.initializer.text);if(!patch)continue;
      const env=new Map<ts.Identifier,FlowStateExpression>();
      for(const prop of attributes){
        if(/^on[A-Z]/.test(prop.name.getText())||!prop.initializer||!ts.isJsxExpression(prop.initializer)||!prop.initializer.expression)continue;
        const value=unwrap(prop.initializer.expression);
        if(ts.isIdentifier(value)){const bound=binding(value);if(bound)env.set(bound,{get:{input:'props'},key:prop.name.getText()});}
      }
      const fields:Record<string,FlowStateExpression>={};let valid=true;
      for(const property of payload.properties){
        if(!ts.isPropertyAssignment(property)||!key(property.name)||['__proto__','constructor','prototype'].includes(key(property.name)!)){valid=false;break;}
        fields[key(property.name)!]=expression(property.initializer,env);
      }
      if(!valid)continue;
      const ast=node.getSourceFile(),start=ast.getLineAndCharacterOfPosition(node.getStart()),end=ast.getLineAndCharacterOfPosition(node.getEnd());
      const source={line:start.line+1,column:start.character,endLine:end.line+1,endColumn:end.character};
      selections.push({id:createHash('sha256').update(JSON.stringify([site.id,source,attribute.name.getText()])).digest('hex').slice(0,20),file:site.file,owner:site.owner,component:node.tagName.getText().split('.').at(-1)!,source,payload:fields,patch});
    }
  });
  return selections;
}
