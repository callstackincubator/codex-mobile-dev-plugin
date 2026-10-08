import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {installPresentationRuntime} from '../src/server/app-flow/presentations-runtime.js';
import {sharedLoopRuntime} from './app-flow-runtime-fixtures.ts';

function sheetFixture(t:test.TestContext,install=installPresentationRuntime) {
  const previous=(globalThis as any).__r;
  function View(){}function Modal(){}function Form(){}function Step(){}
  const original=React.createElement(Form,{label:'Original'}),header=React.createElement('handle');
  const children=React.createElement(React.Fragment,null,header,original);
  const lifecycle={onStateChange(){}};
  const canonical={currentProps:lifecycle};
  const sheet:any={tag:5,type:'NativePresentation',memoizedProps:lifecycle,stateNode:{canonical}};
  const container:any={type:View,memoizedProps:{children,style:{padding:12}},return:sheet};sheet.child=container;
  const form:any={type:Form,memoizedProps:original.props,return:container};container.child=form;
  const originalStyle=[{padding:8}],originalHost:any={tag:5,type:'NativeBody',memoizedProps:{style:originalStyle},return:form};form.child=originalHost;
  originalHost.stateNode={getBoundingClientRect:()=>({width:originalHost.memoizedProps.style?.at?.(-1)?.width??300,height:originalHost.memoizedProps.style?.at?.(-1)?.height??100})};
  let body:any,windowCount=0,overrides=0,failInsert=false;
  const hook={renderers:new Map(),onCommitFiberRoot(){}};
  const fibers=(visit:any,subtree?:any)=>{const stack=[subtree??sheet];while(stack.length){const fiber=stack.pop();if(fiber!==subtree&&fiber.sibling)stack.push(fiber.sibling);if(visit(fiber)!==false&&fiber.child)stack.push(fiber.child)}};
  const renderer={rendererPackageName:'react-native-renderer',overrideProps(fiber:any,_path:any,props:any){
    overrides++;
    if(fiber===container&&failInsert)throw Error('commit refused');
    fiber.memoizedProps=props;
    if(fiber===container){
      const element=props.children?.props?.children?.at(-1);
      form.sibling=undefined;
      if(element?.type===Modal)windowCount++;
      if(element?.key?.startsWith('mobile-flow-preview-')){
        const child=element.props.children.props.children;
        body={type:child.type,elementType:child.type,memoizedProps:child.props,pendingProps:child.props,return:container};
        const view:any={type:View,memoizedProps:{},return:body};body.child=view;
        view.child={tag:5,type:'NativeBody',memoizedProps:{},stateNode:{getBoundingClientRect:()=>({width:300,height:180})},return:view};form.sibling=body;
      }
    }
    hook.onCommitFiberRoot();
  }};
  hook.renderers.set(1,renderer);
  (globalThis as any).__r={getModules:()=>new Map([[1,{isInitialized:true,publicModule:{exports:{...React}}}],[2,{isInitialized:true,publicModule:{exports:{View,Modal,Platform:{OS:'ios'},StyleSheet:{create(){}}}}}]])};
  const runtime=install({hook,fibers,hidden:()=>false,later:setTimeout});
  runtime.captureNative(sheet);canonical.currentProps.onStateChange({nativeEvent:{state:'open'}} as any);
  t.after(()=>{runtime.cleanup();(globalThis as any).__r=previous});
  return {runtime,hook,sheet,container,form,original,children,originalStyle,originalHost,Step,View,Modal,
    body:()=>body,windowCount:()=>windowCount,overrides:()=>overrides,failInsert:()=>{failInsert=true}};
}

