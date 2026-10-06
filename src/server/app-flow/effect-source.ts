import ts from 'typescript';

const unwrap=(node:ts.Node):ts.Node=>{
  while(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isTypeAssertionExpression(node))node=node.expression;
  return node;
};

/** Accept only an effect that opens its dependency's UI control, directly or
 * through a cancellable timer. No other call, write or getter can run. */
export function sourceUiOpenEffect(source:string,line:number,column=0):{dependency:number;method:string}|undefined {
  if(source.length>512_000||!Number.isInteger(line)||line<1||!Number.isInteger(column)||column<0)return;
  const ast=ts.createSourceFile('effect.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  if(line>ast.getLineStarts().length)return;
  const start=ast.getLineStarts()[line-1],end=ast.getLineStarts()[line]??source.length;
  if(start+column>end)return;
  const position=start+column,react=new Set<string>(),namespaces=new Set<string>();
  for(const statement of ast.statements)if(ts.isImportDeclaration(statement)&&ts.isStringLiteral(statement.moduleSpecifier)&&statement.moduleSpecifier.text==='react'){
    const bindings=statement.importClause?.namedBindings;
    if(bindings&&ts.isNamespaceImport(bindings))namespaces.add(bindings.name.text);
    if(statement.importClause?.name)namespaces.add(statement.importClause.name.text);
    if(bindings&&ts.isNamedImports(bindings))for(const name of bindings.elements)if(['useEffect','useLayoutEffect'].includes(name.propertyName?.text??name.name.text))react.add(name.name.text);
  }
  const calls:ts.CallExpression[]=[];
  const visit=(node:ts.Node)=>{
    if(ts.isCallExpression(node)&&node.getStart()<=position&&position<node.getEnd()){
      const callee=node.expression;
      if(ts.isIdentifier(callee)&&react.has(callee.text)||ts.isPropertyAccessExpression(callee)&&ts.isIdentifier(callee.expression)&&namespaces.has(callee.expression.text)&&['useEffect','useLayoutEffect'].includes(callee.name.text))calls.push(node);
    }
    ts.forEachChild(node,visit);
  };visit(ast);
  const call=calls.at(-1),callback=call?.arguments[0]&&unwrap(call.arguments[0]),deps=call?.arguments[1]&&unwrap(call.arguments[1]);
  if(!callback||!deps||!ts.isArrayLiteralExpression(deps)||!ts.isArrowFunction(callback)&&!ts.isFunctionExpression(callback)||callback.parameters.length||callback.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword))return;
  // A local replacement of the timer API can perform arbitrary app work.
  for(let scope:ts.Node|undefined=call;scope;scope=scope.parent)if(ts.isFunctionLike(scope)||ts.isSourceFile(scope)){
    let shadowed=false;
    const binding=(node:ts.Node)=>{
      if((ts.isVariableDeclaration(node)||ts.isParameter(node)||ts.isFunctionDeclaration(node)||ts.isImportSpecifier(node))&&node.name&&['setTimeout','clearTimeout'].includes(node.name.getText()))shadowed=true;
      if(ts.isFunctionLike(node)&&node!==scope)return;
      ts.forEachChild(node,binding);
    };binding(scope);if(shadowed)return;
  }
  const dependencies=deps.elements.map(dep=>ts.isIdentifier(dep)?dep.text:undefined);
  let target:string|undefined,method:string|undefined,opens=0;
  const timers=new Set<string>();
  const identifier=(node:ts.Node)=>ts.isIdentifier(unwrap(node))?(unwrap(node)as ts.Identifier).text:undefined;
  const condition=(node:ts.Node):boolean=>{
    node=unwrap(node);
    return ts.isIdentifier(node)&&dependencies.includes(node.text)&&node.text!==target||ts.isPrefixUnaryExpression(node)&&node.operator===ts.SyntaxKind.ExclamationToken&&condition(node.operand);
  };
  const open=(node:ts.Node):boolean=>{
    node=unwrap(node);
    if(!ts.isCallExpression(node)||node.arguments.length||node.questionDotToken||!ts.isPropertyAccessExpression(node.expression)||node.expression.questionDotToken||!ts.isIdentifier(node.expression.expression))return false;
    const name=node.expression.expression.text,key=node.expression.name.text;
    if(!['open','present','show','expand'].includes(key)||!dependencies.includes(name)||target&&target!==name||method&&method!==key)return false;
    target=name;method=key;opens++;return true;
  };
  const cleanup=(node:ts.Node):boolean=>{
    node=unwrap(node);
    if(!ts.isArrowFunction(node)&&!ts.isFunctionExpression(node)||node.parameters.length||node.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword))return false;
    const body=unwrap(node.body),statements=ts.isBlock(body)?body.statements:[body];
    return statements.length>0&&statements.every(statement=>{
      const call=unwrap(ts.isExpressionStatement(statement)?statement.expression:statement);
      return ts.isCallExpression(call)&&ts.isIdentifier(call.expression)&&call.expression.text==='clearTimeout'&&call.arguments.length===1&&timers.has(identifier(call.arguments[0])??'');
    });
  };
  const body=(node:ts.Node):boolean=>{
    node=unwrap(node);
    if(ts.isBlock(node)){
      const local=node.statements.filter(ts.isVariableStatement).flatMap(statement=>[...statement.declarationList.declarations].flatMap(declaration=>ts.isIdentifier(declaration.name)?[declaration.name.text]:[]));
      if(!node.statements.length||!node.statements.every(body))return false;
      const added=local.filter(timer=>timers.has(timer));
      return !added.length||node.statements.some(statement=>ts.isReturnStatement(statement)&&!!statement.expression&&cleanup(statement.expression));
    }
    if(ts.isExpressionStatement(node))return open(node.expression);
    if(ts.isIfStatement(node))return condition(node.expression)&&body(node.thenStatement)&&(!node.elseStatement||body(node.elseStatement));
    if(ts.isReturnStatement(node))return !!node.expression&&cleanup(node.expression);
    if(ts.isVariableStatement(node)&&node.declarationList.flags&ts.NodeFlags.Const&&node.declarationList.declarations.length===1){
      const declaration=node.declarationList.declarations[0],init=declaration.initializer&&unwrap(declaration.initializer);
      if(!ts.isIdentifier(declaration.name)||!init||!ts.isCallExpression(init)||!ts.isIdentifier(init.expression)||init.expression.text!=='setTimeout'||init.arguments.length!==2)return false;
      const callback=unwrap(init.arguments[0]),delay=unwrap(init.arguments[1]);
      if(!ts.isArrowFunction(callback)&&!ts.isFunctionExpression(callback)||callback.parameters.length||callback.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword))return false;
      const inner=unwrap(callback.body),statement=ts.isBlock(inner)&&inner.statements.length===1?inner.statements[0]:inner;
      if(!open(ts.isExpressionStatement(statement)?statement.expression:statement)||!ts.isNumericLiteral(delay)&&!(ts.isIdentifier(delay)&&dependencies.includes(delay.text)))return false;
      timers.add(declaration.name.text);return true;
    }
    return open(node);
  };
  if(!body(callback.body)||!target||!method||!opens)return;
  // Every timer must have a matching cleanup, including each conditional path.
  if(timers.size){
    const cleaned=new Set<string>();const inspect=(node:ts.Node)=>{if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='clearTimeout'&&node.arguments.length===1){const name=identifier(node.arguments[0]);if(name)cleaned.add(name);}ts.forEachChild(node,inspect);};inspect(callback.body);
    if([...timers].some(timer=>!cleaned.has(timer)))return;
  }
  return {dependency:dependencies.indexOf(target),method};
}
