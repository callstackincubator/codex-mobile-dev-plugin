import {relative} from 'node:path';
import ts from 'typescript';
import type {FlowPresentationAction,FlowPresentations} from '../../shared/app-flow.ts';
import type {SourceUnit} from './source-links.ts';

type Fn=ts.FunctionLikeDeclaration&{body:ts.ConciseBody};
const unwrap=(node:ts.Node):ts.Node=>{while(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isSatisfiesExpression(node)||ts.isTypeAssertionExpression(node))node=node.expression;return node;};
const walk=(node:ts.Node,visit:(node:ts.Node)=>void)=>{visit(node);ts.forEachChild(node,child=>walk(child,visit));};
const owner=(node:ts.Node):Fn|undefined=>{for(let p=node.parent;p;p=p.parent)if(ts.isFunctionLike(p)&&'body'in p&&p.body)return p as Fn;};
const name=(fn:Fn)=>{if(fn.name&&ts.isIdentifier(fn.name))return fn.name.text;for(let p:ts.Node=fn,i=0;p.parent&&i<5;p=p.parent,i++)if(ts.isVariableDeclaration(p.parent)&&ts.isIdentifier(p.parent.name))return p.parent.name.text;return 'default';};
const attribute=(node:ts.JsxOpeningLikeElement,key:string)=>node.attributes.properties.find((prop):prop is ts.JsxAttribute=>ts.isJsxAttribute(prop)&&prop.name.getText()===key);
const expression=(prop:ts.JsxAttribute|undefined)=>prop?.initializer&&ts.isJsxExpression(prop.initializer)?prop.initializer.expression:undefined;
const path=(node:ts.Node):string[]|undefined=>{node=unwrap(node);if(ts.isIdentifier(node))return [node.text];if(ts.isPropertyAccessExpression(node)&&!node.questionDotToken){const parent=path(node.expression);if(parent&&!['__proto__','constructor','prototype'].includes(node.name.text))return [...parent,node.name.text];}};
function binding(node:ts.Node,key:string):ts.Node|undefined {
  for(let scope=node.parent;scope;scope=scope.parent){
    if(!ts.isBlock(scope)&&!ts.isFunctionLike(scope)&&!ts.isSourceFile(scope))continue;
    const matches:ts.Node[]=[];
    const visit=(child:ts.Node)=>{if((ts.isVariableDeclaration(child)||ts.isParameter(child)||ts.isFunctionDeclaration(child))&&child.name&&ts.isIdentifier(child.name)&&child.name.text===key)matches.push(child);if(ts.isFunctionLike(child)||ts.isBlock(child))return;ts.forEachChild(child,visit);};
    ts.forEachChild(scope,visit);if(matches.length)return matches.length===1?matches[0]:undefined;
  }
}

/** Prove an entry wrapper's close-then-forward contract. The wrapper and its
 * incoming handler never run. Only an already mapped UI control can be closed. */
