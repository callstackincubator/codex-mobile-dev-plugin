import {QueuedAppFlowRuns as AppFlowRuns} from './app-flow-queue-fixture.ts';
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { scanAppFlow } from "../src/server/app-flow/scan.ts";
import { type FlowStart, type FlowDependencies } from "../src/server/app-flow/runs.ts";
import { flowRunning, layoutFlow, type FlowGraph } from "../src/shared/app-flow.ts";

async function fixture(t: test.TestContext, files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "app-flow-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) { await mkdir(join(root, file, ".."), { recursive: true }); await writeFile(join(root, file), content); }
  return root;
}

test("scanner expands shared declarations and nested navigators without running app code", async t => {
  const root = await fixture(t, {
    'src/App.tsx': `import {Profile} from './Profile';
      const Stack = createNativeStackNavigator(); const Tab = createBottomTabNavigator();
      type RoutesParamList = {Home: undefined; Profile: {id: string; tab?: string}; Detail: undefined};
      function shared(S) { return <S.Screen name={'Profile' as 'Profile'} component={Profile} />; }
      function HomeStack() { return <Stack.Navigator><Stack.Screen name="Home" component={Home}/>{shared(Stack)}{shared(Stack)}</Stack.Navigator>; }
      function SearchStack() { return <Stack.Navigator>{shared(Stack)}</Stack.Navigator>; }
      function App() { return <Tab.Navigator><Tab.Screen name="HomeTab" component={HomeStack}/><Tab.Screen name="SearchTab" getComponent={() => SearchStack}/></Tab.Navigator>; }
      throw Error('Scanner must never execute this file');`,
    'src/Profile.tsx': `export function Profile(){ const navigation = useNavigation(); return <Button onPress={() => navigation.navigate('Profile', {id:'real-fixture'})} />; }`,
    'node_modules/bad.tsx': '<S.Screen name="Dependency" />',
    'src/Ignore.web.tsx': '<S.Screen name="WebOnly" />',
  });
  const graph = await scanAppFlow(root, 'ios');
  assert.deepEqual(graph.nodes.filter(node => node.kind === 'screen').map(node => node.path), [['HomeTab','Home'],['HomeTab','Profile'],['SearchTab','Profile']]);
  const profiles = graph.nodes.filter(node => node.name === 'Profile');
  assert.deepEqual(profiles[0].required, ['id']);
  assert.deepEqual(profiles[0].params, {id:'real-fixture'});
  assert.ok(profiles.every(node => node.status === 'pending'));
  assert.ok(graph.edges.some(edge => edge.kind === 'navigation'));
  assert.equal(graph.nodes.some(node => ['Dependency','WebOnly'].includes(node.name)), false);
  const layout = layoutFlow(graph);
  assert.equal(layout.positions.size, graph.nodes.length);
});

test("scanner supports React Navigation static groups and Expo Router dynamic files", async t => {
  const root = await fixture(t, {
    'src/nav.tsx': `const Child = createNativeStackNavigator({screens:{Home:HomeScreen}}); const Root = createNativeStackNavigator({screens:{Main:Child},groups:{Auth:{screens:{Profile:{screen:ProfileScreen,initialParams:{id:'one'}}}}}});`,
    'app/_layout.tsx': 'export default function Layout(){return <Stack/>}',
    'app/(tabs)/_layout.tsx': 'export default function Layout(){return <Tabs/>}',
    'app/(tabs)/index.tsx': 'export default function Home(){}',
    'app/post/[id].tsx': 'export default function Post(){}',
    'app/+not-found.tsx': 'export default function Missing(){}',
    'app/data+api.ts': 'export const GET = () => null',
  });
  const graph = await scanAppFlow(root, 'ios');
  assert.ok(graph.nodes.some(node => node.path.join('/') === 'Main/Home'));
  assert.deepEqual(graph.nodes.find(node => node.name === 'Profile')?.params, {id:'one'});
  assert.deepEqual(graph.nodes.find(node => node.name === '/post/[id]')?.required, ['id']);
  assert.equal(graph.nodes.some(node => node.name.includes('+api') || node.name.includes('+not-found')), false);
});

