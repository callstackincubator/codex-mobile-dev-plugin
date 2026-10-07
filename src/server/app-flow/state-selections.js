import {readStatePatch} from './state-expression-runtime.js';

/** Data-only state projections. Never execute an app callback, reducer or getter. */
export function selectPreviewState(selections,before,target,candidates,options={}) {
  if(!target.path.length)return;
  let intermediate;const budget={left:800};
  const at=(value,path)=>{for(const key of path){const descriptor=value&&Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!('value'in descriptor))return;value=descriptor.value;}return value;};
  for(const selection of selections.slice(0,64))for(const candidate of candidates.filter(item=>item.id===selection.id).slice(0,32)){
    const next=readStatePatch(before,selection,candidate,options,budget);if(!next)continue;
    const value=at(next,target.path),current=at(before,target.path);
    if(value===target.value)return {value:next,selection:selection.id,complete:true};
    if(options.advance&&['string','number','boolean'].includes(typeof value)&&value!==current&&!options.visited?.has(value)){
      const closer=typeof target.value==='number'&&typeof value==='number'&&typeof intermediate?.step==='number'&&Math.abs(target.value-value)<Math.abs(target.value-intermediate.step);
      if(!intermediate||closer)intermediate={value:next,selection:selection.id,complete:false,step:value};
    }
  }
  return intermediate;
}

export function syncPreviewState(before,plan,locals) {
  let value=before;const budget={left:800},checked=new Set();
  // Query data must be data. Reject accessors, callable values and class
  // instances rather than installing an app controller into copied state.
  const checking=new Set();
  const transferable=(value,depth=0)=>{
    if(depth>12||--budget.left<0)return false;
    if(value==null||['string','boolean','number'].includes(typeof value))return true;
    if(typeof value!=='object'||checking.has(value))return false;
    if(checked.has(value))return true;
    if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)return false;
    if(Array.isArray(value)&&value.length>budget.left||Object.getOwnPropertySymbols(value).length)return false;
    const keys=Object.getOwnPropertyNames(value);if(keys.length>budget.left)return false;
    checking.add(value);
    const valid=keys.every(key=>{const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&'value'in descriptor&&transferable(descriptor.value,depth+1);});
    checking.delete(value);if(valid)checked.add(value);return valid;
  };
  for(const update of plan.updates.slice(0,16)){
    const next=readStatePatch(value,update,{locals},{},budget);
    if(next&&Object.keys(update.patch).every(key=>transferable(next[key]))&&Object.keys(next).some(key=>!Object.is(next[key],value[key])))value=next;
  }
  return value;
}
