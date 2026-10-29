import type { TestContext } from "node:test";

const originals = new WeakMap<TestContext, Map<string, string | undefined>>();

/**
 * Sets environment variables for the rest of the test; `undefined` removes one. Each
 * variable gets the value it had before the test's first change back after the test.
 */
export function setEnv(t: TestContext, values: Record<string, string | undefined>) {
  let saved = originals.get(t);
  if (saved === undefined) {
    const restore = saved = new Map();
    originals.set(t, restore);
    t.after(() => {
      for (const [name, value] of restore) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });
  }
  for (const [name, value] of Object.entries(values)) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

/** Turns telemetry on (`MOBILE_DEV_TELEMETRY` unset) or off for the rest of the test. */
export function setTelemetry(t: TestContext, state: "on" | "off") {
  setEnv(t, { MOBILE_DEV_TELEMETRY: state === "off" ? "off" : undefined });
}