test("scan reuse preserves cyclic helper order, URL specificity, and fresh source on the next scan", async t => {
  const root = await fixture(t, {
    'App.tsx': `import {Shared} from './Shared';
      const Tabs = createBottomTabNavigator();
      const urls = {Item: '/item/:id', Options: '/item/options'};
      function alpha(S) { return <><S.Screen name="Alpha" component={Shared}/>{beta(S)}</>; }
      function beta(S) { return <><S.Screen name="Beta" component={Shared}/>{alpha(S)}</>; }
      function Left() { return <S.Navigator>{alpha(S)}<S.Screen name="Item" component={Item}/><S.Screen name="Options" component={Options}/></S.Navigator>; }
      function Right() { return <S.Navigator>{beta(S)}<S.Screen name="Item" component={Item}/><S.Screen name="Options" component={Options}/></S.Navigator>; }
      function App() { return <Tabs.Navigator><Tabs.Screen name="Left" component={Left}/><Tabs.Screen name="Right" component={Right}/></Tabs.Navigator>; }`,
    'Shared.tsx': `export function Shared() { return <><Link href="/item/options"/><Link href="/item/options"/></>; }`,
  });
  const graph = await scanAppFlow(root, 'ios');
  assert.deepEqual(graph.nodes.filter(node => node.kind === 'screen').map(node => node.path), [
    ['Left','Item'], ['Left','Options'], ['Left','Alpha'], ['Left','Beta'],
    ['Right','Item'], ['Right','Options'], ['Right','Beta'], ['Right','Alpha'],
  ]);
  const edges = graph.edges.filter(edge => edge.kind === 'navigation');
  const shared = graph.nodes.filter(node => ['Alpha','Beta'].includes(node.name));
  const options = graph.nodes.filter(node => node.name === 'Options');
  assert.deepEqual(edges.map(edge => [edge.from,edge.to]), shared.flatMap(node => options.map(target => [node.id,target.id])));
  assert.ok(edges.every(edge => edge.file === 'Shared.tsx' && edge.line === 1));
  await writeFile(join(root,'Shared.tsx'), `export function Shared() { return <Link href="/item/actual"/>; }`);
  const updated = await scanAppFlow(root, 'ios');
  assert.deepEqual(updated.edges.filter(edge => edge.kind === 'navigation').map(edge => updated.nodes.find(node => node.id === edge.to)?.name), Array(8).fill('Item'));
});

test("scanner does not follow symlinks and reports unresolved names", async t => {
  const root = await fixture(t, {'src/nav.tsx': `function App(){return <S.Screen name={chooseRoute()} />}`});
  await symlink(root, join(root,'src','loop'));
  const graph = await scanAppFlow(root,'ios');
  assert.equal(graph.files,1);
  assert.ok(graph.warnings.some(warning => warning.includes('Unresolved')));
  const signal = AbortSignal.abort();
  await assert.rejects(scanAppFlow(root,'ios',signal));
});

const start: FlowStart = {projectRoot:'/fixture',platform:'ios',deviceId:'device',targetId:'target',metroUrl:'http://127.0.0.1:8081',useAi:false};
const graph = (): FlowGraph => ({ files:1,scanMs:1,warnings:[],edges:[],nodes:[
  {id:'first',name:'Home',kind:'screen',path:['Home'],required:[],status:'pending'},
  {id:'second',name:'Profile',kind:'screen',path:['Profile'],required:['id'],status:'needs-data'},
]});
async function waitForRun(runs: AppFlowRuns, id: string) {
  for (let i=0;i<1800 && flowRunning(runs.read(id));i++) await delay(10);
  return runs.read(id);
}

