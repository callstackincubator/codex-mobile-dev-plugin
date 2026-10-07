import { createHash } from 'node:crypto';
import { relative } from 'node:path';
import ts from 'typescript';
import type { FlowPresentations, FlowPresentationAction, FlowStateSite, FlowUiCondition } from '../../shared/app-flow.ts';
import type { SourceUnit } from './source-links.ts';
import {openingData} from './opening-data-source.ts';
import {stateExpressions} from './state-expressions-source.ts';

type Unit = SourceUnit;
type Fn = ts.FunctionLikeDeclaration & {body: ts.ConciseBody};
type State = {site: FlowStateSite; value: string; setter: string; setterNode: ts.Identifier; fn: Fn; unit: Unit};
type Transition = {state: State; path: string[]; value: unknown};
const bad = /token|password|secret|authorization|cookie|credential|authenticated|loggedin|signedin|session|identity|currentUser|accessKey|^(__proto__|constructor|prototype)$/i;
const unwrap = (node: ts.Node): ts.Node => {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) node = node.expression;
  return node;
};
const key = (text: string) => createHash('sha256').update(text).digest('hex').slice(0,20);
const attributes = (node: ts.JsxOpeningLikeElement) => node.attributes.properties.filter(ts.isJsxAttribute);
const expression = (node: ts.JsxAttribute) => node.initializer && ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined;
const head = (node: ts.Node) => node.getText().replace(/\?\./g,'.').split('.')[0];
const method = (node: ts.Node) => ts.isPropertyAccessExpression(node) ? node.name.text : ts.isIdentifier(node) ? node.text : '';
function owner(node: ts.Node): Fn | undefined {
  for (let parent = node.parent; parent; parent = parent.parent) if (ts.isFunctionLike(parent) && 'body' in parent && parent.body) return parent as Fn;
}
function functionName(fn: Fn): string {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  let parent: ts.Node = fn;
  for (let i=0; parent.parent && i<4; i++,parent=parent.parent) {
    if(ts.isFunctionLike(parent.parent))break;
    if (ts.isVariableDeclaration(parent.parent) && ts.isIdentifier(parent.parent.name)) return parent.parent.name.text;
  }
  return 'default';
}
function components(node: ts.Node): string[] {
  const result = new Set<string>();
  const visit = (child: ts.Node) => {
    if (ts.isFunctionLike(child)) return;
    if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
      const name = child.tagName.getText(); if (/^[A-Z]/.test(name)) result.add(name.split('.').at(-1)!);
    }
    ts.forEachChild(child,visit);
  }; visit(node); return [...result];
}

