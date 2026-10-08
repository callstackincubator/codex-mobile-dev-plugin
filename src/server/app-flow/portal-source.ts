import ts from 'typescript';

const unwrap=(node:ts.Node):ts.Node=>{
  while(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isTypeAssertionExpression(node))node=node.expression;
  return node;
};
const called=(node:ts.Node,name:string)=>{
  node=unwrap(node);
  return ts.isIdentifier(node)?node.text===name:ts.isPropertyAccessExpression(node)&&node.name.text===name;
};

/** The provider value's attach and detach property names, when proven. */
export type UiPortalMethods = {append: string; remove: string};
function contextRendersChildren(fn:ts.FunctionLikeDeclaration,context:ts.VariableDeclaration,appendName:string,removeName:string):UiPortalMethods|false{
  if(!context.initializer||!ts.isObjectBindingPattern(context.name))return false;
  const call=unwrap(context.initializer);if(!ts.isCallExpression(call)||!call.arguments[0]||!ts.isIdentifier(call.arguments[0]))return false;
  const contextName=call.arguments[0].text;
  const member=(name:string)=>context.name.elements.find(element=>ts.isIdentifier(element.name)&&element.name.text===name)?.propertyName?.getText()??name;
  let scope:ts.Node=fn.parent;while(scope.parent&&!ts.isBlock(scope)&&!ts.isSourceFile(scope))scope=scope.parent;
  const providers:ts.JsxOpeningLikeElement[]=[];
  const visit=(node:ts.Node)=>{if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText()===contextName+'.Provider')providers.push(node);ts.forEachChild(node,visit)};visit(scope);
  for(const provider of providers){
    let owner:ts.Node|undefined=provider.parent;while(owner&&!ts.isFunctionLike(owner))owner=owner.parent;
    if(!owner||!('body'in owner)||!owner.body||!ts.isBlock(owner.body))continue;
    const declarations=owner.body.statements.filter(ts.isVariableStatement).flatMap(statement=>[...statement.declarationList.declarations]);
    const initial=(name:string)=>declarations.find(declaration=>ts.isIdentifier(declaration.name)&&declaration.name.text===name)?.initializer;
    const value=provider.attributes.properties.find(attr=>ts.isJsxAttribute(attr)&&attr.name.getText()==='value');
    if(!value||!ts.isJsxAttribute(value)||!value.initializer||!ts.isJsxExpression(value.initializer)||!value.initializer.expression)continue;
    let object=unwrap(value.initializer.expression);if(ts.isIdentifier(object)){const init=initial(object.text);if(!init)continue;object=unwrap(init)}
    if(ts.isCallExpression(object)&&called(object.expression,'useMemo')){
      const callback=object.arguments[0]&&unwrap(object.arguments[0]);if(!callback||!ts.isArrowFunction(callback))continue;object=unwrap(callback.body);
    }
    if(!ts.isObjectLiteralExpression(object))continue;
    const property=(name:string)=>{const prop=object.properties.find(prop=>prop.name?.getText()===name);return prop&&ts.isShorthandPropertyAssignment(prop)?prop.name:prop&&ts.isPropertyAssignment(prop)?prop.initializer:undefined};
    const append=property(member(appendName)),remove=property(member(removeName));
    if(!append||!remove||!ts.isIdentifier(append)||!ts.isIdentifier(remove))continue;
    const callback=(name:string)=>{let expression=initial(name);if(!expression)return;expression=unwrap(expression);if(ts.isCallExpression(expression)&&called(expression.expression,'useCallback'))expression=expression.arguments[0]&&unwrap(expression.arguments[0]);return expression&&(ts.isArrowFunction(expression)||ts.isFunctionExpression(expression))?expression:undefined};
    const attach=callback(append.text),detach=callback(remove.text);if(!attach||!detach||attach.parameters.length<2||!ts.isIdentifier(attach.parameters[1].name))continue;
    const child=attach.parameters[1].name.text,setters=new Set<string>();
    for(const declaration of declarations)if(ts.isArrayBindingPattern(declaration.name)&&declaration.initializer){
      const initializer=unwrap(declaration.initializer),[state,setter]=declaration.name.elements;
      if(!ts.isCallExpression(initializer)||!called(initializer.expression,'useState')||!state||!setter||!ts.isBindingElement(state)||!ts.isBindingElement(setter)||!ts.isIdentifier(state.name)||!ts.isIdentifier(setter.name))continue;
      if(object.properties.some(prop=>ts.isShorthandPropertyAssignment(prop)&&prop.name.text===state.name.text||ts.isPropertyAssignment(prop)&&ts.isIdentifier(prop.initializer)&&prop.initializer.text===state.name.text))setters.add(setter.name.text);
    }
    let storesChild=false,showsState=false,clearsState=false;
    const containsChild=(node:ts.Node)=>{let found=false;const visit=(node:ts.Node)=>{if(ts.isJsxExpression(node)&&node.expression&&unwrap(node.expression).getText()===child)found=true;ts.forEachChild(node,visit)};visit(node);return found};
    const inspect=(node:ts.Node,removing=false)=>{
      if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&(ts.isJsxElement(node.right)||ts.isJsxFragment(node.right))&&containsChild(node.right))storesChild=true;
      if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&setters.has(node.expression.text)&&node.arguments[0]&&(ts.isJsxElement(node.arguments[0])||ts.isJsxFragment(node.arguments[0]))){if(removing)clearsState=true;else showsState=true;}
      ts.forEachChild(node,child=>inspect(child,removing));
    };
    inspect(attach.body);inspect(detach.body,true);if(storesChild&&showsState&&clearsState)return {append:member(appendName),remove:member(removeName)};
  }
  return false;
}