test("capture loop acknowledges screenshots, keeps missing data, and restores navigation", async t => {
  const directory = await fixture(t, {});
  const events: string[] = [];
  const runs = new AppFlowRuns({ directory, scan: async () => graph(), connect: async () => ({
    runtime: { async invoke(command) {
      events.push(String(command.type));
      if(command.type==='inspect') return {available:true};
      if(command.type==='open') return {ready:true,active:['Home'],name:'Home',signature:'home'};
      return {active:['Home'],found:true,signature:'home'};
    }, async close(){events.push('restore')} },
    async screenshot(){events.push('screenshot');return Buffer.from('fixture')},
  }) });
  const run = runs.start(start);
  await waitForRun(runs,run.id); await runs.close();
  const result = runs.read(run.id);
  assert.equal(result.nodes[0].status,'captured');
  assert.equal(result.nodes[1].status,'needs-data');
  assert.deepEqual(events,['inspect','cpu','presentation-rollback','open','verify','screenshot','verify','presentation-rollback','restore']);
  assert.equal((await runs.image(run.id,'first')).toString(),'fixture');
});

test("Stop aborts capture and late AI params are reused on the next run", async t => {
  const directory = await fixture(t, {});
  let closes=0, capturing=false;
  const runs = new AppFlowRuns({ directory, scan:async()=>graph(), connect:async()=>({
    runtime:{ async invoke(command){ if(command.type==='inspect') return {available:true}; return {ready:true,active:['Home'],name:'Home',signature:'home'}; }, async close(){closes++} },
    async screenshot(signal){ capturing=true; await delay(1000,undefined,{signal}); return Buffer.from('fixture'); },
  }) });
  const run=runs.start(start);
  await assert.rejects(async()=>runs.start(start),/already running/);
  for(let i=0;i<200&&!capturing;i++)await delay(10);
  assert.equal(capturing,true,'Stop must interrupt an actual in-flight screenshot');
  runs.stop(run.id); await runs.close();
  const result=runs.read(run.id);
  assert.equal(result.phase,'stopped');
  assert.equal(result.nodes[0].status,'timed-out');
  runs.resolve(run.id,[{nodeId:'second',params:{id:'real'}}]);
  const next=runs.start(start);
  for(let i=0;i<200&&runs.read(next.id).nodes.length<2;i++)await delay(10);
  assert.equal(runs.read(next.id).nodes[1]?.params?.id,'real');
  await runs.close();
  assert.ok(closes>=2);
});

test("a redirect or changing frame cannot count as a captured target", async t => {
  const directory=await fixture(t,{});
  let screenshotCount=0;
  const runs=new AppFlowRuns({directory,scan:async()=>graph(),connect:async()=>({
    runtime:{async invoke(command){
      if(command.type==='inspect')return {available:true};
      if(command.type==='open')return {ready:true,active:['Home'],name:'Home',signature:'home'};
      return {active:['Login'],found:true,signature:'login'};
    },async close(){}},async screenshot(){screenshotCount++;return Buffer.from('fixture')}
  })});
  const run=runs.start(start);await waitForRun(runs,run.id);await runs.close();
  assert.equal(runs.read(run.id).nodes[0].status,'timed-out');
  assert.equal(screenshotCount,0);
});

test("shared screens collapse into one preview with alternate navigation paths", async t => {
  const directory=await fixture(t,{}); let shots=0;
  const repeated=graph();
  repeated.nodes=[
    {...repeated.nodes[0],name:'Profile',definition:'src/Profile#Profile',file:'src/Nav.tsx',path:['TabA','Profile']},
    {...repeated.nodes[0],id:'other',name:'Profile',definition:'src/Profile#Profile',file:'src/Nav.tsx',path:['TabB','Profile']},
  ];
  const runs=new AppFlowRuns({directory,scan:async()=>repeated,connect:async()=>({
    runtime:{async invoke(command){
      if(command.type==='inspect')return {available:true};
      if(command.type==='open')return {ready:true,active:['TabA','Profile'],name:'Profile',signature:'profile'};
      return {active:['TabA','Profile'],found:true,signature:'profile'};
    },async close(){}},async screenshot(){shots++;return Buffer.from('same-image')}
  })});
  const run=runs.start(start);await waitForRun(runs,run.id);await runs.close();
  const result=runs.read(run.id);
  assert.equal(shots,1);
  assert.equal(result.nodes.length,1);
  assert.deepEqual(result.nodes[0].paths,[['TabA','Profile'],['TabB','Profile']]);
});

