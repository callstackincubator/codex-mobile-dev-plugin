/** Temporary hook tracking. Setters keep working after cleanup, without retaining fibers. */
export function installPresentationRuntime({ hook, fibers, hidden, later }) {
  let sequence = 0, owners = new WeakMap(), collecting = new Set();
  const bindings = new Map(), patches = [], effectPatches = [], undo = [];
  let collected = [];
  const entries = new Map(); let entrySources = new WeakMap();
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
    if(!collecting.has(name(live.fiber)))return result;
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
  async function collect(states = catalog.states, actions = catalog.actions) {
    catalog={states,actions};
    if(!patchHooks())return records(0);
    try {
      const mounted=new Set();fibers(fiber=>mounted.add(fiber));
      for(const [id,binding]of bindings)if(!mounted.has(binding.fiber)&&!mounted.has(binding.fiber.alternate))bindings.delete(id);
      const tracked=fiber=>{const record=owners.get(fiber)??owners.get(fiber.alternate);return record&&[...record.values()].some(id=>bindings.has(id));};
      const targets=new Set(states.flatMap(site=>[site.owner,...(site.owners??[])])),missing=new Set();
      for(const fiber of mounted){if(fiber.tag===14)continue;const owner=name(fiber);if(targets.has(owner)&&!tracked(fiber))missing.add(owner);}
      const names=collecting=missing;
      if(!names.size)return records(0);
      const scheduled=new Set();
      fibers(fiber=>{
        if(!names.has(name(fiber))||scheduled.has(fiber))return;
        for(const renderer of hook.renderers.values())if(renderer.rendererPackageName==='react-native-renderer'&&typeof renderer.scheduleUpdate==='function'){
          scheduled.add(fiber);try{renderer.scheduleUpdate(fiber);}catch{}break;
        }
      });
      if(scheduled.size)await new Promise(resolve=>later(resolve,80,resolve));
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
    const mounted=new Set();fibers(fiber=>{mounted.add(fiber);const names=targets.get(name(fiber));if(!names)return;for(let parent=fiber.return,n=0;parent&&n++<100;parent=parent.return)if(names.has(name(parent))){entry(fiber);break;}});
    for(const [id,record]of entries)if(!mounted.has(record.fiber)&&!mounted.has(record.fiber.alternate))entries.delete(id);
    collected=[...bindings.values(),...entries.values()].filter(b=>!b.site&&!b.checked).map(b=>({id:b.id,kind:b.kind,owner:name(b.fiber),stack:(b.stack??'').slice(0,8000),source:b.source}));
    return page(0);
  }
  const page=offset=>({bindings:collected.slice(offset,offset+100),next:offset+100<collected.length?offset+100:undefined});
  function entry(fiber){
    const source=fiber._debugStack??fiber._debugSource;if(!source||typeof source!=='object')return;
    let record=entrySources.get(source);
    if(!record&&entries.size<1500){record={id:`entry-${++sequence}`,kind:'entry',fiber,stack:source.stack,source:!source.stack?{file:source.fileName,line:source.lineNumber,column:Math.max(0,(source.columnNumber??1)-1)}:undefined,actions:new Set()};entrySources.set(source,record);entries.set(record.id,record);}
    if(record){record.fiber=fiber;entries.set(record.id,record);}return record;
  }
  function configure(next=catalog,matches,checked=[]){catalog=next;for(const match of matches){const binding=bindings.get(match.binding);if(binding)binding.site=match.site;else entries.get(match.binding)?.actions.add(match.site);}for(const id of checked){const binding=bindings.get(id)??entries.get(id);if(binding)binding.checked=true;}}
  const descendants = (fiber,callback) => fibers(callback,fiber);
  function attached(fiber){let measurable=false,shown=false;descendants(fiber,child=>{if(shown)return false;if(child.tag!==5)return;try{const native=child.stateNode?.canonical?.publicInstance??child.stateNode;if(typeof native?.getBoundingClientRect!=='function')return;measurable=true;const box=native.getBoundingClientRect();if(box?.width>0&&box?.height>0)shown=true;}catch{}});return !measurable||shown;}
  const activeAncestors = fiber => {
    for(let parent=fiber,count=0;parent&&count++<100;parent=parent.return){const p=parent.memoizedProps;if(hidden(p)||p?.visible===false&&(name(parent)==='Modal'||parent.tag===5&&typeof p?.onShow==='function')||p?.disabled===true||p?.accessibilityState?.disabled===true)return false;const styles=[p?.style];for(let i=0;i<styles.length&&i<30;i++){if(Array.isArray(styles[i]))styles.push(...styles[i]);else if(styles[i]?.display==='none')return false;}}
    return true;
  };
  const visible=fiber=>activeAncestors(fiber)&&attached(fiber);
  function index() {
    const names=new Map(), live=new WeakMap(), current=new WeakMap(), all=[], states=new Map(), values=new Map();
    fibers(fiber=>{all.push(fiber);current.set(fiber,fiber);if(fiber.alternate)current.set(fiber.alternate,fiber);const n=name(fiber);if(n){const list=names.get(n)??[];list.push(fiber);names.set(n,list);}});
    for(const binding of bindings.values())if(binding.site&&current.has(binding.fiber)){const list=states.get(binding.site)??[];list.push(binding);states.set(binding.site,list);}
    const isVisible=fiber=>{let value=live.get(fiber);if(value===undefined){value=visible(fiber);live.set(fiber,value);}return value;};
    const inside=(fiber,owner)=>{for(let p=fiber,n=0;p&&n++<100;p=p.return)if(p===owner||p===owner.alternate)return true;return false;};
    return {names,isVisible,inside,current,all,states,values};
  }
  function roots(focus,tree) {
    if(!focus)return [];
    const props=new Map(),add=fiber=>{const p=fiber.memoizedProps;if(p&&typeof p==='object'){const list=props.get(p)??[];list.push(fiber);props.set(p,list);}};
    if(tree)for(const fiber of tree.all)add(fiber);else fibers(add);
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
  const projected=[];
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
    projected.push(record);undo.push({projection:record});
    renderer.overrideProps(root,[],record.next);
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
  const find = (action,tree=index(),focus,scope=roots(focus,tree)) => {
    const inScope=fiber=>!focus||scope.some(root=>tree.inside(fiber,root));
    if(action.preview&&action.effect.kind==='state'){
      const candidates=(tree.states.get(action.effect.site)??[]).filter(b=>['useState','useReducer'].includes(b.kind));
      const found=[];
      for(const binding of candidates){
        const snapshot=hookValue(binding,tree);if(!tree.isVisible(binding.fiber))continue;
        const consumers=action.consumer?(tree.names.get(action.consumer.component)??[]).filter(f=>entry(f)?.actions.has(`${action.id}:consumer`)&&tree.inside(f,binding.fiber)):[binding.fiber];
        for(const consumer of consumers){
          if(!tree.isVisible(consumer)||focus&&!scope.some(root=>tree.inside(consumer,root)||tree.inside(root,consumer)))continue;
          let value=snapshot;for(const part of action.effect.path)value=value?.[part];
          if(value===action.effect.value)continue;found.push({owner:consumer,consumer,binding});
        }
      }
      return found.length===1?found[0]:undefined;
    }
    if(action.preview&&action.effect.kind==='control'){
      const targets=(tree.names.get(action.effect.component)??[]).filter(f=>activeAncestors(f.return)&&entry(f)?.actions.has(`${action.id}:target`)&&(!focus||scope.some(root=>tree.inside(f,root)||tree.inside(root,f))));
      const found=[];
      for(const fiber of targets){
        const value=action.effect.prop==='ref'?fiber.ref?.current??fiber.memoizedProps?.ref?.current:fiber.memoizedProps?.[action.effect.prop];
        const pairs=[['open',['close','dismiss','hide']],['present',['dismiss','close']],['show',['hide','close','dismiss']],['expand',['close','collapse','dismiss']]];
        const pair=pairs.find(([method])=>typeof value?.[method]==='function'&&value[method].length===0);
        const close=pair?.[1].find(method=>typeof value?.[method]==='function');
        if(pair&&close&&!found.some(f=>f.target.value===value))found.push({owner:fiber,target:{fiber,value,method:pair[0],close}});
      }
      return found.length===1?found[0]:undefined;
    }
    const candidates=(tree.names.get(action.owner)??[]).filter(fiber=>tree.isVisible(fiber)&&(!focus||scope.some(root=>tree.inside(fiber,root)||tree.inside(root,fiber))));
    const ownersFound=candidates.filter(owner=>!candidates.some(child=>child!==owner&&tree.inside(child,owner))).filter(owner=>(tree.names.get(action.component)??[]).some(fiber=>entry(fiber)?.actions.has(action.id)&&tree.inside(fiber,owner)&&inScope(fiber)&&tree.isVisible(fiber)&&typeof fiber.memoizedProps?.[action.prop]==='function'));
    if(ownersFound.length!==1)return;const owner=ownersFound[0];
    const triggers=(tree.names.get(action.component)??[]).filter(fiber=>tree.inside(fiber,owner)&&inScope(fiber)&&tree.isVisible(fiber)&&typeof fiber.memoizedProps?.[action.prop]==='function');
    const matching=triggers.filter(fiber=>entry(fiber)?.actions.has(action.id)&&Object.entries(action.trigger??{}).every(([key,value])=>fiber.memoizedProps?.[key]===value));
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
      const targets=(tree.names.get(action.effect.component)??[]).filter(fiber=>tree.inside(fiber,owner)&&(!action.effect.target||entry(fiber)?.actions.has(`${action.id}:target`))).flatMap(fiber=>{
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
  const list = focus => {const tree=index(),scope=roots(focus,tree),seen=new Set();return catalog.actions.filter(action=>{const found=find(action,tree,focus,scope);if(!found)return false;const key=found.target?.value??JSON.stringify([action.effect.site,action.effect.path,action.effect.value]);if(seen.has(key))return false;seen.add(key);return true;}).map(action=>({id:action.id,name:action.name,file:action.file,line:action.line}));};
  function activeViews(focus) {
    const tree=index(),visual=visualFocus(focus,tree),ids=new Set();
    for(const record of projected){if(record.failed)continue;for(let p=visual,n=0;p&&n++<100;p=p.return)if((p.pendingProps??p.memoizedProps)===record.child.props){for(const id of record.views??[])ids.add(id);break;}}
    for(const action of catalog.actions){
      if(!action.views?.length||action.effect.kind!=='state')continue;
      for(const binding of tree.states.get(action.effect.site)??[]){
        let value=hookValue(binding,tree);for(const part of action.effect.path)value=value?.[part];if(value!==action.effect.value)continue;
        if(!(tree.names.get(action.name)??[]).some(f=>tree.isVisible(f)&&tree.inside(f,binding.fiber)&&(!visual||tree.inside(f,visual))))continue;
        for(const id of action.views)ids.add(id);
      }
    }
    return [...ids];
  }
  function setPath(value,path,next) {
    if(!path.length)return next;
    const [first,...rest]=path;const copy=Array.isArray(value)?value.slice():{...value};copy[first]=setPath(value?.[first],rest,next);return copy;
  }
  const nativeRecords=new Map();let commitPatch;
  function nativeHandler(key, handler, record) {
    return function(...args){const state=args[0]?.nativeEvent?.state;if(key==='onShow'||key==='onDismiss'||['open','opened','presented','closed','dismissed'].includes(state))record.pending=false;else if(['opening','closing'].includes(state))record.pending=true;return handler.apply(this,args);};
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
      if(nativeRecords.size>=200)return;
      const record={canonical,field,fiber,original:props,pending:previous?.pending??(mounting&&typeof props.onShow==='function')};
      const patched={...props};
      for(const key of ['onShow','onDismiss','onStateChange'])if(typeof props[key]==='function'){
        patched[key]=nativeHandler(key,props[key],record);
      }
      record.patched=patched;try{canonical[field]=patched;}catch{return;}
      if(pending&&focus&&scope.some(root=>inside(fiber,root)||ancestors&&inside(root,fiber)))record.pending=true;
      nativeRecords.set(canonical,record);
    });
  }
  function armNative(focus) {
    if(!commitPatch&&typeof hook?.onCommitFiberRoot==='function'){
      const original=hook.onCommitFiberRoot,wrapped=function(...args){const result=original.apply(this,args);watchNative(undefined,false,false,true);return result;};
      hook.onCommitFiberRoot=wrapped;commitPatch={original,wrapped};
    }
    watchNative(focus,true);
  }
  function motion(focus,viewport) {
    const scope=roots(focus);
    const mounted=new Set();fibers(fiber=>mounted.add(fiber));
    for(const [canonical,record]of nativeRecords)if(!mounted.has(record.fiber)&&!mounted.has(record.fiber.alternate))nativeRecords.delete(canonical);
    let pending=[...nativeRecords.values()].some(r=>r.pending&&scope.some(root=>inside(r.fiber,root)||inside(root,r.fiber)));const boxes=[];
    fibers(fiber=>{
      if(!focus||!scope.some(root=>inside(fiber,root)||inside(root,fiber)))return;
      const canonical=fiber.stateNode?.canonical,record=canonical&&nativeRecords.get(canonical);
      if(record?.pending)pending=true;
      try{const box=canonical?.publicInstance?.getBoundingClientRect?.();if(box&&boxes.length<24){let {x,y,width,height}=box;if(viewport){const right=Math.min(x+width,viewport.x+viewport.width),bottom=Math.min(y+height,viewport.y+viewport.height);x=Math.max(x,viewport.x);y=Math.max(y,viewport.y);width=right-x;height=bottom-y;if(width<=0||height<=0)return;}boxes.push([x,y,width,height].map(v=>Math.round(v)));}}catch{}
    });
    if(projected.some(record=>!record.shown&&(focus===record.focus||roots(record.focus).includes(focus))))pending=true;
    const error=projected.some(record=>record.failed&&(focus===record.focus||roots(record.focus).includes(focus)))?'The temporary presentation preview failed.':undefined;
    return {pending,signature:JSON.stringify(boxes),error};
  }
  function clearNative(){if(commitPatch&&hook.onCommitFiberRoot===commitPatch.wrapped)hook.onCommitFiberRoot=commitPatch.original;commitPatch=undefined;for(const record of nativeRecords.values())if(record.canonical[record.field]===record.patched)record.canonical[record.field]=record.original;nativeRecords.clear();}
  function open(id,focus) {
    armNative();
    const action=catalog.actions.find(a=>a.id===id),found=action&&find(action,index(),focus);if(!found)return {error:'This presentation entry is not currently available.'};
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
      const entry=undo.pop();
      try{if(entry.projection){const record=entry.projection;clearTimeout(record.seedTimer);const index=projected.indexOf(record);if(index>=0)projected.splice(index,1);if(record.seed)unpatch();if(!projected.length)unpatchPreviewEffects();const props=record.root.memoizedProps??record.props;record.renderer.overrideProps(record.root,[],{...props,children:record.props.children});if(wait){const started=Date.now();while(!record.dismissed&&Date.now()-started<1000)await new Promise(resolve=>later(resolve,40));}}else if(entry.control){const focus=entry.focus;watchNative(focus,true);entry.control[entry.close]();if(wait){const started=Date.now();while(motion(focus).pending&&Date.now()-started<2000)await new Promise(resolve=>later(resolve,40));}}else{const focus=entry.focus;if(entry.nativeDismiss)watchNative(focus,true,true);entry.binding.setter(previous=>setPath(previous,entry.path,entry.value));if(wait&&entry.nativeDismiss){const started=Date.now();while(motion(focus).pending&&Date.now()-started<2000)await new Promise(resolve=>later(resolve,40));}}}catch{}
    }
    if(wait&&level===0)clearNative();
    if(wait)await new Promise(resolve=>later(resolve,80));
  }
  function cleanup(){for(const record of projected)clearTimeout(record.seedTimer);projected.length=0;clearNative();unpatch();unpatchPreviewEffects();bindings.clear();entries.clear();collected=[];entrySources=new WeakMap();undo.length=0;catalog={states:[],actions:[]};owners=new WeakMap();}
  return {collect,records,configure,list,open,activeViews,rollback,cleanup,motion, visualFocus, project, focusFor:(name_,scope)=>{const tree=index();const candidates=(tree.names.get(name_)??[]).filter(fiber=>tree.isVisible(fiber)&&(!scope||tree.inside(fiber,scope)||tree.inside(fiber,scope.alternate)));const unique=candidates.filter(owner=>!candidates.some(child=>child!==owner&&tree.inside(child,owner)));return unique.length===1?unique[0]:undefined;}, focused:focus=>{if(undo.length)undo[undo.length-1].focus=focus;}, checkpoint:()=>undo.length};
}