/** Prove a null-rendering portal attaches its children through one context and
 * removes the same entry on cleanup. Returns the provider value's method names.
 * A preview calls the attach method only on a provider inside its own copy. */
export function sourceUiPortal(source:string,line:number,column=0):UiPortalMethods|false{
  if(source.length>512_000||!Number.isInteger(line)||line<1)return false;
  const ast=ts.createSourceFile('portal.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  if(line>ast.getLineStarts().length||!Number.isInteger(column)||column<0)return false;
  const start=ast.getLineStarts()[line-1],end=ast.getLineStarts()[line]??source.length;
  if(start+column>end)return false;
  const position=ast.getPositionOfLineAndCharacter(line-1,column),functions:ts.FunctionLikeDeclaration[]=[];
  const visit=(node:ts.Node)=>{if(ts.isFunctionLike(node)&&'body'in node&&node.body&&node.getStart()<=position&&position<node.getEnd())functions.push(node);ts.forEachChild(node,visit)};
  visit(ast);
  // Metro can resolve an effect call to the callback's first column. Find
  // the owning null-rendering component, not that nested callback's body.
  const fn=functions.reverse().find(fn=>{
    if(!('body'in fn)||!fn.body||!ts.isBlock(fn.body))return false;
    const last=fn.body.statements.at(-1);
    return !!last&&ts.isReturnStatement(last)&&!!last.expression&&unwrap(last.expression).kind===ts.SyntaxKind.NullKeyword;
  });
  if(!fn||!('body'in fn)||!fn.body||!ts.isBlock(fn.body))return false;
  const last=fn.body.statements.at(-1);
  if(!last||!ts.isReturnStatement(last)||!last.expression||unwrap(last.expression).kind!==ts.SyntaxKind.NullKeyword)return false;
  const parameter=fn.parameters[0];if(!parameter||!ts.isObjectBindingPattern(parameter.name))return false;
  const child=parameter.name.elements.find(element=>(element.propertyName??element.name).getText()==='children');
  if(!child||!ts.isIdentifier(child.name))return false;
  const childName=child.name.text,contexts=new Map<string,ts.VariableDeclaration>();
  for(const statement of fn.body.statements)if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations){
    if(!ts.isObjectBindingPattern(declaration.name)||!declaration.initializer)continue;
    const call=unwrap(declaration.initializer);if(!ts.isCallExpression(call)||!called(call.expression,'useContext'))continue;
    for(const element of declaration.name.elements)if(ts.isIdentifier(element.name))contexts.set(element.name.text,declaration);
  }
  for(const statement of fn.body.statements){
    if(!ts.isExpressionStatement(statement))continue;
    const call=unwrap(statement.expression);if(!ts.isCallExpression(call)||!called(call.expression,'useEffect'))continue;
    const effect=call.arguments[0]&&unwrap(call.arguments[0]);
    if(!effect||!ts.isArrowFunction(effect)&&!ts.isFunctionExpression(effect)||!ts.isBlock(effect.body)||effect.body.statements.length!==2)continue;
    const [attach,remove]=effect.body.statements;
    if(!ts.isExpressionStatement(attach)||!ts.isReturnStatement(remove)||!remove.expression)continue;
    const append=unwrap(attach.expression),cleanup=unwrap(remove.expression);
    if(!ts.isCallExpression(append)||!ts.isIdentifier(append.expression)||append.arguments.length!==2||unwrap(append.arguments[1]).getText()!==childName)continue;
    if(!ts.isArrowFunction(cleanup)&&!ts.isFunctionExpression(cleanup)||ts.isBlock(cleanup.body))continue;
    const detached=unwrap(cleanup.body);
    if(!ts.isCallExpression(detached)||!ts.isIdentifier(detached.expression)||detached.arguments.length!==1)continue;
    if(append.arguments[0].getText()!==detached.arguments[0].getText()||append.expression.text===detached.expression.text)continue;
    const context=contexts.get(append.expression.text);
    const methods=context&&contexts.get(detached.expression.text)===context&&contextRendersChildren(fn,context,append.expression.text,detached.expression.text);
    if(methods)return methods;
  }
  return false;
}