for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
 const mode=install===installPresentationRuntime?'normal':'shared loops';
 test(`an open sheet renders a preview in its own content slot (${mode})`,async t=>{
  const app=sheetFixture(t,install),{runtime}=app;
  assert.equal(runtime.project(app.form,{views:['step']}).error,undefined);
  const children=app.container.memoizedProps.children.props.children;
  assert.equal(children[0],app.children.props.children[0]);
  assert.equal(children[1],app.original,'Original element type, key, position and props remain unchanged');
  assert.equal(children[2].type,React.Fragment,'A layout-neutral body keeps the native sheet height and safe area');
  assert.equal(app.windowCount(),0,'A form step must not start another native presentation');
  assert.equal(app.originalHost.memoizedProps.style.at(-1).opacity,0);
  assert.equal(runtime.diagnostics().inlineProjections,1);
  assert.equal(runtime.motion(app.form).pending,true,'The native sizing root follows the copied form before readiness');
  assert.equal(app.originalHost.memoizedProps.style.at(-1).height,180);
  assert.equal(runtime.motion(app.form).pending,false,'The observed native sizing root now matches the copied form');
  assert.equal(runtime.motion(app.form).error,undefined);
  const previousBody=app.body();
  const step:any={type:app.Step,memoizedProps:{},return:previousBody.child};previousBody.child.child=step;
  assert.match(runtime.project(step,{views:['unmounted-step']}).error,/exact content slot/);
  previousBody.child.child={tag:5,type:'NativeBody',memoizedProps:{},stateNode:{getBoundingClientRect:()=>({width:300,height:180})},return:previousBody.child};
  assert.equal(runtime.project(previousBody,{views:['next-step']}).error,undefined);
  assert.equal(app.windowCount(),0);assert.equal(runtime.checkpoint(),2);
  assert.equal(app.container.memoizedProps.children.props.children.length,3);
  await runtime.rollback(1);
  assert.equal(app.originalHost.memoizedProps.style.at(-1).opacity,0,'Returning to the prior copied step keeps the original concealed');
  assert.equal(runtime.diagnostics().inlineProjections,1);
  await runtime.rollback();
  assert.equal(app.container.memoizedProps.children,app.children,'Cleanup preserves the app’s exact original Fragment');
  assert.equal(app.originalHost.memoizedProps.style,app.originalStyle);
  assert.equal(runtime.checkpoint(),0);assert.equal(runtime.diagnostics().inlineProjections,0);
 });

 test(`native preview cleanup preserves later app props and rejects overlapping frames (${mode})`,async t=>{
  const app=sheetFixture(t,install),{runtime}=app;
  runtime.project(app.form,{views:['step']});
  const style={padding:20};app.originalHost.memoizedProps={...app.originalHost.memoizedProps,style,testID:'changed'};app.hook.onCommitFiberRoot();
  const changed=runtime.motion(app.form);assert.equal(changed.error,undefined);assert.equal(changed.pending,true);
  assert.equal(app.originalHost.memoizedProps.style.at(-1).opacity,0,'The same body is concealed again before it can pass readiness');
  assert.equal(runtime.motion(app.form).pending,false);
  await runtime.rollback();
  assert.equal(app.originalHost.memoizedProps.style,style);assert.equal(app.originalHost.memoizedProps.testID,'changed');assert.equal(app.originalHost.memoizedProps.pointerEvents,undefined);
  assert.equal(app.container.memoizedProps.children,app.children);
 });

 test(`detaching an inline preview restores owned styles without restoring old app children (${mode})`,async t=>{
  const app=sheetFixture(t,install),{runtime}=app;
  runtime.project(app.form,{views:['step']});
  const replacement=React.createElement(React.Fragment,null,app.original,React.createElement('new-child'));
  app.container.memoizedProps={...app.container.memoizedProps,children:replacement};app.form.sibling=undefined;app.hook.onCommitFiberRoot();
  await runtime.rollback();
  assert.equal(app.container.memoizedProps.children,replacement);
  assert.equal(app.originalHost.memoizedProps.style,app.originalStyle);assert.equal(runtime.checkpoint(),0);
 });

 test(`a failed inline commit keeps enough undo state to restore the original body (${mode})`,async t=>{
  const app=sheetFixture(t,install),{runtime}=app;app.failInsert();
  assert.throws(()=>runtime.project(app.form,{views:['step']}),/commit refused/);
  assert.equal(runtime.checkpoint(),1);assert.equal(app.originalHost.memoizedProps.style.at(-1).opacity,0);
  await runtime.rollback();
  assert.equal(app.originalHost.memoizedProps.style,app.originalStyle);assert.equal(runtime.checkpoint(),0);
 });

 test(`an ambiguous sheet slot cannot put a step after an unrelated footer (${mode})`,t=>{
  const app=sheetFixture(t,install);
  app.container.memoizedProps={children:React.createElement(React.Fragment,null,app.original,React.createElement('footer'))};app.hook.onCommitFiberRoot();
  assert.match(app.runtime.project(app.form,{views:['step']}).error,/exact content slot/);
  assert.equal(app.overrides(),0);assert.equal(app.windowCount(),0);assert.equal(app.runtime.checkpoint(),0);
 });

 test(`inline restore removes only its own child and keeps new siblings (${mode})`,async t=>{
  const app=sheetFixture(t,install);
  app.runtime.project(app.form,{views:['step']});
  const next=app.container.memoizedProps,added=React.createElement('app-overlay');
  app.container.memoizedProps={...next,children:React.cloneElement(next.children,{},...next.children.props.children,added)};app.hook.onCommitFiberRoot();
  await app.runtime.rollback();
  assert.deepEqual(app.container.memoizedProps.children.props.children,[...app.children.props.children,added]);
  assert.equal(app.originalHost.memoizedProps.style,app.originalStyle);assert.equal(app.windowCount(),0);
 });
}