test("Stop cancels connection setup and closes a late connection",async t=>{
  const directory=await fixture(t,{});let closed=false;
  const connecting=Promise.withResolvers<void>(),disconnected=Promise.withResolvers<void>();
  const runs=new AppFlowRuns({directory,scan:async()=>graph(),connect:async()=>{
    connecting.resolve();
    await delay(100);
    return {runtime:{async invoke(){throw Error('Must not navigate after Stop')},async close(){closed=true;disconnected.resolve()}},async screenshot(){throw Error('Must not capture after Stop')}};
  }});
  const run=runs.start(start); await connecting.promise; runs.stop(run.id); await runs.close();
  assert.equal(runs.read(run.id).phase,'stopped');
  await disconnected.promise;assert.equal(closed,true);await runs.close();
});

test("a loading screen at verification is retried and never labelled captured",async t=>{
  const directory=await fixture(t,{});let frame=0;
  const runs=new AppFlowRuns({directory,scan:async()=>graph(),connect:async()=>({
    runtime:{async invoke(command){return command.type==='inspect'?{available:true}:{ready:true,active:['Home'],name:'Home',found:true,loading:command.type==='verify',signature:'same-layout'}},async close(){}},
    async screenshot(){return Buffer.from(String(frame++))}
  })});
  const run=runs.start(start);await waitForRun(runs,run.id);await runs.close();
  assert.equal(runs.read(run.id).nodes[0].status,'timed-out');
  assert.equal(runs.read(run.id).nodes[0].image,undefined);
});


test("capture continues past 30 seconds and reports full elapsed time", async t => {
  const directory = await fixture(t, {});
  const startedAt = Date.now(); let now = startedAt, opens = 0;
  t.mock.method(Date, 'now', () => now);
  const routes = graph();
  routes.nodes[1].required = []; routes.nodes[1].status = 'pending';
  const runs = new AppFlowRuns({directory, scan: async () => routes, connect: async () => ({
    runtime: {async invoke(command) {
      if (command.type === 'inspect') return {available: true};
      if (command.type === 'open') { opens++; now += 31_000; }
      return {ready: true, active: ['screen'], name: 'screen', found: true, signature: 'stable'};
    }, async close() {}},
    async screenshot() { return Buffer.from('stable'); },
  })});
  const run = runs.start(start); await waitForRun(runs, run.id); await runs.close();
  const result = runs.read(run.id);
  assert.equal(result.phase, 'complete');
  assert.equal(opens, 2);
  assert.ok(result.nodes.every(node => node.status === 'captured'));
  assert.equal(result.finishedAt! - result.startedAt, 62_000);
  assert.equal('deadline' in result, false);
});

test('scanner finds URL links, keeps callback ownership, and does not treat stack type names as tabs', async t => {
  const root = await fixture(t, {
    'App.tsx': `const Stack=createNativeStackNavigator<HomeTabParams>();
      function App(){return <Stack.Navigator initialRouteName="Home"><Stack.Screen name="Home" component={Home}/><Stack.Screen name="Settings" component={Settings}/><Stack.Screen name="Account" component={Account}/><Stack.Screen name="TestOnly" component={TestOnly}/></Stack.Navigator>}
      const routes={Settings:'/settings',Account:'/settings/account'};
      function Home(){const open=useCallback(()=>navigation.navigate('Settings'),[]);return <Button onPress={open}/>}
      function Settings(){return <Link to="/settings/account"/>}`,
    'Test.e2e.tsx': `function Home(){return <Button onPress={()=>navigate('TestOnly')}/>}`,
  });
  const result = await scanAppFlow(root,'ios');
  assert.deepEqual(result.nodes.filter(n=>n.kind==='screen'&&n.entry).map(n=>n.name),['Home']);
  const names = new Map(result.nodes.map(n=>[n.id,n.name]));
  assert.ok(result.edges.some(e=>names.get(e.from)==='Home'&&names.get(e.to)==='Settings'&&e.owner==='Home'));
  assert.ok(result.edges.some(e=>names.get(e.from)==='Settings'&&names.get(e.to)==='Account'));
  assert.equal(result.edges.some(e=>e.kind==='navigation'&&names.get(e.to)==='TestOnly'),false);
});