export function attachSourceHandoffs(catalog:FlowPresentations,units:Map<string,SourceUnit>,root:string,symbol:(unit:SourceUnit,name:string)=>string,platform:'ios'|'android') {
  const functions=new Map<string,Fn>(),fnUnits=new WeakMap<Fn,SourceUnit>(),jsx=new Map<SourceUnit,ts.JsxOpeningLikeElement[]>();
  for(const unit of units.values()){
    const elements:ts.JsxOpeningLikeElement[]=[];jsx.set(unit,elements);
    walk(unit.ast,node=>{
      if(ts.isFunctionLike(node)&&'body'in node&&node.body){const fn=node as Fn;fnUnits.set(fn,unit);functions.set(`${unit.file}#${name(fn)}`,fn);}
      if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))elements.push(node);
    });
  }
  const resolved=(unit:SourceUnit,key:string)=>{const id=symbol(unit,key),split=id.lastIndexOf('#');return {id,unit:units.get(id.slice(0,split)),key:id.slice(split+1)};};
  const callback=(unit:SourceUnit,node:ts.Node|undefined,depth=0):Fn|undefined=>{
    if(!node||depth>8)return;node=unwrap(node);
    if((ts.isArrowFunction(node)||ts.isFunctionExpression(node)||ts.isFunctionDeclaration(node))&&node.body)return node as Fn;
    if(ts.isIdentifier(node)){const local=binding(node,node.text);if(local&&ts.isVariableDeclaration(local))return callback(unit,local.initializer,depth+1);if(local&&ts.isFunctionDeclaration(local)&&local.body)return local as Fn;return functions.get(symbol(unit,node.text));}
    if(ts.isCallExpression(node)&&/^react#useCallback$/.test(symbol(unit,node.expression.getText())))return callback(unit,node.arguments[0],depth+1);
  };
  const finite=(unit:SourceUnit,node:ts.Node,seen=new Set<ts.Node>(),depth=0):unknown=>{
    if(depth>10||seen.has(node))return;seen=new Set(seen).add(node);node=unwrap(node);
    if(ts.isStringLiteralLike(node))return node.text;
    if(node.kind===ts.SyntaxKind.TrueKeyword)return true;if(node.kind===ts.SyntaxKind.FalseKeyword)return false;
    if(ts.isIdentifier(node)){
      const local=binding(node,node.text);if(local&&ts.isVariableDeclaration(local)&&local.initializer)return finite(unit,local.initializer,seen,depth+1);
      const target=resolved(unit,node.text),value=target.unit?.constants.get(target.key);if(target.unit&&value)return finite(target.unit,value,seen,depth+1);
    }
    if(ts.isPropertyAccessExpression(node)&&node.name.text==='OS'&&symbol(unit,node.expression.getText())==='react-native#Platform')return platform;
    if(ts.isPrefixUnaryExpression(node)&&node.operator===ts.SyntaxKind.ExclamationToken){const value=finite(unit,node.operand,seen,depth+1);return value===undefined?undefined:!value;}
    if(ts.isBinaryExpression(node)){
      const a=finite(unit,node.left,seen,depth+1),b=finite(unit,node.right,seen,depth+1);if(a===undefined||b===undefined)return;
      switch(node.operatorToken.kind){case ts.SyntaxKind.EqualsEqualsEqualsToken:return a===b;case ts.SyntaxKind.ExclamationEqualsEqualsToken:return a!==b;case ts.SyntaxKind.AmpersandAmpersandToken:return a&&b;case ts.SyntaxKind.BarBarToken:return a||b;}
    }
  };
  const statements=(unit:SourceUnit,node:ts.Node):ts.Node[]|undefined=>{
    node=unwrap(node);
    if(ts.isBlock(node)){const result:ts.Node[]=[];for(const statement of node.statements){const next=statements(unit,statement);if(!next)return;result.push(...next);}return result;}
    if(ts.isIfStatement(node)){const value=finite(unit,node.expression);if(typeof value!=='boolean')return;const branch=value?node.thenStatement:node.elseStatement;return branch?statements(unit,branch):[];}
    return [node];
  };
  const contextRead=(unit:SourceUnit,node:ts.Node,depth=0):boolean=>{
    if(depth>6)return false;node=unwrap(node);if(!ts.isCallExpression(node))return false;
    if(symbol(unit,node.expression.getText())==='react#useContext')return node.arguments.length===1;
    if(node.arguments.length)return false;
    const fn=functions.get(symbol(unit,node.expression.getText())),target=fn&&fnUnits.get(fn);if(!fn||!target)return false;
    const returns=ts.isBlock(fn.body)?fn.body.statements.filter(ts.isReturnStatement).flatMap(statement=>statement.expression?[statement.expression]:[]):[fn.body];
    if(returns.length!==1)return false;let result=unwrap(returns[0]);
    if(ts.isIdentifier(result)){const local=binding(result,result.text);if(local&&ts.isVariableDeclaration(local)&&local.initializer)result=unwrap(local.initializer);}
    return contextRead(target,result,depth+1);
  };
  const wrapperCache=new Map<string,{contextPath:string[];close:string}|null>();
  function wrapper(unit:SourceUnit,tag:string,prop:string) {
    const key=`${symbol(unit,tag)}:${prop}`;if(wrapperCache.has(key))return wrapperCache.get(key)??undefined;
    wrapperCache.set(key,null);
    const fn=functions.get(symbol(unit,tag)),target=fn&&fnUnits.get(fn);if(!fn||!target||!fn.parameters[0])return;
    const parameter=fn.parameters[0].name;let incoming:string[]|undefined;
    if(ts.isIdentifier(parameter))incoming=[parameter.text,prop];
    else if(ts.isObjectBindingPattern(parameter)){const field=parameter.elements.find(element=>(element.propertyName?.getText()??element.name.getText())===prop);if(field&&!field.initializer&&ts.isIdentifier(field.name))incoming=[field.name.text];}
    if(!incoming)return;
    const proofs:{contextPath:string[];close:string}[]=[];
    for(const element of jsx.get(target)??[]){
      if(owner(element)!==fn)continue;
      const handler=callback(target,expression(attribute(element,prop)));if(!handler||handler.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)||handler.parameters.length>1)continue;
      const event=handler.parameters[0]?.name;if(event&&!ts.isIdentifier(event))continue;
      const body=statements(target,handler.body);if(body?.length!==1)continue;
      const call=unwrap(ts.isExpressionStatement(body[0])?body[0].expression:body[0]);
      if(!ts.isCallExpression(call)||call.questionDotToken||!ts.isPropertyAccessExpression(call.expression)||call.expression.questionDotToken||!['close','dismiss','hide','collapse'].includes(call.expression.name.text)||call.arguments.length!==1)continue;
      const receiver=path(call.expression.expression),declaration=receiver&&binding(call,receiver[0]);
      if(!receiver||receiver.length>6||!declaration||!ts.isVariableDeclaration(declaration)||!declaration.initializer||!contextRead(target,declaration.initializer))continue;
      const forward=unwrap(call.arguments[0]);if(!ts.isArrowFunction(forward)&&!ts.isFunctionExpression(forward)||forward.parameters.length||forward.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword))continue;
      const forwarded=statements(target,forward.body);if(forwarded?.length!==1)continue;
      const invoke=unwrap(ts.isExpressionStatement(forwarded[0])?forwarded[0].expression:forwarded[0]);
      if(!ts.isCallExpression(invoke)||JSON.stringify(path(invoke.expression))!==JSON.stringify(incoming))continue;
      if(invoke.arguments.length!==(event?1:0)||event&&(!ts.isIdentifier(invoke.arguments[0])||invoke.arguments[0].text!==event.text))continue;
      proofs.push({contextPath:receiver.slice(1),close:call.expression.name.text});
    }
    if(proofs.length!==1)return;wrapperCache.set(key,proofs[0]);return proofs[0];
  }
  const location=(unit:SourceUnit,node:ts.Node)=>{
    let start=node.getStart();for(let parent:ts.Node=node;parent.parent&&!ts.isFunctionLike(parent.parent);parent=parent.parent){const next=parent.parent;if(ts.isConditionalExpression(next)){if(next.whenTrue===parent)start=next.condition.getStart();break;}if(ts.isBinaryExpression(next)&&next.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken&&next.right===parent){start=next.left.getStart();break;}}
    const a=unit.ast.getLineAndCharacterOfPosition(start),b=unit.ast.getLineAndCharacterOfPosition(node.getEnd());return {line:a.line+1,column:a.character,endLine:b.line+1,endColumn:b.character};
  };
  const relativeUnits=new Map([...units.values()].map(unit=>[relative(root,unit.file),unit]));
  for(const action of [...catalog.actions,...(catalog.previews??[])]){
    if(action.effect.kind!=='control'||!action.effect.target)continue;
    const target=action.effect.target,unit=relativeUnits.get(target.file);if(!unit)continue;
    const elements=jsx.get(unit)??[],targets=elements.filter(element=>owner(element)&&name(owner(element)!)===target.owner&&element.tagName.getText().split('.').at(-1)===action.effect.component&&unit.ast.getLineAndCharacterOfPosition(element.getStart()).line+1===target.line);
    if(targets.length!==1)continue;const node=targets[0],fn=owner(node),value=expression(attribute(node,action.effect.prop)),control=value&&path(value);if(!fn||!value||!control)continue;
    const declaration=binding(value,control[0]);if(!declaration)continue;
    const handoffs:NonNullable<FlowPresentationAction['handoffs']>=[];
    for(const element of elements){
      if(owner(element)!==fn)continue;
      for(const prop of element.attributes.properties.filter(ts.isJsxAttribute)){
        const event=prop.name.getText();if(!/^on(?:Press|Click)$/.test(event))continue;
        const proof=wrapper(unit,element.tagName.getText(),event),handler=callback(unit,expression(prop));if(!proof||!handler)continue;
        let opens=false;walk(handler.body,child=>{
          if(!ts.isCallExpression(child)||child.arguments.length||!ts.isPropertyAccessExpression(child.expression)||!['open','present','show','expand'].includes(child.expression.name.text))return;
          const receiver=path(child.expression.expression);if(receiver&&JSON.stringify(receiver)===JSON.stringify(control)&&binding(child,receiver[0])===declaration)opens=true;
        });
        if(opens)handoffs.push({file:target.file,owner:target.owner,component:element.tagName.getText().split('.').at(-1)!,prop:event,source:location(unit,element),...proof});
      }
    }
    if(handoffs.length)action.handoffs=handoffs.slice(0,20);
  }
}