for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
 test(`a native child sheet keeps its own preview slot (${install===installPresentationRuntime?'normal':'shared loops'})`,async t=>{
  const app=sheetFixture(t,install),{runtime}=app;
  runtime.project(app.form,{views:['parent-step']});
  const parentElement=app.container.memoizedProps.children.props.children.at(-1),body=app.body();
  const props={onStateChange(){}},canonical={currentProps:props};
  const native:any={tag:5,type:'ChildSheet',memoizedProps:props,stateNode:{canonical},return:body};body.child=native;
  const child=React.createElement(app.Step),container:any={type:app.View,memoizedProps:{children:child},return:native};native.child=container;
  const step:any={type:app.Step,memoizedProps:child.props,return:container};container.child=step;
  const host:any={tag:5,type:'Field',memoizedProps:{},stateNode:{getBoundingClientRect:()=>({width:300,height:100})},return:step};step.child=host;
  app.hook.onCommitFiberRoot();runtime.captureNative(native);canonical.currentProps.onStateChange({nativeEvent:{state:'open'}} as any);
  assert.equal(runtime.project(step,{views:['child-step']}).error,undefined);
  assert.equal(app.container.memoizedProps.children.props.children.at(-1),parentElement,'The outer form must not replace its newly opened native child');
  assert.equal(container.memoizedProps.children.props.children.at(-1).type,React.Fragment);
  assert.equal(host.memoizedProps.style.at(-1).opacity,0);
  await runtime.rollback(1);
  assert.equal(container.memoizedProps.children,child);assert.equal('style' in host.memoizedProps,false);
  assert.equal(app.originalHost.memoizedProps.style.at(-1).opacity,0);
  // The child sheet is still open. Removing the parent preview would orphan it,
  // so the rollback reports an unresolved native state.
  await assert.rejects(runtime.rollback(),/Native presentation dismissal is unconfirmed/);
  assert.equal(app.originalHost.memoizedProps.style,app.originalStyle);
  // A real close event from that sheet clears the failure.
  canonical.currentProps.onStateChange({nativeEvent:{state:'closed'}} as any);
  await runtime.rollback();
 });
}

for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
 test(`source Profilers and providers preserve the exact sheet body (${install===installPresentationRuntime?'normal':'shared loops'})`,async t=>{
  const app=sheetFixture(t,install),context=React.createContext('original');
  const wrapper=React.createElement(React.Profiler,{id:'instrumented-entry',onRender(){}},React.createElement(context.Provider,{value:'real'},app.original));
  const props={...app.container.memoizedProps,children:React.createElement(React.Fragment,null,React.createElement('handle'),wrapper)};
  app.container.memoizedProps=props;
  const provider:any={tag:10,type:context.Provider,memoizedProps:{value:'real'},return:app.container,child:app.form};app.container.child=provider;app.form.return=provider;app.hook.onCommitFiberRoot();
  assert.equal(app.runtime.project(app.form,{views:['step']}).error,undefined);
  assert.equal(app.windowCount(),0);assert.equal(app.container.memoizedProps.children.props.children[1],wrapper);
  await app.runtime.rollback();
  assert.equal(app.container.memoizedProps.children,props.children);assert.equal(app.originalHost.memoizedProps.style,app.originalStyle);
 });
}

