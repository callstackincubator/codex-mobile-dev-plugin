/** Temporary hook tracking. Setters keep working after cleanup, without retaining fibers. */
export function installPresentationRuntime({ hook, fibers, hidden, later }) {
  let sequence = 0, owners = new WeakMap(), collecting = new Set();
  const bindings = new Map(), patches = [], effectPatches = [], undo = [];
  let collected = [];
  const entries = new Map(), entryKeys = new Map(); let entrySources = new WeakMap();
  let lastScheduled = 0, structureCache;
  let catalog = {states:[],actions:[]};
  const name = fiber => { const type=fiber.type?.render??fiber.type?.type??fiber.type;return type?.displayName??type?.name; };
  const current = () => {
    for(const renderer of hook?.renderers?.values?.()??[]){if(renderer.rendererPackageName!=='react-native-renderer')continue;const fiber=renderer.getCurrentFiber?.();if(fiber)return {fiber,renderer};}
  };
  function register(kind, original, args) {
    const live=current();if(!live)return original(...args);
    let index=0;for(let h=live.fiber.memoizedState;h&&index<300;h=h.next)index++;
    const projection=projected.find(record=>record.seed&&record.child.props===(live.fiber.pendingProps??live.fiber.memoizedProps)&&record.focus.type===live.fiber.type);
    if(projection?.seed.index===index&&projection.seed.kind===kind){
      const value=projection.seed.value;projection.seed.applied=true;
      // Seed the temporary instance's hook. Never dispatch the original reducer
      // or run its initializer to manufacture a backend response.
      args=kind==='useReducer'?[args[0],value,()=>value]:[()=>value];
    }
    const result=original(...args);
    if(!collecting.has(live.fiber)&&!collecting.has(live.fiber.alternate))return result;
    if(!Array.isArray(result)||typeof result[1]!=='function')return result;
    let record=owners.get(live.fiber)??owners.get(live.fiber.alternate);
    if(!record){record=new Map();owners.set(live.fiber,record);}else owners.set(live.fiber,record);
    let id=record.get(index),binding=id&&bindings.get(id);
    if(!binding&&bindings.size<1500){id=String(++sequence);record.set(index,id);binding={id,index,kind,stack:new Error().stack,fiber:live.fiber,renderer:live.renderer,setter:result[1]};bindings.set(id,binding);}
    if(binding){binding.fiber=live.fiber;binding.setter=result[1];}
    // Do not wrap setters or keep a second callback in the app. Restoration uses
    // the exact hook index collected during this render, including custom hooks.
    return result;
  }
  // Injected code bypasses Metro's block-scope transform. Some Hermes versions
  // share loop bindings across closures, so each wrapper needs a function scope.
  function hookWrapper(kind, original) { return (...args)=>register(kind,original,args); }
  function effectWrapper(original) {
    return (callback,deps)=>{
      const fiber=current()?.fiber;
      const preview=projected.some(record=>{for(let p=fiber,count=0;p&&count++<100;p=p.return)if((p.pendingProps??p.memoizedProps)===record.child.props)return true;return false;});
      return original(preview?()=>{}:callback,deps);
    };
  }
  function patchHooks() {
    if(patches.length)return true;
    const modules=globalThis.__r?.getModules?.();if(!modules?.values)return false;
    for(const module of modules.values()){
      if(!module.isInitialized)continue;const react=module.publicModule?.exports;
      if(typeof react?.createElement!=='function'||typeof react.useState!=='function'||typeof react.useReducer!=='function')continue;
      for(const key of ['useState','useReducer']){
        const descriptor=Object.getOwnPropertyDescriptor(react,key);if(!descriptor?.writable)continue;
        const original=react[key],wrapped=hookWrapper(key,original);
        react[key]=wrapped;patches.push({react,key,original,wrapped});
      }
      break;
    }
    return patches.length>0;
  }
  function unpatch(){for(const p of patches)if(p.react[p.key]===p.wrapped)p.react[p.key]=p.original;patches.length=0;}
  function patchPreviewEffects(react) {
    if(effectPatches.length)return true;
    for(const key of ['useEffect','useLayoutEffect','useInsertionEffect']){
      if(typeof react[key]!=='function')continue;
      if(!Object.getOwnPropertyDescriptor(react,key)?.writable){unpatchPreviewEffects();return false;}
      const original=react[key],wrapped=effectWrapper(original);
      react[key]=wrapped;effectPatches.push({react,key,original,wrapped});
    }
    return true;
  }
  function unpatchPreviewEffects(){for(const p of effectPatches)if(p.react[p.key]===p.wrapped)p.react[p.key]=p.original;effectPatches.length=0;}
  function collectionTargets(states) {
    const targets=new Map(), modules=globalThis.__r?.getModules?.();
    const initialized=new Map();
    for(const module of modules?.values?.()??[]){
      if(module.isInitialized&&typeof module.verboseName==='string')initialized.set(module.verboseName.replaceAll('\\','/').replace(/^\.\//,''),module.publicModule?.exports);
    }
    for(const site of states)for(const owner of new Set([site.owner,...(site.owners??[])])){
      const target=targets.get(owner)??{types:new Set(),fallback:false};
      const exports=initialized.get(site.file), matches=[];
      // Read data exports only. Never initialize a project module or invoke a
      // getter to identify one of several unrelated same-named Providers.
      const descriptors=exports&&(typeof exports==='object'||typeof exports==='function')?Object.getOwnPropertyDescriptors(exports):{};
      for(const [key,descriptor]of Object.entries(descriptors)){
        if(!('value'in descriptor))continue;
        const type=descriptor.value;
        const data=key=>{if(!type||(typeof type!=='object'&&typeof type!=='function'))return;const d=Object.getOwnPropertyDescriptor(type,key);return d&&'value'in d?d.value:undefined;};
        const body=data('render')??data('type')??type;
        if((key===owner||body?.displayName===owner||body?.name===owner)&&typeof body==='function')matches.push(type,body);
      }
      if(typeof exports==='function'&&exports.name===owner)matches.push(exports);
      if(matches.length)for(const type of matches)target.types.add(type);else target.fallback=true;
      targets.set(owner,target);
    }
    return targets;
  }
  async function collect(states = catalog.states, actions = catalog.actions) {
    catalog={states,actions};lastScheduled=0;structureCache=undefined;
    if(!patchHooks())return records(0);
    try {
      const mounted=new Set();fibers(fiber=>mounted.add(fiber));
      for(const [id,binding]of bindings)if(!mounted.has(binding.fiber)&&!mounted.has(binding.fiber.alternate))bindings.delete(id);
      const tracked=fiber=>{const record=owners.get(fiber)??owners.get(fiber.alternate);return record&&[...record.values()].some(id=>bindings.has(id));};
      const targets=collectionTargets(states);
      for(const fiber of mounted){
        if(fiber.tag===14||tracked(fiber))continue;
        if(Array.isArray(fiber._debugHookTypes)&&!fiber._debugHookTypes.some(kind=>kind==='useState'||kind==='useReducer'))continue;
        const target=targets.get(name(fiber));
        if(target&&(target.fallback||target.types.has(fiber.type)||target.types.has(fiber.elementType)))collecting.add(fiber);
      }
      if(!collecting.size)return records(0);
      for(const fiber of collecting){
        for(const renderer of hook.renderers.values())if(renderer.rendererPackageName==='react-native-renderer'&&typeof renderer.scheduleUpdate==='function'){
          try{renderer.scheduleUpdate(fiber);lastScheduled++;}catch{}break;
        }
      }
      if(lastScheduled)await new Promise(resolve=>later(resolve,80,resolve));
      // Hooks stay patched only through this bounded render pass. No background
      // observer, timer, dispatcher replacement, or app source change remains.
      return records(0);
    } finally { unpatch(); collecting.clear(); }
  }
  function records(offset) {
    // Later pages read the same collection. Rewalking a changing React tree for
    // each page repeats source work and can shift entries across page offsets.
    if(offset>0)return page(offset);
    // JSX creation stacks identify the actual entry, even when unrelated
    // components and callbacks have identical names. Never invoke the callback.
    const targets=new Map();for(const action of catalog.actions){for(const [component,owner]of [[action.component,action.owner],...(action.effect.kind==='control'&&action.effect.target?[[action.effect.component,action.effect.target.owner]]:[]),...(action.consumer?.entries??[]).map(entry=>[action.consumer.component,entry.owner])]){const names=targets.get(component)??new Set();names.add(owner);targets.set(component,names);}}
    const mounted=new Set(), candidates=[];
    fibers(fiber=>{mounted.add(fiber);const names=targets.get(name(fiber));if(!names)return;for(let parent=fiber.return,n=0;parent&&n++<100;parent=parent.return)if(names.has(name(parent))){candidates.push(fiber);break;}});
    // Free stale sites before adding newly mounted ones. Repeated JSX instances
    // share source evidence, but lookup still checks each live owner/control.
    for(const [id,record]of entries){
      if(![...record.fibers].some(fiber=>mounted.has(fiber)||mounted.has(fiber.alternate))){entries.delete(id);entryKeys.delete(record.key);record.fiber=undefined;}
      record.fibers.clear();
    }
    for(const fiber of candidates)entry(fiber);
    collected=[...bindings.values(),...entries.values()].filter(b=>!b.site&&!b.checked).map(b=>({id:b.id,kind:b.kind,owner:name(b.fiber),stack:(b.stack??'').slice(0,8000),source:b.source}));
    return page(0);
  }
  const page=offset=>({bindings:collected.slice(offset,offset+100),next:offset+100<collected.length?offset+100:undefined});
  function entry(fiber,create=true){
    const source=fiber._debugStack??fiber._debugSource;if(!source||typeof source!=='object')return;
    let record=entrySources.get(source);
    if(record&&entries.get(record.id)!==record){
      const existing=entryKeys.get(record.key);
      if(existing)record=existing;
      else if(create&&entries.size<1500){entries.set(record.id,record);entryKeys.set(record.key,record);}
      else record=undefined;
    }
    if(!record){
      const stack=typeof source.stack==='string'?source.stack.slice(0,8000):undefined;
      const location=!stack?{file:source.fileName,line:source.lineNumber,column:Math.max(0,(source.columnNumber??1)-1)}:undefined;
      const key=JSON.stringify([name(fiber),stack??location]);
      record=entryKeys.get(key);
      if(!record&&create&&entries.size<1500){record={id:`entry-${++sequence}`,key,kind:'entry',fiber,stack,source:location,actions:new Set(),fibers:new Set()};entryKeys.set(key,record);entries.set(record.id,record);}
      if(record)entrySources.set(source,record);
    }
    if(record){record.fiber=fiber;record.fibers.add(fiber);}return record;
  }
  function configure(next=catalog,matches,checked=[]){structureCache=undefined;catalog=next;for(const match of matches){const binding=bindings.get(match.binding);if(binding)binding.site=match.site;else entries.get(match.binding)?.actions.add(match.site);}for(const id of checked){const binding=bindings.get(id)??entries.get(id);if(binding)binding.checked=true;}}
  const descendants = (fiber,callback) => fibers(callback,fiber);
  function attached(fiber,boxes){let measurable=false,shown=false;descendants(fiber,child=>{if(shown)return false;if(child.tag!==5)return;let measured=boxes?.get(child);if(!measured){measured={measurable:false,shown:false};try{const native=child.stateNode?.canonical?.publicInstance??child.stateNode;if(typeof native?.getBoundingClientRect==='function'){measured.measurable=true;const box=native.getBoundingClientRect();measured.shown=box?.width>0&&box?.height>0;}}catch{}boxes?.set(child,measured);}measurable||=measured.measurable;shown||=measured.shown;});return !measurable||shown;}
  const activeAncestors = fiber => {
    for(let parent=fiber,count=0;parent&&count++<100;parent=parent.return){const p=parent.memoizedProps;if(hidden(p)||p?.visible===false&&(name(parent)==='Modal'||parent.tag===5&&typeof p?.onShow==='function')||p?.disabled===true||p?.accessibilityState?.disabled===true)return false;const styles=[p?.style];for(let i=0;i<styles.length&&i<30;i++){if(Array.isArray(styles[i]))styles.push(...styles[i]);else if(styles[i]?.display==='none')return false;}}
    return true;
  };
  function index(includeEntries=false) {
    const observed=observeCommits();
    let structure=observed&&structureCache;
    if(!structure){
      const names=new Map(),current=new WeakMap(),all=[],props=new Map();
      fibers(fiber=>{
        all.push(fiber);current.set(fiber,fiber);if(fiber.alternate)current.set(fiber.alternate,fiber);
        const n=name(fiber);if(n){const list=names.get(n)??[];list.push(fiber);names.set(n,list);}
        const p=fiber.memoizedProps;if(p&&typeof p==='object'){const list=props.get(p)??[];list.push(fiber);props.set(p,list);}
      });
      structure={names,current,all,props};if(observed)structureCache=structure;
    }
    const {names,current,all,props}=structure,live=new WeakMap(),boxes=new WeakMap(),states=new Map(),values=new Map(),matched=new Map(),targets=new Set(),openers=new Map();
    if(includeEntries)for(const action of catalog.actions){targets.add(action.component);if(action.effect.kind==='control')targets.add(action.effect.component);if(action.consumer)targets.add(action.consumer.component);}
    // Source bindings can change without a React commit. Rebuild these matches
    // from the current catalog, while reusing only the committed tree structure.
    for(const n of targets)for(const fiber of names.get(n)??[]){
      for(const id of entry(fiber,false)?.actions??[]){const list=matched.get(id)??[];list.push(fiber);matched.set(id,list);}
    }
    for(const binding of bindings.values())if(binding.site&&current.has(binding.fiber)){const list=states.get(binding.site)??[];list.push(binding);states.set(binding.site,list);}
    if(includeEntries)for(const action of catalog.actions){
      if(action.preview||action.effect.kind!=='control')continue;
      for(const fiber of names.get(action.effect.component)??[]){
        if(action.effect.target&&!(matched.get(`${action.id}:target`)??[]).includes(fiber))continue;
        const value=controlValue(fiber,action.effect.prop);if(!value)continue;
        const list=openers.get(value)??[];if(!list.includes(action))list.push(action);openers.set(value,list);
      }
    }
    // Native bounds cross into Fabric. Related owners share host descendants;
    // measure each host once during this synchronous lookup, then discard it.
    const isVisible=fiber=>{let value=live.get(fiber);if(value===undefined){value=activeAncestors(fiber)&&attached(fiber,boxes);live.set(fiber,value);}return value;};
    const inside=(fiber,owner)=>{if(!owner)return false;for(let p=fiber,n=0;p&&n++<100;p=p.return)if(p===owner||p===owner.alternate)return true;return false;};
    return {names,entries:matched,isVisible,inside,current,all,props,states,values,openers};
  }
  function roots(focus,tree) {
    if(!focus)return [];
    const props=tree?.props??new Map();
    if(!tree)fibers(fiber=>{const p=fiber.memoizedProps;if(p&&typeof p==='object'){const list=props.get(p)??[];list.push(fiber);props.set(p,list);}});
    const result=[focus];for(const projection of projected)if(projection.focus===focus||projection.focus===focus.alternate){for(const target of props.get(projection.child.props)??[])result.push(target);}
    const seen=new Set(),queue=[focus];
    for(let offset=0;offset<queue.length&&offset<12;offset++){
      const source=queue[offset];
      fibers(fiber=>{
        const visit=(element,depth=0)=>{
          if(!element||typeof element!=='object'||depth>8||seen.has(element))return;seen.add(element);
          if(Array.isArray(element)){for(const child of element.slice(0,100))visit(child,depth+1);return;}
          if(!element.props||!element.type)return;
          for(const target of props.get(element.props)??[]){if(target.type!==element.type&&target.elementType!==element.type)continue;if(result.some(root=>indexInside(target,root)))continue;if(!result.includes(target)){result.push(target);queue.push(target);}}
          visit(element.props.children,depth+1);
        };
        if(!fiber.child&&fiber.tag!==5)visit(fiber.memoizedProps?.children);
      },source);
    }
    return result;
  }
  const indexInside=(fiber,owner)=>{for(let p=fiber,n=0;p&&n++<100;p=p.return)if(p===owner||p===owner?.alternate)return true;return false;};
  function visualFocus(focus,tree){return roots(focus,tree).at(-1)??focus;}
  const projected=[],caughtPatches=[];
  function previewErrorHandler(original,records,root) {
    const wrapped=function(error,info){
      const preview=records?.find(item=>item.errorRoot===root&&info?.errorBoundary?.constructor===item.boundaryType);
      if(preview){preview.failed=true;return;}
      return original.apply(this,arguments);
    };
    return {wrapped,detach:()=>{records=undefined;root=undefined;}};
  }
  function containPreviewErrors(focus,record,boundaryType) {
    let root;const seen=new Set();
    for(let parent=focus;parent&&!seen.has(parent);parent=parent.return){seen.add(parent);if(parent.tag===3)root=parent.stateNode;}
    if(!root||typeof root.onCaughtError!=='function')return;
    record.errorRoot=root;record.boundaryType=boundaryType;
    if(caughtPatches.some(patch=>patch.root===root&&root.onCaughtError===patch.wrapped))return;
    const original=root.onCaughtError;
    const {wrapped,detach}=previewErrorHandler(original,projected,root);
    root.onCaughtError=wrapped;caughtPatches.push({root,original,wrapped,detach});
  }
  function releasePreviewErrors(all=false) {
    for(let index=caughtPatches.length-1;index>=0;index--){
      const patch=caughtPatches[index];
      if(!all&&projected.some(record=>record.errorRoot===patch.root))continue;
      if(patch.root.onCaughtError===patch.wrapped)patch.root.onCaughtError=patch.original;
      patch.detach();caughtPatches.splice(index,1);
    }
  }
  function projectionRoot(focus) {
    const modules=globalThis.__r?.getModules?.();let react,native;
    for(const module of modules?.values?.()??[]){if(!module.isInitialized)continue;const exports=module.publicModule?.exports;if(typeof exports?.createElement==='function'&&typeof exports.useState==='function')react=exports;
      // Framework exports only. No project module, account store or native
      // screen controller is evaluated to manufacture a destination.
      if(Object.getOwnPropertyDescriptor(exports??{},'Platform')&&Object.getOwnPropertyDescriptor(exports??{},'StyleSheet')){try{if(typeof exports.Platform?.OS==='string'&&typeof exports.StyleSheet?.create==='function'&&exports.View&&exports.Modal)native=exports;}catch{}}
    }
    if(!react||typeof react.Component!=='function'||!native)return;
    let ancestor;const seen=new Set();
    for(let parent=focus;parent&&!seen.has(parent);parent=parent.return){seen.add(parent);if(parent.type===native.View||parent.elementType===native.View)ancestor=parent;}
    let root;if(ancestor)fibers(fiber=>{if(fiber===ancestor||fiber===ancestor.alternate)root=fiber;});
    for(const renderer of hook.renderers.values())if(root&&renderer.rendererPackageName==='react-native-renderer'&&typeof renderer.overrideProps==='function')return {root,renderer,react,native};
  }
  function project(focus, preview) {
    if(!focus||!preview&&(!undo.length||projected.some(p=>p.focus===focus||p.focus===focus.alternate)))return {error:'This view cannot be projected.'};
    const context=projectionRoot(focus);if(!context)return {error:'This renderer cannot project a local view.'};
    const type=focus.elementType??focus.type;
    if(!type||typeof type==='string')return {error:'No component view to project.'};
    const {root,renderer,react,native}=context,props=root.memoizedProps;
    const child=react.createElement(type,preview?.props??focus.memoizedProps);
    let content=child;
    // Keep live provider values. Never fabricate auth or query data for the
    // preview. Context values remain inside this temporary app-side closure.
    const ancestors=new Set();
    for(let parent=focus.return;parent&&!ancestors.has(parent);parent=parent.return){
      ancestors.add(parent);
      if(parent.tag!==10||!parent.memoizedProps||!('value'in parent.memoizedProps))continue;
      const provider=parent.elementType??parent.type;if(provider)content=react.createElement(provider,{value:preview?.providers?.get(parent)??parent.memoizedProps.value},content);
    }
    const record={root,renderer,props,focus,child,seed:preview?.seed,views:preview?.views,shown:false,dismissed:false,failed:false};
    class PreviewBoundary extends react.Component {
      constructor(props){super(props);this.state={failed:false};}
      static getDerivedStateFromError(){return {failed:true};}
      componentDidCatch(){record.failed=true;}
      render(){return this.state.failed?null:this.props.children;}
    }
    let modalProps={};
    for(let parent=focus.return;parent;parent=parent.return)if(parent.type===native.Modal||parent.elementType===native.Modal){
      for(const key of ['presentationStyle','transparent','statusBarTranslucent','navigationBarTranslucent','hardwareAccelerated','supportedOrientations'])if(key in parent.memoizedProps)modalProps[key]=parent.memoizedProps[key];
      break;
    }
    const modal=react.createElement(native.Modal,{transparent:false,...modalProps,visible:true,animationType:'none',onShow:()=>{record.shown=true;},onDismiss:()=>{record.dismissed=true;}},react.createElement(PreviewBoundary,null,content));
    const children=Array.isArray(props.children)?props.children:[props.children];
    record.element=modal;record.next={...props,children:react.createElement(react.Fragment,null,...children,modal)};
    if(preview&&!patchPreviewEffects(react))return {error:'Temporary preview effects cannot be contained.'};
    if(record.seed&&!patchHooks()){if(!projected.length)unpatchPreviewEffects();return {error:'Temporary hook initialization is unavailable.'};}
    // React Native reports even caught render errors to LogBox. Contain only
    // errors caught by this exact temporary boundary; all app errors keep the
    // root's original handler. Neither the error nor its message is retained.
    containPreviewErrors(focus,record,PreviewBoundary);
    projected.push(record);undo.push({projection:record});
    structureCache=undefined;renderer.overrideProps(root,[],record.next);
    if(record.seed)record.seedTimer=later(()=>{if(!projected.includes(record))return;if(!record.seed.applied)record.failed=true;if(!collecting.size&&!projected.some(p=>p.seed&&!p.seed.applied&&!p.failed))unpatch();},1000);
    return {name:name(focus),focus};
  }
  // Copy one proven shared-state reference into the preview's props/provider.
  // Getters, class instances and ambiguous primitive matches stay untouched.
  function replaceReference(value, before, next, depth=0, budget={left:200}) {
    if(value===before)return {value:next,matches:1};
    if(!value||typeof value!=='object'||depth>4||--budget.left<0||!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype)return {value,matches:0};
    const descriptors=Object.getOwnPropertyDescriptors(value);let matches=0;
    for(const [key,descriptor]of Object.entries(descriptors)){
      if(!descriptor.enumerable||!('value'in descriptor)||['__proto__','constructor','prototype'].includes(key))continue;
      const result=replaceReference(descriptor.value,before,next,depth+1,budget);matches+=result.matches;if(result.matches)descriptors[key]={...descriptor,value:result.value};
    }
    return {value:matches?Object.defineProperties(Array.isArray(value)?[]:{},descriptors):value,matches};
  }
  function previewState(action, found) {
    const before=hookValue(found.binding),value=setPath(before,action.effect.path,action.effect.value);
    const focus=found.consumer??found.binding.fiber;
    if(focus===found.binding.fiber||focus===found.binding.fiber.alternate)return project(focus,{views:action.views,seed:{index:found.binding.index,kind:found.binding.kind,value,applied:false}});
    if(before===undefined||before===null)return {error:'The shared presentation has no real state to copy.'};
    const props=replaceReference(focus.memoizedProps,before,value),providers=new Map();let matches=props.matches;
    const seen=new Set();for(let parent=focus.return;parent&&!seen.has(parent);parent=parent.return){
      seen.add(parent);if(parent===found.binding.fiber||parent===found.binding.fiber.alternate)break;
      if(parent.tag!==10)continue;const result=replaceReference(parent.memoizedProps?.value,before,value);matches+=result.matches;if(result.matches)providers.set(parent,result.value);
    }
    if(matches!==1)return {error:'The shared presentation state is missing or ambiguous.'};
    return project(focus,{props:props.value,providers,views:action.views});
  }
  function condition(node,props) {
    if(!node)return true;
    if('value'in node)return node.value;
    if(node.prop){let value=props;for(const part of node.prop)value=value?.[part];return value;}
    const a=condition(node.args[0],props),b=node.args[1]&&condition(node.args[1],props);
    switch(node.op){case '!':return !a;case '&&':return a&&b;case '||':return a||b;case '===':return a===b;case '!==':return a!==b;case '==':return a==b;case '!=':return a!=b;}
    return false;
  }
  function hookValue(binding,tree) {
    // React alternates swap on every commit. Read the currently mounted owner.
    if(tree?.values.has(binding))return tree.values.get(binding);
    let live;if(tree)live=tree.current.get(binding.fiber);else fibers(fiber=>{if(fiber===binding.fiber||fiber===binding.fiber.alternate)live=fiber;});
    if(!live)return;
    binding.fiber=live;
    let state=live.memoizedState;for(let i=0;state&&i<binding.index;i++)state=state.next;
    const value=state?.memoizedState;tree?.values.set(binding,value);return value;
  }
  const controlValue=(fiber,prop)=>prop==='ref'?fiber.ref?.current??fiber.memoizedProps?.ref?.current:fiber.memoizedProps?.[prop];
  const find = (action,tree=index(true),focus,scope=roots(focus,tree)) => {
    const inScope=fiber=>!focus||scope.some(root=>tree.inside(fiber,root));
    if(action.preview&&action.effect.kind==='state'){
      const candidates=(tree.states.get(action.effect.site)??[]).filter(b=>['useState','useReducer'].includes(b.kind));
      const found=[];
      for(const binding of candidates){
        const snapshot=hookValue(binding,tree);
        const consumers=action.consumer?(tree.entries.get(`${action.id}:consumer`)??[]).filter(f=>name(f)===action.consumer.component&&tree.inside(f,binding.fiber)):[binding.fiber];
        for(const consumer of consumers){
          if(focus&&!scope.some(root=>tree.inside(consumer,root)||tree.inside(root,consumer))||!tree.isVisible(consumer)||!tree.isVisible(binding.fiber))continue;
          let value=snapshot;for(const part of action.effect.path)value=value?.[part];
          if(value===action.effect.value)continue;found.push({owner:consumer,consumer,binding});
        }
      }
      return found.length===1?found[0]:undefined;
    }
    if(action.preview&&action.effect.kind==='control'){
      const targets=(tree.entries.get(`${action.id}:target`)??[]).filter(f=>name(f)===action.effect.component&&(!focus||scope.some(root=>tree.inside(f,root)||tree.inside(root,f)))&&activeAncestors(f.return));
      const found=[];
      for(const fiber of targets){
        const value=controlValue(fiber,action.effect.prop);
        // A mounted, closed sheet may carry props for another wizard step. If
        // its source has a proven opener, honor that opener's current state.
        const openers=tree.openers.get(value);
        if(openers?.length&&!openers.some(opener=>find(opener,tree,focus)?.target?.value===value))continue;
        const pairs=[['open',['close','dismiss','hide']],['present',['dismiss','close']],['show',['hide','close','dismiss']],['expand',['close','collapse','dismiss']]];
        const pair=pairs.find(([method])=>typeof value?.[method]==='function'&&value[method].length===0);
        const close=pair?.[1].find(method=>typeof value?.[method]==='function');
        if(pair&&close&&!found.some(f=>f.target.value===value))found.push({owner:fiber,target:{fiber,value,method:pair[0],close}});
      }
      return found.length===1?found[0]:undefined;
    }
    // Most source plans are absent from the current screen. Reject those by
    // source identity before measuring any same-named owner in a large feed.
    const entriesFound=(tree.entries.get(action.id)??[]).filter(fiber=>name(fiber)===action.component&&inScope(fiber)&&typeof fiber.memoizedProps?.[action.prop]==='function'&&fiber.memoizedProps.disabled!==true&&fiber.memoizedProps.accessibilityState?.disabled!==true&&fiber.memoizedProps['aria-disabled']!==true);
    if(!entriesFound.length)return;
    const candidates=(tree.names.get(action.owner)??[]).filter(fiber=>!focus||scope.some(root=>tree.inside(fiber,root)||tree.inside(root,fiber)));
    const ownersFound=candidates.filter(owner=>entriesFound.some(fiber=>tree.inside(fiber,owner))&&tree.isVisible(owner)&&!candidates.some(child=>child!==owner&&tree.inside(child,owner)&&tree.isVisible(child))).filter(owner=>entriesFound.some(fiber=>tree.inside(fiber,owner)&&tree.isVisible(fiber)));
    if(ownersFound.length!==1)return;const owner=ownersFound[0];
    const matching=entriesFound.filter(fiber=>tree.inside(fiber,owner)&&tree.isVisible(fiber)&&Object.entries(action.trigger??{}).every(([key,value])=>fiber.memoizedProps?.[key]===value));
    const callbacks=new Set(matching.map(fiber=>fiber.memoizedProps[action.prop]));
    if(callbacks.size>1&&action.handler){for(const callback of callbacks)if(callback.name!==action.handler)callbacks.delete(callback);}
    if(callbacks.size!==1||!condition(action.guard,owner.memoizedProps))return;
    if(action.effect.kind==='state'){
      const site=catalog.states.find(s=>s.id===action.effect.site);
      const matches=(tree.states.get(action.effect.site)??[]).filter(b=>{if(b.kind!=='useState')return false;hookValue(b,tree);return tree.isVisible(b.fiber)&&(site?.owner!==action.owner||tree.inside(b.fiber,owner));});
      if(matches.length!==1)return;const binding=matches[0];
      let value=hookValue(binding,tree);for(const part of action.effect.path)value=value?.[part];
      if(JSON.stringify(value)===JSON.stringify(action.effect.value))return;
      if(!action.effect.path.length&&typeof action.effect.value==='object'&&value!=null)return;
      return {owner,binding};
    }
    if(action.effect.kind==='control'){
      const targets=(tree.names.get(action.effect.component)??[]).filter(fiber=>tree.inside(fiber,owner)&&(!action.effect.target||(tree.entries.get(`${action.id}:target`)??[]).includes(fiber))).flatMap(fiber=>{
        const value=action.effect.prop==='ref'?fiber.ref?.current??fiber.memoizedProps?.ref?.current:fiber.memoizedProps?.[action.effect.prop];
        const close=(Array.isArray(action.effect.close)?action.effect.close:[action.effect.close]).find(key=>typeof value?.[key]==='function');
        return value&&typeof value[action.effect.method]==='function'&&close?[{fiber,value,close}]:[];
      });
      // Shared controls can appear in alternate JSX branches. Require one live
      // instance and never select between two mounted controllers.
      const unique=[];for(const target of targets){const existing=unique.find(t=>t.value===target.value);if(!existing)unique.push(target);else if(tree.inside(target.fiber,existing.fiber))existing.fiber=target.fiber;}
      if(unique.length===1)return {owner,target:unique[0]};
    }
  };
  let lastAvailable=0;
  const list = focus => {const tree=index(true),scope=roots(focus,tree),seen=new Set();const result=catalog.actions.filter(action=>{const found=find(action,tree,focus,scope);if(!found)return false;const key=found.target?.value??JSON.stringify([action.effect.site,action.effect.path,action.effect.value]);if(seen.has(key))return false;seen.add(key);return true;}).map(action=>({id:action.id,name:action.name,file:action.file,line:action.line}));lastAvailable=result.length;return result;};
  function activeViews(focus) {
    const tree=index(),visual=visualFocus(focus,tree),ids=new Set();
    for(const record of projected){if(record.failed)continue;for(let p=visual,n=0;p&&n++<100;p=p.return)if((p.pendingProps??p.memoizedProps)===record.child.props){for(const id of record.views??[])ids.add(id);break;}}
    for(const action of catalog.actions){
      if(!action.views?.length||action.effect.kind!=='state')continue;
      for(const binding of tree.states.get(action.effect.site)??[]){
        let value=hookValue(binding,tree);for(const part of action.effect.path)value=value?.[part];if(value!==action.effect.value)continue;
        if(!(tree.names.get(action.name)??[]).some(f=>tree.inside(f,binding.fiber)&&(!visual||tree.inside(f,visual))&&tree.isVisible(f)))continue;
        for(const id of action.views)ids.add(id);
      }
    }
    return [...ids];
  }
  function setPath(value,path,next) {
    if(!path.length)return next;
    const [first,...rest]=path;const copy=Array.isArray(value)?value.slice():{...value};copy[first]=setPath(value?.[first],rest,next);return copy;
  }
  const nativeRecords=new Map();let commitPatch,nativeArmed=false;
  function nativeHandler(key, handler, record) {
    // A newer observer can keep this wrapper as its original handler. Detach
    // the record even when the wrapper can no longer be removed from that chain.
    record.detach.push(()=>{record=undefined;});
    return function(...args){
      if(record){const state=args[0]?.nativeEvent?.state;if(key==='onShow'||key==='onDismiss'||['open','opened','presented','closed','dismissed'].includes(state))record.pending=false;else if(['opening','closing'].includes(state))record.pending=true;}
      return handler.apply(this,args);
    };
  }
  function forgetNative(record) {
    for(const detach of record.detach)detach();record.detach.length=0;
    if(record.canonical&&record.canonical[record.field]===record.patched)record.canonical[record.field]=record.original;
    record.fiber=record.canonical=record.original=record.patched=undefined;
  }
  function commitHandler(original,callback) {
    const state={callback};
    return {original,state,wrapped:function(...args){try{return original.apply(this,args);}finally{state.callback?.();}}};
  }
  const inside=(fiber,owner)=>{for(let p=fiber,n=0;p&&n++<100;p=p.return)if(p===owner||p===owner?.alternate)return true;return false;};
  function watchNative(focus, pending = false, ancestors = false, mounting = false) {
    const scope=focus?roots(focus):[];
    fibers(fiber=>{
      if(fiber.tag!==5&&fiber.tag!==1)return;
      const canonical=fiber.tag===1?fiber.stateNode:fiber.stateNode?.canonical,field=fiber.tag===1?'props':'currentProps',props=canonical?.[field];
      if(!props||typeof props.onShow!=='function'&&typeof props.onDismiss!=='function'&&typeof props.onStateChange!=='function')return;
      const previous=nativeRecords.get(canonical);
      if(previous?.patched===props){previous.fiber=fiber;if(pending&&focus&&scope.some(root=>inside(fiber,root)||ancestors&&inside(root,fiber)))previous.pending=true;return;}
      if(nativeRecords.size>=200&&!previous)return;
      const pendingBefore=previous?.pending??(mounting&&typeof props.onShow==='function');
      if(previous)forgetNative(previous);
      const record={canonical,field,fiber,original:props,pending:pendingBefore,detach:[]};
      const patched={...props};
      for(const key of ['onShow','onDismiss','onStateChange'])if(typeof props[key]==='function'){
        patched[key]=nativeHandler(key,props[key],record);
      }
      record.patched=patched;try{canonical[field]=patched;}catch{forgetNative(record);nativeRecords.delete(canonical);return;}
      if(pending&&focus&&scope.some(root=>inside(fiber,root)||ancestors&&inside(root,fiber)))record.pending=true;
      nativeRecords.set(canonical,record);
    });
  }
  function observeCommits() {
    if(commitPatch&&hook?.onCommitFiberRoot===commitPatch.wrapped)return true;
    // A later observer may replace the hook without forwarding ours. Detach
    // the old callback and observe the current chain before reusing metadata.
    if(commitPatch){commitPatch.state.callback=undefined;commitPatch=undefined;structureCache=undefined;}
    if(typeof hook?.onCommitFiberRoot!=='function')return false;
    const patch=commitHandler(hook.onCommitFiberRoot,()=>{structureCache=undefined;if(nativeArmed)watchNative(undefined,false,false,true);});
    try{hook.onCommitFiberRoot=patch.wrapped;}catch{patch.state.callback=undefined;return false;}
    if(hook.onCommitFiberRoot!==patch.wrapped){patch.state.callback=undefined;return false;}
    commitPatch=patch;return true;
  }
  function armNative(focus) {
    nativeArmed=true;observeCommits();watchNative(focus,true);
  }
  function motion(focus,viewport,tree=index(),scope=roots(focus,tree)) {
    for(const [canonical,record]of nativeRecords)if(!tree.current.has(record.fiber)&&!tree.current.has(record.fiber?.alternate)){forgetNative(record);nativeRecords.delete(canonical);}
    let pending=[...nativeRecords.values()].some(r=>r.pending&&scope.some(root=>inside(r.fiber,root)||inside(root,r.fiber)));const boxes=[];
    const relevant=new Set();
    // Build the same connected-body and ancestor set without testing every
    // offscreen feed fiber against each parent chain. Preserve mounted order.
    if(focus)for(const root of scope){
      for(let parent=root,count=0;parent&&count++<100;parent=parent.return)relevant.add(parent);
      descendants(root,fiber=>{if(inside(fiber,root))relevant.add(fiber);});
    }
    for(const fiber of tree.all){
      if(!relevant.has(fiber))continue;
      const canonical=fiber.stateNode?.canonical,record=canonical&&nativeRecords.get(canonical);
      if(record?.pending)pending=true;
      // Remaining hosts still contribute transition events, but their bounds
      // cannot change this capped signature. Avoid extra Fabric layout reads.
      if(boxes.length>=24)continue;
      try{const box=canonical?.publicInstance?.getBoundingClientRect?.();if(box&&boxes.length<24){let {x,y,width,height}=box;if(viewport){const right=Math.min(x+width,viewport.x+viewport.width),bottom=Math.min(y+height,viewport.y+viewport.height);x=Math.max(x,viewport.x);y=Math.max(y,viewport.y);width=right-x;height=bottom-y;if(width<=0||height<=0)continue;}boxes.push([x,y,width,height].map(v=>Math.round(v)));}}catch{}
    }
    if(projected.some(record=>!record.shown&&(focus===record.focus||roots(record.focus).includes(focus))))pending=true;
    const error=projected.some(record=>record.failed&&(focus===record.focus||roots(record.focus).includes(focus)))?'The temporary presentation preview failed.':undefined;
    return {pending,signature:JSON.stringify(boxes),error};
  }
  function clearNative(){structureCache=undefined;nativeArmed=false;if(commitPatch)commitPatch.state.callback=undefined;if(commitPatch&&hook.onCommitFiberRoot===commitPatch.wrapped)hook.onCommitFiberRoot=commitPatch.original;commitPatch=undefined;for(const record of nativeRecords.values())forgetNative(record);nativeRecords.clear();}
  function open(id,focus) {
    armNative();
    const action=catalog.actions.find(a=>a.id===id),found=action&&find(action,index(true),focus);if(!found)return {error:'This presentation entry is not currently available.'};
    if(action.effect.kind==='state'){
      if(action.preview)return {...previewState(action,found),expected:action.name};
      const b=found.binding;let previous=hookValue(b);for(const part of action.effect.path)previous=previous?.[part];
      undo.push({binding:b,path:action.effect.path,value:previous,nativeDismiss:previous==null||previous===false});
      // Guard discovery only supplies finite presentation values. No session,
      // account, query cache or credential store is modified here.
      b.setter(previous=>setPath(previous,action.effect.path,action.effect.value));
      return {name:action.name,scope:catalog.states.find(s=>s.id===action.effect.site)?.owner===action.owner?b.fiber:undefined};
    }
    if(action.effect.kind==='control'){
      const {fiber,value,close}=found.target;
      armNative(fiber);undo.push({control:value,close,focus:fiber,views:action.views});value[found.target.method??action.effect.method]();
      return {name:action.name,focus:fiber};
    }
    return {error:'Unsupported presentation transition.'};
  }
  async function rollback(level = 0, wait = true) {
    while(undo.length>Math.max(0,level)){
      // Keep the checkpoint until its close operation succeeds. A thrown close
      // must not discard the only way to restore the app on the next attempt.
      const entry=undo[undo.length-1];
      if(entry.projection){
        const record=entry.projection;clearTimeout(record.seedTimer);
        const props=record.root.memoizedProps??record.props;
        structureCache=undefined;record.renderer.overrideProps(record.root,[],{...props,children:record.props.children});
        if(wait){const started=Date.now();while(!record.dismissed&&Date.now()-started<1000)await new Promise(resolve=>later(resolve,40));}
        const index=projected.indexOf(record);if(index>=0)projected.splice(index,1);
        releasePreviewErrors();if(record.seed)unpatch();if(!projected.length)unpatchPreviewEffects();
      }else if(entry.control){
        const focus=entry.focus;watchNative(focus,true);entry.control[entry.close]();
        if(wait){const started=Date.now();while(motion(focus).pending&&Date.now()-started<2000)await new Promise(resolve=>later(resolve,40));}
      }else{
        const focus=entry.focus;if(entry.nativeDismiss)watchNative(focus,true,true);
        entry.binding.setter(previous=>setPath(previous,entry.path,entry.value));
        if(wait&&entry.nativeDismiss){const started=Date.now();while(motion(focus).pending&&Date.now()-started<2000)await new Promise(resolve=>later(resolve,40));}
      }
      undo.pop();
    }
    if(wait&&level===0)clearNative();
    if(wait)await new Promise(resolve=>later(resolve,80));
  }
  function cleanup(){for(const record of projected)clearTimeout(record.seedTimer);projected.length=0;releasePreviewErrors(true);clearNative();unpatch();unpatchPreviewEffects();collecting.clear();bindings.clear();for(const record of entries.values()){record.fibers.clear();record.fiber=undefined;}entries.clear();entryKeys.clear();collected=[];entrySources=new WeakMap();undo.length=0;catalog={states:[],actions:[]};owners=new WeakMap();}
  function focusedComponent(name_,scope,tree,connected=scope?roots(scope,tree):[]) {
    const candidates=(tree.names.get(name_)??[]).filter(fiber=>(!scope||connected.some(root=>tree.inside(fiber,root)))&&tree.isVisible(fiber));
    const unique=candidates.filter(owner=>!candidates.some(child=>child!==owner&&tree.inside(child,owner)));
    return unique.length===1?unique[0]:undefined;
  }
  function probeFocus(focus,expected) {
    const tree=index(),currentFocus=focus&&tree.current.get(focus),connected=roots(currentFocus,tree);
    return {focus:currentFocus,visualFocus:connected.at(-1)??currentFocus,expectedReady:(!focus||!!currentFocus)&&(!expected||!!focusedComponent(expected,currentFocus,tree,connected)),motion:viewport=>motion(currentFocus,viewport,tree,connected)};
  }
  const diagnostics=()=>({bindings:bindings.size,matchedBindings:[...bindings.values()].filter(b=>b.site).length,entries:entries.size,entryInstances:[...entries.values()].reduce((total,record)=>total+record.fibers.size,0),lastScheduled,matchedEntries:[...entries.values()].filter(e=>e.actions.size).length,actions:catalog.actions.length,lastAvailable,nativeRecords:nativeRecords.size,nativePending:[...nativeRecords.values()].filter(r=>r.pending).length,checkpoints:undo.length,projections:projected.length});
  return {collect,records,configure,list,open,activeViews,rollback,cleanup,motion, visualFocus, project, diagnostics, probeFocus, focusFor:(name_,scope)=>focusedComponent(name_,scope,index()), focused:focus=>{if(undo.length)undo[undo.length-1].focus=focus;}, checkpoint:()=>undo.length};
}
