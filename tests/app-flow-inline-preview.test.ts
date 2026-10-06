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
        view.child={tag:5,type:'PreviewBody',memoizedProps:{},return:view};form.sibling=body;
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
  assert.equal(app.originalHost.memoizedProps.style.at(-1).display,'none');
  assert.equal(runtime.diagnostics().inlineProjections,1);
  assert.equal(runtime.motion(app.form).pending,false,'No additional onShow callback is required');
  assert.equal(runtime.motion(app.form).error,undefined);
  const previousBody=app.body();
  const step:any={type:app.Step,memoizedProps:{},return:previousBody.child};previousBody.child.child=step;
  assert.equal(runtime.project(step,{views:['next-step']}).error,undefined);
  assert.equal(app.windowCount(),0);assert.equal(runtime.checkpoint(),2);
  assert.equal(app.container.memoizedProps.children.props.children.length,3);
  await runtime.rollback(1);
  assert.equal(app.originalHost.memoizedProps.style.at(-1).display,'none','Returning to the prior copied step keeps the original concealed');
  assert.equal(runtime.diagnostics().inlineProjections,1);
  await runtime.rollback();
  assert.equal(app.container.memoizedProps.children,app.children,'Cleanup preserves the app’s exact original Fragment');
  assert.equal(app.originalHost.memoizedProps.style,app.originalStyle);
  assert.equal(runtime.checkpoint(),0);assert.equal(runtime.diagnostics().inlineProjections,0);
 });

 test(`native preview cleanup preserves later app props and rejects overlapping frames (${mode})`,async t=>{
  const app=sheetFixture(t,install),{runtime}=app;
  runtime.project(app.form,{views:['step']});
  const style={padding:20};app.originalHost.memoizedProps={style,testID:'changed'};app.hook.onCommitFiberRoot();
  assert.match(runtime.motion(app.form).error,/body changed/);
  await runtime.rollback();
  assert.equal(app.originalHost.memoizedProps.style,style);assert.equal(app.originalHost.memoizedProps.testID,'changed');
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
  assert.equal(runtime.checkpoint(),1);assert.equal(app.originalHost.memoizedProps.style.at(-1).display,'none');
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
  const host:any={tag:5,type:'Field',memoizedProps:{},return:step};step.child=host;
  app.hook.onCommitFiberRoot();runtime.captureNative(native);canonical.currentProps.onStateChange({nativeEvent:{state:'open'}} as any);
  assert.equal(runtime.project(step,{views:['child-step']}).error,undefined);
  assert.equal(app.container.memoizedProps.children.props.children.at(-1),parentElement,'The outer form must not replace its newly opened native child');
  assert.equal(container.memoizedProps.children.props.children.at(-1).type,React.Fragment);
  assert.equal(host.memoizedProps.style.at(-1).display,'none');
  await runtime.rollback(1);
  assert.equal(container.memoizedProps.children,child);assert.equal('style' in host.memoizedProps,false);
  assert.equal(app.originalHost.memoizedProps.style.at(-1).display,'none');
  await runtime.rollback();
  assert.equal(app.originalHost.memoizedProps.style,app.originalStyle);
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
