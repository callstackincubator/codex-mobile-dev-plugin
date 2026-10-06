import * as React from 'react';
import {View} from 'react-native';
import {createFlowRegistry} from './instrumentation-registry.js';

const key = '__MOBILE_DEV_FLOW_REGISTRY__';
export const registry = globalThis[key] ??= createFlowRegistry();
const Preview = React.createContext(null);
const reducerSetters=new WeakMap();
const seedAction=Symbol('flow-preview-state');

// Added by the Babel transform at a fixed position in each component/custom
// hook. No dispatcher replacement, conditional hooks, or Fiber hook mutation.
export function useFlowOwner(source, sourceHash, type, props, host) {
  const preview = React.useContext(Preview);
  const ref = React.useRef(null);
  if (!ref.current) ref.current = registry.create(source, sourceHash);
  const owner = ref.current;
  const entries = new Map(),metadata={type,props,host,preview};
  const frame={...owner,...metadata,pending:entries};
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
  return React.createElement(React.Profiler, {id: `${owner.id}:${id}`, onRender: () => {}}, children);
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
class PreviewError extends React.Component {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){registry.previewFailed();}
  render(){return this.state.failed ? null : this.props.children;}
}
function CaptureHost({owner,children}) {
  const projection=React.useSyncExternalStore(registry.subscribe,()=>registry.projection,()=>undefined);
  const active=projection?.host===owner.id;
  return React.createElement(View,{style:{flex:1}},
    React.createElement(View,{style:{flex:1,opacity:active?0:1},pointerEvents:active?'none':'auto',accessibilityElementsHidden:active,importantForAccessibility:active?'no-hide-descendants':'auto'},children),
    active ? React.createElement(View,{style:{position:'absolute',top:0,left:0,right:0,bottom:0}},
      React.createElement(React.Profiler,{id:'flow-preview',onRender:()=>{}},
        React.createElement(Preview.Provider,{value:projection},
          React.createElement(PreviewError,{key:projection.source},React.createElement(projection.type,projection.props))))) : null);
}
