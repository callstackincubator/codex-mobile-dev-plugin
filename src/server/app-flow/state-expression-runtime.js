/** Bounded data reads shared by form choices and query-to-state transfers. */
export function readStatePatch(before,selection,candidate,options={},budget={left:800}) {
  const missing=Symbol('missing'),shortCircuit=Symbol('optional-chain');
  const unsafe=key=>['__proto__','constructor','prototype'].includes(key);
  const plain=value=>value&&typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
  const own=(value,key)=>{
    if(unsafe(key)||!value||typeof value!=='object')return missing;
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    return descriptor?'value'in descriptor?descriptor.value:missing:undefined;
  };
  if(!plain(before)||Object.getOwnPropertySymbols(before).length)return;
  const original=Object.getOwnPropertyDescriptors(before);
  if(Object.entries(original).some(([key,value])=>unsafe(key)||!('value'in value)))return;
  const boolean=node=>typeof node?.value==='boolean'||['!','===','!==','<','<=','>','>='].includes(node?.op)||['&&','||'].includes(node?.op)&&node.args.every(boolean);
  const nativeHas=(set,item)=>{
    let value=set;
    for(let depth=0;value&&depth<8;depth++,value=Object.getPrototypeOf(value)){
      const descriptor=Object.getOwnPropertyDescriptor(value,'has');if(!descriptor)continue;
      if(!('value'in descriptor)||descriptor.value!==Set.prototype.has)return missing;
      try{return Set.prototype.has.call(set,item);}catch{return missing;}
    }
    return missing;
  };
  const input={state:before,props:candidate.props,locals:candidate.locals};
  const payload=Symbol('payload');
  const read=(node,depth=0)=>{const value=evaluate(node,depth);return value===shortCircuit?undefined:value;};
  function evaluate(node,depth=0){
    if(!node||node.unknown||depth>24||--budget.left<0)return missing;
    if('value'in node)return node.value;
    if(node.data){const observed=options.data?.(node.data);return observed&&Object.prototype.hasOwnProperty.call(observed,'value')?observed.value:missing;}
    if(node.object){const value={};for(const [key,expression]of Object.entries(node.object)){if(unsafe(key))return missing;const field=read(expression,depth+1);if(field===missing)return missing;value[key]=field;}return value;}
    if(node.has){const set=read(node.has,depth+1),item=read(node.item,depth+1);if(set===missing||item===missing)return missing;return nativeHas(set,item);}
    if(node.undefined)return undefined;
    if(node.input)return node.input==='payload'?payload:input[node.input]??missing;
    if(node.get){
      let value=evaluate(node.get,depth+1);
      if(value===shortCircuit){if(node.chain)return shortCircuit;value=undefined;}
      return value===missing?missing:value===payload?evaluate(selection.payload[node.key],depth+1):node.optional&&value==null?shortCircuit:own(value,node.key);
    }
    const a=read(node.args?.[0],depth+1);
    if(a===missing){
      // A known right operand can prove a logical result without running the
      // unknown helper. Other expressions still require both actual values.
      if((node.op==='||'||node.op==='&&')&&boolean(node.args[0])&&boolean(node.args[1])){const b=read(node.args?.[1],depth+1);if(b!==missing&&(node.op==='||'&&b||node.op==='&&'&&!b))return b;}
      return missing;
    }
    if(node.op==='!')return !a;
    if(node.op==='?')return read(node.args[a?1:2],depth+1);
    if(node.op==='&&'&&!a||node.op==='||'&&a||node.op==='??'&&a!=null)return a;
    const b=read(node.args?.[1],depth+1);if(b===missing)return missing;
    // Do not coerce user objects or invoke valueOf/toString.
    if(['<','<=','>','>='].includes(node.op)&&(typeof a!=='number'||typeof b!=='number'))return missing;
    switch(node.op){case '===':return a===b;case '!==':return a!==b;case '&&':return a&&b;case '||':return a||b;case '??':return a??b;case '<':return a<b;case '<=':return a<=b;case '>':return a>b;case '>=':return a>=b;}
    return missing;
  }
  if(selection.when){const condition=read(selection.when);if(condition===missing||!condition)return;}
  const next={};
  for(const [key,descriptor]of Object.entries(original))if(descriptor.enumerable)Object.defineProperty(next,key,{value:descriptor.value,enumerable:true,writable:true,configurable:true});
  let valid=true;
  for(const [key,expression]of Object.entries(selection.patch)){
    const value=read(expression);
    if(value===missing||unsafe(key)){valid=false;break;}
    Object.defineProperty(next,key,{value,enumerable:true,writable:true,configurable:true});
  }
  if(!valid)return;
  return next;
}