test('failed screens recover and the remaining queue continues; unchanged revisions omit graph copies', async t => {
  const directory=await fixture(t,{}), events:string[]=[];
  const routes=graph(); routes.nodes[1].required=[]; routes.nodes[1].status='pending';
  const runs=new AppFlowRuns({directory,scan:async()=>routes,connect:async()=>({runtime:{async invoke(command){
    events.push(String(command.type));
    if(command.type==='inspect')return {available:true};
    if(command.type==='open'&&(command.path as string[])[0]==='Home')return {ready:false,reason:'Loading'};
    return {ready:true,active:['Profile'],name:'Profile',found:true};
  },async close(){events.push('restore')}},async screenshot(){return Buffer.from('png')}})});
  const first=runs.start(start);await waitForRun(runs,first.id);await runs.close();
  const result=runs.read(first.id);
  assert.equal(result.nodes[0].status,'timed-out');
  assert.equal(result.nodes[1].status,'captured');
  assert.equal(events.filter(e=>e==='recover').length,0);
  assert.equal(result.phase,'partial');
  assert.equal(events.at(-1),'restore');
  assert.equal(runs.readUpdate(first.id,result.revision),undefined);
  assert.equal(runs.readUpdate(first.id,result.revision-1)?.id,first.id);
});

test('a stale native screenshot cannot be assigned to a different rendered screen', async t => {
  const directory=await fixture(t,{}), routes=graph();
  routes.nodes[1].required=[];routes.nodes[1].status='pending';
  let current='Home';
  const runs=new AppFlowRuns({directory,scan:async()=>routes,connect:async()=>({runtime:{async invoke(command){
    if(command.type==='inspect')return {available:true};
    if(command.type==='open')current=(command.path as string[])[0];
    return {ready:true,active:[current],name:current,found:true,signature:current};
  },async close(){}},async screenshot(){return Buffer.from('unchanged-native-frame')}})});
  const first=runs.start(start);await waitForRun(runs,first.id);await runs.close();
  const result=runs.read(first.id);
  assert.equal(result.nodes[0].status,'captured');
  assert.equal(result.nodes[1].status,'timed-out');
  assert.match(result.nodes[1].reason??'',/screenshot did not settle/);
});

