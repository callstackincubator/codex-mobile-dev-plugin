/** Data-only state projections. Never execute an app callback, reducer or getter. */
export function selectPreviewState(selections, before, target, candidates) {
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
  let budget=800;
  for(const selection of selections.slice(0,64))for(const candidate of candidates.filter(item=>item.id===selection.id).slice(0,32)){
    const input={state:before,props:candidate.props};
    const payload=Symbol('payload');
    function evaluate(node,depth=0){
      if(!node||node.unknown||depth>24||--budget<0)return missing;
      if('value'in node)return node.value;
      if(node.undefined)return undefined;
      if(node.input)return node.input==='payload'?payload:input[node.input]??missing;
      if(node.get){
        const value=evaluate(node.get,depth+1);
        return value===missing?missing:value===payload?evaluate(selection.payload[node.key],depth+1):own(value,node.key);
      }
      const a=evaluate(node.args?.[0],depth+1);
      if(a===missing)return missing;
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
    if(value===target.value)return {value:next,selection:selection.id};
  }
}
