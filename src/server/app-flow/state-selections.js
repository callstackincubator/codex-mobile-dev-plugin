/** Data-only state projections. Never execute an app callback, reducer or getter. */
export function selectPreviewState(selections, before, target, candidates, options={}) {
  const missing=Symbol('missing');
  const unsafe=key=>['__proto__','constructor','prototype'].includes(key);
  const plain=value=>value&&typeof value==='object'&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
  const own=(value,key)=>{
    if(unsafe(key)||!value||typeof value!=='object')return missing;
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    return descriptor?'value'in descriptor?descriptor.value:missing:undefined;
  };
  if(!plain(before)||!target.path.length||Object.getOwnPropertySymbols(before).length)return;
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
  let budget=800,intermediate;
  for(const selection of selections.slice(0,64))for(const candidate of candidates.filter(item=>item.id===selection.id).slice(0,32)){
    const input={state:before,props:candidate.props,locals:candidate.locals};
    const payload=Symbol('payload');
    function evaluate(node,depth=0){
      if(!node||node.unknown||depth>24||--budget<0)return missing;
      if('value'in node)return node.value;
      if(node.data){const observed=options.data?.(node.data);return observed&&Object.prototype.hasOwnProperty.call(observed,'value')?observed.value:missing;}
      if(node.object){const value={};for(const [key,expression]of Object.entries(node.object)){if(unsafe(key))return missing;const field=evaluate(expression,depth+1);if(field===missing)return missing;value[key]=field;}return value;}
      if(node.has){const set=evaluate(node.has,depth+1),item=evaluate(node.item,depth+1);if(set===missing||item===missing)return missing;return nativeHas(set,item);}
      if(node.undefined)return undefined;
      if(node.input)return node.input==='payload'?payload:input[node.input]??missing;
      if(node.get){
        const value=evaluate(node.get,depth+1);
        return value===missing?missing:value===payload?evaluate(selection.payload[node.key],depth+1):own(value,node.key);
      }
      const a=evaluate(node.args?.[0],depth+1);
      if(a===missing){
        // A known right operand can prove a logical result without running the
        // unknown helper. Other expressions still require both actual values.
        if((node.op==='||'||node.op==='&&')&&boolean(node.args[0])&&boolean(node.args[1])){const b=evaluate(node.args?.[1],depth+1);if(b!==missing&&(node.op==='||'&&b||node.op==='&&'&&!b))return b;}
        return missing;
      }
      if(node.op==='!')return !a;
      if(node.op==='?')return evaluate(node.args[a?1:2],depth+1);
      if(node.op==='&&'&&!a||node.op==='||'&&a||node.op==='??'&&a!=null)return a;
      const b=evaluate(node.args?.[1],depth+1);if(b===missing)return missing;
      // Do not coerce user objects or invoke valueOf/toString.
      if(['<','<=','>','>='].includes(node.op)&&(typeof a!=='number'||typeof b!=='number'))return missing;
      switch(node.op){case '===':return a===b;case '!==':return a!==b;case '&&':return a&&b;case '||':return a||b;case '??':return a??b;case '<':return a<b;case '<=':return a<=b;case '>':return a>b;case '>=':return a>=b;}
      return missing;
    }
    const next={};
    for(const [key,descriptor]of Object.entries(original))if(descriptor.enumerable)Object.defineProperty(next,key,{value:descriptor.value,enumerable:true,writable:true,configurable:true});
    let valid=true;
    for(const [key,expression]of Object.entries(selection.patch)){
      const value=evaluate(expression);
      if(value===missing||unsafe(key)){valid=false;break;}
      Object.defineProperty(next,key,{value,enumerable:true,writable:true,configurable:true});
    }
    if(!valid)continue;
    let value=next;for(const part of target.path)value=own(value,part);
    if(value===target.value)return {value:next,selection:selection.id,complete:true};
    let current=before;for(const part of target.path)current=own(current,part);
    if(options.advance&&['string','number','boolean'].includes(typeof value)&&value!==current&&!options.visited?.has(value)){
      const closer=typeof target.value==='number'&&typeof value==='number'&&typeof intermediate?.step==='number'&&Math.abs(target.value-value)<Math.abs(target.value-intermediate.step);
      if(!intermediate||closer)intermediate={value:next,selection:selection.id,complete:false,step:value};
    }
  }
  return intermediate;
}
