import {QueuedAppFlowRuns as AppFlowRuns} from './app-flow-queue-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {SimulatorAnimations} from '../src/server/app-flow/animation-speed.ts';
import {type FlowStart} from '../src/server/app-flow/runs.ts';
import {flowRunning, type FlowGraph} from '../src/shared/app-flow.ts';

async function directory(t: test.TestContext) { const path = await mkdtemp(join(tmpdir(), 'flow-animations-')); t.after(() => rm(path, {recursive: true, force: true})); return path; }

/** A simulator whose notification state and processes follow the library's protocol. */
function simulator(options: {loads?: boolean} = {}) {
  const calls: {args: string[]; env?: NodeJS.ProcessEnv}[] = [], state = new Map<string, string>();
  let pid = 100;
  const execute = async (file: string, args: string[], call: {env?: NodeJS.ProcessEnv}) => {
    assert.equal(file, 'xcrun');
    calls.push({args, env: call.env});
    const [, command] = args;
    if (command === 'launch') {
      pid++;
      // The library records its process under the bundle identifier, unless it could not load.
      if (call.env?.SIMCTL_CHILD_DYLD_INSERT_LIBRARIES && options.loads !== false) state.set(`dev.mobile-dev.app-flow.animation-library.${args[3]}`, String(pid));
      else state.delete(`dev.mobile-dev.app-flow.animation-library.${args[3]}`);
      return {stdout: `${args[3]}: ${pid}\n`};
    }
    if (command === 'terminate') { state.delete(`dev.mobile-dev.app-flow.animation-library.${args[3]}`); return {stdout: ''}; }
    if (command === 'spawn' && args[3] === 'launchctl') return {stdout: `PID\tStatus\tLabel\n${pid}\t0\tUIKitApplication:example.app[1a2b][rb-legacy]\n7\t0\tcom.apple.other\n`};
    if (command === 'spawn' && args[3] === 'notifyutil' && args[4] === '-g') return {stdout: `${args[5]} ${state.get(args[5]) ?? 0}\n`};
    if (command === 'spawn' && args[3] === 'notifyutil' && args[4] === '-s') { state.set(args[5], args[6]); return {stdout: ''}; }
    throw new Error(`Unexpected ${args.join(' ')}`);
  };
  return {calls, state, execute, pid: () => pid};
}

test('the animation library loads from a copy outside protected folders and confirms the launched process', async t => {
  const path = await directory(t), source = join(path, 'MobileDevAnimationSpeed.dylib');
  await writeFile(source, 'library bytes');
  const device = simulator(), animations = new SimulatorAnimations(join(path, 'app-flow'), device.execute as any, source);
  const signal = new AbortController().signal;
  assert.equal(await animations.loaded('device', 'example.app', signal), false, 'A normally launched app has no library');
  assert.equal(await animations.launch('device', 'example.app', signal), true);
  const launch = device.calls.find(call => call.args[1] === 'launch')!;
  assert.match(launch.env!.SIMCTL_CHILD_DYLD_INSERT_LIBRARIES!, /app-flow\/native\/MobileDevAnimationSpeed-[0-9a-f]{16}\.dylib$/);
  assert.equal(launch.env!.SIMCTL_CHILD_MOBILE_DEV_ANIMATION_SPEED, '10');
  assert.equal((await readdir(join(path, 'app-flow', 'native'))).length, 1);
  assert.equal(await animations.loaded('device', 'example.app', signal), true);
  // A relaunch without the library leaves no stale process record behind.
  device.state.delete('dev.mobile-dev.app-flow.animation-library.example.app');
  assert.equal(await animations.loaded('device', 'example.app', signal), false);
  await animations.speed('device', 1);
  assert.deepEqual(device.calls.at(-1)!.args, ['simctl', 'spawn', 'device', 'notifyutil', '-s', 'dev.mobile-dev.app-flow.animation-speed', '100', '-p', 'dev.mobile-dev.app-flow.animation-speed']);
});

test('an app that does not confirm the library is terminated so the caller launches it normally', async t => {
  const path = await directory(t), source = join(path, 'MobileDevAnimationSpeed.dylib');
  await writeFile(source, 'library bytes');
  const device = simulator({loads: false}), animations = new SimulatorAnimations(join(path, 'app-flow'), device.execute as any, source);
  assert.equal(await animations.launch('device', 'example.app', new AbortController().signal), false);
  assert.deepEqual(device.calls.map(call => call.args[1]).filter(command => command !== 'spawn'), ['launch', 'terminate']);
  const missing = new SimulatorAnimations(join(path, 'other'), device.execute as any, join(path, 'absent.dylib'));
  device.calls.length = 0;
  assert.equal(await missing.launch('device', 'example.app', new AbortController().signal), false);
  assert.deepEqual(device.calls, [], 'Without a library the launch is left to the caller');
});

const input: FlowStart = {projectRoot: '/fixture', platform: 'ios', deviceId: 'device', targetId: 'target', metroUrl: 'http://127.0.0.1:8081', useAi: false};
const graph = (): FlowGraph => ({files: 1, scanMs: 1, warnings: [], edges: [], sourceHash: 'source', nodes: ['Home', 'Profile'].map(name => ({id: name, name, kind: 'screen', path: [name], required: [], status: 'pending'}))});

