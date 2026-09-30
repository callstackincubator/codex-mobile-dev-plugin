import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const temporaryBase = tmpdir();
const prefix = join(temporaryBase, 'mobile-dev-packaged-cache-regression-');
const directory = await mkdtemp(prefix);
let client;
let transport;
let diagnostics = '';
try {
  const source = resolve(process.argv[2] ?? 'release/marketplace/plugins/mobile-dev');
  const plugin = join(directory, 'plugin-old-version');
  await cp(source, plugin, { recursive: true, verbatimSymlinks: true });
  const sdk = join(directory, 'sdk');
  const platformTools = join(sdk, 'platform-tools');
  await mkdir(platformTools, { recursive: true });
  const adb = join(platformTools, 'adb');
  const uploads = join(directory, 'uploads.txt');
  const header = { type: 'ready', pid: 123, collectorPid: 999, clockTicks: 100, processStart: '42' };
  const samples = [
    { type: 'sample', timestampUs: '1000000', processTicks: '100', processStart: '42', collectorCpuUs: '10', memoryBytes: 104857600, threads: [{ tid: 123, start: '50', ticks: '100', name: 'main' }] },
    { type: 'sample', timestampUs: '2000000', processTicks: '150', processStart: '42', collectorCpuUs: '20', memoryBytes: 104857600, threads: [{ tid: 123, start: '50', ticks: '150', name: 'main' }] },
  ];
  const records = [header, ...samples];
  const payload = records.map(record => JSON.stringify(record));
  const text = payload.join('\n') + '\n';
  const script = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'devices') process.stdout.write('List of devices attached\\nemulator-cache-test device model:Fake_Test\\n');
else if (args[2] === 'push') {
  const bytes = fs.readFileSync(args[3]);
  if (bytes.length === 0) throw new Error('Empty staged collector');
  fs.appendFileSync(${JSON.stringify(uploads)}, args[3] + '\\n');
} else if (args[3] === 'pm') process.stdout.write('package:com.example.app\\n');
else if (args[3] === 'ps') process.stdout.write('PID NAME\\n123 com.example.app\\n');
else if (args[3] === 'getprop') process.stdout.write('arm64-v8a\\n');
else if (args[3] === '-T') {
  process.stdout.write(${JSON.stringify(text)});
  process.stdin.on('data', () => process.exit(0));
  process.stdin.on('end', () => process.exit(0));
}
`;
  await writeFile(adb, script, { mode: 0o700 });
  transport = new StdioClientTransport({ command: process.execPath, args: ['./dist/server.mjs'], cwd: plugin,
    stderr: 'pipe', env: { ...process.env, ANDROID_HOME: sdk } });
  transport.stderr.on('data', chunk => { diagnostics += chunk.toString(); });
  client = new Client({ name: 'packaged-cache-regression', version: '1' });
  await client.connect(transport);
  const target = { platform: 'android', deviceId: 'emulator-cache-test', bundleId: 'com.example.app' };
  const read = async id => {
    let after = 0;
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await client.callTool({ name: 'mobile_read_cpu', arguments: { sessionId: id, after } });
      const details = JSON.stringify(result.content);
      assert.notEqual(result.isError, true, details);
      const batch = result.structuredContent;
      assert.ok(batch);
      assert.notEqual(batch.phase, 'failed', batch.error);
      assert.equal(batch.memoryMetric, 'rss');
      const measured = batch.samples.find(sample => sample.cpuPercent !== null);
      if (measured) {
        assert.equal(measured.memoryBytes, 104857600);
        return measured.cpuPercent;
      }
      after = batch.cursor;
      await delay(50);
    }
    throw new Error('The packaged CPU session did not report usage.');
  };
  const first = await client.callTool({ name: 'mobile_cpu_session', arguments: { target } });
  const firstDetails = JSON.stringify(first.content);
  assert.notEqual(first.isError, true, firstDetails);
  const firstUsage = await read(first.structuredContent.sessionId);
  assert.equal(firstUsage, 50);
  await client.callTool({ name: 'mobile_cpu_close', arguments: { sessionId: first.structuredContent.sessionId } });
  await rm(plugin, { recursive: true, force: true });
  const second = await client.callTool({ name: 'mobile_cpu_session', arguments: { target } });
  const secondDetails = JSON.stringify(second.content);
  assert.notEqual(second.isError, true, secondDetails);
  const secondUsage = await read(second.structuredContent.sessionId);
  assert.equal(secondUsage, 50);
  await client.callTool({ name: 'mobile_cpu_close', arguments: { sessionId: second.structuredContent.sessionId } });
  const uploadText = await readFile(uploads, 'utf8');
  const trimmedUploads = uploadText.trim();
  const uploadLines = trimmedUploads.split('\n');
  assert.equal(uploadLines.length, 2);
  console.log('Packaged MCP server reconnected Android CPU and returned 50% before and after deletion of its entire plugin directory. Only fake ADB was used.');
} catch (error) {
  console.error(diagnostics);
  throw error;
} finally {
  await client?.close();
  await transport?.close();
  await rm(directory, { recursive: true, force: true });
}
