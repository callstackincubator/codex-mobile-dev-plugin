import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createTransitionMode} from '../src/server/app-flow/transitions-runtime.js';
import {sharedLoopRuntime} from './app-flow-runtime-fixtures.ts';

for(const factory of [createTransitionMode,sharedLoopRuntime(createTransitionMode as any)]) {
  test(`transition mode preserves hooks, screen rendering and presentation options (${factory===createTransitionMode?'normal':'shared loops'})`,()=>{
    let hooks=0,rendered=0;
    const options={animation:'slide_from_right',animationEnabled:true,presentation:'formSheet',headerShown:false,gestureEnabled:true};
    const value={options,render(){rendered++;return 'real screen'},navigation:{},route:{key:'one'}};
    const original=function(this:any){assert.equal(this,exports);hooks++;return {descriptors:{one:value},describe:()=>value}};
    const exports:any={useDescriptors:original};
    const property=Object.getOwnPropertyDescriptor(exports,'useDescriptors');
    const context=vm.createContext({__r:{getModules:()=>new Map([[1,{isInitialized:true,verboseName:'/app/node_modules/@react-navigation/core/src/useDescriptors.tsx',publicModule:{exports}}]])}});
    const mode=vm.runInContext(`(${factory.toString()})()`,context);
    assert.equal(exports.useDescriptors,original);
    mode.enable();mode.enable();
    const result=exports.useDescriptors();
    assert.equal(hooks,1,'The original hook runs exactly once, with no extra hooks');
    assert.equal(result.descriptors.one.options.animation,'none');
    assert.equal(result.descriptors.one.options.animationEnabled,false);
    for(const key of ['presentation','headerShown','gestureEnabled'])assert.equal(result.descriptors.one.options[key],options[key as keyof typeof options]);
    assert.equal(result.describe().options.animation,'none');
    assert.equal(result.descriptors.one.render(), 'real screen');assert.equal(rendered,1);
    assert.equal(value.options,options);assert.equal(options.animation,'slide_from_right');
    const retained=exports.useDescriptors;
    mode.restore();
    assert.deepEqual(Object.getOwnPropertyDescriptor(exports,'useDescriptors'),property);
    assert.equal(retained.call(exports).descriptors.one,value,'Even a cached wrapper stops overriding on restore');
    assert.equal(mode.diagnostics().transitionModules,0);
  });
}

test('transition mode skips app exports, cold modules and read-only framework builds',()=>{
  const app={useDescriptors(){throw Error('app code must not be called')}};
  const cold={get useDescriptors(){throw Error('cold export must not be read')}};
  const frozen=Object.freeze({useDescriptors:()=>({})});
  const modules=[['/app/useDescriptors.tsx',true,app],['/app/node_modules/@react-navigation/core/src/useDescriptors.tsx',false,cold],['/app/node_modules/@react-navigation/core/lib/module/useDescriptors.js',true,frozen]];
  const context=vm.createContext({__r:{getModules:()=>new Map(modules.map(([verboseName,isInitialized,exports],id)=>[id,{verboseName,isInitialized,publicModule:{exports}}]))}});
  const mode=vm.runInContext(`(${createTransitionMode.toString()})()`,context);
  mode.enable();assert.equal(mode.diagnostics().transitionModules,0);mode.restore();
});
