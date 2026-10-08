import test from 'node:test';
import assert from 'node:assert/strict';
import {CapturePlanner, retryableCapture} from '../src/server/app-flow/capture-planner.ts';
import type {FlowNode} from '../src/shared/app-flow.ts';

const sheet = (reason: string, captureAttempts = 1): FlowNode => ({id: reason, name: 'Sheet', kind: 'screen', path: [], required: [], status: 'timed-out', reason, captureAttempts,
  presentation: {actions: ['open'], basePath: ['Home']}});
const route = (reason: string, captureAttempts = 1): FlowNode => ({id: reason, name: 'Route', kind: 'screen', path: ['Route'], required: [], status: 'timed-out', reason, captureAttempts});

test('only a wait that time can end earns a second attempt', () => {
  for (const reason of ['loading (skeleton in Loader)', 'paint', 'settling', 'native', 'transition', 'The screenshot did not settle.', 'App Flow runtime timed out while opening a presentation.'])
    assert.equal(retryableCapture(sheet(reason)), true, reason);
  for (const reason of ['target', 'missing', 'empty', 'preview-error', 'The presentation target did not mount.', 'This step has no exact content slot inside its native presentation.', 'The shared presentation has no real state to copy.'])
    assert.equal(retryableCapture(sheet(reason)), false, reason);
  assert.equal(retryableCapture(sheet('loading (data)', 2)), false, 'A second failure is final');
  assert.equal(retryableCapture(route('Screen is still loading (skeleton).')), true);
  assert.equal(retryableCapture(route('Screen has no visible content yet.')), true, 'A slow first route render may still paint');
  assert.equal(retryableCapture(route('Navigation redirected or the target did not mount.')), false);
  assert.equal(retryableCapture({...route('Screen is still loading (skeleton).'), status: 'needs-data'}), false);
});

test('the planner queues a retry only for a transient presentation failure', async () => {
  const transient = sheet('loading (skeleton in Loader)'), structural = sheet('target');
  const run: any = {id: 'run', revision: 0, files: 1, scanMs: 0, warnings: [], edges: [], nodes: [transient, structural], presentations: {states: [], actions: []}};
  const planner = new CapturePlanner(run, '/fixture', '/fixture', new AbortController().signal, async () => {});
  await planner.after({} as any, transient, {ready: false});
  await planner.after({} as any, structural, {ready: false});
  assert.equal(transient.status, 'pending');
  assert.equal(structural.status, 'timed-out');
  assert.equal(structural.reason, 'target');
});