for(const install of [installPresentationRuntime,sharedLoopRuntime()]){
 test(`inline sizing waits for the native root and restores its exact props (${install===installPresentationRuntime?'normal':'shared loops'})`,async t=>{
  const app=sheetFixture(t,install),{runtime}=app;
  app.originalHost.memoizedProps={...app.originalHost.memoizedProps,pointerEvents:'box-only',accessibilityElementsHidden:false};
  let actualHeight=100;
  app.originalHost.stateNode.getBoundingClientRect=()=>({width:300,height:actualHeight});
  runtime.project(app.form,{views:['step']});
  assert.equal(app.originalHost.memoizedProps.pointerEvents,'none');
  assert.equal(app.originalHost.memoizedProps.accessibilityElementsHidden,true);
  assert.equal(runtime.motion(app.form).pending,true);
  assert.equal(app.originalHost.memoizedProps.style.at(-1).height,180);
  assert.equal(runtime.motion(app.form).pending,true,'React props alone do not prove native sizing caught up');
  actualHeight=180;
  assert.equal(runtime.motion(app.form).pending,false);
  await runtime.rollback();
  assert.equal(app.originalHost.memoizedProps.pointerEvents,'box-only');
  assert.equal(app.originalHost.memoizedProps.accessibilityElementsHidden,false);
  assert.equal('importantForAccessibility' in app.originalHost.memoizedProps,false);
  assert.equal(app.originalHost.memoizedProps.style,app.originalStyle);
 });

 test(`incompatible native sizing roots cannot count as a ready preview (${install===installPresentationRuntime?'normal':'shared loops'})`,async t=>{
  const app=sheetFixture(t,install),{runtime}=app;
  runtime.project(app.form,{views:['step']});
  const root=app.body().child.child;root.sibling={...root,return:root.return};app.hook.onCommitFiberRoot();
  assert.match(runtime.motion(app.form).error,/sizing roots do not match/);
  await runtime.rollback();assert.equal(app.originalHost.memoizedProps.style,app.originalStyle);
 });
}

// A dialog shell, such as a scroll view, renders the step's element deeper
// than the nearest View: sheet > View > Shell > host > Step, Close.
function shellFixture(t:test.TestContext,{laterRenders=false,stepRenders=true}={}) {
  const previous=(globalThis as any).__r;
  function View(){}function Modal(){}function Shell(){}function Step(){}function Close(){}
  const original=React.createElement(Step,{label:'Original'}),close=React.createElement(Close,null);
  const shellElement=React.createElement(Shell,null,original,close);
  const lifecycle={onStateChange(){}},canonical={currentProps:lifecycle};
  const sheet:any={tag:5,type:'NativePresentation',memoizedProps:lifecycle,stateNode:{canonical}};
  const container:any={type:View,memoizedProps:{children:shellElement},return:sheet};sheet.child=container;
  const shell:any={tag:0,type:Shell,memoizedProps:shellElement.props,return:container};container.child=shell;
  const scroll:any={tag:5,type:'NativeScroll',memoizedProps:{},return:shell};shell.child=scroll;
  const step:any={tag:0,type:Step,memoizedProps:original.props,return:scroll};scroll.child=step;
  const closeFiber:any={tag:0,type:Close,memoizedProps:close.props,return:scroll};step.sibling=closeFiber;
  if(laterRenders)closeFiber.child={tag:5,type:'NativeButton',memoizedProps:{},return:closeFiber};
  const originalStyle=[{padding:8}],originalHost:any={tag:5,type:'NativeBody',memoizedProps:{style:originalStyle},return:step,stateNode:{getBoundingClientRect:()=>({width:300,height:100})}};
  if(stepRenders)step.child=originalHost;
  let body:any;
  const hook={renderers:new Map(),onCommitFiberRoot(){}};
  const fibers=(visit:any,subtree?:any)=>{const stack=[subtree??sheet];while(stack.length){const fiber=stack.pop();if(fiber!==subtree&&fiber.sibling)stack.push(fiber.sibling);if(visit(fiber)!==false&&fiber.child)stack.push(fiber.child)}};
  const renderer={rendererPackageName:'react-native-renderer',overrideProps(fiber:any,_path:any,props:any){
    fiber.memoizedProps=props;
    if(fiber===shell){
      const element=props.children?.props?.children?.at?.(-1);closeFiber.sibling=undefined;
      if(element?.key?.startsWith('mobile-flow-preview-')){
        const child=element.props.children.props.children;
        body={tag:0,type:child.type,elementType:child.type,memoizedProps:child.props,pendingProps:child.props,return:scroll};
        body.child={tag:5,type:'NativeBody',memoizedProps:{},stateNode:{getBoundingClientRect:()=>({width:300,height:180})},return:body};closeFiber.sibling=body;
      }
    }
    hook.onCommitFiberRoot();
  }};
  hook.renderers.set(1,renderer);
  (globalThis as any).__r={getModules:()=>new Map([[1,{isInitialized:true,publicModule:{exports:{...React}}}],[2,{isInitialized:true,publicModule:{exports:{View,Modal,Platform:{OS:'ios'},StyleSheet:{create(){}}}}}]])};
  const runtime=installPresentationRuntime({hook,fibers,hidden:()=>false,later:setTimeout});
  runtime.captureNative(sheet);canonical.currentProps.onStateChange({nativeEvent:{state:'open'}} as any);
  t.after(()=>{runtime.cleanup();(globalThis as any).__r=previous});
  return {runtime,container,shell,step,original,close,originalHost,originalStyle,shellElement,body:()=>body};
}

