import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { findMetroServers, discoverFlowSetup, listeningNodePorts, type MetroServer } from '../src/server/app-flow/discovery.ts';
import { metroTargets } from '../src/server/metro-logs.ts';

const target = {id:'app', title:'React Native', deviceId:'device', deviceName:'iPhone', appId:'example.app', supportsMultipleDebuggers:true};
async function project(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flow-discovery-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  return realpath(root);
}
test('listener discovery accepts Node runtimes on arbitrary ports and deduplicates IPv4/IPv6', () => {
  const ports = listeningNodePorts('p12\ncnode\nn*:9191\nn[::1]:9191\np13\ncpostgres\nn127.0.0.1:5432\np14\ncbun\nn127.0.0.1:8083\n');
  assert.deepEqual([...ports], [[9191,'12'], [8083,'14']]);
});
test('selected project chooses its Metro and foreground app on the selected device', async t => {
  const root = await project(t);
  const servers: MetroServer[] = [
    {url:'http://127.0.0.1:8081',projectRoot:'/other',targets:[target]},
    {url:'http://127.0.0.1:9191',projectRoot:root,targets:[target,{...target,id:'another',deviceId:'other',deviceName:'Android'}]},
  ];
  const result = await discoverFlowSetup({deviceId:'device',appId:'example.app'}, [{uri:pathToFileURL(root).href}], async()=>servers);
  assert.equal(result.projectRoot,root);
  assert.equal(result.metroUrl,servers[1].url);
  assert.equal(result.targetId,'app');
  assert.equal(result.message,'');
});
test('a Metro app inside a monorepo matches the selected project', async t => {
  const root = await project(t), app = join(root,'app'); await mkdir(app);
  const result = await discoverFlowSetup({}, [{uri:pathToFileURL(root).href}], async()=>[{url:'http://127.0.0.1:8082',projectRoot:app,targets:[]}]);
  assert.equal(result.metroUrl,'http://127.0.0.1:8082');
  assert.match(result.message,/no app is connected/);
});
test('without a host project a single Metro supplies its folder; ambiguous servers stay unselected', async () => {
  const server = {url:'http://127.0.0.1:8083',projectRoot:'/app',targets:[target]};
  const single = await discoverFlowSetup({deviceName:'iPhone'}, [], async()=>[server]);
  assert.equal(single.projectRoot,'/app'); assert.equal(single.targetId,'app');
  const multiple = await discoverFlowSetup({}, [], async()=>[server,{...server,url:'http://127.0.0.1:8084'}]);
  assert.equal(multiple.metroUrl,undefined); assert.equal(multiple.projectRoot,undefined);
  assert.match(multiple.message,/More than one/);
});
test('missing Metro gives setup guidance, preserves the project, and does not pick an unrelated server', async t => {
  const root = await project(t);
  const missing = await discoverFlowSetup({projectRoot:root}, [], async()=>[]);
  assert.equal(missing.projectRoot,root); assert.match(missing.message,/Start Metro/);
  const other = await discoverFlowSetup({projectRoot:root}, [], async()=>[{url:'http://127.0.0.1:8081',projectRoot:'/other',targets:[target]}]);
  assert.equal(other.metroUrl,undefined); assert.match(other.message,/No Metro server matches/);
});
test('explicit server choice wins and multiple device targets require a choice', async () => {
  const server = {url:'http://127.0.0.1:9191',projectRoot:'/app',targets:[target,{...target,id:'app2',appId:'other.app'}]};
  const result = await discoverFlowSetup({metroUrl:server.url,deviceId:'device'}, [], async()=>[server]);
  assert.equal(result.metroUrl,server.url); assert.equal(result.targetId,undefined);
  const chosen = await discoverFlowSetup({metroUrl:server.url,deviceId:'device',appId:'example.app'}, [], async()=>[server]);
  assert.equal(chosen.targetId,'app');
});
test('unreachable Metro reports its origin and a fix instead of fetch failed', async t => {
  t.mock.method(globalThis, 'fetch', async()=>{throw new TypeError('fetch failed')});
  await assert.rejects(metroTargets('http://127.0.0.1:9191'), /Cannot reach Metro at http:\/\/127.0.0.1:9191.*Start Metro/);
});


test('live discovery finds Metro on a non-default port and reads its process folder', async t => {
  const server = createServer((request, response) => {
    if (request.url === '/status') response.end('packager-status:running');
    else response.end(JSON.stringify([{...target, webSocketDebuggerUrl:`ws://127.0.0.1:${port}/inspector`, reactNative:{logicalDeviceId:'device',capabilities:{supportsMultipleDebuggers:true}}}]));
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close()});
  const port = (server.address() as {port:number}).port;
  const servers = await findMetroServers();
  const found = servers.find(item=>item.url===`http://127.0.0.1:${port}`);
  assert.ok(found); assert.equal(found.projectRoot,await realpath(process.cwd()));
  assert.equal(found.targets[0].id,'app');
  assert.equal('webSocketDebuggerUrl' in found.targets[0],false);
});

test('device match selects the right Metro when several serve the same project', async t => {
  const root = await project(t);
  const result = await discoverFlowSetup({deviceId:'device'}, [{uri:pathToFileURL(root).href}], async()=>[
    {url:'http://127.0.0.1:8081',projectRoot:root,targets:[{...target,deviceId:'other'}]},
    {url:'http://127.0.0.1:8082',projectRoot:root,targets:[target]},
  ]);
  assert.equal(result.metroUrl,'http://127.0.0.1:8082'); assert.equal(result.targetId,'app');
});
