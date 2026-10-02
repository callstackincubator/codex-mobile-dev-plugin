import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { scanAppFlow } from "../src/server/app-flow/scan.ts";
import { AppFlowRuns, type FlowStart, type FlowDependencies } from "../src/server/app-flow/runs.ts";
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
  for (let i=0;i<200 && flowRunning(runs.read(id));i++) await delay(10);
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
  assert.deepEqual(events,['inspect','open','screenshot','screenshot','verify','restore']);
  assert.equal((await runs.image(run.id,'first')).toString(),'fixture');
});

test("Stop aborts capture and late AI params are reused on the next run", async t => {
  const directory = await fixture(t, {});
  let closes=0;
  const runs = new AppFlowRuns({ directory, scan:async()=>graph(), connect:async()=>({
    runtime:{ async invoke(command){ if(command.type==='inspect') return {available:true}; return {ready:true,active:['Home'],name:'Home',signature:'home'}; }, async close(){closes++} },
    async screenshot(signal){ await delay(1000,undefined,{signal}); return Buffer.from('fixture'); },
  }) });
  const run=runs.start(start);
  await assert.rejects(async()=>runs.start(start),/already running/);
  await delay(20); runs.stop(run.id); await runs.close();
  const result=runs.read(run.id);
  assert.equal(result.phase,'stopped');
  assert.equal(result.nodes[0].status,'timed-out');
  runs.resolve(run.id,[{nodeId:'second',params:{id:'real'}}]);
  const next=runs.start(start);
  await delay(20);
  assert.equal(runs.read(next.id).nodes[1].params?.id,'real');
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
  assert.equal(screenshotCount,4);
});

test("shared screens reuse a labelled preview and keep every navigator occurrence", async t => {
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
  assert.equal(shots,2);
  assert.equal(result.nodes.length,2);
  assert.equal(result.nodes[1].sharedFrom,'first');
  assert.equal(result.nodes[1].image,result.nodes[0].image);
  assert.match(result.nodes[1].reason??'',/not captured separately/);
});

test("Stop cancels connection setup and closes a late connection",async t=>{
  const directory=await fixture(t,{});let closed=false;
  const runs=new AppFlowRuns({directory,scan:async()=>graph(),connect:async()=>{
    await delay(100);
    return {runtime:{async invoke(){throw Error('Must not navigate after Stop')},async close(){closed=true}},async screenshot(){throw Error('Must not capture after Stop')}};
  }});
  const run=runs.start(start); await delay(10); runs.stop(run.id); await runs.close();
  assert.equal(runs.read(run.id).phase,'stopped');
  await delay(110);assert.equal(closed,true);await runs.close();
});

test("changing native pixels time out instead of producing a transition screenshot",async t=>{
  const directory=await fixture(t,{});let frame=0;
  const runs=new AppFlowRuns({directory,scan:async()=>graph(),connect:async()=>({
    runtime:{async invoke(command){return command.type==='inspect'?{available:true}:{ready:true,active:['Home'],name:'Home',signature:'same-layout'}},async close(){}},
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