test('source links follow barrels, namespaces, lazy components, helpers and lexical bindings', async t => {
  const root = await fixture(t, {
    'src/App.tsx': `import {Home} from './barrel'; import {lazy} from 'react'; const Deferred = lazy(() => import('./Deferred'));
      const urls={Profile:'/people/:id', Followers:'/people/:id/followers', Detail:'/item/:id', Activity:'/activity', Inbox:'/chat/inbox', Chat:'/chat/:id', ExternalOnly:'/short/:id'};
      function App(){return <Stack.Navigator><Stack.Screen name="Home" component={Home}/><Stack.Screen name="Profile"/><Stack.Screen name="Followers"/><Stack.Screen name="Detail"/><Stack.Screen name="Activity"/><Stack.Screen name="Deferred" component={Deferred}/><Stack.Screen name="Inbox"/><Stack.Screen name="Chat"/><Stack.Screen name="ExternalOnly"/></Stack.Navigator>}`,
    'src/barrel.ts': `export {Main as Home} from './Home';`,
    'src/Home/index.tsx': `export function Main(){return <Link to="/wrong-platform"/>}`,
    'src/Home/index.ios.tsx': `import * as Controls from '../Controls'; import {personPath} from '../paths';
      export function Main(){const href=useMemo(()=>personPath(person.id,'followers'),[person]);return <><Controls.More/><Link to={href}/><Link to={locked ? '#' : {screen:'Detail',params:{id:item.id}}}/><Link to={\`/activity?posts=\${posts}\`}/><Link to="/chat/inbox"/><Button onPress={()=>navigation.navigate('Deferred')}/></>}
      function Unused(){const href='/never';return <Link to={href}/>}`,
    'src/Controls.tsx': `import {normalize} from './paths'; export function More(){return <><Link to={\`/people/\${account.id}\`}/><Link to={normalize(externalUrl)}/></>} `,
    'src/paths.ts': `export function personPath(id:string,...parts:string[]){return ['/people',id,...parts].join('/')} export function normalize(url){if(isShort(url)){return \`/short/\${key}\`}return url}`,
    'src/Deferred.tsx': `export default function Deferred(){return <Button onPress={()=>navigation.navigate('Activity')}/>}`,
  });
  const graph = await scanAppFlow(root,'ios');
  const names = new Map(graph.nodes.map(node=>[node.id,node.name]));
  const outgoing = (name:string) => new Set(graph.edges.filter(edge=>edge.kind==='navigation'&&names.get(edge.from)===name).map(edge=>names.get(edge.to)));
  assert.deepEqual(outgoing('Home'),new Set(['Profile','Followers','Detail','Activity','Inbox','Deferred']));
  assert.deepEqual(outgoing('Deferred'),new Set(['Activity']));
  assert.match(graph.nodes.find(node=>node.name==='Home')!.definition!,/index.ios.tsx#Main$/);
  assert.ok(graph.edges.filter(edge=>edge.kind==='navigation').every(edge=>edge.file&&edge.line));
  assert.equal(graph.nodes.find(node=>node.name==='Followers')!.params,undefined,'symbolic path segments must never become capture data');
});

test('parameter unions keep alternatives and path params prevent empty edit previews', async t => {
  const root=await fixture(t,{'App.tsx': `
    type Context = {kind:'feed';uri:string;source:string} | {kind:'author';did:string};
    type RouteParams = {Home:undefined;Video:Context;Edit:{id?:string}};
    const paths={Edit:'/edit/:id'};
    function App(){return <Stack.Navigator><Stack.Screen name="Home"/><Stack.Screen name="Video"/><Stack.Screen name="Edit"/></Stack.Navigator>}`});
  const graph=await scanAppFlow(root,'ios');
  const video=graph.nodes.find(node=>node.name==='Video')!;
  const {missingFlowParams}=await import('../src/shared/app-flow.ts');
  assert.deepEqual(missingFlowParams({...video,params:{kind:'author',did:'actual-did'}}),[]);
  assert.deepEqual(missingFlowParams({...video,params:{kind:'feed',uri:'actual-uri'}}),['source']);
  assert.deepEqual(missingFlowParams({...video,params:{kind:'other',did:'actual-did'}}),['$variant']);
  assert.deepEqual(graph.nodes.find(node=>node.name==='Edit')!.required,['id']);
  assert.equal(graph.nodes.find(node=>node.name==='Edit')!.status,'needs-data');
});

test('equivalent navigation branches are usable but a one-sided guard stays conditional',async t=>{
  const root=await fixture(t,{'App.tsx':`function Home(){return <><Button onPress={()=>{if(mode){navigation.navigate('Preferences')}else{navigation.push('Preferences')}}}/><Button onPress={()=>{if(admin){navigation.navigate('Admin')}}}/></>}
    function App(){return <Stack.Navigator><Stack.Screen name="Home" component={Home}/><Stack.Screen name="Preferences"/><Stack.Screen name="Admin"/></Stack.Navigator>}`});
  const graph=await scanAppFlow(root,'ios'), names=new Map(graph.nodes.map(n=>[n.id,n.name]));
  assert.equal(graph.edges.find(e=>e.kind==='navigation'&&names.get(e.to)==='Preferences')!.guarded,false);
  assert.equal(graph.edges.find(e=>e.kind==='navigation'&&names.get(e.to)==='Admin')!.guarded,true);
});

test('unchanged source reuses the catalog without sharing mutable results',async t=>{
  const root=await fixture(t,{'App.tsx':'function App(){return <Stack.Navigator><Stack.Screen name="Home" component={Home}/></Stack.Navigator>}'});
  const first=await scanAppFlow(root,'ios');
  const expected=structuredClone(first);first.nodes[0].name='caller mutation';first.warnings.push('caller warning');
  const second=await scanAppFlow(root,'ios');
  assert.equal(second.catalogMs,0);
  assert.deepEqual({...second,scanMs:0,catalogMs:0},{...expected,scanMs:0,catalogMs:0});
  second.nodes.length=0;
  assert.ok((await scanAppFlow(root,'ios')).nodes.length>0);
});

test('cached scans read current contents, additions, removals, aliases and platform',async t=>{
  const root=await fixture(t,{'App.tsx':'function App(){return <S.Navigator><S.Screen name="First" component={Home}/></S.Navigator>}'});
  const first=await scanAppFlow(root,'ios');
  const {stat,utimes}=await import('node:fs/promises');const path=join(root,'App.tsx'),originalStat=await stat(path);
  await writeFile(path,'function App(){return <S.Navigator><S.Screen name="Other" component={Home}/></S.Navigator>}');
  await utimes(path,originalStat.atime,originalStat.mtime);
  assert.ok((await scanAppFlow(root,'ios')).nodes.some(n=>n.name==='Other'));
  await mkdir(join(root,'app'));await writeFile(join(root,'app','_layout.tsx'),'export default function Layout(){return <Stack/>}');await writeFile(join(root,'app','extra.tsx'),'export default function Extra(){return null}');
  assert.ok((await scanAppFlow(root,'ios')).nodes.some(n=>n.name==='/extra'));
  await rm(join(root,'app','extra.tsx'));
  assert.ok(!(await scanAppFlow(root,'ios')).nodes.some(n=>n.name==='/extra'));
  await writeFile(join(root,'tsconfig.json'),'{"compilerOptions":{"paths":{"custom/*":["src/*"]}}}');
  assert.notEqual((await scanAppFlow(root,'ios')).catalogMs,0,'Alias edits invalidate source reuse');
  assert.notEqual((await scanAppFlow(root,'android')).sourceHash,first.sourceHash);
  const stopped=new AbortController();stopped.abort();await assert.rejects(scanAppFlow(root,'android',stopped.signal));
});


test("capture starts at the mounted route and still captures every other entry", async t => {
  const directory=await fixture(t,{}),opened:string[]=[];
  const routes:FlowGraph={files:1,scanMs:1,warnings:[],edges:[],nodes:['Home','Account','Search'].map(name=>({id:name,name,kind:'screen',path:[name],entry:true,required:[],status:'pending'}))};
  let current='Account';
  const runs=new AppFlowRuns({directory,scan:async()=>routes,connect:async()=>({
    runtime:{async invoke(command){
      if(command.type==='inspect')return {available:true,active:['Account'],entries:[['Home'],['Search']]};
      if(command.type==='open'){current=(command.path as string[])[0];opened.push(current);}
      return {ready:true,found:true,active:[current],name:current,signature:current};
    },async close(){}},async screenshot(){return Buffer.from(current);}
  })});
  const run=runs.start(start);await waitForRun(runs,run.id);await runs.close();
  assert.deepEqual(opened,['Account','Home','Search']);
  assert.ok(runs.read(run.id).nodes.every(node=>node.status==='captured'));
});
