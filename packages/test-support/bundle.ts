let runs = 0;

/**
 * Runs an esbuild bundle in a JSDOM window, with source text no other window ran. On Node
 * 24.14 to 24.17, running the same large bundle in a third window crashed the test process
 * in V8's garbage collector (a segfault in `ClearStaleLeftTrimmedPointerVisitor`), which the
 * runner reports only as the file's "test failed". Distinct text keeps V8 from reusing the
 * code it compiled for earlier windows. Node 22 and 24.18 or later do not crash either way.
 */
export function runBundle(window: { eval(source: string): unknown }, source: string) {
  window.eval(`${source}\n// run ${++runs}`);
}
