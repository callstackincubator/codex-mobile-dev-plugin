import * as React from 'react';
import {View} from 'react-native';
import {createFlowRegistry} from './instrumentation-registry.js';
import {capturePreviewContext} from './instrumentation-context.js';
import {installPreparedRuntime} from './prepared-runtime.js';
import {selectPreviewState} from './state-selections.js';

if (typeof __MOBILE_DEV_FLOW_FINGERPRINT__ === 'string') {
  globalThis.__MOBILE_DEV_FLOW_COMPILED__ = {fingerprint: __MOBILE_DEV_FLOW_FINGERPRINT__, install: installPreparedRuntime};
}

const key = '__MOBILE_DEV_FLOW_REGISTRY__';
export const registry = globalThis[key] ??= createFlowRegistry((owner, projection, failed) => capturePreviewContext(owner.id, PreviewError, projection, failed));
const Preview = React.createContext(null);
// The shared executor can place this boundary inside an existing native sheet.
registry.wrapPreview = (content, preview) => React.createElement(Preview.Provider, {value:preview}, content);
registry.selectState = selectPreviewState;
const reducerSetters=new WeakMap();
const seedAction=Symbol('flow-preview-state');

// Added by the Babel transform at a fixed position in each component/custom
// hook. No dispatcher replacement, conditional hooks, or Fiber hook mutation.
export function useFlowOwner(source, sourceHash, type, props, host) {
  const preview = React.useContext(Preview);
  const ref = React.useRef(null);
  if (!ref.current) ref.current = registry.create(source, sourceHash);
  const owner = ref.current;
  const subscribeSlots=React.useCallback(listener=>registry.subscribeSlots(owner.id,listener),[owner]);
  const readSlots=React.useCallback(()=>registry.hostSnapshot(owner.id),[owner]);
  const hostState=React.useSyncExternalStore(subscribeSlots,readSlots,readSlots);
  const entries = new Map(),metadata={type,props,host,preview};
  const frame={...owner,...metadata,slots:hostState.slots,masks:hostState.masks,pending:entries};
  React.useLayoutEffect(() => { Object.assign(owner,metadata);registry.commit(owner, entries); });
  React.useLayoutEffect(() => () => registry.remove(owner), [owner]);
  return frame;
}

export function state(owner, id, tuple, hook) { registry.stage(owner, id, {kind: 'state', tuple, hook, previewSetter:reducerSetters.get(tuple[1])}); return tuple; }
export function control(owner, id, value) { registry.stage(owner, id, {kind: 'control', control: value}); return value; }
export function boundary(owner, children) {
  const body=React.createElement(React.Profiler, {id: owner.id, onRender: () => {}}, children);
  return owner.host && !owner.preview ? React.createElement(CaptureHost,{owner},body) : body;
}
export function entry(owner, id, children) {
  if(!owner.pending.has(id))registry.stage(owner,id,{kind:'entry'});
  return React.createElement(React.Profiler, {id: `${owner.id}:${id}`, key:children?.key??undefined, onRender: () => {}}, children);
}
// A prepared View retains its extra children through ordinary app renders.
// No extra native container, root replacement, or per-View hook is introduced.
export function hostView(owner, id, element) {
  const additions=owner.slots?.get(id);
  const mask=owner.masks?.get(id);
  let rendered=mask?React.cloneElement(element,{style:[element.props.style,mask.style],pointerEvents:'none',accessibilityElementsHidden:true,importantForAccessibility:'no-hide-descendants'}):element;
  if(additions?.size){
    const original=element.props.children;
    const transparent=original?.type===React.Fragment&&original.key==null&&original.props?.ref===undefined;
    const children=transparent?original.props.children:original;
    rendered=React.cloneElement(rendered,{children:React.createElement(React.Fragment,null,...(Array.isArray(children)?children:[children]),...additions.values())});
  }
  const previous=owner.pending.get(id);
  registry.stage(owner,id,{kind:'host',type:element.type,props:rendered.props,ambiguous:!!previous});
  return rendered;
}
export function useFlowInitial(id, initial) {
  const preview=React.useContext(Preview);
  return preview?.seeds.has(id) ? preview.seeds.get(id) : initial;
}
export function useFlowReducer(id,reducer,initial,initialize) {
  const preview=React.useContext(Preview);
  const tuple=React.useReducer((state,action)=>preview && action?.type===seedAction?action.value:reducer(state,action),initial,
    preview?.seeds.has(id)?()=>preview.seeds.get(id):initialize);
  if(preview)reducerSetters.set(tuple[1],value=>tuple[1]({type:seedAction,value}));
  return tuple;
}
export function useFlowEffect(kind, effect, dependencies, animation) {
  const preview=React.useContext(Preview);
  // Preview only the render body. App effects may persist account/session data;
  // framework query hooks retain their ordinary real cache and read requests.
  React[kind](preview && !animation ? () => {} : effect, dependencies);
}
// Keep system keyboard/autofill UI from covering a copied form. The live
// input, handlers, value and ref retain the app's own behavior.
export function input(element) {
  return React.createElement(PreviewInput,{key:element.key,element});
}
function PreviewInput({element}) {
  const preview=React.useContext(Preview);
  return preview ? React.cloneElement(element,{autoFocus:false}) : element;
}
const noSubscription=()=>()=>{};
export function useFlowExternalStore(subscribe,getSnapshot,getServerSnapshot) {
  const preview=React.useContext(Preview);
  // App subscriptions stay contained. Framework query observers can subscribe
  // normally and load real read data while a temporary view is mounted.
  return React.useSyncExternalStore(preview?noSubscription:subscribe,getSnapshot,getServerSnapshot);
}
class PreviewError extends React.Component {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){registry.previewFailed();}
  render(){return this.state.failed ? null : this.props.children;}
}
function CaptureHost({owner,children}) {
  const projection=React.useSyncExternalStore(registry.subscribe,()=>registry.projection,()=>undefined);
  const active=projection?.host===owner.id;
  let content=active ? React.createElement(projection.type,projection.props) : null;
  if(active) for(const provider of projection.providers ?? []) content=React.createElement(provider.type,{value:provider.value},content);
  return React.createElement(View,{style:{flex:1}},
    React.createElement(View,{style:{flex:1,opacity:active?0:1},pointerEvents:active?'none':'auto',accessibilityElementsHidden:active,importantForAccessibility:active?'no-hide-descendants':'auto'},children),
    active ? React.createElement(View,{style:{position:'absolute',top:0,left:0,right:0,bottom:0}},
      React.createElement(React.Profiler,{id:'flow-preview',onRender:()=>{}},
        React.createElement(Preview.Provider,{value:projection},
          React.createElement(PreviewError,{key:projection.source,projection},content)))) : null);
}
