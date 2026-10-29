import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pluginHost, pluginRelease } from './plugin-hosts.mjs';
import { call, tempPlugin, withServer } from './lib/mcp-smoke.mjs';

const source = process.argv[2] ?? pluginRelease(pluginHost('codex')).plugin;
const { temporary: directory, plugin, remove } = await tempPlugin(source, { prefix: 'mobile-dev-packaged-cache-regression-', folder: 'plugin-old-version' });
try {
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
  await withServer({ args: ['./dist/server.mjs'], cwd: plugin, env: { ...process.env, ANDROID_HOME: sdk }, name: 'packaged-cache-regression' }, async client => {
    const target = { platform: 'android', deviceId: 'emulator-cache-test', bundleId: 'com.example.app' };
    const read = async id => {
      let after = 0;
      for (let attempt = 0; attempt < 100; attempt++) {
        const batch = (await call(client, 'mobile_read_cpu', { sessionId: id, after })).structuredContent;
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
    const first = await call(client, 'mobile_cpu_session', { target });
    const firstUsage = await read(first.structuredContent.sessionId);
    assert.equal(firstUsage, 50);
    await client.callTool({ name: 'mobile_cpu_close', arguments: { sessionId: first.structuredContent.sessionId } });
    await rm(plugin, { recursive: true, force: true });
    const second = await call(client, 'mobile_cpu_session', { target });
    const secondUsage = await read(second.structuredContent.sessionId);
    assert.equal(secondUsage, 50);
    await client.callTool({ name: 'mobile_cpu_close', arguments: { sessionId: second.structuredContent.sessionId } });
    const uploadText = await readFile(uploads, 'utf8');
    const trimmedUploads = uploadText.trim();
    const uploadLines = trimmedUploads.split('\n');
    assert.equal(uploadLines.length, 2);
    console.log('Packaged MCP server reconnected Android CPU and returned 50% before and after deletion of its entire plugin directory. Only fake ADB was used.');
  });
} finally {
  await remove();
}
