import test from 'node:test';
import assert from 'node:assert/strict';
import {readFlowScreenshot} from '../src/server/app-flow/screenshot.ts';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const disconnected = (code = 'ECONNREFUSED') => new TypeError('fetch failed', {cause: Object.assign(new Error('closed'), {code})});

test('a disconnected screenshot backend resumes the same capture at its new address', async () => {
  let port = 12001, recoveries = 0;
  const seen: string[] = [], controller = new AbortController();
  const bytes = await readFlowScreenshot({
    url: () => new URL(`http://127.0.0.1:${port}/simulators/fixture/screenshot.png?scale=3`), signal: controller.signal,
    async recover() { recoveries++; port = 12002; },
    request: (async (url, options) => {
      seen.push(String(url)); assert.equal(options?.signal, controller.signal);
      assert.equal(options?.redirect, 'error');
      if (seen.length === 1) throw disconnected();
      return new Response(png);
    }) as typeof fetch,
  });
  assert.deepEqual(bytes, png); assert.equal(recoveries, 1);
  assert.deepEqual(seen, ['http://127.0.0.1:12001/simulators/fixture/screenshot.png?scale=3', 'http://127.0.0.1:12002/simulators/fixture/screenshot.png?scale=3']);
});

test('capture cancellation does not wait for shared backend recovery or take another frame', async () => {
  const controller = new AbortController(); let requests = 0, release!: () => void;
  const reading = readFlowScreenshot({url: () => new URL('http://127.0.0.1:12001/frame'), signal: controller.signal,
    request: (async () => {requests++; throw disconnected('UND_ERR_SOCKET');}) as typeof fetch,
    recover: () => new Promise<void>(resolve => {release = resolve; controller.abort(new DOMException('expired', 'TimeoutError'));}),
  });
  await assert.rejects(reading, {name: 'TimeoutError'}); release();
  assert.equal(requests, 1);
});

test('repeated disconnections are bounded to one recovery', async () => {
  let recoveries = 0, requests = 0;
  await assert.rejects(readFlowScreenshot({url: () => new URL('http://127.0.0.1:12001/frame'), signal: new AbortController().signal,
    async recover() {recoveries++;}, request: (async () => {requests++; throw disconnected();}) as typeof fetch,
  }), {message: 'fetch failed'});
  assert.equal(recoveries, 1); assert.equal(requests, 2);
});

for (const [label, response] of [['HTTP error', new Response('unavailable', {status: 503})], ['invalid frame', new Response('not a PNG')]] as const) {
  test(`${label} does not restart a connected screenshot backend`, async () => {
    let recoveries = 0;
    await assert.rejects(readFlowScreenshot({url: () => new URL('http://127.0.0.1:12001/frame'), signal: new AbortController().signal,
      async recover() {recoveries++;}, request: (async () => response) as typeof fetch,
    })); assert.equal(recoveries, 0);
  });
}

test('an ordinary native frame does not probe or restart the backend', async () => {
  let recoveries = 0;
  const bytes = await readFlowScreenshot({url: () => new URL('http://127.0.0.1:12001/frame'), signal: new AbortController().signal,
    async recover() {recoveries++;}, request: (async () => new Response(png)) as typeof fetch,
  }); assert.deepEqual(bytes, png); assert.equal(recoveries, 0);
});
