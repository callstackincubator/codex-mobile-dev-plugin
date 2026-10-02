import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
const bundle = await build({entryPoints:['src/ui/app-flow-panel.ts'],bundle:true,write:false,format:'iife',globalName:'Flow',platform:'browser',define:{'process.env.NODE_ENV':'"production"'}});
function panel(t: test.TestContext, call: (args:any)=>Promise<any>) {
  const dom = new JSDOM('<html/>',{pretendToBeVisual:true,runScripts:'outside-only'});
  dom.window.eval(bundle.outputFiles[0].text + ';globalThis.Flow = Flow;');
  const api = new dom.window.Flow.AppFlowPanel({callServerTool:call}, {subscribe:()=>()=>{},getSnapshot:()=>({device:{udid:'device',name:'iPhone'},foregroundApp:{bundleId:'example.app'}})});
  t.after(()=>{api.dispose();dom.window.close()}); return api;
}
const result = {projectRoot:'/project',metroUrl:'http://127.0.0.1:9191',targetId:'target',targets:[{id:'target'}],servers:[],message:''};
test('discovery fills setup and sends selected device and foreground app', async t => {
  let input:any;
  const api = panel(t,async args=>{input=args.arguments;return {structuredContent:result}});
  await api.discover();
  assert.equal(input.action,'discover'); assert.equal(input.discovery.appId,'example.app');
  assert.equal(api.settings.project,'/project'); assert.equal(api.settings.metro,result.metroUrl); assert.equal(api.settings.target,'target');
});
test('a late discovery cannot overwrite manual edits or repopulate stale targets', async t => {
  let finish!: (value:any)=>void;
  const api = panel(t,()=>new Promise(resolve=>{finish=resolve}));
  const pending = api.discover(); api.setSetting('project','/manual');
  finish({structuredContent:result}); await pending;
  assert.equal(api.settings.project,'/manual'); assert.equal(api.settings.target,''); assert.equal(api.getSnapshot().busy,false);
});
test('hiding the tab cancels setup and manual Metro changes clear the old target', async t => {
  const api = panel(t,async()=>({structuredContent:result}));
  await api.discover(); api.setSetting('metro','http://127.0.0.1:8082');
  assert.equal(api.settings.target,''); assert.equal(api.getSnapshot().targets.length,0);
  api.hide(); assert.equal(api.getSnapshot().open,false);
});


test('refresh preserves a chosen target at the same server', async t => {
  let reply = result;
  const api = panel(t,async()=>({structuredContent:reply}));
  await api.discover(); api.setSetting('target','target');
  reply = {...result,targetId:''}; await api.discover();
  assert.equal(api.settings.target,'target');
});