test('a step inside a dialog shell is copied beside its own element when later siblings render nothing',async t=>{
  const app=shellFixture(t),{runtime}=app;
  assert.equal(runtime.project(app.step,{views:['step']}).error,undefined);
  const children=app.shell.memoizedProps.children.props.children;
  assert.equal(children[0],app.original);assert.equal(children[1],app.close);
  assert.ok(children[2].key.startsWith('mobile-flow-preview-'),'The copy follows the step inside the shell, not after the shell');
  assert.equal(app.container.memoizedProps.children,app.shellElement,'The outer View keeps its children');
  assert.equal(app.originalHost.memoizedProps.style.at(-1).opacity,0);
  assert.equal(runtime.motion(app.step).pending,false,'A nested step needs no sizing proxy once its copy renders');
  await runtime.rollback();
  assert.deepEqual(app.shell.memoizedProps.children,[app.original,app.close]);
  assert.equal(app.originalHost.memoizedProps.style,app.originalStyle);assert.equal(runtime.checkpoint(),0);
});

test('a nested step copy may render other native roots than the original step',async t=>{
  const app=shellFixture(t),{runtime}=app;
  assert.equal(runtime.project(app.step,{views:['step']}).error,undefined);
  // The copied step renders two native roots where the original had one.
  const body=app.body();body.child.sibling={tag:5,type:'NativeFooter',memoizedProps:{},stateNode:{getBoundingClientRect:()=>({width:300,height:40})},return:body};
  const view=runtime.motion(app.step);
  assert.equal(view.error,undefined);assert.equal(view.pending,false);
  assert.equal(app.originalHost.memoizedProps.style.at(-1).opacity,0,'The original stays concealed');
  await runtime.rollback();
});

test('a nested copy dropped by its parent re-rendering is attached again',async t=>{
  const app=shellFixture(t),{runtime}=app;
  assert.equal(runtime.project(app.step,{views:['step']}).error,undefined);
  // The dialog re-renders its shell with fresh children and no copy.
  app.shell.memoizedProps={children:[app.original,app.close]};
  const view=runtime.motion(app.step);
  assert.equal(view.pending,true,'Readiness waits while the copy returns');
  const children=app.shell.memoizedProps.children.props.children;
  assert.equal(children.length,3);assert.ok(children[2].key.startsWith('mobile-flow-preview-'));
  await runtime.rollback();
  assert.deepEqual(app.shell.memoizedProps.children.props?.children??app.shell.memoizedProps.children,[app.original,app.close]);
});

test('a later sibling that renders a native view keeps the step without a slot',t=>{
  const app=shellFixture(t,{laterRenders:true});
  const result=app.runtime.project(app.step,{views:['step']});
  assert.match(result.error,/exact content slot/);assert.match(result.detail,/later-sibling/);
  assert.equal(app.runtime.checkpoint(),0);
});

test('a step that renders nothing yet takes its copy without concealing anything',async t=>{
  const app=shellFixture(t,{stepRenders:false}),{runtime}=app;
  assert.equal(runtime.project(app.step,{views:['step']}).error,undefined);
  assert.equal(runtime.motion(app.step).error,undefined,'No original body has to match the copy');
  await runtime.rollback();
  assert.deepEqual(app.shell.memoizedProps.children,[app.original,app.close]);
});
