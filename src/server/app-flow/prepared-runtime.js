import {installFlowRuntime} from './runtime.js';
import {installPresentationRuntime} from './presentations-runtime.js';
import {createCaptureQueue} from './capture-queue.js';
import {createCaptureDriver} from './capture-driver.js';
import {createTransitionMode} from './transitions-runtime.js';

// Metro compiles these functions with the app. Loading the module only
// registers the entry point; the inspector still owns its lease and cleanup.
export function installPreparedRuntime(key, leaseMs) {
  return installFlowRuntime(key, leaseMs, installPresentationRuntime, createCaptureQueue, createCaptureDriver, createTransitionMode, 'compiled');
}
