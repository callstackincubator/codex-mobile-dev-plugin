/** Temporary hook tracking. Setters keep working after cleanup, without retaining fibers. */
export function installPresentationRuntime({ hook, fibers, hidden, later }) {
  let sequence = 0, owners = new WeakMap(), collecting = new Set();
  const bindings = new Map(), patches = [], effectPatches = [], undo = [];
  let collected = [];
  const entries = new Map(), entryKeys = new Map(); let entrySources = new WeakMap();
  let lastScheduled = 0, lastExactScheduled = 0, lastFallbackScheduled = 0, lastCompiledBindings = 0, structureCache, sourceRoot, sourceHash;
  const portalEffects=new Map();let portalOwners=new WeakMap(),approvedPortals=new WeakSet(),syncingPortals=false;
  let previewRefs=new WeakSet(),containedImperativeHandles=0,containedSubscriptions=0,preservedRootFragments=0;
  const uiEffects=new Map();let uiEffectOwners=new WeakMap(),openedUiEffects=0;
  const queryPatches=[],querySnapshots=new Map();let reusedQueryResults=0,reusedQuerySelections=0;
  let queryCacheDiagnostics={clients:0,caches:0,observerCandidates:0,clientTypes:[],observerTypes:[]};
  let queryPreviewReads=0,queryPreviewRejections={missing:0,representation:0,fields:0};
  let catalog = {states:[],actions:[]};
  let mountChecks={plans:0,moduleMissing:0,moduleCold:0,moduleUnknown:0,exportMissing:0,ownerMismatch:0,alreadyMounted:0,available:0};
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
    if(binding){binding.fiber=live.fiber;binding.setter=result[1];binding.prepared=false;}
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
      const preview=previewOwner(fiber),props=fiber?.pendingProps??fiber?.memoizedProps;
      if(preview&&props?.children?.props&&typeof fiber.type==='function'){
        let record=portalOwners.get(fiber)??portalOwners.get(fiber.alternate);
        if(!record&&portalEffects.size<50){record={id:`portal-${++sequence}`,fiber,preview,stack:new Error().stack};portalEffects.set(record.id,record);}
        if(record){record.fiber=fiber;portalOwners.set(fiber,record);}
      }
      if(preview&&Array.isArray(deps)&&deps.some(value=>openingControl(value))){
        const stack=(new Error().stack??'').slice(0,8000);
        let records=uiEffectOwners.get(fiber)??uiEffectOwners.get(fiber.alternate);
        if(!records){records=new Map();uiEffectOwners.set(fiber,records);}else uiEffectOwners.set(fiber,records);
        const key=stack.split('\n').slice(1,3).join('\n');
        let record=records.get(key);if(record&&!uiEffects.has(record.id))record=undefined;
        if(!record&&uiEffects.size<100){record={id:`ui-effect-${++sequence}`,fiber,preview,stack};records.set(key,record);uiEffects.set(record.id,record);}
        if(record){const body=Function.prototype.toString.call(callback);if(record.body!==body)record.approval=undefined;record.body=body;record.fiber=fiber;record.callback=callback;record.deps=deps;}
      }
      return original(preview?()=>{}:callback,deps);
    };
  }
  function queryResultWrapper(original,readQuery,patchState) {
    return function(options,...args){
      const result=original.call(this,options,...args);if(!patchState.active)return result;
      const fiber=current()?.fiber;
      if(!fiber)return result;
      let query;try{query=readQuery.call(this);}catch{return result;}
      // An observer changing keys can still own its previous query. Only the
      // exact current cache entry and representation can supply a real result.
      const state=query&&Object.getOwnPropertyDescriptor(query,'state')?.value;
      const hash=query&&Object.getOwnPropertyDescriptor(query,'queryHash')?.value;
      const optionHash=options&&Object.getOwnPropertyDescriptor(options,'queryHash')?.value;
      if(!state||typeof hash!=='string'||hash!==optionHash||!result||typeof result!=='object')return result;
      const select=Object.getOwnPropertyDescriptor(options,'select')?.value;
      const placeholder=Object.getOwnPropertyDescriptor(options,'placeholderData')?.value;
      const enabled=Object.getOwnPropertyDescriptor(options,'enabled')?.value;
      const records=querySnapshots.get(query)??[];
      if(previewOwner(fiber)){
        queryPreviewReads++;
        let selection=false;
        let matched=records.filter(record=>record.state===state&&record.select===select&&record.placeholder===placeholder&&record.enabled===enabled);
        // Inline selectors get a new function identity in a temporary render.
        // The ordinary framework read has already applied the new selector.
        // Reuse only a live settled result with that exact selected data object;
        // all result fields and the other observer options still have to agree.
        if(!matched.length&&typeof select==='function'){
          const data=ownQueryValue(result,'data');
          matched=records.filter(record=>record.state===state&&typeof record.select==='function'&&record.placeholder===placeholder&&record.enabled===enabled&&data!==undefined&&ownQueryValue(record.result,'data')===data&&currentSettledQueryResult(record,query,options));
          matched=matched.filter((record,index)=>matched.findIndex(other=>other.result===record.result)===index);
          selection=matched.length===1;
        }
        if(matched.length===1){
          const record=matched[0],snapshot=Object.getOwnPropertyDescriptors(record.result),next=Object.getOwnPropertyDescriptors(result);
          const mountFetch=currentSettledQueryResult(record,query,options)&&ownQueryValue(options,'_optimisticResults')==='optimistic'&&ownQueryValue(result,'fetchStatus')==='fetching'&&ownQueryValue(result,'isFetching')===true&&ownQueryValue(result,'isRefetching')===true;
          // A contained preview does not subscribe or fetch on mount. Reuse an
          // actual mounted observer's settled object when only that unstarted
          // mount fetch differs. Never synthesize flags or alter cache state.
          // Every other data/status field must agree with the library read.
          // Time-based staleness and changed observer options must not reuse an
          // old ready result. Methods and promises belong to observer instances.
          const keys=new Set([...Object.keys(snapshot),...Object.keys(next)]);
          const same=[...keys].every(key=>{
            if(['isFetchedAfterMount','refetch','promise'].includes(key))return true;
            if(mountFetch&&['fetchStatus','isFetching','isRefetching'].includes(key))return true;
            const a=snapshot[key],b=next[key];return a&&b&&'value'in a&&'value'in b&&a.value===b.value;
          });
          if(same){reusedQueryResults++;if(selection)reusedQuerySelections++;return record.result;}
          queryPreviewRejections.fields++;
        }else queryPreviewRejections[records.length?'representation':'missing']++;
        return result;
      }
      rememberQueryResult(query,result,options,this);
      return result;
    };
  }
  const ownQueryValue=(object,key)=>{
    if(!object||(typeof object!=='object'&&typeof object!=='function'))return;
    const descriptor=Object.getOwnPropertyDescriptor(object,key);return descriptor&&'value'in descriptor?descriptor.value:undefined;
  };
  function rememberQueryResult(query,result,options,observer){
    // Both ordinary renders and existing live observers supply the plain
    // framework result before trackResult creates a proxy. Never invent flags.
    const state=ownQueryValue(query,'state'),hash=ownQueryValue(query,'queryHash');
    if(!state||typeof hash!=='string'||hash!==ownQueryValue(options,'queryHash')||!result||typeof result!=='object')return;
    if(ownQueryValue(result,'data')===undefined||ownQueryValue(result,'isPending')!==false||ownQueryValue(result,'isFetching')!==false||ownQueryValue(result,'isError')!==false||ownQueryValue(result,'isPlaceholderData')!==false)return;
    const select=ownQueryValue(options,'select'),placeholder=ownQueryValue(options,'placeholderData'),enabled=ownQueryValue(options,'enabled');
    const records=querySnapshots.get(query)??[],record={state,select,placeholder,enabled,result,observer,staleTime:ownQueryValue(options,'staleTime'),refetchOnMount:ownQueryValue(options,'refetchOnMount')};
    const kept=records.filter(previous=>previous.state===state&&!(previous.select===select&&previous.placeholder===placeholder&&previous.enabled===enabled));
    kept.push(record);querySnapshots.delete(query);querySnapshots.set(query,kept.slice(-4));
    if(querySnapshots.size>200)querySnapshots.delete(querySnapshots.keys().next().value);
  }
  function currentSettledQueryResult(record,query,options){
    if(ownQueryValue(record.state,'fetchStatus')!=='idle'||ownQueryValue(record.state,'status')!=='success'||ownQueryValue(record.result,'fetchStatus')!=='idle')return false;
    if(record.staleTime!==ownQueryValue(options,'staleTime')||record.refetchOnMount!==ownQueryValue(options,'refetchOnMount'))return false;
    const observers=ownQueryValue(query,'observers');if(!Array.isArray(observers)||!observers.includes(record.observer))return false;
    const current=queryFrameworkMethod(record.observer,'QueryObserver','getCurrentQuery'),read=queryFrameworkMethod(record.observer,'QueryObserver','getCurrentResult');
    if(!current||!read)return false;
    try{
      if(current.method.call(record.observer)!==query)return false;
      const actual=read.method.call(record.observer);if(!actual||typeof actual!=='object')return false;
      const a=Object.getOwnPropertyDescriptors(actual),b=Object.getOwnPropertyDescriptors(record.result);
      return [...new Set([...Object.keys(a),...Object.keys(b)])].every(key=>a[key]&&b[key]&&'value'in a[key]&&'value'in b[key]&&a[key].value===b[key].value);
    }catch{return false;}
  }
  function patchQueryPrototype(prototype){
    if(!prototype||queryPatches.some(patch=>patch.prototype===prototype))return;
    const method=Object.getOwnPropertyDescriptor(prototype,'getOptimisticResult');
    const read=Object.getOwnPropertyDescriptor(prototype,'getCurrentQuery');
    if(!method?.writable||typeof method.value!=='function'||typeof read?.value!=='function')return;
    const original=method.value,state={active:true},wrapped=queryResultWrapper(original,read.value,state);
    try{Object.defineProperty(prototype,'getOptimisticResult',{...method,value:wrapped});}catch{return;}
    queryPatches.push({prototype,descriptor:method,original,wrapped,state});
  }
  function queryFrameworkMethod(object,owner,key){
    // Use the known library prototype's read method, never an instance getter
    // or an app override. Subclasses still use their actual library cache.
    for(let prototype=object&&Object.getPrototypeOf(object),count=0;prototype&&count++<5;prototype=Object.getPrototypeOf(prototype)){
      const constructor=ownQueryValue(prototype,'constructor'),label=ownQueryValue(constructor,'name');
      if(typeof constructor!=='function'||typeof label!=='string'||label.replace(/^_+/,'')!==owner)continue;
      const method=ownQueryValue(prototype,key);if(typeof method==='function')return {prototype,method};
    }
  }
  function collectQueryObservers(){
    const clients=new Set(),clientTypes=new Set(),observerTypes=new Set();let queriesRead=0;
    queryCacheDiagnostics={clients:0,caches:0,observerCandidates:0,clientTypes:[],observerTypes:[]};
    const describe=(object,types)=>{
      const label=ownQueryValue(ownQueryValue(Object.getPrototypeOf(object),'constructor'),'name');
      if(typeof label==='string'&&types.size<20)types.add(label.slice(0,80));return [...types];
    };
    for(const fiber of committedStructure().all){
      const client=ownQueryValue(fiber.memoizedProps,'client');
      if(!client||clients.has(client)||clients.size>=10)continue;
      clients.add(client);queryCacheDiagnostics.clients=clients.size;queryCacheDiagnostics.clientTypes=describe(client,clientTypes);
      const readCache=queryFrameworkMethod(client,'QueryClient','getQueryCache');if(!readCache)continue;
      let cache,queries;
      try{cache=readCache.method.call(client);const readAll=queryFrameworkMethod(cache,'QueryCache','getAll');if(!readAll)continue;queryCacheDiagnostics.caches++;queries=readAll.method.call(cache);}catch{continue;}
      if(!Array.isArray(queries))continue;
      for(const query of queries){
        const observers=ownQueryValue(query,'observers');if(!Array.isArray(observers)||!observers.length)continue;
        if(queriesRead++>=200)return;
        for(const observer of observers.slice(0,20)){
          if(!observer||typeof observer!=='object')continue;
          queryCacheDiagnostics.observerCandidates++;queryCacheDiagnostics.observerTypes=describe(observer,observerTypes);
          const current=queryFrameworkMethod(observer,'QueryObserver','getCurrentQuery');
          const result=queryFrameworkMethod(observer,'QueryObserver','getCurrentResult');
          if(!current||!result)continue;
          try{
            if(current.method.call(observer)!==query)continue;
            patchQueryPrototype(current.prototype);
            rememberQueryResult(query,result.method.call(observer),ownQueryValue(observer,'options'),observer);
          }catch{/* A detached observer cannot supply a settled result. */}
        }
      }
    }
  }
  function patchQueryResults() {
    for(const module of globalThis.__r?.getModules?.()?.values?.()??[]){
      if(!module.isInitialized||typeof module.verboseName!=='string'||!/(?:^|\/)@tanstack\/query-core\/(?:src|build\/[^/]+)\/queryObserver\.[cm]?[jt]s$/.test(modulePath(module.verboseName)))continue;
      const exports=module.publicModule?.exports,descriptor=exports&&Object.getOwnPropertyDescriptor(exports,'QueryObserver');
      let observer=descriptor&&'value'in descriptor?descriptor.value:undefined;
      // The initialized CommonJS library uses a live export getter. Read only
      // this qualified framework export, never a project module or its factory.
      if(!observer&&/\.cjs$/.test(modulePath(module.verboseName))&&typeof descriptor?.get==='function'&&!descriptor.set){
        try{observer=descriptor.get.call(exports);}catch{continue;}
      }
      const prototype=typeof observer==='function'?Object.getOwnPropertyDescriptor(observer,'prototype')?.value:undefined;
      patchQueryPrototype(prototype);
    }
    collectQueryObservers();
  }
  function unpatchQueryResults(){
    for(const patch of queryPatches){patch.state.active=false;if(Object.getOwnPropertyDescriptor(patch.prototype,'getOptimisticResult')?.value===patch.wrapped)Object.defineProperty(patch.prototype,'getOptimisticResult',patch.descriptor);}
    queryPatches.length=0;querySnapshots.clear();reusedQueryResults=reusedQuerySelections=0;queryPreviewReads=0;queryPreviewRejections={missing:0,representation:0,fields:0};queryCacheDiagnostics={clients:0,caches:0,observerCandidates:0,clientTypes:[],observerTypes:[]};
  }
  function patchHooks() {
    if(patches.length)return true;
    const modules=globalThis.__r?.getModules?.();if(!modules?.values)return false;
    for(const module of modules.values()){
      if(!module.isInitialized)continue;const react=mutableReact(module.publicModule?.exports);
      if(typeof react?.createElement!=='function'||typeof react.useState!=='function'||typeof react.useReducer!=='function')continue;
      for(const key of ['useState','useReducer']){
        const descriptor=Object.getOwnPropertyDescriptor(react,key);if(!descriptor?.writable)continue;
        const original=react[key],wrapped=hookWrapper(key,original);
        try{react[key]=wrapped;}catch{unpatch();return false;}patches.push({react,key,original,wrapped});
      }
      break;
    }
    return patches.length>0;
  }
  function unpatch(){for(const p of patches)if(p.react[p.key]===p.wrapped)p.react[p.key]=p.original;patches.length=0;}
  function previewRefWrapper(original) {
    return (...args)=>{
      const ref=original(...args);
      if(previewOwner(current()?.fiber)&&ref&&typeof ref==='object')previewRefs.add(ref);
      return ref;
    };
  }
  function previewHandleWrapper(original) {
    return (ref,create,deps)=>{
      // React implements this hook internally, so wrapping useLayoutEffect does
      // not contain it. A copied body must never overwrite or clear an app ref.
      if(previewOwner(current()?.fiber)&&(!ref||typeof ref!=='object'||!previewRefs.has(ref))){
        containedImperativeHandles++;return original(null,create,deps);
      }
      return original(ref,create,deps);
    };
  }
  const noSubscription=()=>()=>{};
  function previewSnapshotWrapper(original) {
    return (subscribe,getSnapshot,getServerSnapshot)=>{
      // This hook creates subscription effects inside React. Containing public
      // useEffect alone does not stop a copied query/store observer subscribing.
      // Keep its hook order and real snapshot reads; the app's own subscriptions
      // continue normally and can update the shared store.
      if(previewOwner(current()?.fiber)){containedSubscriptions++;subscribe=noSubscription;}
      return original(subscribe,getSnapshot,getServerSnapshot);
    };
  }
  function patchPreviewEffects(react) {
    if(effectPatches.length)return true;
    for(const key of ['useEffect','useLayoutEffect','useInsertionEffect','useRef','useImperativeHandle','useSyncExternalStore']){
      if(typeof react[key]!=='function')continue;
      if(!Object.getOwnPropertyDescriptor(react,key)?.writable){unpatchPreviewEffects();return false;}
      const original=react[key],wrapped=key==='useRef'?previewRefWrapper(original):key==='useImperativeHandle'?previewHandleWrapper(original):key==='useSyncExternalStore'?previewSnapshotWrapper(original):effectWrapper(original);
      try{react[key]=wrapped;}catch{unpatchPreviewEffects();return false;}effectPatches.push({react,key,original,wrapped});
    }
    return true;
  }
  function previewOwner(fiber){
    for(let index=projected.length-1;index>=0;index--){const record=projected[index];
      for(let p=fiber,count=0;p&&count++<100;p=p.return){const props=p.pendingProps??p.memoizedProps;if(props===record.child.props||record.portals?.some(portal=>props===portal.child.props))return record;}
    }
  }
  function unpatchPreviewEffects(){for(const p of effectPatches)if(p.react[p.key]===p.wrapped)p.react[p.key]=p.original;effectPatches.length=0;}
  const modulePath=value=>value.replaceAll('\\','/').replace(/^file:\/\//,'').replace(/^\.\//,'');
  const sourceModule=(modules,file)=>modules.get(file)??(sourceRoot?modules.get(`${sourceRoot}/${file}`):undefined);
  function collectionTargets(states) {
    const targets=new Map(), modules=globalThis.__r?.getModules?.();
    const initialized=new Map();
    for(const module of modules?.values?.()??[]){
      if(module.isInitialized&&typeof module.verboseName==='string')initialized.set(modulePath(module.verboseName),module.publicModule?.exports);
    }
    for(const site of states){
      const qualified=site.ownerSites??[];
      const sources=[{owner:site.owner,file:site.file},...qualified,...(site.owners??[]).filter(owner=>!qualified.some(source=>source.owner===owner)).map(owner=>({owner,file:site.file}))];
      for(const {owner,file}of sources){
        const target=targets.get(owner)??{types:new Set(),sitesByType:new Map(),fallbackSites:new Set(),fallback:false};
        const addType=type=>{target.types.add(type);const sites=target.sitesByType.get(type)??new Set();sites.add(site.id);target.sitesByType.set(type,sites);};
        const exports=sourceModule(initialized,file), matches=[];
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
        if(matches.length)for(const type of matches)addType(type);
        else if(site.ownerEntries?.some(entry=>entry.component===owner)){
          for(const record of entries.values())if(record.actions.has(`owner:${site.id}:${owner}`))for(const fiber of record.fibers){
            if(name(fiber)===owner){if(fiber.type)addType(fiber.type);if(fiber.elementType)addType(fiber.elementType);}
          }
        }else{target.fallback=true;target.fallbackSites.add(site.id);}
        targets.set(owner,target);
      }
    }
    return targets;
  }
  function collectPreparedStates(states,mounted) {
    lastCompiledBindings=0;
    const registry=globalThis.__MOBILE_DEV_FLOW_REGISTRY__;
    if(!sourceHash||typeof registry?.matchingOwners!=='function')return;
    const sites=new Map(states.map(site=>[site.id,site])),setters=new Map();
    for(const owner of registry.matchingOwners(sourceHash))for(const [id,value]of owner.entries){
      const site=sites.get(id);
      if(!site||owner.source!==`${site.file}#${site.owner}`||value.kind!=='state'||!['useState','useReducer'].includes(value.hook)||typeof value.tuple?.[1]!=='function')continue;
      const setter=value.tuple[1],previous=setters.get(setter);
      // A setter cannot prove two source sites. Ambiguous or stale values
      // fall back to the ordinary source binding path.
      setters.set(setter,previous?{ambiguous:true}:{site,value});
    }
    if(!setters.size)return;
    const renderer=[...(hook?.renderers?.values?.()??[])].find(value=>value.rendererPackageName==='react-native-renderer');
    if(!renderer)return;
    for(const fiber of mounted){
      let index=0;
      for(let state=fiber.memoizedState;state&&index<300;state=state.next,index++){
        const match=setters.get(state.queue?.dispatch);
        if(!match||match.ambiguous||!Object.is(state.memoizedState,match.value.tuple[0]))continue;
        let record=owners.get(fiber)??owners.get(fiber.alternate);
        if(!record)record=new Map();owners.set(fiber,record);
        let id=record.get(index),binding=id&&bindings.get(id);
        if(!binding){if(bindings.size>=1500)continue;id=String(++sequence);record.set(index,id);binding={id,index};bindings.set(id,binding);}
        // The exact same hook queue keeps evidence from an earlier full hook
        // pass. A prepared refresh must not turn that evidence into a partial
        // read and force the owner to render again at every screenshot.
        const prepared=binding.prepared!==false||binding.setter!==state.queue.dispatch||binding.kind!==match.value.hook;
        Object.assign(binding,{kind:match.value.hook,site:match.site.id,fiber,renderer,setter:state.queue.dispatch,prepared});
        lastCompiledBindings++;
      }
    }
  }
  async function collect(states = catalog.states, actions = catalog.actions, projectRoot = sourceRoot, preparedHash = sourceHash) {
    if(typeof projectRoot==='string')sourceRoot=modulePath(projectRoot).replace(/\/$/,'');
    sourceHash=preparedHash;
    catalog={states,actions};lastScheduled=lastExactScheduled=lastFallbackScheduled=0;patchQueryResults();
    try {
      const mounted=new Set(committedStructure().all);
      for(const [id,binding]of bindings)if(!mounted.has(binding.fiber)&&!mounted.has(binding.fiber.alternate))bindings.delete(id);
      collectPreparedStates(states,mounted);
      const tracked=(fiber,target)=>{
        const record=owners.get(fiber)??owners.get(fiber.alternate),found=record&&[...record.values()].map(id=>bindings.get(id)).filter(Boolean);
        if(!found?.length)return false;
        // A normal collection sees every hook. A prepared read only sees its
        // proven sites; keep collecting if this owner has another state site.
        if(found.some(binding=>!binding.prepared))return true;
        if(!target)return false;
        // Same-named components from different source modules have different
        // hook lists. Only this exact type's sites and unresolved sources can
        // require another pass. Never borrow a different owner's coverage.
        const sites=new Set([...target.fallbackSites,...(target.sitesByType.get(fiber.type)??[]),...(target.sitesByType.get(fiber.elementType)??[])]);
        return sites.size>0&&[...sites].every(site=>found.some(binding=>binding.site===site));
      };
      const targets=collectionTargets(states);
      for(const fiber of mounted){
        if(fiber.tag===14)continue;
        if(Array.isArray(fiber._debugHookTypes)&&!fiber._debugHookTypes.some(kind=>kind==='useState'||kind==='useReducer'))continue;
        const target=targets.get(name(fiber));if(tracked(fiber,target))continue;
        if(target&&(target.fallback||target.types.has(fiber.type)||target.types.has(fiber.elementType)))collecting.add(fiber);
      }
      if(!collecting.size||!patchHooks())return records(0);
      for(const fiber of collecting){
        for(const renderer of hook.renderers.values())if(renderer.rendererPackageName==='react-native-renderer'&&typeof renderer.scheduleUpdate==='function'){
          try{renderer.scheduleUpdate(fiber);lastScheduled++;const target=targets.get(name(fiber));if(target?.types.has(fiber.type)||target?.types.has(fiber.elementType))lastExactScheduled++;else lastFallbackScheduled++;}catch{}break;
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
    const targets=new Map();for(const action of catalog.actions){if(action.effect.kind==='mount')continue;for(const [component,owner]of [[action.component,action.owner],...(action.effect.kind==='control'&&action.effect.target?[[action.effect.component,action.effect.target.owner]]:[]),...(action.consumer?.entries??[]).map(entry=>[action.consumer.component,entry.owner]),...(action.handoffs??[]).map(entry=>[entry.component,entry.owner])]){const names=targets.get(component)??new Set();names.add(owner);targets.set(component,names);}}
    const ownerNames=new Set(catalog.states.flatMap(site=>(site.ownerEntries??[]).map(entry=>entry.component)));
    const mounted=new Set(), candidates=[];
    for(const fiber of committedStructure().all){
      mounted.add(fiber);
      // A portal moves an entry away from its source owner's physical parents.
      // Bind exact JSX first; logical owner checks still gate discovery/opening.
      if(ownerNames.has(name(fiber))||targets.has(name(fiber)))candidates.push(fiber);
    }
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
  function configure(next=catalog,matches,checked=[]){catalog=next;for(const match of matches){const binding=bindings.get(match.binding);if(binding)binding.site=match.site;else entries.get(match.binding)?.actions.add(match.site);}for(const id of checked){const binding=bindings.get(id)??entries.get(id);if(binding)binding.checked=true;}}
  const descendants = (fiber,callback) => fibers(callback,fiber);
  function attached(fiber,boxes){
    const bounds=child=>{
      let measured=boxes?.get(child);if(measured)return measured;
      measured={measurable:false,shown:false};
      try{const native=child.stateNode?.canonical?.publicInstance??child.stateNode;
        if(typeof native?.getBoundingClientRect==='function'){measured.measurable=true;measured.box=native.getBoundingClientRect();measured.shown=measured.box?.width>0&&measured.box?.height>0;}
      }catch{}
      boxes?.set(child,measured);return measured;
    };
    // Pagers retain their other pages at offscreen coordinates. A nonzero
    // rectangle alone must not make every repeated opening control visible.
    let viewport,measurable=false,shown=false;
    for(let parent=fiber.return,count=0;parent&&count++<100;parent=parent.return){
      if(parent.tag!==5)continue;const measured=bounds(parent),box=measured.box;
      if(measured.shown&&Number.isFinite(box.x)&&Number.isFinite(box.y))viewport=box;
    }
    descendants(fiber,child=>{
      if(shown)return false;if(child.tag!==5)return;
      const measured=bounds(child),box=measured.box;measurable||=measured.measurable;
      shown=measured.shown&&(!viewport||!Number.isFinite(box.x)||!Number.isFinite(box.y)||
        box.x<viewport.x+viewport.width&&box.x+box.width>viewport.x&&box.y<viewport.y+viewport.height&&box.y+box.height>viewport.y);
    });
    return !measurable||shown;
  }

  const activeAncestors = fiber => {
    for(let parent=fiber,count=0;parent&&count++<100;parent=parent.return){
      const p=parent.memoizedProps;if(hidden(p)||p?.visible===false&&(name(parent)==='Modal'||parent.tag===5&&typeof p?.onShow==='function')||p?.disabled===true||p?.accessibilityState?.disabled===true)return false;
      const styles=[p?.style];let display,opacity;
      for(let i=0;styles.length&&i<100;i++){const style=styles.pop();if(Array.isArray(style)){for(let j=style.length-1;j>=0;j--)styles.push(style[j]);}else if(style&&typeof style==='object'){if('display'in style)display=style.display;if('opacity'in style)opacity=style.opacity;}}
      if(display==='none'||opacity===0)return false;
    }
    return true;
  };
  function committedStructure() {
    const observed=observeCommits();
    let structure=observed&&structureCache;
    if(!structure){
      const names=new Map(),current=new WeakMap(),all=[],props=new Map(),images=[],concealed=new WeakSet();
      fibers(fiber=>{
        // Hidden tabs keep their native images mounted and can finish loading
        // in the background. Keep their event history until actual unmount;
        // they must not become new pending images when the tab regains focus.
        if(fiber.tag===5 && /image/i.test(typeof fiber.type==='string'?fiber.type:name(fiber)??''))images.push(fiber);
        // Only visible branches supply navigation, opening controls and props.
        if(concealed.has(fiber.return)||hidden(fiber.memoizedProps)){if(!nativeArmed)return false;concealed.add(fiber);return;}
        all.push(fiber);current.set(fiber,fiber);if(fiber.alternate)current.set(fiber.alternate,fiber);
        const n=name(fiber);if(n){const list=names.get(n)??[];list.push(fiber);names.set(n,list);}
        const p=fiber.memoizedProps;if(p&&typeof p==='object'){const list=props.get(p)??[];list.push(fiber);props.set(p,list);}
      });
      structure={names,current,all,props,images};if(observed)structureCache=structure;
    }
    return structure;
  }
  function index(includeEntries=false) {
    const {names,current,all,props}=committedStructure(),live=new WeakMap(),boxes=new WeakMap(),states=new Map(),values=new Map(),matched=new Map(),targets=new Set(),openers=new Map();
    if(includeEntries)for(const action of catalog.actions){targets.add(action.component);if(action.effect.kind==='control')targets.add(action.effect.component);if(action.consumer)targets.add(action.consumer.component);for(const handoffSite of action.handoffs??[])targets.add(handoffSite.component);}
    // Source bindings can change without a React commit. Rebuild these matches
    // from the current catalog, while reusing only the committed tree structure.
    for(const n of targets)for(const fiber of names.get(n)??[]){
      for(const id of entry(fiber,false)?.actions??[]){const list=matched.get(id)??[];list.push(fiber);matched.set(id,list);}
    }
    for(const binding of bindings.values())if(binding.site&&current.has(binding.fiber)){const list=states.get(binding.site)??[];list.push(binding);states.set(binding.site,list);}
    if(includeEntries)for(const action of catalog.actions){
      if(action.preview||action.effect.kind!=='control')continue;
      const targets=action.effect.target?matched.get(`${action.id}:target`)??[]:names.get(action.effect.component)??[];
      for(const fiber of targets){
        if(name(fiber)!==action.effect.component)continue;
        const value=controlValue(fiber,action.effect.prop);if(!value)continue;
        const list=openers.get(value)??[];if(!list.includes(action))list.push(action);openers.set(value,list);
      }
    }
    // Native bounds cross into Fabric. Related owners share host descendants;
    // measure each host once during this synchronous lookup, then discard it.
    const isVisible=fiber=>{let value=live.get(fiber);if(value===undefined){value=activeAncestors(fiber)&&attached(fiber,boxes);live.set(fiber,value);}return value;};
    const inside=(fiber,owner)=>{if(!owner)return false;for(let p=fiber,n=0;p&&n++<100;p=p.return)if(p===owner||p===owner.alternate)return true;return false;};
    return {names,entries:matched,isVisible,inside,current,all,props,states,values,openers,scopes:new WeakMap()};
  }
  function roots(focus,tree) {
    if(!focus)return [];
    if(tree?.scopes?.has(focus))return tree.scopes.get(focus);
    const props=(tree??committedStructure()).props;
    const result=[focus];for(const projection of projected)if(projection.focus===focus||projection.focus===focus.alternate){for(const target of props.get(projection.child.props)??[])result.push(target);}
    // A temporary owner can render its body through a null-rendering portal.
    // Follow its copy as well as the original using exact element identity.
    const seen=new Set(),queue=result.slice();
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
    tree?.scopes?.set(focus,result);return result;
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
  function mutableReact(exports) {
    // ESM namespace properties can report writable while rejecting assignment.
    // Use its real React default export only when both expose the same runtime.
    const value=exports&&Object.getOwnPropertyDescriptor(exports,'default')?.value;
    return value?.createElement===exports?.createElement&&typeof value?.useState==='function'&&value.useState===exports.useState&&value.useReducer===exports.useReducer?value:exports;
  }
  function projectionRoot(focus) {
    const modules=globalThis.__r?.getModules?.();let react,native;
    for(const module of modules?.values?.()??[]){if(!module.isInitialized)continue;const exports=module.publicModule?.exports;if(typeof exports?.createElement==='function'&&typeof exports.useState==='function')react=mutableReact(exports);
      // Framework exports only. No project module, account store or native
      // screen controller is evaluated to manufacture a destination.
      if(Object.getOwnPropertyDescriptor(exports??{},'Platform')&&Object.getOwnPropertyDescriptor(exports??{},'StyleSheet')){try{if(typeof exports.Platform?.OS==='string'&&typeof exports.StyleSheet?.create==='function'&&exports.View&&exports.Modal)native=exports;}catch{}}
    }
    if(!react||typeof react.Component!=='function'||!native)return;
    let ancestor;const seen=new Set();
    // Keep temporary content inside its nearest native container. The app's
    // main window cannot present while one of its native sheets is open.
    for(let parent=focus;parent&&!seen.has(parent);parent=parent.return){seen.add(parent);if(parent.type===native.View||parent.elementType===native.View){ancestor=parent;break;}}
    let root;if(ancestor)fibers(fiber=>{if(fiber===ancestor||fiber===ancestor.alternate)root=fiber;});
    for(const renderer of hook.renderers.values())if(root&&renderer.rendererPackageName==='react-native-renderer'&&typeof renderer.overrideProps==='function')return {root,renderer,react,native};
  }
  function nativeBodyRoots(focus) {
    const result=[];let text=false;
    descendants(focus,fiber=>{
      if(fiber.tag===6){text=true;return false;}
      if(fiber.tag!==5)return;
      result.push(fiber);return false;
    });
    return text?undefined:result;
  }
  function inlinePlacement(focus,{root,react}) {
    const boundaries=nativeTargets(focus,true).filter(record=>record.status.opened&&!record.status.closed);
    if(!boundaries.length)return;
    // A native sheet owns its coordinates, safe area and height. Render a
    // copied step in that same container, never in a second native window.
    if(root===focus||!boundaries.some(record=>inside(root,record.fiber))||nativeTargets(focus).some(record=>record.status.opened&&!record.status.closed))return {unavailable:true};
    const children=root.memoizedProps.children;
    const wrappers=new Set([react.Fragment,react.Profiler]);
    for(let parent=focus.return;parent&&parent!==root;parent=parent.return)if(parent.tag===10){wrappers.add(parent.type);wrappers.add(parent.elementType);}
    // Source instrumentation uses Profilers; Fragment and provider wrappers
    // also add no native layout. Keep them mounted and match their last body.
    let last=children;const seen=new Set();
    while(last&&!seen.has(last)){
      seen.add(last);
      if(Array.isArray(last)){last=last.filter(child=>child!==null&&child!==undefined&&typeof child!=='boolean').at(-1);continue;}
      if(wrappers.has(last.type)){last=last.props?.children;continue;}
      break;
    }
    // Appending after the original keeps React's existing sibling positions.
    // Require an exact last-child match so no footer or sibling moves ahead
    // of this step. Ambiguous containers must not produce a false capture.
    if(!last||last.props!==focus.memoizedProps||(last.type!==focus.type&&last.type!==focus.elementType))return {unavailable:true};
    const hosts=nativeBodyRoots(focus);
    if(!hosts?.length)return {unavailable:true};
    const sizes=hosts.map(inlineSize);
    if(sizes.some(size=>!size))return {unavailable:true};
    return {focus,hosts:hosts.map((fiber,i)=>{
      const props=fiber.memoizedProps;
      return {fiber,props,size:sizes[i],hiddenStyle:[props.style,{position:'absolute',opacity:0,...sizes[i]}]};
    })};
  }
  function inlineSize(fiber) {
    try {
      const instance=fiber?.stateNode?.canonical?.publicInstance??fiber?.stateNode,box=instance?.getBoundingClientRect?.();
      if(box&&Number.isFinite(box.width)&&Number.isFinite(box.height)&&box.width>0&&box.height>0)return {width:box.width,height:box.height};
    }catch{}
  }
  const concealedBodyProps={pointerEvents:'none',accessibilityElementsHidden:true,importantForAccessibility:'no-hide-descendants'};
  function hideInlineBody(record) {
    for(const host of record.inline.hosts){
      structureCache=undefined;record.renderer.overrideProps(host.fiber,[],{...host.fiber.memoizedProps,...concealedBodyProps,style:host.hiddenStyle});
    }
  }
  function restoreInlineBody(record) {
    if(!record.inline||record.parent)return;
    const tree=index();
    for(const host of record.inline.hosts){
      const fiber=tree.current.get(host.fiber);
      if(!fiber)continue;
      // Restore only fields still owned by this preview, preserving every
      // later app change even if it replaced just one of the overrides.
      const props={...fiber.memoizedProps};let changed=false;
      for(const [key,value]of Object.entries({...concealedBodyProps,style:host.hiddenStyle})){
        if(props[key]!==value&&!(key==='style'&&host.previousStyle&&props[key]===host.previousStyle))continue;
        if(Object.prototype.hasOwnProperty.call(host.props,key))props[key]=host.props[key];else delete props[key];
        changed=true;
      }
      if(changed){structureCache=undefined;record.renderer.overrideProps(fiber,[],props);}
    }
  }
  function syncInlineBody(record,tree) {
    const focus=tree.current.get(record.inline.focus),hosts=focus&&nativeBodyRoots(focus);
    if(!hosts?.length||hosts.length!==record.inline.hosts.length)return {error:'The original native presentation body changed during its preview.'};
    if(hosts.some(fiber=>!record.inline.hosts.some(host=>(fiber===host.fiber||fiber===host.fiber.alternate)&&(fiber.memoizedProps.style===host.hiddenStyle||host.previousStyle&&fiber.memoizedProps.style===host.previousStyle))))return {error:'The original native presentation body changed during its preview.'};
    const bodies=(tree.props.get(record.child.props)??[]).filter(fiber=>fiber.type===record.child.type||fiber.elementType===record.child.type);
    const copies=bodies.length===1&&nativeBodyRoots(bodies[0]);
    if(!copies?.length)return {pending:true};
    if(copies.length!==hosts.length||copies.some((fiber,i)=>fiber.type!==hosts[i].type))return {error:'The native presentation sizing roots do not match the copied form.'};
    let pending=false;
    for(let i=0;i<copies.length;i++){
      const size=inlineSize(copies[i]),host=record.inline.hosts[i],fiber=hosts[i];
      if(!size){pending=true;continue;}
      // Native sheets can observe their first content UIView by identity.
      // Keep that original root attached and size its invisible layout proxy
      // from the actual copied root. display:none would sever that sizing
      // signal; another sibling's height cannot update the native observer.
      if(size.width!==host.size.width||size.height!==host.size.height){
        if(fiber.memoizedProps.style!==host.hiddenStyle){pending=true;continue;}
        host.size=size;host.previousStyle=host.hiddenStyle;host.hiddenStyle=[host.props.style,{position:'absolute',opacity:0,...size}];
        structureCache=undefined;record.renderer.overrideProps(fiber,[],{...fiber.memoizedProps,style:host.hiddenStyle});pending=true;continue;
      }
      const actual=inlineSize(fiber);
      if(fiber.memoizedProps.style!==host.hiddenStyle||!actual||Math.abs(actual.width-size.width)>.5||Math.abs(actual.height-size.height)>.5)pending=true;
      else host.previousStyle=undefined;
    }
    return {pending};
  }
  const projectionElement=(child,record)=>child?.type===record.element.type&&child?.key===record.element.key;
  function removeProjection(record,root) {
    const props=root.memoizedProps,children=props.children?.props?.children;
    if(!Array.isArray(children))return;
    const remaining=children.filter(child=>!projectionElement(child,record));
    const original=record.props.children,body=original?.type===record.react.Fragment&&original.key==null?original.props.children:original;
    const expected=Array.isArray(body)?body:[body];
    const restored=remaining.length===expected.length&&remaining.every((child,index)=>child===expected[index])?original:record.react.cloneElement(props.children,{},...remaining);
    structureCache=undefined;record.renderer.overrideProps(root,[],{...props,children:restored});
  }
  function project(focus, preview, mountedContext) {
    if(!focus||!preview&&(!undo.length||projected.some(p=>p.focus===focus||p.focus===focus.alternate)))return {error:'This view cannot be projected.'};
    const owner=previewOwner(focus),tree=owner&&index();
    const ownerBodies=owner?(tree.props.get(owner.child.props)??[]).filter(fiber=>fiber.type===owner.child.type||fiber.elementType===owner.child.type):[];
    const nestedNative=owner&&nativeTargets(focus,true).some(record=>record.status.opened&&!record.status.closed&&ownerBodies.some(body=>inside(record.fiber,body)));
    // Reuse the current slot only within the same native presentation. A
    // sheet opened by the copied form has its own container and close order.
    const reusable=owner?.shown&&!nestedNative&&projectionAttached(owner);
    const context=reusable?projectionRoot(owner.root):mountedContext??projectionRoot(focus);if(!context)return {error:'This renderer cannot project a local view.'};
    const type=focus.elementType??focus.type;
    if(!type||typeof type==='string')return {error:'No component view to project.'};
    const {root,renderer,react,native}=context,props=root.memoizedProps;
    const inline=reusable?owner.inline:inlinePlacement(focus,context);
    if(inline?.unavailable)return {error:'This step has no exact content slot inside its native presentation.'};
    const child=react.createElement(type,preview?.props??focus.memoizedProps);
    let content=child;
    // Keep live provider values. Never fabricate auth or query data for the
    // preview. Context values remain inside this temporary app-side closure.
    const ancestors=new Set();
    for(let parent=focus.return;parent&&(!inline||parent!==root)&&!ancestors.has(parent);parent=parent.return){
      ancestors.add(parent);
      if(parent.tag!==10||!parent.memoizedProps||!('value'in parent.memoizedProps))continue;
      const provider=parent.elementType??parent.type;if(provider)content=react.createElement(provider,{value:preview?.providers?.get(parent)??parent.memoizedProps.value},content);
    }
    // Nested temporary form states share one shown native window. Stacking
    // Modal controllers for each step can leave UIKit displaying an old body
    // after React removes its tree. Retain each body's own undo checkpoint.
    const children=props.children?.props?.children;
    const previousPreview=reusable&&Array.isArray(children)&&children.includes(owner.element)?owner:undefined;
    const record={root,renderer,react,props,focus,child,content,inline,parent:previousPreview,portals:[],seed:preview?.seed,views:preview?.views,mount:preview?.mount,ios:native.Platform.OS==='ios',shown:!!inline||!!previousPreview,dismissed:false,failed:false};
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
    const body=react.createElement(PreviewBoundary,null,content);
    const key=`mobile-flow-preview-${++sequence}`;
    const modal=previousPreview?react.cloneElement(previousPreview.element,{},body):inline?react.createElement(react.Fragment,{key},body):react.createElement(native.Modal,{key,transparent:false,...modalProps,visible:true,animationType:'none',onShow:()=>{record.shown=true;},onDismiss:()=>{record.dismissed=true;}},body);
    // React unwraps one unkeyed root Fragment before reconciling children.
    // Append at that same level. Nesting the existing Fragment under a new
    // sibling array would remount the live app and rerun all of its effects.
    const transparentRoot=props.children?.type===react.Fragment&&props.children.key==null&&props.children.props?.ref===undefined;
    const appBody=transparentRoot?props.children.props.children:props.children;
    const appChildren=Array.isArray(appBody)?appBody:[appBody];
    if(!previousPreview&&transparentRoot)preservedRootFragments++;
    record.element=modal;record.next={...props,children:previousPreview?react.cloneElement(props.children,{},...children.map(element=>element===previousPreview.element?modal:element)):react.createElement(react.Fragment,null,...appChildren,modal)};
    if(!patchPreviewEffects(react))return {error:'Temporary preview effects cannot be contained.'};
    if(record.seed&&!patchHooks()){if(!projected.length)unpatchPreviewEffects();return {error:'Temporary hook initialization is unavailable.'};}
    // React Native reports even caught render errors to LogBox. Contain only
    // errors caught by this exact temporary boundary; all app errors keep the
    // root's original handler. Neither the error nor its message is retained.
    containPreviewErrors(focus,record,PreviewBoundary);
    projected.push(record);undo.push({projection:record});
    if(inline&&!previousPreview)hideInlineBody(record);
    structureCache=undefined;renderer.overrideProps(root,[],record.next);
    if(record.seed)seedDeadline(record);
    return {name:name(focus),focus};
  }
  function seedDeadline(record){
    clearTimeout(record.seedTimer);
    record.seedTimer=later(()=>{if(!projected.includes(record))return;if(!record.seed.applied)record.failed=true;if(!collecting.size&&!projected.some(p=>p.seed&&!p.seed.applied&&!p.failed))unpatch();},1000);
  }
  function openingControl(value,method){
    if(!value||typeof value!=='object')return false;
    const data=key=>{const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&'value'in descriptor?descriptor.value:undefined;};
    const pairs=[['open',['close','dismiss','hide']],['present',['dismiss','close']],['show',['hide','close']],['expand',['close','collapse']]];
    return pairs.some(([key,closers])=>(!method||method===key)&&typeof data(key)==='function'&&data(key).length===0&&closers.some(close=>typeof data(close)==='function'));
  }
  const sameEffectDeps=(a,b)=>Array.isArray(a)&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
  function releaseUiEffects(preview){
    for(const [id,record]of uiEffects)if(!preview||record.preview===preview){
      if(record.cleanup){const cleanup=record.cleanup;record.cleanup=undefined;cleanup();}
      record.callback=record.deps=record.executedDeps=undefined;uiEffects.delete(id);
    }
  }
  function uiEffectBindings(focus){
    const tree=index(),scope=roots(focus,tree),result=[];
    for(const record of uiEffects.values()){
      const fiber=tree.current.get(record.fiber);
      if(!fiber||!projected.includes(record.preview)||record.preview.failed||!scope.some(root=>tree.inside(fiber,root))||sameEffectDeps(record.executedDeps,record.deps))continue;
      record.fiber=fiber;result.push({id:record.id,owner:name(fiber),kind:'ui-effect',stack:record.approval?'':record.stack,approval:record.approval});
    }
    return result;
  }
  function previewEffects(matches,focus){
    const available=new Set(uiEffectBindings(focus).map(binding=>binding.id));let opened=0;
    for(const match of matches){
      if(!available.has(match.binding))continue;
      const record=uiEffects.get(match.binding),parsed=/^ui-effect:(\d+):(open|present|show|expand)$/.exec(match.site??'');
      if(!parsed||!openingControl(record.deps[Number(parsed[1])],parsed[2])||record.deps.some((value,index)=>index!==Number(parsed[1])&&value!==null&&value!==undefined&&!['string','number','boolean'].includes(typeof value)))continue;
      record.approval=match.site;
      try{
        if(record.cleanup){const cleanup=record.cleanup;record.cleanup=undefined;cleanup();}
        record.executedDeps=record.deps.slice();
        const value=record.deps[Number(parsed[1])];
        if(!undo.some(entry=>entry.control===value)){
          const close=['close','dismiss','hide','collapse'].find(key=>typeof Object.getOwnPropertyDescriptor(value,key)?.value==='function');
          const target=controllerFocus(record.fiber,value);armNative(target);
          undo.push({control:value,close,focus:target,nativeFocus:target,uiEffect:record,views:record.preview.views?.slice()});
        }
        const cleanup=record.callback();if(typeof cleanup==='function')record.cleanup=cleanup;
        opened++;openedUiEffects++;
      }catch{record.preview.failed=true;return {error:'The temporary UI opening effect failed.'};}
    }
    return {effects:opened};
  }
  function portalBindings(focus){
    const tree=index(),scope=roots(focus,tree),result=[];
    for(const record of portalEffects.values()){
      const fiber=tree.current.get(record.fiber),child=fiber?.memoizedProps?.children;
      if(!fiber||fiber.child||!child?.props||!projected.includes(record.preview)||!scope.some(root=>tree.inside(fiber,root)))continue;
      if(record.preview.portals.some(portal=>portal.id===record.id))continue;
      if((tree.props.get(child.props)??[]).some(target=>target.type===child.type||target.elementType===child.type))continue;
      record.fiber=fiber;
      result.push({id:record.id,owner:name(fiber),kind:'portal',stack:approvedPortals.has(fiber.type)?'':record.stack,approved:approvedPortals.has(fiber.type)});
    }
    return result;
  }
  function updatePortalPreview(record){
    const tree=index(),root=tree.current.get(record.root)??record.root,props=root.memoizedProps;
    const children=props?.children?.props?.children;
    if(!Array.isArray(children)||!children.includes(record.element))return false;
    const body=record.react.createElement(record.react.Fragment,null,record.content,...record.portals.map(portal=>portal.element));
    const boundary=record.react.cloneElement(record.element.props.children,{},body);
    const modal=record.react.cloneElement(record.element,{},boundary);
    record.next={...props,children:record.react.createElement(record.react.Fragment,null,...children.map(child=>child===record.element?modal:child))};
    record.element=modal;record.root=root;structureCache=undefined;record.renderer.overrideProps(root,[],record.next);return true;
  }
  function portalElement(record,fiber,child,id){
    let element=child;const seen=new Set();
    for(let parent=fiber.return;parent&&!seen.has(parent);parent=parent.return){
      seen.add(parent);if(parent.tag!==10||!parent.memoizedProps||!('value'in parent.memoizedProps))continue;
      const provider=parent.elementType??parent.type;if(provider)element=record.react.createElement(provider,{value:parent.memoizedProps.value},element);
    }
    return record.react.createElement(record.react.Fragment,{key:id},element);
  }
  function previewPortals(ids,focus){
    const available=new Set(portalBindings(focus).map(binding=>binding.id)),changed=new Set();
    for(const id of ids){
      if(!available.has(id))continue;const portal=portalEffects.get(id),fiber=portal.fiber,child=fiber.memoizedProps.children,record=portal.preview;
      approvedPortals.add(fiber.type);record.portals.push({...portal,child,element:portalElement(record,fiber,child,portal.id)});changed.add(record);
    }
    for(const record of changed)if(!updatePortalPreview(record))return {error:'The temporary portal preview is no longer mounted.'};
    return {portals:changed.size};
  }
  function syncPortalPreviews(){
    if(syncingPortals||!portalEffects.size)return;syncingPortals=true;
    try{
      const tree=index(),changed=new Set();
      for(const [id,portal]of portalEffects){
        const fiber=tree.current.get(portal.fiber);
        if(fiber&&!fiber.child&&fiber.memoizedProps?.children?.props){
          portal.fiber=fiber;const attached=portal.preview.portals.find(item=>item.id===id),child=fiber.memoizedProps.children;
          if(attached&&attached.child!==child){attached.child=child;attached.element=portalElement(portal.preview,fiber,child,id);changed.add(portal.preview);}
          continue;
        }
        portalEffects.delete(id);const record=portal.preview,next=record.portals.filter(item=>item.id!==id);
        if(next.length!==record.portals.length){record.portals=next;changed.add(record);}
      }
      for(const record of changed)if(projected.includes(record)&&!undo.some(entry=>entry.projection===record&&entry.closing))updatePortalPreview(record);
    }finally{syncingPortals=false;}
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
  function controllerFocus(fiber,value) {
    const candidates=[];
    // A source component may forward several independent controls. Follow only
    // this exact controller reference through data props, without invoking getters.
    descendants(fiber,child=>{
      if(!inside(child,fiber))return;
      const props=child.memoizedProps;if(!props||typeof props!=='object')return;
      if(Object.entries(Object.getOwnPropertyDescriptors(props)).some(([key,descriptor])=>key!=='children'&&'value'in descriptor&&descriptor.value===value))candidates.push(child);
    });
    const leaves=candidates.filter(owner=>!candidates.some(child=>child!==owner&&inside(child,owner)));
    // Sharing one control across siblings is ambiguous. Keep the source scope
    // instead of selecting a sheet by position or component name.
    return leaves.length===1?leaves[0]:fiber;
  }
  function mountedExport(action,tree) {
    mountChecks.plans++;
    if(!tree.modules){
      tree.modules=new Map();tree.registeredModules=new Map();
      for(const module of globalThis.__r?.getModules?.()?.values?.()??[]){
        if(typeof module.verboseName!=='string')continue;
        const path=modulePath(module.verboseName);tree.registeredModules.set(path,module);
        if(module.isInitialized)tree.modules.set(path,module.publicModule?.exports);
      }
    }
    const exports=sourceModule(tree.modules,action.effect.file);
    if(!exports||(typeof exports!=='object'&&typeof exports!=='function')){mountChecks.moduleMissing++;const registered=sourceModule(tree.registeredModules,action.effect.file);if(registered&&!registered.isInitialized)mountChecks.moduleCold++;else mountChecks.moduleUnknown++;return;}
    const descriptor=Object.getOwnPropertyDescriptor(exports,action.effect.export);
    const type=descriptor&&'value'in descriptor?descriptor.value:action.effect.export==='default'&&typeof exports==='function'?exports:undefined;
    if(!type||(typeof type!=='object'&&typeof type!=='function')){mountChecks.exportMissing++;return;}
    const data=key=>{const d=Object.getOwnPropertyDescriptor(type,key);return d&&'value'in d?d.value:undefined;};
    const body=data('render')??data('type')??type;
    const display=body&&Object.getOwnPropertyDescriptor(body,'displayName'),named=body&&Object.getOwnPropertyDescriptor(body,'name');
    if(typeof body!=='function'||((display&&'value'in display?display.value:undefined)??(named&&'value'in named?named.value:undefined))!==action.owner){mountChecks.ownerMismatch++;return;}
    if(tree.all.some(fiber=>fiber.type===type||fiber.elementType===type||fiber.type===body)){mountChecks.alreadyMounted++;return;}
    mountChecks.available++;return type;
  }
  function bodyRoots(focus,tree,connected) {
    if(!focus)return connected??[];
    const projection=[...projected].reverse().find(record=>record.focus===focus||record.focus===focus.alternate||record.child.props===(focus.pendingProps??focus.memoizedProps));
    if(!projection)return connected??roots(focus,tree);
    // Only the exact temporary body and its portals own preview actions.
    // The original remains connected for native ownership and restoration.
    const bodies=(tree.props.get(projection.child.props)??[]).filter(fiber=>fiber.type===projection.child.type||fiber.elementType===projection.child.type);
    return [...new Set(bodies.flatMap(body=>roots(body,tree)))];
  }
  const find = (action,tree=index(true),focus,scope=bodyRoots(focus,tree)) => {
    const inScope=fiber=>!focus||scope.some(root=>tree.inside(fiber,root));
    if(action.preview&&action.effect.kind==='mount'){
      // Bootstrap owners at a route boundary, never inside an unrelated sheet.
      if(focus||projected.length)return;
      const type=mountedExport(action,tree);if(!type)return;
      const context=tree.all.find(fiber=>fiber.tag===5&&tree.isVisible(fiber));
      const projection=context&&projectionRoot(context);
      if(projection)return {type,context,projection};
      return;
    }
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
    const owned=(fiber,owner)=>roots(owner,tree).some(root=>tree.inside(fiber,root));
    const candidates=(tree.names.get(action.owner)??[]).filter(owner=>!focus||roots(owner,tree).some(body=>scope.some(root=>tree.inside(body,root)||tree.inside(root,body))));
    const ownersFound=candidates.filter(owner=>entriesFound.some(fiber=>owned(fiber,owner))&&tree.isVisible(owner)&&!candidates.some(child=>child!==owner&&tree.inside(child,owner)&&tree.isVisible(child))).filter(owner=>entriesFound.some(fiber=>owned(fiber,owner)&&tree.isVisible(fiber)));
    if(ownersFound.length!==1)return;const owner=ownersFound[0];
    const matching=entriesFound.filter(fiber=>owned(fiber,owner)&&tree.isVisible(fiber)&&Object.entries(action.trigger??{}).every(([key,value])=>fiber.memoizedProps?.[key]===value));
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
      const candidates=action.effect.target?tree.entries.get(`${action.id}:target`)??[]:tree.names.get(action.effect.component)??[];
      const targets=candidates.filter(fiber=>name(fiber)===action.effect.component&&tree.inside(fiber,owner)).flatMap(fiber=>{
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
  function prepare(id,focus) {
    const action=catalog.actions.find(action=>action.id===id);
    if(!action)return {available:false,error:'The requested view is not in the source catalog.'};
    const effect=action.effect;
    if(action.preview&&effect.kind==='mount'&&!focus&&!projected.length){
      // Only the selected source-proven component may initialize here. Listing
      // candidates never loads cold modules, and no component/handler is called.
      const registry=globalThis.__MOBILE_DEV_FLOW_REGISTRY__;
      const prepared=sourceHash&&registry?.matchingOwners?.(sourceHash)?.length;
      const modules=globalThis.__r?.getModules?.();
      const candidates=[];
      for(const [key,module]of modules??[]){
        if(typeof module.verboseName!=='string')continue;
        const file=modulePath(module.verboseName);
        if(file===effect.file||sourceRoot&&file===`${sourceRoot}/${effect.file}`)candidates.push({key,module});
      }
      if(candidates.length===1&&!candidates[0].module.isInitialized){
        if(!prepared||typeof globalThis.__r!=='function')return {available:false,error:'Prepare the app build before loading this view.'};
        try{globalThis.__r(candidates[0].key);}catch{return {available:false,error:'The source component could not load.'};}
      }
    }
    const tree=index(true),found=find(action,tree,focus);
    if(found)return {available:true};
    if(action.preview&&effect.kind==='mount')return {available:false,error:'The source component or its live provider context is unavailable.'};
    const sites=effect.kind==='state'?tree.states.get(effect.site)??[]:[];
    if(effect.kind==='state'&&!sites.length)return {available:false,error:'The opening state could not be bound to its source.'};
    if(!action.preview&&!(tree.entries.get(id)?.length))return {available:false,error:'The opening control could not be bound to its source.'};
    if(effect.kind==='state'&&sites.length>1)return {available:false,error:'More than one live instance owns this opening state.'};
    return {available:false,error:'The source-proven entry has no live owner, control, or real context in this app state.'};
  }
  let lastAvailable=0,canonicalControls=new WeakMap();
  const list = focus => {
    mountChecks={plans:0,moduleMissing:0,moduleCold:0,moduleUnknown:0,exportMissing:0,ownerMismatch:0,alreadyMounted:0,available:0};
    const tree=index(true),scope=bodyRoots(focus,tree),seen=new Map();
    catalog.actions.forEach(action=>{
      const found=find(action,tree,focus,scope);if(!found)return false;
      const key=found.target?.value??JSON.stringify(action.effect.kind==='mount'?['mount',action.effect.file,action.effect.export]:[action.effect.site,action.effect.path,action.effect.value]);
      const opened=found.target&&undo.find(entry=>!entry.closed&&entry.control===key);
      if(opened){
        if(opened===undo[undo.length-1])opened.views=[...new Set([...(opened.views??[]),...(action.views??[])])];
        return false;
      }
      if(seen.has(key)){seen.get(key).views.push(...(action.views??[]));seen.get(key).aliases.push(action.id);return false;}
      if(found.target&&!canonicalControls.has(key))canonicalControls.set(key,action.id);
      seen.set(key,{id:action.id,canonicalId:found.target?canonicalControls.get(key):action.id,aliases:[action.id],name:action.name,file:action.file,line:action.line,views:[...(action.views??[])]});return true;
    });
    const items=[...seen.values()].map(item=>({...item,views:[...new Set(item.views)]}));
    lastAvailable=items.length;return items;
  };
  function activeViews(focus) {
    const tree=index(),visual=visualFocus(focus,tree),ids=new Set();
    const opened=undo[undo.length-1];
    if(opened?.control&&focus&&roots(opened.nativeFocus,tree).some(root=>tree.inside(visual,root)||tree.inside(root,visual)))for(const id of opened.views??[])ids.add(id);
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
  const nativeRecords=new Map(),nativeClassCallbacks=new Map();let nativeCallbackOrigins=new WeakMap();
  let commitPatch,nativeArmed=false,nativeCloseRequests=0,nativeCloseRetries=0,lastNativeProbe;
  function forgetClassCallbacks(instance,record) {
    for(const [key,handler]of record.handlers){
      if(Object.getOwnPropertyDescriptor(instance,key)?.value===handler.wrapped)Object.defineProperty(instance,key,handler.descriptor);
      for(const detach of handler.detach)detach();
    }
    record.handlers.clear();nativeClassCallbacks.delete(instance);
  }
  function watchClassCallbacks(instance,props,status) {
    let record=nativeClassCallbacks.get(instance);
    // A class can cache a bound event handler before passing it to a native
    // view. Keep this wrapper stable across props commits, so the cached native
    // callback still reports its real lifecycle event. Never read accessors.
    for(const key of ['onShow','onDismiss','onStateChange']){
      if(typeof props[key]!=='function')continue;
      const descriptor=Object.getOwnPropertyDescriptor(instance,key),prior=record?.handlers.get(key);
      if(prior&&descriptor?.value===prior.wrapped)continue;
      if(prior){for(const detach of prior.detach)detach();record.handlers.delete(key);}
      if(!descriptor||!('value'in descriptor)||!descriptor.writable||typeof descriptor.value!=='function')continue;
      if(!record){if(nativeClassCallbacks.size>=200)continue;record={status,handlers:new Map()};nativeClassCallbacks.set(instance,record);}
      const handler={descriptor,status:record.status,detach:[]};
      handler.wrapped=nativeHandler(key,descriptor.value,handler);
      try{Object.defineProperty(instance,key,{...descriptor,value:handler.wrapped});}catch{for(const detach of handler.detach)detach();continue;}
      record.handlers.set(key,handler);nativeCallbackOrigins.set(handler.wrapped,record.status);
    }
    if(record&&!record.handlers.size)forgetClassCallbacks(instance,record);
    return record?.status;
  }
  function nativeHandler(key, handler, record) {
    // A newer observer can keep this wrapper as its original handler. Detach
    // the record even when the wrapper can no longer be removed from that chain.
    record.detach.push(()=>{record=undefined;});
    return function(...args){
      const status=record?.status,event=args[0],previous=status?.dispatch;
      const duplicate=previous?.key===key&&previous.event===event;
      if(status&&!duplicate){
        // Deduplicate only a synchronous forwarding chain. Native can pool and
        // reuse an event object for a later, different lifecycle transition.
        status.dispatch={key,event};
        const state=key==='onShow'?'open':key==='onDismiss'?'closed':event?.nativeEvent?.state;
        status.events=(status.events??0)+1;if(['open','opened','presented','closed','dismissed','opening','closing'].includes(state))status.lastEvent=state;
        if(['closed','dismissed'].includes(state)){status.pending=false;status.closed=true;status.opened=false;}
        else if(['open','opened','presented'].includes(state)){status.openEvents=(status.openEvents??0)+1;status.closed=false;status.opened=true;status.pending=!!status.closing;}
        else if(['opening','closing'].includes(state)){status.pending=true;if(state==='closing')status.dismissAcknowledged=true;}
      }
      try{return handler.apply(this,args);}finally{if(status&&!duplicate)status.dispatch=previous;}
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
  const captureRoots=new Set();
  const imageRecords=new Map();
  function imageHandler(handler, record, pending) {
    record.detach.push(()=>{record=undefined;});
    return function(...args) {
      if(record)record.pending=pending;
      return handler.apply(this,args);
    };
  }
  function watchImages(mounting=false) {
    const mounted=new Set();
    for(const fiber of committedStructure().images) {
      const canonical=fiber.stateNode?.canonical,props=canonical?.currentProps;
      if(!props || typeof props.onLoad!=='function' || typeof props.onLoadStart!=='function')continue;
      mounted.add(canonical);
      const previous=imageRecords.get(canonical);
      if(previous?.patched===props){previous.fiber=fiber;continue;}
      const sources=props.source??props.sources;
      let source=sources;
      try{source=JSON.stringify(sources);}catch{ /* Native image references can be opaque. */ }
      const pending=previous ? previous.source===source?previous.pending:!!sources : mounting&&!!sources;
      if(previous)forgetNative(previous);
      const record={canonical,field:'currentProps',fiber,original:props,source,pending,detach:[]};
      const patched={...props};
      for(const key of ['onLoadStart','onLoad','onError','onDisplay'])if(typeof props[key]==='function')patched[key]=imageHandler(props[key],record,key==='onLoadStart');
      record.patched=patched;
      try{canonical.currentProps=patched;imageRecords.set(canonical,record);}catch{forgetNative(record);imageRecords.delete(canonical);}
    }
    for(const [canonical,record]of imageRecords)if(!mounted.has(canonical)){forgetNative(record);imageRecords.delete(canonical);}
  }
  function watchNative(focus, pending = false, ancestors = false, mounting = false) {
    const hosts=[],adapters=[],mounted=new Set();let openingRoots;
    for(const fiber of committedStructure().all){
      if(fiber.tag!==5&&fiber.tag!==1)continue;
      const canonical=fiber.tag===1?fiber.stateNode:fiber.stateNode?.canonical,field=fiber.tag===1?'props':'currentProps',props=canonical?.[field];
      if(!props||typeof props.onShow!=='function'&&typeof props.onDismiss!=='function'&&typeof props.onStateChange!=='function')continue;
      mounted.add(canonical);(fiber.tag===5?hosts:adapters).push({fiber,canonical,field,props});
    }
    for(const [instance,record]of nativeClassCallbacks)if(!mounted.has(instance))forgetClassCallbacks(instance,record);
    for(const [canonical,record]of nativeRecords)if(!mounted.has(canonical)&&!record.status.pending&&!record.status.opened){forgetNative(record);nativeRecords.delete(canonical);}
    // Register cached class callbacks before matching hosts which forward them.
    // Both boundaries share one status and deduplicate the same event object.
    for(const {canonical,props}of adapters){
      const status=nativeRecords.get(canonical)?.status??{pending:mounting&&props.visible!==false&&typeof props.onShow==='function',opened:props.visible===true,closed:false,closing:false};
      watchClassCallbacks(canonical,props,status);
    }
    // Idle class wrappers must not fill the bound before a newly mounted host
    // can receive native events. Keep active waiters and prefer dispatch hosts.
    for(const {fiber,canonical,field,props}of [...hosts,...adapters]){
      const previous=nativeRecords.get(canonical);
      // A hidden modal becoming visible must receive its real onShow before
      // capture. Ignoring unopened hidden hosts must not skip this transition.
      if(previous?.visible===false&&props.visible===true&&!previous.status.opened&&typeof props.onShow==='function'){previous.status.pending=true;previous.status.closed=false;}
      if(previous?.patched===props){previous.fiber=fiber;previous.visible=props.visible;continue;}
      if(nativeRecords.size>=200&&!previous){
        const idle=fiber.tag===5&&[...nativeRecords.values()].find(record=>record.fiber?.tag===1&&!record.status.pending&&!record.status.opened);
        if(!idle)continue;const key=idle.canonical;forgetNative(idle);nativeRecords.delete(key);
      }
      const forwarded=['onShow','onDismiss','onStateChange'].map(key=>nativeCallbackOrigins.get(props[key])).filter(Boolean);
      const shared=forwarded.length&&forwarded.every(status=>status===forwarded[0])?forwarded[0]:undefined;
      const status=nativeClassCallbacks.get(canonical)?.status??shared??previous?.status??{pending:mounting&&props.visible!==false&&typeof props.onShow==='function',opened:props.visible===true,closed:false,closing:false};
      // A newly mounted dispatch host can share an idle cached class handler.
      // Arm only hosts connected to a control we are opening, then wait for
      // their real event. Unopened sibling adapters stay idle.
      if(!previous&&fiber.tag===5&&mounting&&props.visible!==false&&!status.opened&&!status.pending){
        openingRoots??=[...undo.filter(entry=>entry.control&&!entry.closing).flatMap(entry=>roots(entry.nativeFocus)),...[...captureRoots].flatMap(focus=>roots(focus))];
        if(typeof props.onShow==='function'||typeof props.onStateChange==='function'&&openingRoots.some(root=>inside(fiber,root))){
          status.pending=true;status.closed=false;status.closing=false;status.dismissAcknowledged=false;
        }
      }
      if(previous)forgetNative(previous);
      const record={canonical,field,fiber,original:props,visible:props.visible,status,detach:[]};
      const patched={...props};
      for(const key of ['onShow','onDismiss','onStateChange'])if(typeof props[key]==='function'){
        patched[key]=nativeHandler(key,props[key],record);
      }
      record.patched=patched;try{canonical[field]=patched;}catch{forgetNative(record);nativeRecords.delete(canonical);continue;}
      nativeRecords.set(canonical,record);
    }
    const targets=nativeTargets(focus,ancestors);
    if(pending)for(const record of targets){
      if(record.original?.visible===false&&!record.status.opened&&!record.status.pending)continue;
      // An idle class adapter is not evidence that native presentation began.
      // Actual dispatch hosts and lifecycle events still arm the opening wait.
      if(record.fiber.tag===1&&!record.status.opened&&!record.status.pending&&typeof record.original?.onShow!=='function')continue;
      record.status.pending=true;record.status.closed=false;record.status.closing=false;record.status.dismissAcknowledged=false;
    }
    return targets;
  }
  function nativeTargets(focus,ancestors=false) {
    if(!focus)return [];
    const scope=roots(focus),records=[...nativeRecords.values()];
    // A wrapper and its native host forward the same lifecycle event. Observe
    // the outer boundary, without arming idle child sheets that never opened.
    if(ancestors){
      const parents=records.filter(record=>scope.some(root=>inside(root,record.fiber)));
      if(parents.length){
        const hosts=parents.filter(record=>record.fiber.tag===5),boundaries=hosts.length?hosts:parents;
        return boundaries.filter(record=>!boundaries.some(other=>other!==record&&inside(other.fiber,record.fiber)));
      }
    }
    const children=records.filter(record=>scope.some(root=>inside(record.fiber,root)));
    // Class adapters often spread a cached handler into a native host. Their
    // patched props need not receive that host's event. Prefer the actual
    // Fabric dispatch target, retaining the class fallback for opaque portals.
    const hosts=children.filter(record=>record.fiber.tag===5),boundaries=hosts.length?hosts:children;
    return boundaries.filter(record=>!boundaries.some(other=>other!==record&&inside(record.fiber,other.fiber)));
  }
  function beginDismissal(entry,focus,ancestors=false) {
    entry.native=watchNative(focus,false,ancestors).filter(record=>record.status.opened||record.status.pending).map(record=>record.status);
    for(const status of entry.native){status.closing=true;status.pending=true;status.closed=false;status.dismissAcknowledged=false;}
  }
  function requestControlClose(entry) {
    entry.closeOpenEvents=new Map((entry.native??[]).map(status=>[status,status.openEvents??0]));
    nativeCloseRequests++;entry.control[entry.close]();entry.closing=true;
  }
  async function waitForDismissal(entry) {
    const started=Date.now();
    while(entry.native?.some(status=>!status.closed)){
      const tree=index(),waiting=entry.native.filter(status=>!status.closed);
      if(!waiting.some(status=>[...nativeRecords.values()].some(record=>record.status===status&&tree.current.has(record.fiber))))return;
      // A close can run before a native ref exists and silently do nothing.
      // Retry once only after a later real open event, and only if native has
      // not acknowledged any closing transition. An accepted close stays single.
      if(entry.control&&!entry.closeRetried&&!waiting.some(status=>status.dismissAcknowledged)&&waiting.some(status=>status.opened&&(status.openEvents??0)>(entry.closeOpenEvents?.get(status)??0))){
        entry.closeRetried=true;nativeCloseRetries++;requestControlClose(entry);
      }
      if(Date.now()-started>=2000)throw new Error('Native presentation dismissal has not finished.');
      await new Promise(resolve=>later(resolve,40,resolve));
    }
  }
  let captureDismissals=new WeakMap();
  async function captureClose(focus,control,close) {
    let entry=captureDismissals.get(control);
    if(!entry){
      entry={control,close};
      beginDismissal(entry,focus);
      captureDismissals.set(control,entry);
      requestControlClose(entry);
    }
    const observed=entry.native.length>0;
    await waitForDismissal(entry);
    captureDismissals.delete(control);
    return {handled:true,observed,closed:true};
  }
  function observeCommits() {
    if(commitPatch&&hook?.onCommitFiberRoot===commitPatch.wrapped)return true;
    // A later observer may replace the hook without forwarding ours. Detach
    // the old callback and observe the current chain before reusing metadata.
    if(commitPatch){commitPatch.state.callback=undefined;commitPatch=undefined;structureCache=undefined;}
    if(typeof hook?.onCommitFiberRoot!=='function')return false;
    const patch=commitHandler(hook.onCommitFiberRoot,()=>{structureCache=undefined;if(nativeArmed){watchImages(true);watchNative(undefined,false,false,true);syncPortalPreviews();}});
    try{hook.onCommitFiberRoot=patch.wrapped;}catch{patch.state.callback=undefined;return false;}
    if(hook.onCommitFiberRoot!==patch.wrapped){patch.state.callback=undefined;return false;}
    commitPatch=patch;return true;
  }
  function armNative(focus) {
    if(!nativeArmed)structureCache=undefined;
    nativeArmed=true;observeCommits();watchImages();watchNative(focus,true);
  }
  function captureNative(focus, remove=false) {
    if(remove){
      if(focus){for(const root of captureRoots)if(root===focus||root===focus.alternate)captureRoots.delete(root);}
      else captureRoots.clear();
      return;
    }
    if(focus)captureRoots.add(focus);
    armNative(focus);
  }
  function motion(focus,viewport,tree=index(),scope=roots(focus,tree),geometry) {
    for(const [canonical,record]of nativeRecords)if(!tree.current.has(record.fiber)&&!tree.current.has(record.fiber?.alternate)){forgetNative(record);nativeRecords.delete(canonical);}
    const related=[...nativeRecords.values()].filter(r=>scope.some(root=>inside(r.fiber,root)||inside(root,r.fiber)));
    const hosts=related.filter(r=>r.fiber.tag===5),boundaries=hosts.length?hosts:related;
    const pendingTargets=new Set(boundaries.filter(r=>r.status.pending));let pending=pendingTargets.size>0;const boxes=[];
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
      if(record?.status.pending&&(!hosts.length||fiber.tag===5)){pending=true;pendingTargets.add(record);}
      // Remaining hosts still contribute transition events, but their bounds
      // cannot change this capped signature. Avoid extra Fabric layout reads.
      if(boxes.length>=24)continue;
      try{const native=canonical?.publicInstance;const box=typeof native?.getBoundingClientRect==='function'?(geometry?.has(fiber)?geometry.get(fiber):native.getBoundingClientRect()):undefined;if(box&&boxes.length<24){let {x,y,width,height}=box;if(viewport){const right=Math.min(x+width,viewport.x+viewport.width),bottom=Math.min(y+height,viewport.y+viewport.height);x=Math.max(x,viewport.x);y=Math.max(y,viewport.y);width=right-x;height=bottom-y;if(width<=0||height<=0)continue;}boxes.push([x,y,width,height].map(v=>Math.round(v)));}}catch{}
    }
    const unshown=projected.filter(record=>!record.shown&&(focus===record.focus||roots(record.focus).includes(focus))).length;
    if(unshown)pending=true;
    let error=projected.some(record=>record.failed&&(focus===record.focus||roots(record.focus).includes(focus)))?'The temporary presentation preview failed.':undefined;
    // Local diagnostics only. Keep bounded primitive evidence, never fibers,
    // callback arguments or app content. Telemetry still uses aggregate timings.
    for(const record of projected){
      if(!record.inline||!projectionAttached(record,tree)||projected.some(child=>child.parent===record))continue;
      const layout=syncInlineBody(record,tree);pending||=!!layout.pending;if(layout.error)error=layout.error;
    }
    const describe=record=>({component:name(record.fiber),kind:record.fiber?.tag===5?'host':'adapter',pending:!!record.status.pending,opened:!!record.status.opened,closing:!!record.status.closing,events:record.status.events??0,lastEvent:record.status.lastEvent,visible:typeof record.original?.visible==='boolean'?record.original.visible:undefined});
    lastNativeProbe={pendingTargets:[...pendingTargets].slice(0,8).map(describe),targets:[...hosts,...related.filter(record=>record.fiber?.tag!==5)].slice(0,8).map(describe),scope:scope.slice(0,8).map(name),observedEvents:[...new Set(boundaries.map(record=>record.status))].reduce((total,status)=>total+(status.events??0),0),unshownPreviews:unshown};
    return {pending,signature:JSON.stringify(boxes),error};
  }
  function clearNative(){captureDismissals=new WeakMap();for(const record of imageRecords.values())forgetNative(record);imageRecords.clear();lastNativeProbe=undefined;structureCache=undefined;nativeArmed=false;if(commitPatch)commitPatch.state.callback=undefined;if(commitPatch&&hook.onCommitFiberRoot===commitPatch.wrapped)hook.onCommitFiberRoot=commitPatch.original;commitPatch=undefined;for(const record of nativeRecords.values())forgetNative(record);nativeRecords.clear();for(const [instance,record]of nativeClassCallbacks)forgetClassCallbacks(instance,record);nativeCallbackOrigins=new WeakMap();}
  let pendingHandoff;
  async function handoff(id,focus,cancelled=()=>false) {
    pendingHandoff=undefined;
    const action=catalog.actions.find(action=>action.id===id);
    if(!action?.handoffs?.length)return {closed:false};
    const tree=index(true),found=find(action,tree,focus);
    if(!found?.target)return {error:'The handoff target is no longer available.'};
    let owner=found.target.fiber;
    while(owner&&name(owner)!==action.effect.target?.owner)owner=owner.return;
    if(!owner)return {error:'The handoff source owner is unavailable.'};
    const scope=roots(owner,tree),parents=new Set();let entriesFound=false;
    for(const [proofIndex,proof]of action.handoffs.entries())for(const entry of tree.entries.get(`${id}:handoff:${proofIndex}`)??[]){
      if(name(entry)!==proof.component||!scope.some(root=>tree.inside(entry,root))||!tree.isVisible(entry))continue;
      entriesFound=true;
      for(let context=entry.dependencies?.firstContext,count=0;context&&count++<40;context=context.next){
        let value=context.memoizedValue;
        for(const key of proof.contextPath){const descriptor=value&&(typeof value==='object'||typeof value==='function')?Object.getOwnPropertyDescriptor(value,key):undefined;value=descriptor&&'value'in descriptor?descriptor.value:undefined;}
        const parent=[...undo].reverse().find(frame=>!frame.closed&&!frame.closing&&frame.control===value&&frame.close===proof.close);
        if(parent&&parent.control!==found.target.value&&roots(parent.nativeFocus,tree).some(root=>tree.inside(entry,root)))parents.add(parent);
      }
    }
    if(!entriesFound)return {error:'The source-proven handoff entry is not mounted in this app state.'};
    if(parents.size!==1)return {error:'The source-proven parent sheet is missing or ambiguous.'};
    if(cancelled())return {error:'Presentation handoff was cancelled.'};
    const parent=[...parents][0];let acknowledged=false;
    beginDismissal(parent,parent.nativeFocus);parent.closing=true;nativeCloseRequests++;
    // Source proves this exact control accepts a dismissal callback. Never run
    // the incoming UI handler: it can contain account or other business work.
    try{parent.control[parent.close](()=>{acknowledged=true;});}
    catch(error){parent.closing=false;throw error;}
    const started=Date.now();
    while(!acknowledged||parent.native.some(status=>!status.closed)){
      if(cancelled())return {error:'Presentation handoff was cancelled.'};
      if(Date.now()-started>=4000)return {error:'The parent sheet did not finish its source-proven dismissal.'};
      await new Promise(resolve=>later(resolve,40,resolve));
    }
    parent.closed=true;parent.closing=false;
    if(cancelled())return {error:'Presentation handoff was cancelled.'};
    const current=index().current;
    if(!current.has(found.target.fiber)||!current.has(owner))return {error:'The handoff target unmounted when its parent closed.'};
    // The entry disappears with its parent menu. Carry only this proved target
    // into the next open, then revalidate its mounted fiber and control identity.
    pendingHandoff={id,owner:current.get(owner),target:{...found.target,fiber:current.get(found.target.fiber)}};
    return {closed:true,focus:current.get(owner)};
  }
  function open(id,focus) {
    if(undo.some(entry=>entry.closing))return {error:'A native presentation is still dismissing.'};
    armNative();
    const prepared=pendingHandoff;pendingHandoff=undefined;
    const action=catalog.actions.find(a=>a.id===id),tree=index(true);
    const target=prepared?.id===id&&tree.current.get(prepared.target.fiber),owner=prepared?.id===id&&tree.current.get(prepared.owner);
    const saved=action?.effect.kind==='control'&&target&&owner&&controlValue(target,action.effect.prop)===prepared.target.value?{owner,target:{...prepared.target,fiber:target}}:undefined;
    const found=action&&(saved??find(action,tree,focus));if(!found)return {error:'This presentation entry is not currently available.'};
    if(action.effect.kind==='mount'){
      const owner={type:found.type,elementType:found.type,memoizedProps:{},return:found.context};
      const result=project(owner,{views:action.views,mount:true},found.projection);
      return result.error?result:{...result,expected:action.owner};
    }
    if(action.effect.kind==='state'){
      if(action.preview)return {...previewState(action,found),expected:action.expected?{component:action.expected.component,scope:action.expected.scope,entry:`${action.id}:expected`}:action.name};
      const b=found.binding;let previous=hookValue(b);for(const part of action.effect.path)previous=previous?.[part];
      undo.push({binding:b,path:action.effect.path,value:previous,nativeDismiss:previous==null||previous===false});
      // Guard discovery only supplies finite presentation values. No session,
      // account, query cache or credential store is modified here.
      b.setter(previous=>setPath(previous,action.effect.path,action.effect.value));
      return {name:action.name,scope:catalog.states.find(s=>s.id===action.effect.site)?.owner===action.owner?b.fiber:undefined};
    }
    if(action.effect.kind==='control'){
      const {value,close}=found.target,fiber=controllerFocus(found.target.fiber,value);
      const opened=undo.find(entry=>!entry.closed&&entry.control===value);
      if(opened){if(opened===undo[undo.length-1])opened.views=[...new Set([...(opened.views??[]),...(action.views??[])])];return {name:action.name,focus:fiber,alreadyOpen:true};}
      armNative(fiber);undo.push({control:value,close,focus:fiber,nativeFocus:fiber,views:action.views?.slice()});value[found.target.method??action.effect.method]();
      return {name:action.name,focus:fiber};
    }
    return {error:'Unsupported presentation transition.'};
  }
  let rollbackTask=Promise.resolve();
  function rollback(level=0,wait=true) {
    pendingHandoff=undefined;
    const task=rollbackTask.catch(()=>{}).then(()=>restorePresentations(level,wait));
    rollbackTask=task;return task;
  }
  function projectionAttached(record,tree=index()){
    const root=tree.current.get(record.root),children=root?.memoizedProps?.children?.props?.children;
    return Array.isArray(children)&&children.some(child=>projectionElement(child,record));
  }
  function releaseProjection(record){
    restoreInlineBody(record);
    clearTimeout(record.seedTimer);releaseUiEffects(record);
    for(const [id,portal]of portalEffects)if(portal.preview===record)portalEffects.delete(id);
    record.portals.length=0;const position=projected.indexOf(record);if(position>=0)projected.splice(position,1);
    releasePreviewErrors();if(record.seed&&!projected.some(p=>p.seed&&!p.seed.applied&&!p.failed))unpatch();if(!projected.length)unpatchPreviewEffects();
  }
  async function restorePresentations(level,wait) {
    restoring:while(undo.length>Math.max(0,level)){
      // Keep the checkpoint until its close operation succeeds. A thrown close
      // must not discard the only way to restore the app on the next attempt.
      const entry=undo[undo.length-1];
      if(entry.closed){undo.pop();continue;}
      if(entry.projection){
        const record=entry.projection;clearTimeout(record.seedTimer);releaseUiEffects(record);
        // An app commit may remove the entire preview before its native callback.
        // The old Modal listener is gone. Keep the app's new children intact.
        if(!projectionAttached(record)){releaseProjection(record);undo.pop();continue;}
        if(record.parent){
          const root=index().current.get(record.root),props=root?.memoizedProps,children=props?.children?.props?.children;
          if(Array.isArray(children)){
            const parent=record.parent,modal=parent.element;
            // Replacing the modal body remounts only the temporary form. Seed
            // its saved finite state again before React renders the prior step.
            if(parent.seed){parent.seed.applied=false;if(!patchHooks())throw new Error('Temporary hook restoration is unavailable.');seedDeadline(parent);}
            structureCache=undefined;record.renderer.overrideProps(root,[],{...props,children:record.react.cloneElement(props.children,{},...children.map(child=>projectionElement(child,record)?modal:child))});
          }
          releaseProjection(record);undo.pop();continue;
        }
        if(record.inline){
          const root=index().current.get(record.root);
          if(root)removeProjection(record,root);
          releaseProjection(record);undo.pop();continue;
        }
        if(!entry.closing){
          const props=record.root.memoizedProps??record.props;
          structureCache=undefined;
          if(wait&&record.ios&&record.shown){
            // Keep Modal mounted while native dismissal runs. Unmounting first
            // removes React Native's event listener before onDismiss can run.
            const modal=record.react.cloneElement(record.element,{visible:false});
            const children=record.react.cloneElement(record.next.children,{},...record.next.children.props.children.map(child=>child===record.element?modal:child));
            record.renderer.overrideProps(record.root,[],{...props,children});
          }else record.renderer.overrideProps(record.root,[],{...props,children:record.props.children});
          entry.closing=true;
        }
        // React Native emits Modal.onDismiss on iOS only. Retain the restore
        // record when an already shown iOS modal is still dismissing.
        if(wait&&record.ios&&record.shown){
          const started=Date.now();while(!record.dismissed){
            if(!projectionAttached(record)){releaseProjection(record);undo.pop();continue restoring;}
            if(Date.now()-started>=2000)throw new Error('Temporary modal dismissal has not finished.');
            await new Promise(resolve=>later(resolve,40,resolve));
          }
        }
        if(wait&&record.ios&&record.shown){
          const props=record.root.memoizedProps??record.props;structureCache=undefined;
          record.renderer.overrideProps(record.root,[],{...props,children:record.props.children});
        }
        releaseProjection(record);
      }else if(entry.control){
        // Cancel the approved opening timer before requesting dismissal. A late
        // opening must not race the restoration of its temporary form.
        if(entry.uiEffect?.cleanup){const cleanup=entry.uiEffect.cleanup;entry.uiEffect.cleanup=undefined;cleanup();}
        const tree=index(),connected=roots(entry.nativeFocus,tree);
        if(!connected.some(fiber=>tree.current.has(fiber))){undo.pop();continue;}
        if(!entry.closing){
          beginDismissal(entry,entry.nativeFocus);requestControlClose(entry);
        }
        if(wait)await waitForDismissal(entry);
      }else{
        if(!entry.closing){
          if(entry.nativeDismiss)beginDismissal(entry,entry.focus,true);
          entry.binding.setter(previous=>setPath(previous,entry.path,entry.value));entry.closing=true;
        }
        if(wait&&entry.nativeDismiss)await waitForDismissal(entry);
      }
      undo.pop();
    }
    if(wait&&level===0)clearNative();
    if(wait)await new Promise(resolve=>later(resolve,80,resolve));
  }
  function cleanup(){pendingHandoff=undefined;canonicalControls=new WeakMap();captureRoots.clear();releaseUiEffects();uiEffectOwners=new WeakMap();openedUiEffects=0;sourceRoot=sourceHash=undefined;lastCompiledBindings=0;mountChecks={plans:0,moduleMissing:0,moduleCold:0,moduleUnknown:0,exportMissing:0,ownerMismatch:0,alreadyMounted:0,available:0};nativeCloseRequests=0;nativeCloseRetries=0;previewRefs=new WeakSet();containedImperativeHandles=containedSubscriptions=preservedRootFragments=0;portalEffects.clear();portalOwners=new WeakMap();approvedPortals=new WeakSet();for(const record of projected){restoreInlineBody(record);clearTimeout(record.seedTimer);}projected.length=0;releasePreviewErrors(true);clearNative();unpatch();unpatchPreviewEffects();unpatchQueryResults();collecting.clear();bindings.clear();for(const record of entries.values()){record.fibers.clear();record.fiber=undefined;}entries.clear();entryKeys.clear();collected=[];entrySources=new WeakMap();undo.length=0;catalog={states:[],actions:[]};owners=new WeakMap();}
  function focusedComponent(name_,scope,tree,connected=scope?roots(scope,tree):[],entryId) {
    connected=bodyRoots(scope,tree,connected);
    const candidates=(tree.names.get(name_)??[]).filter(fiber=>(!scope||connected.some(root=>tree.inside(fiber,root)))&&(!entryId||entry(fiber,false)?.actions.has(entryId))&&tree.isVisible(fiber));
    const unique=candidates.filter(owner=>!candidates.some(child=>child!==owner&&tree.inside(child,owner)));
    return unique.length===1?unique[0]:undefined;
  }
  function probeFocus(focus,expected) {
    const tree=index();let currentFocus=focus&&tree.current.get(focus);
    if(focus&&!currentFocus){
      const record=[...projected].reverse().find(record=>record.focus===focus||record.focus===focus.alternate||record.child.props===(focus.pendingProps??focus.memoizedProps));
      const bodies=record?(tree.props.get(record.child.props)??[]).filter(fiber=>fiber.type===record.child.type||fiber.elementType===record.child.type):[];
      if(bodies.length===1)currentFocus=bodies[0];
    }
    const connected=roots(currentFocus,tree);
    const expectedFocus=expected&&focusedComponent(typeof expected==='object'?expected.component:expected,currentFocus,tree,connected,typeof expected==='object'?expected.entry:undefined);
    // A local UI state can belong to a provider above the entire application.
    // Read the proven destination body and its native ancestors, so background
    // feeds and unrelated animations neither delay nor impersonate this view.
    // A branch can contain several fields or only alter part of a form. Its
    // exact JSX entry proves the branch exists; readiness still needs the
    // whole temporary form so a label cannot hide a loading sibling.
    const ownerScope=expected?.scope==='owner'&&expectedFocus;
    const body=ownerScope?currentFocus:expectedFocus||currentFocus;
    const visualScope=ownerScope?bodyRoots(currentFocus,tree,connected):expectedFocus?roots(expectedFocus,tree):connected;
    return {focus:currentFocus,visualFocus:visualScope.at(-1)??body,expectedReady:(!focus||!!currentFocus)&&(!expected||!!expectedFocus),motion:(viewport,geometry)=>motion(body,viewport,tree,visualScope,geometry)};
  }
  function nativeWaiters() {
    const result=[];
    for(const entry of undo)for(const status of entry.native??[]){
      if(status.closed||result.some(item=>item.status===status))continue;
      const records=[...nativeRecords.values()].filter(record=>record.status===status);
      const record=records.find(record=>record.fiber?.tag===5)??records[0];
      result.push({status,value:{component:record?name(record.fiber):undefined,kind:record?.fiber?.tag===5?'host':'adapter',opened:!!status.opened,openEvents:status.openEvents??0,closingAcknowledged:!!status.dismissAcknowledged}});
      if(result.length===8)return result.map(item=>item.value);
    }
    return result.map(item=>item.value);
  }
  const diagnostics=()=>({inlineProjections:projected.filter(record=>record.inline).length,nativeProbe:lastNativeProbe,nativeWaiters:nativeWaiters(),lastExactScheduled,lastFallbackScheduled,lastCompiledBindings,containedImperativeHandles,containedSubscriptions,preservedRootFragments,reusedQueryResults,reusedQuerySelections,queryPreviewReads,queryPreviewRejections,mountChecks:{...mountChecks},imageObservers:imageRecords.size,pendingImages:[...imageRecords.values()].filter(record=>record.pending).length,queryObservers:queryPatches.length,queryCache:queryCacheDiagnostics,querySnapshots:querySnapshots.size,bindings:bindings.size,matchedBindings:[...bindings.values()].filter(b=>b.site).length,entries:entries.size,entryInstances:[...entries.values()].reduce((total,record)=>total+record.fibers.size,0),lastScheduled,matchedEntries:[...entries.values()].filter(e=>e.actions.size).length,actions:catalog.actions.length,lastAvailable,nativeClassCallbacks:[...nativeClassCallbacks.values()].reduce((total,record)=>total+record.handlers.size,0),nativeCloseRequests,nativeCloseRetries,nativeClosingAcknowledged:[...nativeRecords.values()].filter(r=>r.status.dismissAcknowledged).length,nativeRecords:nativeRecords.size,nativeHosts:[...nativeRecords.values()].filter(r=>r.fiber?.tag===5).length,nativePending:[...nativeRecords.values()].filter(r=>r.status.pending).length,nativeHostPending:[...nativeRecords.values()].filter(r=>r.fiber?.tag===5&&r.status.pending).length,dismissalWaiters:undo.reduce((total,entry)=>total+(entry.native?.filter(status=>!status.closed).length??0),0),checkpoints:undo.length,projections:projected.length,detachedProjections:projected.filter(record=>!projectionAttached(record)).length,closingProjections:undo.filter(entry=>entry.projection&&entry.closing).length,shownProjections:projected.filter(record=>record.shown).length,dismissedProjections:projected.filter(record=>record.dismissed).length,uiEffectBindings:uiEffects.size,openedUiEffects,portalBindings:portalEffects.size,portalPreviews:projected.reduce((total,record)=>total+record.portals.length,0)});
  return {structure:committedStructure,imagePending:fiber=>!!imageRecords.get(fiber.stateNode?.canonical)?.pending,captureClose,captureNative,collect,records,configure,list,prepare,open,handoff,portalBindings,previewPortals,uiEffectBindings,previewEffects,activeViews,rollback,cleanup,motion:(focus,viewport,geometry)=>motion(focus,viewport,undefined,undefined,geometry), visualFocus, project, diagnostics, probeFocus, focusFor:(name_,scope)=>focusedComponent(name_,scope,index()), focused:focus=>{if(undo.length){const entry=undo[undo.length-1];entry.focus=focus;if(entry.projection?.mount)entry.projection.focus=focus;}}, checkpoint:()=>undo.length};
}
