// Panel scripts and React components reach the same store through the element it controls.
export function elementStores<T extends object>(create: () => T) {
  const stores = new WeakMap<HTMLElement, T>();
  return {
    bind(element: HTMLElement, store: T) { stores.set(element, store); },
    get(element: HTMLElement): T {
      let store = stores.get(element);
      if (!store) { store = create(); stores.set(element, store); }
      return store;
    },
  };
}
