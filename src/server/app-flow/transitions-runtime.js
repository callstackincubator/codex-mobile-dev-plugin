// Serialized into the app. Change framework transition options, never app hooks,
// timers, gesture settings, presentation styles, or loading animations.
export function createTransitionMode() {
  const patches = new Map();
  let enabled = false, changed = 0;
  function descriptor(value) {
    if (!enabled || !value || typeof value !== 'object' || !value.options) return value;
    changed++;
    return {...value, options: {...value.options, animation: 'none', animationEnabled: false}};
  }
  function wrap(original) {
    return function() {
      const result = original.apply(this, arguments);
      if (!enabled || !result?.descriptors || typeof result.describe !== 'function') return result;
      return {...result, descriptors: Object.fromEntries(Object.entries(result.descriptors).map(([key, value]) => [key, descriptor(value)])),
        describe: function() { return descriptor(result.describe.apply(this, arguments)); }};
    };
  }
  function enable() {
    enabled = true;
    // Loaded framework exports are safe to inspect. Do not initialize cold app
    // modules. CommonJS imports read this export on each navigator render.
    for (const module of globalThis.__r?.getModules?.()?.values?.() ?? []) {
      if (!module.isInitialized || typeof module.verboseName !== 'string') continue;
      if (!/(?:^|\/)@react-navigation\/core\/(?:src|lib\/(?:module|commonjs))\/useDescriptors\.[jt]sx?$/.test(module.verboseName.replaceAll('\\', '/'))) continue;
      const exports = module.publicModule?.exports;
      if (!exports || patches.has(exports)) continue;
      for (const name of ['useDescriptors', 'default']) {
        const property = Object.getOwnPropertyDescriptor(exports, name);
        if (!property || !property.configurable && !property.writable) continue;
        const original = exports[name];
        if (typeof original !== 'function') continue;
        const wrapped = wrap(original);
        try {
          Object.defineProperty(exports, name, {configurable: property.configurable, enumerable: property.enumerable, writable: true, value: wrapped});
          patches.set(exports, {name, property, wrapped});
        } catch { /* Unsupported framework builds keep their normal transitions. */ }
        break;
      }
    }
  }
  function restore() {
    enabled = false;
    for (const [exports, patch] of patches) {
      if (Object.getOwnPropertyDescriptor(exports, patch.name)?.value === patch.wrapped) Object.defineProperty(exports, patch.name, patch.property);
    }
    patches.clear();
  }
  return {enable, restore, diagnostics: () => ({transitionModules: patches.size, transitionOptions: changed})};
}
