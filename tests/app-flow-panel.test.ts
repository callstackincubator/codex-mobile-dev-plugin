import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
const bundle = await build({entryPoints:['src/ui/app-flow-panel.ts'],bundle:true,write:false,format:'iife',globalName:'Flow',platform:'browser',define:{'process.env.NODE_ENV':'"production"'}});
function panel(t: test.TestContext, call: (args:any)=>Promise<any>) {
  const dom = new JSDOM('<html/>',{pretendToBeVisual:true,runScripts:'outside-only'});
  dom.window.eval(bundle.outputFiles[0].text + ';globalThis.Flow = Flow;');
  const api = new dom.window.Flow.AppFlowPanel({callServerTool:call}, {subscribe:()=>()=>{},getSnapshot:()=>({device:{udid:'device',name:'iPhone'},foregroundApp:{bundleId:'example.app'}})});
  api.thumbnail=async(blob:string,width:number)=>({url:`data:image/png;base64,${blob}`,bytes:width*width*8,width});
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

test('screenshots use host-compatible data URLs and publish one update per batch', async t => {
  const api=panel(t,async()=>({structuredContent:{}}));
  api.state={...api.state,run:{id:'run',phase:'complete',revision:1,nodes:[{image:'mobile-flow://run/a'},{image:'mobile-flow://run/b'}]},images:{}};
  api.app.readServerResource=async()=>({contents:[{mimeType:'image/png',blob:'iVBORw0KGgo='}]});
  api.visible(['mobile-flow://run/a','mobile-flow://run/b']);
  let updates=0;const stop=api.subscribe(()=>updates++);
  await api.loadImages();stop();
  assert.equal(updates,1);
  assert.equal(api.getSnapshot().images['mobile-flow://run/a'],'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(api.getSnapshot().images['mobile-flow://run/b'],'data:image/png;base64,iVBORw0KGgo=');
});

test('AI handoff saves the run before sending its request to chat', async t => {
  const events:string[]=[];
  const api=panel(t,async args=>{events.push(args.arguments.action);return {structuredContent:{context:{}}}});
  api.state={...api.state,run:{id:'saved-run',phase:'complete',revision:1,nodes:[]}};
  api.app.sendMessage=async message=>{events.push('message');assert.match(message.content[0].text,/same saved map/);assert.doesNotMatch(message.content[0].text,/kept for the next run/);return {}};
  await api.resolveWithAi();
  assert.deepEqual(events,['prepare','message']);
});

test('failed handoff persistence leaves an error and does not send an unusable run to chat', async t => {
  const api=panel(t,async()=>({isError:true,content:[{type:'text',text:'Could not save map'}]}));
  api.state={...api.state,run:{id:'saved-run',phase:'complete',nodes:[]}};
  api.app.sendMessage=async()=>{assert.fail('Must not send before saving')};
  await api.resolveWithAi();
  assert.equal(api.getSnapshot().error,'Could not save map');
});

test('a finished open map reads updates from AI capture and preserves existing previews', async t => {
  const api=panel(t,async args=>{
    assert.equal(args.name,'mobile_read_app_flow');
    return {structuredContent:{run:{id:'saved-run',phase:'capturing',revision:2,nodes:[]}}};
  });
  api.state={...api.state,open:true,run:{id:'saved-run',phase:'complete',revision:1,nodes:[]},images:{old:'data:image/png;base64,unchanged'}};
  await api.poll();
  assert.equal(api.getSnapshot().run.phase,'capturing');
  assert.equal(api.getSnapshot().images.old,'data:image/png;base64,unchanged');
  api.hide();
});

test('record and extend keep the current map and images, and a manual step goes through the shared tool', async t => {
  const calls:any[] = [];
  const api = panel(t,async args => { calls.push(args.arguments); return {structuredContent:{run:{id:'saved-run',phase:args.arguments.action === 'record' ? 'recording' : 'complete',recording:args.arguments.action === 'record' ? {groupId:'group'} : undefined,nodes:[]}}}; });
  api.settings = {...api.settings,project:'/project',metro:result.metroUrl,target:'target'};
  api.state = {...api.state,run:{id:'saved-run',phase:'complete',nodes:[]},images:{old:'saved-image'}};
  await api.recordFlow('Sign in');
  assert.equal(calls[0].runId,'saved-run'); assert.equal(calls[0].label,'Sign in');
  assert.equal(api.getSnapshot().images.old,'saved-image');
  await api.captureStep('Reset password');
  assert.equal(calls[1].action,'capture-step'); assert.equal(calls[1].label,'Reset password');
  api.state = {...api.state,run:{...api.state.run,phase:'complete',recording:undefined}};
  await api.extendMap();
  assert.equal(calls[2].action,'extend'); assert.equal(calls[2].runId,'saved-run');
  assert.equal(api.getSnapshot().images.old,'saved-image');
});

test('reset keeps setup, ignores late responses, and starts a separate map', async t => {
  let rejectPoll!: (error: Error) => void, finishImage!: (value: any) => void;
  const calls: any[] = [];
  const api = panel(t, async args => {
    calls.push(args);
    if (args.name === 'mobile_read_app_flow') return new Promise((_, reject) => { rejectPoll = reject; });
    return {structuredContent:{run:{id:'fresh-run',phase:'complete',revision:0,nodes:[]}}};
  });
  const uri = 'mobile-flow://old-run/screen';
  api.settings = {...api.settings,project:'/project',metro:result.metroUrl,target:'target'};
  const settings = {...api.settings};
  api.state = {...api.state,open:true,run:{id:'old-run',phase:'complete',revision:1,nodes:[{image:uri}]},images:{old:'saved-image'},error:'Old error',message:'Old status'};
  api.app.readServerResource = () => new Promise(resolve => { finishImage = resolve; });
  api.visibleImages.add(uri);
  const images = api.loadImages(), polling = api.poll();
  api.reset();
  finishImage({contents:[{mimeType:'image/png',blob:'iVBORw0KGgo='}]});
  rejectPoll(new Error('Old polling request failed'));
  await Promise.all([images, polling]);
  assert.equal(api.getSnapshot().run,undefined);
  assert.equal(Object.keys(api.getSnapshot().images).length,0);
  assert.equal(api.getSnapshot().error,''); assert.equal(api.getSnapshot().message,'');
  assert.equal(api.imageBytes,0); assert.equal(api.failedImages.size,0);
  assert.deepEqual(api.settings,settings);
  api.hide();
  await api.start(settings.project,settings.metro,settings.target,settings.useAi);
  assert.equal(calls.at(-1).arguments.action,'start');
  assert.equal(calls.at(-1).arguments.runId,undefined);
  assert.equal(api.getSnapshot().run.id,'fresh-run');
});

test('only visible screenshots load and scrolling releases their decoded memory',async t=>{
  const api=panel(t,async()=>({structuredContent:{}})),requested:string[]=[];
  const uris=Array.from({length:200},(_,i)=>`mobile-flow://run/${i}`);
  api.state={...api.state,run:{id:'run',phase:'complete',nodes:uris.map(image=>({image}))},images:{}};
  api.app.readServerResource=async({uri}:any)=>{requested.push(uri);return {contents:[{blob:'png'}]}};
  for(let i=0;i<50;i++){
    api.visible([uris[i]],384);await api.loadImages();
    assert.deepEqual(Object.keys(api.state.images),[uris[i]]);
    assert.ok(api.imageBytes<=384*384*8);
  }
  assert.equal(requested.length,50,'Offscreen screenshots must not download');
  api.visible([]);assert.equal(api.imageBytes,0);assert.equal(Object.keys(api.state.images).length,0);
});

test('panning away during a screenshot read drops its result and zoom controls preview size',async t=>{
  const api=panel(t,async()=>({structuredContent:{}})),uri='mobile-flow://run/a';let finish:any,decoded=0;
  api.state={...api.state,run:{id:'run',phase:'complete',nodes:[{image:uri}]},images:{}};
  api.thumbnail=async()=>{decoded++;return {url:'thumb',bytes:100,width:96}};
  api.app.readServerResource=()=>new Promise(resolve=>{finish=resolve});
  api.visible([uri],96);const pending=api.loadImages();api.visible([]);
  finish({contents:[{blob:'png'}]});await pending;
  assert.equal(decoded,0);assert.equal(api.imageBytes,0);
  api.visible(Array.from({length:260},(_,i)=>String(i)),384);
  assert.ok(api.thumbnailWidth<128,'A wide overview must fit the decoded-pixel budget');
});

test('overlapping viewport updates share two screenshot decode slots',async t=>{
  const api=panel(t,async()=>({structuredContent:{}})),finish:Array<(value:any)=>void>=[];
  const uris=Array.from({length:12},(_,i)=>`mobile-flow://run/${i}`);
  api.state={...api.state,run:{id:'run',phase:'complete',nodes:uris.map(image=>({image}))}};
  api.app.readServerResource=()=>new Promise(resolve=>finish.push(resolve));
  api.visible(uris);
  const batches=[api.loadImages(),api.loadImages(),api.loadImages()];
  assert.equal(finish.length,2);
  for(const resolve of finish)resolve({contents:[{blob:'png'}]});
  await Promise.all(batches);
  assert.equal(Object.keys(api.state.images).length,2);assert.equal(api.loading.size,0);
});
