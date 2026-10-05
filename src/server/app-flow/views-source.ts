import {createHash} from 'node:crypto';
import {relative} from 'node:path';
import ts from 'typescript';
import type {FlowSourceView, FlowStateSite} from '../../shared/app-flow.ts';
import type {SourceUnit} from './source-links.ts';

type Fn = ts.FunctionLikeDeclaration & {body: ts.ConciseBody};
type Origin = {site: FlowStateSite; path: string[]};
type Value = Origin | {origins: Origin[]} | {[field: string]: Value} | undefined;
const origin = (v: Value): v is Origin => {
  const candidate=v as Origin|undefined;return !!candidate&&typeof candidate.site?.id==='string'&&Array.isArray(candidate.path);
};
const origins = (v:Value):Origin[] => origin(v)?[v]:v&&'origins'in v&&Array.isArray(v.origins)?v.origins:[];
const merge = (a:Value,b:Value,depth=0):Value => {
  if(!a)return b;if(!b||a===b||depth>8)return a;
  const all=[...origins(a),...origins(b)];
  if(all.length){const values=[...new Map(all.map(v=>[JSON.stringify([v.site.id,v.path]),v])).values()];return values.length===1?values[0]:{origins:values};}
  const result:Record<string,Value>={...a as Record<string,Value>};for(const [key,value]of Object.entries(b))result[key]=merge(result[key],value as Value,depth+1);return result;
};
const field = (v:Value,key:string):Value => {
  const sources=origins(v);if(sources.length)return sources.map(s=>({site:s.site,path:[...s.path,key]})).reduce<Value>((a,b)=>merge(a,b),undefined);
  return v?(v as Record<string,Value>)[key]:undefined;
};
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,20);
const unwrap = (n: ts.Node): ts.Node => {
  while(ts.isParenthesizedExpression(n)||ts.isAsExpression(n)||ts.isSatisfiesExpression(n)||ts.isTypeAssertionExpression(n))n=n.expression;
  return n;
};
const owner = (n: ts.Node): Fn|undefined => {for(let p=n.parent;p;p=p.parent)if(ts.isFunctionLike(p)&&'body'in p&&p.body)return p as Fn;};
const name = (fn: Fn) => {
  if(fn.name&&ts.isIdentifier(fn.name))return fn.name.text;
  for(let p:ts.Node=fn,i=0;p.parent&&i<5;p=p.parent,i++)if(ts.isVariableDeclaration(p.parent)&&ts.isIdentifier(p.parent.name))return p.parent.name.text;
  return 'default';
};
const defaultExport = (fn:Fn) => {
  if(fn.modifiers?.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword))return true;
  for(let p:ts.Node=fn;p.parent&&!ts.isFunctionLike(p.parent)&&!ts.isBlock(p.parent);p=p.parent)if(ts.isExportAssignment(p.parent))return true;
  return false;
};
const attrs = (n: ts.JsxOpeningLikeElement) => n.attributes.properties.filter(ts.isJsxAttribute);
const expr = (n: ts.JsxAttribute) => n.initializer&&ts.isJsxExpression(n.initializer)?n.initializer.expression:n.initializer;
const walk = (n: ts.Node, visit: (n:ts.Node)=>void) => {visit(n);ts.forEachChild(n,c=>walk(c,visit));};

/** A source catalog also retains data-gated views. It never turns a server
 * result, reducer dispatch or account condition into an executable UI action. */
