import { DiffOptions } from './diff.js';
import { TestError } from './types.js';
export { serializeValue as serializeError } from './serialize.js';
import '@vitest/pretty-format';

declare function processError(_err: any, diffOptions?: DiffOptions, seen?: WeakSet<WeakKey>): TestError;

export { processError };