function flow(path: string, loaded: boolean, slowProfile = false) {
  const events: string[] = [];
  let library = loaded, profileOpens = 0;
  const runs = new AppFlowRuns({directory: path, scan: async () => graph(),
    relaunch: async () => { events.push('relaunch'); library = true; },
    animations: {loaded: async () => library, speed: async (_input, speed) => { events.push(`speed ${speed}`); }},
    connect: async () => {
      let screen = 'Home';
      return {target: {appId: 'example.app', deviceId: 'device'}, runtime: {async invoke(command) {
        if (command.type === 'inspect' || command.type === 'resume') return {available: true};
        if (command.type === 'capture-inventory') return {sourceHashes: ['source']};
        if (command.type === 'recover' || command.type === 'heartbeat') return {alive: true, recovered: true};
        if (command.type === 'open') {
          screen = (command.path as string[])[0]; events.push(`open ${screen}`);
          if (slowProfile && screen === 'Profile' && profileOpens++ === 0) return {ready: false, reason: 'Screen is still loading (skeleton).', active: [screen]};
          return {ready: true, active: [screen], name: screen, signature: screen};
        }
        return {found: true, active: [screen]};
      }, async close() {}}, async screenshot() { return Buffer.from(screen); }};
    }});
  return {runs, events};
}

test('a full run starts from a fresh launch with the animation library, outside the recovery budget, and restores normal speed', async t => {
  const {runs, events} = flow(await directory(t), false);
  const run = runs.start(input);
  for (let wait = 0; wait < 500 && flowRunning(runs.read(run.id)); wait++) await delay(10);
  await runs.close();
  const result = runs.read(run.id);
  assert.equal(result.phase, 'complete');
  assert.deepEqual(events.slice(0, 2), ['relaunch', 'open Home'], 'The library loads before capture');
  assert.equal(events.filter(event => event === 'relaunch').length, 1);
  assert.equal(events.at(-1), 'speed 1');
  assert.equal(result.fastAnimations, true);
  assert.deepEqual(result.relaunchLog?.map(item => item.cause), ['start']);
  assert.equal(result.warnings.some(warning => /relaunched to recover/.test(warning)), false);
});

test('a run on an app that already has the library sets its speed without a relaunch', async t => {
  const {runs, events} = flow(await directory(t), true);
  // A catalog selection of chosen views keeps the running app.
  const run = runs.start({...input, capture: {include: ['Home', 'Profile']}} as any);
  for (let wait = 0; wait < 500 && flowRunning(runs.read(run.id)); wait++) await delay(10);
  await runs.close();
  assert.deepEqual(events.filter(event => !event.startsWith('open')), ['speed 10', 'speed 1']);
  assert.deepEqual(events.filter(event => event.startsWith('open')), ['open Home', 'open Profile']);
  assert.equal(runs.read(run.id).phase, 'complete');
  assert.equal(runs.read(run.id).fastAnimations, true);
});

test('a retry runs at normal speed and later views run fast again', async t => {
  const {runs, events} = flow(await directory(t), false, true);
  const run = runs.start(input);
  for (let wait = 0; wait < 500 && flowRunning(runs.read(run.id)); wait++) await delay(10);
  await runs.close();
  const result = runs.read(run.id);
  assert.equal(result.nodes.find(node => node.name === 'Profile')?.status, 'captured');
  assert.deepEqual(events, ['relaunch', 'open Home', 'open Profile', 'speed 1', 'open Profile', 'speed 1']);
});

test('a view revealed by a retry runs fast again', async t => {
  const events: string[] = [];
  let profileOpens = 0;
  const nodes = ['Home', 'Profile', 'Settings'].map((name, index) => ({id: name, name, kind: 'screen' as const, path: [name], required: [], status: 'pending' as const, entry: index === 0}));
  const links: Record<string, string[]> = {Home: ['Profile'], Profile: ['Settings'], Settings: []};
  const runs = new AppFlowRuns({directory: await directory(t), scan: async () => ({files: 1, scanMs: 1, warnings: [], edges: [], nodes}),
    relaunch: async () => { events.push('relaunch'); },
    animations: {loaded: async () => true, speed: async (_input, speed) => { events.push(`speed ${speed}`); }},
    connect: async () => {
      let screen = 'Home';
      return {target: {appId: 'example.app', deviceId: 'device'}, runtime: {async invoke(command) {
        if (command.type === 'inspect' || command.type === 'resume') return {available: true, active: ['Home'], entries: [['Home']]};
        if (command.type === 'recover' || command.type === 'heartbeat') return {alive: true, recovered: true};
        if (command.type === 'open') {
          screen = (command.path as string[])[0]; events.push(`open ${screen}`);
          if (screen === 'Profile' && profileOpens++ === 0) return {ready: false, reason: 'Screen is still loading (skeleton).', active: [screen]};
          return {ready: true, active: [screen], name: screen, signature: screen, links: links[screen]};
        }
        return {found: true, active: [screen], links: links[screen]};
      }, async close() {}}, async screenshot() { return Buffer.from(screen); }};
    }});
  const run = runs.start(input);
  for (let wait = 0; wait < 500 && flowRunning(runs.read(run.id)); wait++) await delay(10);
  await runs.close();
  assert.deepEqual(runs.read(run.id).nodes.map(node => [node.name, node.status]), [['Home', 'captured'], ['Profile', 'captured'], ['Settings', 'captured']]);
  assert.deepEqual(events, ['relaunch', 'open Home', 'open Profile', 'speed 1', 'open Profile', 'speed 10', 'open Settings', 'speed 1']);
});
