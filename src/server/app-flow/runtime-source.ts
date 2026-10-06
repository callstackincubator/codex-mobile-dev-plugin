import {readFile} from 'node:fs/promises';
import {installFlowRuntime} from './runtime.js';
import {installPresentationRuntime} from './presentations-runtime.js';
import {createCaptureQueue} from './capture-queue.js';
import {createCaptureDriver} from './capture-driver.js';
import {createTransitionMode} from './transitions-runtime.js';

/** Read per connection so a development runtime rebuild needs no host restart. */
export async function flowRuntimeSource() {
  if (!import.meta.url.endsWith('/server.mjs')) return [installFlowRuntime, installPresentationRuntime, createCaptureQueue, createCaptureDriver, createTransitionMode].map(fn => fn.toString());
  const value = JSON.parse(await readFile(new URL('./app-flow/runtime.json',import.meta.url),'utf8'));
  if (value.version !== 1 || !Array.isArray(value.functions) || value.functions.length !== 5 || value.functions.some((text:unknown) => typeof text !== 'string' || text.length > 500_000)) throw new Error('The packaged capture runtime is invalid. Rebuild the plugin.');
  return value.functions as string[];
}