export function scanSourceViews(units: Map<string,SourceUnit>, root: string, symbol: (unit:SourceUnit,name:string)=>string) {
  const nodes = new Map<SourceUnit,ts.Node[]>(), scopes = new WeakMap<ts.Node,Map<string,Value>>();
  const initializers=new WeakMap<ts.Node,Map<string,ts.Node>>(),globals=new Map<SourceUnit,Map<string,ts.Node>>();
  const fnUnits = new WeakMap<Fn,SourceUnit>(), functions = new Map<string,Fn>();
  const contexts = new Map<string,Value>(), returns = new Map<string,Value>();
  const states: FlowStateSite[] = [], stateCalls = new WeakMap<ts.Node,Value>(), enums = new Map<string,Map<string,unknown>>();
  const calls=new Map<string,{unit:SourceUnit;call:ts.CallExpression}>(),types=new Map<string,ts.TypeNode|ts.InterfaceDeclaration>();
  const scope = (node:ts.Node) => {let s=scopes.get(node);if(!s){s=new Map();scopes.set(node,s);}return s;};
  const declarationScope=(n:ts.VariableDeclaration)=>{
    const blockScoped=ts.isVariableDeclarationList(n.parent)&&!!(n.parent.flags&ts.NodeFlags.BlockScoped);
    for(let p=n.parent;p;p=p.parent)if(ts.isFunctionLike(p)||blockScoped&&ts.isBlock(p))return p;
    return n.getSourceFile();
  };
  const declare=(pattern:ts.BindingName,s:Map<string,Value>)=>{if(ts.isIdentifier(pattern)){if(!s.has(pattern.text))s.set(pattern.text,undefined);}else for(const e of pattern.elements)if(ts.isBindingElement(e))declare(e.name,s);};
  const initializer=(unit:SourceUnit,n:ts.Identifier)=>{
    for(let p:ts.Node|undefined=n.parent;p;p=p.parent)if(scopes.get(p)?.has(n.text))return initializers.get(p)?.get(n.text);
    return globals.get(unit)?.get(n.text);
  };
  const location = (unit:SourceUnit,node:ts.Node) => {const a=unit.ast.getLineAndCharacterOfPosition(node.getStart()),b=unit.ast.getLineAndCharacterOfPosition(node.getEnd());return {line:a.line+1,column:a.character,endLine:b.line+1,endColumn:b.character};};
  const bind = (pattern:ts.BindingName,value:Value,s:Map<string,Value>) => {
    if(!value)return;
    if(ts.isIdentifier(pattern)){s.set(pattern.text,merge(s.get(pattern.text),value));return;}
    pattern.elements.forEach((e,i)=>{if(!ts.isBindingElement(e))return;const key=e.propertyName?.getText().replace(/^['"]|['"]$/g,'')??(ts.isArrayBindingPattern(pattern)?String(i):e.name.getText());bind(e.name,field(value,key),s);});
  };
  for(const unit of units.values()){
    const list:ts.Node[]=[];walk(unit.ast,n=>list.push(n));nodes.set(unit,list);globals.set(unit,new Map());
    for(const n of list){
      if(ts.isFunctionLike(n)&&'body'in n&&n.body){const fn=n as Fn;fnUnits.set(fn,unit);for(const p of fn.parameters)declare(p.name,scope(fn));if(name(fn)!=='default'||defaultExport(fn))functions.set(`${unit.file}#${name(fn)}`,fn);if(defaultExport(fn))functions.set(`${unit.file}#default`,fn);}
      if(ts.isEnumDeclaration(n)){const map=new Map<string,unknown>();let next=0;for(const m of n.members){const v=m.initializer&&ts.isStringLiteralLike(m.initializer)?m.initializer.text:m.initializer&&ts.isNumericLiteral(m.initializer)?Number(m.initializer.text):next;map.set(m.name.getText().replace(/^['"]|['"]$/g,''),v);if(typeof v==='number')next=v+1;}enums.set(`${unit.file}#${n.name.text}`,map);}
      if(ts.isTypeAliasDeclaration(n)||ts.isInterfaceDeclaration(n))types.set(`${unit.file}#${n.name.text}`,ts.isTypeAliasDeclaration(n)?n.type:n);
      if(ts.isVariableDeclaration(n)){const fn=owner(n);if(fn){const container=declarationScope(n);declare(n.name,scope(container));if(ts.isIdentifier(n.name)&&n.initializer){let values=initializers.get(container);if(!values){values=new Map();initializers.set(container,values);}values.set(n.name.text,n.initializer);}}else if(ts.isIdentifier(n.name)&&n.initializer)globals.get(unit)!.set(n.name.text,n.initializer);}
      if(!ts.isVariableDeclaration(n)||!n.initializer||!ts.isArrayBindingPattern(n.name))continue;
      const call=unwrap(n.initializer),fn=owner(n);if(!fn||!ts.isCallExpression(call)||!/^react#use(?:State|Reducer)$/.test(symbol(unit,call.expression.getText())))continue;
      const value=n.name.elements[0],loc=location(unit,call),site:FlowStateSite={id:createHash('sha256').update(`${relative(root,unit.file)}:${call.pos}`).digest('hex').slice(0,20),file:relative(root,unit.file),...loc,owner:name(fn),paths:[],hook:symbol(unit,call.expression.getText()).endsWith('useReducer')?'useReducer':'useState',valueName:value&&ts.isBindingElement(value)&&ts.isIdentifier(value.name)?value.name.text:undefined};states.push(site);
      const v={0:{site,path:[]}};stateCalls.set(call,v);calls.set(site.id,{unit,call});bind(n.name,v,scope(declarationScope(n)));
    }
    // Custom hooks often return the tuple directly, without a local variable.
    for(const n of list)if(ts.isCallExpression(n)&&!stateCalls.has(n)&&/^react#use(?:State|Reducer)$/.test(symbol(unit,n.expression.getText()))){
      const fn=owner(n);if(!fn)continue;const loc=location(unit,n),site:FlowStateSite={id:createHash('sha256').update(`${relative(root,unit.file)}:${n.pos}`).digest('hex').slice(0,20),file:relative(root,unit.file),...loc,owner:name(fn),paths:[],hook:symbol(unit,n.expression.getText()).endsWith('useReducer')?'useReducer':'useState'};states.push(site);stateCalls.set(n,{0:{site,path:[]}});calls.set(site.id,{unit,call:n});
    }
  }
  function read(unit:SourceUnit,n:ts.Node|undefined,fn= n&&owner(n),seen=new Set<ts.Node>(),depth=0):Value{
    if(!n||depth>10||seen.has(n))return;n=unwrap(n);seen=new Set(seen).add(n);
    if(stateCalls.has(n))return stateCalls.get(n);
    if(ts.isIdentifier(n)){
      for(let p:ts.Node|undefined=n.parent;p;p=p.parent)if(scopes.get(p)?.has(n.text))return scopes.get(p)!.get(n.text);
      return read(unit,initializer(unit,n),fn,seen,depth+1);
    }
    if(ts.isPropertyAccessExpression(n)||ts.isElementAccessExpression(n)){
      const value=read(unit,n.expression,fn,seen,depth+1),key=ts.isPropertyAccessExpression(n)?n.name.text:n.argumentExpression&&ts.isStringLiteralLike(n.argumentExpression)?n.argumentExpression.text:undefined;
      return value&&key!==undefined?field(value,key):undefined;
    }
    if(ts.isObjectLiteralExpression(n)){const v:Record<string,Value>={};for(const p of n.properties){if(ts.isPropertyAssignment(p))v[p.name.getText().replace(/^['"]|['"]$/g,'')]=read(unit,p.initializer,fn,seen,depth+1);else if(ts.isShorthandPropertyAssignment(p))v[p.name.text]=read(unit,p.name,fn,seen,depth+1);}return v;}
    if(ts.isArrayLiteralExpression(n))return Object.fromEntries(n.elements.map((e,i)=>[String(i),read(unit,e,fn,seen,depth+1)]));
    if(ts.isCallExpression(n)){
      if(/(?:^|\.)useContext$/.test(n.expression.getText())&&n.arguments[0])return contexts.get(symbol(unit,n.arguments[0].getText()));
      const first=n.arguments[0]&&unwrap(n.arguments[0]);
      if(first&&(ts.isArrowFunction(first)||ts.isFunctionExpression(first)))return read(unit,ts.isBlock(first.body)?first.body.statements.filter(ts.isReturnStatement).at(-1)?.expression:first.body,fn,seen,depth+1);
      return returns.get(symbol(unit,n.expression.getText()));
    }
  }
  // Origins cross custom hooks, tuple/object contexts and component props. Each
  // pass reads source facts; no project expression or handler runs.
  const consumers=(value:Value,fn:Fn|undefined,depth=0)=>{
    if(!value||!fn||depth>8)return;const own=name(fn);if(!/^[A-Z]/.test(own)&&own!=='default')return;
    const sources=origins(value);
    if(sources.length)for(const v of sources){
      const owners=v.site.owners??=[];if(!owners.includes(own))owners.push(own);
      const ownerSites=v.site.ownerSites??=[],file=relative(root,fnUnits.get(fn)?.file??fn.getSourceFile().fileName);
      if(!ownerSites.some(site=>site.file===file&&site.owner===own))ownerSites.push({file,owner:own});
    }
    else for(const v of Object.values(value))consumers(v,fn,depth+1);
  };
  for(let pass=0;pass<6;pass++)for(const [unit,list]of nodes)for(const n of list){
    const fn=owner(n);
    if(ts.isVariableDeclaration(n)&&n.initializer&&fn){const value=read(unit,n.initializer,fn);consumers(value,fn);bind(n.name,value,scope(declarationScope(n)));}
    if(ts.isReturnStatement(n)&&n.expression&&fn){const v=read(unit,n.expression,fn),key=`${unit.file}#${name(fn)}`;if(v&&functions.get(key)===fn)returns.set(key,merge(returns.get(key),v));}
    if(ts.isArrowFunction(n)&&!ts.isBlock(n.body)){const v=read(unit,n.body,n as Fn),key=`${unit.file}#${name(n as Fn)}`;if(v&&functions.get(key)===n)returns.set(key,merge(returns.get(key),v));}
    if(!ts.isJsxOpeningElement(n)&&!ts.isJsxSelfClosingElement(n))continue;
    const tag=n.tagName.getText(),value=attrs(n).find(a=>a.name.getText()==='value');
    if(value){const v=read(unit,expr(value),fn),key=symbol(unit,tag.replace(/\.Provider$/,''));if(v)contexts.set(key,merge(contexts.get(key),v));}
    const target=functions.get(symbol(unit,tag));if(!target||!target.parameters[0])continue;
    const props:Record<string,Value>={};for(const a of attrs(n)){const v=read(unit,expr(a),fn);if(v)props[a.name.getText()]=v;}
    bind(target.parameters[0].name,props,scope(target));
  }
  function finite(unit:SourceUnit,n:ts.Node|undefined,depth=0):unknown{
    if(!n||depth>10)return;n=unwrap(n);
    if(ts.isStringLiteralLike(n))return n.text;if(ts.isNumericLiteral(n))return Number(n.text);
    if(n.kind===ts.SyntaxKind.TrueKeyword)return true;if(n.kind===ts.SyntaxKind.FalseKeyword)return false;
    if(ts.isIdentifier(n))return finite(unit,initializer(unit,n),depth+1);
    if(ts.isPropertyAccessExpression(n))return enums.get(symbol(unit,n.expression.getText()))?.get(n.name.text);
    if(ts.isPrefixUnaryExpression(n)&&n.operator===ts.SyntaxKind.ExclamationToken){const v=finite(unit,n.operand,depth+1);return v===undefined?undefined:!v;}
    if(ts.isBinaryExpression(n)){const a=finite(unit,n.left,depth+1),b=finite(unit,n.right,depth+1);switch(n.operatorToken.kind){case ts.SyntaxKind.AmpersandAmpersandToken:return a===false?false:a===true?b:undefined;case ts.SyntaxKind.BarBarToken:return a===true?true:a===false?b:undefined;case ts.SyntaxKind.EqualsEqualsEqualsToken:return a!==undefined&&b!==undefined?a===b:undefined;case ts.SyntaxKind.ExclamationEqualsEqualsToken:return a!==undefined&&b!==undefined?a!==b:undefined;}}
  }
  const universe=(v:Origin,comparison?:ts.Node):unknown[]=>{
    if(comparison&&ts.isPropertyAccessExpression(comparison)){const values=enums.get(symbol(fnUnits.get(owner(comparison)!)!,comparison.expression.getText()));if(values)return [...values.values()];}
    const bound=calls.get(v.site.id);if(!bound)return [];
    const reducer=bound.call.arguments[0]&&functions.get(symbol(bound.unit,bound.call.arguments[0].getText()));
    let type=bound.call.typeArguments?.[0]??reducer?.parameters[0]?.type??reducer?.type,unit=reducer?fnUnits.get(reducer)??bound.unit:bound.unit;
    const follow=(n:ts.TypeNode|ts.InterfaceDeclaration|undefined,depth=0):ts.TypeNode|ts.InterfaceDeclaration|undefined=>n&&depth<8&&ts.isTypeReferenceNode(n)?follow(types.get(symbol(unit,n.typeName.getText())),depth+1):n;
    for(const field of v.path){const n=follow(type);if(!n||!ts.isTypeLiteralNode(n)&&!ts.isInterfaceDeclaration(n))return [];const prop=n.members.find(m=>ts.isPropertySignature(m)&&m.name.getText()===field);type=prop&&ts.isPropertySignature(prop)?prop.type:undefined;}
    const n=follow(type);return n&&ts.isUnionTypeNode(n)?n.types.flatMap(t=>ts.isLiteralTypeNode(t)?[finite(unit,t.literal)]:[]):n?.kind===ts.SyntaxKind.BooleanKeyword?[true,false]:[];
  };
  const truth=(unit:SourceUnit,n:ts.Node,v:Origin,value:unknown,depth=0):unknown=>{
    if(depth>8)return undefined;n=unwrap(n);const readValue=origins(read(unit,n));if(readValue.some(r=>r.site.id===v.site.id&&JSON.stringify(r.path)===JSON.stringify(v.path)))return value;
    if(ts.isPrefixUnaryExpression(n)&&n.operator===ts.SyntaxKind.ExclamationToken){const a=truth(unit,n.operand,v,value,depth+1);return a===undefined?undefined:!a;}
    if(ts.isBinaryExpression(n)){
      const a=truth(unit,n.left,v,value,depth+1),b=truth(unit,n.right,v,value,depth+1),op=n.operatorToken.kind;
      // A known false AND or true OR settles the guard even when its other
      // operand needs live data. Do not promote that operand to preview state.
      if(op===ts.SyntaxKind.AmpersandAmpersandToken&&((a!==undefined&&!a)||(b!==undefined&&!b)))return false;
      if(op===ts.SyntaxKind.BarBarToken){if(a!==undefined&&a)return a;if(b!==undefined&&b)return b;}
      if(a===undefined||b===undefined)return undefined;
      switch(op){case ts.SyntaxKind.EqualsEqualsEqualsToken:case ts.SyntaxKind.EqualsEqualsToken:return a===b;case ts.SyntaxKind.ExclamationEqualsEqualsToken:case ts.SyntaxKind.ExclamationEqualsToken:return a!==b;case ts.SyntaxKind.AmpersandAmpersandToken:return a&&b;case ts.SyntaxKind.BarBarToken:return a||b;}
    }
    return finite(unit,n);
  };
  const possible=(unit:SourceUnit,body:ts.Node,v:Origin,value:unknown)=>{
    for(let p=body;p.parent&&!ts.isFunctionLike(p.parent);p=p.parent){const parent=p.parent;if(ts.isConditionalExpression(parent)){const b=truth(unit,parent.condition,v,value);if(b!==undefined&&(parent.whenTrue===p&&!b||parent.whenFalse===p&&b))return false;}if(ts.isBinaryExpression(parent)&&parent.right===p&&parent.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken){const b=truth(unit,parent.left,v,value);if(b!==undefined&&!b)return false;}}
    return true;
  };
  const mountable=(unit:SourceUnit,fn:Fn):FlowSourceView['mount']=>{
    const own=name(fn);if(!/^[A-Z]/.test(own))return;
    const isDefault=defaultExport(fn);
    let exported=!!fn.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword);
    for(let parent:ts.Node=fn;parent.parent&&!ts.isFunctionLike(parent.parent);parent=parent.parent){
      if(ts.isVariableStatement(parent))exported||=!!parent.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword);
    }
    if(!exported&&!isDefault)return;
    // Omitted props must fit every inherited member. Unknown types and
    // required callbacks/data cannot be filled with made-up values.
    const optional=(type:ts.TypeNode|ts.InterfaceDeclaration|undefined,seen=new Set<string>()):boolean=>{
      if(!type)return false;
      const context=units.get(type.getSourceFile().fileName);if(!context)return false;
      if(ts.isTypeReferenceNode(type)){
        const key=symbol(context,type.typeName.getText());if(seen.has(key))return false;
        return optional(types.get(key),new Set(seen).add(key));
      }
      if(ts.isIntersectionTypeNode(type))return type.types.every(part=>optional(part,seen));
      if(!ts.isTypeLiteralNode(type)&&!ts.isInterfaceDeclaration(type))return false;
      if(type.members.some(member=>!ts.isPropertySignature(member)||!member.questionToken))return false;
      if(ts.isInterfaceDeclaration(type)&&type.heritageClauses?.some(clause=>clause.types.some(base=>{
        const key=symbol(context,base.expression.getText());return seen.has(key)||!optional(types.get(key),new Set(seen).add(key));
      })))return false;
      return true;
    };
    for(const parameter of fn.parameters){
      if(parameter.dotDotDotToken)return;
      if(!parameter.initializer&&!parameter.questionToken&&!optional(parameter.type))return;
    }
    return {export:isDefault?'default':own};
  };
  const controlOwners=new WeakMap<Fn,Map<string,boolean|undefined>>();
  const parameterCache=new WeakMap<Fn,Map<string,string[]>>();
  const parameterBindings=(fn:Fn)=>{
    const cached=parameterCache.get(fn);if(cached)return cached;
    const result=new Map<string,string[]>();
    const visit=(binding:ts.BindingName,path:string[])=>{
      if(ts.isIdentifier(binding)){result.set(binding.text,path);return;}
      for(const [index,item]of binding.elements.entries())if(ts.isBindingElement(item)&&!item.dotDotDotToken){
        const key=item.propertyName?.getText().replace(/^['"]|['"]$/g,'')??(ts.isArrayBindingPattern(binding)?String(index):item.name.getText());
        visit(item.name,[...path,key]);
      }
    };
    if(fn.parameters[0])visit(fn.parameters[0].name,[]);parameterCache.set(fn,result);return result;
  };
  const parameterPath=(unit:SourceUnit,fn:Fn,node:ts.Node,seen=new Set<ts.Node>()):string[]|undefined=>{
    node=unwrap(node);if(seen.has(node))return;seen=new Set(seen).add(node);
    if(ts.isIdentifier(node)){
      for(let parent=node.parent;parent;parent=parent.parent)if(scopes.get(parent)?.has(node.text)){
        if(parent===fn){const bound=parameterBindings(fn).get(node.text);if(bound)return bound;}
        const value=initializers.get(parent)?.get(node.text);return value?parameterPath(unit,fn,value,seen):undefined;
      }
    }
    if(ts.isPropertyAccessExpression(node)||ts.isElementAccessExpression(node)){
      const path=parameterPath(unit,fn,node.expression,seen),key=ts.isPropertyAccessExpression(node)?node.name.text:
        node.argumentExpression&&ts.isStringLiteralLike(node.argumentExpression)?node.argumentExpression.text:undefined;
      if(path&&key!==undefined)return [...path,key];
    }
  };
  const ownsControl=(unit:SourceUnit,fn:Fn,prop:string,seen=new Set<string>()):boolean|undefined=>{
    const key=`${unit.file}#${name(fn)}:${prop}`;if(seen.has(key))return;seen=new Set(seen).add(key);
    const cached=controlOwners.get(fn);if(cached?.has(prop))return cached.get(prop);
    let owned=false,unknown=false,jsx=false;
    walk(fn.body,node=>{
      if(ts.isCallExpression(node)&&symbol(unit,node.expression.getText())==='react#useImperativeHandle'&&node.arguments[0]&&
        parameterPath(unit,fn,node.arguments[0])?.[0]===prop)owned=true;
      if(!ts.isJsxOpeningElement(node)&&!ts.isJsxSelfClosingElement(node))return;
      jsx=true;
      for(const attribute of node.attributes.properties)if(ts.isJsxSpreadAttribute(attribute)){
        const path=parameterPath(unit,fn,attribute.expression);if(path&&(!path.length||path[0]===prop))unknown=true;
      }
      for(const attribute of attrs(node)){
        const targetProp=attribute.name.getText(),value=expr(attribute);
        if(!value||/^on[A-Z]/.test(targetProp)||parameterPath(unit,fn,value)?.[0]!==prop)continue;
        if(targetProp==='ref'){owned=true;continue;}
        const target=functions.get(symbol(unit,node.tagName.getText()));
        const result=target?ownsControl(fnUnits.get(target)!,target,targetProp,seen):undefined;
        if(result===true)owned=true;else if(result===undefined)unknown=true;
      }
    });
    const result=owned?true:unknown||!jsx?undefined:false;
    const values=cached??new Map<string,boolean|undefined>();values.set(prop,result);controlOwners.set(fn,values);return result;
  };
  const outboundControl=(unit:SourceUnit,node:ts.JsxOpeningLikeElement,prop:string)=>{
    const target=functions.get(symbol(unit,node.tagName.getText()));if(!target)return false;
    const targetUnit=fnUnits.get(target)!;if(ownsControl(targetUnit,target,prop)!==false)return false;
    // Reject only a proven sibling controller on a component with its own
    // native/ref boundary. Opaque third-party and custom hook controls retain
    // their runtime discovery path.
    const props=new Set([...parameterBindings(target).values()].map(path=>path[0]).filter(Boolean));
    walk(target.body,child=>{if(ts.isPropertyAccessExpression(child)){const path=parameterPath(targetUnit,target,child);if(path?.[0])props.add(path[0]);}});
    return [...props].some(other=>other!==prop&&ownsControl(targetUnit,target,other)===true);
  };
  const views=new Map<string,FlowSourceView>();
  const reachable=(unit:SourceUnit,node:ts.Node)=>{
    for(let p=node;p.parent;p=p.parent){const parent=p.parent;
      if(ts.isConditionalExpression(parent)){const value=finite(unit,parent.condition);if(value!==undefined&&(parent.whenTrue===p&&!value||parent.whenFalse===p&&value))return false;}
      if(ts.isIfStatement(parent)){const value=finite(unit,parent.expression);if(value!==undefined&&(parent.thenStatement===p&&!value||parent.elseStatement===p&&value))return false;}
      if(ts.isBinaryExpression(parent)&&parent.right===p&&parent.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken&&finite(unit,parent.left)===false)return false;
    }return true;
  };
  const parts=(unit:SourceUnit,body:ts.Node,state?:FlowSourceView['state'])=>{
    const result=new Map<string,FlowSourceView['components'][number]>(),site=state&&states.find(s=>s.id===state.site);
    const visit=(n:ts.Node)=>{
      if(ts.isFunctionLike(n))return;
      if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n)){
        const ref=state&&site?{site,path:state.path}:undefined;
        if(ref&&!possible(unit,n,ref,state!.value))return;
        const tag=n.tagName.getText();
        if(/^[A-Z]/.test(tag)){
          const resolved=symbol(unit,tag),split=resolved.lastIndexOf('#');
          if(split>=0&&units.has(resolved.slice(0,split))){
            let guards=0;
            if(ref)for(let p:ts.Node=n;p.parent&&!ts.isFunctionLike(p.parent);p=p.parent){
              const parent=p.parent;
              const condition=ts.isConditionalExpression(parent)?parent.condition:ts.isIfStatement(parent)?parent.expression:
                ts.isBinaryExpression(parent)&&parent.right===p&&parent.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken?parent.left:undefined;
              if(condition&&truth(unit,condition,ref,state!.value)===undefined)guards++;
            }
            const item={file:relative(root,resolved.slice(0,split)),component:resolved.slice(split+1),...(ref?{guards}:{})},previous=result.get(resolved);
            if(!previous||(item.guards??0)<(previous.guards??0))result.set(resolved,item);
          }
        }
      }
      ts.forEachChild(n,visit);
    };
    visit(body);return [...result.values()];
  };
  const add=(unit:SourceUnit,body:ts.Node,kind:FlowSourceView['kind'],extra:Partial<FlowSourceView>)=>{
    const loc=location(unit,body),fn=owner(body);if(!fn||!reachable(unit,body))return;
    let jsx=false;walk(body,n=>{if(ts.isJsxElement(n)||ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n))jsx=true;});if(!jsx)return;
    const components=parts(unit,body,extra.state),file=relative(root,unit.file),own=name(fn);
    const identity=extra.state?['state',extra.state]:[file,own,loc,kind,extra.control,extra.branch];
    const id=hash(identity),existing=views.get(id);
    const renderBody=ts.isCaseClause(body)||ts.isReturnStatement(body)||ts.isBlock(body)&&body.statements.some(ts.isReturnStatement)||(()=>{for(let p=body;p.parent&&!ts.isFunctionLike(p.parent);p=p.parent){if(ts.isReturnStatement(p.parent))return true;if(ts.isJsxElement(p.parent)||ts.isJsxFragment(p.parent))return false;}return false;})();
    let renderFn=fn;for(let parent=fn;!(/^[A-Z]/.test(name(parent))||defaultExport(parent));){const enclosing=owner(parent);if(!enclosing)break;renderFn=parent=enclosing;}
    const callback=renderFn!==fn;
    const render={file,owner:name(renderFn),line:loc.line,source:loc,
      components:components.map(component=>({...component,...(callback?{guards:(component.guards??0)+(fn.parameters.length?1:0)}:{})})),
      renderBody:!callback&&renderBody,...(callback?{callbackOwner:own}:{}),...(extra.branch?{branch:extra.branch}:{})};
    if(existing){existing.renders!.push(render);existing.renderBody||=renderBody;if(!existing.components.length&&components.length)existing.name=components[0].component;for(const p of components){const prior=existing.components.find(c=>c.file===p.file&&c.component===p.component);if(!prior)existing.components.push(p);else if(p.guards!==undefined)prior.guards=Math.min(prior.guards??p.guards,p.guards);}return;}
    views.set(id,{id,file,owner:own,line:loc.line,source:loc,kind,name:components[0]?.component??own,components:components.map(component=>({...component})),availability:'observed-only',renderBody,renders:[render],...extra});
  };
  const stateBranch=(unit:SourceUnit,condition:ts.Node,body:ts.Node,side:'true'|'false')=>{
    let predicate=unwrap(condition),invert=side==='false';
    if(ts.isIdentifier(predicate)){const declaration=initializer(unit,predicate);if(declaration)predicate=unwrap(declaration);}
    while(ts.isPrefixUnaryExpression(predicate)&&predicate.operator===ts.SyntaxKind.ExclamationToken){invert=!invert;predicate=unwrap(predicate.operand);}
    const operands:ts.Node[]=[];const collect=(n:ts.Node)=>{if(ts.isBinaryExpression(n)&&[ts.SyntaxKind.AmpersandAmpersandToken,ts.SyntaxKind.BarBarToken].includes(n.operatorToken.kind)){collect(n.left);collect(n.right);}else operands.push(n);};collect(predicate);
    for(const p of operands){let ref=p,value:unknown=!invert;
      let alternative=false,comparison:ts.Node|undefined;
      if(ts.isBinaryExpression(p)&&[ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.EqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind)){
        const right=finite(unit,p.right),left=finite(unit,p.left);ref=right!==undefined?p.left:p.right;value=right??left;
        comparison=right!==undefined?p.right:p.left;
        const unequal=[ts.SyntaxKind.ExclamationEqualsEqualsToken,ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind);
        if(invert!==unequal){if(typeof value==='boolean')value=!value;else alternative=true;}
      }
      for(const v of origins(read(unit,ref))){if(value===undefined)continue;
        if(!v.site.paths.some(path=>JSON.stringify(path)===JSON.stringify(v.path)))v.site.paths.push(v.path);
        const values=alternative?universe(v,comparison).filter(item=>item!==value):[value];
        for(const item of values)if(possible(unit,body,v,item))add(unit,body,'state',{state:{site:v.site.id,path:v.path,value:item},branch:{condition:condition.getText(),side}});
      }
    }
  };
  for(const [unit,list]of nodes)for(const n of list){
    if(ts.isConditionalExpression(n)){for(const [side,body]of [['true',n.whenTrue],['false',n.whenFalse]] as const){add(unit,body,'branch',{branch:{condition:n.condition.getText(),side}});stateBranch(unit,n.condition,body,side);}}
    if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken){add(unit,n.right,'branch',{branch:{condition:n.left.getText(),side:'true'}});stateBranch(unit,n.left,n.right,'true');}
    if(ts.isIfStatement(n)){
      add(unit,n.thenStatement,'branch',{branch:{condition:n.expression.getText(),side:'true'}});stateBranch(unit,n.expression,n.thenStatement,'true');
      let other:ts.Node|undefined=n.elseStatement;
      // A render guard often returns early and leaves its alternate body as
      // the function's final return, rather than writing an explicit else.
      if(!other&&ts.isBlock(n.parent)){const statements=n.parent.statements;const exits=ts.isReturnStatement(n.thenStatement)||ts.isBlock(n.thenStatement)&&n.thenStatement.statements.some(ts.isReturnStatement);if(exits)other=statements.slice(statements.indexOf(n)+1).filter(ts.isReturnStatement).at(-1);}
      if(other){add(unit,other,'branch',{branch:{condition:n.expression.getText(),side:'false'}});stateBranch(unit,n.expression,other,'false');}
    }
    if(ts.isSwitchStatement(n))for(const v of origins(read(unit,n.expression)))for(const c of n.caseBlock.clauses)if(ts.isCaseClause(c)){const value=finite(unit,c.expression);if(value!==undefined){v.site.paths.push(v.path);add(unit,c,'state',{state:{site:v.site.id,path:v.path,value},branch:{condition:n.expression.getText(),side:'case'}});}}
    if(ts.isFunctionLike(n)&&'body'in n&&n.body&&(/^[A-Z]/.test(name(n as Fn))||defaultExport(n as Fn)))add(unit,n.body,'component',{owner:name(n as Fn),name:name(n as Fn),mount:mountable(unit,n as Fn)});
    if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n)){
      for(const a of attrs(n)){
        const prop=a.name.getText(),e=expr(a);if(!e||/^on[A-Z]/.test(prop))continue;
        // Ref/controller targets retain the precise rendered instance. State
        // and result-driven dialogs are catalogued even without a UI callback.
        if(/^(?:control|.*Control|controller|ref)$/.test(prop)){
          let boundary=true;for(let p:ts.Node|undefined=n.parent;p&&p!==owner(n);p=p.parent)if(ts.isJsxElement(p)&&p.openingElement!==n&&attrs(p.openingElement).some(a=>/^(?:control|.*Control|controller|ref)$/.test(a.name.getText())))boundary=false;
          add(unit,n,'control',{control:{component:n.tagName.getText().split('.').at(-1)!,prop,boundary:boundary&&!outboundControl(unit,n,prop),generic:n.tagName.getText().includes('.')}});
        }
        const index=attrs(n).find(p=>p.name.getText()==='index');
        if(index)for(const v of origins(read(unit,e))){const value=finite(unit,expr(index));if(value!==undefined){v.site.paths.push(v.path);add(unit,n,'state',{state:{site:v.site.id,path:v.path,value}});}}
      }
    }
  }
  const entries=new Map<string,NonNullable<FlowSourceView['entries']>>();
  for(const [unit,list]of nodes)for(const n of list)if((ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n))&&reachable(unit,n)){let target=symbol(unit,n.tagName.getText());const fn=owner(n),callee=functions.get(target);if(callee)target=`${fnUnits.get(callee)!.file}#${name(callee)}`;if(!fn)continue;const list=entries.get(target)??[],source=location(unit,n);list.push({file:relative(root,unit.file),line:source.line,owner:name(fn),source});entries.set(target,list);}
  for(const view of views.values())if(view.kind==='component')view.entries=entries.get(`${root}/${view.file}#${view.owner}`)??[];
  // Private functions cannot be found through module exports. Their actual JSX
  // callers let Metro prove the function before runtime forces a hook render.
  for(const site of states){
    const sources=[{file:site.file,owner:site.owner},...(site.ownerSites??[])];
    const callers=sources.flatMap(source=>(entries.get(`${root}/${source.file}#${source.owner}`)??[])
      .flatMap(entry=>entry.source?[{component:source.owner,file:entry.file,owner:entry.owner,source:entry.source}]:[]));
    if(callers.length)site.ownerEntries=[...new Map(callers.map(entry=>[JSON.stringify(entry),entry])).values()];
  }
  return {states:states.filter(site=>site.paths.length),views:[...views.values()]};
}