/** Source evidence for presentation only. No project modules or expressions run. */
export function scanPresentations(units: Map<string,Unit>, root: string, symbol: (unit: Unit, name: string) => string): FlowPresentations {
  const {binding:stateBinding}=stateExpressions();
  const states: State[] = [], functions = new Map<string,Fn>(), enums = new Map<string,Map<string,unknown>>();
  const guards = new Map<string,Set<string>>();
  const views=new Map<string,{unit:Unit;node:ts.ConditionalExpression;name:string;path:string[]}[]>();
  const functionUnits = new WeakMap<ts.Node,Unit>();
  const walk = (node: ts.Node, visit: (node: ts.Node)=>void) => { visit(node); ts.forEachChild(node,child=>walk(child,visit)); };
  for (const unit of units.values()) walk(unit.ast,node=>{
    if (ts.isEnumDeclaration(node)) {
      const values = new Map<string,unknown>(); let next=0;
      for(const member of node.members){const value=member.initializer && ts.isStringLiteralLike(member.initializer) ? member.initializer.text : member.initializer && ts.isNumericLiteral(member.initializer) ? Number(member.initializer.text) : next;values.set(member.name.getText().replace(/^['"]|['"]$/g,''),value);if(typeof value==='number')next=value+1;}
      enums.set(`${unit.file}#${node.name.text}`,values);
    }
    if(ts.isFunctionLike(node) && 'body' in node && node.body){const fn=node as Fn;functionUnits.set(fn,unit);functions.set(`${unit.file}#${functionName(fn)}`,fn);}
    if (!ts.isVariableDeclaration(node) || !ts.isArrayBindingPattern(node.name) || !node.initializer) return;
    const call=unwrap(node.initializer);if(!ts.isCallExpression(call))return;
    const resolved=symbol(unit,call.expression.getText());
    if(!/^react#useState$/.test(resolved))return;
    const [value,setter]=node.name.elements;
    if(!value||!setter||!ts.isBindingElement(value)||!ts.isBindingElement(setter)||!ts.isIdentifier(value.name)||!ts.isIdentifier(setter.name))return;
    const fn=owner(node);if(!fn)return;
    const start=unit.ast.getLineAndCharacterOfPosition(call.getStart()),end=unit.ast.getLineAndCharacterOfPosition(call.getEnd());
    states.push({unit,fn,value:value.name.text,setter:setter.name.text,setterNode:setter.name,site:{id:key(`${relative(root,unit.file)}:${call.pos}`),file:relative(root,unit.file),line:start.line+1,column:start.character,endLine:end.line+1,owner:functionName(fn),paths:[]}});
  });
  function known(unit:Unit,node:ts.Node|undefined,env:Map<string,unknown>,depth=0):boolean{
    if(!node||depth>12)return false;node=unwrap(node);
    if(ts.isIdentifier(node))return env.has(node.text)||node.text==='undefined'||known(unit,unit.constants.get(node.text),env,depth+1);
    if(ts.isStringLiteralLike(node)||ts.isNumericLiteral(node)||[ts.SyntaxKind.TrueKeyword,ts.SyntaxKind.FalseKeyword,ts.SyntaxKind.NullKeyword].includes(node.kind))return true;
    if(ts.isPrefixUnaryExpression(node))return known(unit,node.operand,env,depth+1);
    if(ts.isCallExpression(node)&&node.expression.getText()==='Boolean')return known(unit,node.arguments[0],env,depth+1);
    if(ts.isPropertyAccessExpression(node))return enums.has(symbol(unit,node.expression.getText()))||known(unit,node.expression,env,depth+1);
    if(ts.isBinaryExpression(node)){if(!known(unit,node.left,env,depth+1))return false;const left=constant(unit,node.left,env,depth+1);if(node.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken&&!left||node.operatorToken.kind===ts.SyntaxKind.BarBarToken&&left)return true;return known(unit,node.right,env,depth+1);}
    if(ts.isObjectLiteralExpression(node))return node.properties.every(p=>ts.isPropertyAssignment(p)&&known(unit,p.initializer,env,depth+1));
    return false;
  }
  function constant(unit: Unit,node: ts.Node|undefined,env=new Map<string,unknown>(),depth=0): unknown {
    if(!node||depth>12)return undefined;node=unwrap(node);
    if(ts.isIdentifier(node)){if(env.has(node.text))return env.get(node.text);return constant(unit,unit.constants.get(node.text),env,depth+1);}
    if(ts.isStringLiteralLike(node))return node.text;
    if(ts.isNumericLiteral(node))return Number(node.text);
    if(node.kind===ts.SyntaxKind.TrueKeyword)return true;if(node.kind===ts.SyntaxKind.FalseKeyword)return false;if(node.kind===ts.SyntaxKind.NullKeyword)return null;
    if(ts.isPrefixUnaryExpression(node)&&node.operator===ts.SyntaxKind.ExclamationToken)return !known(unit,node.operand,env,depth+1)?undefined:!constant(unit,node.operand,env,depth+1);
    if(ts.isCallExpression(node)&&node.expression.getText()==='Boolean')return !known(unit,node.arguments[0],env,depth+1)?undefined:!!constant(unit,node.arguments[0],env,depth+1);
    if(ts.isBinaryExpression(node)){if(!known(unit,node,env,depth+1))return undefined;const a=constant(unit,node.left,env,depth+1),b=constant(unit,node.right,env,depth+1);switch(node.operatorToken.kind){case ts.SyntaxKind.AmpersandAmpersandToken:return a&&b;case ts.SyntaxKind.BarBarToken:return a||b;case ts.SyntaxKind.EqualsEqualsEqualsToken:return a===b;case ts.SyntaxKind.ExclamationEqualsEqualsToken:return a!==b;}}
    if(ts.isPropertyAccessExpression(node)){const values=enums.get(symbol(unit,node.expression.getText()));if(values)return values.get(node.name.text);const value=constant(unit,node.expression,env,depth+1);return value && typeof value==='object' ? (value as Record<string,unknown>)[node.name.text] : undefined;}
    if(ts.isObjectLiteralExpression(node)){const value:Record<string,unknown>={};for(const prop of node.properties){if(!ts.isPropertyAssignment(prop)||ts.isComputedPropertyName(prop.name))return undefined;const name=prop.name.getText().replace(/^['"]|['"]$/g,'');if(bad.test(name))return undefined;const v=constant(unit,prop.initializer,env,depth+1);if(v===undefined)return undefined;value[name]=v;}return value;}
  }
  const lexical = (node: ts.Node, name: string): ts.Node|undefined => {
    for(let scope=node.parent;scope;scope=scope.parent){if(!ts.isBlock(scope)&&!ts.isFunctionLike(scope)&&!ts.isSourceFile(scope))continue;let found:ts.Node|undefined;
      const visit=(child:ts.Node)=>{if(ts.isFunctionDeclaration(child)&&child.name?.text===name)found=child;if(ts.isVariableDeclaration(child)&&ts.isIdentifier(child.name)&&child.name.text===name)found=child.initializer;if(ts.isFunctionLike(child)||ts.isBlock(child))return;ts.forEachChild(child,visit);};ts.forEachChild(scope,visit);if(found)return found;
    }
  };
  const callback = (unit:Unit,node:ts.Node|undefined,depth=0):Fn|undefined => {
    if(!node||depth>12)return;node=unwrap(node);
    if(ts.isIdentifier(node)){const local=lexical(node,node.text);if(local&&local!==node)return callback(unit,local,depth+1);return functions.get(symbol(unit,node.text));}
    if(ts.isCallExpression(node) && node.arguments[0]) return callback(unit,node.arguments[0],depth+1);
    if((ts.isArrowFunction(node)||ts.isFunctionExpression(node)||ts.isFunctionDeclaration(node))&&node.body)return node as Fn;
  };
  // Context values can carry a local presentation guard to another component.
  const contextStates = new Map<string,{state:State;path:string[]}>();
  const contextReaders = new Map<string,string>();
  for(const unit of units.values()) walk(unit.ast,node=>{
    if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)) && /\.Provider$/.test(node.tagName.getText())){
      const value=attributes(node).find(a=>a.name.getText()==='value');const exp=value&&expression(value);
      if(exp&&ts.isIdentifier(exp)){const state=states.find(s=>s.unit===unit&&s.value===exp.text&&s.fn===owner(node));if(state)contextStates.set(symbol(unit,node.tagName.getText().replace(/\.Provider$/,'')),{state,path:[]});}
    }
    if(ts.isCallExpression(node)&&method(node.expression)==='useContext'&&node.arguments[0]){
      const fn=owner(node);if(fn)contextReaders.set(`${unit.file}#${functionName(fn)}`,symbol(unit,node.arguments[0].getText()));
    }
  });
  const addGuard = (state:State,path:string[],label:string[],value?:unknown) => {
    if(path.some(p=>bad.test(p))||bad.test(state.value))return;
    const p=path.join('.');const names=guards.get(`${state.site.id}:${p}`)??new Set<string>();for(const name of label)names.add(name);guards.set(`${state.site.id}:${p}`,names);
    if(value!==undefined)guards.set(`${state.site.id}:${p}:${JSON.stringify(value)}`,new Set(label));
    if(!state.site.paths.some(item=>item.join('.')===p))state.site.paths.push(path);
  };
  for(const unit of units.values()){
    const aliases = new Map<ts.Identifier,{state:State;path:string[]}>();
    walk(unit.ast,node=>{
      if(!ts.isVariableDeclaration(node)||!node.initializer||!ts.isCallExpression(unwrap(node.initializer)))return;
      const call=unwrap(node.initializer) as ts.CallExpression;const ctx=contextStates.get(contextReaders.get(symbol(unit,call.expression.getText()))??'');if(!ctx)return;
      if(ts.isIdentifier(node.name))aliases.set(node.name,ctx);
      if(ts.isObjectBindingPattern(node.name))for(const e of node.name.elements)if(ts.isIdentifier(e.name))aliases.set(e.name,{state:ctx.state,path:[e.propertyName?.getText()??e.name.text]});
    });
    walk(unit.ast,node=>{
      let condition:ts.Node|undefined,body:ts.Node|undefined;
      if(ts.isConditionalExpression(node)){condition=node.condition;body=node;}
      if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken){condition=node.left;body=node.right;}
      if(ts.isIfStatement(node)){condition=node.expression;body=node.thenStatement;}
      if(ts.isSwitchStatement(node)){condition=node.expression;body=node.caseBlock;}
      if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&attributes(node).some(a=>['visible','isOpen','open'].includes(a.name.getText()))){const attr=attributes(node).find(a=>['visible','isOpen','open'].includes(a.name.getText()))!;condition=expression(attr);body=node.parent;}
      if(condition&&ts.isIdentifier(condition)&&!aliases.has(stateBinding(condition)!)){const local=lexical(condition,condition.text);if(local)condition=local;}
      while(condition&&ts.isPrefixUnaryExpression(condition)&&condition.operator===ts.SyntaxKind.ExclamationToken)condition=condition.operand;
      if(!condition||!body)return;const names=components(body);if(!names.length)return;
      walk(condition,ref=>{
        if(!ts.isIdentifier(ref)||ts.isPropertyAccessExpression(ref.parent)&&ref.parent.name===ref)return;
        let expr:ts.Node=ref,path:string[]=[];while(ts.isPropertyAccessExpression(expr.parent)&&expr.parent.expression===expr){path.push(expr.parent.name.text);expr=expr.parent;}
        const state=states.find(s=>s.unit===unit&&s.value===ref.text&&s.fn===owner(ref));const alias=aliases.get(stateBinding(ref)!);
        let selected=names,value:unknown;
        if(ts.isBinaryExpression(condition!)&&[ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.EqualsEqualsToken].includes(condition!.operatorToken.kind)){
          value=constant(unit,condition!.right);if(value===undefined)value=constant(unit,condition!.left);
          if(ts.isConditionalExpression(node))selected=components(node.whenTrue);
        }else if(ts.isIdentifier(condition!)||ts.isPropertyAccessExpression(condition!)){
          value=true;if(ts.isConditionalExpression(node))selected=components(node.whenTrue);
        }
        const matched=state??alias?.state,matchedPath=state?path:alias?[...alias.path,...path]:[];
        if(matched){addGuard(matched,matchedPath,selected,value);if(ts.isConditionalExpression(node)){const k=`${matched.site.id}:${matchedPath.join('.')}`,list=views.get(k)??[];list.push({unit,node,name:ref.text,path});views.set(k,list);}}
      });
    });
  }
  // Resolve finite local setter calls, including helpers exported through context.
  const controlContexts = new Map<string,Map<string,{fn:Fn;unit:Unit}>>();
  for(const unit of units.values())walk(unit.ast,node=>{
    if(!ts.isJsxOpeningElement(node)&&!ts.isJsxSelfClosingElement(node)||!/\.Provider$/.test(node.tagName.getText()))return;
    const value=attributes(node).find(a=>a.name.getText()==='value'),exp=value&&expression(value);if(!exp)return;
    let object:ts.Node|undefined=unwrap(exp);
    if(ts.isIdentifier(object))object=lexical(object,object.text);
    if(object&&ts.isCallExpression(unwrap(object))){const fn=callback(unit,object);if(fn)object=ts.isBlock(fn.body)?fn.body.statements.find(ts.isReturnStatement)?.expression:fn.body;}
    if(!object||!ts.isObjectLiteralExpression(unwrap(object)))return;
    const entries=new Map<string,{fn:Fn;unit:Unit}>();
    for(const prop of (unwrap(object) as ts.ObjectLiteralExpression).properties){
      const value=ts.isShorthandPropertyAssignment(prop)?prop.name:ts.isPropertyAssignment(prop)?prop.initializer:undefined;
      const fn=ts.isMethodDeclaration(prop)&&prop.body?prop as Fn:callback(unit,value);if(fn)entries.set(prop.name!.getText().replace(/^['"]|['"]$/g,''),{fn,unit});
    }
    controlContexts.set(symbol(unit,node.tagName.getText().replace(/\.Provider$/,'')),entries);
  });
  function operation(unit:Unit,node:ts.Node,seen=new Set<ts.Node>(),depth=0):{fn:Fn;unit:Unit}|undefined{
    if(depth>8||seen.has(node))return;seen=new Set(seen).add(node);node=unwrap(node);
    const local=callback(unit,node);if(local)return {fn:local,unit:functionUnits.get(local)??unit};
    if(ts.isIdentifier(node)){
      let declaration:ts.VariableDeclaration|undefined;
      for(let scope:ts.Node|undefined=node.parent;scope&&!declaration;scope=scope.parent){
        if(!ts.isBlock(scope)&&!ts.isSourceFile(scope))continue;
        const visit=(child:ts.Node)=>{if(ts.isFunctionLike(child)||ts.isBlock(child))return;if(ts.isVariableDeclaration(child)&&ts.isObjectBindingPattern(child.name)&&child.name.elements.some(e=>ts.isIdentifier(e.name)&&e.name.text===node.text))declaration=child;ts.forEachChild(child,visit);};ts.forEachChild(scope,visit);
      }
      const binding=declaration?.name as ts.ObjectBindingPattern|undefined;
      const init=declaration?.initializer&&unwrap(declaration.initializer);
      if(binding&&init&&ts.isCallExpression(init)){
        const context=contextReaders.get(symbol(unit,init.expression.getText()));
        const field=binding.elements.find(e=>ts.isIdentifier(e.name)&&e.name.text===node.text)!;
        const fieldName=field.propertyName?.getText()??node.text;
        const method=controlContexts.get(context??'')?.get(fieldName);if(method)return method;
        const factory=functions.get(symbol(unit,init.expression.getText()));
        if(factory){const factoryUnit=functionUnits.get(factory)??unit;let result:ts.Node|undefined=ts.isBlock(factory.body)?factory.body.statements.filter(ts.isReturnStatement).at(-1)?.expression:factory.body;
          if(result&&ts.isCallExpression(unwrap(result))){const fn=callback(factoryUnit,result);if(fn)result=ts.isBlock(fn.body)?fn.body.statements.filter(ts.isReturnStatement).at(-1)?.expression:fn.body;}
          if(result&&ts.isObjectLiteralExpression(unwrap(result))){const prop=(unwrap(result) as ts.ObjectLiteralExpression).properties.find(p=>p.name?.getText()===fieldName);const value=prop&&ts.isShorthandPropertyAssignment(prop)?prop.name:prop&&ts.isPropertyAssignment(prop)?prop.initializer:undefined;if(value)return operation(factoryUnit,value,seen,depth+1);}
        }
      }
      const value=lexical(node,node.text);if(value&&ts.isCallExpression(unwrap(value))){
        const call=unwrap(value) as ts.CallExpression,fn=functions.get(symbol(unit,call.expression.getText()));
        if(fn){const ownerUnit=functionUnits.get(fn)??unit;const result=ts.isBlock(fn.body)?fn.body.statements.filter(ts.isReturnStatement).at(-1)?.expression:fn.body;if(result)return operation(ownerUnit,result,seen,depth+1);}
      }
    }
    if(ts.isCallExpression(node)){
      // A callback wrapper can add guards; the UI-only effect still belongs to
      // its first callback argument. Never execute the wrapper or its effects.
      if(node.arguments[0])return operation(unit,node.arguments[0],seen,depth+1);
    }
    return;
  }
  function transitions(unit:Unit,fn:Fn,env=new Map<string,unknown>(),seen=new Set<ts.Node>(),depth=0):Transition[]{
    if(depth>5||seen.has(fn))return [];seen=new Set(seen).add(fn);const results:Transition[]=[];let blocked=false;
    const visit=(node:ts.Node)=>{
      if(ts.isFunctionLike(node)&&node!==fn)return;
      if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer){const v=constant(unit,node.initializer,env);if(known(unit,node.initializer,env))env.set(node.name.text,v);}
      if(ts.isIfStatement(node)){
        if(!known(unit,node.expression,env)){walk(node,n=>{if(ts.isReturnStatement(n))blocked=true;});return;}
        const branch=constant(unit,node.expression,env)?node.thenStatement:node.elseStatement;if(branch)visit(branch);return;
      }
      if(ts.isSwitchStatement(node)||ts.isConditionalExpression(node)||ts.isAwaitExpression(node)||ts.isTryStatement(node))return;
      if(ts.isCallExpression(node)){
        const belongs=(candidate:Fn)=>{for(let p:ts.Node|undefined=fn;p;p=p.parent)if(p===candidate)return true;return false;};
        const state=states.find(s=>s.unit===unit&&s.setter===node.expression.getText() && belongs(s.fn));
        if(state){const arg=node.arguments[0];if(arg){let value=constant(unit,arg,env);
          if(value!==undefined){if(typeof value==='object'&&value!==null&&!Array.isArray(value)){for(const [p,v]of Object.entries(value))if(state.site.paths.some(path=>path.join('.')===p))results.push({state,path:[p],value:v});if(state.site.paths.some(path=>!path.length))results.push({state,path:[],value});}else if(state.site.paths.some(path=>!path.length))results.push({state,path:[],value});}
          const updater=callback(unit,arg);if(updater&&updater.parameters[0]&&ts.isIdentifier(updater.parameters[0].name)){
            let body:ts.Node=unwrap(updater.body);if(ts.isBlock(body)){const ret=body.statements.find(ts.isReturnStatement);body=ret?.expression ? unwrap(ret.expression):body;}
            const updaterEnv=new Map(env);updaterEnv.set(updater.parameters[0].name.text,null);
            if(ts.isBlock(unwrap(updater.body))){const returns=(unwrap(updater.body) as ts.Block).statements.filter(ts.isReturnStatement);if(returns.at(-1)?.expression)body=unwrap(returns.at(-1)!.expression!);}
            const replacement=constant(unit,body,updaterEnv);if(replacement!==undefined&&state.site.paths.some(path=>!path.length))results.push({state,path:[],value:replacement});
            if(ts.isObjectLiteralExpression(body))for(const p of body.properties)if(ts.isPropertyAssignment(p)&&!ts.isComputedPropertyName(p.name)){const path=[p.name.getText().replace(/^['"]|['"]$/g,'')],v=constant(unit,p.initializer,env);if(v!==undefined&&state.site.paths.some(x=>x.join('.')===path.join('.')))results.push({state,path,value:v});}
          }
        }}else{
          const remote=operation(unit,node.expression);
          if(remote){const args=node.arguments.map(arg=>constant(unit,arg,env));const bound=new Map<string,unknown>();remote.fn.parameters.forEach((p,i)=>{if(ts.isIdentifier(p.name)&&args[i]!==undefined)bound.set(p.name.text,args[i]);});results.push(...transitions(remote.unit,remote.fn,bound,seen,depth+1));}
        }
      }
      ts.forEachChild(node,visit);
    };visit(fn.body);return blocked?[]:results;
  }
  const actions:FlowPresentationAction[]=[];
  for(const unit of units.values())walk(unit.ast,node=>{
    if(!ts.isJsxOpeningElement(node)&&!ts.isJsxSelfClosingElement(node))return;
    const fn=owner(node);if(!fn)return;const own=functionName(fn),component=node.tagName.getText().split('.').at(-1)!;
    for(const attribute of attributes(node)){
      const prop=attribute.name.getText();if(!/^on(?:Press|Click)(?:[A-Z].*)?$/.test(prop))continue;
      const exp=expression(attribute),handler=callback(unit,exp);if(!exp)continue;
      const loc=unit.ast.getLineAndCharacterOfPosition(attribute.getStart());
      // Compilers can attribute a branch's JSX creation to its condition.
      // Include that nearest condition without widening to the whole owner.
      let sourceStart=node.getStart();
      for(let parent:ts.Node=node;parent.parent&&!ts.isFunctionLike(parent.parent);parent=parent.parent){
        const container=parent.parent;
        if(ts.isConditionalExpression(container)){if(container.whenTrue===parent)sourceStart=container.condition.getStart();break;}
        if(ts.isBinaryExpression(container)&&container.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken&&container.right===parent){sourceStart=container.left.getStart();break;}
      }
      const start=unit.ast.getLineAndCharacterOfPosition(sourceStart),end=unit.ast.getLineAndCharacterOfPosition(node.getEnd());
      const trigger:Record<string,string|number|boolean>={};
      for(const a of attributes(node)){if(!['testID','id','label','accessibilityLabel'].includes(a.name.getText()))continue;const value=a.initializer&&ts.isStringLiteralLike(a.initializer)?a.initializer.text:constant(unit,expression(a));if(['string','number','boolean'].includes(typeof value))trigger[a.name.getText()]=value as string|number|boolean;}
      const base={source:{line:start.line+1,column:start.character,endLine:end.line+1,endColumn:end.character},trigger:Object.keys(trigger).length?trigger:undefined,handler:exp&&ts.isIdentifier(exp)?exp.text:undefined,id:key(`${relative(root,unit.file)}:${attribute.pos}`),file:relative(root,unit.file),line:loc.line+1,owner:own,component,prop};
      // An unconditional presentation call may be extracted from a handler that
      // also emits analytics. Prop guards must hold in the mounted owner.
      const props=new Map<string,string[]>();
      const parameter=fn.parameters[0]?.name;
      if(parameter&&ts.isIdentifier(parameter))props.set(parameter.text,[]);
      if(parameter&&ts.isObjectBindingPattern(parameter))for(const e of parameter.elements)if(ts.isIdentifier(e.name))props.set(e.name.text,[e.propertyName?.getText()??e.name.text]);
      const guard=(n:ts.Node):FlowUiCondition|undefined=>{
        n=unwrap(n);if(ts.isIdentifier(n)&&props.has(n.text))return {prop:props.get(n.text)!};
        if(ts.isPropertyAccessExpression(n)){const parent=guard(n.expression);if(parent&&'prop'in parent&&!bad.test(n.name.text))return {prop:[...parent.prop,n.name.text]};}
        if(ts.isPrefixUnaryExpression(n)&&n.operator===ts.SyntaxKind.ExclamationToken){const value=guard(n.operand);if(value)return {op:'!',args:[value]};}
        if(ts.isBinaryExpression(n)){const op=n.operatorToken.getText();if(['&&','||','===','!==','==','!='].includes(op)){const a=guard(n.left),b=guard(n.right);if(a&&b)return {op:op as '&&',args:[a,b]};}}
        const value=constant(unit,n);return value!==undefined?{value}:undefined;
      };
      let guardedExit=false;
      const hasExit=(node:ts.Node)=>{let result=false;walk(node,n=>{if(ts.isReturnStatement(n))result=true;});return result;};
      const exits=(node:ts.Node)=>ts.isReturnStatement(node)||ts.isBlock(node)&&node.statements.length===1&&ts.isReturnStatement(node.statements[0]);
      const calls:{call:ts.CallExpression;guard?:FlowUiCondition}[]=[];
      const collect=(child:ts.Node,condition?:FlowUiCondition)=>{
        if(ts.isFunctionLike(child)||ts.isSwitchStatement(child)||ts.isTryStatement(child)||ts.isAwaitExpression(child))return;
        if(ts.isBlock(child)){let next=condition;for(const statement of child.statements){collect(statement,next);if(ts.isIfStatement(statement)&&exits(statement.thenStatement)){const g=guard(statement.expression);if(!g){guardedExit=true;return;}const allowed:FlowUiCondition={op:'!',args:[g]};next=next?{op:'&&',args:[next,allowed]}:allowed;}}return;}
        if(ts.isIfStatement(child)){const g=guard(child.expression);if(!g){if(hasExit(child))guardedExit=true;return;}const combine=(next:FlowUiCondition)=>condition?{op:'&&' as const,args:[condition,next]}:next;collect(child.thenStatement,combine(g));if(child.elseStatement)collect(child.elseStatement,combine({op:'!',args:[g]}));return;}
        if(ts.isConditionalExpression(child))return;
        if(ts.isCallExpression(child))calls.push({call:child,guard:condition});ts.forEachChild(child,n=>collect(n,condition));
      };
      if(handler)collect(handler.body);
      else if(ts.isPropertyAccessExpression(exp))calls.push({call:ts.factory.createCallExpression(exp,undefined,[])});
      // A save/discard/submit handler can have prerequisites before opening a
      // sheet. Do not turn it into an alternate entry into that sheet.
      const unsafe=handler&&/\b(?:on(?:Save|Discard|Delete|Submit)|(?:save|discard|delete|submit|mutate|signOut|logout)[A-Z]?\w*)\s*\(/i.test(handler.body.getText());
      if(unsafe||guardedExit)continue;
      let controlAction:FlowPresentationAction|undefined;
      for(const candidate of calls){const {call,guard}=candidate;const m=method(call.expression);if(!['open','present','show','expand'].includes(m))continue;
        const control=head(call.expression),reference=call.expression.getText().replace(/\?\./g,'.').includes('.current.');
        const targets:{node:ts.JsxOpeningLikeElement;prop:string}[]=[];
        const visit=(child:ts.Node)=>{if(ts.isFunctionLike(child)&&child!==fn)return;if(ts.isJsxOpeningElement(child)||ts.isJsxSelfClosingElement(child))for(const a of attributes(child)){const value=expression(a),prop=a.name.getText();if(value&&value.getText()===control&&(reference?prop==='ref':!/^on[A-Z]/.test(prop)))targets.push({node:child,prop});}ts.forEachChild(child,visit);};visit(fn.body);
        if(targets.length!==1)continue;const target=targets[0],targetComponent=target.node.tagName.getText().split('.').at(-1)!;
        // Data-dependent opening arguments cannot be fabricated.
        if(call.arguments.length)continue;
        const closes=m==='present'?['dismiss','close']:m==='show'?['hide','close','dismiss']:m==='expand'?['close','collapse','dismiss']:['close','dismiss','hide'];
        const targetStart=unit.ast.getLineAndCharacterOfPosition(target.node.getStart()),targetEnd=unit.ast.getLineAndCharacterOfPosition(target.node.getEnd());
        controlAction={...base,id:key(`${base.id}:${targetComponent}:${call.expression.getText()}`),guard,name:targetComponent,effect:{kind:'control',component:targetComponent,prop:target.prop,method:m,close:closes,target:{file:base.file,owner:own,line:targetStart.line+1,source:{line:targetStart.line+1,column:targetStart.character,endLine:targetEnd.line+1,endColumn:targetEnd.character}}}};actions.push(controlAction);
      }
      if(controlAction)continue;
      if(!handler)continue;
      const changes=transitions(unit,handler);
      const supplied=changes.length===0?openingData(unit,handler,fn,node,states,operation):undefined;
      if(changes.length!==1&&!supplied)continue;
      const change:Transition=changes[0]??{state:supplied!.state as State,path:[],value:undefined};if(change.path.some(p=>bad.test(p))||(change.value===false||change.value===null)&&!views.has(`${change.state.site.id}:${change.path.join('.')}`))continue;
      let inferred:string[]|undefined;
      for(const view of views.get(`${change.state.site.id}:${change.path.join('.')}`)??[]){
        let stateValue=change.value;for(const part of [...view.path].reverse())stateValue={[part]:stateValue};const env=new Map([[view.name,stateValue]]);
        const result=new Set<string>();const visit=(n:ts.Node)=>{if(ts.isFunctionLike(n))return;if(ts.isConditionalExpression(n)){const condition=constant(view.unit,n.condition,env);if(condition!==undefined){visit(condition?n.whenTrue:n.whenFalse);return;}}if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n)){const name=n.tagName.getText();if(/^[A-Z]/.test(name))result.add(name.split('.').at(-1)!);}ts.forEachChild(n,visit);};visit(view.node);if(result.size)inferred=[...result];
      }
      const targets=inferred??[...(guards.get(`${change.state.site.id}:${change.path.join('.')}:${JSON.stringify(change.value)}`)??guards.get(`${change.state.site.id}:${change.path.join('.')}`)??[])];
      if(!targets.length)continue;
      actions.push({...base,...(supplied?{input:supplied.input}:{}),name:targets.filter(name=>!['View','Text','Button','ErrorBoundary','Modal'].includes(name)).at(-1)??targets[0],effect:{kind:'state',site:change.state.site.id,path:change.path,value:change.value}});
    }
  });
  return {states:states.filter(state=>actions.some(a=>a.effect.kind==='state'&&a.effect.site===state.site.id)).map(state=>state.site),actions:actions.slice(0,1500)};
}
